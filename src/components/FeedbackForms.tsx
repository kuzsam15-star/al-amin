"use client";

import { FormEvent, useRef, useState } from "react";
import Script from "next/script";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";

async function send(path: string, payload: object, idempotencyKey: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  return { ok: response.ok, ...(await response.json()) } as { ok: boolean; error?: string };
}

export function FeedbackForms({ specialistId }: { specialistId: string }) {
  const [reviewMessage, setReviewMessage] = useState("");
  const [complaintMessage, setComplaintMessage] = useState("");
  const reviewKey = useRef<string | null>(null);
  const complaintKey = useRef<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const feedbackReady = turnstileSiteKey.length > 0;

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    reviewKey.current ??= globalThis.crypto.randomUUID();
    const data = await send("/api/reviews", {
      specialistId,
      body: form.get("body"),
      contact: form.get("contact"),
      wouldHireAgain: form.get("again") === "yes",
      turnstileToken: form.get("cf-turnstile-response"),
    }, reviewKey.current);
    setReviewMessage(data.ok ? "Спасибо. Отзыв появится после модерации." : (data.error ?? "Не удалось отправить отзыв."));
    if (data.ok) {
      reviewKey.current = null;
      event.currentTarget.reset();
    }
  }

  async function complaint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    complaintKey.current ??= globalThis.crypto.randomUUID();
    const data = await send("/api/complaints", {
      specialistId,
      reason: form.get("reason"),
      description: form.get("description"),
      contact: form.get("contact"),
      materials: form.get("materials"),
      turnstileToken: form.get("cf-turnstile-response"),
    }, complaintKey.current);
    setComplaintMessage(data.ok ? "Жалоба принята на рассмотрение." : (data.error ?? "Не удалось отправить жалобу."));
    if (data.ok) {
      complaintKey.current = null;
      event.currentTarget.reset();
    }
  }

  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
    <div className="feedback-grid">
      <form className="card review-form" onSubmit={review}>
        <h3>Оставить отзыв</h3>
        <p className="meta">Отзывы проходят модерацию до публикации.</p>
        <AutoResizeTextarea name="body" required minLength={30} maxLength={3000} maxHeight={360} placeholder="Опишите ваш опыт взаимодействия" />
        <input name="contact" maxLength={240} placeholder="Контакт для подтверждения (не публикуется)" />
        <fieldset><legend>Обратились бы снова?</legend><label><input type="radio" name="again" value="yes" required /> Да</label><label><input type="radio" name="again" value="no" /> Нет</label></fieldset>
        {feedbackReady ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="feedback_review" /> : <p className="form-message">Форма временно недоступна.</p>}
        <button className="button" disabled={!feedbackReady}>Отправить отзыв</button>
        {reviewMessage && <p className="form-message" role="status">{reviewMessage}</p>}
      </form>
      <form className="card complaint-form form-stack" onSubmit={complaint}>
        <h3>Сообщить о проблеме</h3>
        <input name="reason" required minLength={3} maxLength={120} placeholder="Причина" />
        <AutoResizeTextarea name="description" required minLength={20} maxLength={3000} maxHeight={360} placeholder="Что произошло?" />
        <input name="contact" required minLength={3} maxLength={240} placeholder="Ваш контакт" />
        <input name="materials" maxLength={3000} placeholder="HTTPS-ссылки на материалы, по одной в строке" />
        {feedbackReady ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="feedback_complaint" /> : <p className="form-message">Форма временно недоступна.</p>}
        <button className="button secondary" disabled={!feedbackReady}>Отправить жалобу</button>
        {complaintMessage && <p className="form-message" role="status">{complaintMessage}</p>}
      </form>
    </div>
  </>;
}
