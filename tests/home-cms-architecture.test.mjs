import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteContentFieldConfig, validateSiteContent } from "../src/lib/site-content-fields.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const validContent = {
  brand_name: "AL-AMIN",
  tagline: "Платформа доверенного выбора",
  hero_title: "Найдите специалиста, которому можно доверять",
  hero_text: "Проверенные специалисты и безопасное обращение через платформу.",
  contact_email: "al-amin@ailvi.ru",
  about_text: "О проекте",
  rules_intro: "Правила платформы",
  privacy_text: "Обработка персональных данных",
  seo_title: "AL-AMIN — специалисты",
  seo_description: "Платформа проверенных специалистов.",
};

test("root is the only Civic Home and design-preview is only an alias", async () => {
  const [home, alias, civicHome, shell, header] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/app/design-preview/page.tsx"),
    read("src/components/civic/CivicHome.tsx"),
    read("src/components/civic/AdaptiveSiteShell.tsx"),
    read("src/components/civic/CivicHeader.tsx"),
  ]);
  assert.match(home, /<CivicHome content=\{content\} specialists=\{specialists\}/);
  assert.match(home, /dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(alias, /redirect\("\/"\)/);
  assert.match(civicHome, /content\.tagline/);
  assert.match(civicHome, /content\.hero_title/);
  assert.match(civicHome, /content\.hero_text/);
  assert.doesNotMatch(civicHome, /whySection|why-al-amin|Почему AL-AMIN/);
  assert.match(shell, /civic-preview-mode/);
  assert.doesNotMatch(shell, /civicPreviewEnabled|site-header|alamin:civic-preview/);
  assert.match(header, /href="\/"/);
});

test("CMS rejects overlong Civic Home text without silently truncating it", async () => {
  assert.deepEqual(validateSiteContent(validContent), { valid: true });
  const invalid = { ...validContent, hero_title: "А".repeat(siteContentFieldConfig.hero_title.maxLength + 1) };
  assert.deepEqual(validateSiteContent(invalid), { valid: false, field: "hero_title" });

  const actions = await read("src/app/admin/actions.ts");
  assert.match(actions, /validateSiteContent\(patch\)/);
  assert.doesNotMatch(actions, /\.slice\(0, content/);
});

test("Admin edits only mapped text fields and never accepts raw layout code", async () => {
  const [adminPage, form, fields] = await Promise.all([
    read("src/app/admin/page.tsx"),
    read("src/components/admin/SiteContentForm.tsx"),
    read("src/lib/site-content-fields.ts"),
  ]);
  assert.match(adminPage, /showSettings/);
  assert.match(adminPage, /<SiteContentForm content=\{siteContent\} action=\{updateSiteContent\}/);
  assert.match(form, /Где используется/);
  assert.match(fields, /hero_title/);
  assert.doesNotMatch(form, /raw_html|css|javascript|dangerouslySetInnerHTML/i);
});

test("logout returns to the canonical Civic Home", async () => {
  const logout = await read("src/components/LogoutButton.tsx");
  assert.match(logout, /router\.replace\('\/'\)/);
});
