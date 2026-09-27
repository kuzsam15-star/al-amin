"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { categoryRegistry, categorySelectionLimit, getCategoryById, searchCategoryRegistry } from "@/lib/category-registry.mjs";
import styles from "./category-selector.module.css";

type Props = {
  selectedIds: string[];
  onApply: (ids: string[]) => void;
};

export function CategorySelectorDialog({ selectedIds, onApply }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [query, setQuery] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const results = useMemo(() => searchCategoryRegistry(query), [query]);
  const selectedItems = draftIds.map(getCategoryById).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  function openDialog() {
    setDraftIds(selectedIds);
    setQuery("");
    setExpandedGroup(null);
    setOpen(true);
  }

  function finish(apply: boolean) {
    if (apply) onApply(draftIds);
    dialogRef.current?.close();
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function toggle(id: string) {
    setDraftIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < categorySelectionLimit ? [...current, id] : current);
  }

  function categoryOption(item: (typeof categoryRegistry.categories)[number], groupLabel?: string) {
    const checked = draftIds.includes(item.id);
    const disabled = !checked && draftIds.length >= categorySelectionLimit;
    return <label className={`${styles.option} ${disabled ? styles.disabled : ""}`} key={item.id}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(item.id)} />
      <span className={styles.checkbox} aria-hidden="true">{checked ? <Check size={16} /> : null}</span>
      <span><strong>{item.label}</strong>{groupLabel ? <small>{groupLabel}</small> : null}</span>
    </label>;
  }

  return <>
    <button ref={triggerRef} type="button" className={styles.trigger} onClick={openDialog}>Выбрать категории</button>
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="category-dialog-title"
      onCancel={(event) => { event.preventDefault(); finish(false); }}
      onClose={() => setOpen(false)}
    >
      <div className={styles.shell}>
        <header className={styles.header}>
          <div><p>Категории AL-AMIN</p><h2 id="category-dialog-title">Выберите категории</h2></div>
          <button ref={closeRef} type="button" className={styles.close} aria-label="Закрыть без изменений" onClick={() => finish(false)}><X size={22} /></button>
        </header>

        <div className={styles.search}>
          <Search aria-hidden="true" size={20} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти категорию" aria-label="Найти категорию" autoComplete="off" />
        </div>

        <p className={styles.counter} aria-live="polite">Выбрано: <strong>{draftIds.length} из {categorySelectionLimit}</strong></p>

        <div className={styles.content}>
          {selectedItems.length ? <section className={styles.selected} aria-labelledby="selected-categories-title">
            <h3 id="selected-categories-title">Выбранные</h3>
            <div className={styles.selectedList}>{selectedItems.map((item) => <button key={item!.id} type="button" onClick={() => toggle(item!.id)}>{item!.label}<X aria-hidden="true" size={16} /></button>)}</div>
          </section> : null}

          {query.trim() ? <section className={styles.results} aria-label="Результаты поиска">
            {results.length ? results.map((item) => categoryOption(item, item.groupLabel)) : <div className={styles.empty}><strong>Совпадений нет</strong><span>Попробуйте другое слово или закройте окно и оставьте пояснение владельцу.</span></div>}
          </section> : <div className={styles.groups} aria-label="Разделы категорий">
            {categoryRegistry.groups.map((group) => {
              const expanded = expandedGroup === group.id;
              const items = expanded ? categoryRegistry.categories.filter((item) => item.groupId === group.id).sort((a, b) => a.label.localeCompare(b.label, "ru")) : [];
              const selectedCount = draftIds.filter((id) => getCategoryById(id)?.groupId === group.id).length;
              return <section className={styles.group} key={group.id}>
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedGroup(expanded ? null : group.id)}>
                  <span><strong>{group.label}</strong><small>{selectedCount ? `Выбрано: ${selectedCount}` : `${categoryRegistry.categories.filter((item) => item.groupId === group.id).length} направлений`}</small></span>
                  <ChevronDown aria-hidden="true" size={20} />
                </button>
                {expanded ? <div className={styles.groupItems}>{items.map((item) => categoryOption(item))}</div> : null}
              </section>;
            })}
          </div>}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => finish(false)}>Отмена</button>
          <button type="button" className={styles.apply} onClick={() => finish(true)}>Применить</button>
        </footer>
      </div>
    </dialog>
  </>;
}
