import { handleFeedbackRoute } from "@/lib/feedback-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return await handleFeedbackRoute(request, "review");
}
