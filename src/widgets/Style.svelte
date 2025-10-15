<script>
    let orientation = $state("h");
</script>

<box {orientation}>
    <button
        class="p-2"
        onclick={(orientation = orientation === "h" ? "v" : "h")}
        >Switch orientation</button
    >
    <entry class="test"></entry>
</box>
