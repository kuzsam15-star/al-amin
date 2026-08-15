import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { removeUnreferencedProfileMedia } from "@/lib/media-cleanup";
import { processEmailQueue } from "@/lib/email/queue";
import { hasTrustedOrigin } from "@/lib/request-security";
import { validateApplication } from "@/lib/application-validation.mjs";
import { isCanonicalUuid, isPlainRecord } from "@/lib/specialist-contract.mjs";

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
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!isCanonicalUuid(idempotencyKey)) return NextResponse.json({ error: "Повторите отправку формы." }, { status: 400 });
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
  const { owner_id: _ownerId, ...writePayload } = validated.data;
  void _ownerId;
  const payloadHash = createHash("sha256").update(JSON.stringify(writePayload)).digest("hex");
  const { error } = await admin.rpc("submit_application_v1", {
    p_owner_id: user.id,
    p_application_id: editable?.id ?? null,
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_payload: writePayload,
  });
  if(error) {
    await removeUnreferencedProfileMedia(submittedMedia(validated.data));
    const conflict = error.code === "23505" || error.code === "40001";
    return NextResponse.json({error: conflict ? "Заявка уже отправлена или была изменена. Обновите страницу." : "Не удалось сохранить заявку. Попробуйте позже."},{status:conflict ? 409 : 500});
  }
  // Delivery is intentionally isolated from application persistence. A provider
  // error is recorded in the outbox and never changes an accepted application.
  await processEmailQueue(5).catch(() => undefined);
  return NextResponse.json({ok:true},{status:201});
}
