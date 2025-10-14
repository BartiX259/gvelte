import { walk } from "estree-walker";
import { transform_expression_ast } from "../js/transform.js";
import { CompilerError, CompilerState } from "../types.js";

// --- Directive Handlers ---

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

// --- Static Prop Transformation Logic ---

function transform_orientation_prop(value_node: any): string {
  const value = value_node.data;
  if (value === "vertical" || value === "v") return "Gtk.Orientation.VERTICAL";
  if (value === "horizontal" || value === "h")
    return "Gtk.Orientation.HORIZONTAL";
  throw new CompilerError(`Invalid orientation value: '${value}'`, value_node);
}

function transform_align_prop(value_node: any): string {
  switch (value_node.data.toLowerCase()) {
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

function transform_css_classes_prop(value_node: any): string {
  if (!value_node || !value_node.data) return "[]";
  const classes = value_node.data.trim().split(/\s+/).filter(Boolean);
  return JSON.stringify(classes);
}

// --- Handler and Transformer Maps ---

const directive_handlers: {
  [key: string]: (tag: string, var_name: string, value_node: any) => string;
} = {
  bind: process_bind_attribute,
};

const prop_transformers = {
  orientation: {
    transform: transform_orientation_prop,
    runtime_fn: "runtime_resolve_orientation",
  },
  halign: {
    transform: transform_align_prop,
    runtime_fn: "runtime_resolve_align",
  },
  valign: {
    transform: transform_align_prop,
    runtime_fn: "runtime_resolve_align",
  },
  css_classes: {
    transform: transform_css_classes_prop,
    runtime_fn: "runtime_resolve_css_classes",
  },
};

// --- Main Dispatcher ---

export function process_attribute(
  attr: any,
  var_name: string,
  tag: string,
  state: CompilerState,
  local_scope: Set<string>,
): { prop_string: string; handler_string: string } {
  const prop_name = attr.name;
  const value_node = attr.value[0];

  // 1. Check for a directive
  if (prop_name in directive_handlers) {
    const handler_string = directive_handlers[prop_name]!(
      tag,
      var_name,
      value_node,
    );
    return { prop_string: "", handler_string };
  }

  // Helper function for reactive analysis
  const check_is_reactive = (expression: any) => {
    let is_reactive = false;
    walk(expression, {
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
    return is_reactive;
  };

  // 2. Check for a prop transformer
  if (prop_name in prop_transformers) {
    const transformer =
      prop_transformers[prop_name as keyof typeof prop_transformers];
    if (!value_node || value_node.type === "Text") {
      const transformed_value = transformer.transform(value_node);
      return {
        prop_string: `${prop_name}: ${transformed_value}, `,
        handler_string: "",
      };
    } else if (value_node.type === "MustacheTag") {
      const expression_code = transform_expression_ast(
        value_node.expression,
        state.reactive_variables,
        local_scope,
      );
      const handler_string = `$effect(() => { ${var_name}.${prop_name} = ${transformer.runtime_fn}(${expression_code}); });\n`;
      return { prop_string: "", handler_string };
    }
  }

  // 3. Handle as a default prop
  if (!value_node) return { prop_string: "", handler_string: "" };

  if (value_node.type === "Text") {
    let value = value_node.data;
    if (value === "true" || value === "false") {
      value = value; // Use as boolean literal
    } else {
      value = JSON.stringify(value); // Wrap in quotes
    }
    return { prop_string: `${prop_name}: ${value}, `, handler_string: "" };
  } else if (value_node.type === "MustacheTag") {
    const is_reactive = check_is_reactive(value_node.expression);
    const transformed_expression = transform_expression_ast(
      value_node.expression,
      state.reactive_variables,
      local_scope,
    );

    if (is_reactive) {
      const handler_string = `$effect(() => { ${var_name}.${prop_name} = ${transformed_expression}; });\n`;
      return { prop_string: "", handler_string };
    } else {
      return {
        prop_string: `${prop_name}: ${transformed_expression}, `,
        handler_string: "",
      };
    }
  }

  return { prop_string: "", handler_string: "" };
}

// NOTE: The compiler should inject these helper functions into the final output.
export const RUNTIME_HELPERS = {
  runtime_resolve_orientation: `function runtime_resolve_orientation(value) {
    if (value === "vertical" || value === "v") return Gtk.Orientation.VERTICAL;
    if (value === "horizontal" || value === "h") return Gtk.Orientation.HORIZONTAL;
    return Gtk.Orientation.HORIZONTAL; // Default
  }`,
  runtime_resolve_align: `function runtime_resolve_align(value) {
    switch (String(value).toLowerCase()) {
      case "fill": return Gtk.Align.FILL;
      case "start": return Gtk.Align.START;
      case "end": return Gtk.Align.END;
      case "center": return Gtk.Align.CENTER;
      default: return Gtk.Align.FILL; // Default
    }
  }`,
  runtime_resolve_css_classes: `function runtime_resolve_css_classes(value) {
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.trim().split(/\\s+/).filter(Boolean);
    }
    return [];
  }`,
};
