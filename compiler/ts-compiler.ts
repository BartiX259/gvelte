// compiler/ts-compiler.ts
import ts from "typescript";
import { compile_js_string } from "./js-compiler.js";

export function compile_ts_file(
  source_code: string,
  all_reactive_vars: Set<string>,
) {
  // 1. Transpile TypeScript to a plain JavaScript string in memory
  const js_code = ts.transpileModule(source_code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  // 2. Feed the resulting JS string into the same pipeline used for .js files
  return compile_js_string(js_code, all_reactive_vars);
}
