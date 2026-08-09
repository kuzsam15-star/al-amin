function configured(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("your-") || value.includes("replace-me")) throw new Error(`Required server configuration is missing: ${name}`);
  return value;
}

export function supabasePublicConfig() {
  const url = configured("NEXT_PUBLIC_SUPABASE_URL");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("invalid protocol");
  } catch {
    throw new Error("Required server configuration is invalid: NEXT_PUBLIC_SUPABASE_URL");
  }
  return { url, anonKey: configured("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

export function supabaseServiceConfig() {
  return { ...supabasePublicConfig(), serviceRoleKey: configured("SUPABASE_SERVICE_ROLE_KEY") };
}
