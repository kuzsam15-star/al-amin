import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertResourceRuntimeConfigured,
  boundedPageSize,
  createBoundedExecutor,
  loadResourceLimits,
  readBoundedBody,
  readBoundedFormData,
  readBoundedJson,
  readBoundedResponseJson,
  RESOURCE_LIMITS,
  ResourceBoundaryError,
  truncatedLogField,
  validateImageMetadata,
} from '../src/lib/resource-limits.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('streaming body boundary accepts N bytes and rejects N+1 without Content-Length', async () => {
  const maximum = 16;
  const exact = new Request('http://localhost/test', { method: 'POST', body: new Uint8Array(maximum) });
  assert.equal((await readBoundedBody(exact, maximum)).byteLength, maximum);

  const oversized = new Request('http://localhost/test', {
    method: 'POST',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maximum + 1)); controller.close(); } }),
    duplex: 'half',
  });
  assert.equal(oversized.headers.has('content-length'), false);
  await assert.rejects(readBoundedBody(oversized, maximum), (error) => error instanceof ResourceBoundaryError && error.status === 413);
});

test('JSON and multipart parsers enforce content type, byte and field-count limits', async () => {
  const good = new Request('http://localhost/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  assert.deepEqual(await readBoundedJson(good, { maximumBytes: 7, maximumFields: 1 }), { a: 1 });
  const excessFields = new Request('http://localhost/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1,"b":2}' });
  await assert.rejects(readBoundedJson(excessFields, { maximumBytes: 32, maximumFields: 1 }), /too_many_fields/u);
  const wrongType = new Request('http://localhost/test', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  await assert.rejects(readBoundedJson(wrongType, { maximumBytes: 16, maximumFields: 1 }), /json_required/u);

  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'fixture.webp', { type: 'image/webp' }));
  form.set('kind', 'avatar');
  const multipart = new Request('http://localhost/test', { method: 'POST', body: form });
  const parsed = await readBoundedFormData(multipart, { maximumBytes: 2048, maximumFields: 2 });
  assert.equal(parsed.get('kind'), 'avatar');
  const tooMany = new FormData();
  tooMany.set('file', new File([new Uint8Array([1])], 'fixture.webp', { type: 'image/webp' }));
  tooMany.set('kind', 'avatar');
  tooMany.set('unexpected', 'x');
  await assert.rejects(readBoundedFormData(new Request('http://localhost/test', { method: 'POST', body: tooMany }), { maximumBytes: 2048, maximumFields: 2 }), /too_many_fields/u);
});

test('resource configuration has bounded values and production acknowledgement fails closed', () => {
  assert.equal(loadResourceLimits({ ALAMIN_IMAGE_MAX_WIDTH: '10000' }).imageWidth, 10000);
  for (const invalid of ['0', '-1', 'NaN', '12001', 'unlimited']) {
    assert.throws(() => loadResourceLimits({ ALAMIN_IMAGE_MAX_WIDTH: invalid }), /resource_configuration_invalid/u);
  }
  assert.throws(() => assertResourceRuntimeConfigured({ NODE_ENV: 'production' }), /resource_configuration_unconfirmed/u);
  assert.equal(assertResourceRuntimeConfigured({ NODE_ENV: 'production', ALAMIN_RESOURCE_LIMITS_ACK: 'v1' }), true);
});

test('image, pagination and log boundaries cover their exact limits', () => {
  assert.equal(validateImageMetadata({ width: RESOURCE_LIMITS.imageWidth, height: 1, pages: 1 }), true);
  assert.equal(validateImageMetadata({ width: RESOURCE_LIMITS.imageWidth + 1, height: 1, pages: 1 }), false);
  assert.equal(validateImageMetadata({ width: 10_000, height: 4_001, pages: 1 }), false);
  assert.equal(validateImageMetadata({ width: 10, height: 10, pages: 2 }), false);
  assert.equal(boundedPageSize(String(RESOURCE_LIMITS.publicCatalogRows), { fallback: 12, maximum: RESOURCE_LIMITS.publicCatalogRows }), RESOURCE_LIMITS.publicCatalogRows);
  assert.throws(() => boundedPageSize(String(RESOURCE_LIMITS.publicCatalogRows + 1), { fallback: 12, maximum: RESOURCE_LIMITS.publicCatalogRows }), /invalid_page_size/u);
  const attack = 'x'.repeat(RESOURCE_LIMITS.logFieldCharacters + 100);
  assert.equal(truncatedLogField(attack).length, RESOURCE_LIMITS.logFieldCharacters + 1);
});

