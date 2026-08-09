import Link from "next/link";
import { signIn } from "./actions";
import { sendMagicLink } from "@/app/register/actions";
import { OAuthButtons } from "@/components/OAuthButtons";
import { PasswordField } from "@/components/PasswordField";
import { safeNextPath } from "@/lib/navigation";

function signInErrorMessage(error: string | undefined, destination: string) {
  if (error === "invalid-credentials") return <>
    <span className="login-error-copy">Email или пароль не подошли.</span>
    <span className="login-error-hint">Если у вас ещё нет аккаунта — <Link className="login-error-register-link" href={`/register?next=${encodeURIComponent(destination)}`}>зарегистрируйтесь</Link>.</span>
  </>;
  if (error === "email-not-confirmed") return "Подтвердите email по ссылке из письма, затем повторите вход.";
  if (error === "oauth") return "Не удалось завершить вход через Google. Попробуйте ещё раз.";
  if (error === "confirmation") return "Не удалось завершить подтверждение. Запросите новое письмо и повторите попытку.";
  return "Не удалось войти. Повторите попытку или воспользуйтесь другим способом входа.";
}

function authMessage(message: string | undefined, destination: string) {
  if (message === "confirm-sent") return "Письмо отправлено. Проверьте почту.";
  if (message === "confirmed") return "Email подтверждён. Войдите, чтобы продолжить.";
  if (message === "magic") return "Если этот email зарегистрирован, безопасная ссылка для входа отправлена.";
  if (message === "confirm") return <>Проверьте почту и подтвердите адрес, затем войдите. <Link className="rules-link" href={`/resend-confirmation?next=${encodeURIComponent(destination)}`}>Отправить письмо ещё раз</Link></>;
  return null;
}

function magicLinkErrorMessage(error: string | undefined, destination: string) {
  if (error === "magic-rate-limit") {
    return "Слишком много попыток. Попробуйте отправить ссылку немного позже.";
  }
  if (error === "magic-send") {
    return <>
      <span className="login-error-copy">Не удалось отправить ссылку для входа.</span>
      <span className="login-error-hint">Если у вас ещё нет аккаунта — <Link className="login-error-register-link" href={`/register?next=${encodeURIComponent(destination)}`}>зарегистрируйтесь</Link>.</span>
    </>;
  }
  return null;
}

function MagicLinkContextError({ destination }: { destination: string }) {
  const retryHref = `/login?next=${encodeURIComponent(destination)}#magic-link`;

  return (
    <div className="magic-link-context-error" role="alert" aria-labelledby="magic-link-context-error-title">
      <h2 id="magic-link-context-error-title">Не удалось завершить вход по ссылке</h2>
      <p>Ссылка была открыта в другом браузере или устройстве, либо данные входа больше недоступны.</p>
      <p>Запросите новую ссылку и откройте её в том же браузере, где вы её запросили.</p>
      <div className="magic-link-context-actions">
        <Link className="button" href={retryHref}>Запросить новую ссылку</Link>
        <Link className="card-link" href="#password-login">Войти с паролем</Link>
      </div>
    </div>
  );
}

function RegistrationConfirmationState({ destination }: { destination: string }) {
  const loginHref = `/login?next=${encodeURIComponent(destination)}`;
  const resendHref = `/resend-confirmation?next=${encodeURIComponent(destination)}`;

  return (
    <section className="auth-section registration-confirmation-section">
      <div className="auth-container registration-confirmation-container">
        <div className="registration-confirmation-card" role="status" aria-live="polite">
          <div className="registration-confirmation-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 7.5 12 13l8-5.5M5.5 19h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" /></svg>
          </div>
          <div className="eyebrow">Регистрация завершена</div>
          <h1 className="registration-confirmation-title">Проверьте почту</h1>
          <p className="registration-confirmation-copy">Мы отправили письмо для подтверждения на ваш email. Перейдите по ссылке в письме, чтобы активировать аккаунт.</p>
          <p className="registration-confirmation-hint">Не нашли письмо? Проверьте папку «Спам».</p>
          <div className="registration-confirmation-actions">
            <Link className="button secondary registration-confirmation-return" href={loginHref}>Вернуться ко входу</Link>
            <Link className="registration-confirmation-resend" href={resendHref}>Отправить письмо ещё раз</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; message?: string }>;
}) {
  const { error, next, message } = await searchParams;
  const destination = safeNextPath(next, "/cabinet");
  if (message === "signup") return <RegistrationConfirmationState destination={destination} />;
  const notice = authMessage(message, destination);
  const magicError = magicLinkErrorMessage(error, destination);
  const hasMagicLinkContextError = error === "magic-verifier";

  return (
    <section className="auth-section">
      <div className="auth-container">
        <div className="eyebrow">Доступ к профилю</div>
        <div className="auth-heading-row">
          <h1 className="auth-title">Войти</h1>
        </div>
        <p className="auth-lead">Войдите, чтобы подать заявку, управлять профилем и видеть решения модератора.</p>
        {notice && <div className="notice">{notice}</div>}
        {hasMagicLinkContextError && <MagicLinkContextError destination={destination} />}
        <div className="auth-card">
          <form action={signIn} className="form-stack" id="password-login">
            <input type="hidden" name="next" value={destination} />
            <div className="auth-email-label-row"><label htmlFor="login-email">Email</label><p className="auth-register">Нет аккаунта? <Link className="rules-link" href={`/register?next=${encodeURIComponent(destination)}`}>Зарегистрироваться</Link></p></div>
            <input id="login-email" name="email" type="email" placeholder="Email" autoComplete="email" required />
            <PasswordField />
            <button className="button">Войти по email</button>
            <Link className="card-link" href="/forgot-password">Забыли пароль?</Link>
            {error && !magicError && !hasMagicLinkContextError && <p className="form-message error" role="alert">{signInErrorMessage(error, destination)}</p>}
          </form>
          <div className="auth-divider">или</div>
          <OAuthButtons next={destination} />
          <div className="auth-divider">вход без пароля</div>
          <section className="magic-login" id="magic-link">
            <h2>Вход без пароля</h2>
            <form action={sendMagicLink} className="form-stack">
              <input type="hidden" name="next" value={destination} />
              <label>Email<input name="email" type="email" placeholder="Email" autoComplete="email" required /></label>
              <p className="auth-help">Введите email — мы отправим безопасную ссылку для входа без пароля.</p>
              <button className="button secondary">Отправить ссылку на email</button>
              {magicError && <p className="form-message error" role="alert">{magicError}</p>}
            </form>
          </section>
        </div>
      </div>
    </section>
  );
}
