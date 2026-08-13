import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the requested-changes workflow reuses one application and keeps moderator notes private", async () => {
  const [migration, enumMigration, route, cabinet, actions] = await Promise.all([
    read("supabase/migrations/202607290003_application_workflow_and_admin_profiles.sql"),
    read("supabase/migrations/202607290001_00_application_changes_requested.sql"),
    read("src/app/api/applications/route.ts"),
    read("src/app/cabinet/page.tsx"),
    read("src/app/admin/actions.ts"),
  ]);
  assert.match(enumMigration, /changes_requested/);
  assert.match(migration, /guard_owner_application_update/);
  assert.match(migration, /new\.status := 'new'/);
  assert.match(migration, /application_events/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.match(route, /\.update\(\{ \.\.\.writePayload, status: "new", resubmitted_at:/);
  assert.match(route, /\.eq\("owner_id", user\.id\)/);
  assert.match(cabinet, /applicant_message/);
  assert.doesNotMatch(cabinet, /internal_notes/);
  assert.match(actions, /status === "changes_requested" \? applicantMessage : null/);
});

test("new revisions use the structured contract while legacy gallery safeguards remain", async () => {
  const [migration, cabinetActions, publicActions] = await Promise.all([
    read("supabase/migrations/202607290003_application_workflow_and_admin_profiles.sql"),
    read("src/app/cabinet/actions.ts"),
    read("src/components/AdminPublicActions.tsx"),
  ]);
  assert.match(migration, /applications_gallery_paths_limit/);
  assert.match(migration, /specialist_revisions_gallery_paths_limit/);
  assert.match(cabinetActions, /contract_version: 2/);
  assert.match(cabinetActions, /validateProfileRevision/);
  assert.match(cabinetActions, /createSupabaseAdminClient/);
  assert.doesNotMatch(cabinetActions, /rawGalleryPaths|public_contact/);
  assert.match(publicActions, /Удалить профиль из публичного каталога/);
  assert.match(migration, /Admins delete specialists/);
});

test("application moderation keeps actions ordered and blocks changing approved applications", async () => {
  const [page, actions] = await Promise.all([
    read("src/app/admin/page.tsx"),
    read("src/app/admin/actions.ts"),
  ]);
  const approve = page.indexOf("Принять заявку");
  const changes = page.indexOf("Запросить изменения");
  const reject = page.indexOf("Отклонить");
  assert.ok(approve >= 0 && approve < changes && changes < reject);
  assert.match(page, /admin-danger-actions/);
  assert.match(actions, /\["new","screening","info_required","changes_requested","call_required","call_scheduled"\]\.includes\(current\.status\)/);
  assert.match(actions, /moderator_decide_application/);
});
