import type { MetadataRoute } from "next";
import { staticBasePath } from "@/lib/paths";
import { siteContent } from "@/lib/static-content";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteContent.brandName,
    short_name: siteContent.brandName,
    description: siteContent.seoDescription,
    start_url: `${staticBasePath || ""}/`,
    display: "standalone",
    lang: "ru",
    background_color: "#ffffff",
    theme_color: "#15513c",
  };
}
