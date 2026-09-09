"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { SpecialistCard } from "@/components/SpecialistCard";
import type { StaticSpecialist, WorkMode } from "@/lib/static-content";

const modeLabels: Record<WorkMode | "all", string> = { all: "Любой формат", online: "Онлайн", offline: "Очно", both: "Онлайн и очно" };

export function CatalogExplorer({ specialists, categories }: { specialists: StaticSpecialist[]; categories: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [mode, setMode] = useState<WorkMode | "all">("all");
  const cities = useMemo(() => [...new Set(specialists.map((item) => item.city))].sort((a, b) => a.localeCompare(b, "ru")), [specialists]);
  const normalized = query.trim().toLocaleLowerCase("ru");
  const results = useMemo(() => specialists.filter((item) => {
    const haystack = [item.fullName, item.specialization, item.profileSummary, item.city, item.country, ...item.categories, ...item.helpTopics.flatMap((topic) => [topic.title, topic.description ?? ""])].join(" ").toLocaleLowerCase("ru");
    return (!normalized || haystack.includes(normalized)) && (!category || item.categories.includes(category)) && (!city || item.city === city) && (mode === "all" || item.workMode === mode || item.workMode === "both");
  }), [specialists, normalized, category, city, mode]);
  const hasFilters = Boolean(query || category || city || mode !== "all");
  const reset = () => { setQuery(""); setCategory(""); setCity(""); setMode("all"); };

  return <>
    <div className="catalog-toolbar" role="search">
      <label className="catalog-search"><Search aria-hidden="true" size={19} /><span className="sr-only">Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, профессия или задача" /></label>
      <label><span>Категория</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Все направления</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Город</span><select value={city} onChange={(event) => setCity(event.target.value)}><option value="">Любой город</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Формат</span><select value={mode} onChange={(event) => setMode(event.target.value as WorkMode | "all")}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="catalog-summary"><p><SlidersHorizontal aria-hidden="true" size={17} />Найдено: <strong>{results.length}</strong></p>{hasFilters ? <button type="button" onClick={reset}><X aria-hidden="true" size={16} />Сбросить фильтры</button> : null}</div>
    {results.length ? <div className="specialist-grid">{results.map((item) => <SpecialistCard item={item} key={item.id} />)}</div> : <div className="empty-state"><ShieldEmpty /><h2>{specialists.length ? "Ничего не найдено" : "Каталог формируется"}</h2><p>{specialists.length ? "Попробуйте изменить или сбросить фильтры." : "Здесь появятся только реальные специалисты, добавленные редактором AL-AMIN."}</p>{hasFilters ? <button className="primary-button" type="button" onClick={reset}>Сбросить фильтры</button> : null}</div>}
  </>;
}

function ShieldEmpty() {
  return <span className="empty-state-icon" aria-hidden="true">A</span>;
}
