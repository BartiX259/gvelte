// compiler/js-transformer.ts
import { walk } from "estree-walker";
import { generate } from "astring";
import { CompilerError, CompilerState, DependencyInfo } from "./types.js";

interface WalkerContext {
  remove(): void;
  replace(node: any): void;
}

export function analyze_script(script_ast: any): {
  state_variables: Set<string>;
  props: Map<string, string | null>;
  svelte_dependencies: Map<string, DependencyInfo>;
} {
  const state_variables = new Set<string>();
  const props = new Map<string, string | null>();
  const svelte_dependencies = new Map<string, DependencyInfo>();

  if (!script_ast || !script_ast.content) {
    return { state_variables, props, svelte_dependencies };
  }

  walk(script_ast.content, {
    enter: (node: any) => {
      // Find Svelte component imports and capture the local name
      if (
        node.type === "ImportDeclaration" &&
        node.source.value.endsWith(".svelte")
      ) {
        const local_name = node.specifiers.find(
          (s: any) => s.type === "ImportDefaultSpecifier",
        )?.local.name;
        if (local_name) {
          const dep_info: DependencyInfo = {
            path: node.source.value,
            location: { start: node.source.start, end: node.source.end },
          };
          svelte_dependencies.set(local_name, dep_info);
        }
      }

      // Find state variables and props (this logic is unchanged)
      if (
        node.type === "VariableDeclarator" &&
        node.init?.type === "CallExpression"
      ) {
        const calleeName = node.init.callee?.name;

        if (calleeName === "$state" || calleeName === "$derived") {
          if (node.id.type === "Identifier") {
            state_variables.add(node.id.name);
          }
        }

        if (calleeName === "$props") {
          if (node.id.type !== "ObjectPattern") {
            throw new CompilerError(
              "`$props()` must be destructured.",
              node.id,
            );
          }
          for (const prop of node.id.properties) {
            if (prop.value.type === "AssignmentPattern") {
              const prop_name = prop.key.name;
              const default_value_ast = prop.value.right;
              props.set(prop_name, generate(default_value_ast));
            } else if (prop.value.type === "Identifier") {
              props.set(prop.key.name, null);
            }
          }
        }
      }
    },
  });
  return { state_variables, props, svelte_dependencies };
}

