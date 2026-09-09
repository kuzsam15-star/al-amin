"use client";

import Link from "next/link";
import { Menu, ShieldCheck, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/specialists", label: "Специалисты" },
  { href: "/verification", label: "Как мы отбираем" },
  { href: "/about", label: "О проекте" },
];

export function CivicHeader({ brandName = "AL-AMIN" }: { brandName?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  return <header className="civic-header">
    <div className="civic-header-inner">
      <Link className="civic-logo" href="/" aria-label={`${brandName} — главная`}><ShieldCheck aria-hidden="true" size={24} /><span>{brandName}</span></Link>
      <nav className="civic-desktop-nav" aria-label="Основная навигация">
        {links.map((link) => <Link key={link.href} className={pathname.startsWith(link.href) ? "is-active" : undefined} href={link.href}>{link.label}</Link>)}
      </nav>
      <button className="civic-menu-button" type="button" aria-label={open ? "Закрыть меню" : "Открыть меню"} aria-expanded={open} aria-controls="civic-mobile-menu" onClick={() => setOpen((value) => !value)}>{open ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}</button>
    </div>
    <nav id="civic-mobile-menu" className={`civic-mobile-nav${open ? " is-open" : ""}`} aria-label="Мобильная навигация">{links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
  </header>;
}
