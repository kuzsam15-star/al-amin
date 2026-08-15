/**
 * Provider I/O is deliberately outside database transactions. The injected
 * acknowledge function owns the short, lease-checked database acknowledgement.
 */
export async function processClaimedEmails({ rows, workerId, transport, acknowledge }) {
  const results = { sent: 0, failed: 0, retrying: 0 };
  for (const row of rows) {
    let delivered;
    try {
      delivered = await transport({
        eventType: row.event_type,
        to: row.recipient_email,
        subject: row.subject,
        data: row.template_data ?? {},
      });
    } catch (reason) {
      const retryable = reason?.retryable === true;
      const ack = await acknowledge({
        notificationId: row.id,
        workerId,
        succeeded: false,
        providerMessageId: null,
        errorCode: retryable ? 'provider_retryable' : 'provider_permanent',
        retryable,
      });
      if (ack?.retry === true) results.retrying += 1;
      else results.failed += 1;
      continue;
    }

    // If the process crashes or this acknowledgement fails after provider
    // success, the row remains leased and is recovered later. Delivery is
    // therefore honestly at-least-once, not falsely advertised as exactly-once.
    await acknowledge({
      notificationId: row.id,
      workerId,
      succeeded: true,
      providerMessageId: delivered.providerMessageId,
      errorCode: null,
      retryable: false,
    });
    results.sent += 1;
  }
  return results;
}
