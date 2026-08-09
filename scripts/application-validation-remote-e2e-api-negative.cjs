const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");

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

async function authenticatedCookie(admin, url, anonKey, email) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("QA auth link was not generated.");
  let jar = [];
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => jar,
      setAll: (items) => {
        const next = new Map(jar.map((item) => [item.name, item]));
        for (const item of items) next.set(item.name, item);
        jar = [...next.values()];
      },
    },
  });
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  return jar.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function probe(label, cookie, body) {
  const response = await fetch("http://localhost:3000/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const serialized = JSON.stringify(payload ?? {});
  return {
    label,
    http_status: response.status,
    field: payload && typeof payload === "object" ? payload.field ?? null : null,
    response_keys: payload && typeof payload === "object" ? Object.keys(payload).sort() : [],
    safe_message_present: Boolean(payload && typeof payload === "object" && typeof payload.error === "string" && payload.error.length > 0),
    raw_internal_error_absent: !/(?:42501|permission denied|service_role|supabase|stack|postgres)/i.test(serialized),
  };
}

async function main() {
  const [envSource, stateSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, ".env.local"), "utf8"),
    fs.readFile(statePath, "utf8"),
  ]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const [{ data: userData, error: userError }, { data: categories, error: categoryError }] = await Promise.all([
    admin.auth.admin.getUserById(state.user_id),
    admin.from("categories").select("id").eq("is_active", true).order("name").limit(1),
  ]);
  if (userError || !userData.user?.email) throw userError ?? new Error("QA user was not found.");
  if (categoryError || !categories?.[0]?.id) throw categoryError ?? new Error("No active category was found.");
  const cookie = await authenticatedCookie(admin, env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, userData.user.email);
  const base = {
    fullName: "Тестовый Специалист",
    contactMethod: "phone",
    contact: "+79990000000",
    country: "Россия",
    city: "Тестоград",
    categoryId: categories[0].id,
    additionalCategoryIds: [],
    specialization: "QA проверка",
    experienceYears: "3",
    profileSummary: state.marker,
    description: `${state.marker}. Контролируемое описание специалиста для проверки серверной валидации приложения.`,
    helpTopics: [{ title: "Тестовая задача", description: "Контролируемое направление помощи" }],
    workOffers: [{ title: "Тестовая консультация", duration_minutes: 45, mode: "online", price: 1500, currency: "RUB" }],
    mainImagePath: `submissions/${state.user_id}/avatar/${crypto.randomUUID()}.webp`,
    truthful: true,
    personalData: true,
    website: "",
  };
  const definitions = [
    ["unknown top-level field", { ...base, unexpected: "blocked" }],
    ["wrong field type", { ...base, fullName: 123 }],
    ["invalid name", { ...base, fullName: "12345" }],
    ["letters in phone", { ...base, contact: "+7ABC1234567" }],
    ["invalid telegram", { ...base, contactMethod: "telegram", contact: "bad-link!" }],
    ["negative experience", { ...base, experienceYears: "-1" }],
    ["unknown category", { ...base, categoryId: crypto.randomUUID() }],
    ["description over field limit", { ...base, description: "Я".repeat(3001) }],
    ["request over transport limit", { ...base, profileSummary: "Я".repeat(100000) }],
  ];
  const results = [];
  for (const [label, body] of definitions) results.push(await probe(label, cookie, body));
  const expectedStatuses = [422, 422, 422, 422, 422, 422, 422, 422, 413];
  if (results.some((item, index) => item.http_status !== expectedStatuses[index] || !item.safe_message_present || !item.raw_internal_error_absent)) throw new Error("Unexpected server validation response.");
  const { count, error: countError } = await admin.from("applications").select("id", { count: "exact", head: true }).eq("profile_summary", state.marker);
  if (countError) throw countError;
  if (count !== 0) throw new Error("An invalid API probe created an application.");
  await fs.writeFile(path.join(outputDir, "api-negative-results.json"), `${JSON.stringify({ marker: state.marker, probes: results, qa_rows_created: 0 }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ probes_passed: results.length, qa_rows_created: 0 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
