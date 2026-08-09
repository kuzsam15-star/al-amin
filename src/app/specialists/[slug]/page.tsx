import { notFound } from "next/navigation";
import { CivicPublicProfile } from "@/components/civic/CivicPublicProfile";
import { profileMediaUrl } from "@/lib/media-paths";
import { PUBLIC_SPECIALIST_SELECT, toPublicSpecialist } from "@/lib/public-specialists";
import { loadPublicTrustBadges } from "@/lib/public-trust-badges";
import { loadPublicVerificationFacts } from "@/lib/public-verification-facts";
import { createPublicClient } from "@/lib/supabase/public";
import { assignedTrustBadges } from "@/lib/trust-badges";
import type { Review } from "@/lib/types";

export const revalidate = 60;

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createPublicClient();
  if (!supabase) return <section className="section"><div className="container notice">Каталог временно недоступен.</div></section>;

  const { data } = await supabase
    .from("published_specialists")
    .select(PUBLIC_SPECIALIST_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  if (!data) notFound();

  const item = toPublicSpecialist(data as Record<string, unknown>);
  const [{ data: reviewsData }, { data: categoryRows }, trustBadges, verificationFacts] = await Promise.all([
    supabase.from("published_reviews").select("id,body,would_hire_again,created_at").eq("specialist_id", item.id).order("created_at", { ascending: false }),
    item.additional_category_ids?.length ? supabase.from("categories").select("id,name").in("id", item.additional_category_ids) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    loadPublicTrustBadges(supabase, [item.id]),
    loadPublicVerificationFacts(supabase, [item.id]),
  ]);

  item.verification_facts = verificationFacts.get(item.id) ?? null;
  return <CivicPublicProfile
    item={item}
    reviews={(reviewsData ?? []) as Review[]}
    badges={assignedTrustBadges(trustBadges.get(item.id))}
    additionalCategories={(categoryRows ?? []).map((category) => category.name)}
    verificationFacts={item.verification_facts}
    avatarUrl={item.avatar_path ? profileMediaUrl(item.avatar_path) : null}
  />;
}
