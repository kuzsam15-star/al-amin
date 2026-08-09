import { TrustBadgeIcon } from "@/components/TrustBadges";
import type { SpecialistTrustBadge, TrustBadge } from "@/lib/types";
import { AdminSaveButton } from "@/components/AdminSaveButton";

export function AdminTrustBadges({
  profileId,
  badges,
  assignments,
  action,
}: {
  profileId: string;
  badges: TrustBadge[];
  assignments: SpecialistTrustBadge[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const assigned = new Set(assignments.map((assignment) => assignment.badge_id));
  return <section className="admin-trust-badges" aria-labelledby={`trust-badges-${profileId}`}>
    <div><h4 id={`trust-badges-${profileId}`}>Значки доверия</h4><p className="meta">Значки отражают только конкретные подтверждённые факты.</p></div>
    <form action={action} className="admin-trust-badge-list">
      <input type="hidden" name="profileId" value={profileId} />
      {badges.map((badge) => {
        const isAutomatic = badge.assignment_type === "automatic";
        const isAssigned = assigned.has(badge.id);
        return <label className={`admin-trust-badge${isAutomatic ? " is-disabled" : ""}`} key={badge.id}>
          <input name="badgeId" type="checkbox" value={badge.id} defaultChecked={isAssigned} disabled={isAutomatic || !badge.is_active} />
          <span className="admin-trust-badge-copy"><span className="admin-trust-badge-title"><TrustBadgeIcon icon={badge.icon} />{badge.title}</span><small>{badge.description}</small><small className="admin-trust-badge-state">{isAutomatic ? isAssigned ? "Legacy-назначение сохранено; публичный Trust Mark определяется фактами проверки" : "Больше не назначается автоматически" : isAssigned ? "Назначен" : "Не назначен"}</small></span>
        </label>;
      })}
      <div><AdminSaveButton>Сохранить значки</AdminSaveButton></div>
    </form>
  </section>;
}
