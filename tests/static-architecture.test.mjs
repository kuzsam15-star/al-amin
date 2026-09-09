import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");

test("production dependencies have no Supabase or Auth runtime", () => {
  const names = Object.keys(packageJson.dependencies);
  assert.equal(names.some((name) => name.includes("supabase")), false);
  assert.equal(names.includes("react-easy-crop"), false);
});

test("Next builds a hosting-agnostic static export", () => {
  assert.match(nextConfig, /output:\s*"export"/u);
  assert.match(nextConfig, /STATIC_BASE_PATH/u);
  assert.doesNotMatch(nextConfig, /github\.io|GITHUB_REPOSITORY|basePath:\s*"\/[A-Za-z0-9_-]+"/u);
});

test("retired public platform routes are absent", async () => {
  const retiredFiles = [
    "src/app/admin/page.tsx",
    "src/app/api/applications/route.ts",
    "src/app/apply/page.tsx",
    "src/app/auth/callback/route.ts",
    "src/app/cabinet/page.tsx",
    "src/app/login/page.tsx",
    "src/app/register/page.tsx"
  ];
  for (const file of retiredFiles) {
    await assert.rejects(access(new URL("../" + file, import.meta.url)));
  }
});
