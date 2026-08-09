"use client";

import { useMemo, useState } from "react";
import { approveSafeRevisions, decideRevision, deleteRevision } from "@/app/admin/actions";
import { AdminDeleteButton } from "@/components/AdminDeleteButton";
import { AdminSaveButton } from "@/components/AdminSaveButton";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { profileMediaUrl } from "@/lib/media-paths";

type Profile = Record<string, unknown> & { id: string; full_name: string; owner_id: string; avatar_path?: string | null; gallery_paths?: string[] | null };
type Revision = { id: string; created_at: string; updated_at: string; owner_id: string; payload: Record<string, unknown>; specialist: Profile | null };
const labels: Record<string, string> = { full_name: "Имя", country: "Страна", city: "Город", service_mode: "Формат работы", category_id: "Основная категория", additional_category_ids: "Дополнительные категории", specialization: "Специализация", experience_years: "Опыт", profile_summary: "Коротко о себе", help_topics: "С чем помогает", work_offers: "Форматы работы", services: "Услуги (legacy)", short_description: "Краткое описание (legacy)", full_description: "О себе подробнее", public_contact: "Контакты (legacy)", portfolio_links: "Ссылки (legacy)", video_links: "Видео (legacy)", avatar_path: "Фотография профиля", gallery_paths: "Галерея (legacy)", recommendations: "Рекомендации (legacy)" };
const highRiskFields = new Set(["avatar_path", "gallery_paths", "public_contact", "portfolio_links", "video_links", "full_name", "category_id", "additional_category_ids"]);
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const array = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const display = (key: string, value: unknown) => {
  if (!Array.isArray(value)) return value == null || value === "" ? "—" : String(value);
  if (key === "help_topics") return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return [String(row.title ?? "").trim(), String(row.description ?? "").trim()].filter(Boolean).join(" — ");
  }).filter(Boolean).join("\n") || "—";
  if (key === "work_offers") return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const mode = row.mode === "online" ? "Онлайн" : row.mode === "offline" ? "Очно" : row.mode === "both" ? "Онлайн и очно" : "";
    const details = [mode, row.duration_minutes ? `${row.duration_minutes} мин.` : "", row.price != null ? `${row.price} ${row.currency ?? ""}`.trim() : ""].filter(Boolean).join(" · ");
    return `${String(row.title ?? "").trim()}${details ? ` — ${details}` : ""}`;
  }).filter(Boolean).join("\n") || "—";
  return value.join(" · ") || "—";
};
const imageUrl = (path: unknown) => typeof path === "string" ? profileMediaUrl(path) : null;
const changedKeys = (profile: Profile | null, payload: Record<string, unknown>) => Object.keys(labels).filter((key) => JSON.stringify(profile?.[key] ?? null) !== JSON.stringify(payload[key] ?? null));
const isRisky = (profile: Profile | null, payload: Record<string, unknown>, keys: string[]) => keys.some((key) => highRiskFields.has(key)) || (String(profile?.full_description ?? "") !== String(payload.full_description ?? "") && Math.abs(String(profile?.full_description ?? "").length - String(payload.full_description ?? "").length) > 140);

function Gallery({ value, alt }: { value: unknown; alt: string }) {
  const paths = array(value);
  if (!paths.length) return <p>—</p>;
  return <div className="revision-gallery">{paths.map((path) => <img key={path} src={imageUrl(path) ?? ""} alt={alt} />)}</div>;
}

function ArrayChanges({ before, after }: { before: unknown; after: unknown }) {
  const oldItems = array(before); const newItems = array(after);
  const added = newItems.filter((item) => !oldItems.includes(item)); const removed = oldItems.filter((item) => !newItems.includes(item));
  return <div className="array-changes">{added.map((item) => <p className="diff-added" key={`add-${item}`}>+ {item}</p>)}{removed.map((item) => <p className="diff-removed" key={`remove-${item}`}>− {item}</p>)}</div>;
}

