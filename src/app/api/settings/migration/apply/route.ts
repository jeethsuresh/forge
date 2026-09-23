import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { applyMigrationPreview } from "@/lib/migration/pull";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    previewId?: string;
  } | null;
  const previewId = body?.previewId?.trim() ?? "";
  if (!previewId) {
    return NextResponse.json({ error: "previewId is required" }, { status: 400 });
  }

  try {
    const result = await applyMigrationPreview(previewId);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Migration import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
