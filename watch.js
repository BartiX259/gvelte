import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";

const SRC_DIR = "./src";
const COMPILER_DIR = "./compiler";
let gjsProcess = null;

// --- Helper Functions to Run Build Steps ---

function runBuild() {
  console.log("\n rebuilding compiler (tsc)...");
  try {
    execSync("npm run build", { stdio: "inherit" });
    console.log(" compiler build successful.");
    return true;
  } catch (error) {
    console.error(" compiler build failed.");
    return false;
  }
}

function runCompile() {
  console.log(" compiling app (svelte -> gjs)...");
  try {
    execSync("npm run compile", { stdio: "inherit" });
    console.log(" app compilation successful.");
    return true;
  } catch (error) {
    console.error(" app compilation failed.");
    return false;
  }
}

// --- GJS Service Management ---

function spawnGjsService() {
  gjsProcess = spawn("npm", ["run", "start"], {
    stdio: "inherit",
  });

  gjsProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.log(` GJS service process exited unexpectedly with code ${code}`);
    }
    gjsProcess = null;
  });
}

function restartGjsService() {
  if (gjsProcess) {
    console.log(" restarting service...");
    gjsProcess.once("close", () => {
      console.log(" old service stopped. starting new one...");
      spawnGjsService();
    });
    gjsProcess.kill();
  } else {
    console.log(" starting service...");
    spawnGjsService();
  }
}

// --- Main Execution ---

// Initial full build and start
if (runBuild() && runCompile()) {
  restartGjsService();
}

// --- Watcher for Application Source (`src/`) ---
const srcWatcher = chokidar.watch(path.resolve(SRC_DIR), {
  ignored: /(^|[\/\\])\../,
  persistent: true,
});

srcWatcher.on("change", (filePath) => {
  console.log(`\n app source changed: ${path.basename(filePath)}`);
  // If app source changes, we only need to re-run the svelte compiler
  if (runCompile()) {
    restartGjsService();
  }
});

// --- Watcher for Compiler Source (`compiler/**/*.ts`) ---
const compilerWatcher = chokidar.watch(path.resolve(COMPILER_DIR), {
  ignored: /(^|[\/\\])\..|compiler\/dist/, // Ignore dotfiles and the compiler's own output
  persistent: true,
});

compilerWatcher.on("change", (filePath) => {
  console.log(`\n compiler source changed: ${path.basename(filePath)}`);
  // If compiler source changes, we must run the full chain:
  // 1. Rebuild the compiler itself (TypeScript)
  // 2. Re-run the new compiler to build the app (Svelte)
  if (runBuild() && runCompile()) {
    restartGjsService();
  }
});

console.log(` watching for changes in ${SRC_DIR} and ${COMPILER_DIR}...`);
