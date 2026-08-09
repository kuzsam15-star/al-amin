import type { SpecialistTrustBadge, TrustBadge } from "@/lib/types";
import { createPublicClient } from "@/lib/supabase/public";

type PublicClient = NonNullable<ReturnType<typeof createPublicClient>>;

/** Public-facing assignments intentionally omit moderator-only fields. */
export async function loadPublicTrustBadges(
  supabase: PublicClient,
  specialistIds: string[],
): Promise<Map<string, SpecialistTrustBadge[]>> {
  const ids = [...new Set(specialistIds)].filter(Boolean);
  const result = new Map<string, SpecialistTrustBadge[]>();
  if (!ids.length) return result;

  const { data: assignments, error } = await supabase
    .from("published_specialist_trust_badges")
    .select("id,specialist_id,badge_id,source,assigned_at")
    .in("specialist_id", ids);
  if (error || !assignments?.length) return result;

  const badgeIds = [...new Set(assignments.map((assignment) => assignment.badge_id))];
  const { data: badges } = await supabase
    .from("trust_badges")
    .select("id,code,title,description,icon,assignment_type,is_active,sort_order")
    .in("id", badgeIds)
    .eq("is_active", true);
  const byId = new Map((badges ?? []).map((badge) => [badge.id, badge as TrustBadge]));

  for (const assignment of assignments) {
    const badge = byId.get(assignment.badge_id);
    if (!badge) continue;
    const list = result.get(assignment.specialist_id) ?? [];
    list.push({ id: assignment.id, badge_id: assignment.badge_id, source: assignment.source as SpecialistTrustBadge["source"], assigned_at: assignment.assigned_at, badge });
    result.set(assignment.specialist_id, list);
  }
  return result;
}
