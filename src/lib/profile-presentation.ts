const knownCities: Record<string, string> = {
  "velikie luki": "Великие Луки",
};

export function displayCity(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  return knownCities[clean.toLocaleLowerCase("ru")] ?? clean;
}

export function profileMeta({ specialization, country, city, serviceMode }: { specialization?: string | null; country?: string | null; city?: string | null; serviceMode?: string | null }) {
  const place = [String(country ?? "").trim(), displayCity(city)].filter(Boolean).join(" · ");
  return [String(specialization ?? "").trim(), place, String(serviceMode ?? "").trim()].filter(Boolean).join(" · ");
}

export function experienceText(years: number | null | undefined) {
  if (typeof years !== "number" || !Number.isInteger(years) || years < 0) return null;
  const mod100 = years % 100; const mod10 = years % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? "лет" : mod10 === 1 ? "год" : mod10 >= 2 && mod10 <= 4 ? "года" : "лет";
  return `${years} ${word}`;
}
