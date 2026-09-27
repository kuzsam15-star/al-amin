import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
const pagesWorkflow = await readFile(new URL("../.github/workflows/static-artifact.yml", import.meta.url), "utf8");

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

test("GitHub Pages workflow validates and deploys only the static artifact", () => {
  assert.match(pagesWorkflow, /branches:\s*\["main"\]/u);
  assert.match(pagesWorkflow, /pnpm install --frozen-lockfile/u);
  assert.match(pagesWorkflow, /pnpm validate:content/u);
  assert.match(pagesWorkflow, /pnpm test/u);
  assert.match(pagesWorkflow, /pnpm typecheck/u);
  assert.match(pagesWorkflow, /pnpm lint/u);
  assert.match(pagesWorkflow, /pnpm build/u);
  assert.match(pagesWorkflow, /actions\/configure-pages@v5/u);
  assert.match(pagesWorkflow, /actions\/upload-pages-artifact@v4/u);
  assert.match(pagesWorkflow, /actions\/deploy-pages@v4/u);
  assert.match(pagesWorkflow, /STATIC_BASE_PATH=\/\$repository_name/u);
  assert.match(pagesWorkflow, /path:\s*out\//u);
  assert.doesNotMatch(pagesWorkflow, /owner:editor|\.local-editor|service_role/iu);
});

test("retired public platform routes are absent", async () => {
  const retiredFiles = [
    "src/app/admin/page.tsx",
    "src/app/admin-local/page.tsx",
    "src/app/api/applications/route.ts",
    "src/app/auth/callback/route.ts",
    "src/app/cabinet/page.tsx",
    "src/app/login/page.tsx",
    "src/app/register/page.tsx",
    "src/app/editor/page.tsx"
  ];
  for (const file of retiredFiles) {
    await assert.rejects(access(new URL("../" + file, import.meta.url)));
  }
  await access(new URL("../src/app/apply/page.tsx", import.meta.url));
});

test("candidate form remains static and has no Auth or Supabase browser runtime", async () => {
  const source = await readFile(new URL("../src/app/apply/CatalogSubmissionForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createClient|signUp|signIn|service_role|SUPABASE_SERVICE_ROLE/iu);
  assert.match(source, /catalogSubmissionConsent/u);
  assert.match(source, /createAlaminSubmissionPackage/u);
  assert.match(source, /Скачать заявку/u);
  assert.match(source, /catalogSubmissionDraftStorageKey/u);
  assert.match(source, /window\.localStorage\.setItem/u);
  assert.match(source, /Начать новую заявку/u);
  assert.match(source, /type="button"[^>]*onClick=\{startNewApplication\}/u);
  assert.match(source, /value=\{fields\.profileSummary\}/u);
  assert.match(source, /value=\{fields\.about\}/u);
  assert.doesNotMatch(source, /fetch\(|Turnstile|turnstile|NEXT_PUBLIC_CATALOG_SUBMISSION_ENDPOINT/iu);
});
