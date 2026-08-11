const submissionProfileMediaPattern = /^submissions\/[a-f0-9-]{36}\/(?:avatar|gallery)\/[a-f0-9-]{36}\.webp$/i;
const publishedProfileMediaPattern = /^published\/[a-f0-9-]{36}\/(?:applications|revisions)\/[a-f0-9-]{36}\/(?:avatar|gallery-[0-9]{1,2})\/[a-f0-9]{64}\.webp$/i;
// Files uploaded before owner-scoped paths were introduced remain readable, but
// only when an existing row for the authenticated owner references them.
const legacyProfileMediaPattern = /^submissions\/(?:[a-f0-9-]{36}\/)?(?:main|gallery-\d+)-[a-f0-9-]{36}\.(?:png|jpe?g|webp)$/i;

export function isProfileMediaPath(value: unknown): value is string {
  return typeof value === "string" && (submissionProfileMediaPattern.test(value) || publishedProfileMediaPattern.test(value) || legacyProfileMediaPattern.test(value));
}

export function isCanonicalProfileMediaPath(value: unknown): value is string {
  return typeof value === "string" && publishedProfileMediaPattern.test(value);
}

export function isSubmissionProfileMediaPath(value: unknown): value is string {
  return typeof value === "string" && submissionProfileMediaPattern.test(value);
}

/** A same-origin route decides whether the requested image is publicly visible. */
export function profileMediaUrl(path: string) {
  return `/api/media/view?path=${encodeURIComponent(path)}`;
}
