<script>
    let {
        bind = $bindable(),
        placeholder_text = "Search...",
        icon_name = "edit-find-symbolic",
        icon_position = Gtk.EntryIconPosition.PRIMARY,
        keybind = "<Ctrl>F",
    } = $props();

    let entry_widget = null;

    let create_entry = () => {
        // Create the entry widget
        let entry = new Gtk.Entry({
            placeholder_text,
            hexpand: true,
        });

        // Add icon to the entry
        entry.set_icon_from_icon_name(icon_position, icon_name);

        // Optional: Make icon activatable and handle clicks
        entry.set_icon_activatable(icon_position, true);
        entry.connect("icon-press", (entry, icon_pos) => {
            console.log("Icon clicked!");
            entry.grab_focus();
        });

        // Bind the text property if bind is provided
        $effect(() => {
            if (entry.get_text() !== bind) {
                entry.set_text(bind);
            }
        });
        entry.connect("notify::text", () => {
            if (entry.get_text() !== bind) {
                bind = entry.get_text();
            }
        });
        // Store reference for keybind
        entry_widget = entry;

        return entry;
    };

    // Setup keybind to focus the entry (GTK4 style)
    let setup_keybind = (widget) => {
        // Get the root (toplevel window in GTK4)
        let root = widget.get_root();

        if (root && root instanceof Gtk.Window) {
            // Parse the keybind
            let [success, key, mods] = Gtk.accelerator_parse(keybind);

            if (success) {
                // Create a shortcut controller
                let controller = new Gtk.ShortcutController();

                // Create the shortcut
                let shortcut = new Gtk.Shortcut({
                    trigger: Gtk.ShortcutTrigger.parse_string(keybind),
                    action: Gtk.CallbackAction.new(() => {
                        if (entry_widget) {
                            entry_widget.grab_focus();
                        }
                        return true;
                    }),
                });

                controller.add_shortcut(shortcut);
                root.add_controller(controller);
            }
        }
    };

    let container_box = () => {
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
        });

        let entry = create_entry();
        box.append(entry); // GTK4 uses append instead of pack_start

        // Setup keybind once the widget is realized
        box.connect("realize", () => {
            setup_keybind(box);
        });

        return box;
    };
</script>

<box>
    {@render container_box()}
</box>
