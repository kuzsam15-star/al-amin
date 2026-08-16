import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { processMediaCleanupBatch as processBatch } from "@/lib/media-cleanup-worker.mjs";

export async function processMediaCleanupQueue(limit = 10) {
  return processBatch({ supabase: createSupabaseAdminClient(), workerId: randomUUID(), limit });
}
