import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("password login gives a concise safe error with a registration path", async () => {
  const [actions, page] = await Promise.all([
    read("src/app/login/actions.ts"),
    read("src/app/login/page.tsx"),
  ]);
  assert.match(actions, /error\.code === "invalid_credentials"/);
  assert.match(actions, /error\.code === "email_not_confirmed"/);
  assert.match(page, /Email или пароль не подошли/);
  assert.match(page, /Если у вас ещё нет аккаунта/);
  assert.match(page, /login-error-register-link/);
  assert.match(page, /href=\{`\/register\?next=\$\{encodeURIComponent\(destination\)\}`\}/);
  assert.doesNotMatch(page, /Если вы регистрировались через Google и не устанавливали пароль/);
  assert.doesNotMatch(page, /войдите через Google ниже/);
  assert.doesNotMatch(page, /аккаунт с таким email существует/i);
});

test("registration classifies local and Supabase errors without an admin email lookup", async () => {
  const [actions, page] = await Promise.all([
    read("src/app/register/actions.ts"),
    read("src/app/register/page.tsx"),
  ]);
  assert.match(actions, /supabase\.auth\.signUp/);
  assert.match(actions, /\.trim\(\)\.toLowerCase\(\)/);
  assert.match(actions, /error=email/);
  assert.match(actions, /error=password/);
  assert.match(actions, /"email_exists", "user_already_exists", "identity_already_exists"/);
  assert.match(actions, /message=signup/);
  assert.doesNotMatch(actions, /auth\.admin|listUsers|getUserById/);
  assert.match(page, /Проверьте формат email/);
  assert.match(page, /Пароль должен содержать минимум 8 символов/);
  assert.match(page, /Не удалось завершить регистрацию/);
  assert.doesNotMatch(page, /Этот email уже используется/);
});

test("registration uses the compact Civic auth column without changing its auth flow", async () => {
  const [page, civic] = await Promise.all([
    read("src/app/register/page.tsx"),
    read("src/app/civic.css"),
  ]);
  assert.match(page, /register-auth-container/);
  assert.match(page, /register-auth-card/);
  assert.match(page, /register-auth-oauth/);
  assert.match(civic, /\.register-auth-container\s*\{[^}]*620px/s);
  assert.match(civic, /\.register-auth-card :is\(input, \.button\)\s*\{ min-height: 50px; \}/);
  assert.match(civic, /\.register-auth-oauth \.oauth-button\s*\{ min-height: 48px; \}/);
  assert.match(page, /action=\{register\}/);
  assert.match(page, /<OAuthButtons next=\{destination\}/);
});

test("successful registration renders a focused confirmation state instead of the login form", async () => {
  const [actions, page, civic] = await Promise.all([
    read("src/app/register/actions.ts"),
    read("src/app/login/page.tsx"),
    read("src/app/civic.css"),
  ]);
  assert.match(actions, /message=signup/);
  assert.match(page, /message === "signup"/);
  assert.match(page, /RegistrationConfirmationState/);
  assert.match(page, /Проверьте почту/);
  assert.match(page, /Мы отправили письмо для подтверждения на ваш email/);
  assert.match(page, /Проверьте папку «Спам»/);
  assert.match(page, /resend-confirmation\?next=/);
  assert.doesNotMatch(page, /Если это новый email, письмо подтверждения отправлено/);
  assert.doesNotMatch(page, /войдите через Google ниже/);
  assert.match(civic, /\.registration-confirmation-card/);
});

test("email confirmation keeps the existing callback and intended destination", async () => {
  const [actions, callback] = await Promise.all([
    read("src/app/register/actions.ts"),
    read("src/app/auth/callback/route.ts"),
  ]);
  assert.match(actions, /emailRedirectTo: authCallbackUrl\(origin, next, "confirmation"\)/);
  assert.match(callback, /exchangeCodeForSession\(code, flowId \? \{ flowId \} : undefined\)/);
  assert.match(callback, /PKCE_FLOW_ID_QUERY_PARAM/);
  assert.match(callback, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(callback, /NextResponse\.redirect\(canonicalAppUrl\(next, "\/cabinet"\)\)/);
});

test("login password visibility control is accessible and cannot submit the form", async () => {
  const field = await read("src/components/PasswordField.tsx");
  assert.match(field, /type=\{visible \? "text" : "password"\}/);
  assert.match(field, /type="button"/);
  assert.match(field, /Показать пароль/);
  assert.match(field, /Скрыть пароль/);
  assert.match(field, /autoComplete="current-password"/);
});
