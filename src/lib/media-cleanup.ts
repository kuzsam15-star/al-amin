import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

const validPath = (value: unknown): value is string => typeof value === "string" && /^submissions\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|heic|heif)$/i.test(value);
export const profileMediaPaths = (value: Record<string, unknown> | null | undefined) => [
  value?.avatar_path,
  ...(Array.isArray(value?.gallery_paths) ? value!.gallery_paths : []),
].filter(validPath);

/** Removes only files that are no longer referenced by any public profile, application, or active draft. */
export async function removeUnreferencedProfileMedia(candidates: Iterable<string>) {
  const requested = [...new Set([...candidates].filter(validPath))];
  if (!requested.length) return [];

  const admin = createSupabaseAdminClient();
  const [{ data: specialists }, { data: applications }, { data: pending }] = await Promise.all([
    admin.from("specialists").select("avatar_path,gallery_paths"),
    admin.from("applications").select("main_image_path,gallery_paths"),
    admin.from("specialist_revisions").select("payload").eq("status", "pending"),
  ]);
  const referenced = new Set<string>();
  for (const profile of specialists ?? []) profileMediaPaths(profile as Record<string, unknown>).forEach((path) => referenced.add(path));
  for (const application of applications ?? []) {
    if (validPath(application.main_image_path)) referenced.add(application.main_image_path);
    for (const path of application.gallery_paths ?? []) if (validPath(path)) referenced.add(path);
  }
  for (const revision of pending ?? []) profileMediaPaths(revision.payload as Record<string, unknown>).forEach((path) => referenced.add(path));

  const stale = requested.filter((path) => !referenced.has(path));
  if (stale.length) await admin.storage.from("profile-media").remove(stale);
  return stale;
}
