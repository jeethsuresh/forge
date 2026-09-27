import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  createFunctionalUser,
  listFunctionalUsers,
} from "@/lib/functional-users";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET() {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    users: listFunctionalUsers().map((user) => ({
      id: user.id,
      name: user.name,
      tokenVersion: user.tokenVersion,
      token: user.token,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  try {
    const created = createFunctionalUser(body.name ?? "");
    return NextResponse.json(
      {
        id: created.user.id,
        name: created.user.name,
        tokenVersion: created.user.tokenVersion,
        token: created.token,
        createdAt: created.user.createdAt,
        updatedAt: created.user.updatedAt,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
