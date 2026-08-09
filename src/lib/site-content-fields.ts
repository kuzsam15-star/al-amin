import type { SiteContent } from "@/lib/brand";

export type SiteContentField = keyof SiteContent;

type SiteContentFieldRule = {
  label: string;
  location: string;
  minLength: number;
  maxLength: number;
  recommendation?: string;
};

export const siteContentFieldConfig: Record<SiteContentField, SiteContentFieldRule> = {
  brand_name: {
    label: "Название бренда",
    location: "Логотип, footer и метаданные сайта",
    minLength: 2,
    maxLength: 40,
  },
  tagline: {
    label: "Надзаголовок Civic Home",
    location: "Первый экран, над главным заголовком",
    minLength: 2,
    maxLength: 72,
    recommendation: "Одна короткая строка.",
  },
  hero_title: {
    label: "Главный заголовок Civic Home",
    location: "Первый экран главной страницы",
    minLength: 2,
    maxLength: 96,
    recommendation: "Рекомендуется не более трёх строк на desktop.",
  },
  hero_text: {
    label: "Описание Civic Home",
    location: "Первый экран, под главным заголовком",
    minLength: 2,
    maxLength: 360,
    recommendation: "Один краткий абзац без HTML.",
  },
  contact_email: {
    label: "Публичный email",
    location: "Поддержка и запросы по персональным данным",
    minLength: 3,
    maxLength: 320,
  },
  seo_title: {
    label: "SEO-заголовок",
    location: "Заголовок вкладки и Open Graph",
    minLength: 2,
    maxLength: 160,
  },
  seo_description: {
    label: "SEO-описание",
    location: "Описание страницы для поисковых систем и Open Graph",
    minLength: 2,
    maxLength: 320,
  },
  about_text: {
    label: "Текст страницы «О проекте»",
    location: "Страница /about",
    minLength: 2,
    maxLength: 5000,
  },
  rules_intro: {
    label: "Вводный текст правил",
    location: "Страница /rules",
    minLength: 2,
    maxLength: 5000,
  },
  privacy_text: {
    label: "Текст о конфиденциальности",
    location: "Страница /privacy",
    minLength: 2,
    maxLength: 5000,
  },
};

export const siteContentFields = Object.keys(siteContentFieldConfig) as SiteContentField[];
export const civicHomeContentFields = ["brand_name", "tagline", "hero_title", "hero_text"] as const;

export function validateSiteContent(values: Record<SiteContentField, string>) {
  const invalidField = siteContentFields.find((field) => {
    const value = values[field];
    const rule = siteContentFieldConfig[field];
    return value.length < rule.minLength || value.length > rule.maxLength;
  });
  if (invalidField) return { valid: false as const, field: invalidField };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) {
    return { valid: false as const, field: "contact_email" as const };
  }
  return { valid: true as const };
}
