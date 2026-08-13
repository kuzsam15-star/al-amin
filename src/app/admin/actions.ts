"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAal2, requireModerator } from "@/lib/auth";
import { profileStatusLabels, type ProfileStatus } from "@/lib/types";
import { profileMediaPaths, removeUnreferencedProfileMedia } from "@/lib/media-cleanup";
import { processEmailQueue } from "@/lib/email/queue";
import { siteContentFields, validateSiteContent } from "@/lib/site-content-fields";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { prepareCanonicalPublication } from "@/lib/published-media";

function done(notice="saved", returnTo="/admin"):never { revalidatePath("/"); revalidatePath("/admin"); revalidatePath("/specialists"); revalidatePath("/cabinet"); redirect(`${returnTo}?notice=${notice}`); }
function contentDone(notice: string): never { redirect(`/admin?section=settings&notice=${notice}`); }
const alwaysHighRisk = new Set(["avatar_path","gallery_paths","public_contact","portfolio_links","video_links","full_name","category_id","additional_category_ids"]);
const changedKeys = (profile: Record<string, unknown>, payload: Record<string, unknown>) => Object.keys(payload).filter((key) => JSON.stringify(profile[key] ?? null) !== JSON.stringify(payload[key] ?? null));
const sameStringArray = (left: unknown, right: unknown) => JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
const substantialDescriptionChange = (before: unknown, after: unknown) => {
  const oldText = String(before ?? "").trim(); const newText = String(after ?? "").trim();
  return oldText !== newText && Math.abs(oldText.length - newText.length) > 140;
};
const isRiskyRevision = (profile: Record<string, unknown>, payload: Record<string, unknown>) => {
  const changed = changedKeys(profile, payload);
  return changed.some((key) => alwaysHighRisk.has(key)) || substantialDescriptionChange(profile.full_description, payload.full_description);
};

export async function updateSiteContent(formData: FormData) {
  const { supabase } = await requireAdminAal2();
  const patch = Object.fromEntries(siteContentFields.map((field) => [field, String(formData.get(field) ?? "").trim()])) as Record<(typeof siteContentFields)[number], string>;
  const validation = validateSiteContent(patch);
  if (!validation.valid) contentDone(`content-invalid-${validation.field}`);
  const { error } = await supabase.rpc("admin_update_site_content", { p_content: patch });
  if (error) contentDone("save-error");
  revalidatePath("/"); revalidatePath("/about"); revalidatePath("/rules"); revalidatePath("/privacy"); revalidatePath("/support");
  contentDone("content-saved");
}

export async function updateApplication(formData:FormData) {
  const id=String(formData.get("id")??""); const decision=String(formData.get("decision")??""); const expectedUpdatedAt=String(formData.get("expectedUpdatedAt")??""); const notes=String(formData.get("notes")??"").trim().slice(0,5000); const applicantMessage=String(formData.get("applicantMessage")??"").trim().slice(0,5000);
  const status = decision === "request_changes" ? "changes_requested" : decision === "approve" ? "approved" : decision === "reject" ? "rejected" : null;
  if(!id || !status || !expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) done("invalid"); if (status === "changes_requested" && !applicantMessage) done("message-required"); const {supabase,user}=await requireModerator();
  const admin = createSupabaseAdminClient();
  const {data: current,error:readError}=await admin.from("applications").select("status,owner_id,main_image_path,gallery_paths,updated_at").eq("id",id).eq("updated_at",expectedUpdatedAt).maybeSingle();
  if(readError||!current||!["new","screening","info_required","changes_requested","call_required","call_scheduled"].includes(current.status)) done("invalid");
  const publication = status === "approved" && current.owner_id && current.main_image_path
    ? await prepareCanonicalPublication({
        ownerId: current.owner_id,
        entityType: "applications",
        entityId: id,
        avatarPath: current.main_image_path,
        galleryPaths: current.gallery_paths ?? [],
      }).catch(() => null)
    : null;
  if (status === "approved" && !publication) done("save-error");
  const {error}=status === "approved"
    ? await admin.rpc("approve_application_with_canonical_media_v2", {
        application_uuid: id,
        reviewer_uuid: user.id,
        expected_updated_at: expectedUpdatedAt,
        note: notes || null,
        avatar_descriptor: publication!.avatar,
        gallery_descriptors: publication!.gallery,
      })
    : await supabase.rpc("moderator_decide_application", {
        p_application_id: id,
        p_expected_updated_at: expectedUpdatedAt,
        p_decision: decision,
        p_internal_note: notes || null,
        p_applicant_message: status === "changes_requested" ? applicantMessage : null,
      });
  if(error) done("save-error");
  // The database trigger publishes one profile atomically when status becomes approved.
  await processEmailQueue(5).catch(() => undefined); done();
}

