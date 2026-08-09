import { requireModerator } from "@/lib/auth";
import { profileMediaUrl } from "@/lib/media-paths";
import { applicationStatusLabels, profileStatusLabels, type ApplicationStatus, type ProfileStatus } from "@/lib/types";
import { archiveApplication, deleteApplication, restoreApplication, restorePublicProfile, retryEmailNotification, updateApplication, updateProfile, updateSiteContent, updateTrustBadges } from "./actions";
import { AdminDeleteButton } from "@/components/AdminDeleteButton";
import { AdminSaveButton } from "@/components/AdminSaveButton";
import { RevisionHistory } from "@/components/RevisionHistory";
import { RevisionModeration } from "@/components/RevisionModeration";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { defaultSiteContent, type SiteContent } from "@/lib/brand";
import { AdminTrustBadges } from "@/components/AdminTrustBadges";
import { SiteContentForm } from "@/components/admin/SiteContentForm";
import { siteContentFieldConfig, type SiteContentField } from "@/lib/site-content-fields";
import type { SpecialistTrustBadge, TrustBadge } from "@/lib/types";
import type { HelpTopic, WorkOffer } from "@/lib/specialist-contract.mjs";

export const dynamic = "force-dynamic";
type Application = { id:string; full_name:string; contact:string; country:string; city:string; category_text:string; specialization:string|null; experience_years:number|null; profile_summary:string|null; description:string; help_topics:HelpTopic[]|null; work_offers:WorkOffer[]|null; services:string; links:string|null; recommendations:string|null; status:ApplicationStatus; internal_notes:string|null; applicant_message:string|null; created_at:string; resubmitted_at:string|null; main_image_path:string|null; gallery_paths:string[]; video_links:string[] };
type VerificationFacts = { identity_checked:boolean; education_checked:boolean; experience_checked:boolean; qualifications_checked:boolean; references_checked:boolean; sources_checked:number };
type Profile = { id:string; full_name:string; slug:string; status:ProfileStatus; city:string; verification?:VerificationFacts|VerificationFacts[]|null; trust_badges?: SpecialistTrustBadge[] };
type Revision = { id:string; owner_id:string; payload:Record<string,unknown>; status:"pending"|"changes_requested"|"approved"|"rejected"; moderator_comment:string|null; created_at:string; updated_at:string; specialist:Record<string,unknown>|null };
type EmailNotification = { id:string; event_type:string; recipient_email:string; status:"pending"|"processing"|"sent"|"failed"|"cancelled"; attempts:number; last_error:string|null; created_at:string; sent_at:string|null };
const formatDate = (value:string) => new Intl.DateTimeFormat("ru-RU", { dateStyle:"long", timeStyle:"short" }).format(new Date(value));
const safeHttp = (url:string) => { try { return new URL(url).protocol === "https:"; } catch { return false; } };
const verificationFor = (profile:Profile):VerificationFacts|null => Array.isArray(profile.verification) ? profile.verification[0] ?? null : profile.verification ?? null;
const modeLabel = (mode:WorkOffer["mode"]) => mode === "online" ? "Онлайн" : mode === "offline" ? "Очно" : mode === "both" ? "Онлайн и очно" : "Формат не указан";
const offerMeta = (offer:WorkOffer) => [modeLabel(offer.mode), offer.duration_minutes ? `${offer.duration_minutes} мин.` : null, offer.price !== null && offer.price !== undefined ? `${offer.price} ${offer.currency ?? ""}`.trim() : null].filter(Boolean).join(" · ");

