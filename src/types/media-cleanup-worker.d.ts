declare module "@/lib/media-cleanup-worker.mjs" {
  export type MediaCleanupBatchSummary = {
    claimed: number;
    completed: number;
    deferred: number;
    failed: number;
  };

  export function processMediaCleanupBatch(input: {
    supabase: unknown;
    workerId: string;
    limit?: number;
  }): Promise<MediaCleanupBatchSummary>;
}
