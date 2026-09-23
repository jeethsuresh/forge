import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { previewMigration } from "@/lib/migration/pull";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    username?: string;
    password?: string;
  } | null;
  if (!body?.url?.trim() || !body.username?.trim() || !body.password) {
    return NextResponse.json(
      { error: "URL, username, and password are required" },
      { status: 400 },
    );
  }

  try {
    const result = await previewMigration({
      baseUrl: body.url,
      username: body.username,
      password: body.password,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Migration review failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
