"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Film, Link as LinkIcon } from "lucide-react";

type Props = { name?: string; initial: string[]; value?: string[]; onChange?: (items: string[]) => void; variant: "link" | "video"; limit: number };
const safeUrl = (value: string) => { try { const url = new URL(value.trim()); return url.protocol === "https:" ? url.toString() : null; } catch { return null; } };
const provider = (value: string) => { const host = new URL(value).hostname.toLowerCase().replace(/^www\./, ""); return host.includes("youtube") || host === "youtu.be" ? "YouTube" : host.includes("vk.com") ? "VK Видео" : host.includes("rutube") ? "RUTUBE" : host; };

export function LinkListEditor({ name, initial, value: controlledValue, onChange, variant, limit }: Props) {
  const [items, setItems] = useState(() => (controlledValue ?? initial).filter((value) => Boolean(safeUrl(value))).slice(0, limit));
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const serialized = useMemo(() => items, [items]);
  const update = (next: string[]) => { const clean = next.filter((item) => Boolean(safeUrl(item))).slice(0, limit); setItems(clean); onChange?.(clean); };
  useEffect(() => { if (controlledValue) setItems(controlledValue.filter((item) => Boolean(safeUrl(item))).slice(0, limit)); }, [controlledValue, limit]);
  function add() {
    const url = safeUrl(value);
    if (!url) return setMessage("Укажите корректную HTTPS-ссылку.");
    if (items.includes(url)) return setMessage("Эта ссылка уже добавлена.");
    if (items.length >= limit) return setMessage(`Можно добавить до ${limit} ссылок.`);
    update([...items, url]); setValue(""); setMessage("");
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(); } };
  return <div className={`link-list-editor ${variant}`}>{name && <input type="hidden" name={name} value={serialized.join("\n")} />}<div className="compact-adder"><input value={value} inputMode="url" placeholder={variant === "video" ? "Вставьте ссылку на видео" : "Вставьте безопасную ссылку"} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} /><button type="button" className="button secondary" onClick={add}>Добавить</button></div>{items.length > 0 && <div className="link-cards">{items.map((item, index) => <div className="link-card" key={item}>{variant === "video" ? <Film size={20} /> : <LinkIcon size={20} />}<span><strong>{provider(item)}</strong><small>{item}</small></span><a href={item} target="_blank" rel="noopener noreferrer" aria-label="Открыть ссылку"><ExternalLink size={17} /></a><button type="button" className="icon-remove" aria-label="Удалить ссылку" onClick={() => update(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}<p className="form-hint">Добавлено {items.length} из {limit}. Длинные ссылки безопасно переносятся.</p>{message && <p className="form-message" role="status">{message}</p>}</div>;
}
