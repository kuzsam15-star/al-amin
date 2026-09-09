/* eslint-disable @next/next/no-img-element */
import { ArrowRight, FileCheck2, ShieldCheck } from "lucide-react";
import { DirectContacts } from "@/components/DirectContacts";
import { assetPath } from "@/lib/paths";
import type { StaticSpecialist, WorkOffer } from "@/lib/static-content";
import styles from "./civic-public-profile.module.css";

const modeLabels = { online: "Онлайн", offline: "Очно", both: "Онлайн и очно" } as const;

function TrustMark({ recommendedOnly = false }: { recommendedOnly?: boolean }) {
  return <span className={styles.trustMark}><ShieldCheck aria-hidden="true" size={18} />{recommendedOnly ? "Рекомендован AL-AMIN" : "Проверено AL-AMIN"}</span>;
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date);
}

function offerPrice(offer: WorkOffer) {
  if (offer.price == null || !offer.currency) return null;
  try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency: offer.currency, maximumFractionDigits: 2 }).format(offer.price); }
  catch { return `${offer.price} ${offer.currency}`; }
}

function offerDetails(offer: WorkOffer) {
  return [modeLabels[offer.mode], offer.durationMinutes ? `${offer.durationMinutes} мин.` : null, offerPrice(offer)].filter(Boolean).join(" · ");
}

export function CivicPublicProfile({ item }: { item: StaticSpecialist }) {
  const verified = item.trust.recommendedByAlAmin && Boolean(item.trust.verificationDate || item.trust.verificationSummary || item.trust.verifiedFacts.length);
  const hasContacts = Object.values(item.contacts).some(Boolean);
  const checkedDate = formatDate(item.trust.verificationDate);
  return <div className={styles.civicPublicProfile}>
    <section className={styles.hero} aria-labelledby="specialist-name"><div className={styles.heroInner}>
      <div className={styles.portraitFrame}><img src={assetPath(item.photo.src)} alt={item.photo.alt} /></div>
      <div className={styles.heroContent}>
        <div className={styles.identityRow}><h1 id="specialist-name">{item.fullName}</h1></div>
        <p className={styles.specialization}>{item.specialization}</p>
        <p className={styles.location}>{item.city} · {item.country} · {modeLabels[item.workMode]}</p>
        {item.trust.recommendedByAlAmin ? <TrustMark recommendedOnly={!verified} /> : null}
        <p className={styles.introduction}>{item.profileSummary}</p>
        <div className={styles.indicators} aria-label="Ключевые сведения">
          {item.experienceYears != null ? <div><strong>{item.experienceYears} лет</strong><span>заявленного опыта</span></div> : null}
          {item.workOffers.length ? <div><strong>{item.workOffers.length}</strong><span>форматов работы</span></div> : null}
          <div><strong>{item.categories.length}</strong><span>направлений</span></div>
        </div>
        {hasContacts ? <DirectContacts contacts={item.contacts} compact /> : null}
      </div>
    </div></section>

    {verified ? <section className={styles.trustSection} aria-labelledby="trust-heading"><div className={styles.sectionInner}>
      <div className={styles.trustIntro}><div><p>Проверка AL-AMIN</p><h2 id="trust-heading">Доверие — это конкретные факты</h2><span>Показываем только фактически зафиксированный объём проверки.</span></div><a href="/verification">Как устроен отбор <ArrowRight aria-hidden="true" size={16} /></a></div>
      <div className={styles.trustGrid}>
        <article className={styles.verificationCard}><div className={styles.verificationHeading}><ShieldCheck aria-hidden="true" size={24} /><div><span>Trust Proof</span><h3>Проверено AL-AMIN</h3></div></div>{item.trust.verificationSummary ? <p>{item.trust.verificationSummary}</p> : null}{checkedDate ? <dl><div><dt>Дата проверки</dt><dd>{checkedDate}</dd></div></dl> : null}</article>
        {item.trust.verifiedFacts.length ? <article className={styles.scopeCard}><h3>Что проверено</h3><ul>{item.trust.verifiedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></article> : null}
      </div>
    </div></section> : null}

    <section className={styles.profileContent}><div className={`${styles.contentInner} ${hasContacts ? "" : styles.singleColumn}`}>
      <main className={styles.mainColumn}>
        <section className={styles.contentSection} aria-labelledby="about-specialist"><p className={styles.sectionEyebrow}>Личность и подход</p><h2 id="about-specialist">О специалисте</h2><p className={styles.prose}>{item.about}</p><div className={styles.categoryTags}>{item.categories.map((category) => <span key={category}>{category}</span>)}</div></section>
        {item.helpTopics.length ? <section className={styles.contentSection} aria-labelledby="help-heading"><h2 id="help-heading">С чем помогает</h2><div className={styles.helpGrid}>{item.helpTopics.map((topic, index) => <article key={topic.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{topic.title}</h3>{topic.description ? <p>{topic.description}</p> : null}</article>)}</div></section> : null}
        {item.workOffers.length ? <section className={styles.contentSection} aria-labelledby="services-heading"><h2 id="services-heading">Форматы работы</h2><div className={styles.serviceList}>{item.workOffers.map((offer) => <div key={offer.title}><strong>{offer.title}</strong><span>{offerDetails(offer)}</span></div>)}</div></section> : null}
        {item.experienceYears != null ? <section className={styles.contentSection} aria-labelledby="experience-heading"><h2 id="experience-heading">Опыт</h2><div className={styles.evidenceGrid}><article className={styles.claimedEvidence}><FileCheck2 aria-hidden="true" size={24} /><div><h3>{item.experienceYears} лет профессиональной практики</h3><p>{item.trust.verifiedFacts.some((fact) => /опыт/iu.test(fact)) ? "Сведения об опыте входят в зафиксированный объём проверки." : "Опыт указан специалистом."}</p><span>{item.trust.verifiedFacts.some((fact) => /опыт/iu.test(fact)) ? "Проверенный факт" : "Сведения специалиста"}</span></div></article></div></section> : null}
        {item.portfolio.length ? <section className={styles.contentSection} aria-labelledby="portfolio-heading"><h2 id="portfolio-heading">Кейсы и портфолио</h2><div className={styles.portfolioGrid}>{item.portfolio.map((entry) => <article key={entry.title}><h3>{entry.title}</h3>{entry.description ? <p>{entry.description}</p> : null}{entry.url ? <a href={entry.url} target="_blank" rel="noopener noreferrer">Открыть материал <ArrowRight aria-hidden="true" size={16} /></a> : null}</article>)}</div></section> : null}
      </main>
      {hasContacts ? <aside className={styles.contactRail}><article className={styles.contactCard}><p>Связаться напрямую</p><h2>Выберите удобный способ</h2><span>AL-AMIN не принимает оплату и не является стороной ваших договорённостей.</span><DirectContacts contacts={item.contacts} />{item.trust.recommendedByAlAmin ? <TrustMark recommendedOnly={!verified} /> : null}</article><div className={styles.safetyNotice}><ShieldCheck aria-hidden="true" size={20} /><p>Проверка профиля не отменяет собственной осмотрительности.</p></div></aside> : null}
    </div></section>
  </div>;
}
