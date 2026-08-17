import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applicationStatusLabels, type ApplicationStatus } from "@/lib/types";
import { LogoutButton } from "@/components/LogoutButton";
import { SpecialistProfileForm } from "@/components/SpecialistProfileForm";

export const dynamic = "force-dynamic";
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));

export default async function CabinetPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/cabinet");

  const [{ data: profile }, { data: applications }, { data: categories }] = await Promise.all([
    supabase.from("specialists").select("id,owner_id,application_id,category_id,additional_category_ids,slug,full_name,country,city,specialization,services,service_mode,experience_years,short_description,profile_summary,full_description,public_contact,portfolio_links,video_links,avatar_path,gallery_paths,recommendations,help_topics,work_offers,contract_version,status,verified_at,verification_method,published_at,created_at,updated_at").eq("owner_id", user.id).maybeSingle(),
    supabase.from("owner_applications_v1").select("id,status,created_at,full_name,contact,applicant_message,resubmitted_at").order("created_at", { ascending: false }),
    supabase.from("categories").select("id,name,group_name").eq("is_active", true).order("group_name").order("name"),
  ]);
  const [{ data: pending }, { data: lastRejected }] = profile ? await Promise.all([
    supabase.from("specialist_revisions").select("id,payload,status,moderator_comment,created_at,updated_at").eq("specialist_id", profile.id).in("status", ["pending", "changes_requested"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("specialist_revisions").select("moderator_comment,decided_at").eq("specialist_id", profile.id).eq("status", "rejected").order("decided_at", { ascending: false }).limit(1).maybeSingle(),
  ]) : [{ data: null }, { data: null }];
  const application = applications?.[0] as { id: string; status: ApplicationStatus; created_at: string; applicant_message: string | null; resubmitted_at: string | null; full_name: string; contact: string } | undefined;
  const draft = (pending?.payload ?? profile) as Record<string, unknown> | null;
  return <section className="section"><div className="container narrow">
    <div className="cabinet-actions"><p className="account-email">Аккаунт: {user.email}</p><LogoutButton /></div>
    <div className="eyebrow">Кабинет пользователя</div><h1 className="page-title">Мой кабинет</h1>
    {saved === "revision" && <div className="notice saved">Изменения отправлены на модерацию. До их одобрения посетители продолжают видеть предыдущую версию профиля.</div>}
    {error === "required" && <div className="notice error">Заполните обязательные сведения профиля, добавьте фотографию, направление помощи и формат работы.</div>}
    {error && error !== "required" && <div className="notice error">Не удалось сохранить изменения. Попробуйте ещё раз.</div>}

    <section className="card cabinet-status"><h2>Моя заявка</h2>
      {application ? <><p><strong>{application.full_name}</strong></p><p>Статус: <span className="status">{applicationStatusLabels[application.status]}</span></p><p className="meta">Отправлена: {date(application.created_at)}</p>
        <p><strong>Приватный контакт:</strong> {application.contact}</p><p className="meta">Виден только вам и команде модерации AL-AMIN.</p>
        {application.applicant_message && <div className="notice"><strong>Сообщение модератора:</strong> {application.applicant_message}</div>}
        {application.resubmitted_at && <p className="meta">Повторно отправлена: {date(application.resubmitted_at)}</p>}
        {["changes_requested", "info_required"].includes(application.status) && <Link className="button secondary" href="/apply">Внести изменения и отправить повторно</Link>}
        {profile?.status === "published" && <Link className="card-link" href={`/specialists/${profile.slug}`}>Открыть опубликованный профиль →</Link>}
      </> : <><p>У вас пока нет заявок.</p><Link className="button" href="/apply">Подать заявку</Link></>}
    </section>

    {!profile ? <section className="card"><h2>Профиль специалиста</h2><p>Профиль появится здесь после одобрения заявки. Этот кабинет уже привязан к вашему аккаунту.</p></section> : <>
      {pending && <div className={pending.status === "changes_requested" ? "notice error" : "notice"}>{pending.status === "changes_requested" ? <><strong>Нужно уточнить изменения.</strong> {pending.moderator_comment} </> : "Изменения на повторной модерации. "}С {date(pending.updated_at)} вы можете продолжить редактирование этого черновика — новая заявка не создастся.</div>}
      {!pending && lastRejected?.moderator_comment && <div className="notice error"><strong>Изменения отклонены.</strong> {lastRejected.moderator_comment} {lastRejected.decided_at && <span className="meta">({date(lastRejected.decided_at)})</span>}</div>}
      <SpecialistProfileForm profileId={profile.id} categories={categories ?? []} values={draft ?? profile} />
    </>}
  </div></section>;
}
