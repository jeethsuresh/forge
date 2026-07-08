import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  username?: string;
  isLoggedIn: boolean;
}

/** Enable only when Orchestrator is served over HTTPS (e.g. TLS-terminated reverse proxy). */
export function sessionCookieSecure(): boolean {
  const value = process.env.FORGE_SESSION_SECURE_COOKIE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export const sessionOptions: SessionOptions = {
  password: process.env.FORGE_SESSION_SECRET ?? "forge-dev-secret-change-me-32chars",
  cookieName: "forge_session",
  cookieOptions: {
    secure: sessionCookieSecure(),
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    throw new Error("Unauthorized");
  }
  return session;
}
