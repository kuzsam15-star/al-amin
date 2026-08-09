import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";
import {
  classifyMagicLinkError,
  magicLinkResultPath,
} from "../src/lib/auth-flow.ts";
import { resolveCanonicalSiteOrigin, safeNextPath } from "../src/lib/navigation.ts";
import { SUPABASE_AUTH_OPTIONS } from "../src/lib/supabase/auth-options.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("magic-link success is the only outcome that selects the success state", async () => {
  const actions = await read("src/app/register/actions.ts");

  assert.equal(magicLinkResultPath(null, "/apply"), "/login?next=%2Fapply&message=magic");
  assert.match(actions, /const \{ error \} = await supabase\.auth\.signInWithOtp/);
  assert.match(actions, /redirect\(magicLinkResultPath\(error, next\)\)/);
  assert.doesNotMatch(actions, /signInWithOtp\([\s\S]*?\);\s*redirect\(`\/login\?next=.*message=magic`\)/);
});

test("a Supabase magic-link error cannot fall through to success", () => {
  const path = magicLinkResultPath(
    { code: "smtp_error", status: 500 },
    "/cabinet",
  );

  assert.equal(path, "/login?next=%2Fcabinet&error=magic-send");
  assert.doesNotMatch(path, /message=magic/);
});

test("magic-link errors render safe copy without internal details", async () => {
  const page = await read("src/app/login/page.tsx");

  assert.match(page, /Не удалось отправить ссылку для входа\./);
  assert.match(page, /Если у вас ещё нет аккаунта/);
  assert.match(page, /href={`\/register\?next=\$\{encodeURIComponent\(destination\)\}`}/);
  assert.match(page, />зарегистрируйтесь<\/Link>/);
  assert.match(page, /magicError && <p className="form-message error" role="alert">/);
  assert.match(page, /error && !magicError/);
  assert.doesNotMatch(page, /error\.message|smtp_error|SMTP response|statusText/);
  assert.doesNotMatch(magicLinkResultPath({ code: "private_smtp_detail" }, "/apply"), /private_smtp_detail/);
});

test("login magic-link explicitly prevents unknown-user creation", async () => {
  const actions = await read("src/app/register/actions.ts");
  let requestBody;
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.match(url.pathname, /\/otp$/);
    requestBody = JSON.parse(String(init.body));
    return Response.json({ code: "otp_disabled", msg: "Signups not allowed for otp" }, { status: 422 });
  };
  const client = createServerClient("https://project.supabase.co", "anon-key", {
    auth: SUPABASE_AUTH_OPTIONS,
    global: { fetch: fakeFetch },
    cookies: { getAll: () => [], setAll: () => {} },
  });

  const result = await client.auth.signInWithOtp({
    email: "unknown@example.test",
    options: {
      shouldCreateUser: false,
      emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fapply&flow=magiclink",
    },
  });

  assert.equal(requestBody.create_user, false);
  assert.ok(result.error);
  assert.match(actions, /signInWithOtp\([\s\S]*?shouldCreateUser: false/);
});

test("password registration keeps its separate signUp flow", async () => {
  const actions = await read("src/app/register/actions.ts");
  const registration = actions.slice(actions.indexOf("export async function register"), actions.indexOf("export async function sendMagicLink"));

  assert.match(registration, /supabase\.auth\.signUp/);
  assert.doesNotMatch(registration, /shouldCreateUser/);
});

test("known magic-link rate limits receive their own safe state", () => {
  assert.equal(classifyMagicLinkError({ code: "over_email_send_rate_limit" }), "rate-limit");
  assert.equal(classifyMagicLinkError({ code: "over_request_rate_limit" }), "rate-limit");
  assert.equal(classifyMagicLinkError({ status: 429 }), "rate-limit");
  assert.equal(
    magicLinkResultPath({ code: "rate_limit_exceeded" }, "/apply"),
    "/login?next=%2Fapply&error=magic-rate-limit",
  );
});

test("magic-link callback keeps the canonical origin and a safe local next path", async () => {
  const actions = await read("src/app/register/actions.ts");
  const safeNext = safeNextPath("https://evil.example/steal", "/apply");

  assert.equal(safeNext, "/apply");
  assert.equal(resolveCanonicalSiteOrigin("http://0.0.0.0:3000", "development"), "http://localhost:3000");
  assert.equal(magicLinkResultPath(null, safeNext), "/login?next=%2Fapply&message=magic");
  assert.match(actions, /const next = safeNextPath\(formData\.get\("next"\), "\/apply"\)/);
  assert.match(actions, /const origin = canonicalSiteOrigin\(\)/);
  assert.match(actions, /authCallbackUrl\(origin, next, "magiclink"\)/);
});

test("missing magic-link flow context renders actionable copy without internals", async () => {
  const page = await read("src/app/login/page.tsx");

  assert.match(page, /Не удалось завершить вход по ссылке/);
  assert.match(page, /Ссылка была открыта в другом браузере или устройстве/);
  assert.match(page, /Запросите новую ссылку и откройте её в том же браузере/);
  assert.match(page, /`\/login\?next=\$\{encodeURIComponent\(destination\)\}#magic-link`/);
  assert.match(page, />Запросить новую ссылку<\/Link>/);
  assert.match(page, /id="magic-link"/);
  assert.match(page, /id="password-login"/);
  assert.doesNotMatch(page, /bad_code_verifier|AuthPKCECodeVerifierMissingError|PKCE verifier|cookies?/i);
  assert.match(page, /if \(error === "confirmation"\) return "Не удалось завершить подтверждение\./);
});
