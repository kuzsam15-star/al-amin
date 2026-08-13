import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireModerator() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data: role } = await supabase.from("moderators").select("role").eq("user_id", user.id).maybeSingle();
  if (!role) redirect("/");
  return { supabase, user, role: role.role as "moderator" | "admin" };
}

/** Destructive moderation operations are intentionally reserved for administrators. */
export async function requireAdmin() {
  const context = await requireModerator();
  if (context.role !== "admin") redirect("/admin?notice=forbidden");
  return context;
}

/** Sensitive administrator mutations require a signed Supabase Auth AAL2 session. */
export async function requireAdminAal2() {
  const context = await requireAdmin();
  const { data, error } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data.currentLevel !== "aal2") redirect("/admin?notice=aal2-required");
  return context;
}

/** Public pages use this only to reveal compact controls to a signed-in admin. */
export async function getOptionalRole() {
  const supabase = await createSupabaseServerClient();
  // This is only a display hint on public pages; every action still uses
  // requireAdmin() on the server. Reading the local session avoids a blocking
  // remote getUser() refresh for every catalog and profile render.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase.from("moderators").select("role").eq("user_id", session.user.id).maybeSingle();
  return data?.role === "admin" ? "admin" : data?.role === "moderator" ? "moderator" : null;
}
