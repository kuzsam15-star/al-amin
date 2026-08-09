import { createPublicClient } from "@/lib/supabase/public";
import { defaultSiteContent, type SiteContent } from "@/lib/brand";

export async function getSiteContent(): Promise<SiteContent> {
  const supabase = createPublicClient();
  if (!supabase) return defaultSiteContent;
  const { data } = await supabase.from("site_content").select("brand_name,tagline,hero_title,hero_text,contact_email,about_text,rules_intro,privacy_text,seo_title,seo_description").eq("id", true).maybeSingle();
  return { ...defaultSiteContent, ...(data ?? {}) };
}
