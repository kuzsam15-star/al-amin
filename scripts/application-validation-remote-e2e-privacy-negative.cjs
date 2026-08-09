const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
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

async function restProbe(baseUrl, anonKey, token, method, table, id, body) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?id=eq.${id}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { method, table, http_status: response.status, postgres_code: payload?.code ?? null, denied: response.status === 403 && payload?.code === "42501" };
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
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: publicProfile, error: publicError } = await anon.from("published_specialists").select("*").eq("id", ids.specialist_id).single();
  if (publicError || !publicProfile) throw publicError ?? new Error("Published QA profile is missing.");
  const forbiddenPublicKeys = ["owner_id", "application_id", "public_contact", "internal_notes", "moderator_id", "verification_method"];
  const exposedKeys = forbiddenPublicKeys.filter((key) => Object.prototype.hasOwnProperty.call(publicProfile, key));
  if (exposedKeys.length) throw new Error(`Public representation exposed forbidden keys: ${exposedKeys.join(", ")}`);

  const { error: baseError } = await anon.from("specialists").select("id").eq("id", ids.specialist_id).maybeSingle();
  if (!baseError) throw new Error("Anonymous base-table read unexpectedly succeeded.");
  const mediaResponse = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/profile-media/${ids.media_path}`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
  });
  if (mediaResponse.ok) throw new Error("Anonymous direct private-media read unexpectedly succeeded.");

  const [{ count: verificationCount, error: verificationError }, { count: trustCount, error: trustError }] = await Promise.all([
    anon.from("published_specialist_verification_facts").select("*", { count: "exact", head: true }).eq("specialist_id", ids.specialist_id),
    anon.from("published_specialist_trust_badges").select("*", { count: "exact", head: true }).eq("specialist_id", ids.specialist_id),
  ]);
  if (verificationError || trustError) throw verificationError ?? trustError;
  if (verificationCount !== 0 || trustCount !== 0) throw new Error("QA profile received unexpected public trust data.");

  const secondaryEmail = `alamin-foreign-e2e-${Date.now()}@example.invalid`;
  const secondaryPassword = `${crypto.randomBytes(24).toString("base64url")}!9aA`;
  let secondaryUserId = null;
  let secondaryDeleted = false;
  const foreignProbes = [];
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email: secondaryEmail, password: secondaryPassword, email_confirm: true, user_metadata: { purpose: "AL-AMIN controlled non-owner RLS probe" } });
    if (createError || !created.user) throw createError ?? new Error("Secondary QA user was not created.");
    secondaryUserId = created.user.id;
    const foreign = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signedIn, error: signInError } = await foreign.auth.signInWithPassword({ email: secondaryEmail, password: secondaryPassword });
    if (signInError || !signedIn.session?.access_token) throw signInError ?? new Error("Secondary QA session was not created.");
    foreignProbes.push(
      await restProbe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, signedIn.session.access_token, "PATCH", "applications", ids.application_id, { city: "FOREIGN-UPDATE" }),
      await restProbe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, signedIn.session.access_token, "DELETE", "applications", ids.application_id),
      await restProbe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, signedIn.session.access_token, "PATCH", "specialist_revisions", ids.revision_id, { status: "approved" }),
      await restProbe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, signedIn.session.access_token, "DELETE", "specialist_revisions", ids.revision_id),
    );
    if (foreignProbes.some((probe) => !probe.denied)) throw new Error("A non-owner Data API write was not denied.");
  } finally {
    if (secondaryUserId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(secondaryUserId);
      if (deleteError) throw deleteError;
      secondaryDeleted = true;
    }
  }

  const result = {
    marker: state.marker,
    public_profile_readable: true,
    public_profile_columns: Object.keys(publicProfile).sort(),
    forbidden_public_keys_absent: true,
    anonymous_base_table_read_denied: true,
    anonymous_private_media_read_denied: true,
    private_media_http_status: mediaResponse.status,
    public_verification_count: verificationCount,
    public_trust_badge_count: trustCount,
    non_owner_probes: foreignProbes,
    secondary_user_id: secondaryUserId,
    secondary_user_deleted: secondaryDeleted,
  };
  await fs.writeFile(path.join(outputDir, "privacy-negative-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ public_profile_readable: true, forbidden_public_keys_absent: true, anon_base_denied: true, anon_private_media_denied: true, non_owner_probes_denied: foreignProbes.length, secondary_user_deleted: secondaryDeleted })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
