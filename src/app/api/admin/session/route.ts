import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Kept out of public page rendering so a stale auth cookie cannot delay the catalog. */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
  if (!user) return NextResponse.json({ isAdmin: false }, { headers });
  const { data } = await supabase.from("moderators").select("role").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ isAdmin: data?.role === "admin" }, { headers });
}
