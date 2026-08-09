"use client";

import { useId, useState } from "react";
import type { HelpTopic } from "@/lib/specialist-contract.mjs";

type Props = {
  value: HelpTopic[];
  onChange: (value: HelpTopic[]) => void;
  name?: string;
  ariaInvalid?: boolean;
  errors?: Record<string, string>;
};

const emptyTopic = (): HelpTopic => ({ title: "", description: null });
export function HelpTopicsEditor({ value, onChange, name, ariaInvalid, errors = {} }: Props) {
  const items = value.length ? value : [emptyTopic()];
  const baseId = useId();
  const [keys, setKeys] = useState<string[]>(() => items.map((_, index) => `${baseId}-${index}`));
  const update = (index: number, patch: Partial<HelpTopic>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const remove = (index: number) => { setKeys((current) => current.filter((_, itemIndex) => itemIndex !== index)); onChange(items.filter((_, itemIndex) => itemIndex !== index)); };
  const add = () => { setKeys((current) => [...current, `${baseId}-${crypto.randomUUID()}`]); onChange([...items, emptyTopic()]); };
  const error = (index: number, field: "title" | "description") => errors[`helpTopics.${index}.${field}`];

  return <div className="structured-editor" aria-invalid={ariaInvalid || undefined}>
    {name ? <input type="hidden" name={name} value={JSON.stringify(value)} /> : null}
    {items.map((item, index) => <fieldset className="structured-editor-item" key={keys[index] ?? `${baseId}-fallback-${index}`}>
      <legend>Направление {index + 1}</legend>
      <label htmlFor={`help-topic-${keys[index]}-title`}>Название<input id={`help-topic-${keys[index]}-title`} value={item.title} aria-invalid={Boolean(error(index, "title"))} aria-describedby={error(index, "title") ? `help-topic-${keys[index]}-title-error` : undefined} placeholder="Например: тревога и выгорание" onChange={(event) => update(index, { title: event.target.value })} /></label>
      {error(index, "title") && <p id={`help-topic-${keys[index]}-title-error`} className="field-error" role="alert">{error(index, "title")}</p>}
      <label htmlFor={`help-topic-${keys[index]}-description`}>Короткое пояснение <span className="meta">необязательно</span><textarea id={`help-topic-${keys[index]}-description`} value={item.description ?? ""} aria-invalid={Boolean(error(index, "description"))} aria-describedby={error(index, "description") ? `help-topic-${keys[index]}-description-error` : undefined} rows={2} placeholder="Какой результат получит клиент" onChange={(event) => update(index, { description: event.target.value || null })} /></label>
      {error(index, "description") && <p id={`help-topic-${keys[index]}-description-error`} className="field-error" role="alert">{error(index, "description")}</p>}
      {items.length > 1 ? <button type="button" className="structured-remove" onClick={() => remove(index)}>Удалить направление</button> : null}
    </fieldset>)}
    <button type="button" className="button secondary" disabled={items.length >= 12} aria-describedby={items.length >= 12 ? "help-topics-limit" : undefined} onClick={add}>Добавить направление</button>
    {items.length >= 12 && <p id="help-topics-limit" className="form-hint" role="status">Достигнут лимит: 12 направлений.</p>}
  </div>;
}
