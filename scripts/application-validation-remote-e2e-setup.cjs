const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
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

async function restProbe({ baseUrl, anonKey, accessToken, role, method, table, query = "", body }) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${role === "authenticated" ? accessToken : anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return {
    role,
    method,
    table,
    http_status: response.status,
    postgres_code: payload && typeof payload === "object" && typeof payload.code === "string" ? payload.code : null,
    denied: response.status === 401 || response.status === 403,
  };
}

async function main() {
  const env = parseEnv(await fs.readFile(path.join(projectRoot, ".env.local"), "utf8"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase credentials are not configured.");
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const marker = `ALAMIN-REMOTE-E2E-20260809-${stamp}`;
  const email = `alamin-remote-e2e-${stamp.toLowerCase()}@example.invalid`;
  const password = `Qa!${crypto.randomUUID()}x9`;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let userId = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_marker: marker },
    });
    if (createError || !created.user) throw createError ?? new Error("QA user was not created.");
    userId = created.user.id;

    const owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signedIn, error: signInError } = await owner.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session?.access_token) throw signInError ?? new Error("QA sign-in failed.");
    const fakeId = crypto.randomUUID();
    const commonApplication = { id: fakeId, owner_id: userId, full_name: marker, profile_summary: marker };
    const commonRevision = { id: crypto.randomUUID(), specialist_id: crypto.randomUUID(), owner_id: userId, status: "pending" };
    const probeDefinitions = [
      ...[1, 2, undefined, null].map((contractVersion) => ({
        role: "authenticated", method: "POST", table: "applications",
        body: { ...commonApplication, ...(contractVersion === undefined ? {} : { contract_version: contractVersion }) },
        label: `authenticated applications INSERT contract=${String(contractVersion)}`,
      })),
      { role: "authenticated", method: "PATCH", table: "applications", query: `?id=eq.${fakeId}`, body: { city: marker }, label: "authenticated applications UPDATE" },
      { role: "authenticated", method: "DELETE", table: "applications", query: `?id=eq.${fakeId}`, label: "authenticated applications DELETE" },
      ...[1, 2, undefined, null].map((contractVersion) => ({
        role: "authenticated", method: "POST", table: "specialist_revisions",
        body: { ...commonRevision, payload: contractVersion === undefined ? { profile_summary: marker } : { contract_version: contractVersion, profile_summary: marker } },
        label: `authenticated revisions INSERT contract=${String(contractVersion)}`,
      })),
      { role: "authenticated", method: "PATCH", table: "specialist_revisions", query: `?id=eq.${commonRevision.id}`, body: { payload: { contract_version: 2, profile_summary: marker } }, label: "authenticated revisions UPDATE" },
      { role: "authenticated", method: "DELETE", table: "specialist_revisions", query: `?id=eq.${commonRevision.id}`, label: "authenticated revisions DELETE" },
      { role: "anon", method: "POST", table: "applications", body: { ...commonApplication, contract_version: 2 }, label: "anon applications INSERT" },
      { role: "anon", method: "PATCH", table: "applications", query: `?id=eq.${fakeId}`, body: { city: marker }, label: "anon applications UPDATE" },
      { role: "anon", method: "DELETE", table: "applications", query: `?id=eq.${fakeId}`, label: "anon applications DELETE" },
      { role: "anon", method: "POST", table: "specialist_revisions", body: { ...commonRevision, payload: { contract_version: 2, profile_summary: marker } }, label: "anon revisions INSERT" },
      { role: "anon", method: "PATCH", table: "specialist_revisions", query: `?id=eq.${commonRevision.id}`, body: { payload: { contract_version: 2, profile_summary: marker } }, label: "anon revisions UPDATE" },
      { role: "anon", method: "DELETE", table: "specialist_revisions", query: `?id=eq.${commonRevision.id}`, label: "anon revisions DELETE" },
    ];
    const results = [];
    for (const probe of probeDefinitions) {
      results.push({ label: probe.label, ...(await restProbe({
        baseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        accessToken: signedIn.session.access_token,
        role: probe.role,
        method: probe.method,
        table: probe.table,
        query: probe.query,
        body: probe.body,
      })) });
    }
    if (results.some((result) => !result.denied)) throw new Error("At least one Data API write probe was not denied.");
    const [{ count: applicationCount, error: applicationError }, { count: revisionCount, error: revisionError }] = await Promise.all([
      admin.from("applications").select("id", { count: "exact", head: true }).eq("profile_summary", marker),
      admin.from("specialist_revisions").select("id", { count: "exact", head: true }).contains("payload", { profile_summary: marker }),
    ]);
    if (applicationError || revisionError) throw applicationError ?? revisionError;
    if (applicationCount !== 0 || revisionCount !== 0) throw new Error("A negative probe created a database row.");

    const state = {
      marker,
      user_id: userId,
      email_domain: "example.invalid",
      email_confirmed: Boolean(created.user.email_confirmed_at),
      created_at: new Date().toISOString(),
      created_object_ids: {},
    };
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(outputDir, "data-api-initial-negative-results.json"), `${JSON.stringify({ marker, probes: results, rows_created: { applications: 0, revisions: 0 } }, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ created: true, marker, user_id: userId, email_confirmed: state.email_confirmed, probes_denied: results.length })}\n`);
  } catch (error) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
