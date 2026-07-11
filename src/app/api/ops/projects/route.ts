import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { buildOpsProjectSummary } from "@/lib/ops-api-project";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const allProjects = db.select().from(projects).orderBy(projects.name).all();
  const summaries = await Promise.all(allProjects.map(buildOpsProjectSummary));

  return NextResponse.json({ projects: summaries });
}
