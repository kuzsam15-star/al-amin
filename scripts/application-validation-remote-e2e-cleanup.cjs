const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "outputs", "application-form-validation-remote-e2e-2026-08-09");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const separator = line.indexOf("=");
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, separator).trim(), value];
  }));
}

function sameIds(actual, expected) {
  return actual.length === expected.length && [...actual].sort().every((id, index) => id === [...expected].sort()[index]);
}

async function removeExact(client, table, ids) {
  if (!ids.length) return 0;
  const { data, error } = await client.from(table).delete().in("id", ids).select("id");
  if (error) throw error;
  if (data.length !== ids.length) throw new Error(`${table}: deleted ${data.length} rows instead of ${ids.length}.`);
  return data.length;
}

async function count(client, table) {
  const { count: value, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return value;
}

async function main() {
  const [envSource, stateSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, ".env.local"), "utf8"),
    fs.readFile(path.join(outputDir, "qa-state.json"), "utf8"),
  ]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const ids = state.created_object_ids;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const [{ data: application, error: appError }, { data: specialist, error: specialistError }, { data: revision, error: revisionError }] = await Promise.all([
    admin.from("applications").select("id,owner_id,profile_summary").eq("id", ids.application_id).single(),
    admin.from("specialists").select("id,owner_id,slug,profile_summary").eq("id", ids.specialist_id).single(),
    admin.from("specialist_revisions").select("id,owner_id,specialist_id").eq("id", ids.revision_id).single(),
  ]);
  if (appError || specialistError || revisionError) throw appError ?? specialistError ?? revisionError;
  if (application.owner_id !== state.user_id || !application.profile_summary.includes(state.marker)) throw new Error("QA application ownership/marker mismatch.");
  if (specialist.owner_id !== state.user_id || specialist.slug !== ids.specialist_slug || !specialist.profile_summary.includes(state.marker)) throw new Error("QA specialist ownership/marker mismatch.");
  if (revision.owner_id !== state.user_id || revision.specialist_id !== ids.specialist_id) throw new Error("QA revision ownership mismatch.");

  const [{ data: eventRows, error: eventError }, { data: notificationRows, error: notificationError }, { data: auditRows, error: auditError }] = await Promise.all([
    admin.from("application_events").select("id").eq("application_id", ids.application_id),
    admin.from("email_notifications").select("id").or(`application_id.eq.${ids.application_id},specialist_id.eq.${ids.specialist_id},revision_id.eq.${ids.revision_id}`),
    admin.from("audit_log").select("id").in("id", ids.audit_log_ids),
  ]);
  if (eventError || notificationError || auditError) throw eventError ?? notificationError ?? auditError;
  if (!sameIds(eventRows.map((row) => row.id), ids.application_event_ids)) throw new Error("QA application event set changed after it was recorded.");
  if (!sameIds(notificationRows.map((row) => row.id), ids.email_notification_ids)) throw new Error("QA notification set changed after it was recorded.");
  if (!sameIds(auditRows.map((row) => row.id), ids.audit_log_ids)) throw new Error("QA audit-log set changed after it was recorded.");

  const before = {
    applications: await count(admin, "applications"),
    specialists: await count(admin, "specialists"),
    specialist_revisions: await count(admin, "specialist_revisions"),
    application_events: await count(admin, "application_events"),
    email_notifications: await count(admin, "email_notifications"),
  };

  const deleted = {};
  deleted.email_notifications = await removeExact(admin, "email_notifications", ids.email_notification_ids);
  deleted.application_events = await removeExact(admin, "application_events", ids.application_event_ids);
  deleted.audit_log = await removeExact(admin, "audit_log", ids.audit_log_ids);

  const [{ data: deletedTrust, error: trustError }, { data: deletedVerifications, error: verificationError }] = await Promise.all([
    admin.from("specialist_trust_badges").delete().eq("specialist_id", ids.specialist_id).select("id"),
    admin.from("verifications").delete().eq("specialist_id", ids.specialist_id).select("id"),
  ]);
  if (trustError || verificationError) throw trustError ?? verificationError;
  deleted.trust_badges = deletedTrust.length;
  deleted.verifications = deletedVerifications.length;
  deleted.specialist_revisions = await removeExact(admin, "specialist_revisions", [ids.revision_id]);
  deleted.specialists = await removeExact(admin, "specialists", [ids.specialist_id]);
  deleted.applications = await removeExact(admin, "applications", [ids.application_id]);

  const { error: storageDeleteError } = await admin.storage.from("profile-media").remove([ids.media_path]);
  if (storageDeleteError) throw storageDeleteError;
  deleted.media_objects = 1;

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(state.user_id);
  if (authDeleteError) throw authDeleteError;
  deleted.auth_users = 1;

  const [{ data: remainingApplication }, { data: remainingSpecialist }, { data: remainingRevision }, { data: publicProfile }, authLookup, mediaLookup] = await Promise.all([
    admin.from("applications").select("id").eq("id", ids.application_id).maybeSingle(),
    admin.from("specialists").select("id").eq("id", ids.specialist_id).maybeSingle(),
    admin.from("specialist_revisions").select("id").eq("id", ids.revision_id).maybeSingle(),
    admin.from("published_specialists").select("id").eq("id", ids.specialist_id).maybeSingle(),
    admin.auth.admin.getUserById(state.user_id),
    admin.storage.from("profile-media").download(ids.media_path),
  ]);
  const cleanupVerified = !remainingApplication && !remainingSpecialist && !remainingRevision && !publicProfile && Boolean(authLookup.error) && Boolean(mediaLookup.error);
  if (!cleanupVerified) throw new Error("One or more QA objects remained after cleanup.");

  const after = {
    applications: await count(admin, "applications"),
    specialists: await count(admin, "specialists"),
    specialist_revisions: await count(admin, "specialist_revisions"),
    application_events: await count(admin, "application_events"),
    email_notifications: await count(admin, "email_notifications"),
  };
  const result = { marker: state.marker, before, deleted, after, public_profile_absent: true, auth_user_absent: true, media_absent: true, cleanup_verified: true };
  await fs.writeFile(path.join(outputDir, "cleanup-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
