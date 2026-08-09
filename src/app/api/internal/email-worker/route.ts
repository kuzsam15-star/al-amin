import { NextRequest, NextResponse } from "next/server";
import { processEmailQueue } from "@/lib/email/queue";

export async function POST(request: NextRequest) {
  const secret = process.env.EMAIL_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { return NextResponse.json(await processEmailQueue()); }
  catch { return NextResponse.json({ error: "Не удалось обработать очередь." }, { status: 500 }); }
}
