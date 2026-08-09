import type { SiteContent } from "@/lib/brand";
import { siteContentFieldConfig } from "@/lib/site-content-fields";
import { AdminSaveButton } from "@/components/AdminSaveButton";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";

type SiteContentFormProps = {
  content: SiteContent;
  action: (formData: FormData) => Promise<void>;
};

function Hint({ field }: { field: keyof SiteContent }) {
  const rule = siteContentFieldConfig[field];
  return <span className="meta">Где используется: {rule.location}. До {rule.maxLength} символов{rule.recommendation ? ` · ${rule.recommendation}` : ""}</span>;
}

export function SiteContentForm({ content, action }: SiteContentFormProps) {
  const config = siteContentFieldConfig;
  return (
    <form action={action} className="admin-form content-form" noValidate={false}>
      <label>{config.brand_name.label}<input name="brand_name" defaultValue={content.brand_name} minLength={config.brand_name.minLength} maxLength={config.brand_name.maxLength} required/><Hint field="brand_name" /></label>
      <label>{config.tagline.label}<input name="tagline" defaultValue={content.tagline} minLength={config.tagline.minLength} maxLength={config.tagline.maxLength} required/><Hint field="tagline" /></label>
      <label className="content-form-wide">{config.hero_title.label}<AutoResizeTextarea name="hero_title" defaultValue={content.hero_title} minLength={config.hero_title.minLength} maxLength={config.hero_title.maxLength} maxHeight={160} required/><Hint field="hero_title" /></label>
      <label className="content-form-wide">{config.hero_text.label}<AutoResizeTextarea name="hero_text" defaultValue={content.hero_text} minLength={config.hero_text.minLength} maxLength={config.hero_text.maxLength} maxHeight={240} required/><Hint field="hero_text" /></label>
      <label>{config.contact_email.label}<input name="contact_email" type="email" defaultValue={content.contact_email} minLength={config.contact_email.minLength} maxLength={config.contact_email.maxLength} required/><Hint field="contact_email" /></label>
      <label>{config.seo_title.label}<input name="seo_title" defaultValue={content.seo_title} minLength={config.seo_title.minLength} maxLength={config.seo_title.maxLength} required/><Hint field="seo_title" /></label>
      <label className="content-form-wide">{config.seo_description.label}<AutoResizeTextarea name="seo_description" defaultValue={content.seo_description} minLength={config.seo_description.minLength} maxLength={config.seo_description.maxLength} maxHeight={180} required/><Hint field="seo_description" /></label>
      <label className="content-form-wide">{config.about_text.label}<AutoResizeTextarea name="about_text" defaultValue={content.about_text} minLength={config.about_text.minLength} maxLength={config.about_text.maxLength} required/><Hint field="about_text" /></label>
      <label className="content-form-wide">{config.rules_intro.label}<AutoResizeTextarea name="rules_intro" defaultValue={content.rules_intro} minLength={config.rules_intro.minLength} maxLength={config.rules_intro.maxLength} required/><Hint field="rules_intro" /></label>
      <label className="content-form-wide">{config.privacy_text.label}<AutoResizeTextarea name="privacy_text" defaultValue={content.privacy_text} minLength={config.privacy_text.minLength} maxLength={config.privacy_text.maxLength} required/><Hint field="privacy_text" /></label>
      <div className="content-form-wide"><AdminSaveButton>Сохранить тексты</AdminSaveButton></div>
    </form>
  );
}
