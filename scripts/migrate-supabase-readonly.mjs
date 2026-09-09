import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function loadEnv(file) {
  const source = await readFile(file, "utf8");
  return Object.fromEntries(source.split(/\r?\n/u).filter((line) => line && !line.trimStart().startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/gu, "")];
  }));
}

const env = await loadEnv(path.resolve(".env.local"));
const origin = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!origin || !anonKey) throw new Error("В .env.local нет публичной read-only конфигурации Supabase.");

async function query(resource) {
  const response = await fetch(`${origin}/rest/v1/${resource}`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (!response.ok) throw new Error(`Read-only export failed: ${response.status} ${response.statusText}`);
  return response.json();
}

if (!process.argv.includes("--stage")) {
  const response = await fetch(`${origin}/rest/v1/published_specialists?select=id`, {
    method: "HEAD",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Prefer: "count=exact", Range: "0-0" }
  });
  if (!response.ok) throw new Error(`Read-only count failed: ${response.status} ${response.statusText}`);
  const range = response.headers.get("content-range") || "*/unknown";
  console.log(`Published profiles available for owner-reviewed migration: ${range.split("/").at(-1)}.`);
  process.exit(0);
}

const profiles = await query("published_specialists?select=id,slug,full_name,country,city,category_name,specialization,service_mode,experience_years,profile_summary,full_description,help_topics,work_offers,avatar_path,published_at&order=full_name");
console.log(`Published profiles available for review: ${profiles.length}.`);

if (process.argv.includes("--stage")) {
  const ids = profiles.map((item) => item.id);
  const facts = ids.length ? await query(`published_specialist_verification_facts?select=*&specialist_id=in.(${ids.join(",")})`) : [];
  const factsById = new Map(facts.map((item) => [item.specialist_id, item]));
  const factLabels = [
    ["identity_checked", "Личность специалиста"],
    ["education_checked", "Сведения об образовании"],
    ["experience_checked", "Заявленный профессиональный опыт"],
    ["qualifications_checked", "Сведения о квалификации"],
    ["references_checked", "Предоставленные рекомендации"]
  ];
  const specialists = profiles.map((item, index) => {
    const verification = factsById.get(item.id);
    return {
      id: item.id,
      slug: item.slug,
      fullName: item.full_name,
      photo: { src: `/images/specialists/${item.slug}/profile.webp`, alt: `Фотография ${item.full_name}` },
      specialization: item.specialization || item.category_name || "Специалист",
      categories: [item.category_name].filter(Boolean),
      country: item.country,
      city: item.city,
      workMode: item.service_mode || "both",
      profileSummary: item.profile_summary || "",
      about: item.full_description || item.profile_summary || "",
      helpTopics: Array.isArray(item.help_topics) ? item.help_topics : [],
      workOffers: Array.isArray(item.work_offers) ? item.work_offers.map((offer) => ({
        title: offer.title,
        durationMinutes: offer.duration_minutes ?? null,
        mode: offer.mode || "both",
        price: offer.price ?? null,
        currency: offer.currency ?? null
      })) : [],
      experienceYears: item.experience_years ?? null,
      trust: {
        recommendedByAlAmin: Boolean(verification),
        verificationDate: verification?.checked_at?.slice(0, 10),
        verificationSummary: verification ? "Перенесено из прежней системы для проверки владельцем каталога." : undefined,
        verifiedFacts: verification ? factLabels.filter(([key]) => verification[key]).map(([, label]) => label) : []
      },
      contacts: {},
      portfolio: [],
      published: false,
      featured: false,
      sortOrder: index,
      migrationReview: {
        sourceMediaPath: item.avatar_path,
        contactsRequireOwnerApproval: true,
        photoRequiresStaticCopy: true
      }
    };
  });
  const output = path.resolve(".local-editor", "migration", "supabase-public-preview.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version: 1, specialists }, null, 2) + "\n", "utf8");
  console.log(`Staged ${specialists.length} unpublished records for owner review. No contacts were exported and no cloud data was changed.`);
}
