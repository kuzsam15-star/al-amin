const normalizeCount = (count) => Math.abs(Math.trunc(Number(count) || 0));

/**
 * Selects the Russian singular, paucal, or plural form for a count.
 */
export function russianPluralForm(count, { one, few, many }) {
  const normalized = normalizeCount(count);
  const lastTwo = normalized % 100;
  const last = normalized % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function russianCount(count, forms) {
  return `${normalizeCount(count)} ${russianPluralForm(count, forms)}`;
}
