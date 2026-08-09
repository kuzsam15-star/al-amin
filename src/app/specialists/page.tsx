import { SpecialistCard } from "@/components/SpecialistCard";
import { createPublicClient } from "@/lib/supabase/public";
import type { Specialist } from "@/lib/types";
import { loadPublicTrustBadges } from "@/lib/public-trust-badges";
import { loadPublicVerificationFacts } from "@/lib/public-verification-facts";
import { PUBLIC_SPECIALIST_SELECT, toPublicSpecialist } from "@/lib/public-specialists";
import Link from "next/link";

export const revalidate = 60;

export default async function SpecialistsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; country?: string; city?: string; mode?: string }> }) {
  const filters = await searchParams;
  const supabase = createPublicClient();
  let specialists: Specialist[] = [];
  let categories: { id: string; name: string; slug: string }[] = [];

  if (supabase) {
    const [{ data }, { data: categoryData }] = await Promise.all([
      supabase.from("published_specialists").select(PUBLIC_SPECIALIST_SELECT).order("full_name"),
      supabase.from("categories").select("id,name,slug").eq("is_active", true).order("name"),
    ]);
    specialists = (data ?? []).map((row) => toPublicSpecialist(row as Record<string, unknown>));
    const [badges, verification] = await Promise.all([
      loadPublicTrustBadges(supabase, specialists.map((item) => item.id)),
      loadPublicVerificationFacts(supabase, specialists.map((item) => item.id)),
    ]);
    specialists = specialists.map((item) => ({ ...item, trust_badges: badges.get(item.id) ?? [], verification_facts: verification.get(item.id) ?? null }));
    categories = categoryData ?? [];
  }

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const needle = (filters.q ?? "").trim().toLocaleLowerCase("ru");
  if (needle) specialists = specialists.filter((item) => [
    item.full_name, item.short_description, item.full_description ?? "", item.city, item.category?.name ?? "",
    ...(item.additional_category_ids ?? []).map((id) => categoryNames.get(id) ?? ""), ...(item.services ?? []),
    ...item.help_topics.flatMap((topic) => [topic.title, topic.description ?? ""]), item.specialization ?? "",
  ].join(" ").toLocaleLowerCase("ru").includes(needle));
  if (filters.category) specialists = specialists.filter((item) => item.category?.slug === filters.category);
  if (filters.country) specialists = specialists.filter((item) => item.country.toLocaleLowerCase("ru").includes(filters.country!.toLocaleLowerCase("ru")));
  if (filters.city) specialists = specialists.filter((item) => item.city.toLocaleLowerCase("ru").includes(filters.city!.toLocaleLowerCase("ru")));
  if (filters.mode) specialists = specialists.filter((item) => item.service_mode === filters.mode);

  return <section className="section"><div className="container">
    <div className="eyebrow">Каталог</div><h1 className="page-title">Найдите специалиста</h1>
    <form className="searchbar" action="/specialists">
      <input name="q" defaultValue={filters.q} placeholder="Имя, профессия, услуга или ключевое слово" aria-label="Поиск" />
      <select name="category" defaultValue={filters.category ?? ""}><option value="">Все категории</option>{categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
      <input name="country" defaultValue={filters.country} placeholder="Страна" aria-label="Страна" /><input name="city" defaultValue={filters.city} placeholder="Город" aria-label="Город" />
      <select name="mode" defaultValue={filters.mode ?? ""}><option value="">Любой формат</option><option value="online">Онлайн</option><option value="offline">Офлайн</option><option value="both">Онлайн и офлайн</option></select>
      <button className="button">Найти</button>{Object.values(filters).some(Boolean) && <Link className="clear-search" href="/specialists">Очистить</Link>}
    </form>
    <p className="meta result-count">Найдено: {specialists.length}</p>
    {specialists.length ? <div className="grid">{specialists.map((item) => <SpecialistCard key={item.id} item={item} nativeProfileNavigation />)}</div> : <div className="notice">По этому запросу пока нет опубликованных специалистов. Очистите поиск или измените фильтры.</div>}
  </div></section>;
}
