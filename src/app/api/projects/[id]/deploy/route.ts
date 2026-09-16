import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { DeployProjectError, deployProject } from "@/lib/project-deploy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    branch?: string;
    deployment?: string;
  };

  try {
    const result = await deployProject({
      projectId: id,
      branch: body.branch,
      target: body.deployment,
      trigger: "manual",
    });
    if (result.mode === "forge-self-update") {
      return NextResponse.json(
        { updateId: result.deploymentId, branch: result.branch, mode: result.mode },
        { status: 202 },
      );
    }
    return NextResponse.json(
      {
        deploymentId: result.deploymentId,
        branch: result.branch,
        deployment: result.deployment,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof DeployProjectError) {
      return NextResponse.json(
        { error: err.message, ...err.extra },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
