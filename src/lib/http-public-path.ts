/**
 * Cookie-optional HTTP paths. Auth for these is enforced in-route
 * (Ops token, git HTTP, ingest token, recover token) — not iron-session.
 */
export function isSessionExemptPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/api/auth/login") return true;
  if (pathname === "/api/forge/health") return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/api/ops")) return true;
  if (
    pathname === "/.well-known/forge-agent.json" ||
    pathname.startsWith("/.well-known/forge-agent.json/")
  ) {
    return true;
  }
  if (pathname.startsWith("/api/git")) return true;
  if (
    pathname === "/api/caddy/logs/ingest" ||
    pathname.startsWith("/api/caddy/logs/ingest/")
  ) {
    return true;
  }
  // Sidecar has no session cookie; the recover *route* requires a Bearer token.
  if (pathname === "/api/forge/recover") return true;
  return false;
}

/** Next.js middleware matcher: run on app/API routes, skip hashed static assets. */
export const MIDDLEWARE_MATCHER = [
  "/((?!_next/static|_next/image|favicon.ico).*)",
];
