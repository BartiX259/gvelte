<script>
    import Gtk from "gi://Gtk";
    import Gdk from "gi://Gdk";
    import GObject from "gi://GObject";
    import MainEntry from "../components/MainEntry.svelte";

    const display = Gdk.Display.get_default();
    const clipboard = display.get_clipboard();
    const theme = Gtk.IconTheme.get_for_display(display);

    // Get all icon names
    const icons = theme.get_icon_names().sort();

    print(`Found ${icons.length} icons`);

    const search = $state("");
    const filtered_icons = $derived(() => {
        if (search != "") {
            return icons
                .filter((name) =>
                    name.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 100);
        } else {
            return [];
        }
    });

    function copyIconName(iconName) {
        const provider = Gdk.ContentProvider.new_for_value(
            new GObject.Value(GObject.TYPE_STRING, iconName),
        );
        clipboard.set_content(provider);
        console.log(`Copied "${iconName}" to clipboard.`);
    }
</script>

<box class="p-2" orientation="v">
    <MainEntry bind={search} placeholder_text="Search for an icon..."
    ></MainEntry>

    <scrolledwindow vexpand={true}>
        <box orientation="v" spacing={4}>
            {#each filtered_icons as icon}
                <button margin_end={16} onclick={() => copyIconName(icon)}>
                    <box>
                        <image pixel_size={48} icon_name={icon}></image>
                        <label halign="start" hexpand={true}>{icon}</label>
                        <image icon_name="edit-copy-symbolic"></image>
                    </box>
                </button>
            {:else}
                <label>No results</label>
            {/each}
        </box>
    </scrolledwindow>
</box>
