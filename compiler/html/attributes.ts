// compiler/html/attribute-processors.ts
import { CompilerError } from "../types.js";

export function process_bind_attribute(
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

export function process_orientation_attribute(value_node: any): string {
  if (value_node.data === "vertical" || value_node.data === "v")
    return "Gtk.Orientation.VERTICAL";
  if (value_node.data === "horizontal" || value_node.data === "h")
    return "Gtk.Orientation.HORIZONTAL";

  throw new CompilerError(
    `Invalid orientation value: '${value_node.data}'`,
    value_node,
  );
}

export function process_align_attribute(value_node: any): string {
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
