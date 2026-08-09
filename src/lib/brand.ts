export type SiteContent = {
  brand_name: string; tagline: string; hero_title: string; hero_text: string; contact_email: string;
  about_text: string; rules_intro: string; privacy_text: string; seo_title: string; seo_description: string;
};

export const defaultSiteContent: SiteContent = {
  brand_name: process.env.NEXT_PUBLIC_BRAND_NAME || "AL-AMIN", tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE || "Найдите специалиста, которому можно доверять.",
  hero_title: "Найдите специалиста, которому можно доверять.",
  hero_text: "Бесплатное пространство, где мусульмане находят специалистов и выстраивают сотрудничество на основе ответственности и доверия.",
  contact_email: process.env.EMAIL_REPLY_TO || "al-amin@ailvi.ru",
  about_text: "Мы помогаем мусульманам находить друг друга, укреплять экономические связи внутри Уммы и создавать культуру, где честность ценится не меньше профессионализма.",
  rules_intro: "Платформа знакомит людей и фиксирует прохождение процедуры проверки. Платформа не принимает оплату за услуги и не выступает стороной сделки.",
  privacy_text: "Мы используем данные анкеты только для рассмотрения кандидатуры, связи с заявителем и последующего ведения профиля при одобрении.",
  seo_title: "AL-AMIN — найдите специалиста, которому можно доверять", seo_description: "AL-AMIN — каталог проверенных специалистов.",
};

export const brand = {
  name: defaultSiteContent.brand_name, shortName: process.env.NEXT_PUBLIC_BRAND_SHORT_NAME || defaultSiteContent.brand_name, tagline: defaultSiteContent.tagline,
  senderName: "AL-AMIN", email: defaultSiteContent.contact_email, publicUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
};
