const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com",
  "frame-src https://www.youtube-nocookie.com https://rutube.ru https://vkvideo.ru",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
].join("; ");

const commonHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.10.155", "localhost", "127.0.0.1"],
  async headers() {
    return [
      { source: "/:path*", headers: commonHeaders },
      { source: "/cabinet/:path*", headers: [...commonHeaders, { key: "Cache-Control", value: "private, no-store, max-age=0" }] },
      { source: "/admin/:path*", headers: [...commonHeaders, { key: "Cache-Control", value: "private, no-store, max-age=0" }] },
      { source: "/api/:path*", headers: [...commonHeaders, { key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
