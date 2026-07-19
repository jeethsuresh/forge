import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { buildOpsProjectSummary } from "@/lib/ops-api-project";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const allProjects = db.select().from(projects).orderBy(projects.name).all();
  const scoped =
    auth.kind === "session"
      ? allProjects.filter((p) => p.id === auth.projectId)
      : allProjects;
  const summaries = await Promise.all(scoped.map(buildOpsProjectSummary));

  return NextResponse.json({ projects: summaries });
}
