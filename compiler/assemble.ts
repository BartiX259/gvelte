// compiler/assemble.ts
import path from "path";
import { fileURLToPath } from "url";
import { CompilerState } from "./types.js";
import { indentBlock, mangle_filepath } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function assemble_component(
  state: CompilerState,
  transformed_script: string,
): string {
  const gi_imports: string[] = [];
  const system_imports: string[] = [];
  const app_imports = new Map<
    string,
    { isSvelte: boolean; specifiers: string[] }
  >();
  const src_dir = path.resolve(__dirname, "../../src");

  for (const dep of state.dependencies.values()) {
    if (dep.path.startsWith("gi://")) {
      const module_name = dep.path.match(/gi:\/\/(\w+)/)?.[1];
      if (!module_name) continue;
      const default_import = dep.specifiers.find(
        (s) => s.importedName === "default",
      );
      const named_imports = dep.specifiers.filter(
        (s) => s.importedName !== "default",
      );
      if (default_import)
        gi_imports.push(
          `const ${default_import.localName} = imports.gi.${module_name};`,
        );
      if (named_imports.length > 0)
        gi_imports.push(
          `const { ${named_imports.map((s) => (s.localName === s.importedName ? s.localName : `${s.importedName}: ${s.localName}`)).join(", ")} } = imports.gi.${module_name};`,
        );
    } else {
      const mangled_name = mangle_filepath(dep.path, src_dir);
      if (!app_imports.has(mangled_name))
        app_imports.set(mangled_name, {
          isSvelte: dep.isSvelte,
          specifiers: [],
        });
      const group = app_imports.get(mangled_name)!;
      for (const spec of dep.specifiers) {
        if (dep.isSvelte) {
          group.specifiers.push(`${mangled_name}: ${spec.localName}`);
        } else {
          group.specifiers.push(
            spec.localName === spec.importedName
              ? spec.localName
              : `${spec.importedName}: ${spec.localName}`,
          );
        }
      }
    }
  }

  const app_imports_code = Array.from(app_imports.entries())
    .map(([mangled_name, info]) => {
      const specifiers_str = info.specifiers.join(", ");
      return `const { ${specifiers_str} } = imports.${mangled_name};`;
    })
    .join("\n");

  const prop_declarations: string[] = [];
  for (const [prop_name, default_value] of state.props.entries()) {
    const prop_is_bindable = default_value === "$bindable()";
    const default_val_str = prop_is_bindable
      ? "undefined"
      : (default_value ?? "undefined");
    prop_declarations.push(
      `const ${prop_name} = $prop(props, '${prop_name}', ${default_val_str}, ${prop_is_bindable});`,
    );
  }

  const component_function = `function ${state.component_name}(props = {}) {
${indentBlock(prop_declarations.join("\n"))}
${indentBlock(transformed_script.trim())}
${state.helper_functions ? `\n${indentBlock(state.helper_functions.trim())}\n` : ""}
${indentBlock(state.widget_declarations.trim())}
${indentBlock(state.effects_and_handlers.trim())}
return { rootWidget: ${state.root_widget_name} };
}`;

  return `'use strict';
${gi_imports.join("\n")}
${system_imports.join("\n")}
const { $state, $get, $set, $effect, $derived, $notify, $prop } = imports.runtime;
${app_imports_code}

${component_function}

this.${state.mangled_name} = ${state.component_name};
`;
}
