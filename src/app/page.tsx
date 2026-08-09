import { CivicHome } from "@/components/civic/CivicHome";
import { loadCivicHomeSpecialists } from "@/lib/civic-home";
import { getSiteContent } from "@/lib/site-content";

// CMS content must be resolved at request time: a build-time Supabase outage must
// never freeze fallback copy into the canonical Home.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [content, specialists] = await Promise.all([
    getSiteContent(),
    loadCivicHomeSpecialists(),
  ]);

  return <CivicHome content={content} specialists={specialists} />;
}
