import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import {
  FEEDBACK_BODY_LIMIT_BYTES,
  TURNSTILE_VERIFY_URL,
  executeFeedbackGateway,
} from "../src/lib/feedback-gateway.mjs";

const targetId = "11111111-1111-4111-8111-111111111111";

function environment(overrides = {}) {
  return {
    NODE_ENV: "test",
    FEEDBACK_ALLOWED_ORIGIN: "http://localhost:3000",
    FEEDBACK_TRUSTED_PROXY_MODE: "local",
    TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret-only-for-tests",
    TURNSTILE_EXPECTED_HOSTNAME: "localhost",
    FEEDBACK_FINGERPRINT_SECRET: "synthetic-feedback-fingerprint-secret-at-least-32-bytes",
    ...overrides,
  };
}

function reviewPayload(overrides = {}) {
  return {
    specialistId: targetId,
    body: "Synthetic review body long enough for the secure feedback contract.",
    contact: "reviewer@example.invalid",
    wouldHireAgain: true,
    turnstileToken: "synthetic-captcha-token",
    ...overrides,
  };
}

function complaintPayload(overrides = {}) {
  return {
    specialistId: targetId,
    reason: "Synthetic reason",
    description: "Synthetic complaint description long enough for the secure contract.",
    contact: "reporter@example.invalid",
    materials: "https://example.invalid/evidence",
    turnstileToken: "synthetic-captcha-token",
    ...overrides,
  };
}

function request(payload, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
    "Idempotency-Key": options.idempotencyKey ?? randomUUID(),
    ...options.headers,
  };
  return new Request("http://localhost:3000/api/reviews", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(payload),
  });
}

async function execute({
  kind = "review",
  payload = reviewPayload(),
  requestValue,
  env = environment(),
  captcha = async () => true,
  submit = async () => ({ data: [{ result_status: "accepted", feedback_id: randomUUID() }], error: null }),
  actorId = null,
} = {}) {
  return await executeFeedbackGateway({
    request: requestValue ?? request(payload),
    kind,
    actorId,
    databaseSubmitter: submit,
    env,
    testDependencies: true,
    testCaptchaVerifier: captcha,
  });
}

test("valid review uses normalized exact server contract and pseudonymous digests", async () => {
  let received;
  const result = await execute({
    payload: reviewPayload({ body: "  Ｓynthetic review body long enough for the secure feedback contract.  " }),
    actorId: "22222222-2222-4222-8222-222222222222",
    submit: async (input) => {
      received = input;
      return { data: [{ result_status: "accepted", feedback_id: randomUUID() }], error: null };
    },
  });
  assert.deepEqual(result, { status: 202, payload: { ok: true } });
  assert.equal(received.feedbackType, "review");
  assert.match(received.body, /^Synthetic/u);
  assert.equal(received.reason, null);
  assert.match(received.networkFingerprint, /^[0-9a-f]{64}$/u);
  assert.match(received.idempotencyKeyHash, /^[0-9a-f]{64}$/u);
  assert.match(received.payloadHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(received.networkFingerprint, /local-loopback/u);
});

test("valid complaint keeps only the complaint allowlist", async () => {
  let received;
  const result = await execute({
    kind: "complaint",
    payload: complaintPayload(),
    requestValue: request(complaintPayload()),
    submit: async (input) => {
      received = input;
      return { data: [{ result_status: "accepted", feedback_id: randomUUID() }], error: null };
    },
  });
  assert.equal(result.status, 202);
  assert.equal(received.feedbackType, "complaint");
  assert.equal(received.body, null);
  assert.equal(received.wouldHireAgain, null);
  assert.equal(received.materials, "https://example.invalid/evidence");
});

test("wrong, missing, and simple content types are rejected before parsing", async () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
    const result = await execute({ requestValue: request(reviewPayload(), { headers: { "Content-Type": contentType } }) });
    assert.equal(result.status, 415, contentType);
  }
});

test("malformed JSON is rejected", async () => {
  const result = await execute({ requestValue: request(null, { rawBody: "{" }) });
  assert.equal(result.status, 400);
});

test("declared and streamed oversized bodies are rejected", async () => {
  const declared = await execute({ requestValue: request(reviewPayload(), { headers: { "Content-Length": String(FEEDBACK_BODY_LIMIT_BYTES + 1) } }) });
  assert.equal(declared.status, 413);

  const chunk = new Uint8Array(FEEDBACK_BODY_LIMIT_BYTES + 1).fill(65);
  const streamed = new Request("http://localhost:3000/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "Idempotency-Key": randomUUID() },
    body: new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } }),
    duplex: "half",
  });
  const actual = await execute({ requestValue: streamed });
  assert.equal(actual.status, 413);
});

test("protected and unknown fields fail the exact payload allowlist", async () => {
  for (const injection of [
    { status: "resolved" }, { internal_notes: "x" }, { is_published: true },
    { evidence_checked: true }, { owner_id: targetId }, { role: "admin" },
  ]) {
    let submitted = false;
    const result = await execute({
      payload: reviewPayload(injection),
      requestValue: request(reviewPayload(injection)),
      submit: async () => { submitted = true; return { data: null, error: null }; },
    });
    assert.equal(result.status, 422);
    assert.equal(submitted, false);
  }
});

test("forbidden control characters and invalid lengths fail closed", async () => {
  assert.equal((await execute({ payload: reviewPayload({ body: "Valid length review body with hidden\u0001control." }), requestValue: request(reviewPayload({ body: "Valid length review body with hidden\u0001control." })) })).status, 422);
  assert.equal((await execute({ payload: reviewPayload({ body: "too short" }), requestValue: request(reviewPayload({ body: "too short" })) })).status, 422);
});

