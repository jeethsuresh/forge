import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { classifyForgeUpdateHttpError, startForgeUpdate } from "@/lib/self-update";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { branch?: string };
  const branch = body.branch?.trim();

  try {
    const updateId = await startForgeUpdate(
      branch ? { branch } : undefined,
    );
    return NextResponse.json({ updateId, branch: branch ?? undefined }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json(
      { error: message },
      { status: classifyForgeUpdateHttpError(message) },
    );
  }
}
