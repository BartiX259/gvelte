<script>
    let orientation = $state("h");
</script>

<box {orientation}>
    <button onclick={(orientation = orientation === "h" ? "v" : "h")}
        >Switch orientation</button
    >
    <entry class="test"></entry>
</box>
