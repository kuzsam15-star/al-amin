import { createClient } from "@supabase/supabase-js";

export function createPublicClient(accessToken?: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false }, global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined });
}
