import type { Metadata, Viewport } from "next";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/onest/500.css";
import "@fontsource/onest/600.css";
import "./static-site.css";
import { AdaptiveSiteShell } from "@/components/civic/AdaptiveSiteShell";
import { siteContent } from "@/lib/static-content";

const metadataOrigin = process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined;

export const metadata: Metadata = {
  metadataBase: metadataOrigin,
  title: { default: siteContent.seoTitle, template: `%s · ${siteContent.brandName}` },
  description: siteContent.seoDescription,
  applicationName: siteContent.brandName,
  openGraph: {
    title: siteContent.seoTitle,
    description: siteContent.seoDescription,
    type: "website",
    locale: "ru_RU",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><AdaptiveSiteShell brandName={siteContent.brandName}>{children}</AdaptiveSiteShell></body></html>;
}
