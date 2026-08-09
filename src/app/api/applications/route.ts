import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { removeUnreferencedProfileMedia } from "@/lib/media-cleanup";
import { processEmailQueue } from "@/lib/email/queue";
import { hasTrustedOrigin } from "@/lib/request-security";
import { validateApplication } from "@/lib/application-validation.mjs";
import { isCanonicalUuid, isPlainRecord } from "@/lib/specialist-contract.mjs";

const recentRequests=new Map<string,number>();
const maximumRequestBytes = 96 * 1024;
const submittedMedia = (data: Record<string, unknown>) => [data.main_image_path].filter((path): path is string => typeof path === "string");

export async function POST(request:Request){
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumRequestBytes) return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maximumRequestBytes) return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!isPlainRecord(body)) return NextResponse.json({error:"Некорректный запрос."},{status:400});
  const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Войдите или зарегистрируйтесь, чтобы подать заявку."},{status:401});
  const requestedId = body.applicationId;
  if (requestedId !== undefined && !isCanonicalUuid(requestedId)) return NextResponse.json({ error: "Эту заявку нельзя отправить повторно.", field: "applicationId", errors: { applicationId: "Эту заявку нельзя отправить повторно." } }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const [{ data: activeCategories, error: categoriesError }, editableResult] = await Promise.all([
    admin.from("categories").select("id,name").eq("is_active", true),
    isCanonicalUuid(requestedId)
      ? admin.from("applications").select("id,status,main_image_path").eq("id", requestedId).eq("owner_id", user.id).maybeSingle()
      : admin.from("applications").select("id,status,main_image_path").eq("owner_id", user.id).in("status", ["changes_requested", "info_required"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (categoriesError) return NextResponse.json({ error: "Не удалось проверить категории. Попробуйте позже." }, { status: 503 });
  const editable = editableResult.data;
  if (editableResult.error) return NextResponse.json({ error: "Не удалось проверить заявку. Попробуйте позже." }, { status: 503 });
  if (isCanonicalUuid(requestedId) && (!editable || !["changes_requested", "info_required"].includes(editable.status))) return NextResponse.json({error:"Эту заявку нельзя отправить повторно."},{status:409});

  const validated=validateApplication(body, {
    ownerId: user.id,
    activeCategories: activeCategories ?? [],
    allowedExistingMediaPaths: editable?.main_image_path ? [editable.main_image_path] : [],
  });
  if("error" in validated)return NextResponse.json({error:validated.error,field:validated.field,errors:validated.errors},{status:422});
  const now=Date.now(); if(now-(recentRequests.get(user.id)??0)<60_000){ await removeUnreferencedProfileMedia(submittedMedia(validated.data)); return NextResponse.json({error:"Повторите попытку через минуту."},{status:429}); }

  const writePayload = { ...validated.data, owner_id: user.id, contract_version: 2 as const };
  const { error } = editable
    ? await admin.from("applications").update({ ...writePayload, status: "new", resubmitted_at: new Date(now).toISOString() }).eq("id", editable.id).eq("owner_id", user.id).in("status", ["changes_requested", "info_required"])
    : await admin.from("applications").insert({ ...writePayload, status: "new" });
  if(error) { await removeUnreferencedProfileMedia(submittedMedia(validated.data)); return NextResponse.json({error:"Не удалось сохранить заявку. Попробуйте позже."},{status:500}); }
  recentRequests.set(user.id,now);
  // Delivery is intentionally isolated from application persistence. A provider
  // error is recorded in the outbox and never changes an accepted application.
  await processEmailQueue(5).catch(() => undefined);
  return NextResponse.json({ok:true},{status:201});
}
