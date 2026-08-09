"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { archivePublicProfile } from "@/app/admin/actions";

let adminCheck: Promise<boolean> | null = null;
const checkAdmin = () => adminCheck ??= fetch("/api/admin/session", { cache: "no-store" })
  .then((response) => response.ok ? response.json() : null)
  .then((data) => data?.isAdmin === true)
  .catch(() => false);

export function AdminPublicActions({ profileId, returnTo }: { profileId: string; returnTo: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (menuRef.current?.open && event.target instanceof Node && !menuRef.current.contains(event.target)) menuRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsidePress); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  return <details ref={menuRef} className="admin-public-actions"><summary aria-label="Действия администратора">⋯</summary><div className="admin-public-menu"><Link href="/admin">Открыть в админке</Link><form action={archivePublicProfile} onSubmit={(event) => { if (!window.confirm("Удалить профиль из публичного каталога? Сам профиль, его аккаунт, отзывы и заявки останутся сохранены.")) event.preventDefault(); }}><input type="hidden" name="profileId" value={profileId}/><input type="hidden" name="returnTo" value={returnTo}/><button type="submit">Скрыть из каталога</button></form></div></details>;
}

export function AdminPublicActionsGate({ profileId, returnTo }: { profileId: string; returnTo: string }) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { let active = true; checkAdmin().then((value) => { if (active) setIsAdmin(value); }); return () => { active = false; }; }, []);
  return isAdmin ? <AdminPublicActions profileId={profileId} returnTo={returnTo} /> : null;
}
