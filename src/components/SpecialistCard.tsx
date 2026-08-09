import Link from "next/link";
import type { Specialist } from "@/lib/types";
import { displayCity } from "@/lib/profile-presentation";
import { AdminPublicActionsGate } from "@/components/AdminPublicActions";
import { TrustBadges } from "@/components/TrustBadges";
import { assignedTrustBadges } from "@/lib/trust-badges";
import { profileMediaUrl } from "@/lib/media-paths";
import { ShieldCheck } from "lucide-react";
import { createRealPublicSpecialistCard } from "@/lib/public-specialist-card";
import { hasPublicVerification } from "@/lib/public-verification-facts";

const mediaUrl = profileMediaUrl;

export function SpecialistCard({ item, nativeProfileNavigation = false }: { item: Specialist; nativeProfileNavigation?: boolean }) {
  const verified = hasPublicVerification(item.verification_facts);
  const workFormat = { online: "Онлайн", offline: "Офлайн", both: "Онлайн и офлайн" }[item.service_mode] ?? item.service_mode;
  const publicCard = createRealPublicSpecialistCard({
    id: item.id,
    slug: item.slug,
    name: item.full_name,
    specialization: item.specialization?.trim() || "Специалист",
    location: [item.country, displayCity(item.city)].filter(Boolean).join(" · "),
    workFormat,
    photo: item.avatar_path ? mediaUrl(item.avatar_path) : null,
    photoAlt: `Фотография ${item.full_name}`,
    verificationState: verified ? "verified" : "published",
  });
  if (!publicCard) return null;

  const initials = publicCard.name.split(" ").map((part) => part[0]).join("").slice(0, 2);
  const profileHref = publicCard.profileUrl;
  const profileLabel = `Открыть профиль: ${publicCard.name}`;
  const publicBadges = assignedTrustBadges(item.trust_badges).filter((badge) => badge.code !== "verified" || verified);
  return <article className="specialist-card-shell">
    <div className="card specialist-card">
      {publicCard.photo ? <img className="card-avatar" src={publicCard.photo} alt={publicCard.photoAlt} loading="lazy" /> : <div className="avatar">{initials}</div>}
      <div className="specialist-title-row"><h3 className="specialist-name">{publicCard.name}</h3><TrustBadges badges={publicBadges} /></div>
      {item.specialization?.trim() ? <p className="specialist-specialization">{publicCard.specialization}</p> : null}
      <p className="meta specialist-meta">{[publicCard.location, publicCard.workFormat].filter(Boolean).join(" · ") || "Специалист"}</p>
      <p className="specialist-summary">{item.short_description}</p>
      {verified ? <span className="civic-trust-mark"><ShieldCheck aria-hidden="true" size={16} />Проверено AL-AMIN</span> : null}
      <span className="specialist-link" aria-hidden="true">Подробнее →</span>
      {nativeProfileNavigation
        ? <a className="specialist-card-link" href={profileHref} aria-label={profileLabel} data-specialist-id={publicCard.id} data-profile-url={publicCard.profileUrl} />
        : <Link className="specialist-card-link" href={profileHref} aria-label={profileLabel} data-specialist-id={publicCard.id} data-profile-url={publicCard.profileUrl} scroll />}
    </div>
    <AdminPublicActionsGate profileId={item.id} returnTo="/specialists"/>
  </article>;
}
