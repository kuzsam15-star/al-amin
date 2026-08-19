import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { runSec001Backfill } from './security/helpers/sec001-backfill.mjs';
import {
  createSec001BackfillSourceRegistry,
  publishCanonicalMedia,
  validatePublicationSource,
} from '../src/lib/published-media.mjs';

const validWebp = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#335577' } }).webp().toBuffer();

function inventoryService(applications, specialists = [], { missing = false } = {}) {
  let rpcCalls = 0;
  let downloadCalls = 0;
  return {
    get rpcCalls() { return rpcCalls; },
    get downloadCalls() { return downloadCalls; },
    from(table) {
      const source = table === 'applications' ? applications : specialists;
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        async range(start, end) { return { data: source.slice(start, end + 1), error: null }; },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'profile-media');
        return { async download() {
          downloadCalls += 1;
          return missing
            ? { data: null, error: new Error('synthetic missing') }
            : { data: new Blob([validWebp], { type: 'image/webp' }), error: null };
        } };
      },
    },
    async rpc() { rpcCalls += 1; return { error: null }; },
  };
}

test('SEC-001 backfill dry-run inventories every page without mutation', async () => {
  const applications = Array.from({ length: 501 }, () => {
    const owner = randomUUID();
    return {
      id: randomUUID(), owner_id: owner,
      main_image_path: `submissions/${owner}/avatar/${randomUUID()}.webp`, gallery_paths: [],
    };
  });
  const service = inventoryService(applications);
  const result = await runSec001Backfill({ service });
  assert.deepEqual(result, {
    planned: 501,
    applied: 0,
    remaining: 501,
    namespaceSummary: {
      allowlistedLegacyReferenceCount: 0,
      allowlistedLegacyObjectCount: 0,
      sharedSameOwnerObjectCount: 0,
      crossOwnerObjectCount: 0,
      unknownReferenceCount: 0,
    },
  });
  assert.equal(service.rpcCalls, 0);
});

function legacyPath(scope = randomUUID(), kind = 'main') {
  return `submissions/${scope}/${kind}-${randomUUID()}.png`;
}

function target(targetType, ownerId, path, id = randomUUID()) {
  return {
    targetType,
    id,
    ownerId,
    avatarPath: path,
    galleryPaths: [],
  };
}

test('SEC-001R discovered entity-scoped legacy family uses authoritative DB ownership', async () => {
  const owner = randomUUID();
  const source = legacyPath(randomUUID());
  const service = inventoryService([{
    id: randomUUID(), owner_id: owner, main_image_path: source, gallery_paths: [],
  }]);
  const result = await runSec001Backfill({ service, dryRun: true });
  assert.equal(result.planned, 1);
  assert.deepEqual(result.namespaceSummary, {
    allowlistedLegacyReferenceCount: 1,
    allowlistedLegacyObjectCount: 1,
    sharedSameOwnerObjectCount: 0,
    crossOwnerObjectCount: 0,
    unknownReferenceCount: 0,
  });
  assert.equal(service.downloadCalls, 1);
});

test('SEC-001R same legacy object shared by two entities of one owner is explicit and safe', async () => {
  const owner = randomUUID();
  const source = legacyPath(randomUUID(), 'gallery-0');
  const service = inventoryService(
    [{ id: randomUUID(), owner_id: owner, main_image_path: source, gallery_paths: [] }],
    [{ id: randomUUID(), owner_id: owner, avatar_path: source, gallery_paths: [] }],
  );
  const result = await runSec001Backfill({ service, dryRun: true });
  assert.equal(result.planned, 2);
  assert.equal(result.namespaceSummary.allowlistedLegacyReferenceCount, 2);
  assert.equal(result.namespaceSummary.allowlistedLegacyObjectCount, 1);
  assert.equal(result.namespaceSummary.sharedSameOwnerObjectCount, 1);
});

