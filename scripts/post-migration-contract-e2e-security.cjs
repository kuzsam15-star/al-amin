const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "outputs", "post-migration-data-contract-e2e-2026-08-07");
const statePath = path.join(outputDir, "qa-bootstrap-state.json");
const resultsPath = path.join(outputDir, "security-negative-checks.json");

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

const blocked = (result) => Boolean(result.error) || !result.data?.length;

async function clientForMagicLink(admin, url, anonKey, email) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("Magic link was not generated.");
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  return client;
}

async function main() {
  const [envSource, stateSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, ".env.local"), "utf8"),
    fs.readFile(statePath, "utf8"),
  ]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const ids = state.created_object_ids;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ownerData, error: ownerError } = await admin.auth.admin.getUserById(state.user_id);
  if (ownerError || !ownerData.user?.email) throw ownerError ?? new Error("QA owner was not found.");
  const owner = await clientForMagicLink(
    admin,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ownerData.user.email,
  );

  let outsiderId = null;
  const outsiderPassword = `Qa!${crypto.randomUUID()}x7`;
  const outsiderEmail = `alamin-e2e-outsider-${Date.now()}@example.invalid`;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password: outsiderPassword,
      email_confirm: true,
      user_metadata: { qa_marker: `${state.marker}-OUTSIDER` },
    });
    if (createError || !created.user) throw createError ?? new Error("QA outsider was not created.");
    outsiderId = created.user.id;
    const outsider = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await outsider.auth.signInWithPassword({ email: outsiderEmail, password: outsiderPassword });
    if (signInError) throw signInError;

    const anonBaseRead = await anonymous.from("specialists").select("id").eq("id", ids.specialist_id);
    const anonPublicRead = await anonymous.from("published_specialists").select("*").eq("id", ids.specialist_id);
    const anonStorageRead = await anonymous.storage.from("profile-media").download(ids.media_path);
    const ownerPublish = await owner.rpc("publish_approved_application", { application_uuid: ids.application_id });
    const ownerApprove = await owner.rpc("apply_specialist_revision", {
      revision_uuid: ids.revision_id,
      approve: true,
      note: "QA owner must not approve",
    });
    const ownerDirectProfileUpdate = await owner
      .from("specialists")
      .update({ city: "UNAUTHORIZED-OWNER-UPDATE" })
      .eq("id", ids.specialist_id)
      .select("id");
    const outsiderApplicationUpdate = await outsider
      .from("applications")
      .update({ city: "UNAUTHORIZED-OUTSIDER-UPDATE" })
      .eq("id", ids.application_id)
      .select("id");
    const outsiderRevisionInsert = await outsider
      .from("specialist_revisions")
      .insert({
        specialist_id: ids.specialist_id,
        owner_id: outsiderId,
        payload: { contract_version: 2 },
      })
      .select("id");
    const { data: integrity } = await admin
      .from("specialists")
      .select("city")
      .eq("id", ids.specialist_id)
      .single();
    const { data: applicationIntegrity } = await admin
      .from("applications")
      .select("city")
      .eq("id", ids.application_id)
      .single();

    const publicRow = anonPublicRead.data?.[0] ?? {};
    const results = {
      anon_base_specialists_blocked: Boolean(anonBaseRead.error),
      anon_public_view_reads_qa_profile: !anonPublicRead.error && anonPublicRead.data?.length === 1,
      anon_public_view_omits_private_fields:
        !("owner_id" in publicRow) &&
        !("public_contact" in publicRow) &&
        !("contact" in publicRow) &&
        !("internal_notes" in publicRow),
      anon_private_storage_download_blocked: Boolean(anonStorageRead.error),
      owner_publish_rpc_blocked: Boolean(ownerPublish.error),
      owner_revision_approval_blocked: Boolean(ownerApprove.error),
      owner_direct_profile_update_blocked:
        blocked(ownerDirectProfileUpdate) && integrity?.city === "Тестоград",
      outsider_application_update_blocked:
        blocked(outsiderApplicationUpdate) && applicationIntegrity?.city === "Тестоград",
      outsider_revision_insert_blocked: Boolean(outsiderRevisionInsert.error),
      outsider_user_id: outsiderId,
      outsider_deleted: false,
    };
    const { error: deleteError } = await admin.auth.admin.deleteUser(outsiderId);
    if (deleteError) throw deleteError;
    results.outsider_deleted = true;
    await fs.writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } finally {
    if (outsiderId) {
      const { data } = await admin.auth.admin.getUserById(outsiderId);
      if (data.user) await admin.auth.admin.deleteUser(outsiderId).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
