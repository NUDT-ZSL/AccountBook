import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
// A byte-order mark at the top of a source file survives into the single
// file. Inside <style> it breaks the first rule (:root), which silently
// drops every CSS variable — including the sheet background.
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const [shell, css, js] = (await Promise.all([
  readFile(resolve(root, "src/shell.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "src/app.js"), "utf8")
])).map(stripBom);

const output = shell
  .replace("/*__CSS__*/", () => css)
  .replace("/*__JS__*/", () => js);

if (output.includes("/*__CSS__*/") || output.includes("/*__JS__*/")) {
  throw new Error("Build placeholders were not replaced.");
}

await writeFile(resolve(root, "index.html"), output, "utf8");
console.log(`Built index.html (${Buffer.byteLength(output, "utf8").toLocaleString()} bytes)`);
