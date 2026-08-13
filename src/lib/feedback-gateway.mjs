import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

export const FEEDBACK_BODY_LIMIT_BYTES = 8 * 1024;
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const idempotencyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const allowedKeys = {
  review: new Set(["specialistId", "body", "contact", "wouldHireAgain", "turnstileToken"]),
  complaint: new Set(["specialistId", "reason", "description", "contact", "materials", "turnstileToken"]),
};

export class FeedbackGatewayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "FeedbackGatewayError";
    this.code = code;
    this.status = status;
  }
}

function requireConfigured(env, name, minimum = 1) {
  const value = env[name]?.trim();
  if (!value || value.length < minimum || /replace-me|your-/iu.test(value)) {
    throw new FeedbackGatewayError("gateway_unavailable", 503);
  }
  return value;
}

function parseOrigin(value, production) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new FeedbackGatewayError("gateway_unavailable", 503);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== value) {
    throw new FeedbackGatewayError("gateway_unavailable", 503);
  }
  if (production && url.protocol !== "https:") throw new FeedbackGatewayError("gateway_unavailable", 503);
  if (!production && !["http:", "https:"].includes(url.protocol)) throw new FeedbackGatewayError("gateway_unavailable", 503);
  return url;
}

export function feedbackGatewayConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const allowedOrigin = parseOrigin(requireConfigured(env, "FEEDBACK_ALLOWED_ORIGIN"), production);
  const proxyMode = requireConfigured(env, "FEEDBACK_TRUSTED_PROXY_MODE");
  if (!new Set(["local", "cloudflare"]).has(proxyMode)) throw new FeedbackGatewayError("gateway_unavailable", 503);
  if (production && proxyMode === "local") throw new FeedbackGatewayError("gateway_unavailable", 503);
  if (!production && proxyMode === "local" && !loopbackHosts.has(allowedOrigin.hostname)) {
    throw new FeedbackGatewayError("gateway_unavailable", 503);
  }
  const turnstileExpectedHostname = requireConfigured(env, "TURNSTILE_EXPECTED_HOSTNAME");
  if (turnstileExpectedHostname.includes(":")) throw new FeedbackGatewayError("gateway_unavailable", 503);
  return {
    production,
    allowedOrigin: allowedOrigin.origin,
    proxyMode,
    turnstileSecret: requireConfigured(env, "TURNSTILE_SECRET_KEY", 20),
    turnstileExpectedHostname,
    fingerprintSecret: requireConfigured(env, "FEEDBACK_FINGERPRINT_SECRET", 32),
  };
}

function normalizeText(value, { label, minimum = 0, maximum, required = true }) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new FeedbackGatewayError("invalid_payload", 422);
    return null;
  }
  if (typeof value !== "string") throw new FeedbackGatewayError("invalid_payload", 422);
  const normalized = value.normalize("NFKC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", " ").trim();
  if (forbiddenControl.test(normalized) || normalized.length < minimum || normalized.length > maximum) {
    throw new FeedbackGatewayError(`invalid_${label}`, 422);
  }
  return normalized;
}

function normalizeMaterials(value) {
  const normalized = normalizeText(value, { label: "materials", minimum: 1, maximum: 3000, required: false });
  if (!normalized) return null;
  const entries = normalized.split("\n").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > 5) throw new FeedbackGatewayError("invalid_materials", 422);
  return entries.map((entry) => {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new FeedbackGatewayError("invalid_materials", 422);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new FeedbackGatewayError("invalid_materials", 422);
    }
    return url.toString();
  }).join("\n");
}

function normalizePayload(kind, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FeedbackGatewayError("invalid_payload", 422);
  const keys = Object.keys(body);
  if (keys.some((key) => !allowedKeys[kind].has(key)) || keys.length !== allowedKeys[kind].size) {
    throw new FeedbackGatewayError("invalid_payload", 422);
  }
  if (typeof body.specialistId !== "string" || !uuid.test(body.specialistId)) {
    throw new FeedbackGatewayError("invalid_target", 422);
  }
  const turnstileToken = normalizeText(body.turnstileToken, { label: "captcha", minimum: 1, maximum: 2048 });
  if (kind === "review") {
    if (typeof body.wouldHireAgain !== "boolean") throw new FeedbackGatewayError("invalid_payload", 422);
    return {
      turnstileToken,
      database: {
        feedbackType: "review",
        targetId: body.specialistId,
        body: normalizeText(body.body, { label: "body", minimum: 30, maximum: 3000 }),
        contact: normalizeText(body.contact, { label: "contact", minimum: 1, maximum: 240, required: false }),
        wouldHireAgain: body.wouldHireAgain,
        reason: null,
        description: null,
        materials: null,
      },
    };
  }
  return {
    turnstileToken,
    database: {
      feedbackType: "complaint",
      targetId: body.specialistId,
      body: null,
      contact: normalizeText(body.contact, { label: "contact", minimum: 3, maximum: 240 }),
      wouldHireAgain: null,
      reason: normalizeText(body.reason, { label: "reason", minimum: 3, maximum: 120 }),
      description: normalizeText(body.description, { label: "description", minimum: 20, maximum: 3000 }),
      materials: normalizeMaterials(body.materials),
    },
  };
}

