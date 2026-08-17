export class ResourceBoundaryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ResourceBoundaryError";
    this.code = code;
    this.status = status;
  }
}

const definitions = Object.freeze({
  applicationBodyBytes: ["ALAMIN_APPLICATION_BODY_BYTES", 96 * 1024, 16 * 1024, 256 * 1024],
  mediaMultipartBytes: ["ALAMIN_MEDIA_MULTIPART_BYTES", 13 * 1024 * 1024, 1024 * 1024, 16 * 1024 * 1024],
  mediaFileBytes: ["ALAMIN_MEDIA_FILE_BYTES", 12 * 1024 * 1024, 512 * 1024, 12 * 1024 * 1024],
  mediaOutputBytes: ["ALAMIN_MEDIA_OUTPUT_BYTES", 5 * 1024 * 1024, 256 * 1024, 5 * 1024 * 1024],
  imageWidth: ["ALAMIN_IMAGE_MAX_WIDTH", 10_000, 512, 12_000],
  imageHeight: ["ALAMIN_IMAGE_MAX_HEIGHT", 10_000, 512, 12_000],
  imagePixels: ["ALAMIN_IMAGE_MAX_PIXELS", 40_000_000, 262_144, 40_000_000],
  imageFrames: ["ALAMIN_IMAGE_MAX_FRAMES", 1, 1, 1],
  imageProcessingSeconds: ["ALAMIN_IMAGE_PROCESSING_SECONDS", 8, 1, 30],
  galleryFiles: ["ALAMIN_GALLERY_MAX_FILES", 10, 1, 10],
  publicCatalogRows: ["ALAMIN_PUBLIC_CATALOG_MAX_ROWS", 100, 12, 200],
  publicReferenceRows: ["ALAMIN_PUBLIC_REFERENCE_MAX_ROWS", 200, 20, 500],
  providerTimeoutMs: ["ALAMIN_PROVIDER_TIMEOUT_MS", 8_000, 1_000, 30_000],
  providerResponseBytes: ["ALAMIN_PROVIDER_RESPONSE_BYTES", 16 * 1024, 1024, 64 * 1024],
  emailBatchSize: ["ALAMIN_EMAIL_BATCH_SIZE", 20, 1, 25],
  mediaWorkerBatchSize: ["ALAMIN_MEDIA_WORKER_BATCH_SIZE", 10, 1, 25],
  mediaConcurrency: ["ALAMIN_MEDIA_CONCURRENCY", 2, 1, 4],
  mediaQueueDepth: ["ALAMIN_MEDIA_QUEUE_DEPTH", 8, 1, 20],
  logFieldCharacters: ["ALAMIN_LOG_FIELD_CHARACTERS", 256, 64, 512],
});

function boundedInteger(env, [name, fallback, minimum, maximum]) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/u.test(raw)) throw new ResourceBoundaryError("resource_configuration_invalid", 503);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ResourceBoundaryError("resource_configuration_invalid", 503);
  }
  return value;
}

export function loadResourceLimits(env = process.env) {
  return Object.freeze(Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [key, boundedInteger(env, definition)]),
  ));
}

export const RESOURCE_LIMITS = loadResourceLimits();

export function assertResourceRuntimeConfigured(env = process.env) {
  if (env.NODE_ENV === "production" && env.ALAMIN_RESOURCE_LIMITS_ACK !== "v1") {
    throw new ResourceBoundaryError("resource_configuration_unconfirmed", 503);
  }
  return true;
}

function declaredLength(request, maximumBytes) {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/u.test(raw) || Number(raw) > maximumBytes) {
    throw new ResourceBoundaryError("body_too_large", 413);
  }
}

export async function readBoundedBody(request, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new ResourceBoundaryError("resource_configuration_invalid", 503);
  }
  declaredLength(request, maximumBytes);
  if (!request.body) throw new ResourceBoundaryError("body_required", 400);
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new ResourceBoundaryError("body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBoundedJson(request, { maximumBytes, maximumFields }) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ResourceBoundaryError("json_required", 415);
  const bytes = await readBoundedBody(request, maximumBytes);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ResourceBoundaryError("invalid_json", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResourceBoundaryError("invalid_payload", 400);
  }
  if (Object.keys(value).length > maximumFields) {
    throw new ResourceBoundaryError("too_many_fields", 400);
  }
  return value;
}

export async function readBoundedFormData(request, { maximumBytes, maximumFields }) {
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType)) {
    throw new ResourceBoundaryError("multipart_required", 415);
  }
  const bytes = await readBoundedBody(request, maximumBytes);
  let form;
  try {
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new ResourceBoundaryError("invalid_multipart", 400);
  }
  if ([...form.keys()].length > maximumFields) throw new ResourceBoundaryError("too_many_fields", 400);
  return form;
}

export async function readBoundedResponseJson(response, maximumBytes) {
  const bytes = await readBoundedBody({ headers: response.headers, body: response.body }, maximumBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ResourceBoundaryError("provider_response_invalid", 503);
  }
}

export function validateImageMetadata(metadata, limits = RESOURCE_LIMITS) {
  const width = metadata?.width;
  const height = metadata?.height;
  const pages = metadata?.pages ?? 1;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return false;
  if (width > limits.imageWidth || height > limits.imageHeight || width * height > limits.imagePixels) return false;
  return Number.isInteger(pages) && pages >= 1 && pages <= limits.imageFrames;
}

export function createBoundedExecutor({ concurrency, queueDepth }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(queueDepth) || queueDepth < 1) {
    throw new ResourceBoundaryError("resource_configuration_invalid", 503);
  }
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return Object.freeze({
    async run(operation) {
      if (active >= concurrency) {
        if (waiting.length >= queueDepth) throw new ResourceBoundaryError("resource_busy", 503);
        await new Promise((resolve) => waiting.push(resolve));
      } else {
        active += 1;
      }
      try {
        return await operation();
      } finally {
        release();
      }
    },
    snapshot() { return { active, queued: waiting.length, concurrency, queueDepth }; },
  });
}

export function boundedPageSize(value, { fallback, maximum }) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) throw new ResourceBoundaryError("invalid_page_size", 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new ResourceBoundaryError("invalid_page_size", 400);
  }
  return number;
}

export function truncatedLogField(value, limit = RESOURCE_LIMITS.logFieldCharacters) {
  const text = typeof value === "string" ? value : "";
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
