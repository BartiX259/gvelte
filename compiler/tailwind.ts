import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { parse, converter } from "culori";

const INPUT_CSS_PATH = path.resolve(process.cwd(), "src/index.css");
const RAW_OUTPUT_CSS_PATH = path.resolve(
  process.cwd(),
  "dist/tailwind_out.css",
);
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

const toRgb = converter("rgb");

// --- START: NEW, ROBUST PARSING LOGIC ---
/**
 * Parses CSS variables using string manipulation for reliability.
 */
function parseCssVariables(css: string): Map<string, string> {
  const variables = new Map<string, string>();

  // 1. Find the @layer theme block.
  const themeLayerStartIndex = css.indexOf("@layer theme");
  if (themeLayerStartIndex === -1) {
    console.warn(
      chalk.yellow("Warning: Could not find @layer theme in CSS output."),
    );
    return variables;
  }

  const themeLayerOpeningBrace = css.indexOf("{", themeLayerStartIndex);
  if (themeLayerOpeningBrace === -1) return variables;

  // 2. Find the :root selector within the theme layer.
  const rootSelectorIndex = css.indexOf(":root", themeLayerOpeningBrace);
  if (rootSelectorIndex === -1) {
    console.warn(
      chalk.yellow("Warning: Could not find :root block within @layer theme."),
    );
    return variables;
  }

  // 3. Find the opening brace for the :root block.
  const rootOpeningBrace = css.indexOf("{", rootSelectorIndex);
  if (rootOpeningBrace === -1) return variables;

  // 4. Find the matching closing brace. For this file structure, a simple search is sufficient.
  const rootClosingBrace = css.indexOf("}", rootOpeningBrace);
  if (rootClosingBrace === -1) return variables;

  // 5. Extract the content of the :root block.
  const rootBlock = css.substring(rootOpeningBrace + 1, rootClosingBrace);

  // 6. Parse the variables from the extracted content.
  const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varRegex.exec(rootBlock)) !== null) {
    if (match[1] && match[2]) {
      variables.set(match[1].trim(), match[2].trim());
    }
  }

  return variables;
}
// --- END: NEW, ROBUST PARSING LOGIC ---

/**
 * Iteratively resolves CSS variables (`var(...)`) in a string until none are left.
 */
function resolveVar(value: string, variables: Map<string, string>): string {
  const varRegex = /var\((--[\w-]+)\)/;
  let resolvedValue = value;
  let iterations = 0;

  while (varRegex.test(resolvedValue) && iterations < 10) {
    resolvedValue = resolvedValue.replace(varRegex, (match, varName) => {
      const replacement = variables.get(varName);
      if (replacement) {
        return replacement;
      }
      console.warn(chalk.yellow(`Warning: CSS variable ${varName} not found.`));
      return match;
    });
    iterations++;
  }

  return resolvedValue;
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

function extractCssBlockContent(css: string, blockIdentifier: string): string {
  const blockStartIndex = css.indexOf(blockIdentifier);
  if (blockStartIndex === -1) {
    return "";
  }

  const openBraceIndex = css.indexOf("{", blockStartIndex);
  if (openBraceIndex === -1) {
    return "";
  }

  let braceCount = 1;
  let endIndex = openBraceIndex + 1;

  while (endIndex < css.length && braceCount > 0) {
    if (css[endIndex] === "{") {
      braceCount++;
    } else if (css[endIndex] === "}") {
      braceCount--;
    }
    endIndex++;
  }

  if (braceCount === 0) {
    return css.substring(openBraceIndex + 1, endIndex - 1).trim();
  }

  return "";
}

function processForGtk(rawCss: string): string {
  const variables = parseCssVariables(rawCss);
  if (!variables.has("--spacing")) {
    variables.set("--spacing", "0.25rem");
  }

  const utilitiesContent = extractCssBlockContent(rawCss, "@layer utilities");
  const cssToProcess = utilitiesContent;

  let processedCss = "";
  const ruleRegex = /(.*?)\s*\{([^}]*)\}/g;
  let ruleMatch;

  while ((ruleMatch = ruleRegex.exec(cssToProcess)) !== null) {
    const fullSelector = ruleMatch[1]?.trim();
    const properties = ruleMatch[2];

    if (
      !fullSelector ||
      fullSelector.startsWith("@") ||
      properties === undefined
    ) {
      continue;
    }

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

          const parsedColor = parse(cssValue);
          if (parsedColor) {
            const rgbColor = toRgb(parsedColor);
            const r = Math.round(rgbColor.r * 255);
            const g = Math.round(rgbColor.g * 255);
            const b = Math.round(rgbColor.b * 255);

            if (rgbColor.alpha !== undefined && rgbColor.alpha < 1) {
              cssValue = `rgba(${r}, ${g}, ${b}, ${rgbColor.alpha.toFixed(2)})`;
            } else {
              cssValue = `rgb(${r}, ${g}, ${b})`;
            }
          } else {
            cssValue = evaluateCalc(cssValue);
            const numericValue = parseFloat(cssValue);
            if (!isNaN(numericValue) && cssValue.match(/^[\d.-]+$/)) {
              cssValue = `${numericValue}px`;
            }
          }
          validProperties.push(`  ${cssProp}: ${cssValue};`);
        }
      });

    if (validProperties.length > 0) {
      processedCss += `${fullSelector} {\n${validProperties.join("\n")}\n}\n\n`;
    }
  }

  return processedCss;
}

/**
 * Main build function.
 */
export function buildTailwindCss() {
  console.log(chalk.cyan("Starting Tailwind CSS build..."));

  try {
    const command = `${TAILWIND_CLI} -i "${INPUT_CSS_PATH}" -o "${RAW_OUTPUT_CSS_PATH}"`;
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: "inherit" });
    console.log(chalk.green("Tailwind CLI finished successfully."));

    const rawCss = fs.readFileSync(RAW_OUTPUT_CSS_PATH, "utf-8");
    const gtkCss = processForGtk(rawCss);
    fs.writeFileSync(OUTPUT_CSS_PATH, gtkCss);

    console.log(chalk.bold.green(`✅ Tailwind build complete.`));
    console.log(
      chalk.green(`   - Raw output saved to: ${RAW_OUTPUT_CSS_PATH}`),
    );
    console.log(
      chalk.green(`   - Processed GTK output saved to: ${OUTPUT_CSS_PATH}`),
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

const currentFilePath = fileURLToPath(import.meta.url);
const mainScriptPath = process.argv[1];

if (currentFilePath === mainScriptPath) {
  buildTailwindCss();
}
