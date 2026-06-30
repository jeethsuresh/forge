import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { parseGithubRepo } from "@/lib/github";
import { isDeploymentActive } from "@/lib/deployer";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET() {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allProjects = db
    .select()
    .from(projects)
    .orderBy(projects.name)
    .all();

  const enriched = allProjects.map((project) => {
    const latest = db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .orderBy(desc(deployments.startedAt))
      .limit(1)
      .get();

    return {
      ...project,
      latestDeployment: latest ?? null,
      isDeploying: isDeploymentActive(project.id),
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    githubRepo?: string;
    branch?: string;
  };

  if (!body.name?.trim() || !body.githubRepo?.trim()) {
    return NextResponse.json(
      { error: "Name and GitHub repository are required" },
      { status: 400 },
    );
  }

  let githubRepo: string;
  try {
    githubRepo = parseGithubRepo(body.githubRepo);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid repository";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const branch = body.branch?.trim() || "main";
  const reposDir = process.env.FORGE_REPOS_DIR ?? "./data/repos";
  mkdirSync(reposDir, { recursive: true });
  const slug = githubRepo.replace("/", "-");
  const clonePath = join(reposDir, `${slug}-${branch}`);

  const id = randomUUID();
  const now = new Date();

  db.insert(projects)
    .values({
      id,
      name: body.name.trim(),
      githubRepo,
      branch,
      clonePath,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  return NextResponse.json(project, { status: 201 });
}
