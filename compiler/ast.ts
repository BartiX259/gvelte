import { compile } from "svelte/compiler";
import fs from "fs";
import util from "util";

// Get the file path from the command-line arguments.
const filePath = process.argv[2];

if (!filePath) {
  console.error("Please provide a path to a Svelte file.");
  process.exit(1);
}

try {
  const svelte_code = fs.readFileSync(filePath, { encoding: "utf8" });
  const { js, ast } = compile(svelte_code, {});

  console.log("Code:");
  console.log(js.code);
  console.log("\nAst:");
  console.log(util.inspect(ast, false, 9, true));
} catch (error) {
  console.error(`Error reading or compiling file: ${error}`);
  process.exit(1);
}
