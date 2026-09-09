const basePathValue = process.env.STATIC_BASE_PATH ?? "";
const basePath = basePathValue === "/" ? "" : basePathValue.replace(/\/$/u, "");

if (basePath && !/^\/[A-Za-z0-9._/-]+$/u.test(basePath)) {
  throw new Error("STATIC_BASE_PATH must be empty or start with / and contain only URL path characters.");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
