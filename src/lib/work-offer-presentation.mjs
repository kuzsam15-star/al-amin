export const workModeLabels = { online: "Онлайн", offline: "Очно", both: "Онлайн и очно" };

export function formatWorkOfferPrice(price, currency) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount);
    return currency === "RUB" ? `${formatted} ₽` : `${formatted} ${currency}`;
  }
}

export function getWorkOfferPresentationParts(offer) {
  const parts = [];
  const mode = workModeLabels[offer.mode];
  if (mode) parts.push({ kind: "mode", value: mode });
  const duration = Number(offer.durationMinutes);
  if (Number.isFinite(duration) && duration > 0) parts.push({ kind: "duration", value: `${duration} мин.` });
  const price = formatWorkOfferPrice(offer.price, offer.currency);
  if (price) parts.push({ kind: "price", value: price });
  return parts;
}
