"use client";

import { BadgeCheck, FileCheck2, HandHeart, HelpCircle, Star, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TrustBadge } from "@/lib/types";

const icons = {
  "badge-check": BadgeCheck,
  "file-check": FileCheck2,
  "hand-heart": HandHeart,
  star: Star,
  zap: Zap,
} as const;

export function TrustBadgeIcon({ icon, size = 17 }: { icon: string; size?: number }) {
  const Icon = icons[icon as keyof typeof icons] ?? HelpCircle;
  return <Icon aria-hidden="true" size={size} strokeWidth={2.25} />;
}

export function TrustBadges({ badges }: { badges: TrustBadge[] }) {
  const [openedCode, setOpenedCode] = useState<string | null>(null);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpenedCode(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedCode(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!badges.length) return null;

  return <span className="trust-badges" ref={root} aria-label="Значки доверия">
    {badges.map((badge) => {
      const isOpen = openedCode === badge.code;
      const tooltipId = `trust-badge-${badge.code}`;
      return <span className="trust-badge-wrap" key={badge.code}>
        <button
          className={`trust-badge-icon trust-badge-${badge.code}`}
          type="button"
          aria-label={`${badge.title}. Подробнее`}
          aria-expanded={isOpen}
          aria-describedby={isOpen ? tooltipId : undefined}
          title={`${badge.title}: ${badge.description}`}
          onClick={() => setOpenedCode(isOpen ? null : badge.code)}
        ><TrustBadgeIcon icon={badge.icon} /></button>
        {isOpen ? <span className="trust-badge-tooltip" id={tooltipId} role="tooltip"><strong>{badge.title}</strong><span>{badge.description}</span></span> : null}
      </span>;
    })}
  </span>;
}
