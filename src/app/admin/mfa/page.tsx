import { unstable_noStore } from "next/cache";
import { requirePrivilegedIdentity } from "@/lib/auth";
import { MfaEnrollment } from "./MfaEnrollment";

export const dynamic = "force-dynamic";

export default async function AdminMfaPage() {
  unstable_noStore();
  await requirePrivilegedIdentity();
  return <section className="section"><div className="container narrow">
    <div className="eyebrow">Защита привилегированного доступа</div>
    <h1 className="page-title">Подтвердите второй фактор</h1>
    <p className="lead">Панель модерации недоступна без зарегистрированного TOTP-фактора. Коды и секрет настройки остаются только в вашем Auth-сеансе и браузере.</p>
    <MfaEnrollment />
  </div></section>;
}
