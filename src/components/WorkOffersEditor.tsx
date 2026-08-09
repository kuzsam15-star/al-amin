"use client";

import { useId, useState } from "react";
import type { WorkOffer, WorkMode } from "@/lib/specialist-contract.mjs";

type Props = {
  value: WorkOffer[];
  onChange: (value: WorkOffer[]) => void;
  name?: string;
  ariaInvalid?: boolean;
  errors?: Record<string, string>;
};

const emptyOffer = (): WorkOffer => ({ title: "", duration_minutes: null, mode: "both", price: null, currency: null });
const numberOrNull = (value: string) => value === "" ? null : Number(value);
const stopExponent = (event: React.KeyboardEvent<HTMLInputElement>) => { if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault(); };

export function WorkOffersEditor({ value, onChange, name, ariaInvalid, errors = {} }: Props) {
  const items = value.length ? value : [emptyOffer()];
  const baseId = useId();
  const [keys, setKeys] = useState<string[]>(() => items.map((_, index) => `${baseId}-${index}`));
  const update = (index: number, patch: Partial<WorkOffer>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const remove = (index: number) => { setKeys((current) => current.filter((_, itemIndex) => itemIndex !== index)); onChange(items.filter((_, itemIndex) => itemIndex !== index)); };
  const add = () => { setKeys((current) => [...current, `${baseId}-${crypto.randomUUID()}`]); onChange([...items, emptyOffer()]); };
  const error = (index: number, field: string) => errors[`workOffers.${index}.${field}`];
  const inputProps = (index: number, field: string) => ({ "aria-invalid": Boolean(error(index, field)) || undefined, "aria-describedby": error(index, field) ? `work-offer-${keys[index]}-${field}-error` : undefined });
  const errorNode = (index: number, field: string) => error(index, field) ? <p id={`work-offer-${keys[index]}-${field}-error`} className="field-error" role="alert">{error(index, field)}</p> : null;

  return <div className="structured-editor" aria-invalid={ariaInvalid || undefined}>
    {name ? <input type="hidden" name={name} value={JSON.stringify(value)} /> : null}
    {items.map((item, index) => <fieldset className="structured-editor-item" key={keys[index] ?? `${baseId}-fallback-${index}`}>
      <legend>Формат {index + 1}</legend>
      <label className="structured-wide">Название<input value={item.title} {...inputProps(index, "title")} placeholder="Например: первичная консультация" onChange={(event) => update(index, { title: event.target.value })} /></label>{errorNode(index, "title")}
      <label>Длительность, минут <span className="meta">необязательно</span><input type="number" min={1} max={1440} step={1} inputMode="numeric" value={item.duration_minutes ?? ""} {...inputProps(index, "duration_minutes")} onKeyDown={stopExponent} onChange={(event) => update(index, { duration_minutes: numberOrNull(event.target.value) })} /></label>{errorNode(index, "duration_minutes")}
      <label>Формат<select value={item.mode ?? "both"} {...inputProps(index, "mode")} onChange={(event) => update(index, { mode: event.target.value as WorkMode })}><option value="online">Онлайн</option><option value="offline">Очно</option><option value="both">Онлайн и очно</option></select></label>{errorNode(index, "mode")}
      <label>Стоимость <span className="meta">необязательно</span><input type="number" min={0.01} max={100000000} step="0.01" inputMode="decimal" value={item.price ?? ""} {...inputProps(index, "price")} onKeyDown={stopExponent} onChange={(event) => { const price = numberOrNull(event.target.value); update(index, { price, currency: price === null ? null : item.currency || "RUB" }); }} /></label>{errorNode(index, "price")}
      <label>Валюта<select value={item.currency ?? "RUB"} disabled={item.price === null} {...inputProps(index, "currency")} onChange={(event) => update(index, { currency: event.target.value })}><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="KZT">KZT</option><option value="AED">AED</option><option value="TRY">TRY</option><option value="UZS">UZS</option></select></label>{errorNode(index, "currency")}
      {items.length > 1 ? <button type="button" className="structured-remove structured-wide" onClick={() => remove(index)}>Удалить формат</button> : null}
    </fieldset>)}
    <button type="button" className="button secondary" disabled={items.length >= 12} aria-describedby={items.length >= 12 ? "work-offers-limit" : undefined} onClick={add}>Добавить формат</button>
    {items.length >= 12 && <p id="work-offers-limit" className="form-hint" role="status">Достигнут лимит: 12 форматов.</p>}
  </div>;
}
