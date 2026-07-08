import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { classifyForgeUpdateHttpError, startForgeUpdate } from "@/lib/self-update";

export async function POST() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const updateId = await startForgeUpdate();
    return NextResponse.json({ updateId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json(
      { error: message },
      { status: classifyForgeUpdateHttpError(message) },
    );
  }
}
