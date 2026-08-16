"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { enqueueProfileMediaCleanup, profileMediaPaths } from "@/lib/media-cleanup";
import { processEmailQueue } from "@/lib/email/queue";
import { PROFILE_REVISION_INPUT_KEYS, validateProfileRevision } from "@/lib/application-validation.mjs";
import { isCanonicalUuid } from "@/lib/specialist-contract.mjs";

const allowedFormKeys = new Set(["id", ...PROFILE_REVISION_INPUT_KEYS, "additionalCategoryIds"]);
const parseJson = (data: FormData, name: string) => { try { return JSON.parse(String(data.get(name) ?? "[]")); } catch { return null; } };
const invalidFormKey = (data: FormData) => [...data.keys()].some((key) => !key.startsWith("$ACTION_") && !allowedFormKeys.has(key));

export async function updateOwnProfile(formData: FormData) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login?next=/cabinet");
  if (invalidFormKey(formData)) redirect("/cabinet?error=invalid");

  const id = formData.get("id");
  if (!isCanonicalUuid(id)) redirect("/cabinet?error=profile");
  const admin = createSupabaseAdminClient();
  const [{ data: current, error: currentError }, { data: categories, error: categoryError }] = await Promise.all([
    admin.from("specialists").select("id,owner_id,avatar_path").eq("id", id).eq("owner_id", user.id).maybeSingle(),
    admin.from("categories").select("id,name").eq("is_active", true),
  ]);
  if (currentError || !current) redirect("/cabinet?error=profile");
  if (categoryError) redirect("/cabinet?error=save");

  const input = {
    fullName: formData.get("fullName"),
    country: formData.get("country"),
    city: formData.get("city"),
    categoryId: formData.get("categoryId"),
    additionalCategoryIds: formData.getAll("additionalCategoryIds"),
    specialization: formData.get("specialization"),
    experienceYears: formData.get("experienceYears"),
    profileSummary: formData.get("profileSummary"),
    description: formData.get("description"),
    helpTopics: parseJson(formData, "helpTopics"),
    workOffers: parseJson(formData, "workOffers"),
    mainImagePath: formData.get("mainImagePath"),
  };
  const validated = validateProfileRevision(input, {
    ownerId: user.id,
    activeCategories: categories ?? [],
    allowedExistingMediaPaths: current.avatar_path ? [current.avatar_path] : [],
  });
  if (validated.error) redirect(`/cabinet?error=field-${encodeURIComponent(validated.field)}`);
  const payload = { ...validated.data, contract_version: 2 as const };

  const { data: pending, error: pendingError } = await admin.from("specialist_revisions")
    .select("id,payload,status")
    .eq("specialist_id", id)
    .eq("owner_id", user.id)
    .in("status", ["pending", "changes_requested"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) redirect("/cabinet?error=save");

  const revision = pending
    ? await admin.from("specialist_revisions").update({ payload, status: "pending", moderator_id: null, moderator_comment: null, decided_at: null }).eq("id", pending.id).eq("owner_id", user.id).in("status", ["pending", "changes_requested"])
    : await admin.from("specialist_revisions").insert({ specialist_id: id, owner_id: user.id, payload, status: "pending" });
  if (revision.error) redirect("/cabinet?error=save");

  if (pending?.payload) {
    const previous = profileMediaPaths(pending.payload as Record<string, unknown>);
    const currentPaths = new Set(profileMediaPaths(payload));
    await enqueueProfileMediaCleanup({ ownerId: user.id, candidates: previous.filter((path) => !currentPaths.has(path)), reason: "superseded_revision_media" });
  }

  await processEmailQueue(5).catch(() => undefined);
  revalidatePath("/cabinet");
  revalidatePath("/admin");
  redirect("/cabinet?saved=revision");
}
