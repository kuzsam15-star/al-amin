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
export function isOwnedSubmissionMediaPath(ownerId: unknown, path: unknown): boolean;
export function isCanonicalPublishedMediaPath(ownerId: unknown, path: unknown): boolean;
export function publishCanonicalMedia(input: {
  storage: PublishedMediaStorage;
  ownerId: string;
  entityType: "applications" | "revisions";
  entityId: string;
  slot: "avatar" | `gallery-${number}`;
  sourcePath: string;
}): Promise<CanonicalMediaDescriptor>;
export function publishCanonicalMediaSet(input: {
  storage: PublishedMediaStorage;
  ownerId: string;
  entityType: "applications" | "revisions";
  entityId: string;
  avatarPath: string;
  galleryPaths?: string[];
}): Promise<{ avatar: CanonicalMediaDescriptor; gallery: CanonicalMediaDescriptor[] }>;
