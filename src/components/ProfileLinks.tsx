import { Globe, Send } from "lucide-react";

type LinkKind = "telegram" | "vk" | "site";
type ProfileLink = { href: string; label: string; domain: string; kind: LinkKind };

function toProfileLink(value: string): ProfileLink | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const domain = url.hostname.replace(/^www\./i, "");
    const host = domain.toLowerCase();
    if (host === "t.me" || host.endsWith(".t.me") || host === "telegram.me") return { href: url.toString(), label: "Telegram", domain, kind: "telegram" };
    if (host === "vk.com" || host.endsWith(".vk.com") || host === "vk.ru" || host.endsWith(".vk.ru")) return { href: url.toString(), label: "ВКонтакте", domain, kind: "vk" };
    return { href: url.toString(), label: "Сайт", domain, kind: "site" };
  } catch { return null; }
}

export function ProfileLinks({ values }: { values: string[] }) {
  const links = values.map(toProfileLink).filter((link): link is ProfileLink => Boolean(link));
  if (!links.length) return null;
  return <div className="profile-links">{links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
    {link.kind === "telegram" ? <Send size={17} aria-hidden="true" /> : link.kind === "vk" ? <span className="link-brand" aria-hidden="true">VK</span> : <Globe size={17} aria-hidden="true" />}
    <span><strong>{link.label}</strong><small>{link.domain}</small></span>
  </a>)}</div>;
}
