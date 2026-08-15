import type { TransactionalEmail } from "./templates";

export type ClaimedEmail = {
  id: string;
  event_type: TransactionalEmail["eventType"];
  recipient_email: string;
  subject: string;
  template_data: Record<string, unknown>;
  attempts: number;
};

export type Acknowledgement = {
  notificationId: string;
  workerId: string;
  succeeded: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  retryable: boolean;
};

export function processClaimedEmails(options: {
  rows: ClaimedEmail[];
  workerId: string;
  transport: (email: TransactionalEmail) => Promise<{ providerMessageId: string }>;
  acknowledge: (value: Acknowledgement) => Promise<{ retry?: boolean } | null>;
}): Promise<{ sent: number; failed: number; retrying: number }>;
