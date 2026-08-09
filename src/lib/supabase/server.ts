import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublicConfig, supabaseServiceConfig } from "@/lib/env";
import { SUPABASE_AUTH_OPTIONS } from "@/lib/supabase/auth-options";

export function isSupabaseConfigured() {
  try { supabasePublicConfig(); return true; } catch { return false; }
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = supabasePublicConfig();
  const cookieStore = await cookies();
  return createServerClient(
    url,
    anonKey,
    {
      auth: SUPABASE_AUTH_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* Server Components cannot set cookies. */ }
        },
      },
    },
  );
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = supabaseServiceConfig();
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
