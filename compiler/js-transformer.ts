// compiler/js-transformer.ts
import { walk } from "estree-walker";
import { generate } from "astring";
import {
  CompilerError,
  CompilerState,
  Dependency,
  ImportSpecifier,
} from "./types.js";

interface WalkerContext {
  remove(): void;
  replace(node: any): void;
  skip(): void;
}

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

/**
 * The single, robust transformation function for all reactive code.
 * Exported to be used by other compiler modules.
 */
export function transform_reactive_ast(
  ast: any,
  reactive_variables: Set<string>,
  local_scope: Set<string> = new Set(),
) {
  const scope_stack: Set<string>[] = [local_scope];
  let root_replacement = null;

  function is_in_scope(name: string): boolean {
    for (let i = scope_stack.length - 1; i >= 0; i--) {
      if (scope_stack[i]?.has(name)) return true;
    }
    return false;
  }

  function get_base_identifier_name(node: any): string | null {
    let base = node;
    while (base.type === "MemberExpression") base = base.object;
    if (base.type === "Identifier") return base.name;
    if (
      base.type === "CallExpression" &&
      base.callee?.name === "$get" &&
      base.arguments[0]?.type === "Identifier"
    ) {
      return base.arguments[0].name;
    }
    return null;
  }

  const ast_copy = JSON.parse(JSON.stringify(ast));

  walk(ast_copy, {
    enter: (node: any) => {
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        const new_scope = new Set<string>();
        if (node.id) new_scope.add(node.id.name);
        node.params.forEach((param: any) => {
          if (param.type === "Identifier") new_scope.add(param.name);
        });
        scope_stack.push(new_scope);
      }
    },
    leave: function (this: WalkerContext, node: any, parent: any, key: any) {
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        scope_stack.pop();
      }

      let replacement = null;

      if (
        node.type === "Identifier" &&
        reactive_variables.has(node.name) &&
        !is_in_scope(node.name)
      ) {
        const isLHS =
          parent && parent.type === "AssignmentExpression" && key === "left";
        const isUpdateArg =
          parent && parent.type === "UpdateExpression" && key === "argument";
        const isDecl =
          parent && parent.type === "VariableDeclarator" && key === "id";
        // Check if this is an object property shorthand value
        const isShorthandValue =
          parent &&
          parent.type === "Property" &&
          parent.shorthand === true &&
          key === "value";

        if (!isLHS && !isUpdateArg && !isDecl && !isShorthandValue) {
          replacement = {
            type: "CallExpression",
            callee: { type: "Identifier", name: "$get" },
            arguments: [node],
          };
        } else if (isShorthandValue) {
          // Convert shorthand to longhand with $get
          // We need to create a new identifier for the key (unchanged)
          // and wrap the value with $get
          parent.shorthand = false;
          parent.key = { type: "Identifier", name: node.name };
          parent.value = {
            type: "CallExpression",
            callee: { type: "Identifier", name: "$get" },
            arguments: [{ type: "Identifier", name: node.name }],
          };
          // Skip replacement since we've already modified the parent
          return;
        }
      } else if (
        node.type === "AssignmentExpression" ||
        node.type === "UpdateExpression"
      ) {
        const is_update = node.type === "UpdateExpression";
        const target = is_update ? node.argument : node.left;
        const base_name = get_base_identifier_name(target);

        if (
          base_name &&
          reactive_variables.has(base_name) &&
          !is_in_scope(base_name)
        ) {
          if (target.type === "MemberExpression") {
            replacement = {
              type: "SequenceExpression",
              expressions: [
                node,
                {
                  type: "CallExpression",
                  callee: { type: "Identifier", name: "$notify" },
                  arguments: [{ type: "Identifier", name: base_name }],
                },
              ],
            };
          } else if (target.type === "Identifier") {
            if (is_update) {
              const op = node.operator === "++" ? "+" : "-";
              replacement = {
                type: "CallExpression",
                callee: { type: "Identifier", name: "$set" },
                arguments: [
                  target,
                  {
                    type: "BinaryExpression",
                    operator: op,
                    left: {
                      type: "CallExpression",
                      callee: { type: "Identifier", name: "$get" },
                      arguments: [target],
                    },
                    right: { type: "Literal", value: 1, raw: "1" },
                  },
                ],
              };
            } else {
              const op = node.operator.slice(0, -1);
              replacement =
                node.operator === "="
                  ? {
                      type: "CallExpression",
                      callee: { type: "Identifier", name: "$set" },
                      arguments: [node.left, node.right],
                    }
                  : {
                      type: "CallExpression",
                      callee: { type: "Identifier", name: "$set" },
                      arguments: [
                        node.left,
                        {
                          type: "BinaryExpression",
                          operator: op,
                          left: {
                            type: "CallExpression",
                            callee: { type: "Identifier", name: "$get" },
                            arguments: [node.left],
                          },
                          right: node.right,
                        },
                      ],
                    };
            }
          }
        }
      }

      if (replacement) {
        if (!parent) {
          root_replacement = replacement;
        } else {
          this.replace(replacement);
        }
      }
    },
  });

  return root_replacement || ast_copy;
}

/**
 * Transforms a component's script AST.
 */
export function transform_script_ast(
  script_ast: any,
  state: CompilerState,
): string {
  if (!script_ast || !script_ast.content) return "";
  const ast_copy = JSON.parse(JSON.stringify(script_ast.content));

  walk(ast_copy, {
    enter: function (this: WalkerContext, node: any) {
      if (node.type === "ImportDeclaration") this.remove();
      if (
        node.type === "VariableDeclaration" &&
        node.declarations.some((d: any) => d.init?.callee?.name === "$props")
      )
        this.remove();
    },
  });

  const transformed_ast = transform_reactive_ast(
    ast_copy,
    state.reactive_variables,
  );
  return generate(transformed_ast);
}

/**
 * Transforms a simple expression AST (e.g., from a template).
 */
export function transform_expression_ast(
  expression_ast: any,
  reactive_variables: Set<string>,
  local_scope: Set<string> = new Set(),
): string {
  if (!expression_ast) return "";

  const transformed_ast = transform_reactive_ast(
    expression_ast,
    reactive_variables,
    local_scope,
  );

  return generate(transformed_ast);
}
