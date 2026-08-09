/**
 * Accepts only a local application path. A leading slash alone is not enough:
 * `//example.com` is a protocol-relative external URL in browsers.
 */
export function safeNextPath(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\r\n\0]/.test(candidate)) return fallback;
  try {
    const parsed = new URL(candidate, "https://local.invalid");
    return parsed.origin === "https://local.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

const LOCAL_APP_ORIGIN = "http://localhost:3000";
const BIND_ONLY_HOSTS = new Set(["0.0.0.0", "[::]", "::"]);

/**
 * Resolves the single browser-facing origin used by authentication flows.
 * The server bind address and request Host are deliberately not inputs: an
 * unspecified bind address is not navigable, and trusting Host here would
 * turn auth callbacks into an open-redirect surface.
 */
export function resolveCanonicalSiteOrigin(configuredUrl: string | undefined, environment: string | undefined) {
  const raw = configuredUrl?.trim();
  if (!raw) {
    if (environment === "production") {
      throw new Error("NEXT_PUBLIC_SITE_URL is required in production");
    }
    return LOCAL_APP_ORIGIN;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    if (url.username || url.password) throw new Error("credentials are not allowed");
    if (BIND_ONLY_HOSTS.has(url.hostname)) {
      if (environment === "production") throw new Error("bind-only host is not allowed");
      return LOCAL_APP_ORIGIN;
    }
    return url.origin;
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a browser-facing absolute HTTP(S) URL");
  }
}

export function canonicalSiteOrigin() {
  return resolveCanonicalSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, process.env.NODE_ENV);
}

export function canonicalAppUrl(path: unknown, fallback = "/") {
  return new URL(safeNextPath(path, fallback), canonicalSiteOrigin());
}
