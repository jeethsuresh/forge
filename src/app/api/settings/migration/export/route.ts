import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildMigrationManifest } from "@/lib/migration/manifest";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(buildMigrationManifest(), {
    headers: { "cache-control": "no-store" },
  });
}
