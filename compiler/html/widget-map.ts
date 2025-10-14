// compiler/html/widget-map.ts
import { ContainerType } from "../types.js";

export const ATTRIBUTE_MAP: {
  [key: string]: string;
} = {
  class: "css_classes",
};

// Common layout properties applicable to most GTK widgets.
export const COMMON_LAYOUT_PROPS = [
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

export const WIDGET_MAP: {
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
