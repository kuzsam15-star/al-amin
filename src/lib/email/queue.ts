import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/email/provider";
import { processClaimedEmails, type ClaimedEmail } from "@/lib/email/worker-core.mjs";
import { randomUUID } from "node:crypto";

type EmailTransport = typeof sendTransactionalEmail;
type QueueClient = ReturnType<typeof createSupabaseAdminClient>;
type QueueOptions = { client?: QueueClient; transport?: EmailTransport; workerId?: string };

export async function processEmailQueue(batchSize = 20, options: QueueOptions = {}) {
  const supabase = options.client ?? createSupabaseAdminClient();
  const transport = options.transport ?? sendTransactionalEmail;
  const workerId = options.workerId ?? randomUUID();
  const { data, error } = await supabase.rpc("claim_email_notifications_v2", {
    p_batch_size: batchSize, p_worker_id: workerId, p_lease_seconds: 120,
  });
  if (error) throw error;
  return processClaimedEmails({
    rows: (data ?? []) as ClaimedEmail[], workerId, transport,
    acknowledge: async (value) => {
      const { data: ack, error: ackError } = await supabase.rpc("ack_email_notification_v2", {
        p_notification_id: value.notificationId, p_worker_id: value.workerId,
        p_succeeded: value.succeeded, p_provider_message_id: value.providerMessageId,
        p_error_code: value.errorCode, p_retryable: value.retryable,
      });
      if (ackError) throw ackError;
      return ack;
    },
  });
}
