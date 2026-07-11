import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth/session";

const publicPaths = [
  "/login",
  "/api/auth/login",
  "/api/forge/health",
  "/api/forge/recover",
  "/api/caddy/logs",
  "/api/caddy/logs/ingest",
];

function isPublicPath(pathname: string): boolean {
  if (publicPaths.some((p) => pathname === p)) return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/api/ops")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(
    request,
    response,
    sessionOptions,
  );

  if (!session.isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
