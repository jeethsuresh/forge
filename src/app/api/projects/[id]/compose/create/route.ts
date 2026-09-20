import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createStarterComposeBranch } from "@/lib/compose-studio";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const saved = await createStarterComposeBranch(id);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create compose file";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
