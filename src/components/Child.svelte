<script>
    let { message = "...", children } = $props();
</script>

<label>Child says: {message}</label>
{@render children()}
