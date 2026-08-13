import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const migration = await readFile(new URL("../supabase/migrations/202607290009_specialist_revisions.sql", import.meta.url), "utf8");
const cabinetAction = await readFile(new URL("../src/app/cabinet/actions.ts", import.meta.url), "utf8");
const contacts = await readFile(new URL("../src/components/ContactLinks.tsx", import.meta.url), "utf8");
const cropper = await readFile(new URL("../src/components/AvatarCropper.tsx", import.meta.url), "utf8");
const mediaSource = await readFile(new URL("../src/app/api/media/source/route.ts", import.meta.url), "utf8");
const cleanup = await readFile(new URL("../src/lib/media-cleanup.ts", import.meta.url), "utf8");
const categoryCatalog = await readFile(new URL("../supabase/migrations/202607290006_expand_category_catalog.sql", import.meta.url), "utf8");
const categoryPicker = await readFile(new URL("../src/components/CategoryMultiSelect.tsx", import.meta.url), "utf8");
const videoPreview = await readFile(new URL("../src/components/VideoPreview.tsx", import.meta.url), "utf8");
const adminActions = await readFile(new URL("../src/app/admin/actions.ts", import.meta.url), "utf8");
const adminPage = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
const deletionMigration = await readFile(new URL("../supabase/migrations/202607290002_admin_moderation_deletion.sql", import.meta.url), "utf8");

test("revision migration protects one active draft and atomic moderation", () => {
  assert.match(migration, /specialist_revisions_one_pending[\s\S]*where status = 'pending'/);
  assert.match(migration, /alter table public\.specialist_revisions enable row level security/);
  assert.match(migration, /Only moderators can decide profile revisions/);
  assert.match(migration, /if r\.status <> 'pending' then raise exception 'Revision has already been decided'/);
  assert.match(migration, /drop policy if exists "Owners update own specialists"/);
});

test("cabinet saves an owned revision instead of mutating published specialists", () => {
  assert.match(cabinetAction, /createSupabaseAdminClient/);
  assert.match(cabinetAction, /from\("specialist_revisions"\)\.update\(\{ payload, status: "pending"/);
  assert.match(cabinetAction, /from\("specialist_revisions"\)\.insert\(/);
  assert.match(cabinetAction, /\.eq\("owner_id", user\.id\)/);
  assert.doesNotMatch(cabinetAction, /from\("specialists"\)\.update\(/);
});

test("contacts allow only intended schemes", () => {
  assert.match(contacts, /tel:\$\{phoneDigits/);
  assert.match(contacts, /mailto:/);
  assert.match(contacts, /https:\/\/t\.me/);
  assert.match(contacts, /https:\/\/wa\.me/);
  assert.match(contacts, /url\.protocol === "https:"/);
  assert.doesNotMatch(contacts, /javascript:/i);
});

test("existing avatar is read safely without revoking its source during cropper setup", () => {
  assert.match(cropper, /reader\.readAsDataURL\(file\)/);
  assert.doesNotMatch(cropper, /URL\.revokeObjectURL/);
  assert.match(mediaSource, /owner_id", user\.id/);
  assert.match(mediaSource, /createSupabaseAdminClient\(\).*storage/s);
  assert.match(mediaSource, /isProfileMediaPath/);
  assert.match(mediaSource, /sharp\(input[\s\S]*\.webp\(\{ quality: 90 \}\)/);
  assert.match(mediaSource, /"Content-Type": "image\/webp"/);
  assert.match(mediaSource, /path\.startsWith\(`submissions\/\$\{user\.id\}\//);
});

test("an existing PNG avatar can be normalized to the WebP blob returned by the media-source route", async () => {
  const existingPng = await sharp({ create: { width: 12, height: 18, channels: 3, background: "#276452" } }).png().toBuffer();
  const responseBlob = await sharp(existingPng, { failOn: "error", limitInputPixels: 40_000_000 }).rotate().webp({ quality: 90 }).toBuffer();
  const info = await sharp(responseBlob).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.width, 12);
  assert.equal(info.height, 18);
});

test("category catalog is centralized and the picker opens it only on demand", () => {
  assert.match(categoryCatalog, /add column if not exists group_name/);
  assert.match(categoryCatalog, /on conflict \(slug\) do update/);
  assert.match(categoryPicker, /category-modal/);
  assert.match(categoryPicker, /Доп\. категории/);
  assert.match(categoryPicker, /group_name/);
  assert.doesNotMatch(categoryPicker, /Другие направления/);
});

test("public video cards use privacy-friendly previews for supported providers", () => {
  assert.match(videoPreview, /youtube-nocookie\.com\/embed/);
  assert.match(videoPreview, /rutube\.ru\/play\/embed/);
  assert.match(videoPreview, /vkvideo\.ru\/video_ext\.php/);
  assert.match(videoPreview, /searchParams\.get\("z"\)/);
  assert.match(videoPreview, /referrerPolicy="no-referrer"/);
});

test("orphaned pending media is removed only after reference checks", () => {
  assert.match(cleanup, /specialist_revisions.*status", "pending/s);
  assert.match(cleanup, /applications/);
  assert.match(cleanup, /requested\.filter\(\(path\) => !referenced\.has\(path\)\)/);
});

test("only admins can permanently remove moderation records without deleting profiles", () => {
  assert.match(deletionMigration, /Admin deletes applications[\s\S]*for delete[\s\S]*public\.is_admin\(\)/);
  assert.match(deletionMigration, /Admin deletes specialist revisions[\s\S]*for delete[\s\S]*public\.is_admin\(\)/);
  assert.match(adminActions, /export async function deleteApplication/);
  assert.match(adminActions, /export async function deleteRevision/);
  assert.match(adminActions, /requireAdminAal2\(\)/);
  assert.match(adminActions, /admin_delete_revision/);
  assert.match(adminActions, /removeUnreferencedProfileMedia/);
  assert.doesNotMatch(adminActions, /from\("specialists"\)\.delete\(/);
  assert.doesNotMatch(adminActions, /callAt/);
  assert.doesNotMatch(adminPage, /name="callAt"/);
  assert.match(adminPage, /AdminDeleteButton/);
});
