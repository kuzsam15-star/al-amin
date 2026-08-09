"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();
  return <button type="button" className="button secondary logout-button" onClick={async () => { await createSupabaseBrowserClient().auth.signOut(); router.replace('/'); router.refresh(); }}>Выйти из аккаунта</button>;
}
