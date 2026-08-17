import type { PublicVerificationFacts } from "@/lib/types";
import { createPublicClient } from "@/lib/supabase/public";
import { RESOURCE_LIMITS } from "@/lib/resource-limits.mjs";

type PublicClient = NonNullable<ReturnType<typeof createPublicClient>>;

export async function loadPublicVerificationFacts(
  supabase: PublicClient,
  specialistIds: string[],
): Promise<Map<string, PublicVerificationFacts>> {
  const ids = [...new Set(specialistIds)].filter(Boolean).slice(0, RESOURCE_LIMITS.publicCatalogRows);
  const result = new Map<string, PublicVerificationFacts>();
  if (!ids.length) return result;
  const { data, error } = await supabase
    .from("published_specialist_verification_facts")
    .select("specialist_id,identity_checked,education_checked,experience_checked,qualifications_checked,references_checked,sources_checked,checked_at")
    .in("specialist_id", ids)
    .limit(RESOURCE_LIMITS.publicReferenceRows);
  if (error) return result;
  for (const row of data ?? []) result.set(row.specialist_id, row as PublicVerificationFacts);
  return result;
}

export function hasPublicVerification(facts: PublicVerificationFacts | null | undefined) {
  return Boolean(facts && (facts.identity_checked || facts.education_checked || facts.experience_checked || facts.qualifications_checked || facts.references_checked));
}
