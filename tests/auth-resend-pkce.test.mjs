import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";
import { classifyResendError, callbackFailurePath } from "../src/lib/auth-flow.ts";
import { resolveCanonicalSiteOrigin, safeNextPath } from "../src/lib/navigation.ts";
import { SUPABASE_AUTH_OPTIONS } from "../src/lib/supabase/auth-options.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("resend success is the only branch allowed to show success", async () => {
  const [actions, page, login] = await Promise.all([
    read("src/app/register/actions.ts"),
    read("src/app/resend-confirmation/page.tsx"),
    read("src/app/login/page.tsx"),
  ]);

  assert.equal(classifyResendError(null), null);
  assert.equal(classifyResendError({ code: "smtp_error" }), "send");
  assert.equal(classifyResendError({ code: "over_email_send_rate_limit" }), "rate-limit");
  assert.match(actions, /const \{ error \} = await supabase\.auth\.resend/);
  assert.match(actions, /if \(resendError\) redirect\(`\$\{back\}&error=\$\{resendError\}`\)/);
  assert.ok(actions.indexOf("if (resendError)") < actions.indexOf("message=confirm-sent"));
  assert.match(login, /Письмо отправлено\. Проверьте почту\./);
  assert.match(page, /Не удалось отправить письмо\. Попробуйте ещё раз позже\./);
  assert.match(page, /Слишком много попыток\. Попробуйте немного позже\./);
  assert.doesNotMatch(page, /553|SMTP|bad recipient|error\.message/i);
});

test("canonical auth origin never turns a bind address or request Host into a browser URL", async () => {
  const [callback, oauth, recovery] = await Promise.all([
    read("src/app/auth/callback/route.ts"),
    read("src/components/OAuthButtons.tsx"),
    read("src/app/forgot-password/page.tsx"),
  ]);

  assert.equal(resolveCanonicalSiteOrigin(undefined, "development"), "http://localhost:3000");
  assert.equal(resolveCanonicalSiteOrigin("http://0.0.0.0:3000", "development"), "http://localhost:3000");
  assert.equal(resolveCanonicalSiteOrigin("https://al-amin.example/path", "production"), "https://al-amin.example");
  assert.throws(() => resolveCanonicalSiteOrigin(undefined, "production"), /required in production/);
  assert.throws(() => resolveCanonicalSiteOrigin("http://0.0.0.0:3000", "production"), /browser-facing/);
  assert.equal(safeNextPath("//evil.example", "/cabinet"), "/cabinet");
  assert.equal(safeNextPath("https://evil.example", "/cabinet"), "/cabinet");
  assert.equal(safeNextPath("/\\evil.example", "/cabinet"), "/cabinet");
  assert.match(callback, /canonicalAppUrl/);
  assert.doesNotMatch(callback, /url\.origin|request\.nextUrl\.origin|headers\(\).*host/);
  assert.match(oauth, /canonicalAppUrl\("\/auth\/callback"\)/);
  assert.match(recovery, /canonicalAppUrl\("\/reset-password"\)/);
  assert.doesNotMatch(`${oauth}\n${recovery}`, /window\.location\.origin/);
});

test("a PKCE flow keeps its verifier in the same cookie scope and exchanges by flow id", async () => {
  const cookieJar = new Map();
  const cookieWrites = [];
  let callbackFlowId = null;
  let exchangedWithVerifier = false;
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "pkce-qa@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };

  const cookies = {
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    setAll: (items) => {
      for (const item of items) {
        cookieWrites.push({ name: item.name, options: item.options });
        if (item.options?.maxAge === 0 || item.value === "") cookieJar.delete(item.name);
        else cookieJar.set(item.name, item.value);
      }
    },
  };

  const fakeFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/signup")) {
      const redirectTo = new URL(url.searchParams.get("redirect_to"));
      callbackFlowId = redirectTo.searchParams.get("sb_flow_id");
      assert.equal(redirectTo.origin, "http://localhost:3000");
      assert.ok(callbackFlowId);
      return Response.json(user);
    }
    if (url.pathname.endsWith("/token")) {
      const body = JSON.parse(String(init.body));
      exchangedWithVerifier = typeof body.code_verifier === "string" && body.code_verifier.length > 20;
      return Response.json({
        access_token: "qa-access-token",
        refresh_token: "qa-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }
    throw new Error(`Unexpected fake Auth request: ${url.pathname}`);
  };

  const options = {
    auth: SUPABASE_AUTH_OPTIONS,
    global: { fetch: fakeFetch },
    cookies,
  };
  const signupClient = createServerClient("https://project.supabase.co", "anon-key", options);
  const signup = await signupClient.auth.signUp({
    email: user.email,
    password: "not-a-real-password",
    options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fapply&flow=confirmation" },
  });
  assert.equal(signup.error, null);
  assert.ok(callbackFlowId);
  assert.ok([...cookieJar.keys()].some((name) => name.includes(`-flow-${callbackFlowId}-code-verifier`)));
  assert.ok(cookieWrites.some(({ options }) => options?.path === "/" && options?.sameSite === "lax"));

  const callbackClient = createServerClient("https://project.supabase.co", "anon-key", options);
  const exchange = await callbackClient.auth.exchangeCodeForSession("single-use-auth-code", { flowId: callbackFlowId });
  assert.equal(exchange.error, null);
  assert.ok(exchange.data.session);
  assert.equal(exchangedWithVerifier, true);
});

test("confirmation verifier failures become a safe sign-in state without exposing internals", () => {
  const path = callbackFailurePath("confirmation", { code: "bad_code_verifier" }, "/apply");
  assert.equal(path, "/login?next=%2Fapply&message=confirmed");
  assert.doesNotMatch(path, /bad_code_verifier|SMTP|token/i);
  assert.equal(callbackFailurePath("oauth", { code: "bad_code_verifier" }, "/cabinet"), "/login?next=%2Fcabinet&error=oauth");
});

test("magic-link verifier failures get a dedicated safe state and preserve next", () => {
  const missing = callbackFailurePath(
    "magiclink",
    { name: "AuthPKCECodeVerifierMissingError" },
    "/apply",
  );
  const mismatched = callbackFailurePath(
    "magiclink",
    { code: "bad_code_verifier" },
    "/cabinet",
  );

  assert.equal(missing, "/login?next=%2Fapply&error=magic-verifier");
  assert.equal(mismatched, "/login?next=%2Fcabinet&error=magic-verifier");
  assert.doesNotMatch(`${missing}\n${mismatched}`, /bad_code_verifier|AuthPKCE|cookie|token/i);
  assert.equal(
    callbackFailurePath("confirmation", { code: "otp_expired" }, "/apply"),
    "/login?next=%2Fapply&error=confirmation",
  );
});
