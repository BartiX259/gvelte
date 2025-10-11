<script>
    import Child from "../components/Child.svelte";
    import { countState } from "../shared/state.js";
    let greeting = $state("Hello from App.svelte!");
</script>

<box orientation="v" spacing={6}>
    <label>This is the root component (App.svelte)</label>
    <image icon_name="start-here-fedora"></image>
    <entry bind={greeting} />
    <Child message={greeting} />
    <label>PARENT:</label>
    <label>Count is {countState.count}</label>
    <button onclick={() => countState.count++}>Increase</button>
</box>
