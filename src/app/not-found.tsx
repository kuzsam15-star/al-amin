import Link from "next/link";

export default function NotFound() {
  return <section className="empty-page"><div className="empty-state"><span className="empty-state-icon" aria-hidden="true">A</span><h1>Страница не найдена</h1><p>Возможно, профиль был снят с публикации или адрес изменился.</p><Link className="primary-button" href="/specialists">Открыть каталог</Link></div></section>;
}
