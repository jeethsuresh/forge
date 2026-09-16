import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { classifyForgeUpdateHttpError } from "@/lib/self-update";
import { findForgeProject } from "@/lib/forge-project";
import { DeployProjectError, rollbackProject } from "@/lib/project-deploy";

export async function POST() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forge = findForgeProject();
  if (!forge) {
    return NextResponse.json({ error: "Forge project not found" }, { status: 404 });
  }

  try {
    const result = await rollbackProject(forge.id);
    return NextResponse.json(
      { updateId: result.deploymentId, mode: result.mode },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof DeployProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Rollback failed";
    return NextResponse.json(
      { error: message },
      { status: classifyForgeUpdateHttpError(message) },
    );
  }
}
