import { CheckCircle2, FileSearch, ShieldCheck } from "lucide-react";

const steps = [
  { icon: FileSearch, title: "Проверяем сведения", text: "Модератор сопоставляет данные анкеты, подтверждения опыта и доступные сведения о специалисте." },
  { icon: ShieldCheck, title: "Фиксируем объём проверки", text: "В профиле показываются способ и дата проверки. Статус не означает безусловную гарантию результата работы." },
  { icon: CheckCircle2, title: "Публикуем прозрачный профиль", text: "Посетитель видит услуги, опыт, портфолио, отзывы и подтверждённые платформой признаки доверия." },
];

export default function VerificationPage() {
  return <section className="section"><div className="container narrow prose civic-info-page">
    <div className="eyebrow">Методика AL-AMIN</div>
    <h1 className="page-title">Как проходит проверка специалиста</h1>
    <p className="lead">Проверка помогает увидеть подтверждённые основания доверия, но не заменяет собственную осмотрительность и договорённости между людьми.</p>
    <div className="civic-process-grid">{steps.map(({ icon: Icon, title, text }, index) => <article className="card" key={title}><span className="civic-step-number">0{index + 1}</span><Icon aria-hidden="true" size={24}/><h2>{title}</h2><p>{text}</p></article>)}</div>
    <div className="notice"><strong>Что означает отметка «Проверен AL-AMIN»</strong><p>Она подтверждает прохождение модерации в указанном объёме и на указанную дату. Детали проверки отображаются в публичном профиле.</p></div>
  </div></section>;
}
