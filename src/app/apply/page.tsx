import { redirect } from "next/navigation";
import { ApplicationForm } from "@/components/ApplicationForm";
import { createPublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HelpTopic, WorkOffer } from "@/lib/specialist-contract.mjs";
import { inferContactMethod } from "@/lib/application-validation.mjs";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login?next=/apply");
  const supabase = createPublicClient();
  const [{ data: categories }, { data: application }] = await Promise.all([
    supabase ? supabase.from("categories").select("id,name,slug,group_name").eq("is_active", true).order("group_name").order("name") : Promise.resolve({ data: [] }),
    auth.from("owner_applications_v1").select("id,full_name,contact,country,city,category_id,additional_category_ids,specialization,experience_years,profile_summary,description,help_topics,work_offers,main_image_path,status").in("status", ["changes_requested", "info_required"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const draft = application ? {
    id: application.id,
    fullName: application.full_name,
    contact: application.contact,
    contactMethod: inferContactMethod(application.contact),
    country: application.country,
    city: application.city,
    categoryId: application.category_id ?? "",
    additionalCategoryIds: application.additional_category_ids ?? [],
    specialization: application.specialization ?? "",
    experienceYears: application.experience_years === null ? "" : String(application.experience_years ?? ""),
    profileSummary: application.profile_summary ?? application.description.slice(0, 220),
    description: application.description,
    helpTopics: Array.isArray(application.help_topics) ? application.help_topics as HelpTopic[] : [],
    workOffers: Array.isArray(application.work_offers) ? application.work_offers as WorkOffer[] : [],
    truthful: true,
    personalData: true,
    mainImagePath: application.main_image_path,
  } : undefined;

  return <section className="section"><div className="container narrow">
    <div className="eyebrow">Заявка специалиста</div>
    <h1 className="page-title">{draft ? "Внести изменения в заявку" : "Подать заявку"}</h1>
    <p className="lead">{draft ? "Исправьте данные и отправьте ту же заявку повторно — новый дубль не будет создан." : "Заявка привязана к вашему аккаунту. Её статус и комментарии модератора будут доступны в кабинете."}</p>
    <ApplicationForm categories={categories ?? []} draft={draft} />
  </div></section>;
}
