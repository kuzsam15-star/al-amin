import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { EmailProviderError, sendTransactionalEmail } from "@/lib/email/provider";
import type { EmailEvent } from "@/lib/email/templates";

type QueuedEmail = { id: string; event_type: EmailEvent; recipient_email: string; subject: string; template_data: Record<string, unknown>; attempts: number };
const retryMinutes = [5, 30, 120];

export async function processEmailQueue(batchSize = 20) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_email_notifications", { batch_size: batchSize });
  if (error) throw error;
  const results = { sent: 0, failed: 0, retrying: 0 };
  for (const row of (data ?? []) as QueuedEmail[]) {
    try {
      const delivered = await sendTransactionalEmail({ eventType: row.event_type, to: row.recipient_email, subject: row.subject, data: row.template_data ?? {} });
      await supabase.from("email_notifications").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: delivered.providerMessageId, next_attempt_at: new Date().toISOString() }).eq("id", row.id);
      results.sent += 1;
    } catch (reason) {
      const failure = reason instanceof EmailProviderError ? reason : new EmailProviderError("Непредвиденная ошибка отправки.", true);
      const canRetry = failure.retryable && row.attempts < retryMinutes.length;
      await supabase.from("email_notifications").update({ status: "failed", last_error: failure.message.slice(0, 1000), next_attempt_at: new Date(Date.now() + (retryMinutes[Math.min(row.attempts - 1, retryMinutes.length - 1)] ?? 120) * 60_000).toISOString() }).eq("id", row.id);
      if (canRetry) results.retrying += 1; else results.failed += 1;
    }
  }
  return results;
}

export async function retryEmailNotification(id: string) {
  const supabase = createSupabaseAdminClient();
  return supabase.from("email_notifications").update({ status: "pending", next_attempt_at: new Date().toISOString(), last_error: null }).eq("id", id).in("status", ["failed", "cancelled"]);
}
