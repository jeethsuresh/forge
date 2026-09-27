import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteFunctionalUser } from "@/lib/functional-users";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const removed = deleteFunctionalUser(id.trim());
  if (!removed) {
    return NextResponse.json({ error: "Functional user not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
