import { ArrowRight, BadgeCheck, FileCheck2, ShieldCheck } from "lucide-react";
import { AdminPublicActionsGate } from "@/components/AdminPublicActions";
import { TrustBadges } from "@/components/TrustBadges";
import type { PublicVerificationFacts, Review, Specialist, TrustBadge } from "@/lib/types";
import { displayCity, experienceText, profileMeta } from "@/lib/profile-presentation";
import { hasPublicVerification } from "@/lib/public-verification-facts";
import type { WorkOffer } from "@/lib/specialist-contract.mjs";
import styles from "./civic-public-profile.module.css";

type CivicPublicProfileProps = {
  item: Specialist;
  reviews: Review[];
  badges: TrustBadge[];
  additionalCategories: string[];
  verificationFacts: PublicVerificationFacts | null;
  avatarUrl: string | null;
};

const modeLabels: Record<string, string> = {
  online: "Онлайн",
  offline: "Очно",
  both: "Онлайн и очно",
};

function TrustMark() {
  return <span className={styles.trustMark}><ShieldCheck aria-hidden="true" size={18} strokeWidth={2.2} />Проверено AL-AMIN</span>;
}

function SafeContactAction({ compact = false }: { compact?: boolean }) {
  const noteId = compact ? "safe-contact-note-compact" : "safe-contact-note";
  return <div className={compact ? styles.safeActionCompact : styles.safeAction}>
    <button className={styles.primaryCta} type="button" disabled aria-describedby={noteId}>Обратиться через AL-AMIN</button>
    <p id={noteId}>Безопасные обращения внутри платформы появятся на следующем этапе.</p>
  </div>;
}

function verificationClaims(facts: PublicVerificationFacts) {
  return [
    facts.identity_checked ? "Личность специалиста" : null,
    facts.education_checked ? "Сведения об образовании" : null,
    facts.experience_checked ? "Заявленный профессиональный опыт" : null,
    facts.qualifications_checked ? "Сведения о квалификации" : null,
    facts.references_checked ? "Предоставленные рекомендации" : null,
  ].filter((claim): claim is string => Boolean(claim));
}

function VerificationSummary({ facts }: { facts: PublicVerificationFacts }) {
  const checkedDate = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(facts.checked_at));
  return <article className={styles.verificationCard}>
    <div className={styles.verificationHeading}><ShieldCheck aria-hidden="true" size={24} /><div><span>Trust Proof</span><h3>Проверено AL-AMIN</h3></div></div>
    <p>Ниже указан фактический объём проверки этого профиля.</p>
    <dl>
      <div><dt>Дата проверки</dt><dd>{checkedDate}</dd></div>
      {facts.sources_checked > 0 ? <div><dt>Проверено источников</dt><dd>{facts.sources_checked}</dd></div> : null}
    </dl>
  </article>;
}

function ReviewCard({ review }: { review: Review }) {
  return <article className={styles.reviewCard}>
    <div><ShieldCheck aria-hidden="true" size={16} /><strong>Опубликованный отзыв</strong></div>
    <p>{review.body}</p>
    <span>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(review.created_at))} · {review.would_hire_again ? "Обратился(лась) бы снова" : "Не обратился(лась) бы снова"}</span>
  </article>;
}

function offerPrice(offer: WorkOffer) {
  if (offer.price === null || offer.price === undefined || !offer.currency) return null;
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: offer.currency, maximumFractionDigits: 2 }).format(offer.price);
  } catch {
    return `${offer.price} ${offer.currency}`;
  }
}

function offerDetails(offer: WorkOffer) {
  return [
    offer.mode ? (modeLabels[offer.mode] ?? offer.mode) : null,
    offer.duration_minutes ? `${offer.duration_minutes} мин.` : null,
    offerPrice(offer),
  ].filter(Boolean).join(" · ");
}

