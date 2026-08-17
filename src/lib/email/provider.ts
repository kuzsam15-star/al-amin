import { renderTransactionalEmail, type TransactionalEmail } from "@/lib/email/templates";
import { brand } from "@/lib/brand";
import { readBoundedResponseJson, RESOURCE_LIMITS } from "@/lib/resource-limits.mjs";

export type ProviderResult = { providerMessageId: string };
export class EmailProviderError extends Error { constructor(message: string, readonly retryable: boolean) { super(message); } }

type GoResponse = { job_id?: string; code?: number; message?: string; error?: string; errors?: Array<{ message?: string }> };

export async function sendTransactionalEmail(email: TransactionalEmail): Promise<ProviderResult> {
  const provider = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (provider !== "unisender-go") throw new EmailProviderError("Почтовый провайдер не настроен.", false);
  const apiKey = process.env.UNISENDER_GO_API_KEY; const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new EmailProviderError("Не задан безопасный ключ или адрес отправителя для почтового провайдера.", false);

  const { html, text } = renderTransactionalEmail(email);
  const responseBody = {
    message: {
      recipients: [{ email: email.to, metadata: { source: "amanat", event: email.eventType } }],
      tags: ["amanat", email.eventType],
      body: { html, plaintext: text },
      subject: email.subject.replaceAll("Аманат", brand.name),
      from_email: from,
      from_name: process.env.EMAIL_SENDER_NAME || brand.senderName,
      reply_to: process.env.EMAIL_REPLY_TO || from,
      reply_to_name: process.env.EMAIL_SENDER_NAME || brand.senderName,
      track_links: 0,
      track_read: 0,
      global_language: "ru",
    },
  };
  let response: Response;
  try {
    response = await fetch(process.env.UNISENDER_GO_API_ENDPOINT || "https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json", "X-API-KEY": apiKey }, body: JSON.stringify(responseBody), cache: "no-store",
      signal: AbortSignal.timeout(RESOURCE_LIMITS.providerTimeoutMs),
    });
  } catch { throw new EmailProviderError("Почтовый сервис временно недоступен.", true); }

  const payload = await readBoundedResponseJson(response, RESOURCE_LIMITS.providerResponseBytes).catch(() => null) as GoResponse | null;
  if (!response.ok) {
    throw new EmailProviderError("Почтовый сервис отклонил письмо.", response.status === 429 || response.status >= 500);
  }
  if (!payload?.job_id) throw new EmailProviderError("Почтовый сервис не вернул идентификатор письма.", true);
  return { providerMessageId: payload.job_id };
}
