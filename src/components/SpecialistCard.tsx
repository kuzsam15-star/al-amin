/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { assetPath } from "@/lib/paths";
import type { StaticSpecialist } from "@/lib/static-content";

const modeLabels = { online: "Онлайн", offline: "Очно", both: "Онлайн и очно" } as const;

export function SpecialistCard({ item }: { item: StaticSpecialist }) {
  return <article className="public-specialist-card">
    <img className="public-specialist-photo" src={assetPath(item.photo.src)} alt={item.photo.alt} width="112" height="112" loading="lazy" />
    <h3>{item.fullName}</h3>
    <p className="public-specialist-role">{item.specialization}</p>
    <p className="public-specialist-meta">{item.city} · {modeLabels[item.workMode]}</p>
    {item.profileSummary ? <p className="public-specialist-summary">{item.profileSummary}</p> : null}
    {item.trust.recommendedByAlAmin ? <span className="public-trust-mark"><ShieldCheck aria-hidden="true" size={16} />Проверено AL-AMIN</span> : null}
    <span className="public-specialist-more" aria-hidden="true">Открыть профиль →</span>
    <Link className="public-specialist-link" href={`/specialists/${item.slug}`} aria-label={`Открыть профиль: ${item.fullName}`} />
  </article>;
}
