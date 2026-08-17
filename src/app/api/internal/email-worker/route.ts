import { NextRequest, NextResponse } from "next/server";
import { processEmailQueue } from "@/lib/email/queue";
import { assertResourceRuntimeConfigured, ResourceBoundaryError } from "@/lib/resource-limits.mjs";

export async function POST(request: NextRequest) {
  const secret = process.env.EMAIL_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { assertResourceRuntimeConfigured(); return NextResponse.json(await processEmailQueue()); }
  catch (reason) { return NextResponse.json({ error: "Не удалось обработать очередь." }, { status: reason instanceof ResourceBoundaryError ? reason.status : 500 }); }
}
