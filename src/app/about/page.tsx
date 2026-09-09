import type { Metadata } from "next";
import { siteContent } from "@/lib/static-content";

export const metadata: Metadata = { title: "О проекте", description: "Зачем существует AL-AMIN и как устроен каталог рекомендаций." };

export default function AboutPage() {
  return <section className="info-page"><div className="page-container narrow"><p className="page-eyebrow">О проекте</p><h1>Не маркетплейс. Каталог личной рекомендации.</h1><p className="page-lead">{siteContent.aboutText}</p><div className="info-grid"><article><h2>Зачем существует AL-AMIN</h2><p>Профессиональный выбор становится спокойнее, когда рядом с услугой виден человек, контекст его работы и честно обозначенные основания рекомендации.</p></article><article><h2>Что делает каталог</h2><p>AL-AMIN отбирает и представляет специалистов, а посетитель самостоятельно оценивает профиль и связывается напрямую.</p></article><article><h2>Чего каталог не делает</h2><p>Мы не принимаем оплату, не участвуем в договоре и не продаём доверие. Итоговые договорённости остаются ответственностью клиента и специалиста.</p></article></div></div></section>;
}
