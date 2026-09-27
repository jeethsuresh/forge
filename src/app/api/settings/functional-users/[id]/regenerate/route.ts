import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { regenerateFunctionalUserToken } from "@/lib/functional-users";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const rotated = id?.trim() ? regenerateFunctionalUserToken(id.trim()) : null;
  if (!rotated) {
    return NextResponse.json({ error: "Functional user not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: rotated.user.id,
    name: rotated.user.name,
    tokenVersion: rotated.user.tokenVersion,
    token: rotated.token,
    createdAt: rotated.user.createdAt,
    updatedAt: rotated.user.updatedAt,
  });
}
