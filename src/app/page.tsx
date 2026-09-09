import { CivicHome } from "@/components/civic/CivicHome";
import { getCategories, getFeaturedSpecialists, siteContent } from "@/lib/static-content";

export default function HomePage() {
  return <CivicHome content={siteContent} specialists={getFeaturedSpecialists()} categories={getCategories().slice(0, 6)} />;
}
