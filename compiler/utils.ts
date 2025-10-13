// compiler/utils.ts
import { codeFrameColumns } from "@babel/code-frame";
import chalk from "chalk";
import fs from "fs";
import path from "path";
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

  const column = offset - last_newline_offset;
  return { line, column };
}

/**
 * Formats a compiler error into a user-friendly string with a code frame.
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

/**
 * Recursively finds all files with a given extension in a directory.
 */
export function find_files_by_ext(start_path: string, ext: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(start_path)) return [];
  const files = fs.readdirSync(start_path);
  for (const file of files) {
    const filepath = path.join(start_path, file);
    const stat = fs.lstatSync(filepath);
    if (stat.isDirectory())
      results = results.concat(find_files_by_ext(filepath, ext));
    else if (filepath.endsWith(ext)) results.push(filepath);
  }
  return results;
}

/**
 * Converts a source file path into a GJS-compatible module name.
 */
export function mangle_filepath(filepath: string, src_dir: string): string {
  const relative_path = path.relative(src_dir, filepath);
  return relative_path.replace(/\.[^/.]+$/, "").replace(/[\/\-\.]/g, "_");
}
