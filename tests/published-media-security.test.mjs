import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  isCanonicalPublishedMediaPath,
  isOwnedSubmissionMediaPath,
  publishCanonicalMedia,
  publishCanonicalMediaSet,
} from '../src/lib/published-media.mjs';

class MemoryStorage {
  constructor(entries = []) {
    this.objects = new Map(entries.map(([path, bytes]) => [path, Buffer.from(bytes)]));
    this.uploads = [];
  }

  from(bucket) {
    assert.equal(bucket, 'profile-media');
    return {
      download: async (path) => {
        const bytes = this.objects.get(path);
        return bytes
          ? { data: new Blob([bytes], { type: 'image/webp' }), error: null }
          : { data: null, error: { message: 'not found' } };
      },
      upload: async (path, body, options) => {
        this.uploads.push({ path, options });
        if (this.objects.has(path) && options.upsert === false) return { data: null, error: { message: 'already exists' } };
        this.objects.set(path, Buffer.from(body));
        return { data: { path }, error: null };
      },
    };
  }
}

const ownerId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const submission = () => `submissions/${ownerId}/avatar/${randomUUID()}.webp`;

test('published-media paths are owner-scoped and reject traversal or foreign ownership', () => {
  const source = submission();
  assert.equal(isOwnedSubmissionMediaPath(ownerId, source), true);
  assert.equal(isOwnedSubmissionMediaPath('33333333-3333-4333-8333-333333333333', source), false);
  assert.equal(isOwnedSubmissionMediaPath(ownerId, `${source}/../../published/escape.webp`), false);
  const hash = 'a'.repeat(64);
  const canonical = `published/${ownerId}/applications/${entityId}/avatar/${hash}.webp`;
  assert.equal(isCanonicalPublishedMediaPath(ownerId, canonical), true);
  assert.equal(isCanonicalPublishedMediaPath(ownerId, canonical.replace('/avatar/', '/avatar/../')), false);
  for (const invalid of [
    source.replace('/avatar/', '//avatar/'),
    source.replace('/avatar/', '/avatar/%2e%2e/'),
    source.replace('/avatar/', '/avatar/..\\'),
    source.replace('/avatar/', '/avatar∕'),
    source.replace('submissions/', 'profile-media/'),
    source.replace('/avatar/', '/gallery/').replace('.webp', '.svg'),
  ]) assert.equal(isOwnedSubmissionMediaPath(ownerId, invalid), false);
  assert.equal(isCanonicalPublishedMediaPath(ownerId, canonical.replace(`/${entityId}/`, `/${randomUUID()}/`)), true);
  assert.equal(isCanonicalPublishedMediaPath(randomUUID(), canonical), false);
  assert.equal(isCanonicalPublishedMediaPath(ownerId, canonical.replace('/applications/', '/unknown/')), false);
  assert.equal(isCanonicalPublishedMediaPath(ownerId, canonical.replace('/avatar/', '/gallery-100/')), false);
});

test('controlled publication validates, transcodes, hashes and never overwrites', async () => {
  const sourcePath = submission();
  const sourceBytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#224466' } }).png().toBuffer();
  const storage = new MemoryStorage([[sourcePath, sourceBytes]]);
  const first = await publishCanonicalMedia({ storage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath });
  assert.equal(first.source_sha256, createHash('sha256').update(sourceBytes).digest('hex'));
  assert.equal(first.canonical_path.endsWith(`/${first.canonical_sha256}.webp`), true);
  assert.equal(storage.uploads[0].options.upsert, false);
  assert.equal(storage.uploads[0].options.contentType, 'image/webp');
  const stored = storage.objects.get(first.canonical_path);
  assert.ok(stored);
  assert.equal(createHash('sha256').update(stored).digest('hex'), first.canonical_sha256);
  assert.equal((await sharp(stored).metadata()).format, 'webp');

  const second = await publishCanonicalMedia({ storage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath });
  assert.deepEqual(second, first);
  assert.equal(storage.uploads[1].options.upsert, false);
  assert.deepEqual(storage.objects.get(first.canonical_path), stored);
});

