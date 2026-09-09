import { readFile } from "node:fs/promises";
import { validateContent } from "../src/lib/static-content-contract.mjs";

const site = JSON.parse(await readFile(new URL("../content/site.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../content/specialists.json", import.meta.url), "utf8"));
const result = validateContent(site, catalog);
if (result.errors.length) {
  console.error(result.errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Static content is valid: ${result.catalog.specialists.length} specialist records.`);
}
