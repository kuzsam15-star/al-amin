import { ExternalLink, Globe, Mail, Phone, Send } from "lucide-react";
import type { SpecialistContact } from "@/lib/static-content";

function telegramHref(value: string) {
  const username = value.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//iu, "").replace(/^@/u, "").split(/[?/#]/u)[0];
  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? `https://t.me/${username}` : null;
}

function whatsappHref(value: string) {
  if (/^https:\/\/wa\.me\/\d+/iu.test(value)) return value;
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 7 ? `https://wa.me/${digits}` : null;
}

export function DirectContacts({ contacts, compact = false }: { contacts: SpecialistContact; compact?: boolean }) {
  const items = [
    contacts.phone ? { href: `tel:${contacts.phone.replace(/[^\d+]/gu, "")}`, label: "Позвонить", detail: contacts.phone, Icon: Phone, external: false } : null,
    contacts.telegram && telegramHref(contacts.telegram) ? { href: telegramHref(contacts.telegram)!, label: "Telegram", detail: contacts.telegram, Icon: Send, external: true } : null,
    contacts.whatsapp && whatsappHref(contacts.whatsapp) ? { href: whatsappHref(contacts.whatsapp)!, label: "WhatsApp", detail: contacts.whatsapp, Icon: ExternalLink, external: true } : null,
    contacts.email ? { href: `mailto:${contacts.email}`, label: "Email", detail: contacts.email, Icon: Mail, external: false } : null,
    contacts.website ? { href: contacts.website, label: "Сайт", detail: new URL(contacts.website).hostname.replace(/^www\./u, ""), Icon: Globe, external: true } : null,
  ].filter(Boolean) as { href: string; label: string; detail: string; Icon: typeof Phone; external: boolean }[];
  if (!items.length) return null;
  return <div className={compact ? "direct-contacts is-compact" : "direct-contacts"}>{items.map(({ href, label, detail, Icon, external }) => <a key={href} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}><Icon aria-hidden="true" size={18} /><span><strong>{label}</strong>{compact ? null : <small>{detail}</small>}</span></a>)}</div>;
}
