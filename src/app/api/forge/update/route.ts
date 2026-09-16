import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { classifyForgeUpdateHttpError } from "@/lib/self-update";
import { findForgeProject } from "@/lib/forge-project";
import { DeployProjectError, deployProject } from "@/lib/project-deploy";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { branch?: string };
  const branch = body.branch?.trim();
  const forge = findForgeProject();
  if (!forge) {
    return NextResponse.json({ error: "Forge project not found" }, { status: 404 });
  }

  try {
    const result = await deployProject({
      projectId: forge.id,
      branch,
      trigger: "manual",
    });
    return NextResponse.json(
      { updateId: result.deploymentId, branch: result.branch, mode: result.mode },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof DeployProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json(
      { error: message },
      { status: classifyForgeUpdateHttpError(message) },
    );
  }
}