const validId = (value: string) => /^[a-f0-9-]{36}$/i.test(value);

/** Permanently removes only the application row. Any published specialist remains intact. */
export async function deleteApplication(formData: FormData) {
  const id = String(formData.get("applicationId") ?? "");
  if (!validId(id)) done("invalid");
  const { supabase } = await requireAdminAal2();
  const admin = createSupabaseAdminClient();
  const { data: application, error: readError } = await admin.from("applications").select("main_image_path,gallery_paths").eq("id", id).maybeSingle();
  if (readError || !application) done("delete-error");
  const { error } = await supabase.rpc("admin_delete_application", { p_application_id: id });
  if (error) done("delete-error");
  await removeUnreferencedProfileMedia(profileMediaPaths({ avatar_path: application.main_image_path, gallery_paths: application.gallery_paths }));
  done("deleted");
}

/** Moves an application out of the moderator queue without removing its history. */
export async function archiveApplication(formData: FormData) {
  const id = String(formData.get("applicationId") ?? "");
  if (!validId(id)) done("invalid");
  const { supabase } = await requireAdminAal2();
  const admin = createSupabaseAdminClient();
  const { data: application, error: readError } = await admin.from("applications").select("status").eq("id", id).maybeSingle();
  if (readError || !application) done("invalid");
  const { error } = await supabase.rpc("admin_transition_application", { p_application_id: id, p_expected_status: application.status, p_target_status: "withdrawn" });
  if (error) done("save-error");
  done("archived");
}

/** Restores an archived application to the active moderation queue. */
export async function restoreApplication(formData: FormData) {
  const id = String(formData.get("applicationId") ?? "");
  if (!validId(id)) done("invalid");
  const { supabase } = await requireAdminAal2();
  const { error } = await supabase.rpc("admin_transition_application", { p_application_id: id, p_expected_status: "withdrawn", p_target_status: "new" });
  if (error) done("save-error");
  done("restored");
}

