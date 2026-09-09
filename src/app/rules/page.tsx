import type { Metadata } from "next";
import { siteContent } from "@/lib/static-content";

export const metadata: Metadata = { title: "Правила", description: "Принципы использования публичного каталога AL-AMIN." };

export default function RulesPage() {
  return <section className="info-page"><div className="page-container narrow"><p className="page-eyebrow">Правила</p><h1>Принципы {siteContent.brandName}</h1><div className="legal-copy"><h2>Честная информация</h2><p>В каталоге публикуются сведения, которые специалист разрешил сделать публичными. Существенные изменения проходят редакционную проверку.</p><h2>Самостоятельные договорённости</h2><p>{siteContent.rulesIntro}</p><h2>Разумная осмотрительность</h2><p>До начала работы самостоятельно уточните условия, стоимость, сроки, документы и порядок урегулирования разногласий.</p></div></div></section>;
}
