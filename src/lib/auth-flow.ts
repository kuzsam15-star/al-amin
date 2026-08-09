export type AuthCallbackFlow = "confirmation" | "magiclink" | "oauth" | "unknown";

const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "rate_limit_exceeded",
]);

export function classifyResendError(error: { code?: string | null } | null) {
  if (!error) return null;
  return RATE_LIMIT_CODES.has(error.code ?? "") ? "rate-limit" : "send";
}

export function classifyMagicLinkError(
  error: { code?: string | null; status?: number | null } | null,
) {
  if (!error) return null;
  return error.status === 429 || RATE_LIMIT_CODES.has(error.code ?? "")
    ? "rate-limit"
    : "send";
}

export function magicLinkResultPath(
  error: { code?: string | null; status?: number | null } | null,
  next: string,
) {
  const encodedNext = encodeURIComponent(next);
  const reason = classifyMagicLinkError(error);
  return reason
    ? `/login?next=${encodedNext}&error=magic-${reason}`
    : `/login?next=${encodedNext}&message=magic`;
}

export function authCallbackFlow(value: string | null): AuthCallbackFlow {
  return value === "confirmation" || value === "magiclink" || value === "oauth" ? value : "unknown";
}

export function isPkceVerifierError(error: { code?: string | null; name?: string | null }) {
  return error.code === "bad_code_verifier" || error.name === "AuthPKCECodeVerifierMissingError";
}

export function callbackFailurePath(
  flow: AuthCallbackFlow,
  error: { code?: string | null; name?: string | null },
  next: string,
) {
  const encodedNext = encodeURIComponent(next);
  if (flow === "magiclink" && isPkceVerifierError(error)) {
    return `/login?next=${encodedNext}&error=magic-verifier`;
  }
  if (flow === "confirmation" && isPkceVerifierError(error)) {
    return `/login?next=${encodedNext}&message=confirmed`;
  }
  const reason = flow === "oauth" ? "oauth" : "confirmation";
  return `/login?next=${encodedNext}&error=${reason}`;
}
