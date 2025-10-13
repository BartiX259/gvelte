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
