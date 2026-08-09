import { Globe, Mail, Phone, Send } from "lucide-react";

type ContactKind = "phone" | "email" | "telegram" | "whatsapp" | "vk" | "site";
type Contact = { href: string; label: string; title: string; kind: ContactKind; external?: boolean };

const phoneDigits = (value: string) => value.replace(/[^\d+]/g, "");
const safeHttps = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

function ContactIcon({ kind }: { kind: ContactKind }) {
  if (kind === "whatsapp") return <span className="contact-brand contact-brand-whatsapp" aria-hidden="true">WA</span>;
  if (kind === "vk") return <span className="contact-brand contact-brand-vk" aria-hidden="true">VK</span>;
  const Icon = kind === "phone" ? Phone : kind === "email" ? Mail : kind === "telegram" ? Send : Globe;
  return <Icon aria-hidden="true" size={18} />;
}

export function toContactLinks(value: string): Contact[] {
  const seen = new Set<string>();
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).flatMap((raw) => {
    let contact: Contact | null = null;
    if (/^[+()\d\s-]{7,}$/.test(raw)) contact = { href: `tel:${phoneDigits(raw)}`, label: raw, title: "Позвонить", kind: "phone" };
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) contact = { href: `mailto:${raw}`, label: raw, title: "Написать email", kind: "email" };
    else {
      const telegram = raw.match(/^(?:https:\/\/)?(?:t\.me|telegram\.me)\/([\w_]+)/i) || raw.match(/^@([\w_]+)$/);
      if (telegram) contact = { href: `https://t.me/${telegram[1]}`, label: raw, title: "Открыть Telegram", kind: "telegram", external: true };
      else {
        const whatsappNumber = raw.match(/^(?:https:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)([\d]+)/i);
        const url = safeHttps(raw);
        if (whatsappNumber) contact = { href: `https://wa.me/${whatsappNumber[1]}`, label: raw, title: "Открыть WhatsApp", kind: "whatsapp", external: true };
        else if (url) {
          const host = url.hostname.toLowerCase().replace(/^www\./, "");
          contact = host === "vk.com" || host.endsWith(".vk.com")
            ? { href: url.toString(), label: raw, title: "Открыть ВКонтакте", kind: "vk", external: true }
            : { href: url.toString(), label: raw, title: "Открыть сайт", kind: "site", external: true };
        }
      }
    }
    if (!contact || seen.has(contact.href)) return [];
    seen.add(contact.href);
    return [contact];
  });
}

export function ContactLinks({ value }: { value: string }) {
  const contacts = toContactLinks(value);
  if (!contacts.length) return null;
  return <div className="contact-links">{contacts.map(({ href, label, title, kind, external }) => <a key={href} href={href} aria-label={title} title={title} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}><ContactIcon kind={kind} /><span>{label}</span></a>)}</div>;
}
