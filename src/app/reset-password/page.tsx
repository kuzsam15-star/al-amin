"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const password = form.get("password")?.toString() ?? ""; const confirm = form.get("confirm")?.toString() ?? ""; if (password.length < 8) return setMessage("Пароль должен содержать не менее 8 символов."); if (password !== confirm) return setMessage("Пароли не совпадают."); setPending(true); const { error } = await createSupabaseBrowserClient().auth.updateUser({ password }); setPending(false); setMessage(error ? "Ссылка недействительна или истекла. Запросите новое письмо." : "Пароль установлен. Теперь можно войти в панель."); }
  return <section className="section"><div className="container narrow"><div className="eyebrow">Новый пароль</div><h1 className="page-title">Создайте пароль</h1><form className="card form-stack" onSubmit={submit}><label htmlFor="password">Новый пароль</label><input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /><label htmlFor="confirm">Повторите пароль</label><input id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required /><button className="button" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить пароль"}</button>{message && <p className="form-message" role="status">{message}</p>}{message.startsWith("Пароль установлен") && <Link className="card-link" href="/login">Перейти ко входу</Link>}</form></div></section>;
}