async function readBoundedJson(request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FeedbackGatewayError("json_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > FEEDBACK_BODY_LIMIT_BYTES)) {
    throw new FeedbackGatewayError("body_too_large", 413);
  }
  if (!request.body) throw new FeedbackGatewayError("invalid_payload", 422);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FEEDBACK_BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new FeedbackGatewayError("body_too_large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FeedbackGatewayError("invalid_json", 400);
  }
}

function clientAddressMaterial(request, config) {
  if (config.proxyMode === "local") {
    const origin = new URL(config.allowedOrigin);
    if (config.production || !loopbackHosts.has(origin.hostname)) throw new FeedbackGatewayError("gateway_unavailable", 503);
    return "local-loopback";
  }
  const forwarded = request.headers.get("cf-connecting-ip")?.trim();
  if (!forwarded || forwarded.includes(",") || isIP(forwarded) === 0) {
    throw new FeedbackGatewayError("client_context_unavailable", 503);
  }
  return forwarded;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function keyedDigest(secret, purpose, value) {
  return createHmac("sha256", secret).update(`alamin-feedback-v1\0${purpose}\0${value}`).digest("hex");
}

async function verifyTurnstile({ token, action, idempotencyKey, config, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.turnstileSecret,
        response: token,
        idempotency_key: idempotencyKey,
      }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
  } catch {
    throw new FeedbackGatewayError("verification_unavailable", 503);
  }
  if (!response.ok) throw new FeedbackGatewayError("verification_unavailable", 503);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new FeedbackGatewayError("verification_unavailable", 503);
  }
  if (!result || result.success !== true || result.action !== action || result.hostname !== config.turnstileExpectedHostname) {
    throw new FeedbackGatewayError("verification_failed", 403);
  }
}

function mapDatabaseError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.includes("rate limit")) return new FeedbackGatewayError("request_limited", 429);
  if (message.includes("idempotency conflict")) return new FeedbackGatewayError("request_conflict", 409);
  if (message.includes("target is unavailable")) return new FeedbackGatewayError("target_unavailable", 422);
  if (error) return new FeedbackGatewayError("gateway_unavailable", 503);
  return null;
}

export function safeFeedbackResponse(error) {
  if (error instanceof FeedbackGatewayError) {
    const clientMessage = error.status === 429
      ? "Please wait before trying again."
      : error.status === 503
        ? "The feedback service is temporarily unavailable."
        : "The request could not be accepted.";
    return { status: error.status, payload: { ok: false, error: clientMessage } };
  }
  return { status: 503, payload: { ok: false, error: "The feedback service is temporarily unavailable." } };
}

export async function executeFeedbackGateway({
  request,
  kind,
  actorId = null,
  databaseSubmitter,
  env = process.env,
  fetchImpl = globalThis.fetch,
  testDependencies = false,
  testCaptchaVerifier,
}) {
  try {
    if (!allowedKeys[kind]) throw new FeedbackGatewayError("gateway_unavailable", 503);
    if (testDependencies && env.NODE_ENV !== "test") throw new FeedbackGatewayError("gateway_unavailable", 503);
    if (actorId !== null && (typeof actorId !== "string" || !uuid.test(actorId))) {
      throw new FeedbackGatewayError("gateway_unavailable", 503);
    }
    const config = feedbackGatewayConfig(env);
    if (request.headers.get("origin") !== config.allowedOrigin) {
      throw new FeedbackGatewayError("origin_denied", 403);
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyUuid.test(idempotencyKey)) throw new FeedbackGatewayError("invalid_idempotency_key", 400);
    const parsed = normalizePayload(kind, await readBoundedJson(request));
    const addressMaterial = clientAddressMaterial(request, config);
    const action = `feedback_${kind}`;
    if (testDependencies) {
      if (typeof testCaptchaVerifier !== "function") throw new FeedbackGatewayError("gateway_unavailable", 503);
      const verified = await testCaptchaVerifier({ token: parsed.turnstileToken, action, idempotencyKey });
      if (verified !== true) throw new FeedbackGatewayError("verification_failed", 403);
    } else {
      await verifyTurnstile({ token: parsed.turnstileToken, action, idempotencyKey, config, fetchImpl });
    }
    const canonicalPayload = JSON.stringify(parsed.database);
    const result = await databaseSubmitter({
      ...parsed.database,
      actorId,
      networkFingerprint: keyedDigest(config.fingerprintSecret, "network", addressMaterial),
      idempotencyKeyHash: keyedDigest(config.fingerprintSecret, "idempotency", idempotencyKey),
      payloadHash: digest(canonicalPayload),
    });
    const mapped = mapDatabaseError(result?.error);
    if (mapped) throw mapped;
    const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
    if (!row || !["accepted", "replayed", "duplicate"].includes(row.result_status)) {
      throw new FeedbackGatewayError("gateway_unavailable", 503);
    }
    return { status: 202, payload: { ok: true } };
  } catch (error) {
    return safeFeedbackResponse(error);
  }
}
