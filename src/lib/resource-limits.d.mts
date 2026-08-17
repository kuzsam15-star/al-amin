export class ResourceBoundaryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status?: number);
}

export type ResourceLimits = Readonly<{
  applicationBodyBytes: number;
  mediaMultipartBytes: number;
  mediaFileBytes: number;
  mediaOutputBytes: number;
  imageWidth: number;
  imageHeight: number;
  imagePixels: number;
  imageFrames: number;
  imageProcessingSeconds: number;
  galleryFiles: number;
  publicCatalogRows: number;
  publicReferenceRows: number;
  providerTimeoutMs: number;
  providerResponseBytes: number;
  emailBatchSize: number;
  mediaWorkerBatchSize: number;
  mediaConcurrency: number;
  mediaQueueDepth: number;
  logFieldCharacters: number;
}>;

export const RESOURCE_LIMITS: ResourceLimits;
export function loadResourceLimits(env?: Record<string, string | undefined>): ResourceLimits;
export function assertResourceRuntimeConfigured(env?: Record<string, string | undefined>): true;
export function readBoundedBody(request: Pick<Request, "headers" | "body">, maximumBytes: number): Promise<Uint8Array>;
export function readBoundedJson(request: Request, options: { maximumBytes: number; maximumFields: number }): Promise<Record<string, unknown>>;
export function readBoundedFormData(request: Request, options: { maximumBytes: number; maximumFields: number }): Promise<FormData>;
export function readBoundedResponseJson(response: Response, maximumBytes: number): Promise<unknown>;
export function validateImageMetadata(metadata: { width?: number; height?: number; pages?: number }, limits?: ResourceLimits): boolean;
export function createBoundedExecutor(options: { concurrency: number; queueDepth: number }): Readonly<{
  run<T>(operation: () => Promise<T> | T): Promise<T>;
  snapshot(): { active: number; queued: number; concurrency: number; queueDepth: number };
}>;
export function boundedPageSize(value: unknown, options: { fallback: number; maximum: number }): number;
export function truncatedLogField(value: unknown, limit?: number): string;
