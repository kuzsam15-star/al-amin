"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SelectCategory = { id: string; name: string; group_name?: string | null };
type Props = { name: string; categories: SelectCategory[]; initial: string[]; value?: string[]; primaryId?: string; onChange?: (ids: string[]) => void; limit?: number; error?: string };

export function CategoryMultiSelect({ name, categories, initial, value, primaryId = "", onChange, limit = 8, error }: Props) {
  const [selected, setSelected] = useState(value ?? initial);
  const [draft, setDraft] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogId = `${name}-dialog`;
  const update = (next: string[]) => { setSelected(next); onChange?.(next); };

  useEffect(() => { if (value) setSelected(value); }, [value]);
  useEffect(() => {
    if (!primaryId || !selected.includes(primaryId)) return;
    const next = selected.filter((id) => id !== primaryId);
    update(next);
    setNotice("Основная категория удалена из дополнительных.");
  // `onChange` is intentionally omitted: consumers pass an inline callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const names = new Map(categories.map((item) => [item.id, item.name]));
  const visible = useMemo(() => categories.filter((item) => item.id !== primaryId && item.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))), [categories, primaryId, query]);
  const groups = useMemo(() => visible.reduce<Record<string, SelectCategory[]>>((result, item) => {
    const group = item.group_name?.trim() || "Специализация";
    (result[group] ??= []).push(item);
    return result;
  }, {}), [visible]);

  function start() { setDraft(selected); setQuery(""); setNotice(""); setOpen(true); }
  function close() { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }
  function toggle(id: string) {
    setDraft((current) => {
      if (current.includes(id)) { setNotice(""); return current.filter((item) => item !== id); }
      if (current.length >= limit) { setNotice(`Можно выбрать не больше ${limit} дополнительных категорий.`); return current; }
      setNotice(""); return [...current, id];
    });
  }
  function handleDialogKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="category-select">
    {selected.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
    {selected.length > 0 && <div className="selected-categories">{selected.map((id) => <span key={id}>{names.get(id) ?? "Неизвестная категория"}<button type="button" aria-label={`Удалить категорию ${names.get(id) ?? ""}`} onClick={() => update(selected.filter((item) => item !== id))}>×</button></span>)}</div>}
    <button ref={triggerRef} type="button" className="button secondary category-open" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={start}>Доп. категории</button>
    <p className="form-hint">Выбрано {selected.length} из {limit}. Основную категорию повторно выбрать нельзя.</p>
    {(notice || error) && <p className={error ? "field-error" : "form-hint"} role={error ? "alert" : "status"}>{error ?? notice}</p>}
    {open && <div className="category-modal-backdrop" role="presentation" onMouseDown={close}><section ref={dialogRef} id={dialogId} className="category-modal" role="dialog" aria-modal="true" aria-labelledby={`${name}-title`} aria-describedby={`${name}-description`} onKeyDown={handleDialogKey} onMouseDown={(event) => event.stopPropagation()}><header><div><h3 id={`${name}-title`}>Дополнительные категории</h3><p id={`${name}-description`}>Выберите до {limit}; основная категория скрыта.</p></div><button type="button" className="icon-remove" aria-label="Закрыть" onClick={close}>×</button></header><input ref={searchRef} value={query} placeholder="Найти категорию" onChange={(event) => setQuery(event.target.value)} aria-label="Поиск дополнительной категории" /><div className="category-groups">{Object.entries(groups).map(([group, items]) => <section key={group}><h4>{group}</h4>{items.map((item) => { const blocked = !draft.includes(item.id) && draft.length >= limit; return <button key={item.id} type="button" className={draft.includes(item.id) ? "selected" : ""} aria-disabled={blocked} onClick={() => toggle(item.id)}><span>{item.name}</span><span aria-hidden="true">{draft.includes(item.id) ? "✓" : "+"}</span></button>; })}</section>)}{Object.keys(groups).length === 0 && <p className="form-hint">По вашему запросу ничего не найдено.</p>}</div>{notice && <p className="category-limit-notice" role="status">{notice}</p>}<footer><button type="button" className="button secondary" onClick={close}>Отмена</button><button type="button" className="button" onClick={() => { update(draft); close(); }}>Готово</button></footer></section></div>}
  </div>;
}
