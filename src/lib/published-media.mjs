import { createHash } from "node:crypto";
import sharp from "sharp";
import { RESOURCE_LIMITS, validateImageMetadata } from "./resource-limits.mjs";

export const PROFILE_MEDIA_BUCKET = "profile-media";
export const MAX_CANONICAL_MEDIA_BYTES = RESOURCE_LIMITS.mediaOutputBytes;

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${uuidPattern}$`, "i");
const entityTypes = new Set(["applications", "revisions", "backfill-applications", "backfill-specialists"]);
const supportedFormats = new Set(["jpeg", "png", "webp", "heif"]);
const legacyEntityScopedPattern = new RegExp(
  `^submissions/${uuidPattern}/(?:main|gallery-[0-9]+)-${uuidPattern}\\.(?:png|jpe?g|webp)$`,
  "i",
);
const backfillAuthorizationBrand = Symbol("sec001-legacy-backfill-authorization");

export const LEGACY_MEDIA_NAMESPACE_REGISTRY = Object.freeze({
  VERIFIED_ENTITY_SCOPED_V1: Object.freeze({
    id: "VERIFIED_ENTITY_SCOPED_V1",
    pathTemplate: "submissions/<legacy-scope-uuid>/<main|gallery-N>-<object-uuid>.<png|jpg|jpeg|webp>",
    ownerAuthority: "DATABASE_RELATION",
    allowedTargets: Object.freeze(["applications", "specialists"]),
  }),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireUuid(value, label) {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error(`${label} is invalid`);
}

export function isOwnedSubmissionMediaPath(ownerId, path) {
  if (typeof ownerId !== "string" || typeof path !== "string") return false;
  const escapedOwner = ownerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^submissions/${escapedOwner}/(?:(?:avatar|gallery)/${uuidPattern}\\.webp|(?:main|gallery-[0-9]+)-${uuidPattern}\\.(?:png|jpe?g|webp))$`,
    "i",
  ).test(path);
}

