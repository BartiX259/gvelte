"use strict";
imports.gi.versions.Gtk = "4.0";
const { Gio, GLib } = imports.gi;

const widgetName = ARGV[0];

if (!widgetName) {
  console.error("Usage: gjs close.js <WidgetName>");
  console.error("Example: gjs close.js App");
  imports.system.exit(1);
}

const SERVICE_NAME = "com.example.SvelteGjsApp";
const OBJECT_PATH = "/com/example/SvelteGjsApp/Launcher";
const INTERFACE_NAME = "com.example.SvelteGjsApp.Launcher";

try {
  const proxy = Gio.DBusProxy.new_for_bus_sync(
    Gio.BusType.SESSION,
    Gio.DBusProxyFlags.NONE,
    null,
    SERVICE_NAME,
    OBJECT_PATH,
    INTERFACE_NAME,
    null,
  );

  console.log(`Sending request to service to close: ${widgetName}`);
  proxy.call_sync(
    "CloseWidget", // The method we want to call
    new GLib.Variant("(s)", [widgetName]), // The widget name argument
    Gio.DBusCallFlags.NONE,
    -1,
    null,
  );
  console.log("Request sent successfully.");
} catch (e) {
  console.error(`Failed to send request to service: ${e.message}`);
  console.error("Is the main service running? (npm run dev)");
  imports.system.exit(1);
}
