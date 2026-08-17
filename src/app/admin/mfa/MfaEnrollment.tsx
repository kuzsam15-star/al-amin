"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Setup = { factorId: string; qr: string; secret: string };

export function MfaEnrollment() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Проверяем состояние второго фактора…");
  const [busy, setBusy] = useState(false);

  async function inspect() {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setMessage("Не удалось проверить второй фактор. Повторите позже."); return; }
    const verified = data.totp.find((factor) => factor.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    setMessage(verified ? "Введите одноразовый код из приложения-аутентификатора." : "Настройте приложение-аутентификатор, затем подтвердите код.");
  }

  useEffect(() => { void inspect(); }, []);

  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      for (const factor of listed.data.totp.filter((item) => item.status !== "verified")) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "AL-AMIN privileged access" });
      if (error) throw error;
      setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setVerifiedFactorId(null);
      setMessage("Отсканируйте QR-код и введите шестизначный код.");
    } catch {
      setMessage("Не удалось начать безопасную настройку MFA. Повторите позже.");
    } finally { setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const factorId = setup?.factorId ?? verifiedFactorId;
    if (!factorId || !/^\d{6}$/u.test(code)) { setMessage("Введите шестизначный код."); return; }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      router.replace("/admin");
      router.refresh();
    } catch {
      setMessage("Код не подтверждён. Проверьте время на устройстве и попробуйте снова.");
    } finally { setBusy(false); }
  }

  return <div className="card">
    {!verifiedFactorId && !setup ? <button className="button" type="button" disabled={busy} onClick={begin}>Настроить второй фактор</button> : null}
    {setup ? <div className="mfa-setup"><Image src={setup.qr} width={240} height={240} unoptimized alt="QR-код настройки второго фактора" /><p className="meta">Если QR-код недоступен, введите ключ вручную: <code>{setup.secret}</code></p></div> : null}
    {(verifiedFactorId || setup) ? <form onSubmit={verify}><label>Одноразовый код<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} /></label><button className="button" disabled={busy}>Подтвердить</button></form> : null}
    {message ? <p className="meta" role="status">{message}</p> : null}
  </div>;
}
