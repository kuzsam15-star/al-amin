import { canonicalSiteOrigin } from "@/lib/navigation";

/** Compare requests with the configured origin, never a forwarded header. */
export function hasTrustedOrigin(request: Request) {
  return request.headers.get("origin") === canonicalSiteOrigin();
}
