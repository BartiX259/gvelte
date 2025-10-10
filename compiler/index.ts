// compiler/index.ts
import { compile as svelte_compile } from "svelte/compiler";
import { analyze_script, transform_script_ast } from "./js-transformer.js";
import { walk_html } from "./html-transformer.js";
import { CompilerState, CompilerError, DependencyInfo } from "./types.js";
import {
  indentBlock,
  format_compiler_error,
  format_compiler_success,
  format_generic_error,
} from "./utils.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Recreate __dirname for ES Module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Core Compiler Functions ---

function mangle_filepath(filepath: string, project_root: string): string {
  const relative_path = path.relative(project_root, filepath);
  return relative_path.replace(/\.svelte$/, "").replace(/[\/\-\.]/g, "_");
}

function assemble_component(
  state: CompilerState,
  transformed_script: string,
): string {
  const imports_code = Array.from(state.import_map.entries())
    .map(([local_name, mangled_name]) => {
      return `const { ${mangled_name}: ${local_name} } = imports.${mangled_name};`;
    })
    .join("\n");
  const prop_declarations: string[] = [];
  for (const [prop_name, default_value] of state.props.entries()) {
    let prop_logic = `const ${prop_name} = $state(undefined);\n`;
    prop_logic += `$effect(() => {\n`;
    prop_logic += `    if (props.${prop_name} !== undefined) {\n`;
    prop_logic += `        $set(${prop_name}, $get(props.${prop_name}));\n`;
    prop_logic += `    } else {\n`;
    prop_logic += `        $set(${prop_name}, ${default_value ?? "undefined"});\n`;
    prop_logic += `    }\n`;
    prop_logic += `});`;
    prop_declarations.push(prop_logic);
  }
  const component_function = `function ${state.component_name}(props = {}) {
    // --- Props Initialization ---
${indentBlock(prop_declarations.join("\n\n"))}
    // --- Transformed Script from <script> tag ---
${indentBlock(transformed_script.trim())}
${state.helper_functions ? `\n    // --- Helper Functions for Blocks ---\n${indentBlock(state.helper_functions.trim())}\n` : ""}
    // --- Widget Creation from template ---
${indentBlock(state.widget_declarations.trim())}
    // --- Event Handlers & Reactive Effects ---
${indentBlock(state.effects_and_handlers.trim())}
    // --- Return the root widget ---
    return {
        rootWidget: ${state.root_widget_name}
    };
}`;
  return `'use strict';
imports.gi.versions.Gtk = '4.0';
const { Gtk } = imports.gi;
const { $state, $get, $set, $effect, $derived } = imports.runtime;
${imports_code}
${component_function}
this.${state.mangled_name} = ${state.component_name};
`;
}

let got_to_html = false;

function compile_svelte_file(
  filepath: string,
  source_code: string,
  project_root: string,
): {
  code: string;
  mangled_name: string;
} {
  got_to_html = false;
  const component_name = path.basename(filepath, ".svelte");
  const mangled_name = mangle_filepath(filepath, project_root);
  const { ast } = svelte_compile(source_code, {});
  const { state_variables, props, svelte_dependencies } = analyze_script(
    ast.instance,
  );

  for (const [_local_name, dep_info] of svelte_dependencies.entries()) {
    const resolved_dep_path = path.resolve(
      path.dirname(filepath),
      dep_info.path,
    );
    if (!fs.existsSync(resolved_dep_path)) {
      throw new CompilerError(
        `Could not find component '${dep_info.path}'`,
        dep_info.location,
      );
    }
  }

  const reactive_variables = new Set([...state_variables, ...props.keys()]);
  const import_map = new Map<string, string>();
  for (const [local_name, dep_info] of svelte_dependencies.entries()) {
    const resolved_dep_path = path.resolve(
      path.dirname(filepath),
      dep_info.path,
    );
    const dep_mangled_name = mangle_filepath(resolved_dep_path, project_root);
    import_map.set(local_name, dep_mangled_name);
  }
  const state: CompilerState = {
    svelte_ast: ast,
    component_name,
    mangled_name,
    state_variables,
    props,
    svelte_dependencies,
    reactive_variables,
    import_map,
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
  return {
    code: final_code,
    mangled_name: mangled_name,
  };
}

// --- Build Orchestrator ---

function find_files_by_ext(start_path: string, ext: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(start_path)) {
    return [];
  }
  const files = fs.readdirSync(start_path);
  for (const file of files) {
    const filepath = path.join(start_path, file);
    const stat = fs.lstatSync(filepath);
    if (stat.isDirectory()) {
      results = results.concat(find_files_by_ext(filepath, ext));
    } else if (filepath.endsWith(ext)) {
      results.push(filepath);
    }
  }
  return results;
}

function build_project(src_dir: string, dist_dir: string) {
  console.log(`Cleaning directory: ${dist_dir}`);
  fs.rmSync(dist_dir, { recursive: true, force: true });
  fs.mkdirSync(dist_dir, { recursive: true });
  const project_root = path.resolve(src_dir);
  const svelte_files = find_files_by_ext(src_dir, ".svelte");
  console.log(`\nFound ${svelte_files.length} Svelte files to compile...`);
  for (const file of svelte_files) {
    let source_code = "";
    try {
      source_code = fs.readFileSync(file, { encoding: "utf8" });
      const result = compile_svelte_file(file, source_code, project_root);
      const out_name = `${result.mangled_name}.js`;
      const out_path = path.join(dist_dir, out_name);
      fs.writeFileSync(out_path, result.code);
      console.log(format_compiler_success(out_path));
    } catch (e: any) {
      if (e.location) {
        const formatted_error = format_compiler_error(
          got_to_html ? "[GTK Error]" : "[JS Error]",
          e.message,
          source_code,
          e.location,
        );
        console.error(formatted_error);
      } else if (e.position) {
        const formatted_error = format_compiler_error(
          "[Svelte Error]",
          e.message,
          source_code,
          { start: e.position[0], end: e.position[1] },
        );
        console.error(formatted_error);
      } else if (e.code && e.code == "ENOENT") {
        const formatted_error = format_generic_error(
          "[File Error]",
          `No such file or directory: ${e.path}`,
        );
        console.error(formatted_error);
      } else {
        console.error(e);
        console.error("\nBuild failed due to an unexpected error.");
      }
      process.exit(1);
    }
  }
  console.log("\nCopying static files...");
  const static_files = find_files_by_ext(src_dir, ".js");
  for (const file of static_files) {
    const relative_path = path.relative(src_dir, file);
    const out_path = path.join(dist_dir, relative_path);
    fs.cpSync(file, out_path);
    console.log(`Copied ${relative_path}`);
  }
  console.log("\nBuild finished successfully!");
}

// --- Main Execution ---
const SRC_DIR = "../../src";
const DIST_DIR = "../../dist";
build_project(path.join(__dirname, SRC_DIR), path.join(__dirname, DIST_DIR));
