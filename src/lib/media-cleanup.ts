import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type MediaCleanupReason =
  | "failed_application_submit"
  | "superseded_revision_media"
  | "deleted_application_media"
  | "deleted_revision_media"
  | "rejected_revision_media";

const submissionPath = /^submissions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:avatar|gallery)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const validPath = (value: unknown): value is string => typeof value === "string"
  && value.length <= 512
  && submissionPath.test(value)
  && !value.includes("%")
  && !value.includes("\\")
  && !value.includes("//")
  && !value.split("/").includes("..");

export const profileMediaPaths = (value: Record<string, unknown> | null | undefined) => [
  value?.avatar_path,
  ...(Array.isArray(value?.gallery_paths) ? value.gallery_paths : []),
].filter(validPath);

export async function enqueueProfileMediaCleanup(input: {
  ownerId: string;
  candidates: Iterable<string>;
  reason: MediaCleanupReason;
  operationId?: string | null;
}) {
  const requested = [...new Set([...input.candidates].filter(validPath))];
  if (!requested.length) return { queued: 0, failed: 0 };
  const admin = createSupabaseAdminClient();
  let queued = 0;
  let failed = 0;
  for (const path of requested) {
    const { error } = await admin.rpc("enqueue_media_cleanup_v1", {
      p_owner_id: input.ownerId,
      p_object_path: path,
      p_reason: input.reason,
      p_source_operation_id: input.operationId ?? null,
    });
    if (error) failed += 1;
    else queued += 1;
  }
  if (failed) console.error("[SEC-006] media cleanup enqueue failed closed", { reason: input.reason, failed });
  return { queued, failed };
}
