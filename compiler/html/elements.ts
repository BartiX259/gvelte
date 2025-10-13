// compiler/html/elements.ts
import { generate } from "astring";
import { walk } from "estree-walker";
import {
  transform_expression_ast,
  transform_reactive_ast,
} from "../js/transform.js";
import {
  CompilerError,
  CompilerState,
  ContainerType,
  Location,
} from "../types.js";
import { generate_var_name, indentBlock } from "../utils.js";
import {
  process_align_attribute,
  process_bind_attribute,
  process_orientation_attribute,
} from "./attributes.js";
import { walk_nodes } from "./index.js";
import { WIDGET_MAP } from "./widget-map.js";

// --- Internal Helpers ---

function getNodeOpeningTagLocation(node: any): Location {
  const end = node.attributes[0]?.start || node.children[0]?.start || node.end;
  const effectiveEnd = end > node.start ? end : node.end;
  return { start: node.start, end: effectiveEnd };
}

function process_text_and_mustache_children(
  children: any[],
  state: CompilerState,
  local_scope: Set<string>,
): { template_string: string; is_reactive: boolean } {
  let is_reactive = false;
  const template_parts = children
    .map((child: any) => {
      if (!child) return "";
      if (child.type === "Text") return child.data.replace(/`/g, "\\`"); // Escape backticks
      if (child.type === "MustacheTag") {
        walk(child.expression, {
          enter(expr_node: any) {
            if (
              expr_node.type === "Identifier" &&
              state.reactive_variables.has(expr_node.name) &&
              !local_scope.has(expr_node.name)
            ) {
              is_reactive = true;
            }
          },
        });
        const transformed_expr = transform_expression_ast(
          child.expression,
          state.reactive_variables,
          local_scope,
        );
        return `\${${transformed_expr}}`;
      }
      return "";
    })
    .join("");

  return { template_string: template_parts.trim(), is_reactive };
}

// --- Node Processor Exports ---

export function process_component_node(
  node: any,
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const component_name = node.name;
  const instance_name = generate_var_name(state, component_name.toLowerCase());
  let props_string = "";

  for (const attr of node.attributes) {
    if (attr.type !== "Attribute") continue;
    const prop_name = attr.name;
    const value_node = attr.value[0];

    if (value_node.type === "Text") {
      props_string += `${prop_name}: $state(${JSON.stringify(
        value_node.data,
      )}), `;
    } else if (value_node.type === "MustacheTag") {
      const expression_code = generate(value_node.expression);
      props_string += `${prop_name}: ${expression_code}, `;
    }
  }

  if (node.children && node.children.length > 0) {
    const meaningful_children = node.children.filter(
      (c: any) => !(c.type === "Text" && !c.data.trim()),
    );

    if (meaningful_children.length > 0) {
      const children_container_var = generate_var_name(state, "children_box");
      const children_code = walk_nodes(
        meaningful_children,
        children_container_var,
        ContainerType.MULTIPLE,
        state,
        local_scope,
      );
      const snippet_name = generate_var_name(state, "children_snippet");
      const snippet_function =
        `function ${snippet_name}() {\n` +
        `    const ${children_container_var} = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });\n` +
        indentBlock(children_code.declarations) +
        `\n` +
        indentBlock(children_code.handlers) +
        `\n` +
        `    return ${children_container_var};\n` +
        `}\n\n`;

      state.helper_functions += snippet_function;
      props_string += `children: ${snippet_name}, `;
    }
  }

  let declarations = `const ${instance_name} = ${component_name}({ ${props_string} });\n`;
  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${instance_name}.rootWidget);\n`;
  } else {
    declarations += `${parent_var_name}.append(${instance_name}.rootWidget);\n`;
  }

  return { declarations, handlers: "" };
}

export function process_element(
  node: any,
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  let declarations = "";
  let handlers = "";
  const tag = node.name;
  const widget_info = WIDGET_MAP[tag];
  if (!widget_info) {
    const available_tags = Object.keys(WIDGET_MAP).join(", ");
    throw new CompilerError(
      `Unsupported GTK tag: <${tag}>. Available tags are: ${available_tags}.`,
      getNodeOpeningTagLocation(node),
    );
  }

  const var_name = generate_var_name(state, tag);
  let props_string = "";

  for (const attr of node.attributes) {
    if (attr.type !== "Attribute" || attr.name.startsWith("on")) continue;
    const prop_name = attr.name;
    const value_node = attr.value[0];

    if (widget_info.valid_props.includes(prop_name)) {
      switch (prop_name) {
        case "bind":
          handlers += process_bind_attribute(tag, var_name, value_node);
          break;
        case "orientation":
          const orientation_value = process_orientation_attribute(value_node);
          props_string += `${prop_name}: ${orientation_value}, `;
          break;
        case "halign":
        case "valign":
          const align_value = process_align_attribute(value_node);
          props_string += `${prop_name}: ${align_value}, `;
          break;
        default:
          if (!value_node) continue;

          if (value_node.type === "Text") {
            if (value_node.data === "true" || value_node.data === "false") {
              props_string += `${prop_name}: ${value_node.data}, `;
            } else {
              props_string += `${prop_name}: ${JSON.stringify(
                value_node.data,
              )}, `;
            }
          } else if (value_node.type === "MustacheTag") {
            let is_reactive = false;
            walk(value_node.expression, {
              enter(expr_node: any) {
                if (
                  expr_node.type === "Identifier" &&
                  state.reactive_variables.has(expr_node.name) &&
                  !local_scope.has(expr_node.name)
                ) {
                  is_reactive = true;
                }
              },
            });

            const transformed_expression = transform_expression_ast(
              value_node.expression,
              state.reactive_variables,
              local_scope,
            );

            if (is_reactive) {
              handlers += `$effect(() => { ${var_name}.${prop_name} = ${transformed_expression}; });\n`;
            } else {
              props_string += `${prop_name}: ${transformed_expression}, `;
            }
          }
          break;
      }
    } else {
      const available_attrs = widget_info.valid_props.join(", ");
      throw new CompilerError(
        `Unsupported attribute '${prop_name}' for <${tag}>. Available attributes are: ${available_attrs}.`,
        attr,
      );
    }
  }

  declarations += `const ${var_name} = new ${widget_info.class}({ ${props_string} });\n`;
  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${var_name});\n`;
  } else {
    declarations += `${parent_var_name}.append(${var_name});\n`;
  }

  if (node.children && node.children.length > 0) {
    switch (widget_info.containerType) {
      case ContainerType.SINGLE: {
        const elementChildren = node.children.filter(
          (c: any) => c.type === "Element" || c.type === "InlineComponent",
        );
        const textChildren = node.children.filter(
          (c: any) =>
            (c.type === "Text" && c.data.trim()) || c.type === "MustacheTag",
        );

        if (elementChildren.length > 0 && textChildren.length > 0) {
          throw new CompilerError(
            `<${tag}> cannot have both element children and direct text content.`,
            getNodeOpeningTagLocation(node),
          );
        }
        if (elementChildren.length > 1) {
          throw new CompilerError(
            `<${tag}> can only have one element child.`,
            getNodeOpeningTagLocation(node),
          );
        }

        if (elementChildren.length === 1) {
          const children_code = walk_nodes(
            node.children,
            var_name,
            widget_info.containerType,
            state,
            local_scope,
          );
          declarations += children_code.declarations;
          handlers += children_code.handlers;
        } else if (textChildren.length > 0) {
          const label_var = generate_var_name(state, "label");
          declarations += `const ${label_var} = new Gtk.Label();\n`;
          const { template_string, is_reactive } =
            process_text_and_mustache_children(
              node.children,
              state,
              local_scope,
            );
          if (template_string) {
            if (is_reactive)
              handlers += `$effect(() => { ${label_var}.set_label(\`${template_string}\`); });\n`;
            else
              declarations += `${label_var}.set_label(\`${template_string}\`);\n`;
          }
          declarations += `${var_name}.set_child(${label_var});\n`;
        }
        break;
      }
      case ContainerType.MULTIPLE: {
        const children_code = walk_nodes(
          node.children,
          var_name,
          widget_info.containerType,
          state,
          local_scope,
        );
        declarations += children_code.declarations;
        handlers += children_code.handlers;
        break;
      }
      case ContainerType.NONE: {
        if (
          node.children.some(
            (c: any) => c.type === "Element" || c.type === "InlineComponent",
          )
        ) {
          throw new CompilerError(
            `<${tag}> cannot have element children.`,
            getNodeOpeningTagLocation(node),
          );
        }
        const { template_string, is_reactive } =
          process_text_and_mustache_children(node.children, state, local_scope);
        if (template_string) {
          if (is_reactive)
            handlers += `$effect(() => { ${var_name}.set_label(\`${template_string}\`); });\n`;
          else
            declarations += `${var_name}.set_label(\`${template_string}\`);\n`;
        }
        break;
      }
    }
  }

  for (const attr of node.attributes) {
    if (attr.type === "Attribute" && attr.name.startsWith("on")) {
      const expression = attr.value[0]?.expression;
      if (expression) {
        const event_name = attr.name.substring(2);
        const gjs_event_name = event_name === "click" ? "clicked" : event_name;

        let handler_code;
        const expression_type = expression.type;

        const expression_copy = JSON.parse(JSON.stringify(expression));
        const transformed_ast = transform_reactive_ast(
          expression_copy,
          state.reactive_variables,
        );
        const statement_code = generate(transformed_ast);

        if (
          expression_type === "Identifier" ||
          expression_type === "ArrowFunctionExpression" ||
          expression_type === "FunctionExpression"
        ) {
          handler_code = statement_code;
        } else {
          handler_code = `() => { ${statement_code}; }`;
        }

        handlers += `${var_name}.connect('${gjs_event_name}', ${handler_code});\n`;
      }
    }
  }

  return { declarations, handlers };
}
