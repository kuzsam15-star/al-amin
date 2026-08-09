"use client";

import Link from "next/link";
import { Menu, ShieldCheck, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/specialists", label: "Специалисты" },
  { href: "/verification", label: "Как мы проверяем" },
  { href: "/cabinet", label: "Кабинет" },
  { href: "/admin", label: "Модерация" },
];

export function CivicHeader({ brandName = "AL-AMIN" }: { brandName?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const publicProfile = /^\/specialists\/[^/]+$/.test(pathname);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  return (
    <header className="civic-header">
      <div className="civic-header-inner">
        <Link className="civic-logo" href="/" aria-label={`${brandName} — главная`}>
          <ShieldCheck aria-hidden="true" size={24} strokeWidth={2.15} />
          <span>{brandName}</span>
        </Link>
        <nav className="civic-desktop-nav" aria-label="Основная навигация Civic Preview">
          {links.slice(0, publicProfile ? 2 : 3).map((link) => <Link key={link.href} className={pathname.startsWith(link.href) ? "is-active" : undefined} href={link.href}>{link.label}</Link>)}
          <Link className="civic-login-link" href="/login">Войти</Link>
        </nav>
        {publicProfile ? <Link className="civic-profile-mobile-login" href="/login">Войти</Link> : <button className="civic-menu-button" type="button" aria-label={open ? "Закрыть меню" : "Открыть меню"} aria-expanded={open} aria-controls="civic-mobile-menu" onClick={() => setOpen((value) => !value)}>
          {open ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
        </button>}
      </div>
      {!publicProfile ? <nav id="civic-mobile-menu" className={`civic-mobile-nav${open ? " is-open" : ""}`} aria-label="Мобильная навигация Civic Preview">
        {links.map((link) => <Link key={link.href} className={pathname.startsWith(link.href) ? "is-active" : undefined} href={link.href}>{link.label}</Link>)}
        <Link href="/apply">Стать специалистом</Link>
        <Link href="/login">Войти</Link>
      </nav> : null}
    </header>
  );
}
