"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { canonicalAppUrl } from "@/lib/navigation";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPending(true); const email = new FormData(event.currentTarget).get("email")?.toString().trim(); const supabase = createSupabaseBrowserClient(); const { error } = await supabase.auth.resetPasswordForEmail(email ?? "", { redirectTo: canonicalAppUrl("/reset-password").toString() }); setPending(false); setMessage(error ? "Не удалось отправить письмо. Проверьте адрес и повторите попытку." : "Если этот адрес зарегистрирован, письмо для установки пароля уже отправлено."); }
  return <section className="section"><div className="container narrow"><div className="eyebrow">Восстановление доступа</div><h1 className="page-title">Установить пароль</h1><form className="card form-stack" onSubmit={submit}><label htmlFor="email">Электронная почта</label><input id="email" name="email" type="email" autoComplete="email" required /><button className="button" disabled={pending}>{pending ? "Отправляем…" : "Отправить письмо"}</button>{message && <p className="form-message" role="status">{message}</p>}<Link className="card-link" href="/login">Вернуться ко входу</Link></form></div></section>;
}
