import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { siteContent } from "@/lib/static-content";

export function CivicFooter({ brandName = "AL-AMIN" }: { brandName?: string }) {
  return <footer className="civic-footer"><div className="civic-footer-inner">
    <div className="civic-footer-brand"><ShieldCheck aria-hidden="true" size={22} /><strong>{brandName}</strong></div>
    <nav aria-label="Информационные страницы"><Link href="/rules">Правила</Link><Link href="/contacts">Контакты</Link></nav>
    <a className="civic-footer-contact" href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>
  </div></footer>;
}
