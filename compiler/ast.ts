import { compile } from 'svelte/compiler';
import fs from 'fs';
import util from 'util';

const svelte_code = fs.readFileSync("test.svelte", { encoding: 'utf8' });
const { js, ast } = compile(svelte_code, {});
console.log("Code:");
console.log(js.code);
console.log("Ast:");
console.log(util.inspect(ast, false, 9, false));

