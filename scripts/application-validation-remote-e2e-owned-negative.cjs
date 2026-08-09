const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "outputs", "application-form-validation-remote-e2e-2026-08-09");
const statePath = path.join(outputDir, "qa-state.json");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [key, value];
  }));
}

async function probe(baseUrl, anonKey, token, method, table, id, body) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?id=eq.${id}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { method, table, id, http_status: response.status, postgres_code: payload?.code ?? null, denied: response.status === 403 && payload?.code === "42501" };
}

async function main() {
  const [envSource, stateSource] = await Promise.all([fs.readFile(path.join(projectRoot, ".env.local"), "utf8"), fs.readFile(statePath, "utf8")]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const ids = state.created_object_ids;
  if (!ids.application_id) throw new Error("QA application ID is missing.");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(state.user_id);
  if (userError || !userData.user?.email) throw userError ?? new Error("QA user was not found.");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: userData.user.email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("QA auth link was not generated.");
  const owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyError } = await owner.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verifyError || !verified.session?.access_token) throw verifyError ?? new Error("QA session was not created.");
  const token = verified.session.access_token;
  const probes = [
    await probe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token, "PATCH", "applications", ids.application_id, { city: "UNAUTHORIZED-DIRECT-UPDATE" }),
    await probe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token, "DELETE", "applications", ids.application_id),
  ];
  if (ids.revision_id) {
    probes.push(
      await probe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token, "PATCH", "specialist_revisions", ids.revision_id, { payload: { contract_version: 2, profile_summary: "UNAUTHORIZED-DIRECT-UPDATE" } }),
      await probe(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token, "DELETE", "specialist_revisions", ids.revision_id),
    );
  }
  if (probes.some((item) => !item.denied)) throw new Error("An exact-ID Data API probe was not denied.");
  const [{ data: application, error: appError }, revisionResult] = await Promise.all([
    admin.from("applications").select("id,city,owner_id,contract_version").eq("id", ids.application_id).maybeSingle(),
    ids.revision_id ? admin.from("specialist_revisions").select("id,owner_id,payload,status").eq("id", ids.revision_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (appError || revisionResult.error) throw appError ?? revisionResult.error;
  if (!application || application.city === "UNAUTHORIZED-DIRECT-UPDATE" || application.owner_id !== state.user_id || application.contract_version !== 2) throw new Error("QA application integrity check failed.");
  if (ids.revision_id && (!revisionResult.data || revisionResult.data.payload?.profile_summary === "UNAUTHORIZED-DIRECT-UPDATE" || revisionResult.data.owner_id !== state.user_id)) throw new Error("QA revision integrity check failed.");
  const result = { marker: state.marker, probes, application_integrity_preserved: true, revision_integrity_preserved: ids.revision_id ? true : null };
  await fs.writeFile(path.join(outputDir, "data-api-owned-negative-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ probes_denied: probes.length, application_integrity_preserved: true, revision_integrity_preserved: result.revision_integrity_preserved })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
