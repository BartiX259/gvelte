<script>
    import Child from "../components/Child.svelte";
    let greeting = $state("Hello from App.svelte!");
</script>

<box orientation="v" spacing={6}>
    <label>This is the root component (App.svelte)</label>
    <entry bind={greeting} />
    <Child message={greeting} />
</box>
