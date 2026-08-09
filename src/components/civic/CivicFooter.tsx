"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function CivicFooter({ brandName = "AL-AMIN" }: { brandName?: string }) {
  return (
    <footer className="civic-footer">
      <div className="civic-footer-inner">
        <div className="civic-footer-brand"><ShieldCheck aria-hidden="true" size={22} /><div><strong>{brandName}</strong><span>Платформа доверенного взаимодействия</span></div></div>
        <nav aria-label="Информационные страницы">
          <Link href="/about">О проекте</Link>
          <Link href="/verification">Как проходит проверка</Link>
          <Link href="/rules">Правила</Link>
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/support">Поддержка</Link>
        </nav>
      </div>
    </footer>
  );
}