export function transform_script_ast(
  script_ast: any,
  state: CompilerState,
): string {
  if (!script_ast || !script_ast.content) return "";

  const ast_copy = JSON.parse(JSON.stringify(script_ast.content));
  const scope_stack: Set<string>[] = [new Set()];

  function is_in_scope(name: string): boolean {
    for (let i = scope_stack.length - 1; i >= 0; i--) {
      const scope = scope_stack[i];
      if (scope && scope.has(name)) {
        return true;
      }
    }
    return false;
  }

  function get_base_identifier(node: any): any | null {
    while (node.type === "MemberExpression") {
      node = node.object;
    }
    if (node.type === "Identifier") {
      return node;
    }
    return null;
  }

  walk(ast_copy, {
    enter: function (this: WalkerContext, node: any) {
      if (
        node.type === "ImportDeclaration" &&
        node.source.value.endsWith(".svelte")
      ) {
        this.remove();
        return;
      }

      if (node.type === "VariableDeclaration") {
        const contains_props = node.declarations.some(
          (d: any) => d.init?.callee?.name === "$props",
        );
        if (contains_props) {
          this.remove();
          return;
        }
      }

      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        const new_scope = new Set<string>();
        if (node.id) new_scope.add(node.id.name);
        node.params.forEach((param: any) => {
          if (param.type === "Identifier") {
            new_scope.add(param.name);
          } else {
            throw new CompilerError(
              `Destructuring in function parameters is not supported in this context.`,
              param,
            );
          }
        });
        scope_stack.push(new_scope);
      } else if (node.type === "CatchClause") {
        const new_scope = new Set<string>();
        if (node.param && node.param.type === "Identifier") {
          new_scope.add(node.param.name);
        }
        scope_stack.push(new_scope);
      }
    },
    leave: (node: any, parent: any, key: any, index: any) => {
      if (!node) return;

      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression" ||
        node.type === "CatchClause"
      ) {
        scope_stack.pop();
      }

      let replacement = null;

      if (
        node.type === "Identifier" &&
        state.reactive_variables.has(node.name) &&
        !is_in_scope(node.name)
      ) {
        const isDecl =
          (parent.type === "VariableDeclarator" && key === "id") ||
          (parent.type === "FunctionDeclaration" && key === "id") ||
          (parent.type === "ClassDeclaration" && key === "id");
        const isAssign =
          parent.type === "AssignmentExpression" && key === "left";
        const isUpdate =
          parent.type === "UpdateExpression" && key === "argument";
        const isMemberProp =
          parent.type === "MemberExpression" &&
          key === "property" &&
          !parent.computed;
        const isShorthandProp =
          parent.type === "Property" && key === "value" && parent.shorthand;
        const isObjectKey = parent.type === "Property" && key === "key";

        if (
          !isDecl &&
          !isAssign &&
          !isUpdate &&
          !isMemberProp &&
          !isObjectKey
        ) {
          replacement = {
            type: "CallExpression",
            callee: { type: "Identifier", name: "$get" },
            arguments: [node],
          };
          if (isShorthandProp) {
            parent.shorthand = false;
            parent.value = replacement;
            return;
          }
        }
      }

      if (node.type === "AssignmentExpression") {
        if (
          node.left.type !== "Identifier" &&
          node.left.type !== "MemberExpression"
        ) {
          throw new CompilerError(
            "Assignment to a destructuring pattern involving state variables is not supported.",
            node.left,
          );
        }
        const target_node = get_base_identifier(node.left);
        if (
          target_node &&
          state.reactive_variables.has(target_node.name) &&
          !is_in_scope(target_node.name)
        ) {
          if (node.operator === "=") {
            replacement = {
              type: "CallExpression",
              callee: { type: "Identifier", name: "$set" },
              arguments: [node.left, node.right],
            };
          } else {
            const operator = node.operator.slice(0, -1);
            replacement = {
              type: "CallExpression",
              callee: { type: "Identifier", name: "$set" },
              arguments: [
                node.left,
                {
                  type: "BinaryExpression",
                  operator: operator,
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

      if (
        node.type === "UpdateExpression" &&
        node.argument.type === "Identifier" &&
        state.reactive_variables.has(node.argument.name) &&
        !is_in_scope(node.argument.name)
      ) {
        if (parent.type !== "ExpressionStatement") {
          throw new CompilerError(
            `The ++/-- operators on state variables are only supported as standalone statements, not within other expressions.`,
            node,
          );
        }
        const operator = node.operator === "++" ? "+" : "-";
        replacement = {
          type: "CallExpression",
          callee: { type: "Identifier", name: "$set" },
          arguments: [
            node.argument,
            {
              type: "BinaryExpression",
              operator: operator,
              left: {
                type: "CallExpression",
                callee: { type: "Identifier", name: "$get" },
                arguments: [node.argument],
              },
              right: { type: "Literal", value: 1, raw: "1" },
            },
          ],
        };
      }

      if (node.type === "CallExpression" && node.callee.name === "$derived") {
        const expr = node.arguments[0];
        if (
          expr &&
          expr.type !== "ArrowFunctionExpression" &&
          expr.type !== "FunctionExpression"
        ) {
          node.arguments[0] = {
            type: "ArrowFunctionExpression",
            params: [],
            body: expr,
          };
        }
      }

      if (replacement) {
        if (index !== null) {
          parent[key][index] = replacement;
        } else {
          parent[key] = replacement;
        }
      }
    },
  });

  return generate(ast_copy);
}

export function transform_expression_ast(
  expression_ast: any,
  reactive_variables: Set<string>,
  local_scope: Set<string> = new Set(),
): string {
  if (!expression_ast) return "";
  const ast_copy = JSON.parse(JSON.stringify(expression_ast));
  let root_replacement = null;
  walk(ast_copy, {
    leave: (node: any, parent: any, key: any, index: any) => {
      if (!node) return;
      if (
        node.type === "Identifier" &&
        reactive_variables.has(node.name) &&
        !local_scope.has(node.name)
      ) {
        const isCallee = parent?.type === "CallExpression" && key === "callee";
        if (!isCallee) {
          const replacement = {
            type: "CallExpression",
            callee: { type: "Identifier", name: "$get" },
            arguments: [node],
          };
          if (parent) {
            if (index !== null) {
              parent[key][index] = replacement;
            } else {
              parent[key] = replacement;
            }
          } else {
            root_replacement = replacement;
          }
        }
      }
    },
  });
  return generate(root_replacement || ast_copy);
}
