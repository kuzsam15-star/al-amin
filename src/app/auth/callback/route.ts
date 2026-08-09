import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { authCallbackFlow, callbackFailurePath } from "@/lib/auth-flow";
import { supabasePublicConfig } from "@/lib/env";
import { canonicalAppUrl, safeNextPath } from "@/lib/navigation";
import { PKCE_FLOW_ID_QUERY_PARAM, SUPABASE_AUTH_OPTIONS } from "@/lib/supabase/auth-options";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get(PKCE_FLOW_ID_QUERY_PARAM);
  const flow = authCallbackFlow(url.searchParams.get("flow"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNextPath(url.searchParams.get("next"), "/cabinet");
  const response = NextResponse.redirect(canonicalAppUrl(next, "/cabinet"));
  const { url: supabaseUrl, anonKey } = supabasePublicConfig();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    auth: SUPABASE_AUTH_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (error) {
      response.headers.set("location", canonicalAppUrl(callbackFailurePath(flow, error, next), "/login").toString());
    }
  } else if (tokenHash && (type === "signup" || type === "magiclink" || type === "recovery" || type === "email_change")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      const tokenFlow = type === "signup" ? "confirmation" : "unknown";
      response.headers.set("location", canonicalAppUrl(callbackFailurePath(tokenFlow, error, next), "/login").toString());
    }
  }

  return response;
}
