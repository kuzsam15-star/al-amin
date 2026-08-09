import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/onest/500.css";
import "@fontsource/onest/600.css";
import "./globals.css";
import "./additions.css";
import "./civic.css";
import { AdaptiveSiteShell } from "@/components/civic/AdaptiveSiteShell";
import { getSiteContent } from "@/lib/site-content";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getSiteContent();
  return {
    title: content.seo_title,
    description: content.seo_description,
    applicationName: content.brand_name,
    openGraph: { title: content.seo_title, description: content.seo_description, type: "website", locale: "ru_RU" },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const content = await getSiteContent();
  return <html lang="ru"><body><AdaptiveSiteShell brandName={content.brand_name}>{children}</AdaptiveSiteShell></body></html>;
}
