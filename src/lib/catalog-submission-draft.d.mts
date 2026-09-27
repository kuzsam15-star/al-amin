export type CatalogSubmissionDraftFields = {
  fullName: string;
  specialization: string;
  country: string;
  city: string;
  workMode: "online" | "offline" | "both";
  experienceYears: string;
  profileSummary: string;
  about: string;
  phone: string;
  email: string;
  telegram: string;
  whatsapp: string;
  website: string;
  consent: boolean;
};

export type CatalogSubmissionDraft = {
  fields: CatalogSubmissionDraftFields;
  taxonomyVersion: string;
  categoryIds: string[];
  legacyCategories: string[];
  missingCategoryRequest: string;
  helpTopics: Array<{ title: string; description: string }>;
  workOffers: Array<{ title: string; mode: "online" | "offline" | "both"; durationMinutes: string; price: string; currency: string }>;
  portfolio: Array<{ title: string; description: string; url: string }>;
  profileCrop: { positionX: number; positionY: number; zoom: number };
  avatar: { positionX: number; positionY: number; zoom: number };
  photoWasSelected: boolean;
};

export const catalogSubmissionDraftStorageKey: string;
export const catalogSubmissionDraftVersion: 2;
export function createEmptyCatalogSubmissionDraft(): CatalogSubmissionDraft;
export function normalizeCatalogSubmissionDraft(value: unknown): CatalogSubmissionDraft | null;
export function serializeCatalogSubmissionDraft(draft: CatalogSubmissionDraft, savedAt?: string): string;
export function parseCatalogSubmissionDraft(raw: string | null): CatalogSubmissionDraft | null;
export function hasMeaningfulCatalogSubmissionDraft(draft: CatalogSubmissionDraft | null): boolean;
