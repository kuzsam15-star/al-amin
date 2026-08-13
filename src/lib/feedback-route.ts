import "server-only";

import { NextResponse } from "next/server";
import { executeFeedbackGateway, safeFeedbackResponse, type FeedbackKind } from "@/lib/feedback-gateway.mjs";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

export async function handleFeedbackRoute(request: Request, kind: FeedbackKind) {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    const admin = createSupabaseAdminClient();
    const result = await executeFeedbackGateway({
      request,
      kind,
      actorId: user?.id ?? null,
      databaseSubmitter: async (input) => await admin.rpc("submit_feedback_v1", {
        p_feedback_type: input.feedbackType,
        p_target_id: input.targetId,
        p_actor_id: input.actorId,
        p_network_fingerprint: input.networkFingerprint,
        p_idempotency_key_hash: input.idempotencyKeyHash,
        p_payload_hash: input.payloadHash,
        p_body: input.body,
        p_contact: input.contact,
        p_would_hire_again: input.wouldHireAgain,
        p_reason: input.reason,
        p_description: input.description,
        p_materials_links: input.materials,
      }),
    });
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    const result = safeFeedbackResponse(error);
    return NextResponse.json(result.payload, { status: result.status });
  }
}
