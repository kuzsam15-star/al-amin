"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalSiteOrigin, safeNextPath } from "@/lib/navigation";
import { classifyResendError, magicLinkResultPath } from "@/lib/auth-flow";

function authCallbackUrl(origin: string, next: string, flow: "confirmation" | "magiclink") {
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", next);
  callback.searchParams.set("flow", flow);
  return callback.toString();
}

export async function register(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"), "/apply");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/register?next=${encodeURIComponent(next)}&error=email`);
  }
  if (password.length < 8) {
    redirect(`/register?next=${encodeURIComponent(next)}&error=password`);
  }

  const supabase = await createSupabaseServerClient();
  const origin = canonicalSiteOrigin();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authCallbackUrl(origin, next, "confirmation") },
  });

  if (error) {
    const reason = ["email_exists", "user_already_exists", "identity_already_exists"].includes(error.code ?? "")
      ? "account"
      : "signup";
    redirect(`/register?next=${encodeURIComponent(next)}&error=${reason}`);
  }

  // Keep the confirmation state generic: putting the submitted address in the
  // redirect URL would expose it through browser history and referrer metadata.
  redirect(`/login?next=${encodeURIComponent(next)}&message=signup`);
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNextPath(formData.get("next"), "/apply");
  const supabase = await createSupabaseServerClient();
  const origin = canonicalSiteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: authCallbackUrl(origin, next, "magiclink"),
    },
  });
  redirect(magicLinkResultPath(error, next));
}

const confirmationRequests = new Map<string, number>();

export async function resendConfirmation(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const safeNext = safeNextPath(formData.get("next"), "/apply");
  const back = `/resend-confirmation?next=${encodeURIComponent(safeNext)}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`${back}&error=email`);

  const now = Date.now();
  if (now - (confirmationRequests.get(email) ?? 0) < 60_000) redirect(`${back}&message=wait`);

  const supabase = await createSupabaseServerClient();
  const origin = canonicalSiteOrigin();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: authCallbackUrl(origin, safeNext, "confirmation") },
  });
  const resendError = classifyResendError(error);
  if (resendError) redirect(`${back}&error=${resendError}`);

  confirmationRequests.set(email, now);
  redirect(`/login?next=${encodeURIComponent(safeNext)}&message=confirm-sent`);
}
