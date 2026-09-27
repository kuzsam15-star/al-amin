import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/paths";
import { getPublishedSpecialists } from "@/lib/static-content";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["/", "/specialists/", "/apply/", "/about/", "/verification/", "/privacy/", "/rules/", "/contacts/"];
  const profiles = getPublishedSpecialists().map((item) => `/specialists/${item.slug}/`);
  return [...routes, ...profiles]
    .map((route) => absoluteUrl(route))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({ url }));
}
