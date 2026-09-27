export const alaminSubmissionMarker: string;
export const alaminSubmissionFileVersion: 1;
export const alaminSubmissionConsentVersion: 1;
export const alaminSubmissionFileLimits: Readonly<{ packageBytes: number; totalImageBytes: number; attachments: number; imagePixels: number }>;
export function safeAlaminFileName(fullName: string, extension?: string): string;
export function createAlaminSubmissionPackage(input: { packageId: string; createdAt: string; payload: Record<string, unknown>; attachment: { filename: string; mediaType: string; data: string } }): Record<string, unknown>;
export function validateAlaminSubmissionPackage(value: unknown): { errors: string[]; data: any | null; attachmentBytes: number };
export function base64DecodedByteLength(value: unknown): number | null;
export const alaminSubmissionFormatDocumentation: Readonly<Record<string, unknown>>;
