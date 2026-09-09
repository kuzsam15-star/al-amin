import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const required = ["index.html", "specialists/index.html", "about/index.html", "verification/index.html", "privacy/index.html", "rules/index.html"];
const forbidden = ["specialists/__empty__/index.html"];
const failures = [];
for (const file of required) {
  try { await access(path.join(root, file)); }
  catch { failures.push(`missing ${file}`); }
}

for (const file of forbidden) {
  try {
    await access(path.join(root, file));
    failures.push(`forbidden placeholder ${file}`);
  } catch {
    // Expected: build-only placeholders are removed before verification.
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }))).flat();
}

if (!failures.length) {
  const files = await walk(root);
  const html = files.filter((file) => file.endsWith(".html"));
  for (const file of html) {
    const source = await readFile(file, "utf8");
    if (/supabase|\/api\/|\/login|\/register|\/cabinet|\/admin(?:\/|")/iu.test(source)) failures.push(`platform-only reference in ${path.relative(root, file)}`);
  }
  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce((sum, value) => sum + value, 0);
  console.log(`Static artifact: ${files.length} files, ${html.length} HTML pages, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB.`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Static artifact verification passed.");
}
