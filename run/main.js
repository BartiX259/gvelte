"use strict";
imports.gi.versions.Gtk = "4.0";
imports.gi.versions.Gtk4LayerShell = "1.0";
const { Gtk, Gdk, Gio, GLib, Gtk4LayerShell } = imports.gi;

const RUN_DIR = GLib.path_get_dirname(imports.system.programInvocationName);
const DIST_DIR = GLib.build_filenamev([RUN_DIR, "../dist"]);
imports.searchPath.unshift(RUN_DIR);
imports.searchPath.unshift(DIST_DIR);

const PROJECT_ROOT = GLib.path_get_dirname(RUN_DIR);
const TMP_DIR = GLib.build_filenamev([PROJECT_ROOT, ".tmp"]);
const SESSION_STATE_FILE = GLib.build_filenamev([TMP_DIR, ".session.json"]);

const DBUS_INTERFACE = `
<node>
    <interface name="com.example.SvelteGjsApp.Launcher">
        <method name="LaunchWidget">
            <arg type="s" name="widget_name" direction="in"/>
        </method>
        <method name="CloseWidget">
            <arg type="s" name="widget_name" direction="in"/>
        </method>
    </interface>
</node>`;

class Launcher {
  constructor() {
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE, this);
    this._openWindows = new Map();
  }

  _saveSessionState() {
    const openWidgetNames = Array.from(this._openWindows.keys());
    const stateJson = JSON.stringify(openWidgetNames, null, 2);
    try {
      if (!GLib.file_test(TMP_DIR, GLib.FileTest.IS_DIR)) {
        GLib.mkdir_with_parents(TMP_DIR, 0o755);
      }
      const file = Gio.File.new_for_path(SESSION_STATE_FILE);
      const contentsAsBytes = new TextEncoder().encode(stateJson);
      file.replace_contents(
        contentsAsBytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
      );
      console.log(
        `Session state saved with windows: [${openWidgetNames.join(", ")}]`,
      );
    } catch (e) {
      console.error(
        `[SAVE] FATAL: Failed to save session state. Error: ${e.message}`,
      );
    }
  }

  _loadAndRestoreSessionState() {
    if (!GLib.file_test(SESSION_STATE_FILE, GLib.FileTest.EXISTS)) return;
    try {
      const [ok, contents] = GLib.file_get_contents(SESSION_STATE_FILE);
      if (ok) {
        const openWidgetNames = JSON.parse(new TextDecoder().decode(contents));
        if (Array.isArray(openWidgetNames) && openWidgetNames.length > 0) {
          console.log(
            "[RESTORE] Found session file. Restoring windows:",
            openWidgetNames,
          );
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            openWidgetNames.forEach((name) => this.LaunchWidget(name));
            return GLib.SOURCE_REMOVE;
          });
        }
      }
    } catch (e) {
      console.error(
        `[RESTORE] FATAL: Failed to parse session file. Error: ${e.message}`,
      );
    }
  }

  LaunchWidget(widgetName) {
    if (this._openWindows.has(widgetName)) {
      this._openWindows.get(widgetName).present();
      return;
    }
    try {
      const mangledName = `widgets_${widgetName}`;
      console.log(1);
      console.log(mangledName);
      const { [mangledName]: Widget } = imports[mangledName];
      console.log(2);
      const { rootWidget } = Widget({});
      let window;
      // Fallback: If it's a regular widget, create a default window for it.
      if (rootWidget instanceof Gtk.Window) {
        window = rootWidget;
        if (!window.get_title()) {
          window.set_title(widgetName);
        }
      } else {
        // Fallback: If it's a regular widget, create a default window for it.
        window = new Gtk.Window({
          title: widgetName,
          default_width: 350,
          default_height: 220,
        });
        window.set_child(rootWidget);
      }

      this._openWindows.set(widgetName, window);
      this._saveSessionState();

      window.connect("close-request", () => {
        console.log(
          `Manual close request for "${widgetName}". Updating state.`,
        );
        this._openWindows.delete(widgetName);
        this._saveSessionState();

        return false;
      });

      window.present();
    } catch (e) {
      console.error(e);
      console.error(`Error launching widget "${widgetName}": ${e.message}`);
    }
  }

  CloseWidget(widgetName) {
    if (this._openWindows.has(widgetName)) {
      const windowToClose = this._openWindows.get(widgetName);
      this._openWindows.delete(widgetName);

      windowToClose.close();

      // We save state here for immediate feedback, though the signal handler would also catch it.
      this._saveSessionState();
      console.log(`Close signal sent and state updated for "${widgetName}".`);
    } else {
      console.warn(`No open window found for widget name "${widgetName}".`);
    }
  }

  export(bus) {
    this._dbusImpl.export(bus, "/com/example/SvelteGjsApp/Launcher");
  }
  unexport() {
    this._dbusImpl.unexport();
  }
}

const app = new Gtk.Application({
  application_id: "com.example.SvelteGjsApp",
  flags: Gio.ApplicationFlags.IS_SERVICE | Gio.ApplicationFlags.HANDLES_OPEN,
});

let launcher;

app.connect("startup", () => {
  try {
    const provider = new Gtk.CssProvider();
    const css_path = GLib.build_filenamev([DIST_DIR, "index.css"]);
    if (GLib.file_test(css_path, GLib.FileTest.EXISTS)) {
      provider.load_from_path(css_path);
      Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
      );
      console.log("Global stylesheet loaded successfully.");
    } else {
      console.warn(`No global stylesheet (${css_path}) found.`);
    }
  } catch (e) {
    console.error(`Failed to load global stylesheet: ${e.message}`);
  }
  app.hold();
  launcher = new Launcher();
  launcher.export(Gio.DBus.session);
  launcher._loadAndRestoreSessionState();
  console.log("Svelte-GJS Service is running and listening for requests.");
});

app.connect("shutdown", () => {
  if (launcher) launcher.unexport();
  console.log("Service has shut down cleanly.");
});

app.run(null);