test("same-origin gate rejects absent and mismatched origins", async () => {
  for (const origin of ["", "https://attacker.example", "http://127.0.0.1:3000"]) {
    const result = await execute({ requestValue: request(reviewPayload(), { headers: { Origin: origin } }) });
    assert.equal(result.status, 403, origin);
  }
});

test("missing or malformed idempotency key is rejected", async () => {
  for (const key of ["", "not-a-uuid", "11111111-1111-1111-8111-111111111111"]) {
    const result = await execute({ requestValue: request(reviewPayload(), { idempotencyKey: key }) });
    assert.equal(result.status, 400, key);
  }
});

test("CAPTCHA missing, failed, and test verifier error fail closed", async () => {
  const missing = await execute({ payload: reviewPayload({ turnstileToken: "" }), requestValue: request(reviewPayload({ turnstileToken: "" })) });
  assert.equal(missing.status, 422);
  assert.equal((await execute({ captcha: async () => false })).status, 403);
  assert.equal((await execute({ captcha: async () => { throw new Error("synthetic provider failure"); } })).status, 503);
});

test("real Turnstile path validates action and hostname and fails closed on provider errors", async () => {
  const base = () => ({
    request: request(reviewPayload()), kind: "review", databaseSubmitter: async () => ({ data: [{ result_status: "accepted" }], error: null }), env: environment(),
  });
  const goodFetch = async (url, init) => {
    assert.equal(url, TURNSTILE_VERIFY_URL);
    const sent = JSON.parse(init.body);
    assert.equal(sent.response, "synthetic-captcha-token");
    return new Response(JSON.stringify({ success: true, action: "feedback_review", hostname: "localhost" }), { status: 200 });
  };
  assert.equal((await executeFeedbackGateway({ ...base(), fetchImpl: goodFetch })).status, 202);
  assert.equal((await executeFeedbackGateway({ ...base(), fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "wrong", hostname: "localhost" }), { status: 200 }) })).status, 403);
  assert.equal((await executeFeedbackGateway({ ...base(), fetchImpl: async () => { throw new Error("offline"); } })).status, 503);
});

test("test CAPTCHA injection is impossible in production mode", async () => {
  let called = false;
  const result = await execute({
    env: environment({ NODE_ENV: "production", FEEDBACK_ALLOWED_ORIGIN: "https://example.invalid", FEEDBACK_TRUSTED_PROXY_MODE: "cloudflare", TURNSTILE_EXPECTED_HOSTNAME: "example.invalid" }),
    requestValue: request(reviewPayload(), { headers: { Origin: "https://example.invalid", "cf-connecting-ip": "192.0.2.1" } }),
    captcha: async () => { called = true; return true; },
  });
  assert.equal(result.status, 503);
  assert.equal(called, false);
});

test("local mode ignores spoofed forwarding headers", async () => {
  const fingerprints = [];
  for (const spoofed of ["192.0.2.10", "203.0.113.200"]) {
    const result = await execute({
      requestValue: request(reviewPayload(), { headers: { "x-forwarded-for": spoofed, "cf-connecting-ip": spoofed } }),
      submit: async (input) => { fingerprints.push(input.networkFingerprint); return { data: [{ result_status: "accepted" }], error: null }; },
    });
    assert.equal(result.status, 202);
  }
  assert.equal(fingerprints[0], fingerprints[1]);
});

test("cloudflare mode requires one syntactically valid trusted header", async () => {
  const env = environment({ FEEDBACK_TRUSTED_PROXY_MODE: "cloudflare" });
  assert.equal((await execute({ env })).status, 503);
  assert.equal((await execute({ env, requestValue: request(reviewPayload(), { headers: { "cf-connecting-ip": "192.0.2.10, 198.51.100.1" } }) })).status, 503);
  assert.equal((await execute({ env, requestValue: request(reviewPayload(), { headers: { "cf-connecting-ip": "192.0.2.10" } }) })).status, 202);
});

test("database rate, conflict, target, and provider errors map to generic responses", async () => {
  const cases = [
    ["feedback rate limit exceeded", 429],
    ["feedback idempotency conflict", 409],
    ["feedback target is unavailable", 422],
    ["synthetic unknown database detail", 503],
  ];
  for (const [message, status] of cases) {
    const result = await execute({ submit: async () => ({ data: null, error: { message } }) });
    assert.equal(result.status, status);
    assert.doesNotMatch(result.payload.error, /database|idempotency|target|rate limit/iu);
  }
});

test("stored feedback is rendered as escaped React text, not executable markup", async () => {
  let stored;
  const attack = "Synthetic review <script>alert('x')</script> remains inert plain text.";
  const result = await execute({
    payload: reviewPayload({ body: attack }),
    requestValue: request(reviewPayload({ body: attack })),
    submit: async (input) => { stored = input.body; return { data: [{ result_status: "accepted" }], error: null }; },
  });
  assert.equal(result.status, 202);
  const markup = renderToStaticMarkup(createElement("p", null, stored));
  assert.doesNotMatch(markup, /<script>/iu);
  assert.match(markup, /&lt;script&gt;/u);
});

test("materials accept bounded credential-free HTTPS URLs only", async () => {
  for (const materials of ["http://example.invalid/a", "https://user:pass@example.invalid/a", "https://example.invalid/a#token", "https://a.invalid\nhttps://b.invalid\nhttps://c.invalid\nhttps://d.invalid\nhttps://e.invalid\nhttps://f.invalid"]) {
    const payload = complaintPayload({ materials });
    assert.equal((await execute({ kind: "complaint", payload, requestValue: request(payload) })).status, 422);
  }
});
