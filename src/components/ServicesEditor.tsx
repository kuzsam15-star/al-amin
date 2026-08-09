"use client";

import { KeyboardEvent, useEffect, useState } from "react";

type Props = { name?: string; initial: string[]; value?: string[]; onChange?: (items: string[]) => void; limit?: number; ariaInvalid?: boolean };
const clean = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 160);

export function ServicesEditor({ name, initial, value, onChange, limit = 20, ariaInvalid }: Props) {
  const [items, setItems] = useState(() => (value ?? initial).map(clean).filter(Boolean).slice(0, limit));
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (value) setItems(value.map(clean).filter(Boolean).slice(0, limit)); }, [limit, value]);
  const update = (next: string[]) => { setItems(next); onChange?.(next); };
  const add = () => {
    const next = clean(draft);
    if (!next) return;
    if (items.length >= limit) return setMessage(`Можно добавить до ${limit} услуг.`);
    if (items.some((item) => item.toLocaleLowerCase("ru") === next.toLocaleLowerCase("ru"))) return setMessage("Такая услуга уже добавлена.");
    update([...items, next]);
    setDraft("");
    setMessage("");
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  return <div className="list-editor">
    {name && <input type="hidden" name={name} value={items.join("\n")} />}
    <div className="list-editor-input"><input value={draft} maxLength={160} aria-invalid={ariaInvalid} placeholder="Например, консультация по договору" onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} /><button type="button" className="button secondary" onClick={add}>Добавить</button></div>
    <p className="form-hint">Введите услугу и нажмите Enter. Добавлено {items.length} из {limit}.</p>
    {items.length > 0 && <ul className="editable-tags">{items.map((item, index) => <li key={`${item}-${index}`}><span>{item}</span><button type="button" className="icon-remove" aria-label={`Удалить «${item}»`} onClick={() => update(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></li>)}</ul>}
    {message && <p className="form-message" role="status">{message}</p>}
  </div>;
}
