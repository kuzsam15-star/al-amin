import type { Metadata } from "next";
import { DirectContacts } from "@/components/DirectContacts";
import { siteContent } from "@/lib/static-content";

export const metadata: Metadata = { title: "Контакты", description: "Прямые контакты владельца каталога AL-AMIN." };

export default function ContactsPage() {
  const contacts = {
    email: siteContent.contactEmail,
    telegram: siteContent.contactTelegram || undefined,
    phone: siteContent.contactPhone || undefined,
    website: siteContent.contactWebsite || undefined,
  };

  return <section className="info-page"><div className="page-container narrow">
    <p className="page-eyebrow">AL-AMIN</p>
    <h1>Контакты</h1>
    <p className="page-lead">Свяжитесь с владельцем каталога удобным способом.</p>
    <div className="owner-contacts"><DirectContacts contacts={contacts} /></div>
  </div></section>;
}
