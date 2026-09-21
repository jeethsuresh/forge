import { NextResponse } from "next/server";
import { isDeploymentActive } from "@/lib/deployer";

export function branchOpsBlockedResponse(projectId: string) {
  if (isDeploymentActive(projectId)) {
    return NextResponse.json(
      { error: "A deployment is in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  return null;
}
