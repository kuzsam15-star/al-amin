import type { Specialist } from "@/lib/types";
import { validateHelpTopics, validateWorkOffers, workOfferTitles } from "@/lib/specialist-contract.mjs";

export const PUBLIC_SPECIALIST_SELECT = "id,slug,full_name,country,city,category_id,category_name,category_slug,additional_category_ids,specialization,service_mode,experience_years,profile_summary,full_description,help_topics,work_offers,avatar_path,published_at";

export function toPublicSpecialist(row: Record<string, unknown>): Specialist {
  const topics = validateHelpTopics(row.help_topics, { required: false });
  const offers = validateWorkOffers(row.work_offers, { required: false, allowLegacyMode: true });
  const workOffers = offers.data ?? [];
  const profileSummary = typeof row.profile_summary === "string" ? row.profile_summary : "";
  const categoryName = typeof row.category_name === "string" ? row.category_name : "";
  const categorySlug = typeof row.category_slug === "string" ? row.category_slug : "";
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    full_name: String(row.full_name ?? ""),
    country: String(row.country ?? ""),
    city: String(row.city ?? ""),
    category: categoryName ? { name: categoryName, slug: categorySlug } : null,
    services: workOfferTitles(workOffers),
    service_mode: String(row.service_mode ?? "both"),
    experience_years: typeof row.experience_years === "number" ? row.experience_years : null,
    profile_summary: profileSummary,
    short_description: profileSummary,
    full_description: typeof row.full_description === "string" ? row.full_description : null,
    help_topics: topics.data ?? [],
    work_offers: workOffers,
    avatar_path: typeof row.avatar_path === "string" ? row.avatar_path : null,
    specialization: typeof row.specialization === "string" ? row.specialization : null,
    additional_category_ids: Array.isArray(row.additional_category_ids) ? row.additional_category_ids.filter((id): id is string => typeof id === "string") : [],
  };
}
