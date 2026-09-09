import type { Metadata } from "next";
import { CheckCircle2, FileSearch, ShieldCheck } from "lucide-react";
import { siteContent } from "@/lib/static-content";

export const metadata: Metadata = { title: "Как мы отбираем", description: "Принципы отбора и честные границы проверки специалистов AL-AMIN." };

const steps = [
  { Icon: FileSearch, title: "Изучаем профиль", text: "Сопоставляем предоставленные сведения, профессиональный контекст и доступные подтверждения." },
  { Icon: ShieldCheck, title: "Фиксируем факты", text: "В профиле называем только фактически проверенные сведения и дату проверки." },
  { Icon: CheckCircle2, title: "Публикуем рекомендацию", text: "Редактор принимает решение о размещении и сохраняет право снять профиль с публикации." },
];

export default function VerificationPage() {
  return <section className="info-page"><div className="page-container narrow"><p className="page-eyebrow">Методика AL-AMIN</p><h1>Как мы отбираем специалистов</h1><p className="page-lead">{siteContent.verificationIntro}</p><div className="process-grid">{steps.map(({ Icon, title, text }, index) => <article key={title}><span>0{index + 1}</span><Icon aria-hidden="true" size={26} /><h2>{title}</h2><p>{text}</p></article>)}</div><div className="notice"><strong>Граница проверки</strong><p>Отметка AL-AMIN не является гарантией качества будущей услуги. Обсудите условия, ожидаемый результат, стоимость и ответственность до начала работы.</p></div></div></section>;
}
