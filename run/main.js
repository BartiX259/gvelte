"use strict";
imports.gi.versions.Gtk = "4.0";
const { Gtk, Gio, GLib } = imports.gi;

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
      const { [mangledName]: Widget } = imports[mangledName];
      const window = new Gtk.Window({
        title: widgetName,
        default_width: 350,
        default_height: 220,
      });

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

      const { rootWidget } = Widget({});
      window.set_child(rootWidget);
      window.present();
    } catch (e) {
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
