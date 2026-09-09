import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { siteContent } from "@/lib/static-content";

export function CivicFooter({ brandName = "AL-AMIN" }: { brandName?: string }) {
  return <footer className="civic-footer"><div className="civic-footer-inner">
    <div className="civic-footer-brand"><ShieldCheck aria-hidden="true" size={22} /><div><strong>{brandName}</strong><span>Каталог рекомендованных специалистов</span></div></div>
    <nav aria-label="Информационные страницы"><Link href="/about">О проекте</Link><Link href="/verification">Как мы отбираем</Link><Link href="/rules">Правила</Link><Link href="/privacy">Конфиденциальность</Link></nav>
    <a className="civic-footer-contact" href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>
  </div></footer>;
}
