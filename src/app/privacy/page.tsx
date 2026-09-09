import type { Metadata } from "next";
import { siteContent } from "@/lib/static-content";

export const metadata: Metadata = { title: "Конфиденциальность", description: "Принципы конфиденциальности публичного каталога AL-AMIN." };

export default function PrivacyPage() {
  return <section className="info-page"><div className="page-container narrow"><p className="page-eyebrow">Конфиденциальность</p><h1>Минимум данных — меньше рисков</h1><div className="legal-copy"><p>{siteContent.privacyText}</p><h2>Публичные контакты специалистов</h2><p>Телефон, мессенджеры и сайт отображаются только при явном решении редактора и с разрешения специалиста.</p><h2>Запрос на изменение</h2><p>Для уточнения или удаления опубликованных сведений напишите на <a href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>.</p></div></div></section>;
}
