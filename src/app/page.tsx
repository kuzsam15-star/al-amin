import { CivicHome } from "@/components/civic/CivicHome";
import { getFeaturedSpecialists, siteContent } from "@/lib/static-content";

export default function HomePage() {
  return <CivicHome content={siteContent} specialists={getFeaturedSpecialists()} />;
}
