import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Kept out of public page rendering so a stale auth cookie cannot delay the catalog. */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ isAdmin: false });
  const { data } = await supabase.from("moderators").select("role").eq("user_id", session.user.id).maybeSingle();
  return NextResponse.json({ isAdmin: data?.role === "admin" });
}
