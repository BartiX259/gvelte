<script>
    let orientation = $state("h");
</script>

<box {orientation}>
    <button
        class={`p-2 bg-selected-bg ${orientation === "h" ? "mr-2" : "mb-2"}`}
        onclick={(orientation = orientation === "h" ? "v" : "h")}
    >
        <label class="text-warning">Switch orientation</label></button
    >
    <entry hexpand={true}></entry>
</box>
