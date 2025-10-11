// compiler/html-transformer.ts
import {
  CompilerError,
  CompilerState,
  ContainerType,
  Location,
} from "./types.js";
import { generate_var_name, indentBlock } from "./utils.js";
import {
  transform_expression_ast,
  transform_reactive_ast,
} from "./js-transformer.js";
import { walk } from "estree-walker";
import { generate } from "astring";

// --- Centralized Configuration ---

// Common layout properties applicable to most GTK widgets.
const COMMON_LAYOUT_PROPS = [
  "vexpand",
  "hexpand",
  "valign",
  "halign",
  "margin_top",
  "margin_bottom",
  "margin_start",
  "margin_end",
  "css_classes",
];

const WIDGET_MAP: {
  [key: string]: {
    class: string;
    containerType: ContainerType;
    valid_props: string[];
  };
} = {
  box: {
    class: "Gtk.Box",
    containerType: ContainerType.MULTIPLE,
    valid_props: [
      "orientation",
      "spacing",
      "homogeneous",
      "baseline_position",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  label: {
    class: "Gtk.Label",
    containerType: ContainerType.NONE,
    valid_props: [
      "label",
      "use_markup",
      "use_underline",
      "selectable",
      "wrap",
      "wrap_mode",
      "lines",
      "justify",
      "ellipsize",
      "width_chars",
      "max_width_chars",
      "xalign",
      "yalign",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  button: {
    class: "Gtk.Button",
    containerType: ContainerType.SINGLE,
    valid_props: [
      "label",
      "icon_name",
      "has_frame",
      "use_underline",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  entry: {
    class: "Gtk.Entry",
    containerType: ContainerType.NONE,
    valid_props: [
      "bind", // Custom property for your compiler
      "text",
      "placeholder_text",
      "visibility",
      "editable",
      "max_length",
      "has_frame",
      "activates_default",
      "input_purpose",
      "input_hints",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  switch: {
    class: "Gtk.Switch",
    containerType: ContainerType.NONE,
    valid_props: ["bind", "active", "state", ...COMMON_LAYOUT_PROPS],
  },
  spinbutton: {
    class: "Gtk.SpinButton",
    containerType: ContainerType.NONE,
    valid_props: [
      "bind",
      "value",
      "digits",
      "numeric",
      "wrap",
      "snap_to_ticks",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  checkbutton: {
    class: "Gtk.CheckButton",
    containerType: ContainerType.NONE,
    valid_props: [
      "label",
      "bind",
      "active",
      "inconsistent",
      "use_underline",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  image: {
    class: "Gtk.Image",
    containerType: ContainerType.NONE,
    valid_props: [
      "icon_name",
      "file",
      "resource",
      "pixel_size",
      "icon_size",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  spinner: {
    class: "Gtk.Spinner",
    containerType: ContainerType.NONE,
    valid_props: ["bind", "spinning", ...COMMON_LAYOUT_PROPS],
  },
  scrolledwindow: {
    class: "Gtk.ScrolledWindow",
    containerType: ContainerType.SINGLE,
    valid_props: [
      "hscrollbar_policy",
      "vscrollbar_policy",
      "min_content_width",
      "min_content_height",
      "max_content_width",
      "max_content_height",
      "overlay_scrolling",
      "propagate_natural_width",
      "propagate_natural_height",
      "has_frame",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
  grid: {
    class: "Gtk.Grid",
    containerType: ContainerType.MULTIPLE,
    valid_props: [
      "row_spacing",
      "column_spacing",
      "row_homogeneous",
      "column_homogeneous",
      "baseline_row",
      ...COMMON_LAYOUT_PROPS,
    ],
  },
};

// --- Error Reporting Helpers ---

/**
 * Calculates the precise location of an AST node's opening tag.
 * @param node The AST node, which must have `start` and `end` properties.
 * @param source The full source code string.
 * @returns A Location object covering the opening tag.
 */
function getNodeOpeningTagLocation(node: any): Location {
  console.log(node);
  const end = node.attributes[0]?.start || node.children[0]?.start || node.end;
  const effectiveEnd = end > node.start ? end : node.end;
  return { start: node.start, end: effectiveEnd };
}

// --- Attribute Processing Helpers ---

function process_bind_attribute(
  tag: string,
  var_name: string,
  value_node: any,
): string {
  if (!value_node.expression || value_node.expression.type !== "Identifier") {
    throw new CompilerError(
      "Expected a single state variable identifier in a bind expression.",
      value_node,
    );
  }
  const state_variable_name = value_node.expression.name;
  let handlers = "";

  if (tag === "entry") {
    handlers += `$effect(() => { if (${var_name}.get_text() !== $get(${state_variable_name})) { ${var_name}.set_text($get(${state_variable_name})); } });\n`;
    handlers += `${var_name}.connect('notify::text', () => { if (${var_name}.get_text() !== $get(${state_variable_name})) { $set(${state_variable_name}, ${var_name}.get_text()); } });\n`;
  } else if (tag === "switch" || tag === "checkbutton") {
    handlers += `$effect(() => { if (${var_name}.get_active() !== $get(${state_variable_name})) { ${var_name}.set_active($get(${state_variable_name})); } });\n`;
    handlers += `${var_name}.connect('notify::active', () => { if (${var_name}.get_active() !== $get(${state_variable_name})) { $set(${state_variable_name}, ${var_name}.get_active()); } });\n`;
  } else if (tag === "spinbutton") {
    handlers += `$effect(() => { if (${var_name}.get_value() !== $get(${state_variable_name})) { ${var_name}.set_value($get(${state_variable_name})); } });\n`;
    handlers += `${var_name}.connect('notify::value', () => { if (${var_name}.get_value() !== $get(${state_variable_name})) { $set(${state_variable_name}, ${var_name}.get_value()); } });\n`;
  } else if (tag === "spinner") {
    handlers += `$effect(() => { if (${var_name}.get_spinning() !== $get(${state_variable_name})) { ${var_name}.set_spinning($get(${state_variable_name})); } });\n`;
    handlers += `${var_name}.connect('notify::spinning', () => { if (${var_name}.get_spinning() !== $get(${state_variable_name})) { $set(${state_variable_name}, ${var_name}.get_spinning()); } });\n`;
  }

  return handlers;
}

function process_orientation_attribute(value_node: any): string {
  if (value_node.data === "vertical" || value_node.data === "v")
    return "Gtk.Orientation.VERTICAL";
  if (value_node.data === "horizontal" || value_node.data === "h")
    return "Gtk.Orientation.HORIZONTAL";

  throw new CompilerError(
    `Invalid orientation value: '${value_node.data}'`,
    value_node,
  );
}

function process_align_attribute(value_node: any): string {
  const align_val = value_node.data.toLowerCase();
  switch (align_val) {
    case "fill":
      return "Gtk.Align.FILL";
    case "start":
      return "Gtk.Align.START";
    case "end":
      return "Gtk.Align.END";
    case "center":
      return "Gtk.Align.CENTER";
    default:
      throw new CompilerError(
        `Invalid alignment value: '${value_node.data}'. Expected 'fill', 'start', 'end', or 'center'.`,
        value_node,
      );
  }
}

// --- General Utilities ---
function clear_container_code(container_var: string): string {
  return `let child = ${container_var}.get_first_child();\nwhile (child != null) { ${container_var}.remove(child); child = ${container_var}.get_first_child(); }\n`;
}

function generate_renderer_function(
  state: CompilerState,
  prefix: string,
  nodes: any[],
  parent_param_name: string,
  parent_container_type: ContainerType,
  scope: Set<string>,
  extra_params: string[] = [],
): { name: string; code: string } {
  const renderer_name = generate_var_name(state, prefix);
  const params = [parent_param_name, ...extra_params]
    .filter(Boolean)
    .join(", ");
  const code_block = walk_nodes(
    nodes,
    parent_param_name,
    parent_container_type,
    state,
    scope,
  );
  const function_code = `function ${renderer_name}(${params}) {\n${indentBlock(
    code_block.declarations + code_block.handlers,
  )}\n}\n\n`;
  state.helper_functions += function_code;
  return { name: renderer_name, code: function_code };
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

// --- Node Processors ---
function process_component_node(
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

  let declarations = `const ${instance_name} = ${component_name}({ ${props_string} });\n`;
  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${instance_name}.rootWidget);\n`;
  } else {
    declarations += `${parent_var_name}.append(${instance_name}.rootWidget);\n`;
  }

  return { declarations, handlers: "" };
}

function process_element(
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

  // --- THIS IS THE NEW, SMARTER EVENT HANDLER LOGIC ---
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

        // Check if the expression is already a function-like entity
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

function process_if_block(
  node: any,
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const container_var = generate_var_name(state, "if_container");
  let declarations = `const ${container_var} = new Gtk.Box();\n`;
  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${container_var});\n`;
  } else {
    declarations += `${parent_var_name}.append(${container_var});\n`;
  }
  let if_else_chain = "";
  let current_block: any = node;
  let is_first = true;

  while (current_block) {
    const is_else_block = !current_block.expression && current_block.children;
    const renderer = generate_renderer_function(
      state,
      "if_renderer",
      current_block.children,
      "parent",
      ContainerType.MULTIPLE,
      local_scope,
    );

    if (is_else_block) {
      if_else_chain += ` else {\n    ${renderer.name}(${container_var});\n}`;
      current_block = null;
    } else {
      const condition = transform_expression_ast(
        current_block.expression,
        state.reactive_variables,
        local_scope,
      );
      if (is_first) {
        if_else_chain += `if (${condition}) {\n`;
        is_first = false;
      } else {
        if_else_chain += ` else if (${condition}) {\n`;
      }
      if_else_chain += `    ${renderer.name}(${container_var});\n}`;
      const next_else = current_block.else;
      if (next_else && next_else.children[0]?.type === "IfBlock") {
        current_block = next_else.children[0];
      } else {
        current_block = next_else;
      }
    }
  }

  let handlers = `$effect(() => {\n`;
  handlers += indentBlock(clear_container_code(container_var));
  handlers += `\n${indentBlock(if_else_chain)}\n});\n`;
  return { declarations, handlers };
}

function process_each_block(
  node: any,
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const container_var = generate_var_name(state, "each_container");
  let declarations = `const ${container_var} = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });\n`;
  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${container_var});\n`;
  } else {
    declarations += `${parent_var_name}.append(${container_var});\n`;
  }
  const item_name = node.context.name;
  // --- THIS IS THE FIX FOR THE UNDEFINED INDEX ---
  // If the user doesn't provide an index name, default to a safe one like 'i'.
  const index_name = node.index || "i";
  // --- END FIX ---

  const new_scope = new Set(local_scope);
  new_scope.add(item_name);
  if (node.index) new_scope.add(node.index); // Only add user-provided index to scope

  const renderer = generate_renderer_function(
    state,
    "each_renderer",
    node.children,
    "parent",
    ContainerType.MULTIPLE,
    new_scope,
    [item_name, node.index], // Pass the original index (or null) to renderer params
  );
  const array_expression = transform_expression_ast(
    node.expression,
    state.reactive_variables,
    local_scope,
  );
  let handlers = `$effect(() => {\n`;
  handlers += indentBlock(clear_container_code(container_var));
  handlers += `\n    const current_items = ${array_expression};\n`;

  if (node.else) {
    const else_renderer = generate_renderer_function(
      state,
      "each_else_renderer",
      node.else.children,
      "parent",
      ContainerType.MULTIPLE,
      local_scope,
    );
    handlers += `    if (current_items.length === 0) {\n`;
    handlers += `        ${else_renderer.name}(${container_var});\n`;
    handlers += `    } else {\n`;
  }

  const loop_indent = node.else ? "        " : "    ";
  handlers += `${loop_indent}for (let ${index_name} = 0; ${index_name} < current_items.length; ${index_name}++) {\n`;
  handlers += `${loop_indent}    const ${item_name} = current_items[${index_name}];\n`;
  handlers += `${loop_indent}    ${renderer.name}(${container_var}, ${item_name}, ${index_name});\n`;
  handlers += `${loop_indent}}\n`;
  if (node.else) {
    handlers += `    }\n`;
  }
  handlers += `});\n`;
  return { declarations, handlers };
}

// --- Main Traversal Function ---
function walk_nodes(
  nodes: any[],
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string> = new Set(),
): { declarations: string; handlers: string } {
  let all_declarations = "";
  let all_handlers = "";

  for (const node of nodes) {
    if (!node || (node.type === "Text" && !node.data.trim())) continue;
    let result: { declarations: string; handlers: string } | null = null;

    switch (node.type) {
      case "Element":
        result = process_element(
          node,
          parent_var_name,
          parent_container_type,
          state,
          local_scope,
        );
        break;
      case "InlineComponent":
        result = process_component_node(
          node,
          parent_var_name,
          parent_container_type,
          state,
          local_scope,
        );
        break;
      case "IfBlock":
        result = process_if_block(
          node,
          parent_var_name,
          parent_container_type,
          state,
          local_scope,
        );
        break;
      case "EachBlock":
        result = process_each_block(
          node,
          parent_var_name,
          parent_container_type,
          state,
          local_scope,
        );
        break;
      case "Text":
      case "MustacheTag":
      case "Fragment":
      case "Comment":
        break;
      default:
        throw new CompilerError(
          `Unsupported Svelte syntax node: ${node.type}`,
          node,
        );
    }

    if (result) {
      all_declarations += result.declarations;
      all_handlers += result.handlers;
    }
  }
  return { declarations: all_declarations, handlers: all_handlers };
}

export function walk_html(state: CompilerState) {
  const root_var_name = generate_var_name(state, "box");
  state.root_widget_name = root_var_name;
  state.widget_declarations += `const ${root_var_name} = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12, spacing: 6 });\n`;

  if (state.svelte_ast.html && state.svelte_ast.html.children) {
    const root_code = walk_nodes(
      state.svelte_ast.html.children,
      root_var_name,
      ContainerType.MULTIPLE,
      state,
    );
    state.widget_declarations += root_code.declarations;
    state.effects_and_handlers += root_code.handlers;
  }
}
