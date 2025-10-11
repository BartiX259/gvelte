// compiler/js-compiler.ts
import * as acorn from "acorn";
import { walk } from "estree-walker";
import { generate } from "astring";
import { transform_reactive_ast } from "./js-transformer.js";

interface WalkerContext {
  remove(): void;
  replace(node: any): void;
}

export function compile_js_string(
  source_code: string,
  all_reactive_vars: Set<string>,
) {
  const ast = acorn.parse(source_code, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;

  const exports: string[] = [];
  walk(ast, {
    enter(node: any) {
      if (node.type === "ExportNamedDeclaration") {
        if (node.declaration) {
          if (node.declaration.type === "VariableDeclaration") {
            node.declaration.declarations.forEach((d: any) =>
              exports.push(d.id.name),
            );
          } else if (node.declaration.id) {
            exports.push(node.declaration.id.name);
          }
        } else {
          node.specifiers.forEach((spec: any) =>
            exports.push(spec.exported.name),
          );
        }
      }
    },
  });

  // --- THIS IS THE CORRECTED LOGIC ---
  walk(ast, {
    enter: function (this: WalkerContext, node: any) {
      // Remove all import declarations
      if (node.type.startsWith("Import")) {
        this.remove();
        return;
      }

      // Handle export declarations intelligently
      if (node.type === "ExportNamedDeclaration") {
        if (node.declaration) {
          // This is an `export const ...` or `export function ...`
          // We replace the export statement with just its declaration.
          this.replace(node.declaration);
        } else {
          // This is an `export { var1, var2 };`
          // The variables are already declared, so we can safely remove this line.
          this.remove();
        }
        return;
      }

      // For now, we don't support default exports, so just remove the statement.
      if (node.type === "ExportDefaultDeclaration") {
        this.remove();
        return;
      }
    },
  });

  let transformed_code = ast;

  if (all_reactive_vars.size > 0) {
    transformed_code = transform_reactive_ast(ast, all_reactive_vars);
  }

  const core_code = generate(transformed_code);

  let final_code = `'use strict';\n\n`;
  if (all_reactive_vars.size > 0) {
    final_code += `const { $state, $get, $set, $effect, $derived, $notify } = imports.runtime;\n\n`;
  }

  final_code += core_code;
  final_code += `\n\n// Exports\n`;
  const declared_vars = new Set(exports);
  for (const reactive_var of all_reactive_vars) {
    // Ensure we also export any reactive variables declared in this file
    const declarator = ast.body.find(
      (n: any) =>
        n.type === "VariableDeclaration" &&
        n.declarations[0]?.id.name === reactive_var,
    );
    if (declarator) {
      declared_vars.add(reactive_var);
    }
  }

  declared_vars.forEach((export_name) => {
    final_code += `this.${export_name} = ${export_name};\n`;
  });

  return { code: final_code };
}
