export type CanonicalMediaDescriptor = {
  source_path: string;
  source_sha256: string;
  canonical_path: string;
  canonical_sha256: string;
  canonical_bytes: number;
};

export type PublishedMediaStorage = {
  from(bucket: string): {
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    upload(path: string, body: Uint8Array, options: { contentType: string; cacheControl: string; upsert: false }): Promise<{ data: unknown; error: unknown }>;
  };
};

export const PROFILE_MEDIA_BUCKET: "profile-media";
export const MAX_CANONICAL_MEDIA_BYTES: number;
export const LEGACY_MEDIA_NAMESPACE_REGISTRY: Readonly<{
  VERIFIED_ENTITY_SCOPED_V1: Readonly<{
    id: "VERIFIED_ENTITY_SCOPED_V1";
    pathTemplate: string;
    ownerAuthority: "DATABASE_RELATION";
    allowedTargets: readonly ["applications", "specialists"];
  }>;
}>;
export type Sec001BackfillTarget = {
  targetType: "applications" | "specialists";
  id: string;
  ownerId: string;
  avatarPath: string | null;
  galleryPaths: string[];
};
export type Sec001BackfillSourceReference = {
  targetType: "applications" | "specialists";
  targetId: string;
  ownerId: string;
  slot: "avatar" | `gallery-${number}`;
  sourcePath: string;
};
export type Sec001BackfillSourceRegistry = {
  readonly summary: Readonly<{
    allowlistedLegacyReferenceCount: number;
    allowlistedLegacyObjectCount: number;
    sharedSameOwnerObjectCount: number;
    crossOwnerObjectCount: 0;
    unknownReferenceCount: 0;
  }>;
  authorizationFor(reference: Sec001BackfillSourceReference): unknown;
};
export function isOwnedSubmissionMediaPath(ownerId: unknown, path: unknown): boolean;
export function isCanonicalPublishedMediaPath(ownerId: unknown, path: unknown): boolean;
export function createSec001BackfillSourceRegistry(targets: Sec001BackfillTarget[]): Sec001BackfillSourceRegistry;
export function validatePublicationSource(input: {
  storage: PublishedMediaStorage;
  ownerId: string;
  slot: "avatar" | `gallery-${number}`;
  sourcePath: string;
  sourceAuthorization?: unknown;
}): Promise<Pick<CanonicalMediaDescriptor, "source_sha256" | "canonical_sha256" | "canonical_bytes">>;
export function publishCanonicalMedia(input: {
  storage: PublishedMediaStorage;
  ownerId: string;
  entityType: "applications" | "revisions" | "backfill-applications" | "backfill-specialists";
  entityId: string;
  slot: "avatar" | `gallery-${number}`;
  sourcePath: string;
  sourceAuthorization?: unknown;
}): Promise<CanonicalMediaDescriptor>;
export function publishCanonicalMediaSet(input: {
  storage: PublishedMediaStorage;
  ownerId: string;
  entityType: "applications" | "revisions" | "backfill-applications" | "backfill-specialists";
  entityId: string;
  avatarPath: string;
  galleryPaths?: string[];
}): Promise<{ avatar: CanonicalMediaDescriptor; gallery: CanonicalMediaDescriptor[] }>;
