"use client";

import { deleteRevision } from "@/app/admin/actions";
import { AdminDeleteButton } from "@/components/AdminDeleteButton";

type Revision = { id: string; status: "approved" | "rejected"; updated_at: string; moderator_comment: string | null; specialist: { full_name: string } | null };
const labels = { approved: "Одобрено", rejected: "Отклонено" };
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function RevisionHistory({ revisions, canDelete = false }: { revisions: Revision[]; canDelete?: boolean }) {
  if (!revisions.length) return null;
  return <section className="admin-list revision-history"><h2>Завершённые ревизии</h2>
    {revisions.map((revision) => <article className="card revision-history-row" key={revision.id}>
      <div><h3>{revision.specialist?.full_name ?? "Профиль"}</h3><p className="meta">{labels[revision.status]} · {date(revision.updated_at)}</p>{revision.moderator_comment && <p>{revision.moderator_comment}</p>}</div>
      {canDelete && <form action={deleteRevision}><input type="hidden" name="revisionId" value={revision.id} /><AdminDeleteButton confirmation="Окончательно удалить эту ревизию? Опубликованный профиль не изменится.">Удалить ревизию</AdminDeleteButton></form>}
    </article>)}
  </section>;
}
