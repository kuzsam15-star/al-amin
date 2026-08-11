import { isCanonicalPublishedMediaPath, publishCanonicalMedia, validatePublicationSource } from '../../../src/lib/published-media.mjs';

const contracts = {
  applications: {
    table: 'applications',
    status: 'approved',
    avatar: 'main_image_path',
    gallery: 'gallery_paths',
    entityType: 'backfill-applications',
  },
  specialists: {
    table: 'specialists',
    status: 'published',
    avatar: 'avatar_path',
    gallery: 'gallery_paths',
    entityType: 'backfill-specialists',
  },
};

function contractFor(targetType) {
  const contract = contracts[targetType];
  if (!contract) throw new Error('SEC-001 backfill target type is invalid');
  return contract;
}

async function inventory(service, targetType) {
  const contract = contractFor(targetType);
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await service
      .from(contract.table)
      .select(`id,owner_id,${contract.avatar},${contract.gallery}`)
      .eq('status', contract.status)
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`SEC-001 ${targetType} inventory failed`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    avatarPath: row[contract.avatar] ?? null,
    galleryPaths: Array.isArray(row[contract.gallery]) ? row[contract.gallery] : [],
    contract,
  }));
}

function needsBackfill(target) {
  if (target.avatarPath && !isCanonicalPublishedMediaPath(target.ownerId, target.avatarPath)) return true;
  return target.galleryPaths.some((path) => !isCanonicalPublishedMediaPath(target.ownerId, path));
}

async function validateTarget(service, target) {
  if (target.avatarPath && !isCanonicalPublishedMediaPath(target.ownerId, target.avatarPath)) {
    await validatePublicationSource({ storage: service.storage, ownerId: target.ownerId, slot: 'avatar', sourcePath: target.avatarPath });
  }
  for (let index = 0; index < target.galleryPaths.length; index += 1) {
    const sourcePath = target.galleryPaths[index];
    if (!isCanonicalPublishedMediaPath(target.ownerId, sourcePath)) {
      await validatePublicationSource({ storage: service.storage, ownerId: target.ownerId, slot: `gallery-${index}`, sourcePath });
    }
  }
}

async function descriptorFor(service, target, slot, sourcePath) {
  if (isCanonicalPublishedMediaPath(target.ownerId, sourcePath)) return null;
  return await publishCanonicalMedia({
    storage: service.storage,
    ownerId: target.ownerId,
    entityType: target.contract.entityType,
    entityId: target.id,
    slot,
    sourcePath,
  });
}

async function applyTarget(service, target) {
  const avatar = target.avatarPath
    ? await descriptorFor(service, target, 'avatar', target.avatarPath)
    : null;
  const gallery = [];
  for (let index = 0; index < target.galleryPaths.length; index += 1) {
    gallery.push(await descriptorFor(service, target, `gallery-${index}`, target.galleryPaths[index]));
  }
  const { error } = await service.rpc('backfill_canonical_published_media', {
    target_type: target.contract === contracts.applications ? 'applications' : 'specialists',
    target_uuid: target.id,
    expected_avatar_path: target.avatarPath,
    expected_gallery_paths: target.galleryPaths,
    avatar_descriptor: avatar,
    gallery_descriptors: gallery,
  });
  if (error) throw new Error('SEC-001 backfill database cutover failed closed');
}

/**
 * Owner-operated backfill core. The caller supplies a service-only client at runtime.
 * Credentials, paths, row identifiers, and user data are never logged or persisted here.
 */
export async function runSec001Backfill({ service, dryRun = true, stopAfter = Number.POSITIVE_INFINITY }) {
  if (!service || typeof service.from !== 'function' || typeof service.rpc !== 'function') {
    throw new Error('SEC-001 backfill requires an explicit controlled service client');
  }
  if ((stopAfter !== Number.POSITIVE_INFINITY && !Number.isInteger(stopAfter)) || stopAfter < 0) {
    throw new Error('SEC-001 backfill stopAfter is invalid');
  }

  const targets = [
    ...(await inventory(service, 'applications')),
    ...(await inventory(service, 'specialists')),
  ].filter(needsBackfill);
  if (dryRun) {
    for (const target of targets) await validateTarget(service, target);
    return { planned: targets.length, applied: 0, remaining: targets.length };
  }

  let applied = 0;
  for (const target of targets) {
    if (applied >= stopAfter) break;
    await applyTarget(service, target);
    applied += 1;
  }
  return { planned: targets.length, applied, remaining: targets.length - applied };
}
