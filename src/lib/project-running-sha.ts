import { execFile } from "child_process";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { dockerExecEnv, ensureDockerDaemon } from "@/lib/docker-runtime";
import { isForgeProject } from "@/lib/forge-project";
import { projectComposeSlug } from "@/lib/projects";
import {
  readProjectReleaseState,
  saveProjectReleaseState,
} from "@/lib/deploy-rollback";

const execFileAsync = promisify(execFile);

const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Normalize a candidate string into a lowercase git SHA, or null if invalid. */
export function normalizeCommitShaCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  // Strip common image-name prefixes left from tags like "localhost/app:deadbeef"
  const tag = trimmed.includes(":") ? trimmed.split(":").pop()! : trimmed;
  const candidate = tag.replace(/^sha-/, "");
  if (!SHA_RE.test(candidate)) return null;
  return candidate;
}

/** Prefer FORGE_COMMIT_SHA / SOURCE_SHA / COMMIT_SHA from container env. */
export function extractCommitShaFromEnv(env: string[]): string | null {
  for (const key of ["FORGE_COMMIT_SHA", "SOURCE_SHA", "COMMIT_SHA"]) {
    const prefix = `${key}=`;
    for (const line of env) {
      if (line.startsWith(prefix)) {
        const sha = normalizeCommitShaCandidate(line.slice(prefix.length));
        if (sha) return sha;
      }
    }
  }
  return null;
}

/** Prefer git-SHA image tags (e.g. forge-app:abc1234…). */
export function extractCommitShaFromImageRef(imageRef: string): string | null {
  const lastSlash = imageRef.lastIndexOf("/");
  const nameAndTag = lastSlash >= 0 ? imageRef.slice(lastSlash + 1) : imageRef;
  const colon = nameAndTag.lastIndexOf(":");
  if (colon < 0) return null;
  return normalizeCommitShaCandidate(nameAndTag.slice(colon + 1));
}

async function inspectAppContainer(
  composeSlug: string,
): Promise<{ image: string; env: string[] } | null> {
  await ensureDockerDaemon();
  try {
    const { stdout: idsOut } = await execFileAsync(
      "docker",
      [
        "ps",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${composeSlug}`,
        "--filter",
        "label=com.docker.compose.service=app",
      ],
      { maxBuffer: 1024 * 1024, env: dockerExecEnv() },
    );
    let id = idsOut.trim().split("\n")[0]?.trim() ?? "";
    if (!id) {
      // Podman / alternate label prefix
      const { stdout: alt } = await execFileAsync(
        "docker",
        [
          "ps",
          "-q",
          "--filter",
          `label=io.podman.compose.project=${composeSlug}`,
        ],
        { maxBuffer: 1024 * 1024, env: dockerExecEnv() },
      );
      id = alt.trim().split("\n")[0]?.trim() ?? "";
    }
    if (!id) return null;

    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{json .Config}}", id],
      { maxBuffer: 1024 * 1024, env: dockerExecEnv() },
    );
    const config = JSON.parse(stdout.trim()) as {
      Image?: string;
      Env?: string[] | null;
    };
    return {
      image: typeof config.Image === "string" ? config.Image : "",
      env: Array.isArray(config.Env) ? config.Env : [],
    };
  } catch {
    return null;
  }
}

export async function observeRunningCommitShaForComposeProject(
  composeSlug: string,
): Promise<string | null> {
  const inspected = await inspectAppContainer(composeSlug);
  if (!inspected) return null;
  return (
    extractCommitShaFromEnv(inspected.env) ??
    extractCommitShaFromImageRef(inspected.image)
  );
}

export interface RunningShaReconcileResult {
  checked: number;
  updated: number;
  updates: Array<{
    projectId: string;
    name: string;
    previous: string | null;
    observed: string;
  }>;
}

/**
 * Compare each project's currently running container SHA to `projects.lastSeenCommit`
 * (and Forge release state), then update the DB with ground truth from the container.
 */
export async function reconcileRunningCommitShasFromContainers(): Promise<RunningShaReconcileResult> {
  const all = db.select().from(projects).all();
  const updates: RunningShaReconcileResult["updates"] = [];

  for (const project of all) {
    let observed: string | null = null;

    if (isForgeProject(project)) {
      observed = normalizeCommitShaCandidate(process.env.FORGE_COMMIT_SHA);
    }

    if (!observed) {
      const slug = projectComposeSlug(project);
      observed = await observeRunningCommitShaForComposeProject(slug);
    }

    if (!observed) continue;

    const previous = project.lastSeenCommit?.trim().toLowerCase() || null;
    if (previous === observed) {
      // Still refresh Forge release state if needed
      if (isForgeProject(project)) {
        const release = readProjectReleaseState(project.id, project);
        if (release?.stableCommitSha?.toLowerCase() !== observed) {
          try {
            saveProjectReleaseState(project.id, observed, project);
          } catch {
            // ignore invalid existing state edge cases
          }
        }
      }
      continue;
    }

    db.update(projects)
      .set({ lastSeenCommit: observed, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .run();

    if (isForgeProject(project)) {
      try {
        saveProjectReleaseState(project.id, observed, project);
      } catch {
        // ignore
      }
    }

    updates.push({
      projectId: project.id,
      name: project.name,
      previous,
      observed,
    });
  }

  if (updates.length > 0) {
    console.log(
      `[forge] Reconciled running commit SHAs for ${updates.length} project(s): ` +
        updates
          .map(
            (u) =>
              `${u.name} ${u.previous?.slice(0, 7) ?? "∅"}→${u.observed.slice(0, 7)}`,
          )
          .join(", "),
    );
  }

  return {
    checked: all.length,
    updated: updates.length,
    updates,
  };
}