export function RevisionModeration({ revisions, canDelete = false }: { revisions: Revision[]; canDelete?: boolean }) {
  const [onlyRisky, setOnlyRisky] = useState(false);
  const annotated = useMemo(() => revisions.map((revision) => { const changed = changedKeys(revision.specialist, revision.payload); return { revision, changed, risky: isRisky(revision.specialist, revision.payload, changed) }; }), [revisions]);
  const visible = onlyRisky ? annotated.filter((item) => item.risky) : annotated;
  const safeIds = annotated.filter((item) => !item.risky).map((item) => item.revision.id);
  if (!revisions.length) return null;

  return <section className="admin-list revision-list"><div className="revision-list-head"><div><h2>Изменения профилей на модерации</h2><p className="meta">Показываются только реально изменённые поля. Медиа, контакты и внешние ссылки отмечены как повышенный риск.</p></div><label className="revision-filter"><input type="checkbox" checked={onlyRisky} onChange={(event) => setOnlyRisky(event.target.checked)} /> Только рискованные</label></div>
    {safeIds.length > 0 && <form action={approveSafeRevisions} className="low-risk-action">{safeIds.map((id) => <input type="hidden" key={id} name="revisionId" value={id} />)}<button className="button secondary">Одобрить все безопасные изменения ({safeIds.length})</button></form>}
    {visible.map(({ revision, changed, risky }) => {
      const profile = revision.specialist;
      return <article className={`card revision-card${risky ? " is-risky" : " is-low-risk"}`} key={revision.id}><div className="application-head"><div><h3>{profile?.full_name ?? "Профиль"}</h3><p className="meta">Владелец профиля: {revision.owner_id} · отправлено {date(revision.updated_at)}</p></div><span className="status">{risky ? "Повышенный риск" : "Низкий риск"}</span></div>
        <div className="revision-diff">{changed.map((key) => <div className={`revision-row${highRiskFields.has(key) ? " is-risky" : ""}`} key={key}><strong>{labels[key]}</strong><div><span className="meta">Было</span>{key === "avatar_path" && imageUrl(profile?.[key]) ? <img className="revision-image" src={imageUrl(profile?.[key])!} alt="Текущая фотография" /> : key === "gallery_paths" ? <Gallery value={profile?.[key]} alt="Текущая галерея" /> : <p>{display(key,profile?.[key])}</p>}</div><div><span className="meta">Станет</span>{key === "avatar_path" && imageUrl(revision.payload[key]) ? <img className="revision-image" src={imageUrl(revision.payload[key])!} alt="Новая фотография" /> : key === "gallery_paths" ? <Gallery value={revision.payload[key]} alt="Новая галерея" /> : <p>{display(key,revision.payload[key])}</p>}</div>{["public_contact", "portfolio_links", "video_links", "gallery_paths"].includes(key) && <div className="revision-changes"><span className="meta">Разница</span><ArrayChanges before={profile?.[key]} after={revision.payload[key]} /></div>}</div>)}</div>
        <form action={decideRevision} className="admin-form revision-decision"><input type="hidden" name="revisionId" value={revision.id} /><AutoResizeTextarea name="note" maxHeight={260} placeholder="Сообщение владельцу (обязательно при запросе изменений или отклонении)" /><div className="media-actions"><button className="button secondary" name="decision" value="request_changes">Запросить изменения</button><button className="button secondary" name="decision" value="reject">Отклонить изменения</button><AdminSaveButton name="decision" value="approve">Одобрить изменения</AdminSaveButton></div></form>
        {canDelete && <form action={deleteRevision} className="revision-delete"><input type="hidden" name="revisionId" value={revision.id} /><AdminDeleteButton confirmation="Окончательно удалить эту ревизию? Опубликованный профиль не изменится.">Удалить ревизию</AdminDeleteButton></form>}
      </article>;
    })}</section>;
}
