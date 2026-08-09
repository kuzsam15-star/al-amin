import "server-only";

import { createPublicClient } from "@/lib/supabase/public";
import { profileMediaUrl } from "@/lib/media-paths";
import { displayCity } from "@/lib/profile-presentation";
import { loadPublicVerificationFacts, hasPublicVerification } from "@/lib/public-verification-facts";
import {
  createMockPublicSpecialistCard,
  createRealPublicSpecialistCard,
  type PublicSpecialistCard,
} from "@/lib/public-specialist-card";

type PublishedSpecialistRow = {
  id: string;
  slug: string;
  full_name: string;
  city: string | null;
  service_mode: string | null;
  specialization: string | null;
  avatar_path: string;
  category_name: string | null;
};

const mockSpecialists: PublicSpecialistCard[] = [
  createMockPublicSpecialistCard({
    id: "preview-rustam",
    name: "Рустам Каримов",
    specialization: "Архитектор и проектировщик",
    location: "Москва",
    workFormat: "Онлайн и офлайн",
    photo: "/design-preview/rustam-karimov.png",
    photoAlt: "Рустам Каримов",
    verificationState: "published",
  }),
  createMockPublicSpecialistCard({
    id: "preview-timur",
    name: "Тимур Ахметов",
    specialization: "Финансовый консультант",
    location: "Казань",
    workFormat: "Онлайн",
    photo: "/design-preview/amina-safina.png",
    photoAlt: "Тимур Ахметов",
    verificationState: "published",
  }),
  createMockPublicSpecialistCard({
    id: "preview-amina",
    name: "Амина Сафина",
    specialization: "Семейный психолог",
    location: "Уфа",
    workFormat: "Онлайн и офлайн",
    photo: "/design-preview/darya-orlova.png",
    photoAlt: "Амина Сафина",
    verificationState: "published",
  }),
  createMockPublicSpecialistCard({
    id: "preview-elena",
    name: "Елена Морозова",
    specialization: "Карьерный консультант",
    location: "Санкт-Петербург",
    workFormat: "Онлайн",
    photo: "/design-preview/timur-akhmetov.png",
    photoAlt: "Елена Морозова",
    verificationState: "published",
  }),
  createMockPublicSpecialistCard({
    id: "preview-darya",
    name: "Дарья Орлова",
    specialization: "Дизайнер интерьеров",
    location: "Москва",
    workFormat: "Онлайн и офлайн",
    photo: "/design-preview/elena-morozova.png",
    photoAlt: "Дарья Орлова",
    verificationState: "published",
  }),
];

const modeLabels: Record<string, string> = {
  online: "Онлайн",
  offline: "Офлайн",
  both: "Онлайн и офлайн",
};

export async function loadCivicHomeSpecialists(): Promise<PublicSpecialistCard[]> {
  const supabase = createPublicClient();
  if (!supabase) return mockSpecialists;

  const { data } = await supabase
    .from("published_specialists")
    .select("id,slug,full_name,city,service_mode,specialization,avatar_path,category_name,published_at")
    .not("avatar_path", "is", null)
    .order("published_at", { ascending: false })
    .limit(12);

  const rows = (data ?? []) as unknown as PublishedSpecialistRow[];
  const verification = await loadPublicVerificationFacts(supabase, rows.map((item) => item.id));
  const real = rows.flatMap((item) => {
    const card = createRealPublicSpecialistCard({
      id: item.id,
      slug: item.slug,
      name: item.full_name,
      specialization: item.specialization?.trim() || item.category_name || "Специалист",
      location: displayCity(item.city),
      workFormat: item.service_mode ? modeLabels[item.service_mode] ?? item.service_mode : "",
      photo: profileMediaUrl(item.avatar_path),
      photoAlt: item.full_name,
      verificationState: hasPublicVerification(verification.get(item.id)) ? "verified" : "published",
    });
    return card ? [card] : [];
  });

  if (real.length >= 5) return real;
  return [...real, ...mockSpecialists.slice(0, 5 - real.length)];
}
