// compiler/html-transformer.ts
import { CompilerError, CompilerState } from "./types.js";
import { generate_var_name, indentBlock } from "./utils.js";
import { transform_expression_ast } from "./js-transformer.js";
import { walk } from "estree-walker";
import { generate } from "astring";

// --- Centralized Configuration ---
const WIDGET_MAP: {
  [key: string]: { class: string; isContainer: boolean; valid_props: string[] };
} = {
  box: {
    class: "Gtk.Box",
    isContainer: true,
    valid_props: ["orientation", "spacing"],
  },
  label: { class: "Gtk.Label", isContainer: false, valid_props: ["label"] },
  button: { class: "Gtk.Button", isContainer: false, valid_props: ["label"] },
  entry: { class: "Gtk.Entry", isContainer: false, valid_props: ["bind"] },
  switch: { class: "Gtk.Switch", isContainer: false, valid_props: ["bind"] },
  spinbutton: {
    class: "Gtk.SpinButton",
    isContainer: false,
    valid_props: ["bind"],
  },
  checkbutton: {
    class: "Gtk.CheckButton",
    isContainer: false,
    valid_props: ["label", "bind"],
  },
  image: {
    class: "Gtk.Image",
    isContainer: false,
    valid_props: ["icon_name", "file", "pixel_size"],
  },
  spinner: { class: "Gtk.Spinner", isContainer: false, valid_props: ["bind"] },
  scrolledwindow: {
    class: "Gtk.ScrolledWindow",
    isContainer: true,
    valid_props: [],
  },
  grid: {
    class: "Gtk.Grid",
    isContainer: true,
    valid_props: ["row_spacing", "column_spacing"],
  },
};

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

// --- General Utilities ---
function clear_container_code(container_var: string): string {
  return `let child = ${container_var}.get_first_child();\nwhile (child != null) { ${container_var}.remove(child); child = ${container_var}.get_first_child(); }\n`;
}

function generate_renderer_function(
  state: CompilerState,
  prefix: string,
  nodes: any[],
  parent_param_name: string,
  scope: Set<string>,
  extra_params: string[] = [],
): { name: string; code: string } {
  const renderer_name = generate_var_name(state, prefix);
  const params = [parent_param_name, ...extra_params].join(", ");
  const code_block = walk_nodes(nodes, parent_param_name, state, scope);
  const function_code = `function ${renderer_name}(${params}) {\n${indentBlock(code_block.declarations + code_block.handlers)}\n}\n\n`;
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
      if (child.type === "Text") return child.data;
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
      props_string += `${prop_name}: $state(${JSON.stringify(value_node.data)}), `;
    } else if (value_node.type === "MustacheTag") {
      const expression_code = generate(value_node.expression);
      props_string += `${prop_name}: ${expression_code}, `;
    }
  }

  let declarations = `const ${instance_name} = ${component_name}({ ${props_string} });\n`;
  declarations += `${parent_var_name}.append(${instance_name}.rootWidget);\n`;

  return { declarations, handlers: "" };
}

function process_element(
  node: any,
  parent_var_name: string,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  let declarations = "";
  let handlers = "";
  const tag = node.name;
  const widget_info = WIDGET_MAP[tag];
  if (!widget_info)
    throw new CompilerError(`Unsupported GTK tag: <${tag}>`, node);

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
        default:
          if (!value_node) continue;
          let final_value;
          if (value_node.type === "Text") {
            final_value = JSON.stringify(value_node.data);
          } else if (
            value_node.type === "MustacheTag" &&
            value_node.expression.type === "Literal"
          ) {
            final_value = value_node.expression.raw;
          } else {
            continue;
          }
          props_string += `${prop_name}: ${final_value}, `;
          break;
      }
    } else {
      throw new CompilerError(
        `Unsupported attribute '${prop_name}' for <${tag}>`,
        attr,
      );
    }
  }

  declarations += `const ${var_name} = new ${widget_info.class}({ ${props_string} });\n`;
  declarations += `${parent_var_name}.append(${var_name});\n`;

  if (node.children && node.children.length > 0) {
    if (widget_info.isContainer) {
      const children_code = walk_nodes(
        node.children,
        var_name,
        state,
        local_scope,
      );
      declarations += children_code.declarations;
      handlers += children_code.handlers;
    } else {
      if (node.children.some((c: any) => c.type === "Element")) {
        throw new CompilerError(`<${tag}> cannot have element children.`, node);
      }
      const { template_string, is_reactive } =
        process_text_and_mustache_children(node.children, state, local_scope);
      if (template_string) {
        if (is_reactive) {
          handlers += `$effect(() => { ${var_name}.set_label(\`${template_string}\`); });\n`;
        } else {
          declarations += `${var_name}.set_label(\`${template_string}\`);\n`;
        }
      }
    }
  }

  for (const attr of node.attributes) {
    if (attr.type === "Attribute" && attr.name.startsWith("on")) {
      const expression = attr.value[0]?.expression;
      if (expression) {
        const event_name = attr.name.substring(2);
        const gjs_event_name = event_name === "click" ? "clicked" : event_name;
        const handler_code = transform_expression_ast(
          expression,
          state.reactive_variables,
          local_scope,
        );
        handlers += `${var_name}.connect('${gjs_event_name}', ${handler_code});\n`;
      }
    }
  }

  return { declarations, handlers };
}

function process_if_block(
  node: any,
  parent_var_name: string,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const container_var = generate_var_name(state, "if_container");
  let declarations = `const ${container_var} = new Gtk.Box();\n`;
  declarations += `${parent_var_name}.append(${container_var});\n`;
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
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const container_var = generate_var_name(state, "each_container");
  let declarations = `const ${container_var} = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });\n`;
  declarations += `${parent_var_name}.append(${container_var});\n`;
  const item_name = node.context.name;
  const index_name = node.index;
  const new_scope = new Set(local_scope);
  new_scope.add(item_name);
  if (index_name) new_scope.add(index_name);

  const renderer = generate_renderer_function(
    state,
    "each_renderer",
    node.children,
    "parent",
    new_scope,
    [item_name, index_name],
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
        result = process_element(node, parent_var_name, state, local_scope);
        break;
      case "InlineComponent":
        result = process_component_node(
          node,
          parent_var_name,
          state,
          local_scope,
        );
        break;
      case "IfBlock":
        result = process_if_block(node, parent_var_name, state, local_scope);
        break;
      case "EachBlock":
        result = process_each_block(node, parent_var_name, state, local_scope);
        break;
      case "Text":
      case "MustacheTag":
      case "Fragment":
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
      state,
    );
    state.widget_declarations += root_code.declarations;
    state.effects_and_handlers += root_code.handlers;
  }
}
