"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { Globe, Mail, MessageCircle, Phone, Send } from "lucide-react";

type Kind = "phone" | "email" | "telegram" | "whatsapp" | "vk" | "site" | "link";
type Item = { kind: Kind; value: string };
const labels: Record<Kind, string> = { phone: "Телефон", email: "Email", telegram: "Telegram", whatsapp: "WhatsApp", vk: "ВКонтакте", site: "Сайт", link: "Другая ссылка" };
const Icon = ({ kind }: { kind: Kind }) => kind === "phone" ? <Phone size={17} /> : kind === "email" ? <Mail size={17} /> : kind === "telegram" ? <Send size={17} /> : kind === "whatsapp" ? <MessageCircle size={17} /> : <Globe size={17} />;
const phone = (value: string) => value.replace(/\D/g, "");
const https = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; } };

function normalize(kind: Kind, input: string) {
  const value = input.trim();
  if (kind === "phone") { const digits = phone(value); return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null; }
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
  if (kind === "telegram") { const match = value.match(/^@?([a-zA-Z0-9_]{5,32})$/) ?? value.match(/^https:\/\/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{5,32})\/?$/i); return match ? `https://t.me/${match[1]}` : null; }
  if (kind === "whatsapp") { const digits = phone(value.replace(/^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)/i, "")); return digits.length >= 10 && digits.length <= 15 ? `https://wa.me/${digits}` : null; }
  const url = https(value);
  if (!url) return null;
  if (kind === "vk" && !/^https:\/\/(?:www\.)?vk\.com\//i.test(url)) return null;
  return url;
}

function infer(value: string): Item | null {
  if (/^[+()\d\s-]{7,}$/.test(value)) return { kind: "phone", value: normalize("phone", value) ?? value };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { kind: "email", value };
  if (/^(?:@|https:\/\/(?:t\.me|telegram\.me)\/)/i.test(value)) return { kind: "telegram", value: normalize("telegram", value) ?? value };
  if (/^(?:https:\/\/(?:wa\.me|api\.whatsapp\.com))/i.test(value)) return { kind: "whatsapp", value: normalize("whatsapp", value) ?? value };
  if (/^https:\/\/(?:www\.)?vk\.com\//i.test(value)) return { kind: "vk", value };
  if (/^https:\/\//i.test(value)) return { kind: "site", value };
  return null;
}

export function ContactEditor({ name, initial }: { name: string; initial: string[] }) {
  const [items, setItems] = useState(() => initial.map(infer).filter((item): item is Item => Boolean(item)));
  const [kind, setKind] = useState<Kind>("phone");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const placeholders: Record<Kind, string> = { phone: "+7 900 123-45-67", email: "name@example.com", telegram: "@username или https://t.me/username", whatsapp: "+7 900 123-45-67", vk: "https://vk.com/username", site: "https://example.com", link: "https://example.com" };
  const serialized = useMemo(() => items.map((item) => item.value), [items]);
  function add() {
    const normalized = normalize(kind, value);
    if (!normalized) return setMessage("Проверьте формат контакта: для сайта и ссылок разрешён только HTTPS.");
    if (items.some((item) => item.value === normalized) || (kind !== "link" && items.some((item) => item.kind === kind))) return setMessage("Такой контакт уже добавлен.");
    if (items.length >= 8) return setMessage("Можно добавить до 8 контактов.");
    setItems((current) => [...current, { kind, value: normalized }]); setValue(""); setMessage("");
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(); } };
  return <div className="contact-editor">
    <input type="hidden" name={name} value={serialized.join("\n")} />
    <div className="compact-adder"><select value={kind} onChange={(event) => setKind(event.target.value as Kind)} aria-label="Тип контакта">{(Object.keys(labels) as Kind[]).map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select><input value={value} placeholder={placeholders[kind]} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} /><button type="button" className="button secondary" onClick={add}>Добавить контакт</button></div>
    {items.length > 0 && <div className="contact-items">{items.map((item, index) => <div className="contact-item" key={`${item.kind}-${item.value}`}><Icon kind={item.kind} /><span><strong>{labels[item.kind]}</strong><small>{item.value}</small></span><button type="button" className="icon-remove" aria-label={`Удалить ${labels[item.kind]}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}
    <p className="form-hint">Телефон и WhatsApp нормализуются; для сайта, VK и других ссылок разрешён только HTTPS.</p>{message && <p className="form-message" role="status">{message}</p>}
  </div>;
}
