import type { SpecialistTrustBadge, TrustBadge } from "@/lib/types";

export const TRUST_BADGE_ORDER = ["verified", "documents_verified", "high_rating", "quick_response", "supports_project"];

export function assignedTrustBadges(assignments: SpecialistTrustBadge[] | undefined): TrustBadge[] {
  const unique = new Map<string, TrustBadge>();
  for (const assignment of assignments ?? []) {
    const badge = Array.isArray(assignment.badge) ? assignment.badge[0] : assignment.badge;
    if (badge?.is_active) unique.set(badge.code, badge);
  }
  return [...unique.values()].sort((left, right) => {
    const leftOrder = TRUST_BADGE_ORDER.indexOf(left.code);
    const rightOrder = TRUST_BADGE_ORDER.indexOf(right.code);
    return (leftOrder < 0 ? left.sort_order : leftOrder) - (rightOrder < 0 ? right.sort_order : rightOrder);
  });
}
