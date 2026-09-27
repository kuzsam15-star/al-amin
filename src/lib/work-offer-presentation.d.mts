export type WorkOfferPresentationInput = {
  mode: "online" | "offline" | "both";
  durationMinutes: number | null;
  price: number | null;
  currency: string | null;
};

export type WorkOfferPresentationPart = {
  kind: "mode" | "duration" | "price";
  value: string;
};

export const workModeLabels: Record<WorkOfferPresentationInput["mode"], string>;
export function formatWorkOfferPrice(price: number | null, currency: string | null): string | null;
export function getWorkOfferPresentationParts(offer: WorkOfferPresentationInput): WorkOfferPresentationPart[];
