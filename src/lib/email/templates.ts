export type EmailEvent =
  | "application_submitted" | "application_under_review" | "application_changes_requested"
  | "application_resubmitted" | "application_approved" | "application_rejected"
  | "profile_hidden" | "revision_submitted" | "revision_approved" | "revision_rejected" | "revision_changes_requested";

export type TransactionalEmail = { eventType: EmailEvent; to: string; subject: string; data: Record<string, unknown> };
import { brand } from "@/lib/brand";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const cabinetUrl = () => `${siteUrl()}/cabinet`;

function copy(eventType: EmailEvent) {
  const values: Record<EmailEvent, { title: string; body: string; action: string }> = {
    application_submitted: { title: "Заявка отправлена", body: "Мы получили вашу заявку и передали её на проверку.", action: "Открыть кабинет" },
    application_under_review: { title: "Заявка принята на рассмотрение", body: "Модератор начал проверку данных. Мы сообщим о решении здесь, в кабинете.", action: "Открыть кабинет" },
    application_changes_requested: { title: "Нужно уточнить данные заявки", body: "Пожалуйста, внесите изменения в существующую заявку и отправьте её повторно. Новую заявку создавать не нужно.", action: "Открыть заявку" },
    application_resubmitted: { title: "Исправленная заявка снова отправлена на проверку", body: "Изменения сохранены в той же заявке и переданы модератору.", action: "Открыть заявку" },
    application_approved: { title: "Ваша заявка одобрена", body: "Профиль опубликован. Теперь посетители могут найти вас в каталоге.", action: "Открыть кабинет" },
    application_rejected: { title: "Решение по заявке", body: "Заявка не была одобрена. Если вам доступно уточнение, оно будет указано в кабинете.", action: "Открыть кабинет" },
    profile_hidden: { title: "Профиль временно скрыт", body: "Публичный профиль временно скрыт администратором. Подробности доступны в кабинете.", action: "Открыть кабинет" },
    revision_submitted: { title: "Изменения профиля отправлены на модерацию", body: "Пока изменения проверяются, посетители продолжают видеть предыдущую опубликованную версию профиля.", action: "Открыть кабинет" },
    revision_approved: { title: "Изменения профиля одобрены", body: "Новая версия профиля опубликована.", action: "Открыть кабинет" },
    revision_rejected: { title: "Решение по изменениям профиля", body: "Новая версия не была опубликована. Предыдущая опубликованная версия профиля сохранена.", action: "Открыть кабинет" },
    revision_changes_requested: { title: "Нужно уточнить изменения профиля", body: "Пожалуйста, уточните данные в существующем черновике и снова отправьте его на проверку.", action: "Открыть кабинет" },
  };
  return values[eventType];
}

export function renderTransactionalEmail(email: TransactionalEmail) {
  const content = copy(email.eventType); const name = String(email.data.name ?? "").trim(); const message = String(email.data.message ?? "").trim();
  const url = cabinetUrl(); const profileSlug = String(email.data.profile_slug ?? "").trim(); const profileUrl = profileSlug ? `${siteUrl()}/specialists/${encodeURIComponent(profileSlug)}` : null;
  const greeting = name ? `Здравствуйте, ${escapeHtml(name)}!` : "Здравствуйте!";
  const messageBlock = message ? `<div style="margin:20px 0;padding:14px 16px;border-left:3px solid #2b7754;background:#f4f8f5;color:#1f3a31;white-space:pre-wrap">${escapeHtml(message)}</div>` : "";
  const profileBlock = profileUrl ? `<p style="margin:18px 0 0">Публичный профиль: <a href="${profileUrl}" style="color:#216544">${profileUrl}</a></p>` : "";
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f5f7f5;font-family:Arial,sans-serif;color:#1f3028"><main style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #dde7df;border-radius:16px;overflow:hidden"><header style="padding:22px 28px;background:#1f5b41;color:#fff;font-size:20px;font-weight:700">${brand.name}</header><section style="padding:28px"><p style="margin:0 0 16px">${greeting}</p><h1 style="font-size:22px;line-height:1.3;margin:0 0 14px">${escapeHtml(content.title)}</h1><p style="line-height:1.55;margin:0">${escapeHtml(content.body)}</p>${messageBlock}<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#26734d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(content.action)}</a></p><p style="font-size:13px;line-height:1.5;color:#53665c">Если кнопка не открывается, используйте эту ссылку:<br><a href="${url}" style="color:#216544;overflow-wrap:anywhere">${url}</a></p>${profileBlock}</section><footer style="padding:16px 28px;border-top:1px solid #dde7df;color:#53665c;font-size:12px">${brand.name} · ${escapeHtml(brand.tagline)}</footer></main></body></html>`;
  return { html, text: `${name ? `Здравствуйте, ${name}!\n\n` : ""}${content.title}\n\n${content.body}${message ? `\n\nСообщение модератора:\n${message}` : ""}\n\n${content.action}: ${url}${profileUrl ? `\nПубличный профиль: ${profileUrl}` : ""}\n\n${brand.name} — ${brand.tagline}` };
}
