// compiler/html/blocks.ts
import { transform_expression_ast } from "../js/transform.js";
import { CompilerState, ContainerType } from "../types.js";
import { generate_var_name, indentBlock } from "../utils.js";
import { walk_nodes } from "./index.js";

// --- Internal Helpers ---

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

// --- Block Processor Exports ---

export function process_if_block(
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

export function process_each_block(
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
  const index_name = node.index || "i";

  const new_scope = new Set(local_scope);
  new_scope.add(item_name);
  if (node.index) new_scope.add(node.index);

  const renderer = generate_renderer_function(
    state,
    "each_renderer",
    node.children,
    "parent",
    ContainerType.MULTIPLE,
    new_scope,
    [item_name, node.index],
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

export function process_render_tag(
  node: any,
  parent_var_name: string,
  parent_container_type: ContainerType,
  state: CompilerState,
  local_scope: Set<string>,
): { declarations: string; handlers: string } {
  const container_var = generate_var_name(state, "render_container");
  let declarations = `const ${container_var} = new Gtk.Box();\n`;

  if (parent_container_type === ContainerType.SINGLE) {
    declarations += `${parent_var_name}.set_child(${container_var});\n`;
  } else {
    declarations += `${parent_var_name}.append(${container_var});\n`;
  }

  const expression_code = transform_expression_ast(
    node.expression,
    state.reactive_variables,
    local_scope,
  );

  let handlers = `$effect(() => {\n`;
  handlers += indentBlock(clear_container_code(container_var));
  handlers += `\n    const rendered_item = ${expression_code};\n`;
  handlers += `    if (rendered_item) {\n`;
  handlers += `        if (rendered_item.rootWidget) {\n`;
  handlers += `            ${container_var}.append(rendered_item.rootWidget);\n`;
  handlers += `        } else {\n`;
  handlers += `            ${container_var}.append(rendered_item);\n`;
  handlers += `        }\n`;
  handlers += `    }\n`;
  handlers += `});\n`;

  return { declarations, handlers };
}
