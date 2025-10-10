"use strict";
imports.gi.versions.Gtk = "4.0";
const { Gio, GLib } = imports.gi; // <-- Make sure GLib is imported

const widgetName = ARGV[0];

if (!widgetName) {
  console.error("Usage: gjs open.js <WidgetName>");
  console.error("Example: gjs open.js App");
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

  // --- FIX 2: Use the correct `call_sync` method and wrap arguments in GLib.Variant ---
  console.log(`Sending request to service to launch: ${widgetName}`);
  proxy.call_sync(
    "LaunchWidget", // The method name as a string
    new GLib.Variant("(s)", [widgetName]), // The arguments wrapped in a Variant
    Gio.DBusCallFlags.NONE, // Standard flags
    -1, // Default timeout
    null, // No cancellable
  );
  // ---------------------------------------------------------------------------------

  console.log("Request sent successfully.");
} catch (e) {
  console.error(`Failed to send request to service: ${e.message}`);
  console.error("Is the main service running? (gjs dist/main.js)");
  imports.system.exit(1);
}
