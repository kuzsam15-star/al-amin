export type PublicSpecialistVerificationState = "published" | "verified";

type PublicSpecialistCardBase = {
  id: string;
  name: string;
  specialization: string;
  location: string;
  workFormat: string;
  photo: string | null;
  photoAlt: string;
  verificationState: PublicSpecialistVerificationState;
};

export type RealPublicSpecialistCard = PublicSpecialistCardBase & {
  isMock: false;
  slug: string;
  profileUrl: string;
};

export type MockPublicSpecialistCard = PublicSpecialistCardBase & {
  isMock: true;
  slug: null;
  profileUrl: null;
};

export type PublicSpecialistCard = RealPublicSpecialistCard | MockPublicSpecialistCard;

type RealPublicSpecialistCardInput = Omit<RealPublicSpecialistCard, "isMock" | "profileUrl">;
type MockPublicSpecialistCardInput = Omit<MockPublicSpecialistCard, "isMock" | "slug" | "profileUrl">;

export function publicSpecialistProfileUrl(slug: string): string | null {
  const normalized = slug.trim();
  if (!normalized || normalized.includes("/") || normalized === "." || normalized === "..") return null;
  return `/specialists/${encodeURIComponent(normalized)}`;
}

export function createRealPublicSpecialistCard(
  input: RealPublicSpecialistCardInput,
): RealPublicSpecialistCard | null {
  const profileUrl = publicSpecialistProfileUrl(input.slug);
  if (!input.id.trim() || !input.name.trim() || !profileUrl) return null;

  return {
    ...input,
    id: input.id.trim(),
    slug: input.slug.trim(),
    name: input.name.trim(),
    profileUrl,
    isMock: false,
  };
}

export function createMockPublicSpecialistCard(
  input: MockPublicSpecialistCardInput,
): MockPublicSpecialistCard {
  return {
    ...input,
    id: input.id.trim(),
    name: input.name.trim(),
    slug: null,
    profileUrl: null,
    isMock: true,
  };
}

export type PublicSpecialistCardPosition = "farLeft" | "left" | "center" | "right" | "farRight" | "hidden";

export type PublicSpecialistCardAction =
  | { type: "ignore" }
  | { type: "center" }
  | { type: "navigate"; href: string }
  | { type: "catalog"; href: "/specialists" };

export function resolvePublicSpecialistCardAction(
  card: PublicSpecialistCard,
  position: PublicSpecialistCardPosition,
  wasDragged = false,
): PublicSpecialistCardAction {
  if (wasDragged || position === "hidden" || position === "farLeft" || position === "farRight") {
    return { type: "ignore" };
  }
  if (position !== "center") return { type: "center" };
  if (card.isMock) return { type: "catalog", href: "/specialists" };
  return { type: "navigate", href: card.profileUrl };
}

export function publicSpecialistCardHref(card: PublicSpecialistCard): string {
  return card.isMock ? "/specialists" : card.profileUrl;
}
