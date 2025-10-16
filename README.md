# gvelte

A work-in-progress Svelte to GTK4 (GJS) compiler.

## About

`gvelte` lets you write GTK4 applications using Svelte syntax. It uses a custom compiler to transform Svelte components into GJS code that natively interacts with the GTK library.

## Usage

### GTK Tags

The compiler maps lowercase tags directly to GTK widgets. The goal is to provide a familiar, HTML-like experience for building native UIs.

```svelte
<!-- This creates a Gtk.Box with a Gtk.Label and a Gtk.Entry -->
<box orientation="v" spacing={12}>
    <label>Enter your name:</label>
    <entry bind={name} />
</box>
```

### State Management

State management follows the Svelte 5 "Runes" paradigm. Use `$state` for reactive state. For a complete guide on Svelte's reactivity model, refer to the official [Svelte 5 Docs](https://svelte.dev/docs/svelte/what-are-runes).

```svelte
<script>
    let name = $state("World");
</script>

<label>Hello, {name}!</label>
```

### Component Model

Create reusable components and place them in the `src/components/` directory. Top-level, runnable widgets should be placed in `src/widgets/`. Props are passed using the `$props()` rune.

```svelte
<!-- src/widgets/App.svelte -->
<script>
    import MyComponent from '../components/MyComponent.svelte';
    let greeting = $state("Hello");
</script>

<MyComponent message={greeting} />
```

```svelte
<!-- src/components/MyComponent.svelte -->
<script>
    let { message = "Default message" } = $props();
</script>

<label>{message}</label>
```

### Styling

To style your components, use tailwindcss classes. It's recommended to use the colors from the gtk theme, which can be found in `src/index.css`.

```svelte
<label class="text-warning bg-selected-bg p-2 mb-4">Warning</label>
```

## Installation

1. Install system dependencies

You will need `gjs` and `npm` to build and run this project.

-   **On Arch Linux:**
    ```bash
    sudo pacman -S gjs npm
    ```

-   **On Debian / Ubuntu:**
    ```bash
    sudo apt update
    sudo apt install gjs npm
    ```

-   **On Fedora:**
    ```bash
    sudo dnf install gjs npm
    ```

-   **On macOS:**
    ```bash
    brew install gjs npm
    ```

2. Clone this repo

```bash
git clone https://github.com/BartiX259/gvelte.git
```

3. Install npm dependencies

```bash
cd gvelte
npm install
```

4. Start the development server

```bash
npm run dev
```

You can create and edit widgets and components in the `src` directory and launch them with `npm run open <widget>`.

## Commands

All commands should be run from the project root.

-   **`npm run dev`**\
    Starts the development server. This will watch for all file changes in `src/` and `compiler/`, automatically rebuild the necessary parts, and restart the GJS service with hot-reloading.

-   **`npm run open <widget>`**\
    Triggers the running service to open a window for the specified widget. For example, `npm run open App` will open `src/widgets/App.svelte`.

-   **`npm run close <widget>`**\
    Triggers the running service to close a specific open window.

-   **`npm run start`**\
    Starts the GJS service, uses less resources than `npm run dev` but you don't get hot-reloading.

-   **`npm run build`**\
    Manually builds the `gvelte` compiler.

-   **`npm run compile`**\
    Manually compiles the Svelte source, creating the final GJS files in the `dist/` directory.
