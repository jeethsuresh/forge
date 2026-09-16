import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { DeployProjectError, rollbackProject } from "@/lib/project-deploy";

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
    const result = await rollbackProject(id);
    if (result.mode === "forge-self-update") {
      return NextResponse.json(
        { updateId: result.deploymentId, mode: result.mode },
        { status: 202 },
      );
    }
    return NextResponse.json(
      { deploymentId: result.deploymentId, mode: result.mode },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof DeployProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Rollback failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
