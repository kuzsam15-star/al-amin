"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { canonicalAppUrl } from "@/lib/navigation";

function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.74-.07-1.45-.2-2.14H12v4.05h5.23a4.48 4.48 0 0 1-1.94 2.94v2.63h3.14c1.84-1.7 2.92-4.2 2.92-7.48Z"/><path fill="#34A853" d="M12 21.76c2.62 0 4.82-.87 6.43-2.36l-3.14-2.63c-.87.59-1.99.94-3.29.94-2.53 0-4.67-1.7-5.44-4v2.72H3.32A9.72 9.72 0 0 0 12 21.76Z"/><path fill="#FBBC05" d="M6.56 13.71a5.82 5.82 0 0 1 0-3.42V7.57H3.32a9.77 9.77 0 0 0 0 8.86l3.24-2.72Z"/><path fill="#EA4335" d="M12 6.29c1.42 0 2.69.49 3.7 1.46l2.77-2.77C16.81 3.43 14.62 2.24 12 2.24a9.72 9.72 0 0 0-8.68 5.33l3.24 2.72c.77-2.3 2.91-4 5.44-4Z"/></svg>;
}

function VkIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#07F"/><path fill="#fff" d="M17.5 15.4c-.31-.41-2.16-2.01-2.16-2.01-.28-.28-.19-.4 0-.66 0 0 1.95-2.75 2.16-3.68.21-.73-.26-.71-.26-.71h-1.74s-.13.02-.23.09c-.1.07-.16.2-.16.2s-.28.75-.65 1.39c-.78 1.35-1.09 1.42-1.22 1.34-.31-.2-.23-.79-.23-1.21 0-1.32.2-1.87-.39-2.01-.2-.05-.34-.08-.85-.08-.65-.01-1.2 0-1.51.15-.2.1-.35.32-.26.33.11.01.36.07.49.25.17.23.16.74.16.74s.1 1.57-.37 1.76c-.32.13-.76-.14-1.7-1.36-.48-.62-.84-1.31-.84-1.31s-.07-.13-.18-.2A.86.86 0 0 0 7.74 9H6.08s-.25.01-.34.12c-.08.1-.01.31-.01.31s1.3 3.04 2.78 4.57c1.36 1.4 2.91 1.31 2.91 1.31h.7s.21-.02.32-.13c.1-.1.1-.3.1-.3s-.01-.91.41-1.04c.41-.12.94.88 1.5 1.27.42.3.74.24.74.24h1.48s.77-.05.41-.67Z"/></svg>; }

export function OAuthButtons({ next }: { next: string }) {
  const [message, setMessage] = useState("");
  async function signInGoogle() {
    const callback = canonicalAppUrl("/auth/callback");
    callback.searchParams.set("next", next);
    callback.searchParams.set("flow", "oauth");
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback.toString(), queryParams: { prompt: "select_account" } } });
    if (error) setMessage("Не удалось начать вход через Google. Попробуйте ещё раз.");
  }
  return <div className="oauth-actions"><button type="button" className="oauth-button" onClick={signInGoogle}><GoogleIcon/>Продолжить с Google</button><button type="button" className="oauth-button oauth-button-disabled" disabled><VkIcon/>ВКонтакте <span>Скоро</span></button>{message && <p className="form-message">{message}</p>}</div>;
}
