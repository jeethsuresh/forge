import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { basename, join } from "path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  artifactBuilds,
  projects,
  type ArtifactBuild,
} from "@/lib/db/schema";
import {
  createDiskArtifactStorage,
  type ArtifactStorage,
} from "@/lib/artifact-storage";
import {
  getArtifactByName,
  projectForgefile,
  requireValidForgefile,
} from "@/lib/forgefile-project";
import { cloneOrPull } from "@/lib/github";
import { projectRemoteUrl } from "@/lib/project-git-remote";
import { resolveArtifactsRoot, resolveClonePath } from "@/lib/paths";
import {
  buildProjectScriptEnv,
  projectScriptArgs,
} from "@/lib/projects";
import { runForgeCommand } from "@/lib/forgefile-run";

function defaultStorage(): ArtifactStorage {
  return createDiskArtifactStorage(resolveArtifactsRoot());
}

function storageKeyFor(
  projectId: string,
  name: string,
  buildId: string,
  outputPath: string,
): string {
  return `${projectId}/${name}/${buildId}/${basename(outputPath)}`;
}

export async function buildArtifact(
  projectId: string,
  name: string,
  opts?: { branch?: string; storage?: ArtifactStorage },
): Promise<string> {
  requireValidForgefile(projectId);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  const artifact = getArtifactByName(projectId, name);
  if (!artifact) {
    throw new Error(`Artifact "${name}" is not declared in Forgefile`);
  }

  const buildId = randomUUID();
  const startedAt = new Date();
  const branch = opts?.branch?.trim() || project.branch;
  const storage = opts?.storage ?? defaultStorage();

  db.insert(artifactBuilds)
    .values({
      id: buildId,
      artifactId: artifact.id,
      projectId,
      status: "pending",
      commitSha: null,
      branch,
      storageKey: null,
      sizeBytes: null,
      errorMessage: null,
      startedAt,
      completedAt: null,
    })
    .run();

  const fail = (message: string) => {
    db.update(artifactBuilds)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(artifactBuilds.id, buildId))
      .run();
  };

  try {
    db.update(artifactBuilds)
      .set({ status: "running" })
      .where(eq(artifactBuilds.id, buildId))
      .run();

    const repoPath = resolveClonePath(project.clonePath);
    const commitSha = await cloneOrPull(
      projectRemoteUrl(project),
      branch,
      repoPath,
      () => {},
    );

    db.update(artifactBuilds)
      .set({ commitSha })
      .where(eq(artifactBuilds.id, buildId))
      .run();

    // Re-project so declarations match the checked-out Forgefile.
    projectForgefile(projectId, repoPath, commitSha);
    requireValidForgefile(projectId);
    const refreshed = getArtifactByName(projectId, name);
    if (!refreshed) {
      throw new Error(`Artifact "${name}" is not declared in Forgefile`);
    }

    const { env: scriptEnv, composeProjectName } = buildProjectScriptEnv(
      project.name,
      project.deployEnvJson,
      project.hostPort,
    );
    const scriptArgs = projectScriptArgs(composeProjectName, scriptEnv);

    await runForgeCommand(refreshed.buildCommand, repoPath, () => {}, {
      env: scriptEnv,
      args: scriptArgs,
    });

    const outputAbs = join(repoPath, refreshed.outputPath);
    if (!existsSync(outputAbs)) {
      throw new Error(
        `Artifact output path missing after build: ${refreshed.outputPath}`,
      );
    }

    const key = storageKeyFor(
      projectId,
      name,
      buildId,
      refreshed.outputPath,
    );
    const put = await storage.put(key, outputAbs);

    db.update(artifactBuilds)
      .set({
        status: "success",
        storageKey: key,
        sizeBytes: put.sizeBytes,
        errorMessage: null,
        completedAt: new Date(),
      })
      .where(eq(artifactBuilds.id, buildId))
      .run();

    await enforceArtifactRetention(projectId, name, 10, storage);
    return buildId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
    return buildId;
  }
}

export async function enforceArtifactRetention(
  projectId: string,
  name: string,
  keepLast = 10,
  storage: ArtifactStorage = defaultStorage(),
): Promise<void> {
  const artifact = getArtifactByName(projectId, name);
  if (!artifact) return;

  const successBuilds = db
    .select()
    .from(artifactBuilds)
    .where(
      and(
        eq(artifactBuilds.artifactId, artifact.id),
        eq(artifactBuilds.status, "success"),
      ),
    )
    .orderBy(desc(artifactBuilds.startedAt))
    .all();

  const toDelete = successBuilds.slice(Math.max(0, keepLast));
  for (const build of toDelete) {
    await deleteArtifactBuild(build.id, storage);
  }
}

export async function deleteArtifactBuild(
  buildId: string,
  storage: ArtifactStorage = defaultStorage(),
): Promise<void> {
  const build = db
    .select()
    .from(artifactBuilds)
    .where(eq(artifactBuilds.id, buildId))
    .get();
  if (!build) return;

  if (build.storageKey) {
    await storage.delete(build.storageKey);
  }

  db.delete(artifactBuilds).where(eq(artifactBuilds.id, buildId)).run();
}

export function listArtifactBuilds(
  projectId: string,
  artifactName?: string,
  limit = 20,
): ArtifactBuild[] {
  if (artifactName) {
    const artifact = getArtifactByName(projectId, artifactName);
    if (!artifact) return [];
    return db
      .select()
      .from(artifactBuilds)
      .where(eq(artifactBuilds.artifactId, artifact.id))
      .orderBy(desc(artifactBuilds.startedAt))
      .limit(limit)
      .all();
  }

  return db
    .select()
    .from(artifactBuilds)
    .where(eq(artifactBuilds.projectId, projectId))
    .orderBy(desc(artifactBuilds.startedAt))
    .limit(limit)
    .all();
}

export function getArtifactBuild(buildId: string): ArtifactBuild | null {
  return (
    db
      .select()
      .from(artifactBuilds)
      .where(eq(artifactBuilds.id, buildId))
      .get() ?? null
  );
}
