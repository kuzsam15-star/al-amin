import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const configuredBasePath = process.env.STATIC_BASE_PATH ?? "";
const expectedBasePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/u, "");
const required = ["index.html", "specialists/index.html", "apply/index.html", "about/index.html", "verification/index.html", "privacy/index.html", "rules/index.html", "contacts/index.html", "robots.txt", "sitemap.xml"];
const forbidden = ["specialists/__empty__/index.html", "admin/index.html", "editor/index.html", "admin-local/index.html", "owner-editor/index.html"];
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
  for (const file of files.filter((entry) => /\.(?:html|js|css|json|txt)$/u.test(entry))) {
    const source = await readFile(file, "utf8");
    if (/OWNER_EDITOR_SUPABASE|SUPABASE_SERVICE_ROLE|TURNSTILE_SECRET_KEY|sb_secret_/u.test(source)) failures.push(`server-only secret name or value in ${path.relative(root, file)}`);
    if (/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/|["'])/iu.test(source)) failures.push(`local-only URL in ${path.relative(root, file)}`);
  }
  if (expectedBasePath) {
    for (const file of html) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/<[^>]+(?:href|src)=["'](\/[^"']*)["'][^>]*>/giu)) {
        const [tag, url] = match;
        if (url === "/" && /rel=["']preconnect["']/iu.test(tag)) continue;
        if (!url.startsWith(`${expectedBasePath}/`)) failures.push(`asset or route bypasses STATIC_BASE_PATH in ${path.relative(root, file)}: ${url}`);
      }
    }
  }
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (/\.alamin(?:\.json)?$/iu.test(relative) || relative.includes(".local-editor/") || relative.includes("submissions/")) failures.push(`private submission artifact in ${relative}`);
  }
  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce((sum, value) => sum + value, 0);
  const catalog = JSON.parse(await readFile(path.resolve("content", "specialists.json"), "utf8"));
  const publishedCount = catalog.specialists.filter((item) => item.published).length;
  const imageFiles = files.filter((file) => /[\\/]images[\\/]specialists[\\/].+\.(?:webp|jpe?g|png)$/iu.test(file));
  const imageStats = await Promise.all(imageFiles.map(async (file) => ({ file, bytes: (await stat(file)).size })));
  const imageBytes = imageStats.reduce((sum, item) => sum + item.bytes, 0);
  const heavy = imageStats.filter((item) => item.bytes > 500 * 1024).sort((a, b) => b.bytes - a.bytes);
  console.log(`Static artifact: ${files.length} files, ${html.length} HTML pages, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB.`);
  console.log(`Published specialists: ${publishedCount}. Specialist images: ${imageFiles.length}, ${(imageBytes / 1024 / 1024).toFixed(2)} MiB.`);
  console.log(heavy.length ? `Heavy specialist images (>500 KiB):\n${heavy.map((item) => `- ${path.relative(root, item.file)}: ${(item.bytes / 1024).toFixed(1)} KiB`).join("\n")}` : "Heavy specialist images (>500 KiB): none.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Static artifact verification passed.");
}
