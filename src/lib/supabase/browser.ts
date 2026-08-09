import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_AUTH_OPTIONS } from "@/lib/supabase/auth-options";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: SUPABASE_AUTH_OPTIONS },
  );
}
