const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(
  projectRoot,
  "outputs",
  "post-migration-data-contract-e2e-2026-08-07",
);
const statePath = path.join(outputDir, "qa-bootstrap-state.json");

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

function assertMatch(condition, message) {
  if (!condition) throw new Error(message);
}

async function deleteIds(query, expectedIds) {
  const { data, error } = await query.select("id");
  if (error) throw error;
  const actualIds = (data ?? []).map(({ id }) => id).sort();
  assertMatch(
    JSON.stringify(actualIds) === JSON.stringify([...expectedIds].sort()),
    `Unexpected deleted IDs: ${JSON.stringify(actualIds)}`,
  );
  return actualIds;
}

async function main() {
  const [envSource, stateSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, ".env.local"), "utf8"),
    fs.readFile(statePath, "utf8"),
  ]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const ids = state.created_object_ids;
  assertMatch(state.marker?.startsWith("ALAMIN-E2E-20260807-"), "Unsafe QA marker.");
  assertMatch(state.user_id && ids?.application_id && ids?.specialist_id && ids?.revision_id && ids?.media_path, "Incomplete QA state.");
  assertMatch(ids.media_path.startsWith(`submissions/${state.user_id}/`), "QA media path is not owned by the QA user.");

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [{ data: application, error: applicationError }, { data: specialist, error: specialistError }, { data: revision, error: revisionError }] = await Promise.all([
    admin.from("applications").select("id,owner_id,profile_summary,main_image_path").eq("id", ids.application_id).maybeSingle(),
    admin.from("specialists").select("id,owner_id,profile_summary,avatar_path,status").eq("id", ids.specialist_id).maybeSingle(),
    admin.from("specialist_revisions").select("id,owner_id,specialist_id").eq("id", ids.revision_id).maybeSingle(),
  ]);
  if (applicationError) throw applicationError;
  if (specialistError) throw specialistError;
  if (revisionError) throw revisionError;
  assertMatch(application?.owner_id === state.user_id && application.profile_summary?.includes(state.marker), "QA application identity mismatch.");
  assertMatch(specialist?.owner_id === state.user_id && specialist.profile_summary?.includes(state.marker), "QA specialist identity mismatch.");
  assertMatch(revision?.owner_id === state.user_id && revision.specialist_id === ids.specialist_id, "QA revision identity mismatch.");
  assertMatch(application.main_image_path === ids.media_path && specialist.avatar_path === ids.media_path, "QA media reference mismatch.");

  const { error: archiveError } = await admin
    .from("specialists")
    .update({ status: "archived" })
    .eq("id", ids.specialist_id)
    .eq("owner_id", state.user_id);
  if (archiveError) throw archiveError;
  const { data: stillPublic, error: publicError } = await admin
    .from("published_specialists")
    .select("id")
    .eq("id", ids.specialist_id);
  if (publicError) throw publicError;
  assertMatch((stillPublic ?? []).length === 0, "QA specialist remained public after archival.");

  const { data: notificationRows, error: notificationError } = await admin
    .from("email_notifications")
    .select("id")
    .or(`user_id.eq.${state.user_id},application_id.eq.${ids.application_id},specialist_id.eq.${ids.specialist_id},revision_id.eq.${ids.revision_id}`);
  if (notificationError) throw notificationError;
  const notificationIds = (notificationRows ?? []).map(({ id }) => id);
  if (notificationIds.length) {
    await deleteIds(admin.from("email_notifications").delete().in("id", notificationIds), notificationIds);
  }

  const { data: trustRows, error: trustError } = await admin.from("specialist_trust_badges").select("id").eq("specialist_id", ids.specialist_id);
  if (trustError) throw trustError;
  const trustIds = (trustRows ?? []).map(({ id }) => id);
  if (trustIds.length) await deleteIds(admin.from("specialist_trust_badges").delete().in("id", trustIds), trustIds);

  const { data: verificationRows, error: verificationError } = await admin.from("verifications").select("id").eq("specialist_id", ids.specialist_id);
  if (verificationError) throw verificationError;
  const verificationIds = (verificationRows ?? []).map(({ id }) => id);
  if (verificationIds.length) await deleteIds(admin.from("verifications").delete().in("id", verificationIds), verificationIds);

  await deleteIds(
    admin.from("specialist_revisions").delete().eq("id", ids.revision_id).eq("owner_id", state.user_id).eq("specialist_id", ids.specialist_id),
    [ids.revision_id],
  );
  await deleteIds(
    admin.from("specialists").delete().eq("id", ids.specialist_id).eq("owner_id", state.user_id),
    [ids.specialist_id],
  );
  await deleteIds(
    admin.from("applications").delete().eq("id", ids.application_id).eq("owner_id", state.user_id),
    [ids.application_id],
  );

  const { error: storageError } = await admin.storage.from("profile-media").remove([ids.media_path]);
  if (storageError) throw storageError;
  const { error: authError } = await admin.auth.admin.deleteUser(state.user_id);
  if (authError) throw authError;

  const [{ data: applicationAfter }, { data: specialistAfter }, { data: revisionAfter }, authAfter] = await Promise.all([
    admin.from("applications").select("id").eq("id", ids.application_id),
    admin.from("specialists").select("id").eq("id", ids.specialist_id),
    admin.from("specialist_revisions").select("id").eq("id", ids.revision_id),
    admin.auth.admin.getUserById(state.user_id),
  ]);
  assertMatch((applicationAfter ?? []).length === 0, "QA application was not deleted.");
  assertMatch((specialistAfter ?? []).length === 0, "QA specialist was not deleted.");
  assertMatch((revisionAfter ?? []).length === 0, "QA revision was not deleted.");
  assertMatch(Boolean(authAfter.error), "QA Auth user was not deleted.");

  const result = {
    marker: state.marker,
    deleted: {
      application_ids: [ids.application_id],
      specialist_ids: [ids.specialist_id],
      revision_ids: [ids.revision_id],
      media_paths: [ids.media_path],
      auth_user_ids: [state.user_id],
      notification_ids: notificationIds,
      trust_assignment_ids: trustIds,
      verification_ids: verificationIds,
    },
    public_profile_removed_before_delete: true,
    completed_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outputDir, "cleanup-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ cleanup: "complete", public_profile_removed: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
