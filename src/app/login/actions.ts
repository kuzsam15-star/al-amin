"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/navigation";
export async function signIn(formData:FormData){const email=String(formData.get("email")??"").trim();const password=String(formData.get("password")??"");const next=safeNextPath(formData.get("next"),"/cabinet");const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signInWithPassword({email,password});if(error){const reason=error.code === "email_not_confirmed" ? "email-not-confirmed" : error.code === "invalid_credentials" ? "invalid-credentials" : "signin";redirect(`/login?next=${encodeURIComponent(next)}&error=${reason}`);}redirect(next);}
