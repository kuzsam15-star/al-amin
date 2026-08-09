import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const specialistId = typeof body?.specialistId === "string" ? body.specialistId : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 120) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 3000) : "";
  const reporterContact = typeof body?.contact === "string" ? body.contact.trim().slice(0, 240) : "";
  if (!specialistId || reason.length < 3 || description.length < 20 || reporterContact.length < 3) return NextResponse.json({ error: "Заполните причину, описание и контакт для обратной связи." }, { status: 422 });
  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ error: "Сервис временно не настроен." }, { status: 503 });
  const { error } = await supabase.from("complaints").insert({ specialist_id: specialistId, reason, description, reporter_contact: reporterContact, materials_links: typeof body?.materials === "string" ? body.materials.trim().slice(0, 3000) || null : null });
  if (error) return NextResponse.json({ error: "Не удалось отправить жалобу." }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
