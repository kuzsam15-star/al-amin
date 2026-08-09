export type ApplicationStatus = "new" | "screening" | "info_required" | "changes_requested" | "call_required" | "call_scheduled" | "approved" | "rejected" | "withdrawn";
export type ProfileStatus = "draft" | "pending" | "published" | "suspended" | "blocked" | "archived";

export type TrustBadge = {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  assignment_type: "automatic" | "manual";
  is_active: boolean;
  sort_order: number;
};

export type SpecialistTrustBadge = {
  id: string;
  badge_id?: string;
  source: "automatic" | "manual";
  assigned_at: string;
  admin_note?: string | null;
  badge?: TrustBadge | TrustBadge[] | null;
};

export type Specialist = {
  id: string; slug: string; full_name: string; country: string; city: string;
  category?: { name: string; slug: string } | null; services: string[]; service_mode: string;
  experience_years: number | null; short_description: string; full_description: string | null;
  profile_summary: string; help_topics: import("@/lib/specialist-contract.mjs").HelpTopic[];
  work_offers: import("@/lib/specialist-contract.mjs").WorkOffer[];
  avatar_path: string | null; specialization?: string | null;
  additional_category_ids?: string[];
  trust_badges?: SpecialistTrustBadge[];
  verification_facts?: PublicVerificationFacts | null;
};

export type PublicVerificationFacts = {
  specialist_id: string;
  identity_checked: boolean;
  education_checked: boolean;
  experience_checked: boolean;
  qualifications_checked: boolean;
  references_checked: boolean;
  sources_checked: number;
  checked_at: string;
};

export type Review = { id: string; body: string; would_hire_again: boolean; created_at: string };

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  new: "Новая", screening: "Первичная проверка", info_required: "Требуется информация", changes_requested: "Нужно внести изменения",
  call_required: "Нужен созвон", call_scheduled: "Созвон назначен", approved: "Одобрена",
  rejected: "Отклонена", withdrawn: "Архив",
};

export const profileStatusLabels: Record<ProfileStatus, string> = {
  draft: "Черновик", pending: "Ожидает публикации", published: "Опубликован",
  suspended: "Временно скрыт", blocked: "Заблокирован", archived: "Архивирован",
};
