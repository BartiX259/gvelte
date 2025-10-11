<script>
    let { bind = $bindable(), placeholder_text } = $props();
</script>

<box>
    <image icon_name="file-search-symbolic"></image>
</box>
<entry {bind} {placeholder_text}></entry>
