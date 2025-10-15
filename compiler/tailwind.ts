import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";

const INPUT_CSS_PATH = path.resolve(process.cwd(), "src/index.css");
const OUTPUT_CSS_PATH = path.resolve(process.cwd(), "dist/index.css");
const TAILWIND_CLI = "npx tailwindcss";
const BASE_FONT_SIZE_PX = 16;

const GTK_VALID_PROPERTIES = new Set([
  "color",
  "background-color",
  "background-image",
  "border-color",
  "border-width",
  "border-radius",
  "border-style",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-decoration-line",
  "text-shadow",
  "box-shadow",
  "opacity",
  "min-height",
  "min-width",
]);

function parseCssVariables(css: string): Map<string, string> {
  const variables = new Map<string, string>();
  const rootBlockMatch = css.match(/:root\s*\{([^}]+)\}/);
  if (rootBlockMatch && rootBlockMatch[1]) {
    const rootBlock = rootBlockMatch[1];
    const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let match;
    while ((match = varRegex.exec(rootBlock)) !== null) {
      if (match[1] && match[2]) {
        variables.set(match[1].trim(), match[2].trim());
      }
    }
  }
  return variables;
}

function resolveVar(value: string, variables: Map<string, string>): string {
  const varRegex = /var\((--[\w-]+)\)/g;
  return value.replace(varRegex, (match, varName) => {
    const resolvedValue = variables.get(varName);
    if (resolvedValue) {
      return resolveVar(resolvedValue, variables);
    }
    console.warn(chalk.yellow(`Warning: CSS variable ${varName} not found.`));
    return match;
  });
}

function evaluateCalc(value: string): string {
  if (value.endsWith("rem")) {
    const remValue = parseFloat(value);
    if (!isNaN(remValue)) {
      return (remValue * BASE_FONT_SIZE_PX).toString();
    }
  }

  const calcRegex = /calc\(([^)]+)\)/;
  const match = value.match(calcRegex);

  if (!match || !match[1]) return value;

  const expression = match[1];
  const resolvedExpression = expression.replace(
    /(\d*\.?\d+)rem/g,
    (_match, remVal) => {
      return (parseFloat(remVal) * BASE_FONT_SIZE_PX).toString();
    },
  );

  const parts = resolvedExpression.split("*").map((p) => p.trim());

  if (parts.length === 2 && parts[0] && parts[1]) {
    const num1 = parseFloat(parts[0]);
    const num2 = parseFloat(parts[1]);
    if (!isNaN(num1) && !isNaN(num2)) {
      return (num1 * num2).toString();
    }
  }

  console.warn(
    chalk.yellow(`Warning: Could not evaluate complex calc(): ${value}`),
  );
  return "0";
}

/**
 * Takes the raw Tailwind CSS output and processes it for GTK compatibility.
 */
function processForGtk(rawCss: string): string {
  console.log("Processing CSS for GTK compatibility...");

  const variables = parseCssVariables(rawCss);
  if (!variables.has("--spacing")) {
    variables.set("--spacing", "0.25rem");
  }

  // --- START: NEW, PRECISE EXTRACTION LOGIC ---

  // 1. Extract the content of the `@layer utilities` block.
  // The ((?:.|\n)*?) part is a robust way to match multi-line content.
  const utilitiesRegex = /@layer utilities\s*\{((?:.|\n)*?)\}/;
  const utilitiesMatch = rawCss.match(utilitiesRegex);
  const utilitiesContent =
    utilitiesMatch && utilitiesMatch[1] ? utilitiesMatch[1].trim() : "";

  // 2. Extract custom CSS located *between* the end of the utilities block
  //    and the next `@` rule (like `@property`).
  let customCss = "";
  if (utilitiesMatch && utilitiesMatch.index !== undefined) {
    const endOfUtilitiesIndex = utilitiesMatch.index + utilitiesMatch[0].length;
    const nextAtSymbolIndex = rawCss.indexOf("@", endOfUtilitiesIndex);

    // If another '@' is found, slice up to it. Otherwise, take the rest of the string.
    const sliceEnd = nextAtSymbolIndex > -1 ? nextAtSymbolIndex : undefined;
    customCss = rawCss.substring(endOfUtilitiesIndex, sliceEnd).trim();
  }

  // 3. Combine ONLY the two parts we care about. This discards all other layers.
  const cssToProcess = `${utilitiesContent}\n${customCss}`;

  // --- END: NEW, PRECISE EXTRACTION LOGIC ---

  let processedCss = "";
  const ruleRegex = /([^{}]+)\s*\{([^}]+)\}/g;
  let ruleMatch;
  while ((ruleMatch = ruleRegex.exec(cssToProcess)) !== null) {
    const fullSelector = ruleMatch[1]?.trim();
    const properties = ruleMatch[2];

    if (!fullSelector || fullSelector.startsWith("@") || !properties) continue;

    const validProperties: string[] = [];

    properties
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((propString) => {
        const [prop, ...valueParts] = propString.split(":");
        if (!prop || valueParts.length === 0) return;

        const cssProp = prop.trim();
        let cssValue = valueParts.join(":").trim();

        if (GTK_VALID_PROPERTIES.has(cssProp)) {
          cssValue = resolveVar(cssValue, variables);
          cssValue = evaluateCalc(cssValue);

          const numericValue = parseFloat(cssValue);
          if (!isNaN(numericValue) && cssValue.match(/^[\d.-]+$/)) {
            cssValue = `${numericValue}px`;
          }

          validProperties.push(`  ${cssProp}: ${cssValue};`);
        }
      });

    if (validProperties.length > 0) {
      processedCss += `${fullSelector} {\n${validProperties.join("\n")}\n}\n\n`;
    }
  }

  console.log(chalk.green("CSS processing complete."));
  return processedCss;
}

/**
 * Main build function.
 */
export function buildTailwindCss() {
  console.log(chalk.cyan("Starting Tailwind CSS build..."));

  try {
    const command = `${TAILWIND_CLI} -i "${INPUT_CSS_PATH}" -o "${OUTPUT_CSS_PATH}"`;
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: "inherit" });
    console.log(chalk.green("Tailwind CLI finished successfully."));

    const rawCss = fs.readFileSync(OUTPUT_CSS_PATH, "utf-8");
    const gtkCss = processForGtk(rawCss);
    fs.writeFileSync(OUTPUT_CSS_PATH, gtkCss);

    console.log(
      chalk.bold.green(
        `✅ Successfully built and processed GTK stylesheet to ${OUTPUT_CSS_PATH}`,
      ),
    );
    return true;
  } catch (error) {
    console.error(chalk.red.bold("\n❌ Failed to build Tailwind CSS."));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    return false;
  }
}

// ES Module equivalent of `require.main === module`
const currentFilePath = fileURLToPath(import.meta.url);
const mainScriptPath = process.argv[1];

if (currentFilePath === mainScriptPath) {
  buildTailwindCss();
}
