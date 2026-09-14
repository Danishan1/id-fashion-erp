import type { NextConfig } from "next";

// The App Router injects its own inline `<script>` tags for streaming RSC
// hydration data (`self.__next_f.push(...)`) on every page — a strict
// `script-src 'self'` with no allowance for this would silently break
// hydration app-wide. A per-request nonce is the correct fix (see Next.js's
// own CSP guide), but that requires wrapping the NextAuth proxy/middleware's
// auth() call, which drives every page's login-redirect behavior — not worth
// the regression risk in this pass. `'unsafe-inline'` on script-src is a
// real, deliberate tradeoff: still blocks any externally-sourced or
// injected <script src=...>, still blocks framing/object embeds/plugins,
// still restricts navigation/form targets — just doesn't stop an inline
// script an XSS bug might inject. Tighten to nonce-based once the
// proxy/auth flow is revisited.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'" + (isDev ? " ws:" : ""),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to dev-server assets (/_next/*) by
  // default as a DNS-rebinding protection — without this, loading the app
  // from another device's browser via the LAN IP gets a 403 on every chunk.
  allowedDevOrigins: ["192.168.29.215"],
  async redirects() {
    return [
      // AI Designer's "Catalogue Designs" page route was renamed from
      // /ai-designer/projects (2026-09-14, to match the sidebar label
      // already renamed from "Projects") — this keeps any existing
      // bookmark/shared link working rather than silently 404ing. The
      // underlying API routes (/api/v1/ai-designer/projects/...) are
      // deliberately untouched — only the browser-facing page path moved.
      {
        source: "/ai-designer/projects",
        destination: "/ai-designer/catalogue-designs",
        permanent: true,
      },
      {
        source: "/ai-designer/projects/:path*",
        destination: "/ai-designer/catalogue-designs/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Only meaningful over HTTPS (browsers ignore it on plain HTTP) —
          // harmless to always send; preload is NOT enabled here since that
          // requires a deliberate, hard-to-reverse submission to browsers'
          // HSTS preload lists, a decision for whoever owns the real domain.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
