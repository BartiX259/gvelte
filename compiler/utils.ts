// compiler/utils.ts
import { codeFrameColumns } from "@babel/code-frame";
import chalk from "chalk";
import { CompilerState, Location } from "./types.js";

/**
 * Indents every line of a multi-line string.
 */
export function indentBlock(code: string, indent = "    "): string {
  return code
    .split("\n")
    .map((line) => (line.trim() ? indent + line : ""))
    .join("\n");
}

/**
 * Generates a unique variable name for a widget tag (e.g., "box_0", "box_1").
 */
export function generate_var_name(state: CompilerState, tag: string): string {
  if (state.counters[tag] === undefined) {
    state.counters[tag] = 0;
  }
  const name = `${tag}_${state.counters[tag]}`;
  state.counters[tag]++;
  return name;
}

/**
 * Converts a character offset in a source string to a line and column number.
 * @param source The full source code string.
 * @param offset The character offset (e.g., node.start).
 * @returns An object with line and column numbers (1-based).
 */
export function get_location_from_offset(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let last_newline_offset = -1;

  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") {
      line++;
      last_newline_offset = i;
    }
  }

  // Column is the offset from the last newline, plus 1 (for 1-based indexing)
  const column = offset - last_newline_offset;
  return { line, column };
}

/**
 * Formats a compiler error into a user-friendly string with a code frame.
 * Now accepts a Location object instead of the full AST node.
 */
export function format_compiler_error(
  tag: string,
  message: string,
  source: string,
  location?: Location,
): string {
  let final_message = `${chalk.red.bold(tag)} ${chalk.white(message)}\n`;

  if (location && location.start !== undefined && source) {
    const loc_info = {
      start: get_location_from_offset(source, location.start),
      end: get_location_from_offset(source, location.end),
    };
    const frame = codeFrameColumns(source, loc_info, { highlightCode: true });
    final_message += `\n${frame}\n`;
  }

  return final_message;
}

export function format_generic_error(tag: string, message: string): string {
  return `${chalk.red.bold(tag)} ${message}`;
}
export function format_compiler_success(out: string): string {
  return `${chalk.green.bold("[Success]")} Compilation successful. Output written to ${chalk.bold(out)}.`;
}
