import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  deployTargets,
  projectForgefiles,
  type DeployTarget,
  type ProjectForgefile,
  type ProjectForgefileStatus,
} from "@/lib/db/schema";
import { loadForgefile } from "@/lib/forgefile-load";
import type { Forgefile } from "@/lib/forgefile-types";

export type ProjectForgefileResult = {
  status: ProjectForgefileStatus;
  errors?: string[];
};

function formatValidationErrors(
  errors: { path: string; message: string }[],
): string[] {
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

function upsertProjectForgefile(values: {
  projectId: string;
  status: ProjectForgefileStatus;
  contentHash: string | null;
  sourcePath: string | null;
  commitSha: string | null;
  errorMessage: string | null;
  parsedJson: string;
}): void {
  const now = new Date();
  const existing = db
    .select()
    .from(projectForgefiles)
    .where(eq(projectForgefiles.projectId, values.projectId))
    .get();

  if (existing) {
    db.update(projectForgefiles)
      .set({
        status: values.status,
        contentHash: values.contentHash,
        sourcePath: values.sourcePath,
        commitSha: values.commitSha,
        errorMessage: values.errorMessage,
        parsedJson: values.parsedJson,
        updatedAt: now,
      })
      .where(eq(projectForgefiles.projectId, values.projectId))
      .run();
    return;
  }

  db.insert(projectForgefiles)
    .values({
      projectId: values.projectId,
      status: values.status,
      contentHash: values.contentHash,
      sourcePath: values.sourcePath,
      commitSha: values.commitSha,
      errorMessage: values.errorMessage,
      parsedJson: values.parsedJson,
      updatedAt: now,
    })
    .run();
}

function clearDeployTargets(projectId: string): void {
  db.delete(deployTargets).where(eq(deployTargets.projectId, projectId)).run();
}

function replaceDeployTargets(projectId: string, forgefile: Forgefile): void {
  const now = new Date();
  clearDeployTargets(projectId);

  for (const [name, deployment] of Object.entries(forgefile.deployments)) {
    db.insert(deployTargets)
      .values({
        id: randomUUID(),
        projectId,
        name,
        description: deployment.description ?? null,
        autoDeploy: deployment.auto_deploy,
        subdomain: deployment.subdomain ?? null,
        composeSlug: deployment.compose_slug ?? null,
        portsJson: JSON.stringify(deployment.ports),
        scriptsJson: JSON.stringify(deployment.scripts),
        updatedAt: now,
      })
      .run();
  }
}

function isMissingForgefile(
  path: string,
  errors: { path: string; message: string }[],
): boolean {
  if (!path) return true;
  return errors.some((e) => /Forgefile not found/i.test(e.message));
}

export function projectForgefile(
  projectId: string,
  repoRoot: string,
  commitSha?: string | null,
): ProjectForgefileResult {
  const sha = commitSha ?? null;

  let loaded;
  try {
    loaded = loadForgefile(repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errors = [message];
    db.transaction(() => {
      upsertProjectForgefile({
        projectId,
        status: "invalid",
        contentHash: null,
        sourcePath: null,
        commitSha: sha,
        errorMessage: message,
        parsedJson: "{}",
      });
      clearDeployTargets(projectId);
    });
    return { status: "invalid", errors };
  }

  if (!loaded.parsed.ok) {
    const errors = formatValidationErrors(loaded.parsed.errors);
    const status: ProjectForgefileStatus = isMissingForgefile(
      loaded.path,
      loaded.parsed.errors,
    )
      ? "missing"
      : "invalid";

    db.transaction(() => {
      upsertProjectForgefile({
        projectId,
        status,
        contentHash: loaded.contentHash || null,
        sourcePath: loaded.path || null,
        commitSha: sha,
        errorMessage: errors.join("; "),
        parsedJson: "{}",
      });
      clearDeployTargets(projectId);
    });

    return { status, errors };
  }

  const forgefile = loaded.parsed.value;

  db.transaction(() => {
    upsertProjectForgefile({
      projectId,
      status: "valid",
      contentHash: loaded.contentHash,
      sourcePath: loaded.path,
      commitSha: sha,
      errorMessage: null,
      parsedJson: JSON.stringify(forgefile),
    });
    replaceDeployTargets(projectId, forgefile);
  });

  return { status: "valid" };
}

export function getProjectForgefile(
  projectId: string,
): ProjectForgefile | null {
  return (
    db
      .select()
      .from(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .get() ?? null
  );
}

export function listDeployTargets(projectId: string): DeployTarget[] {
  return db
    .select()
    .from(deployTargets)
    .where(eq(deployTargets.projectId, projectId))
    .all();
}

export function requireValidForgefile(projectId: string): void {
  const row = getProjectForgefile(projectId);
  if (row?.status === "valid") return;

  if (!row || row.status === "missing") {
    throw new Error(
      "Forgefile required. Use Create Forgefile with agent, or add a Forgefile at the repo root.",
    );
  }

  throw new Error(
    `Invalid Forgefile: ${row.errorMessage ?? "validation failed"}`,
  );
}
