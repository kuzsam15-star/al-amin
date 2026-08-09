import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("focuses the required profile-photo control and omits legacy initial media fields", async () => {
  const source = await readFile(new URL("src/components/ApplicationForm.tsx", root), "utf8");
  assert.match(source, /mainInputRef/);
  assert.match(source, /root === "main" \? mainInputRef\.current/);
  assert.match(source, /Фотография профиля/);
  assert.doesNotMatch(source, /galleryPickerRef|gallerySuccessMessage|galleryWarningMessage/);
  assert.doesNotMatch(source, /Gallery Portfolio|Рекомендации|Видео|Ссылки на работы/);
});

test("application error targets do not duplicate form-control ids", async () => {
  const source = await readFile(new URL("src/components/ApplicationForm.tsx", root), "utf8");
  assert.match(source, /id: `application-\$\{name\}-field`/);
  assert.match(source, /getElementById\(`application-\$\{root\}-field`\)/);
  assert.match(source, /href=\{`#application-\$\{field\}-field`\}/);
  assert.doesNotMatch(source, /id: `application-\$\{name\}`/);
});

test("application resubmission maps only editable value keys from its draft", async () => {
  const source = await readFile(new URL("src/components/ApplicationForm.tsx", root), "utf8");
  assert.match(source, /const valuesFromDraft = \(draft\?: Draft\): Values => \(\{/);
  assert.match(source, /const seeded = valuesFromDraft\(draft\);/);
  assert.doesNotMatch(source, /\{ \.\.\.initial, \.\.\.draft,/);
  assert.doesNotMatch(source, /valuesFromDraft[\s\S]*\bid:\s*draft\?\.id/);
});

test("application photo state shows the cropped result without dominant browser file UI", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("src/components/ApplicationForm.tsx", root), "utf8"),
    readFile(new URL("src/app/additions.css", root), "utf8"),
  ]);
  assert.match(source, /className="visually-hidden" type="file"/);
  assert.match(source, /profile-photo-picker/);
  assert.match(source, /profile-photo-preview/);
  assert.match(source, /Предпросмотр готовой фотографии профиля/);
  assert.match(source, /Новая фотография загружена/);
  assert.match(source, /Удалить фотографию/);
  assert.match(source, /initialSettings=\{cropSource === mainSource \? mainCropSettings : null\}/);
  assert.match(source, /technicalImageName/);
  assert.doesNotMatch(source, /<div className="thumbnail-grid"><div className="thumbnail"><span>Новая фотография выбрана/);
  assert.match(styles, /\.profile-photo-preview\{[^}]*width:176px[^}]*height:176px[^}]*border-radius:50%/);
  assert.match(styles, /\.profile-photo-delete\{[^}]*min-height:44px/);
  assert.match(styles, /@media\(max-width:680px\)\{\.profile-photo-state\{[^}]*grid-template-columns:1fr/);
});

test("uses one structured vocabulary in Application, Cabinet and moderation", async () => {
  const [applicationForm, helpEditor, offerEditor, adminPage, profileForm] = await Promise.all([
    readFile(new URL("src/components/ApplicationForm.tsx", root), "utf8"),
    readFile(new URL("src/components/HelpTopicsEditor.tsx", root), "utf8"),
    readFile(new URL("src/components/WorkOffersEditor.tsx", root), "utf8"),
    readFile(new URL("src/app/admin/page.tsx", root), "utf8"),
    readFile(new URL("src/components/SpecialistProfileForm.tsx", root), "utf8"),
  ]);
  assert.match(applicationForm, /ariaInvalid=\{Boolean\(fieldError\("helpTopics"\)\)\}/);
  assert.match(applicationForm, /ariaInvalid=\{Boolean\(fieldError\("workOffers"\)\)\}/);
  assert.match(applicationForm, /form-error-summary/);
  assert.match(applicationForm, /contactMethod/);
  assert.match(helpEditor, /aria-invalid=\{ariaInvalid \|\| undefined\}/);
  assert.match(offerEditor, /currency: price === null \? null/);
  assert.match(adminPage, /\[item\.country,item\.city\]\.filter\(Boolean\)\.join\(" · "\)/);
  assert.match(profileForm, /Коротко о себе/);
  assert.match(profileForm, /О себе подробнее/);
  assert.match(profileForm, /С чем вы помогаете/);
  assert.match(profileForm, /Форматы работы/);
});
