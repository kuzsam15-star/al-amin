import { createHash } from "node:crypto";
import sharp from "sharp";

export const PROFILE_MEDIA_BUCKET = "profile-media";
export const MAX_CANONICAL_MEDIA_BYTES = 5 * 1024 * 1024;

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${uuidPattern}$`, "i");
const entityTypes = new Set(["applications", "revisions", "backfill-applications", "backfill-specialists"]);
const supportedFormats = new Set(["jpeg", "png", "webp", "heif"]);

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

function assertSourcePath(ownerId, sourcePath) {
  if (!isOwnedSubmissionMediaPath(ownerId, sourcePath)) {
    throw new Error("Reviewed media source is outside the owner's approved namespace");
  }
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
  const image = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !supportedFormats.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error("Reviewed media is not a supported decodable image");
  }
  const rotated = image.rotate();
  const output = slot === "avatar"
    ? await rotated.resize(512, 512, { fit: "fill" }).webp({ quality: 88, smartSubsample: true }).toBuffer()
    : await rotated.resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 88, smartSubsample: true }).toBuffer();
  if (output.length === 0 || output.length > MAX_CANONICAL_MEDIA_BYTES) throw new Error("Canonical media has an invalid size");
  const verified = await sharp(output, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  if (verified.format !== "webp" || !verified.width || !verified.height) throw new Error("Canonical media verification failed");
  return output;
}

async function prepareCanonicalMedia({ storage, ownerId, slot, sourcePath }) {
  requireUuid(ownerId, "Media owner");
  if (slot !== "avatar" && !/^gallery-[0-9]{1,2}$/u.test(slot)) throw new Error("Media slot is invalid");
  assertSourcePath(ownerId, sourcePath);
  const source = await downloadBytes(storage, sourcePath, "Reviewed media source");
  const canonical = await validatedCanonicalBytes(source, slot);
  return {
    sourceHash: sha256(source),
    canonical,
    canonicalHash: sha256(canonical),
  };
}

export async function validatePublicationSource({ storage, ownerId, slot, sourcePath }) {
  const prepared = await prepareCanonicalMedia({ storage, ownerId, slot, sourcePath });
  return {
    source_sha256: prepared.sourceHash,
    canonical_sha256: prepared.canonicalHash,
    canonical_bytes: prepared.canonical.length,
  };
}

export async function publishCanonicalMedia({ storage, ownerId, entityType, entityId, slot, sourcePath }) {
  requireUuid(entityId, "Media source entity");
  if (!entityTypes.has(entityType)) throw new Error("Media source entity type is invalid");
  const { sourceHash, canonical, canonicalHash } = await prepareCanonicalMedia({ storage, ownerId, slot, sourcePath });
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
