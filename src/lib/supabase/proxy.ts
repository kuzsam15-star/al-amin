import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig } from "@/lib/env";
import { SUPABASE_AUTH_OPTIONS } from "@/lib/supabase/auth-options";

const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const { url, anonKey } = supabasePublicConfig();
    const supabase = createServerClient(url, anonKey, {
      auth: SUPABASE_AUTH_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable." }, { status: 503, headers: PRIVATE_CACHE_HEADERS });
  }
  for (const [name, value] of Object.entries(PRIVATE_CACHE_HEADERS)) response.headers.set(name, value);
  return response;
}