test('SEC-001R cross-owner or ambiguous legacy reference blocks before Storage access', async () => {
  const source = legacyPath(randomUUID());
  const service = inventoryService(
    [{ id: randomUUID(), owner_id: randomUUID(), main_image_path: source, gallery_paths: [] }],
    [{ id: randomUUID(), owner_id: randomUUID(), avatar_path: source, gallery_paths: [] }],
  );
  await assert.rejects(runSec001Backfill({ service, dryRun: true }), /cross-owner or ambiguous/u);
  assert.equal(service.downloadCalls, 0);
});

test('SEC-001R authorization is bound to exact DB owner, target, slot and path', async () => {
  const owner = randomUUID();
  const foreignOwner = randomUUID();
  const source = legacyPath(randomUUID());
  const record = target('applications', owner, source);
  const registry = createSec001BackfillSourceRegistry([record]);
  const authorization = registry.authorizationFor({
    targetType: record.targetType,
    targetId: record.id,
    ownerId: record.ownerId,
    slot: 'avatar',
    sourcePath: source,
  });
  const service = inventoryService([]);
  await assert.rejects(validatePublicationSource({
    storage: service.storage,
    ownerId: foreignOwner,
    slot: 'avatar',
    sourcePath: source,
    sourceAuthorization: authorization,
  }), /outside the owner's approved namespace/u);
  assert.equal(service.downloadCalls, 0);
  await assert.rejects(validatePublicationSource({
    storage: service.storage,
    ownerId: owner,
    slot: 'gallery-0',
    sourcePath: source,
    sourceAuthorization: authorization,
  }), /outside the owner's approved namespace/u);
  await assert.rejects(publishCanonicalMedia({
    storage: service.storage,
    ownerId: owner,
    entityType: 'backfill-applications',
    entityId: randomUUID(),
    slot: 'avatar',
    sourcePath: source,
    sourceAuthorization: authorization,
  }), /outside the owner's approved namespace/u);
  assert.equal(service.downloadCalls, 0);
  assert.throws(() => registry.authorizationFor({
    targetType: record.targetType,
    targetId: randomUUID(),
    ownerId: record.ownerId,
    slot: 'avatar',
    sourcePath: source,
  }), /lacks authoritative DB reference proof/u);
});

test('SEC-001R unknown, malformed, traversal, encoded and root namespaces fail closed', () => {
  const owner = randomUUID();
  const id = randomUUID();
  const invalid = [
    `submissions/main-${randomUUID()}.png`,
    `submissions/${randomUUID()}/main-${randomUUID()}.svg`,
    `submissions/${randomUUID()}/../main-${randomUUID()}.png`,
    `submissions/${randomUUID()}/%2e%2e/main-${randomUUID()}.png`,
    `submissions/${randomUUID()}\\main-${randomUUID()}.png`,
    `submissions/${randomUUID()}/main-${randomUUID()}.png/extra`,
    `legacy/${randomUUID()}/main-${randomUUID()}.png`,
  ];
  for (const source of invalid) {
    assert.throws(() => createSec001BackfillSourceRegistry([target('applications', owner, source, id)]), /not allowlisted/u);
  }
});

test('SEC-001R missing allowlisted legacy object fails closed without RPC mutation', async () => {
  const owner = randomUUID();
  const service = inventoryService([{
    id: randomUUID(), owner_id: owner, main_image_path: legacyPath(randomUUID()), gallery_paths: [],
  }], [], { missing: true });
  await assert.rejects(runSec001Backfill({ service, dryRun: true }), /unavailable/u);
  assert.equal(service.rpcCalls, 0);
});

test('SEC-001 backfill rejects an invalid interruption limit before inventory', async () => {
  const service = inventoryService([]);
  await assert.rejects(runSec001Backfill({ service, dryRun: false, stopAfter: -1 }), /stopAfter/u);
  assert.equal(service.rpcCalls, 0);
});
