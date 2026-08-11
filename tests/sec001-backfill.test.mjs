import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { runSec001Backfill } from './security/helpers/sec001-backfill.mjs';

const validWebp = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#335577' } }).webp().toBuffer();

function inventoryService(applications) {
  let rpcCalls = 0;
  return {
    get rpcCalls() { return rpcCalls; },
    from(table) {
      const source = table === 'applications' ? applications : [];
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
        return { async download() { return { data: new Blob([validWebp], { type: 'image/webp' }), error: null }; } };
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
  assert.deepEqual(result, { planned: 501, applied: 0, remaining: 501 });
  assert.equal(service.rpcCalls, 0);
});

test('SEC-001 backfill rejects an invalid interruption limit before inventory', async () => {
  const service = inventoryService([]);
  await assert.rejects(runSec001Backfill({ service, dryRun: false, stopAfter: -1 }), /stopAfter/u);
  assert.equal(service.rpcCalls, 0);
});
