<script>
    import { countState } from "../shared/state.js";
</script>

<button
    onclick={() => {
        countState.count++;
        countState.arr = [...countState.arr, countState.count];
    }}
>
    clicks: {countState.count}
</button>

{#each countState.arr as j}
    <label>{j}</label>
{/each}
