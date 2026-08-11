import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { publishCanonicalMediaSet, type CanonicalMediaDescriptor } from "@/lib/published-media.mjs";

export type CanonicalPublication = { avatar: CanonicalMediaDescriptor; gallery: CanonicalMediaDescriptor[] };

export async function prepareCanonicalPublication(input: {
  ownerId: string;
  entityType: "applications" | "revisions";
  entityId: string;
  avatarPath: string;
  galleryPaths?: string[];
}): Promise<CanonicalPublication> {
  const admin = createSupabaseAdminClient();
  return publishCanonicalMediaSet({ storage: admin.storage, ...input });
}
