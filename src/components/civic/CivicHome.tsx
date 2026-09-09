"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import styles from "@/app/design-preview/design-preview.module.css";
import { SpecialistCard } from "@/components/SpecialistCard";
import { CivicFooter } from "@/components/civic/CivicFooter";
import { assetPath } from "@/lib/paths";
import type { StaticSiteContent, StaticSpecialist } from "@/lib/static-content";

type CivicHomeProps = { content: StaticSiteContent; specialists: StaticSpecialist[]; categories: string[] };
type CardPosition = "farLeft" | "left" | "center" | "right" | "farRight" | "hidden";

function wrap(index: number, length: number) {
  return (index + length) % length;
}

function cardPosition(index: number, active: number, length: number): CardPosition {
  let offset = wrap(index - active, length);
  if (offset > length / 2) offset -= length;
  if (offset === -2) return "farLeft";
  if (offset === -1) return "left";
  if (offset === 0) return "center";
  if (offset === 1) return "right";
  if (offset === 2) return "farRight";
  return "hidden";
}

function TrustMark() {
  return <span className={styles.trustMark}><ShieldCheck aria-hidden="true" size={16} strokeWidth={2.1} />Проверено AL-AMIN</span>;
}

function CoverCard({ specialist, position, onCenter }: { specialist: StaticSpecialist; position: CardPosition; onCenter: () => void }) {
  const isCenter = position === "center";
  const isInteractiveSide = position === "left" || position === "right";
  const visible = position !== "hidden";
  const content = <>
    <img className={styles.portrait} src={assetPath(specialist.photo.src)} alt={specialist.photo.alt} width="152" height="152" draggable={false} />
    <span className={styles.cardName}>{specialist.fullName}</span>
    <span className={styles.cardSpecialization}>{specialist.specialization}</span>
    <span className={styles.cardMeta}>{[specialist.city, specialist.workMode === "online" ? "Онлайн" : specialist.workMode === "offline" ? "Очно" : "Онлайн и очно"].filter(Boolean).join(" · ")}</span>
    {specialist.trust.recommendedByAlAmin ? <TrustMark /> : null}
  </>;

  return isCenter ? <Link className={`${styles.specialistCard} ${styles[position]}`} href={`/specialists/${specialist.slug}`} aria-label={`Открыть профиль: ${specialist.fullName}`}>{content}</Link> :
    <button className={`${styles.specialistCard} ${styles[position]}`} type="button" aria-hidden={!visible} tabIndex={isInteractiveSide ? 0 : -1} onClick={isInteractiveSide ? onCenter : undefined} aria-label={isInteractiveSide ? `Показать в центре: ${specialist.fullName}` : undefined}>{content}</button>;
}

function PopulatedCoverFlow({ specialists }: { specialists: StaticSpecialist[] }) {
  const [active, setActive] = useState(0);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const move = useCallback((delta: number) => setActive((current) => wrap(current + delta, specialists.length)), [specialists.length]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragStart.current = event.clientX;
    dragged.current = false;
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    if (Math.abs(event.clientX - dragStart.current) > 8) {
      dragged.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    const distance = event.clientX - dragStart.current;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragged.current && Math.abs(distance) >= 42) move(distance < 0 ? 1 : -1);
    dragged.current = false;
  }

  return <div className={styles.carousel} role="region" aria-roledescription="карусель" aria-label="Рекомендованные специалисты" tabIndex={0} onKeyDown={(event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
  }}>
    <div className={styles.carouselStage} onDragStart={(event) => event.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { dragStart.current = null; }}>
      {specialists.map((specialist, index) => <CoverCard key={specialist.id} specialist={specialist} position={cardPosition(index, active, specialists.length)} onCenter={() => setActive(index)} />)}
    </div>
    {specialists.length > 1 ? <div className={styles.carouselControls}>
      <button type="button" onClick={() => move(-1)} aria-label="Предыдущий специалист"><ChevronLeft aria-hidden="true" size={20} /></button>
      <button type="button" onClick={() => move(1)} aria-label="Следующий специалист"><ChevronRight aria-hidden="true" size={20} /></button>
    </div> : null}
    <p className={styles.srOnly} aria-live="polite">Сейчас в центре: {specialists[active].fullName}</p>
  </div>;
}

