import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CivicPublicProfile } from "@/components/civic/CivicPublicProfile";
import { absoluteUrl } from "@/lib/paths";
import { getPublishedSpecialists, getSpecialistBySlug, siteContent } from "@/lib/static-content";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = getPublishedSpecialists().map((item) => ({ slug: item.slug }));
  // Next static export requires at least one build-time parameter. This
  // sentinel renders the normal 404 and is never linked or indexed.
  return params.length ? params : [{ slug: "__empty__" }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = getSpecialistBySlug(slug);
  if (!item) return {};
  const canonical = absoluteUrl(`/specialists/${item.slug}/`);
  return {
    title: item.fullName,
    description: item.profileSummary,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: `${item.fullName} · ${siteContent.brandName}`,
      description: item.profileSummary,
      type: "profile",
      images: absoluteUrl(item.photo.src) ? [{ url: absoluteUrl(item.photo.src)!, alt: item.photo.alt }] : undefined,
    },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = getSpecialistBySlug(slug);
  if (!item) notFound();
  return <CivicPublicProfile item={item} />;
}
