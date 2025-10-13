// compiler/js/analyze.ts
import { walk } from "estree-walker";
import { generate } from "astring";
import { CompilerError, Dependency } from "../types.js";

/**
 * Pass 1: Analyzes an AST to find variables that are both created with
 * `$state` or `$derived` and are exported from the file.
 */
export function analyze_for_reactive_exports(ast: any): Set<string> {
  const reactiveExports = new Set<string>();
  const declaredReactiveVars = new Set<string>();

  walk(ast, {
    enter(node: any) {
      if (
        node.type === "VariableDeclarator" &&
        node.init?.type === "CallExpression"
      ) {
        const calleeName = node.init.callee?.name;
        if (
          (calleeName === "$state" || calleeName === "$derived") &&
          node.id.type === "Identifier"
        ) {
          declaredReactiveVars.add(node.id.name);
        }
      }
    },
  });

  walk(ast, {
    enter(node: any) {
      if (node.type === "ExportNamedDeclaration") {
        if (
          node.declaration &&
          node.declaration.type === "VariableDeclaration"
        ) {
          for (const decl of node.declaration.declarations) {
            if (
              decl.id.type === "Identifier" &&
              declaredReactiveVars.has(decl.id.name)
            ) {
              reactiveExports.add(decl.id.name);
            }
          }
        } else if (node.specifiers) {
          for (const spec of node.specifiers) {
            if (declaredReactiveVars.has(spec.local.name)) {
              reactiveExports.add(spec.exported.name);
            }
          }
        }
      }
    },
  });

  return reactiveExports;
}

/**
 * Analyzes a script's AST to find all dependencies, local state variables, and props.
 */
export function analyze_script(script_ast: any): {
  state_variables: Set<string>;
  props: Map<string, string | null>;
  dependencies: Map<string, Dependency>;
} {
  const state_variables = new Set<string>();
  const props = new Map<string, string | null>();
  const dependencies = new Map<string, Dependency>();

  if (!script_ast || !script_ast.content) {
    return { state_variables, props, dependencies };
  }
  walk(script_ast.content, {
    enter: (node: any) => {
      if (node.type === "ImportDeclaration") {
        const source = node.source.value;
        const location = { start: node.source.start, end: node.source.end };
        if (!dependencies.has(source)) {
          dependencies.set(source, {
            path: source,
            location,
            isSvelte: source.endsWith(".svelte"),
            specifiers: [],
          });
        }
        const dep = dependencies.get(source)!;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportDefaultSpecifier") {
            dep.specifiers.push({
              localName: spec.local.name,
              importedName: "default",
            });
          } else if (spec.type === "ImportSpecifier") {
            dep.specifiers.push({
              localName: spec.local.name,
              importedName: spec.imported.name,
            });
          }
        }
      }
      if (
        node.type === "VariableDeclarator" &&
        node.init?.type === "CallExpression"
      ) {
        const calleeName = node.init.callee?.name;
        if (calleeName === "$state" || calleeName === "$derived") {
          if (node.id.type === "Identifier") state_variables.add(node.id.name);
        }
        if (calleeName === "$props") {
          if (node.id.type !== "ObjectPattern")
            throw new CompilerError(
              "`$props()` must be destructured.",
              node.id,
            );
          for (const prop of node.id.properties) {
            if (prop.type === "Property") {
              if (prop.value.type === "AssignmentPattern") {
                props.set((prop.key as any).name, generate(prop.value.right));
              } else if (prop.value.type === "Identifier") {
                props.set((prop.key as any).name, null);
              }
            }
          }
        }
      }
    },
  });
  return { state_variables, props, dependencies };
}
