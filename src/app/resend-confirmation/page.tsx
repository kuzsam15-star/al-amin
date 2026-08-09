import Link from "next/link";
import { resendConfirmation } from "@/app/register/actions";
import { safeNextPath } from "@/lib/navigation";

function resendErrorMessage(error: string | undefined) {
  if (error === "email") return "Введите корректный email.";
  if (error === "rate-limit") return "Слишком много попыток. Попробуйте немного позже.";
  if (error === "send") return "Не удалось отправить письмо. Попробуйте ещё раз позже.";
  return null;
}

export default async function ResendConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; error?: string }>;
}) {
  const { next, message, error } = await searchParams;
  const destination = safeNextPath(next, "/apply");
  const errorMessage = resendErrorMessage(error);

  return (
    <section className="auth-section">
      <div className="auth-container">
        <div className="eyebrow">Подтверждение адреса</div>
        <h1 className="auth-title">Отправить письмо ещё раз</h1>
        <p className="auth-lead">Укажите email — отправим новую ссылку для подтверждения. Между запросами действует короткая пауза.</p>
        <form action={resendConfirmation} className="auth-card form-stack">
          <input type="hidden" name="next" value={destination} />
          <label>
            Email
            <input name="email" type="email" placeholder="Email" autoComplete="email" required />
          </label>
          <button className="button">Отправить письмо подтверждения</button>
          {message === "wait" && <p className="form-message error" role="alert">Подождите минуту перед повторной отправкой.</p>}
          {errorMessage && <p className="form-message error" role="alert">{errorMessage}</p>}
        </form>
        <p className="auth-register">
          <Link className="rules-link" href={`/login?next=${encodeURIComponent(destination)}`}>Вернуться ко входу</Link>
        </p>
      </div>
    </section>
  );
}
