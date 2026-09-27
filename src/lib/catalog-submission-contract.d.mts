export const catalogSubmissionContractVersion: 2;
export const catalogSubmissionConsent: string;
export const catalogSubmissionLimits: Readonly<{ photoBytes: number; categories: number; helpTopics: number; workOffers: number; portfolio: number }>;
export function validateCatalogSubmissionPayload(value: unknown, options?: { requirePhoto?: boolean }): { errors: string[]; data: Record<string, unknown> | null };
export function catalogSubmissionToSpecialistDraft(submission: Record<string, any>): Record<string, any>;
