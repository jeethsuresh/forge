import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { mergeComposeAndDeploy } from "@/lib/compose-studio";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { branch?: string };
  if (!body.branch?.trim()) {
    return NextResponse.json({ error: "branch is required" }, { status: 400 });
  }
  try {
    const result = await mergeComposeAndDeploy({
      projectId: id,
      branch: body.branch,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge and deploy failed";
    const status = /conflict|Merge failed/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
