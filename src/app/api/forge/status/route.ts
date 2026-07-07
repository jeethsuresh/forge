import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getForgeStatus } from "@/lib/self-update";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getForgeStatus();
  return NextResponse.json(status);
}
