"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import styles from "@/app/design-preview/design-preview.module.css";
import { CivicFooter } from "@/components/civic/CivicFooter";
import type { SiteContent } from "@/lib/brand";
import {
  publicSpecialistCardHref,
  resolvePublicSpecialistCardAction,
  type PublicSpecialistCard,
  type PublicSpecialistCardPosition,
} from "@/lib/public-specialist-card";

type CivicHomeProps = { content: SiteContent; specialists: PublicSpecialistCard[] };
type CardPosition = PublicSpecialistCardPosition;

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
  return (
    <span className={styles.trustMark}>
      <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.1} />
      Проверен AL-AMIN
    </span>
  );
}

function SpecialistCard({ specialist, position, onCenter }: {
  specialist: PublicSpecialistCard;
  position: CardPosition;
  onCenter: () => void;
}) {
  const isVisible = position === "left" || position === "center" || position === "right";
  const isCenter = position === "center";
  const action = resolvePublicSpecialistCardAction(specialist, position);
  const href = action.type === "navigate" || action.type === "catalog"
    ? publicSpecialistCardHref(specialist)
    : undefined;
  const content = (
    <>
      <Image
        className={styles.portrait}
        src={specialist.photo ?? "/design-preview/rustam-karimov.png"}
        alt={specialist.photoAlt}
        width={152}
        height={152}
        sizes="(max-width: 700px) 132px, 152px"
        unoptimized
        draggable={false}
        priority={position === "center"}
      />
      <span className={styles.cardName}>{specialist.name}</span>
      <span className={styles.cardSpecialization}>{specialist.specialization}</span>
      <span className={styles.cardMeta}>{[specialist.location, specialist.workFormat].filter(Boolean).join(" · ") || "Формат уточняется"}</span>
      <TrustMark />
    </>
  );

  const className = `${styles.specialistCard} ${styles[position]}`;
  return (
    <a
      className={className}
      href={href}
      data-specialist-id={specialist.id}
      data-specialist-kind={specialist.isMock ? "mock" : "real"}
      data-profile-url={specialist.profileUrl ?? undefined}
      role={isCenter ? undefined : "button"}
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      aria-label={isCenter
        ? (!specialist.isMock ? `Открыть профиль: ${specialist.name}` : `Открыть каталог — ${specialist.name} показан как пример`)
        : `Показать в центре: ${specialist.name}`}
      onClick={(event) => {
        if (action.type === "navigate" || action.type === "catalog") return;
        event.preventDefault();
        if (action.type === "center") onCenter();
      }}
    >
      {content}
    </a>
  );
}

function SpecialistCoverFlow({ specialists }: { specialists: PublicSpecialistCard[] }) {
  const [active, setActive] = useState(0);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const suppressClickUntil = useRef(0);

  const move = useCallback((delta: number) => {
    setActive((current) => wrap(current + delta, specialists.length));
  }, [specialists.length]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragStart.current = event.clientX;
    dragged.current = false;
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    if (Math.abs(event.clientX - dragStart.current) > 8) {
      dragged.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    const distance = event.clientX - dragStart.current;
    const didDrag = dragged.current;
    dragStart.current = null;
    dragged.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (didDrag) suppressClickUntil.current = Date.now() + 250;
    if (Math.abs(distance) >= 42) move(distance < 0 ? 1 : -1);
  }

  return (
    <div
      className={styles.carousel}
      role="region"
      aria-roledescription="карусель"
      aria-label="Проверенные специалисты"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
      }}
    >
      <div
        className={styles.carouselStage}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerLeave={(event) => {
          if (dragStart.current !== null && (event.buttons & 1) === 1) pointerUp(event);
        }}
        onPointerCancel={() => { dragStart.current = null; }}
        onClickCapture={(event) => {
          if (Date.now() <= suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickUntil.current = 0;
          }
        }}
      >
        {specialists.map((specialist, index) => {
          const position = cardPosition(index, active, specialists.length);
          return (
            <SpecialistCard
              key={specialist.id}
              specialist={specialist}
              position={position}
              onCenter={() => setActive(index)}
            />
          );
        })}
      </div>
      <div className={styles.carouselControls}>
        <button type="button" onClick={() => move(-1)} aria-label="Предыдущий специалист">
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <button type="button" onClick={() => move(1)} aria-label="Следующий специалист">
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>
      <p className={styles.srOnly} aria-live="polite">Сейчас в центре: {specialists[active].name}</p>
    </div>
  );
}

export function CivicHome({ content, specialists }: CivicHomeProps) {
  return (
    <div className={`design-preview-root ${styles.previewRoot}`}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.logo} href="/" aria-label={`${content.brand_name} — главная`}>
            <ShieldCheck aria-hidden="true" size={24} strokeWidth={2.15} />
            <span>{content.brand_name}</span>
          </Link>
          <nav className={styles.previewNav} aria-label="Основная навигация">
            <Link className={styles.desktopNavLink} href="/specialists">Специалисты</Link>
            <Link className={styles.desktopNavLink} href="/verification">Как мы проверяем</Link>
            <Link className={styles.loginLink} href="/login">Войти</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={styles.heroSection}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>{content.tagline}</p>
              <h1>{content.hero_title}</h1>
              <p className={styles.heroText}>
                {content.hero_text}
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryButton} href="/specialists">
                  Найти специалиста
                </Link>
                <Link className={styles.secondaryButton} href="/apply">Стать специалистом</Link>
              </div>
              <p className={styles.assurance}>
                Проверенные профили · Открытая методика<span className={styles.assuranceDetail}> · Безопасное обращение</span>
              </p>
            </div>
            <SpecialistCoverFlow specialists={specialists} />
          </div>
        </section>

      </main>
      <CivicFooter brandName={content.brand_name} />
    </div>
  );
}
