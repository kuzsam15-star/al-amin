import Link from "next/link";
import { register } from "./actions";
import { OAuthButtons } from "@/components/OAuthButtons";
import { safeNextPath } from "@/lib/navigation";

function registrationErrorMessage(error?: string) {
  if (error === "email") return "Проверьте формат email.";
  if (error === "password") return "Пароль должен содержать минимум 8 символов.";
  if (error === "account") return "Не удалось завершить регистрацию. Войдите через доступный способ входа или восстановите доступ.";
  return "Не удалось зарегистрироваться. Попробуйте ещё раз.";
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const destination = safeNextPath(next, "/apply");

  return (
    <section className="section register-auth-section">
      <div className="container narrow register-auth-container">
        <div className="eyebrow">Аккаунт пользователя</div>
        <h1 className="page-title">Создать аккаунт</h1>
        <p className="lead">Аккаунт нужен, чтобы подать заявку, видеть её статус и управлять профилем.</p>
        <form action={register} className="card form-stack register-auth-card">
          <input type="hidden" name="next" value={destination} />
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Пароль<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
          <button className="button">Зарегистрироваться</button>
          <p className="form-hint">Для одного email создаётся один аккаунт. Если вы уже входили через Google, используйте Google или восстановление доступа, чтобы установить пароль.</p>
          {error && <p className="form-message error" role="alert">{registrationErrorMessage(error)}</p>}
        </form>
        <div className="auth-divider register-auth-divider">или</div>
        <div className="register-auth-oauth"><OAuthButtons next={destination} /></div>
        <p className="meta register-auth-meta">Уже есть аккаунт? <Link className="rules-link" href={`/login?next=${encodeURIComponent(destination)}`}>Войти</Link></p>
      </div>
    </section>
  );
}