export function CivicPublicProfile({ item, reviews, badges, additionalCategories, verificationFacts, avatarUrl }: CivicPublicProfileProps) {
  const location = profileMeta({
    country: item.country,
    city: displayCity(item.city),
    serviceMode: modeLabels[item.service_mode] ?? item.service_mode,
  });
  const experience = experienceText(item.experience_years);
  const verified = hasPublicVerification(verificationFacts);
  const visibleBadges = badges.filter((badge) => badge.code !== "verified");
  const claims = verificationFacts ? verificationClaims(verificationFacts) : [];
  const hasExperienceSection = Boolean(experience || visibleBadges.length || verificationFacts?.education_checked || verificationFacts?.experience_checked || verificationFacts?.qualifications_checked);

  return <div className={styles.civicPublicProfile}>
    <section className={styles.hero} aria-labelledby="specialist-name">
      <div className={styles.heroInner}>
        <div className={styles.portraitFrame}>
          {avatarUrl ? <img src={avatarUrl} alt={`Фотография ${item.full_name}`} /> : <div className={styles.avatarFallback}>{item.full_name.split(" ").map((name) => name[0]).join("").slice(0, 2)}</div>}
        </div>
        <div className={styles.heroContent}>
          <AdminPublicActionsGate profileId={item.id} returnTo={`/specialists/${item.slug}`} />
          <div className={styles.identityRow}><h1 id="specialist-name">{item.full_name}</h1><TrustBadges badges={visibleBadges} /></div>
          {item.specialization?.trim() ? <p className={styles.specialization}>{item.specialization.trim()}</p> : null}
          <p className={styles.location}>{location || "Специалист AL-AMIN"}</p>
          {verified ? <TrustMark /> : null}
          {item.profile_summary ? <p className={styles.introduction}>{item.profile_summary}</p> : null}
          <div className={styles.indicators} aria-label="Ключевые сведения">
            {experience ? <div><strong>{experience}</strong><span>{verificationFacts?.experience_checked ? "проверенный опыт" : "заявленный опыт"}</span></div> : null}
            <div><strong>{item.work_offers.length}</strong><span>форматов работы</span></div>
            <div><strong>{reviews.length}</strong><span>опубликованных отзывов</span></div>
          </div>
          <SafeContactAction />
        </div>
      </div>
    </section>

    {verificationFacts && verified ? <section className={styles.trustSection} aria-labelledby="trust-heading">
      <div className={styles.sectionInner}>
        <div className={styles.trustIntro}>
          <div><p>Проверка AL-AMIN</p><h2 id="trust-heading">Доверие — это проверяемые факты</h2><span>Показываем только фактически зафиксированный объём проверки.</span></div>
          <a href="/verification">Как устроена методика <ArrowRight aria-hidden="true" size={16} /></a>
        </div>
        <div className={styles.trustGrid}>
          <VerificationSummary facts={verificationFacts} />
          <article className={styles.scopeCard}>
            <h3>Объём проверки</h3>
            <ul>{claims.map((claim) => <li key={claim}>{claim}</li>)}</ul>
          </article>
        </div>
      </div>
    </section> : null}

    <section className={styles.profileContent}>
      <div className={styles.contentInner}>
        <main className={styles.mainColumn}>
          {item.full_description ? <section className={styles.contentSection} aria-labelledby="about-specialist">
            <p className={styles.sectionEyebrow}>Личность и подход</p>
            <h2 id="about-specialist">О специалисте</h2>
            <p className={styles.prose}>{item.full_description}</p>
            {additionalCategories.length ? <div className={styles.categoryTags} aria-label="Дополнительные категории">{additionalCategories.map((name) => <span key={name}>{name}</span>)}</div> : null}
          </section> : null}

          {item.help_topics.length ? <section className={styles.contentSection} aria-labelledby="help-heading">
            <h2 id="help-heading">С чем помогает</h2>
            <div className={styles.helpGrid}>{item.help_topics.map((topic, index) => <article key={`${topic.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{topic.title}</h3>{topic.description ? <p>{topic.description}</p> : null}</article>)}</div>
          </section> : null}

          {item.work_offers.length ? <section className={styles.contentSection} aria-labelledby="services-heading">
            <h2 id="services-heading">Форматы работы</h2>
            <div className={styles.serviceList}>{item.work_offers.map((offer, index) => <div key={`${offer.title}-${index}`}><strong>{offer.title}</strong><span>{offerDetails(offer)}</span></div>)}</div>
          </section> : null}

          {hasExperienceSection ? <section className={styles.contentSection} aria-labelledby="experience-heading">
            <h2 id="experience-heading">Опыт и квалификация</h2>
            <div className={styles.evidenceGrid}>
              {experience ? <article className={verificationFacts?.experience_checked ? styles.verifiedEvidence : styles.claimedEvidence}><FileCheck2 aria-hidden="true" size={24} /><div><h3>{experience} профессиональной практики</h3><p>{verificationFacts?.experience_checked ? "Заявленный опыт проверен командой AL-AMIN." : "Опыт указан самим специалистом."}</p><span>{verificationFacts?.experience_checked ? "Проверенный факт" : "Сведения специалиста"}</span></div></article> : null}
              {verificationFacts?.education_checked ? <article className={styles.verifiedEvidence}><FileCheck2 aria-hidden="true" size={24} /><div><h3>Сведения об образовании проверены</h3><p>Команда AL-AMIN зафиксировала результат проверки.</p><span>Проверенный факт</span></div></article> : null}
              {verificationFacts?.qualifications_checked ? <article className={styles.verifiedEvidence}><FileCheck2 aria-hidden="true" size={24} /><div><h3>Сведения о квалификации проверены</h3><p>Команда AL-AMIN зафиксировала результат проверки.</p><span>Проверенный факт</span></div></article> : null}
              {visibleBadges.map((badge) => <article className={styles.achievementEvidence} key={badge.code}><BadgeCheck aria-hidden="true" size={24} /><div><h3>{badge.title}</h3><p>{badge.description}</p><span>Назначенный платформой значок</span></div></article>)}
            </div>
          </section> : null}

          {reviews.length ? <section className={styles.contentSection} aria-labelledby="reviews-heading">
            <div className={styles.reviewsHeading}><div><p className={styles.sectionEyebrow}>Опыт взаимодействия</p><h2 id="reviews-heading">Отзывы</h2></div><span>{reviews.length} опубликовано</span></div>
            <div className={styles.reviewsList}>{reviews.map((review) => <ReviewCard review={review} key={review.id} />)}</div>
          </section> : null}
        </main>

        <aside className={styles.contactRail}>
          <article className={styles.contactCard}>
            <p>Безопасный следующий шаг</p>
            <h2>Обращение через платформу</h2>
            <span>Личные контакты специалиста не публикуются. Встроенные обращения будут подключены отдельным этапом.</span>
            <SafeContactAction compact />
            {verified ? <TrustMark /> : null}
          </article>
          <div className={styles.safetyNotice}><ShieldCheck aria-hidden="true" size={20} /><p>Проверка профиля не отменяет вашей собственной осмотрительности.</p></div>
        </aside>
      </div>
    </section>
  </div>;
}
