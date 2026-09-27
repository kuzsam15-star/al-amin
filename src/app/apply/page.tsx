import type { Metadata } from "next";
import { siteContent } from "@/lib/static-content";
import { CatalogSubmissionForm } from "./CatalogSubmissionForm";

export const metadata: Metadata = {
  title: "Стать специалистом",
  description: "Подайте заявку на добавление профиля специалиста в каталог AL-AMIN.",
};

export default function ApplyPage() {
  return <div className="page-container"><CatalogSubmissionForm ownerContacts={{
    email: siteContent.contactEmail,
    telegram: siteContent.contactTelegram,
    phone: siteContent.contactPhone,
    website: siteContent.contactWebsite,
  }} /></div>;
}
