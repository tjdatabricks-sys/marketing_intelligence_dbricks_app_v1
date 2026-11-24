import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { zipSync, strToU8 } from "fflate";
const root = process.cwd(),
  files = {};
const allowed = ["src", "data", "public", "scripts"];
for (const name of [
  "package.json",
  "package-lock.json",
  "app.yaml",
  ".env.example",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "README.md",
  "DATA_MODEL.md",
  "eslint.config.mjs",
])
  files[name] = new Uint8Array(readFileSync(join(root, name)));
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name),
      key = relative(root, path).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) walk(path);
    else files[key] = new Uint8Array(readFileSync(path));
  }
}
for (const dir of allowed) walk(join(root, dir));
mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/marketing-intelligence-databricks.zip",
  zipSync(files, { level: 6 }),
);
console.log(
  `Created dist/marketing-intelligence-databricks.zip (${Object.keys(files).length} source files; no credentials, dependencies or build output).`,
);