test('bounded executor limits concurrency and queue amplification', async () => {
  const executor = createBoundedExecutor({ concurrency: 1, queueDepth: 1 });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = executor.run(async () => blocker);
  const second = executor.run(async () => 'second');
  await assert.rejects(executor.run(async () => 'third'), /resource_busy/u);
  assert.deepEqual(executor.snapshot(), { active: 1, queued: 1, concurrency: 1, queueDepth: 1 });
  release();
  await first;
  assert.equal(await second, 'second');
});

test('provider response bodies are bounded and malformed payloads fail closed', async () => {
  const good = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await readBoundedResponseJson(good, 32), { ok: true });
  const huge = new Response(JSON.stringify({ detail: 'x'.repeat(2048) }));
  await assert.rejects(readBoundedResponseJson(huge, 64), /body_too_large/u);
  await assert.rejects(readBoundedResponseJson(new Response('not-json'), 64), /provider_response_invalid/u);
});

test('SEC-017 routes use bounded gateways and server-owned media provenance', async () => {
  const [applications, media, view, provider, feedback, ownerMedia, catalog, migration] = await Promise.all([
    read('src/app/api/applications/route.ts'),
    read('src/app/api/media/route.ts'),
    read('src/app/api/media/view/route.ts'),
    read('src/lib/email/provider.ts'),
    read('src/lib/feedback-gateway.mjs'),
    read('src/components/OwnerMediaFields.tsx'),
    read('src/app/specialists/page.tsx'),
    read('supabase/forward-migrations/20260817103731_p010_resource_auth_release_controls.sql'),
  ]);
  assert.match(applications, /readBoundedJson/);
  assert.doesNotMatch(applications, /request\.text\(\)/u);
  assert.match(media, /readBoundedFormData/);
  assert.match(media, /createSupabaseAdminClient/);
  assert.match(media, /register_submission_media_v1/);
  assert.match(media, /createBoundedExecutor/);
  assert.match(view, /canonical media hash mismatch/);
  assert.match(view, /max-age=31536000, immutable/);
  assert.match(provider, /AbortSignal\.timeout\(RESOURCE_LIMITS\.providerTimeoutMs\)/u);
  assert.match(provider, /readBoundedResponseJson/);
  assert.match(feedback, /readBoundedResponseJson/);
  assert.doesNotMatch(ownerMedia, /Promise\.all\(files\.map/u);
  assert.match(catalog, /\.limit\(RESOURCE_LIMITS\.publicCatalogRows\)/u);
  assert.match(migration, /drop policy if exists "Owners upload unique submission media"/u);
  assert.match(migration, /allowed_mime_types=array\['image\/webp'\]/u);
  assert.match(migration, /submission_media_assets/u);
});

test('Auth closure has Next 16 proxy refresh, enrollment gate, safe redirect and no-store callback', async () => {
  const [proxy, proxyHelper, auth, enrollment, navigation, callback] = await Promise.all([
    read('src/proxy.ts'),
    read('src/lib/supabase/proxy.ts'),
    read('src/lib/auth.ts'),
    read('src/app/admin/mfa/MfaEnrollment.tsx'),
    read('src/lib/navigation.ts'),
    read('src/app/auth/callback/route.ts'),
  ]);
  assert.match(proxy, /refreshSupabaseSession/);
  assert.match(proxyHelper, /auth\.getClaims\(\)/u);
  assert.match(proxyHelper, /private, no-store/);
  assert.match(auth, /mfa\.listFactors\(\)/u);
  assert.match(auth, /factor\.status === "verified"/u);
  assert.match(enrollment, /mfa\.challengeAndVerify/u);
  assert.match(navigation, /safeNextPath/);
  assert.match(callback, /private, no-store/);
});

test('SEC-026 public site-content grant excludes the operational actor column', async () => {
  const migration = await read('supabase/forward-migrations/20260817103731_p010_resource_auth_release_controls.sql');
  const publicGrant = migration.match(/grant select \(([^)]+)\)\s+on table public\.site_content to anon,authenticated;/u)?.[1] ?? '';
  assert.ok(publicGrant);
  assert.doesNotMatch(publicGrant, /updated_by/u);
  assert.match(publicGrant, /brand_name/u);
});
