import { readFile } from "node:fs/promises";
import { validateContent } from "../src/lib/static-content-contract.mjs";
import { categoryRegistryIntegrity, categoryTaxonomyVersion } from "../src/lib/category-registry.mjs";

const site = JSON.parse(await readFile(new URL("../content/site.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../content/specialists.json", import.meta.url), "utf8"));
const result = validateContent(site, catalog);
const registry = categoryRegistryIntegrity();
const errors = [...registry.errors];
if (registry.groups !== 45) errors.push(`category registry: expected 45 groups, received ${registry.groups}`);
if (registry.categories !== 876) errors.push(`category registry: expected 876 categories, received ${registry.categories}`);
if (registry.aliases !== 137) errors.push(`category registry: expected 137 aliases, received ${registry.aliases}`);
errors.push(...result.errors);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Static content is valid: ${result.catalog.specialists.length} specialist records. Category registry ${categoryTaxonomyVersion}: ${registry.groups} groups, ${registry.categories} categories, ${registry.aliases} aliases.`);
}
