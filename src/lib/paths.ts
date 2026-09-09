const configuredBasePath = process.env.STATIC_BASE_PATH ?? "";

export const staticBasePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/u, "");

export function assetPath(path: string) {
  if (!path.startsWith("/")) return path;
  return `${staticBasePath}${path}`;
}

export function absoluteUrl(path: string) {
  const origin = process.env.SITE_URL?.replace(/\/$/u, "");
  return origin ? `${origin}${staticBasePath}${path.startsWith("/") ? path : `/${path}`}` : undefined;
}