export default async function AdminPage({ searchParams }:{searchParams:Promise<{section?:string;status?:string;profileStatus?:string;profileSearch?:string;notice?:string}>}) {
  const { section, status, profileStatus, profileSearch, notice } = await searchParams;
  const { supabase, role } = await requireModerator();
  let query = supabase.from("applications").select("*").order("created_at", { ascending:false });
  if (status && status in applicationStatusLabels) query = query.eq("status", status as ApplicationStatus);
  else query = query.in("status", ["new", "screening", "info_required", "changes_requested", "call_required", "call_scheduled"]);
  let profilesQuery = supabase.from("specialists").select("id,full_name,slug,status,city,verification:verifications(identity_checked,education_checked,experience_checked,qualifications_checked,references_checked,sources_checked),trust_badges:specialist_trust_badges(id,badge_id,source,assigned_at,admin_note,badge:trust_badges(id,code,title,description,icon,assignment_type,is_active,sort_order))").order("updated_at", { ascending:false });
  if (profileStatus === "published") profilesQuery = profilesQuery.eq("status", "published");
  if (profileStatus === "hidden") profilesQuery = profilesQuery.in("status", ["archived", "suspended"]);
  if (profileStatus === "review") profilesQuery = profilesQuery.in("status", ["draft", "pending"]);
  const [{ data: applicationRows }, { data: profileRows }, { data: revisionRows }, { data: notificationRows }, { data: siteContentRow }, { data: trustBadgeRows }] = await Promise.all([
    query,
    profilesQuery,
    supabase.from("specialist_revisions").select("id,owner_id,payload,status,moderator_comment,created_at,updated_at,specialist:specialists(id,owner_id,full_name,country,city,service_mode,category_id,additional_category_ids,specialization,experience_years,profile_summary,help_topics,work_offers,services,short_description,full_description,public_contact,portfolio_links,video_links,avatar_path,gallery_paths,recommendations)").order("updated_at", { ascending:false }),
    supabase.from("email_notifications").select("id,event_type,recipient_email,status,attempts,last_error,created_at,sent_at").order("created_at", { ascending:false }).limit(30),
    role === "admin" ? supabase.from("site_content").select("brand_name,tagline,hero_title,hero_text,contact_email,about_text,rules_intro,privacy_text,seo_title,seo_description").eq("id", true).maybeSingle() : Promise.resolve({ data: null }),
    role === "admin" ? supabase.from("trust_badges").select("id,code,title,description,icon,assignment_type,is_active,sort_order").order("sort_order") : Promise.resolve({ data: [] }),
  ]);
  const applications = (applicationRows ?? []) as Application[];
  const profiles = (profileRows ?? []) as Profile[];
  const profileNeedle = (profileSearch ?? "").trim().toLocaleLowerCase("ru");
  const visibleProfiles = profileNeedle ? profiles.filter((profile) => `${profile.full_name} ${profile.city} ${profile.slug}`.toLocaleLowerCase("ru").includes(profileNeedle)) : profiles;
  const trustBadges = (trustBadgeRows ?? []) as TrustBadge[];
  const revisions = (revisionRows ?? []) as unknown as Revision[];
  const pendingRevisions = revisions.filter((revision) => revision.status === "pending");
  const finalizedRevisions = revisions.filter((revision): revision is Revision & { status: "approved" | "rejected" } => revision.status === "approved" || revision.status === "rejected");
  const notifications = (notificationRows ?? []) as EmailNotification[];
  const siteContent = { ...defaultSiteContent, ...((siteContentRow ?? {}) as Partial<SiteContent>) };
  const mediaUrl = profileMediaUrl;
  const showSettings = role === "admin" && section === "settings";
  const successfulNotice = ["saved", "deleted", "archived", "restored", "content-saved", "badges-saved"].includes(notice ?? "");
  const invalidContentField = notice?.startsWith("content-invalid-") ? notice.slice("content-invalid-".length) as SiteContentField : null;
  const invalidContentRule = invalidContentField && invalidContentField in siteContentFieldConfig ? siteContentFieldConfig[invalidContentField] : null;
  const message = notice === "deleted" ? "Запись удалена. Опубликованный профиль не изменён." : notice === "archived" ? "Профиль скрыт из каталога и сохранён в архиве." : notice === "restored" ? "Профиль возвращён в публичный каталог." : notice === "saved" ? "Решение сохранено" : notice === "content-saved" ? "Тексты Civic Home и публичных страниц сохранены." : invalidContentRule ? invalidContentField === "contact_email" ? "Введите корректный публичный email." : `Поле «${invalidContentRule.label}» должно содержать от ${invalidContentRule.minLength} до ${invalidContentRule.maxLength} символов.` : notice === "message-required" ? "Добавьте сообщение заявителю." : notice === "forbidden" ? "Это действие доступно только администратору." : notice ? "Не удалось выполнить действие." : null;
  if (showSettings) return <section className="section"><div className="container admin admin-can-settings" data-section="settings">
    <div className="section-head"><div><div className="eyebrow">Администратор</div><h1 className="page-title">Панель модерации</h1></div></div>
    <nav className="admin-sections" aria-label="Разделы панели"><a href="/admin">Заявки</a><a className="is-active" href="/admin?section=settings">Настройки сайта</a></nav>
    {message && <div className={successfulNotice ? "notice saved" : "notice error"}>{message}</div>}
    <h2>Содержание Civic Home и публичных страниц</h2>
    <p className="meta">Здесь меняются только тексты. Структура секций, Cover Flow, сетка, цвета, типографика и адаптивность закреплены в Civic-компонентах.</p>
    <SiteContentForm content={siteContent} action={updateSiteContent} />
  </div></section>;
  return <section className="section"><div className={`container admin ${role === "admin" ? "admin-can-settings" : ""}`} data-section={showSettings ? "settings" : "applications"}>
    <div className="section-head"><div><div className="eyebrow">{role === "admin" ? "Администратор" : "Модератор"}</div><h1 className="page-title">Панель модерации</h1></div></div>
    <nav className="admin-sections" aria-label="Разделы панели"><a className={!showSettings ? "is-active" : undefined} href="/admin">Заявки</a>{role === "admin" && <a className={showSettings ? "is-active" : undefined} href="/admin?section=settings">Настройки сайта</a>}</nav>
    {!showSettings && <form className="admin-status-filter" action="/admin"><label htmlFor="application-status">Статус заявок<select id="application-status" name="status" defaultValue={status ?? ""}><option value="">Активные</option>{Object.entries(applicationStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="button secondary">Показать</button></form>}
    {message && <div className={successfulNotice ? "notice saved" : "notice error"}>{message}</div>}
    <h2>Заявки</h2>
    {applications.length === 0 ? <div className="notice">Нет заявок с выбранным статусом.</div> : <div className="admin-list">{applications.map((item) => <article className="card" key={item.id}>
      <div className="application-head"><div><h3>{item.full_name}</h3><p className="meta">{item.category_text}{item.specialization ? ` · ${item.specialization}` : ""} · {[item.country,item.city].filter(Boolean).join(" · ")} · {formatDate(item.created_at)}</p></div><span className="status">{applicationStatusLabels[item.status]}</span></div>
      <p><strong>Приватный контакт для модерации:</strong> {item.contact}</p>
      {item.experience_years !== null && <p><strong>Опыт работы:</strong> {item.experience_years} лет</p>}
      {item.profile_summary && <p><strong>Коротко о себе:</strong> {item.profile_summary}</p>}
      <p><strong>О себе подробнее:</strong> {item.description}</p>
      {item.help_topics?.length ? <div><strong>С чем помогает:</strong><ul>{item.help_topics.map((topic,index) => <li key={`${topic.title}-${index}`}><b>{topic.title}</b>{topic.description ? ` — ${topic.description}` : ""}</li>)}</ul></div> : null}
      {item.work_offers?.length ? <div><strong>Форматы работы:</strong><ul>{item.work_offers.map((offer,index) => <li key={`${offer.title}-${index}`}><b>{offer.title}</b> — {offerMeta(offer)}</li>)}</ul></div> : item.services ? <p><strong>Услуги (legacy):</strong> {item.services}</p> : null}
      {item.links && <p><strong>Ссылки:</strong> {item.links}</p>}{item.recommendations && <p><strong>Рекомендации:</strong> {item.recommendations}</p>}
      {(item.main_image_path || item.gallery_paths?.length) && <div className="media-strip">{item.main_image_path && <img src={mediaUrl(item.main_image_path)} alt="Основное изображение заявки" />}{item.gallery_paths?.map((path) => <img key={path} src={mediaUrl(path)} alt="Работа из портфолио" />)}</div>}
      {item.video_links?.length > 0 && <p><strong>Видео:</strong> {item.video_links.filter(safeHttp).map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer"> открыть видео </a>)}</p>}
      <div className="admin-row-actions">{item.status === "approved" ? <div className="notice">Заявка уже одобрена, а профиль опубликован. Текущая форма не меняет одобренную заявку: безопасная отмена требует отдельного атомарного действия для заявки и профиля.</div> : item.status === "withdrawn" ? null : <form action={updateApplication} className="admin-form moderation-form"><input type="hidden" name="id" value={item.id}/><label>Внутренняя заметка<AutoResizeTextarea name="notes" defaultValue={item.internal_notes ?? ""} maxHeight={180} placeholder="Видна только команде модерации"/></label><label>Сообщение заявителю<AutoResizeTextarea name="applicantMessage" defaultValue={item.applicant_message ?? ""} maxHeight={180} placeholder="Что нужно исправить и почему"/></label><div className="moderation-decision-actions"><AdminSaveButton name="decision" value="approve">Принять заявку</AdminSaveButton><button className="button secondary" name="decision" value="request_changes">Запросить изменения</button><button className="button secondary moderation-reject" name="decision" value="reject">Отклонить</button></div></form>}
      {role === "admin" && <div className="admin-danger-actions">{item.status !== "withdrawn" ? <form action={archiveApplication}><input type="hidden" name="applicationId" value={item.id}/><button className="button secondary danger-button" type="submit">Архивировать заявку</button></form> : <form action={restoreApplication}><input type="hidden" name="applicationId" value={item.id}/><AdminSaveButton>Восстановить заявку</AdminSaveButton></form>}<form action={deleteApplication}><input type="hidden" name="applicationId" value={item.id}/><AdminDeleteButton confirmation="Окончательно удалить эту заявку? Связанный опубликованный профиль останется без изменений.">Удалить заявку</AdminDeleteButton></form></div>}</div>
    </article>)}</div>}
    <RevisionModeration revisions={pendingRevisions as never[]} canDelete={role === "admin"}/>
    <RevisionHistory revisions={finalizedRevisions.map((revision) => ({ id: revision.id, status: revision.status, updated_at: revision.updated_at, moderator_comment: revision.moderator_comment, specialist: revision.specialist ? { full_name: String(revision.specialist.full_name ?? "Профиль") } : null }))} canDelete={role === "admin"}/>
    <h2>Сервисные письма</h2>
    <p className="meta">Журнал показывает только статусы доставки и безопасную служебную информацию. Содержимое писем и внутренние заметки здесь не хранятся.</p>
    {notifications.length ? <div className="admin-list">{notifications.map((notification) => <article className="card" key={notification.id}><div className="application-head"><div><h3>{notification.event_type}</h3><p className="meta">{notification.recipient_email} · {formatDate(notification.created_at)} · попыток: {notification.attempts}</p></div><span className="status">{notification.status}</span></div>{notification.sent_at && <p className="meta">Отправлено: {formatDate(notification.sent_at)}</p>}{notification.last_error && <p className="meta">Причина: {notification.last_error}</p>}{["failed", "cancelled"].includes(notification.status) && <form action={retryEmailNotification}><input type="hidden" name="notificationId" value={notification.id}/><button className="button secondary">Повторить отправку</button></form>}</article>)}</div> : <div className="notice">Пока нет сервисных писем.</div>}
    <section className="admin-profiles" id="profiles">
      <h2>{profileStatus === "hidden" ? "Скрытые специалисты" : "Профили"}</h2>
      <nav className="admin-tabs" aria-label="Фильтр профилей"><a href="/admin#profiles">Все</a><a href="/admin?profileStatus=published#profiles">Опубликованные</a><a href="/admin?profileStatus=hidden#profiles">Скрытые специалисты</a><a href="/admin?profileStatus=review#profiles">На проверке</a><a href="/admin?status=rejected#applications">Отклонённые заявки</a></nav>
      {profileStatus === "hidden" ? <form className="searchbar admin-profile-search" action="/admin#profiles"><input type="hidden" name="profileStatus" value="hidden"/><input name="profileSearch" defaultValue={profileSearch} placeholder="Имя, город или адрес профиля" aria-label="Поиск скрытых специалистов"/><button className="button">Найти</button></form> : null}
      {visibleProfiles.length ? <div className="admin-list">{visibleProfiles.map((profile) => {
        const facts = verificationFor(profile);
        return <article className="card" key={profile.id}>
          <div className="application-head"><div><h3>{profile.full_name}</h3><p className="meta">{profile.city} · /specialists/{profile.slug}</p></div>{["archived","suspended"].includes(profile.status) ? <span className="status">Скрыт</span> : null}</div>
          {profile.status === "published" ? <a className="card-link" href={`/specialists/${profile.slug}`}>Открыть публичный профиль →</a> : <p className="meta">Профиль скрыт от посетителей и доступен для просмотра в этой панели.</p>}
          <form action={updateProfile} className="admin-form admin-verification-form">
            <input type="hidden" name="id" value={profile.id}/>
            <label>Статус профиля<select name="status" defaultValue={profile.status}>{Object.entries(profileStatusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <fieldset><legend>Фактически выполненная проверка</legend>
              <label><input type="checkbox" name="identityChecked" defaultChecked={facts?.identity_checked ?? false}/> Личность</label>
              <label><input type="checkbox" name="educationChecked" defaultChecked={facts?.education_checked ?? false}/> Образование</label>
              <label><input type="checkbox" name="experienceChecked" defaultChecked={facts?.experience_checked ?? false}/> Опыт</label>
              <label><input type="checkbox" name="qualificationsChecked" defaultChecked={facts?.qualifications_checked ?? false}/> Квалификация</label>
              <label><input type="checkbox" name="referencesChecked" defaultChecked={facts?.references_checked ?? false}/> Рекомендации</label>
            </fieldset>
            <label>Количество проверенных источников<input type="number" name="sourcesChecked" min="0" max="999" defaultValue={facts?.sources_checked ?? 0}/></label>
            <p className="meta">Отметьте только выполненные проверки. Публикация профиля сама по себе не означает проверку.</p>
            <AdminSaveButton>Сохранить профиль и факты</AdminSaveButton>
          </form>
          {role === "admin" ? <AdminTrustBadges profileId={profile.id} badges={trustBadges} assignments={profile.trust_badges ?? []} action={updateTrustBadges} /> : null}
          {["archived","suspended"].includes(profile.status) && <form action={restorePublicProfile} className="admin-restore-form"><input type="hidden" name="profileId" value={profile.id}/><AdminSaveButton>Вернуть в каталог</AdminSaveButton></form>}
        </article>;
      })}</div> : <div className="notice">Нет профилей с выбранным статусом.</div>}
    </section>
  </div></section>;
}
