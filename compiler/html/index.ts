// compiler/html/index.ts
import { CompilerState, ContainerType, CompilerError } from "../types.js";
import { generate_var_name } from "../utils.js";
import {
  process_each_block,
  process_if_block,
  process_render_tag,
} from "./blocks.js";
import { process_component_node, process_element } from "./elements.js";

// Main Traversal Function
export function walk_nodes(
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
      case "RenderTag":
        result = process_render_tag(
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
        // These are handled inside their parent node processors (e.g. process_element)
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

// Public API for the HTML Transformation Phase
export function walk_html(state: CompilerState) {
  if (!state.svelte_ast.html || !state.svelte_ast.html.children) {
    return;
  }

  // Filter out whitespace-only text nodes to find the real root elements
  const top_level_nodes = state.svelte_ast.html.children.filter(
    (n: any) => !(n.type === "Text" && !n.data.trim()),
  );

  if (top_level_nodes.length === 1) {
    // --- CASE 1: A single element is the root ---
    const root_node = top_level_nodes[0];
    // A single root that is a dynamic block (like {#if}) must be wrapped.
    if (root_node.type !== "Element" && root_node.type !== "InlineComponent") {
      const wrapper_box = generate_var_name(state, "root_box");
      state.root_widget_name = wrapper_box;
      state.widget_declarations += `const ${wrapper_box} = new Gtk.Box();\n`;
      const root_code = walk_nodes(
        top_level_nodes,
        wrapper_box,
        ContainerType.MULTIPLE,
        state,
      );
      state.widget_declarations += root_code.declarations;
      state.effects_and_handlers += root_code.handlers;
    } else {
      // This single element becomes the component's root widget.
      // We set a temporary root name and process it without a parent.
      state.root_widget_name = generate_var_name(
        state,
        root_node.name || "root",
      );
      state.counters[root_node.name || "root"]!--;
      const root_code = walk_nodes(
        top_level_nodes,
        "" /* no parent */,
        ContainerType.NONE,
        state,
      );
      state.widget_declarations += root_code.declarations;
      state.effects_and_handlers += root_code.handlers;
    }
  } else {
    // --- CASE 2: Multiple elements get a simple wrapper box ---
    const root_var_name = generate_var_name(state, "root_box");
    state.root_widget_name = root_var_name;
    // Note: No margins or other styling, just a basic vertical container.
    state.widget_declarations += `const ${root_var_name} = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });\n`;
    const root_code = walk_nodes(
      top_level_nodes,
      root_var_name,
      ContainerType.MULTIPLE,
      state,
    );
    state.widget_declarations += root_code.declarations;
    state.effects_and_handlers += root_code.handlers;
  }
}
