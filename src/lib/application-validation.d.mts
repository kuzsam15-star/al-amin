import type { HelpTopic, WorkOffer } from "./specialist-contract.mjs";

export type ContactMethod = "phone" | "telegram";
export type ActiveCategory = { id: string; name: string };
export type ApplicationValidationContext = {
  ownerId?: string;
  activeCategories?: ActiveCategory[];
  allowedExistingMediaPaths?: string[];
  hasPendingMainImage?: boolean;
};
export type ApplicationInput = {
  applicationId?: string;
  fullName: string;
  contactMethod: ContactMethod;
  contact: string;
  country: string;
  city: string;
  categoryId: string;
  additionalCategoryIds: string[];
  specialization: string;
  experienceYears: string;
  profileSummary: string;
  description: string;
  helpTopics: HelpTopic[];
  workOffers: WorkOffer[];
  mainImagePath: string;
  truthful: boolean;
  personalData: boolean;
  website: string;
};
export type ApplicationData = Record<string, unknown> & { contract_version: 2; owner_id?: string; category_text?: string };
export type RevisionData = Record<string, unknown> & { contract_version: 2 };
export type ValidationResult<T> = { data: T; errors: Record<string, string>; error?: never; field?: never } | { data?: never; errors: Record<string, string>; error: string; field: string };

export const CONTACT_METHODS: readonly ContactMethod[];
export const APPLICATION_INPUT_KEYS: readonly string[];
export const PROFILE_REVISION_INPUT_KEYS: readonly string[];
export function inferContactMethod(value: unknown): ContactMethod;
export function normalizeContact(method: unknown, value: unknown): { data: string; error?: never } | { error: string; data?: never };
export function validateApplication(body: unknown, context?: ApplicationValidationContext): ValidationResult<ApplicationData>;
export function validateProfileRevision(body: unknown, context?: ApplicationValidationContext): ValidationResult<RevisionData>;
