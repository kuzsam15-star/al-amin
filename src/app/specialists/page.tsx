import type { Metadata } from "next";
import { CatalogExplorer } from "@/components/CatalogExplorer";
import { getCategories, getPublishedSpecialists } from "@/lib/static-content";

export const metadata: Metadata = {
  title: "Специалисты",
  description: "Каталог рекомендованных специалистов AL-AMIN с прозрачными профилями и прямыми контактами.",
};

export default function SpecialistsPage() {
  return <section className="catalog-page"><div className="page-container">
    <p className="page-eyebrow">Каталог AL-AMIN</p>
    <h1>Найдите своего специалиста</h1>
    <p className="page-lead">Выберите человека по опыту, специализации и понятному объёму проверки — без регистрации и посредников.</p>
    <CatalogExplorer specialists={getPublishedSpecialists()} categories={getCategories()} />
  </div></section>;
}
