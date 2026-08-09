export type HelpTopic = { title: string; description: string | null };
export type WorkMode = "online" | "offline" | "both";
export type WorkOffer = {
  title: string;
  duration_minutes: number | null;
  mode: WorkMode | null;
  price: number | null;
  currency: string | null;
};
export type ValidationErrors = Record<string, string>;
export type ValidationResult<T> = { data: T; errors: ValidationErrors; error?: never; field?: never } | { data?: never; errors: ValidationErrors; error: string; field: string };

export const MAX_PROFILE_SUMMARY: number;
export const MAX_FULL_DESCRIPTION: number;
export const MAX_HELP_TOPICS: number;
export const MAX_WORK_OFFERS: number;
export const WORK_MODES: readonly WorkMode[];
export const WORK_CURRENCIES: readonly string[];

export function codePointLength(value: string): number;
export function isPlainRecord(value: unknown): value is Record<string, unknown>;
export function isCanonicalUuid(value: unknown): value is string;
export function normalizeSingleLine(value: unknown, options?: { minimum?: number; maximum?: number; requireLetter?: boolean }): ValidationResult<string>;
export function normalizeMultiline(value: unknown, options?: { minimum?: number; maximum?: number; requireLetter?: boolean }): ValidationResult<string>;
export function validateHelpTopics(value: unknown, options?: { required?: boolean; prefix?: string }): ValidationResult<HelpTopic[]>;
export function validateWorkOffers(value: unknown, options?: { required?: boolean; allowLegacyMode?: boolean; prefix?: string }): ValidationResult<WorkOffer[]>;
export function workOfferTitles(workOffers: WorkOffer[]): string[];
export function combinedWorkMode(workOffers: WorkOffer[]): WorkMode;
