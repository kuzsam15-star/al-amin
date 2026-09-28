import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const cropSource = await readFile(new URL("../src/app/apply/PhotoCropSurface.tsx", import.meta.url), "utf8");
  const cropStyles = await readFile(new URL("../src/app/apply/catalog-submission-form.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createClient|signUp|signIn|service_role|SUPABASE_SERVICE_ROLE/iu);
  assert.match(source, /catalogSubmissionConsent/u);
  assert.match(source, /createAlaminSubmissionPackage/u);
  assert.match(source, /Скачать заявку/u);
  assert.match(source, /catalogSubmissionDraftStorageKey/u);
  assert.match(source, /window\.localStorage\.setItem/u);
  assert.match(source, /Начать новую заявку/u);
  assert.match(source, /type="button"[^>]*onClick=\{startNewApplication\}/u);
  assert.doesNotMatch(source, /name="profileSummary"|Коротко о вас/u);
  assert.match(source, /value=\{fields\.about\}/u);
  assert.doesNotMatch(source, /<h2>С чем вы помогаете<\/h2>|helpTopics\.map/u);
  assert.doesNotMatch(source, /<h2>Портфолио<\/h2>|portfolio\.map/u);
  assert.match(source, /<h2>Услуги<\/h2>/u);
  assert.match(source, /Услуга №\$\{index \+ 1\}/u);
  assert.match(source, /Добавить услугу/u);
  assert.doesNotMatch(source, /<h2>Форматы работы<\/h2>|Добавить формат работы/u);
  assert.match(source, /setWorkOffers\(\(items\) => items\.filter/u);
  assert.match(source, /setWorkOffers\(\(items\) => \[\.\.\.items,/u);
  assert.match(source, /<span>01<\/span>[\s\S]*<span>02<\/span>[\s\S]*<span>03<\/span>[\s\S]*<span>04<\/span>[\s\S]*<span>05<\/span>/u);
  assert.doesNotMatch(source, /<span>06<\/span>|<span>07<\/span>/u);
  assert.match(source, /CategorySelectorDialog/u);
  assert.match(source, /Не нашли подходящую категорию\?/u);
  assert.doesNotMatch(source, /categoryDraft|Добавить категорию/u);
  assert.match(source, /label="Фото профиля"/u);
  assert.match(source, /label="Аватар"/u);
  assert.match(source, /profileCrop/u);
  assert.match(cropSource, /onPointerDown/u);
  assert.match(cropSource, /kind: "pinch"/u);
  assert.match(cropSource, /data-crop-surface="photo-only"/u);
  assert.match(cropSource, /data-crop-gesture="pointer-pinch-v1"/u);
  assert.match(cropSource, /onLostPointerCapture/u);
  assert.match(cropSource, /addEventListener\("wheel"[\s\S]*passive:\s*false/u);
  assert.match(cropSource, /addEventListener\("touchstart"[\s\S]*passive:\s*false/u);
  assert.match(cropSource, /addEventListener\("touchmove"[\s\S]*passive:\s*false/u);
  assert.match(cropStyles, /touch-action:\s*none/u);
  assert.match(cropStyles, /overscroll-behavior:\s*contain/u);
  assert.doesNotMatch(cropSource + cropStyles, /cropMoveHint|<Move\b|Перемещайте фото<\/span>/u);
  const photoOnlySurface = cropSource.slice(cropSource.indexOf('data-crop-surface="photo-only"'));
  const photoOnlyImageEnd = photoOnlySurface.indexOf("/>", photoOnlySurface.indexOf("<img")) + 2;
  const photoOnlySurfaceEnd = photoOnlySurface.indexOf("</div>", photoOnlyImageEnd);
  assert.equal(photoOnlySurface.slice(photoOnlyImageEnd, photoOnlySurfaceEnd).trim(), "", "Crop surface contains only its image.");
  assert.equal(source.match(/description="Перемещайте фото пальцем\. Используйте два пальца, чтобы изменить масштаб\."/gu)?.length, 2);
  assert.match(cropStyles, /\.photoPicker\s*>\s*p\s*\{[^}]*flex:\s*0\s+0\s+auto/su);
  assert.doesNotMatch(cropStyles, /\.submitBar\s*\{[^}]*position:\s*(?:sticky|fixed)/su);
  assert.ok(source.lastIndexOf("styles.submitBar") > source.lastIndexOf("styles.consentPanel"), "Download CTA stays once at the end of the form.");
  assert.equal(source.match(/styles\.submitBar/gu)?.length, 1);
  assert.doesNotMatch(source + cropSource, /type="range"|Ось X|Ось Y|Масштаб/u);
  assert.doesNotMatch(source, /fetch\(|Turnstile|turnstile|NEXT_PUBLIC_CATALOG_SUBMISSION_ENDPOINT/iu);
});

test("candidate form simplification does not modify cropper, Victor or category registry", async () => {
  const baselines = new Map([
    ["../src/app/apply/PhotoCropSurface.tsx", "9b061ec01504dda706f6819e7f06dda24f16ee08"],
    ["../src/lib/photo-crop.mjs", "e06e4d3c202a804e4963ea0abc4ed4e27640b790"],
    ["../src/lib/photo-crop.d.mts", "7fe1eddfb08c3cc71a39d26bc4fc3b0614c3c553"],
    ["../content/specialists.json", "f4d70b9d62d3ad4f11df8f3dd48e5bc82570c9ce"],
    ["../content/category-registry.json", "e422d00a9d688b65b500853582d09d3a3069308d"],
  ]);
  for (const [path, expected] of baselines) {
    const bytes = await readFile(new URL(path, import.meta.url));
    const gitBlobHash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(gitBlobHash, expected, `${path} changed unexpectedly`);
  }
});
