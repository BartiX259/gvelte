// compiler/index.ts
import { compile as svelte_compile } from "svelte/compiler";
import {
  analyze_script,
  transform_script_ast,
  analyze_for_reactive_exports,
} from "./js-transformer.js";
import { walk_html } from "./html-transformer.js";
import {
  CompilerState,
  CompilerError,
  Dependency,
  ModuleMetadata,
} from "./types.js";
import {
  indentBlock,
  format_compiler_error,
  format_compiler_success,
  format_generic_error,
} from "./utils.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compile_js_string } from "./js-compiler.js";
import { compile_ts_file } from "./ts-compiler.js";
import ts from "typescript";
import * as acorn from "acorn";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mangle_filepath(filepath: string, src_dir: string): string {
  const relative_path = path.relative(src_dir, filepath);
  return relative_path.replace(/\.[^/.]+$/, "").replace(/[\/\-\.]/g, "_");
}

function assemble_component(
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

let got_to_html = false;

function compile_svelte_file(
  filepath: string,
  source_code: string,
  src_dir: string,
  module_metadata_map: Map<string, ModuleMetadata>,
): { code: string; mangled_name: string } {
  got_to_html = false;
  const component_name = path.basename(filepath, ".svelte");
  const mangled_name = mangle_filepath(filepath, src_dir);
  const { ast } = svelte_compile(source_code, {});
  const { state_variables, props, dependencies } = analyze_script(ast.instance);

  for (const dep of dependencies.values()) {
    if (dep.path.startsWith(".")) {
      dep.path = path.resolve(path.dirname(filepath), dep.path);
    }
  }

  if (!dependencies.has("gi://Gtk")) {
    dependencies.set("gi://Gtk", {
      path: "gi://Gtk",
      isSvelte: false,
      location: { start: 0, end: 0 },
      specifiers: [],
    });
  }
  const gtk_dep = dependencies.get("gi://Gtk")!;
  if (!gtk_dep.specifiers.some((s) => s.importedName === "default")) {
    gtk_dep.specifiers.push({ localName: "Gtk", importedName: "default" });
  }

  const reactive_variables = new Set(state_variables);
  for (const prop_name of props.keys()) {
    reactive_variables.add(prop_name);
  }

  for (const dep of dependencies.values()) {
    const metadata = module_metadata_map.get(dep.path);
    if (metadata) {
      for (const spec of dep.specifiers) {
        if (metadata.reactiveExports.has(spec.importedName)) {
          reactive_variables.add(spec.localName);
        }
      }
    }
  }

  const state: CompilerState = {
    svelte_ast: ast,
    component_name,
    mangled_name,
    state_variables,
    props,
    dependencies,
    reactive_variables,
    widget_declarations: "",
    helper_functions: "",
    effects_and_handlers: "",
    root_widget_name: "",
    counters: {},
  };

  const transformed_script = transform_script_ast(ast.instance, state);
  got_to_html = true;
  walk_html(state);
  const final_code = assemble_component(state, transformed_script);
  return { code: final_code, mangled_name };
}

function find_files_by_ext(start_path: string, ext: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(start_path)) return [];
  const files = fs.readdirSync(start_path);
  for (const file of files) {
    const filepath = path.join(start_path, file);
    const stat = fs.lstatSync(filepath);
    if (stat.isDirectory())
      results = results.concat(find_files_by_ext(filepath, ext));
    else if (filepath.endsWith(ext)) results.push(filepath);
  }
  return results;
}

function build_project(src_dir: string, dist_dir: string) {
  console.log(`Cleaning directory: ${dist_dir}`);
  fs.rmSync(dist_dir, { recursive: true, force: true });
  fs.mkdirSync(dist_dir, { recursive: true });

  const all_source_files = [
    ...find_files_by_ext(src_dir, ".svelte"),
    ...find_files_by_ext(src_dir, ".js"),
    ...find_files_by_ext(src_dir, ".ts"),
  ].filter((file) => !file.endsWith(".d.ts"));

  const module_metadata_map = new Map<string, ModuleMetadata>();

  console.log(
    "\nPass 1: Analyzing project dependencies and reactive exports...",
  );
  for (const file of all_source_files) {
    let source_code = fs.readFileSync(file, "utf-8");
    let ast;
    try {
      if (file.endsWith(".svelte")) {
        const compiled = svelte_compile(source_code, { generate: false });
        ast = compiled.ast.instance;
      } else {
        if (file.endsWith(".ts")) {
          source_code = ts.transpileModule(source_code, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ESNext,
            },
          }).outputText;
        }
        ast = acorn.parse(source_code, {
          ecmaVersion: "latest",
          sourceType: "module",
        });
      }
      if (ast) {
        const reactiveExports = analyze_for_reactive_exports(ast);
        module_metadata_map.set(file, { reactiveExports });
      }
    } catch (e) {
      console.error(`Analysis failed for ${file}`, e);
      process.exit(1);
    }
  }

  console.log("\nPass 2: Compiling modules...");
  for (const file of all_source_files) {
    let source_code = fs.readFileSync(file, { encoding: "utf8" });
    try {
      let result: { code: string; mangled_name: string };
      const mangled_name = mangle_filepath(file, src_dir);

      if (file.endsWith(".svelte")) {
        result = compile_svelte_file(
          file,
          source_code,
          src_dir,
          module_metadata_map,
        );
      } else {
        let js_code = source_code;
        if (file.endsWith(".ts")) {
          js_code = ts.transpileModule(source_code, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ESNext,
            },
          }).outputText;
        }
        const ast = acorn.parse(js_code, {
          ecmaVersion: "latest",
          sourceType: "module",
        }) as any;
        const { state_variables, dependencies } = analyze_script({
          content: ast,
        });

        for (const dep of dependencies.values()) {
          if (dep.path.startsWith(".")) {
            dep.path = path.resolve(path.dirname(file), dep.path);
          }
        }

        const reactive_variables = new Set(state_variables);
        for (const dep of dependencies.values()) {
          const metadata = module_metadata_map.get(dep.path);
          if (metadata) {
            for (const spec of dep.specifiers) {
              if (metadata.reactiveExports.has(spec.importedName)) {
                reactive_variables.add(spec.localName);
              }
            }
          }
        }
        const { code } = compile_js_string(js_code, reactive_variables);
        result = { code, mangled_name };
      }

      const out_path = path.join(dist_dir, `${result.mangled_name}.js`);
      fs.writeFileSync(out_path, result.code);
      console.log(format_compiler_success(out_path));
    } catch (e: any) {
      // --- RESTORED ERROR HANDLING ---
      console.error(`\nCompilation failed for: ${path.basename(file)}`);
      if (e instanceof CompilerError && e.location) {
        console.error(
          format_compiler_error(
            got_to_html ? "[GTK Error]" : "[JS Error]",
            e.message,
            source_code,
            e.location,
          ),
        );
      } else if (e.position) {
        console.error(
          format_compiler_error("[Svelte Error]", e.message, source_code, {
            start: e.position[0],
            end: e.position[1],
          }),
        );
      } else if (e.code === "ENOENT") {
        console.error(
          format_generic_error(
            "[File Error]",
            `No such file or directory: ${e.path}`,
          ),
        );
      } else {
        console.error(e);
      }
      process.exit(1);
      // --- END RESTORED ERROR HANDLING ---
    }
  }

  console.log("\nBuild finished successfully!");
}

const SRC_DIR = "../../src";
const DIST_DIR = "../../dist";
build_project(path.join(__dirname, SRC_DIR), path.join(__dirname, DIST_DIR));