export function isCanonicalPublishedMediaPath(ownerId, path) {
  if (typeof ownerId !== "string" || typeof path !== "string") return false;
  const escapedOwner = ownerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^published/${escapedOwner}/(?:applications|revisions|backfill-applications|backfill-specialists)/${uuidPattern}/(?:avatar|gallery-[0-9]{1,2})/[0-9a-f]{64}\\.webp$`,
    "i",
  ).test(path);
}

function referenceKey({ targetType, targetId, ownerId, slot, sourcePath }) {
  return JSON.stringify([targetType, targetId, ownerId, slot, sourcePath]);
}

function mediaReferences(target) {
  const references = [];
  if (target.avatarPath) references.push({ slot: "avatar", sourcePath: target.avatarPath });
  for (let index = 0; index < target.galleryPaths.length; index += 1) {
    references.push({ slot: `gallery-${index}`, sourcePath: target.galleryPaths[index] });
  }
  return references;
}

/**
 * Builds an in-memory, non-serializable allowlist from a complete authoritative
 * DB inventory. The legacy UUID segment is deliberately treated as opaque: only
 * the row owner and the absence of any cross-owner reference establish ownership.
 */
export function createSec001BackfillSourceRegistry(targets) {
  if (!Array.isArray(targets)) throw new Error("SEC-001 backfill reference inventory is invalid");
  const allowedTargetTypes = new Set(["applications", "specialists"]);
  const collected = [];
  for (const target of targets) {
    if (!target || !allowedTargetTypes.has(target.targetType)) throw new Error("SEC-001 backfill reference source is invalid");
    requireUuid(target.id, "SEC-001 backfill target");
    requireUuid(target.ownerId, "SEC-001 backfill owner");
    if (!Array.isArray(target.galleryPaths) || target.galleryPaths.some((value) => typeof value !== "string" || !value)) {
      throw new Error("SEC-001 backfill gallery inventory is invalid");
    }
    if (target.avatarPath !== null && (typeof target.avatarPath !== "string" || !target.avatarPath)) {
      throw new Error("SEC-001 backfill avatar inventory is invalid");
    }
    for (const reference of mediaReferences(target)) {
      if (isCanonicalPublishedMediaPath(target.ownerId, reference.sourcePath)) continue;
      const family = isOwnedSubmissionMediaPath(target.ownerId, reference.sourcePath)
        ? "CURRENT_OWNER_SCOPED"
        : legacyEntityScopedPattern.test(reference.sourcePath)
          ? LEGACY_MEDIA_NAMESPACE_REGISTRY.VERIFIED_ENTITY_SCOPED_V1.id
          : null;
      if (!family) throw new Error("SEC-001 backfill source namespace is not allowlisted");
      collected.push({
        targetType: target.targetType,
        targetId: target.id,
        ownerId: target.ownerId,
        slot: reference.slot,
        sourcePath: reference.sourcePath,
        family,
      });
    }
  }

  const ownersByPath = new Map();
  const referencesByPath = new Map();
  for (const reference of collected) {
    const owners = ownersByPath.get(reference.sourcePath) ?? new Set();
    owners.add(reference.ownerId.toLowerCase());
    ownersByPath.set(reference.sourcePath, owners);
    referencesByPath.set(reference.sourcePath, (referencesByPath.get(reference.sourcePath) ?? 0) + 1);
  }
  if ([...ownersByPath.values()].some((owners) => owners.size !== 1)) {
    throw new Error("SEC-001 backfill source has cross-owner or ambiguous references");
  }

  const authorizations = new Map();
  for (const reference of collected) {
    if (reference.family === "CURRENT_OWNER_SCOPED") continue;
    authorizations.set(referenceKey(reference), Object.freeze({
      [backfillAuthorizationBrand]: true,
      ...reference,
    }));
  }
  const legacyPaths = new Set(collected.filter((item) => item.family !== "CURRENT_OWNER_SCOPED").map((item) => item.sourcePath));
  const sharedSameOwnerObjects = [...referencesByPath.values()].filter((count) => count > 1).length;
  const summary = Object.freeze({
    allowlistedLegacyReferenceCount: authorizations.size,
    allowlistedLegacyObjectCount: legacyPaths.size,
    sharedSameOwnerObjectCount: sharedSameOwnerObjects,
    crossOwnerObjectCount: 0,
    unknownReferenceCount: 0,
  });

  return Object.freeze({
    summary,
    authorizationFor(reference) {
      if (isOwnedSubmissionMediaPath(reference.ownerId, reference.sourcePath)) return undefined;
      const authorization = authorizations.get(referenceKey(reference));
      if (!authorization) throw new Error("SEC-001 legacy source lacks authoritative DB reference proof");
      return authorization;
    },
  });
}

function assertSourcePath({ ownerId, sourcePath, slot, sourceAuthorization, entityType, entityId }) {
  if (isOwnedSubmissionMediaPath(ownerId, sourcePath)) return;
  const expectedTargetType = entityType === undefined
    ? undefined
    : entityType === "backfill-applications"
      ? "applications"
      : entityType === "backfill-specialists"
        ? "specialists"
        : null;
  if (
    !sourceAuthorization
    || sourceAuthorization[backfillAuthorizationBrand] !== true
    || sourceAuthorization.ownerId !== ownerId
    || sourceAuthorization.sourcePath !== sourcePath
    || sourceAuthorization.slot !== slot
    || sourceAuthorization.family !== LEGACY_MEDIA_NAMESPACE_REGISTRY.VERIFIED_ENTITY_SCOPED_V1.id
    || !legacyEntityScopedPattern.test(sourcePath)
    || (entityType !== undefined && (
      expectedTargetType === null
      || sourceAuthorization.targetType !== expectedTargetType
      || sourceAuthorization.targetId !== entityId
    ))
  ) throw new Error("Reviewed media source is outside the owner's approved namespace");
}

function canonicalPath({ ownerId, entityType, entityId, slot, hash }) {
  return `published/${ownerId}/${entityType}/${entityId}/${slot}/${hash}.webp`;
}

async function downloadBytes(storage, path, label) {
  const { data, error } = await storage.from(PROFILE_MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error(`${label} is unavailable`);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_CANONICAL_MEDIA_BYTES) throw new Error(`${label} has an invalid size`);
  return bytes;
}

async function validatedCanonicalBytes(source, slot) {
  const image = sharp(source, { failOn: "error", limitInputPixels: RESOURCE_LIMITS.imagePixels }).timeout({ seconds: RESOURCE_LIMITS.imageProcessingSeconds });
  const metadata = await image.metadata();
  if (!metadata.format || !supportedFormats.has(metadata.format) || !validateImageMetadata(metadata)) {
    throw new Error("Reviewed media is not a supported decodable image");
  }
  const rotated = image.rotate();
  const output = slot === "avatar"
    ? await rotated.resize(512, 512, { fit: "fill" }).webp({ quality: 88, smartSubsample: true }).toBuffer()
    : await rotated.resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 88, smartSubsample: true }).toBuffer();
  if (output.length === 0 || output.length > MAX_CANONICAL_MEDIA_BYTES) throw new Error("Canonical media has an invalid size");
  const verified = await sharp(output, { failOn: "error", limitInputPixels: RESOURCE_LIMITS.imagePixels }).metadata();
  if (verified.format !== "webp" || !validateImageMetadata(verified)) throw new Error("Canonical media verification failed");
  return output;
}

async function prepareCanonicalMedia({ storage, ownerId, slot, sourcePath, sourceAuthorization, entityType, entityId }) {
  requireUuid(ownerId, "Media owner");
  if (slot !== "avatar" && !/^gallery-[0-9]{1,2}$/u.test(slot)) throw new Error("Media slot is invalid");
  assertSourcePath({ ownerId, sourcePath, slot, sourceAuthorization, entityType, entityId });
  const source = await downloadBytes(storage, sourcePath, "Reviewed media source");
  const canonical = await validatedCanonicalBytes(source, slot);
  return {
    sourceHash: sha256(source),
    canonical,
    canonicalHash: sha256(canonical),
  };
}

export async function validatePublicationSource({ storage, ownerId, slot, sourcePath, sourceAuthorization }) {
  const prepared = await prepareCanonicalMedia({ storage, ownerId, slot, sourcePath, sourceAuthorization });
  return {
    source_sha256: prepared.sourceHash,
    canonical_sha256: prepared.canonicalHash,
    canonical_bytes: prepared.canonical.length,
  };
}

export async function publishCanonicalMedia({ storage, ownerId, entityType, entityId, slot, sourcePath, sourceAuthorization }) {
  requireUuid(entityId, "Media source entity");
  if (!entityTypes.has(entityType)) throw new Error("Media source entity type is invalid");
  const { sourceHash, canonical, canonicalHash } = await prepareCanonicalMedia({
    storage, ownerId, slot, sourcePath, sourceAuthorization, entityType, entityId,
  });
  const path = canonicalPath({ ownerId, entityType, entityId, slot, hash: canonicalHash });
  const bucket = storage.from(PROFILE_MEDIA_BUCKET);
  const uploaded = await bucket.upload(path, canonical, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });

  if (uploaded.error) {
    const existing = await downloadBytes(storage, path, "Existing canonical media");
    if (sha256(existing) !== canonicalHash) throw new Error("Canonical media retry conflicts with different bytes");
  }
  const stored = await downloadBytes(storage, path, "Canonical media");
  if (sha256(stored) !== canonicalHash) throw new Error("Canonical media hash verification failed");

  return {
    source_path: sourcePath,
    source_sha256: sourceHash,
    canonical_path: path,
    canonical_sha256: canonicalHash,
    canonical_bytes: canonical.length,
  };
}

export async function publishCanonicalMediaSet({ storage, ownerId, entityType, entityId, avatarPath, galleryPaths = [] }) {
  if (typeof avatarPath !== "string" || !avatarPath) throw new Error("Reviewed avatar source is required");
  if (!Array.isArray(galleryPaths) || galleryPaths.some((path) => typeof path !== "string")) throw new Error("Reviewed gallery is invalid");
  const avatar = await publishCanonicalMedia({ storage, ownerId, entityType, entityId, slot: "avatar", sourcePath: avatarPath });
  const gallery = [];
  for (let index = 0; index < galleryPaths.length; index += 1) {
    gallery.push(await publishCanonicalMedia({
      storage,
      ownerId,
      entityType,
      entityId,
      slot: `gallery-${index}`,
      sourcePath: galleryPaths[index],
    }));
  }
  return { avatar, gallery };
}
