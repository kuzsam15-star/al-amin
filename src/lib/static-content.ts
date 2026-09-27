import siteSource from "../../content/site.json";
import specialistsSource from "../../content/specialists.json";
import { validateContent } from "./static-content-contract.mjs";

export type WorkMode = "online" | "offline" | "both";
export type HelpTopic = { title: string; description?: string };
export type WorkOffer = { title: string; durationMinutes: number | null; mode: WorkMode; price: number | null; currency: string | null };
export type SpecialistContact = { phone?: string; email?: string; telegram?: string; whatsapp?: string; website?: string };
export type SpecialistTrust = { recommendedByAlAmin: boolean; verificationDate?: string; verificationSummary?: string; verifiedFacts: string[] };
export type PortfolioItem = { title: string; description?: string; url?: string };
export type AvatarCrop = { positionX: number; positionY: number; zoom: number };
export type StaticSpecialist = {
  id: string;
  slug: string;
  fullName: string;
  photo: { src: string; avatarSrc?: string; alt: string; avatar: AvatarCrop };
  specialization: string;
  categories: string[];
  country: string;
  city: string;
  workMode: WorkMode;
  profileSummary: string;
  about: string;
  helpTopics: HelpTopic[];
  workOffers: WorkOffer[];
  experienceYears: number | null;
  trust: SpecialistTrust;
  contacts: SpecialistContact;
  portfolio: PortfolioItem[];
  published: boolean;
  featured: boolean;
  sortOrder: number;
};

export type StaticSiteContent = typeof siteSource;

const validated = validateContent(siteSource, specialistsSource);
if (validated.errors.length) throw new Error(`Некорректный статический контент AL-AMIN:\n${validated.errors.join("\n")}`);

export const siteContent = validated.site as StaticSiteContent;
const catalog = validated.catalog as { version: 1; specialists: StaticSpecialist[] } | null;
const allSpecialists = catalog?.specialists ?? [];

export function getPublishedSpecialists() {
  return allSpecialists.filter((item) => item.published).sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}

export function getFeaturedSpecialists() {
  const published = getPublishedSpecialists();
  const featured = published.filter((item) => item.featured);
  return (featured.length ? featured : published).slice(0, 12);
}

export function getSpecialistBySlug(slug: string) {
  return getPublishedSpecialists().find((item) => item.slug === slug) ?? null;
}

export function getCategories() {
  return [...new Set(getPublishedSpecialists().flatMap((item) => item.categories))].sort((a, b) => a.localeCompare(b, "ru"));
}
