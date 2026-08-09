import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const specialistId = typeof body?.specialistId === "string" ? body.specialistId : "";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 3000) : "";
  const contact = typeof body?.contact === "string" ? body.contact.trim().slice(0, 240) : "";
  if (!specialistId || text.length < 30 || typeof body?.wouldHireAgain !== "boolean") return NextResponse.json({ error: "Отзыв должен содержать от 30 символов." }, { status: 422 });
  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ error: "Сервис временно не настроен." }, { status: 503 });
  const { error } = await supabase.from("reviews").insert({ specialist_id: specialistId, body: text, author_contact: contact || null, would_hire_again: body.wouldHireAgain });
  if (error) return NextResponse.json({ error: "Не удалось отправить отзыв." }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