function SpecialistCoverFlow({ specialists }: { specialists: StaticSpecialist[] }) {
  if (!specialists.length) return <div className={styles.emptyShowcase}><ShieldCheck aria-hidden="true" size={32} /><h2>Каталог формируется</h2><p>Здесь появятся только реальные специалисты, добавленные и рекомендованные редактором AL-AMIN.</p><Link href="/specialists">Открыть каталог</Link></div>;
  return <PopulatedCoverFlow specialists={specialists} />;
}

export function CivicHome({ content, specialists, categories }: CivicHomeProps) {
  return <div className={`design-preview-root ${styles.previewRoot}`}>
    <header className={styles.header}><div className={styles.headerInner}>
      <Link className={styles.logo} href="/" aria-label={`${content.brandName} — главная`}><ShieldCheck aria-hidden="true" size={24} /><span>{content.brandName}</span></Link>
      <nav className={styles.previewNav} aria-label="Основная навигация"><Link className={styles.desktopNavLink} href="/specialists">Специалисты</Link><Link className={styles.desktopNavLink} href="/verification">Как мы отбираем</Link><Link className={styles.loginLink} href="/about">О проекте</Link></nav>
    </div></header>
    <main>
      <section className={styles.heroSection}><div className={styles.heroInner}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>{content.tagline}</p><h1>{content.heroTitle}</h1><p className={styles.heroText}>{content.heroText}</p>
          <div className={styles.heroActions}><Link className={styles.primaryButton} href="/specialists">Найти специалиста</Link><Link className={styles.secondaryButton} href="/verification">Как мы отбираем</Link></div>
          <p className={styles.assurance}>Без регистрации · Прямые контакты<span className={styles.assuranceDetail}> · Честные границы проверки</span></p>
        </div>
        <SpecialistCoverFlow specialists={specialists} />
      </div></section>

      <section className={styles.valueSection}><div className={styles.sectionInner}><p className={styles.sectionEyebrow}>Почему AL-AMIN</p><h2>Человек, контекст, спокойное решение</h2><div className={styles.valueGrid}>
        <article><UserRoundCheck aria-hidden="true" /><h3>Живой профиль</h3><p>Не объявление, а понятная история человека, его опыта и подхода.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Проверка без громких обещаний</h3><p>Показываем только реально подтверждённые сведения и дату проверки.</p></article>
        <article><Search aria-hidden="true" /><h3>Прямой выбор</h3><p>Сравните контекст и свяжитесь со специалистом удобным способом.</p></article>
      </div></div></section>

      {categories.length ? <section className={styles.categoriesSection}><div className={styles.sectionInner}><div className={styles.sectionHeading}><div><p className={styles.sectionEyebrow}>Направления</p><h2>Найдите нужную экспертизу</h2></div><Link href="/specialists">Весь каталог →</Link></div><div className={styles.categoryList}>{categories.map((category) => <Link key={category} href="/specialists">{category}</Link>)}</div></div></section> : null}

      {specialists.length ? <section className={styles.selectionSection}><div className={styles.sectionInner}><div className={styles.sectionHeading}><div><p className={styles.sectionEyebrow}>Подборка</p><h2>Рекомендованные специалисты</h2></div><Link href="/specialists">Смотреть всех →</Link></div><div className="specialist-grid">{specialists.slice(0, 3).map((item) => <SpecialistCard item={item} key={item.id} />)}</div></div></section> : null}

      <section className={styles.contactSection}><div className={styles.contactInner}><p className={styles.sectionEyebrow}>Прямой контакт</p><h2>Вы выбираете специалиста и договариваетесь напрямую</h2><p>AL-AMIN не принимает оплату и не становится стороной сделки. Проверка помогает принять решение, но не заменяет вашу осмотрительность.</p><Link className={styles.primaryButton} href="/specialists">Открыть каталог</Link></div></section>
    </main>
    <CivicFooter brandName={content.brandName} />
  </div>;
}