test('missing, malformed, foreign and conflicting sources fail closed', async () => {
  const missingStorage = new MemoryStorage();
  await assert.rejects(
    publishCanonicalMedia({ storage: missingStorage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: submission() }),
    /unavailable/u,
  );
  assert.equal(missingStorage.uploads.length, 0);

  const malformedPath = submission();
  const malformedStorage = new MemoryStorage([[malformedPath, Buffer.from('not-an-image')]]);
  await assert.rejects(
    publishCanonicalMedia({ storage: malformedStorage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: malformedPath }),
  );
  assert.equal(malformedStorage.uploads.length, 0);

  await assert.rejects(
    publishCanonicalMedia({ storage: malformedStorage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: `submissions/${randomUUID()}/avatar/${randomUUID()}.webp` }),
    /outside the owner's approved namespace/u,
  );
  await assert.rejects(
    publishCanonicalMedia({ storage: malformedStorage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: `published/${ownerId}/applications/${entityId}/avatar/${'a'.repeat(64)}.webp` }),
    /outside the owner's approved namespace/u,
  );

  const validPath = submission();
  const validBytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#557799' } }).webp().toBuffer();
  const conflictStorage = new MemoryStorage([[validPath, validBytes]]);
  const published = await publishCanonicalMedia({ storage: conflictStorage, ownerId, entityType: 'revisions', entityId, slot: 'avatar', sourcePath: validPath });
  conflictStorage.objects.set(published.canonical_path, Buffer.from('different-canonical-bytes'));
  await assert.rejects(
    publishCanonicalMedia({ storage: conflictStorage, ownerId, entityType: 'revisions', entityId, slot: 'avatar', sourcePath: validPath }),
    /conflicts with different bytes/u,
  );
});

test('zero-byte, truncated, SVG and excessive-pixel inputs fail before canonical upload', async () => {
  const cases = [
    Buffer.alloc(0),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'),
  ];
  for (const bytes of cases) {
    const path = submission();
    const storage = new MemoryStorage([[path, bytes]]);
    await assert.rejects(publishCanonicalMedia({ storage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: path }));
    assert.equal(storage.uploads.length, 0);
  }

  const oversizedPixels = await sharp({
    create: { width: 6325, height: 6325, channels: 3, background: '#113355' },
  }).png({ compressionLevel: 9 }).toBuffer();
  const oversizedPath = submission();
  const oversizedStorage = new MemoryStorage([[oversizedPath, oversizedPixels]]);
  await assert.rejects(
    publishCanonicalMedia({ storage: oversizedStorage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: oversizedPath }),
    /pixel|limit|image/u,
  );
  assert.equal(oversizedStorage.uploads.length, 0);
});

test('content identity is stable across retries and owner/entity boundaries remain distinct', async () => {
  const firstSource = submission();
  const secondSource = submission();
  const bytes = await sharp({ create: { width: 7, height: 7, channels: 3, background: '#446688' } }).png().toBuffer();
  const storage = new MemoryStorage([[firstSource, bytes], [secondSource, bytes]]);
  const first = await publishCanonicalMedia({ storage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: firstSource });
  const sameEntity = await publishCanonicalMedia({ storage, ownerId, entityType: 'applications', entityId, slot: 'avatar', sourcePath: secondSource });
  assert.equal(sameEntity.canonical_sha256, first.canonical_sha256);
  assert.equal(sameEntity.canonical_path, first.canonical_path);
  assert.notEqual(sameEntity.source_path, first.source_path);

  const otherEntity = await publishCanonicalMedia({ storage, ownerId, entityType: 'revisions', entityId: randomUUID(), slot: 'avatar', sourcePath: secondSource });
  assert.equal(otherEntity.canonical_sha256, first.canonical_sha256);
  assert.notEqual(otherEntity.canonical_path, first.canonical_path);
});

test('avatar and ordered gallery slots receive independent canonical paths', async () => {
  const avatarPath = submission();
  const galleryPaths = [0, 1].map(() => `submissions/${ownerId}/gallery/${randomUUID()}.webp`);
  const sources = await Promise.all([
    sharp({ create: { width: 6, height: 7, channels: 3, background: '#113355' } }).png().toBuffer(),
    sharp({ create: { width: 7, height: 6, channels: 3, background: '#335577' } }).jpeg().toBuffer(),
    sharp({ create: { width: 8, height: 5, channels: 3, background: '#557799' } }).webp().toBuffer(),
  ]);
  const storage = new MemoryStorage([
    [avatarPath, sources[0]],
    [galleryPaths[0], sources[1]],
    [galleryPaths[1], sources[2]],
  ]);
  const published = await publishCanonicalMediaSet({
    storage,
    ownerId,
    entityType: 'revisions',
    entityId,
    avatarPath,
    galleryPaths,
  });
  assert.match(published.avatar.canonical_path, /\/avatar\/[0-9a-f]{64}\.webp$/u);
  assert.match(published.gallery[0].canonical_path, /\/gallery-0\/[0-9a-f]{64}\.webp$/u);
  assert.match(published.gallery[1].canonical_path, /\/gallery-1\/[0-9a-f]{64}\.webp$/u);
  assert.equal(new Set([published.avatar.canonical_path, ...published.gallery.map((item) => item.canonical_path)]).size, 3);
  assert.equal(storage.uploads.every((entry) => entry.options.upsert === false), true);
});