/** Removes a revision only; it never updates or deletes its specialist profile. */
export async function deleteRevision(formData: FormData) {
  const id = String(formData.get("revisionId") ?? "");
  if (!validId(id)) done("invalid");
  const { supabase } = await requireAdminAal2();
  const { data: revision, error: readError } = await supabase.from("specialist_revisions").select("payload").eq("id", id).maybeSingle();
  if (readError || !revision) done("delete-error");
  const { error } = await supabase.rpc("admin_delete_revision", { p_revision_id: id });
  if (error) done("delete-error");
  await removeUnreferencedProfileMedia(profileMediaPaths(revision.payload as Record<string, unknown>));
  done("deleted");
}
export async function decideRevision(formData: FormData) {
  const id = String(formData.get("revisionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 5000);
  if (!/^[a-f0-9-]{36}$/i.test(id) || !["approve", "reject", "request_changes"].includes(decision) || !expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) done("invalid");
  if (["reject", "request_changes"].includes(decision) && !note) done("comment-required");
  const { supabase, user } = await requireModerator();
  const { data: revision } = await supabase.from("specialist_revisions").select("owner_id,payload,updated_at,specialist:specialists(avatar_path,gallery_paths)").eq("id", id).eq("status", "pending").eq("updated_at", expectedUpdatedAt).maybeSingle();
  const payload = revision?.payload as Record<string, unknown> | undefined;
  const specialist = Array.isArray(revision?.specialist) ? revision.specialist[0] : revision?.specialist;
  const mediaChanged = payload && specialist ? (
    payload?.avatar_path !== specialist?.avatar_path
    || (Object.hasOwn(payload, "gallery_paths") && !sameStringArray(payload.gallery_paths, specialist?.gallery_paths))
  ) : false;
  const publication = decision === "approve" && mediaChanged && revision?.owner_id && typeof payload?.avatar_path === "string"
    ? await prepareCanonicalPublication({
        ownerId: revision.owner_id,
        entityType: "revisions",
        entityId: id,
        avatarPath: payload.avatar_path,
        galleryPaths: Array.isArray(payload.gallery_paths) ? payload.gallery_paths.filter((path): path is string => typeof path === "string") : [],
      }).catch(() => null)
    : null;
  if (decision === "approve" && (!payload || !specialist || (mediaChanged && !publication))) done("save-error");
  const admin = createSupabaseAdminClient();
  const { error } = decision === "request_changes"
    ? await supabase.rpc("request_specialist_revision_changes", { revision_uuid: id, note })
    : decision === "approve" && mediaChanged
      ? await admin.rpc("apply_specialist_revision_with_canonical_media_v2", {
          revision_uuid: id,
          reviewer_uuid: user.id,
          expected_updated_at: expectedUpdatedAt,
          note: note || null,
          avatar_descriptor: publication!.avatar,
          gallery_descriptors: publication!.gallery,
        })
      : await supabase.rpc("apply_specialist_revision", { revision_uuid: id, approve: decision === "approve", note: note || null });
  if (error) done("save-error");
  if (revision?.payload) {
    const proposed = profileMediaPaths(revision.payload as Record<string, unknown>);
    const published = profileMediaPaths((specialist ?? null) as Record<string, unknown> | null);
    const candidates = decision === "reject" ? proposed.filter((path) => !published.includes(path)) : [];
    await removeUnreferencedProfileMedia(candidates);
  }
  await processEmailQueue(5).catch(() => undefined);
  done();
}
export async function retryEmailNotification(formData: FormData) { const id=String(formData.get("notificationId")??""); if(!validId(id)) done("invalid"); const {supabase}=await requireAdminAal2(); const {error}=await supabase.rpc("admin_retry_email_notification",{p_notification_id:id}); if(error) done("save-error"); await processEmailQueue(1).catch(()=>undefined); done("saved"); }
export async function approveSafeRevisions(formData: FormData) {
  const ids = formData.getAll("revisionId").map(String).filter((id) => /^[a-f0-9-]{36}$/i.test(id));
  if (!ids.length) done("invalid");
  const { supabase } = await requireModerator();
  const { data: rows } = await supabase.from("specialist_revisions").select("id,payload,specialist:specialists(full_name,country,city,service_mode,category_id,additional_category_ids,specialization,experience_years,profile_summary,help_topics,work_offers,services,short_description,full_description,public_contact,portfolio_links,video_links,avatar_path,gallery_paths,recommendations)").in("id", ids).eq("status", "pending");
  for (const row of rows ?? []) {
    const specialist = (Array.isArray(row.specialist) ? row.specialist[0] : row.specialist) as Record<string, unknown> | null;
    const payload = row.payload as Record<string, unknown>;
    if (!specialist || isRiskyRevision(specialist, payload)) continue;
    const { error } = await supabase.rpc("apply_specialist_revision", { revision_uuid: row.id, approve: true, note: "Автоматически одобрено: только низкорисковые изменения." });
    if (error) continue;
  }
  done();
}
export async function updateProfile(formData:FormData) {
  const id=String(formData.get("id")??"");
  const status=String(formData.get("status")??"") as ProfileStatus;
  if(!validId(id) || !profileStatusLabels[status]) done("invalid");
  const {supabase}=await requireAdminAal2();
  const {data:profile,error:readError}=await supabase.from("specialists").select("id,slug,status").eq("id",id).maybeSingle();
  if(readError||!profile) done("invalid");

  const facts={
    identity_checked:formData.get("identityChecked")==="on",
    education_checked:formData.get("educationChecked")==="on",
    experience_checked:formData.get("experienceChecked")==="on",
    qualifications_checked:formData.get("qualificationsChecked")==="on",
    references_checked:formData.get("referencesChecked")==="on",
  };
  const parsedSources=Number.parseInt(String(formData.get("sourcesChecked")??"0"),10);
  const sources_checked=Number.isInteger(parsedSources)?Math.min(999,Math.max(0,parsedSources)):0;
  const {error}=await supabase.rpc("admin_update_specialist_controls",{
    p_specialist_id:id,p_expected_status:profile.status,p_target_status:status,
    p_identity_checked:facts.identity_checked,p_education_checked:facts.education_checked,
    p_experience_checked:facts.experience_checked,p_qualifications_checked:facts.qualifications_checked,
    p_references_checked:facts.references_checked,p_sources_checked:sources_checked,
  });
  if(error) done("save-error");
  revalidatePath(`/specialists/${profile.slug}`);
  done();
}
export async function updateTrustBadges(formData: FormData) {
  const profileId = String(formData.get("profileId") ?? "");
  if (!validId(profileId)) done("invalid");
  const { supabase } = await requireAdminAal2();
  const [{ data: profile, error: profileError }, { data: manualBadges, error: badgeError }] = await Promise.all([
    supabase.from("specialists").select("id,slug").eq("id", profileId).maybeSingle(),
    supabase.from("trust_badges").select("id,code").eq("assignment_type", "manual").eq("is_active", true),
  ]);
  if (profileError || !profile || badgeError) done("save-error");
  const allowedIds = new Set((manualBadges ?? []).map((badge) => badge.id));
  const selectedIds = new Set(formData.getAll("badgeId").map(String).filter((id) => allowedIds.has(id)));
  const { error } = await supabase.rpc("admin_set_manual_trust_badges", { p_specialist_id: profileId, p_badge_ids: [...selectedIds] });
  if (error) done("save-error");
  revalidatePath(`/specialists/${profile.slug}`);
  done("badges-saved");
}
export async function archivePublicProfile(formData: FormData) { const id=String(formData.get("profileId")??""); const requestedPath=String(formData.get("returnTo")??""); const returnTo=requestedPath === "/specialists" ? "/specialists" : "/admin"; if(!validId(id)) done("invalid",returnTo); const {supabase}=await requireAdminAal2(); const {data:profile,error:readError}=await supabase.from("specialists").select("id,status,slug").eq("id",id).maybeSingle(); if(readError||!profile) done("invalid",returnTo); const {error}=await supabase.rpc("admin_transition_specialist",{p_specialist_id:id,p_expected_status:profile.status,p_target_status:"archived"}); if(error) done("save-error",returnTo); revalidatePath(`/specialists/${profile.slug}`); done("archived",returnTo); }
export async function restorePublicProfile(formData: FormData) { const id=String(formData.get("profileId")??""); if(!validId(id)) done("invalid"); const {supabase}=await requireAdminAal2(); const {data: profile,error:readError}=await supabase.from("specialists").select("id,status,slug").eq("id",id).maybeSingle(); if(readError||!profile||!["archived","suspended"].includes(profile.status)) done("invalid"); const {error}=await supabase.rpc("admin_transition_specialist",{p_specialist_id:id,p_expected_status:profile.status,p_target_status:"published"}); if(error) done("save-error"); revalidatePath(`/specialists/${profile.slug}`); done("restored"); }
export async function moderateFeedback(formData:FormData) { const id=String(formData.get("id")??""); const kind=String(formData.get("kind")??""); const publish=String(formData.get("publish")??"")==="yes"; const {supabase}=await requireModerator(); if(!validId(id)||!["review","complaint"].includes(kind)) return; const result=kind==="review"?await supabase.rpc("moderate_review",{p_review_id:id,p_publish:publish}):await supabase.rpc("moderate_complaint",{p_complaint_id:id,p_target_status:publish?"resolved":"dismissed"}); if(result.error) done("save-error"); revalidatePath("/admin"); }
