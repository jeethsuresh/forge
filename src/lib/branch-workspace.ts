import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branchWorkspaces,
  type BranchWorkspace,
  type BranchWorkspaceStatus,
  type Project,
} from "@/lib/db/schema";
import {
  resolveHostBindPath,
  mountArgTargetsDockerSock,
  type AgentContainerDockerRunner,
  type DockerRunResult,
} from "@/lib/agent-container";
import { ensureDockerDaemon, dockerExecEnv } from "@/lib/docker-runtime";
import { resolveBranchWorkspacesRoot } from "@/lib/paths";
import { projectRemoteUrl } from "@/lib/project-git-remote";
import { formatGitError } from "@/lib/git-workspace";
import { ensureForgeBareOrigin } from "@/lib/forge-git-origin";

const execFileAsync = promisify(execFile);

export const DEFAULT_BRANCH_IMAGE =
  process.env.FORGE_BRANCH_IMAGE?.trim() || "forge-branch:latest";

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

function defaultDockerRunner(args: string[]): Promise<DockerRunResult> {
  return ensureDockerDaemon().then(() =>
    execFileAsync("docker", args, {
      env: dockerExecEnv(),
      maxBuffer: 5 * 1024 * 1024,
    }),
  );
}

let dockerRunner: AgentContainerDockerRunner | null = null;

export function setBranchWorkspaceDockerRunner(
  runner: AgentContainerDockerRunner | null,
): void {
  dockerRunner = runner;
}

async function runDocker(args: string[]): Promise<DockerRunResult> {
  try {
    return await (dockerRunner ?? defaultDockerRunner)(args);
  } catch {
    throw new Error(`docker ${args[0] ?? "command"} failed`);
  }
}

export function branchWorkspaceSlug(branch: string): string {
  const trimmed = branch.trim();
  const slug =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "branch";
  const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

export function branchContainerName(projectId: string, branch: string): string {
  const projectPart = projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const branchPart = createHash("sha256")
    .update(branch.trim())
    .digest("hex")
    .slice(0, 12);
  return `forge-branch-${projectPart}-${branchPart}`;
}

export function branchWorkspacePath(projectId: string, branch: string): string {
  return join(
    resolveBranchWorkspacesRoot(),
    projectId,
    branchWorkspaceSlug(branch),
  );
}

export function getBranchWorkspace(
  projectId: string,
  branch: string,
): BranchWorkspace | undefined {
  return db
    .select()
    .from(branchWorkspaces)
    .where(
      and(
        eq(branchWorkspaces.projectId, projectId),
        eq(branchWorkspaces.branch, branch),
      ),
    )
    .get();
}

function upsertWorkspaceRow(row: {
  id: string;
  projectId: string;
  branch: string;
  workspacePath: string;
  containerName: string;
  status: BranchWorkspaceStatus;
  createdAt: Date;
}): BranchWorkspace {
  const existing = getBranchWorkspace(row.projectId, row.branch);
  if (existing) {
    db.update(branchWorkspaces)
      .set({
        workspacePath: row.workspacePath,
        containerName: row.containerName,
        status: row.status,
      })
      .where(eq(branchWorkspaces.id, existing.id))
      .run();
    return { ...existing, ...row, id: existing.id };
  }
  db.insert(branchWorkspaces).values(row).run();
  return row;
}

async function inspectNamed(
  name: string,
): Promise<{ id: string; running: boolean } | null> {
  try {
    const { stdout } = await runDocker([
      "inspect",
      "-f",
      "{{.Id}} {{.State.Running}}",
      name,
    ]);
    const [idRaw, runningStr] = stdout.trim().split(/\s+/);
    if (!idRaw || !runningStr) return null;
    return {
      id: idRaw.replace(/^sha256:/, "").slice(0, 64),
      running: runningStr.toLowerCase() === "true",
    };
  } catch {
    return null;
  }
}

async function checkoutRequestedBranch(
  workspacePath: string,
  branch: string,
): Promise<void> {
  const trimmed = branch.trim();
  try {
    const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: workspacePath,
    });
    if (stdout.trim() === trimmed) return;
  } catch {
    // new clone
  }

  try {
    await execGit(["checkout", trimmed], { cwd: workspacePath });
    return;
  } catch {
    // materialize from origin
  }

  try {
    await execGit(["rev-parse", "--verify", `origin/${trimmed}`], {
      cwd: workspacePath,
    });
  } catch {
    throw new Error(
      `Branch "${trimmed}" not found locally or on origin. Push the branch to Forge (or create it) first.`,
    );
  }

  await execGit(["checkout", "-B", trimmed, `origin/${trimmed}`], {
    cwd: workspacePath,
  });
}

async function ensureGitCheckout(
  project: Project,
  branch: string,
  workspacePath: string,
): Promise<void> {
  const url = projectRemoteUrl(project);
  mkdirSync(join(workspacePath, ".."), { recursive: true });

  if (!existsSync(join(workspacePath, ".git"))) {
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
    await execGit(["clone", url, workspacePath]);
  }

  await ensureForgeBareOrigin(workspacePath, url);
  try {
    await execGit(["fetch", "--prune", "origin"], { cwd: workspacePath });
  } catch (err) {
    throw new Error(`Failed to fetch origin: ${formatGitError(err)}`);
  }

  await checkoutRequestedBranch(workspacePath, branch);
}

async function remoteHasBranch(
  workspacePath: string,
  branch: string,
): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--verify", `origin/${branch}`], {
      cwd: workspacePath,
    });
    return true;
  } catch {
    return false;
  }
}

async function cloneWatchBranch(
  project: Project,
  workspacePath: string,
): Promise<void> {
  const url = projectRemoteUrl(project);
  mkdirSync(join(workspacePath, ".."), { recursive: true });
  if (!existsSync(join(workspacePath, ".git"))) {
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
    await execGit(["clone", "--branch", project.branch, url, workspacePath]);
  }
  await ensureForgeBareOrigin(workspacePath, url);
  try {
    await execGit(["fetch", "--prune", "origin"], { cwd: workspacePath });
  } catch (err) {
    throw new Error(`Failed to fetch origin: ${formatGitError(err)}`);
  }
  await execGit(["checkout", project.branch], { cwd: workspacePath });
}

async function recordWorkspaceRow(
  projectId: string,
  branch: string,
  workspacePath: string,
  status: BranchWorkspaceStatus,
): Promise<BranchWorkspace> {
  const name = branchContainerName(projectId, branch);
  const existing = getBranchWorkspace(projectId, branch);
  return upsertWorkspaceRow({
    id: existing?.id ?? randomUUID(),
    projectId,
    branch,
    workspacePath,
    containerName: name,
    status,
    createdAt: existing?.createdAt ?? new Date(),
  });
}

export async function createBranchWorkspace(
  project: Project,
  branch: string,
): Promise<BranchWorkspace> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch is required");
  if (trimmed === project.branch) {
    throw new Error(
      `Cannot create a branch named "${trimmed}" — that is the deploy branch`,
    );
  }
  if (getBranchWorkspace(project.id, trimmed)) {
    throw new Error(`Branch "${trimmed}" already exists`);
  }

  const workspacePath = branchWorkspacePath(project.id, trimmed);
  try {
    await cloneWatchBranch(project, workspacePath);
    if (await remoteHasBranch(workspacePath, trimmed)) {
      throw new Error(`Branch "${trimmed}" already exists`);
    }
    await execGit(["checkout", "-b", trimmed], { cwd: workspacePath });
    await ensureForgeBareOrigin(workspacePath, projectRemoteUrl(project));
    await execGit(["push", "-u", "origin", trimmed], { cwd: workspacePath });

    let status: BranchWorkspaceStatus = "running";
    try {
      await startOrReuseContainer(project.id, trimmed, workspacePath);
    } catch {
      status = "stopped";
    }
    return recordWorkspaceRow(project.id, trimmed, workspacePath, status);
  } catch (err) {
    await destroyBranchWorkspace(project.id, trimmed);
    throw err;
  }
}

function buildBranchContainerRunArgs(input: {
  name: string;
  projectId: string;
  branch: string;
  hostBind: string;
  image: string;
}): string[] {
  if (mountArgTargetsDockerSock(input.hostBind)) {
    throw new Error(
      `Refusing workspace bind that looks like a container socket: ${input.hostBind}`,
    );
  }
  return [
    "run",
    "-d",
    "--name",
    input.name,
    "--network",
    "host",
    "--label",
    `forge.branch.project=${input.projectId}`,
    "--label",
    `forge.branch.ref=${input.branch}`,
    "--user",
    "0:0",
    "-v",
    `${input.hostBind}:/workspace/repo:z`,
    input.image,
  ];
}

async function startOrReuseContainer(
  projectId: string,
  branch: string,
  workspacePath: string,
): Promise<void> {
  const name = branchContainerName(projectId, branch);
  const image = DEFAULT_BRANCH_IMAGE;
  const hostBind = await resolveHostBindPath(workspacePath);
  const live = await inspectNamed(name);
  if (live?.running) return;
  if (live) {
    await runDocker(["start", name]);
    return;
  }
  try {
    await runDocker(["image", "inspect", image]);
  } catch {
    // local-only image; `run` fails if it is truly missing
  }
  await runDocker(
    buildBranchContainerRunArgs({
      name,
      projectId,
      branch,
      hostBind,
      image,
    }),
  );
}

export async function resolveBranchWorkspacePath(
  project: Project,
  branch: string,
  override?: string,
): Promise<string> {
  if (override?.trim()) return override.trim();
  return (await ensureBranchWorkspace(project, branch)).workspacePath;
}

const ensureInflight = new Map<string, Promise<BranchWorkspace>>();

async function ensureBranchWorkspaceUnlocked(
  project: Project,
  branch: string,
): Promise<BranchWorkspace> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch is required");

  const workspacePath = branchWorkspacePath(project.id, trimmed);
  await ensureGitCheckout(project, trimmed, workspacePath);

  let status: BranchWorkspaceStatus = "running";
  try {
    await startOrReuseContainer(project.id, trimmed, workspacePath);
  } catch {
    status = "stopped";
  }

  return recordWorkspaceRow(project.id, trimmed, workspacePath, status);
}

export async function ensureBranchWorkspace(
  project: Project,
  branch: string,
): Promise<BranchWorkspace> {
  const key = `${project.id}\0${branch.trim()}`;
  const pending = ensureInflight.get(key);
  if (pending) return pending;
  const next = ensureBranchWorkspaceUnlocked(project, branch).finally(() => {
    ensureInflight.delete(key);
  });
  ensureInflight.set(key, next);
  return next;
}

export async function pauseBranchWorkspace(
  projectId: string,
  branch: string,
): Promise<void> {
  const row = getBranchWorkspace(projectId, branch);
  const name = row?.containerName ?? branchContainerName(projectId, branch);
  try {
    await runDocker(["stop", "-t", "5", name]);
  } catch {
    // already stopped / missing
  }
  if (row) {
    db.update(branchWorkspaces)
      .set({ status: "paused" })
      .where(eq(branchWorkspaces.id, row.id))
      .run();
  }
}

export async function resumeBranchWorkspace(
  projectId: string,
  branch: string,
): Promise<void> {
  const row = getBranchWorkspace(projectId, branch);
  if (!row) return;
  try {
    await startOrReuseContainer(projectId, branch, row.workspacePath);
    db.update(branchWorkspaces)
      .set({ status: "running" })
      .where(eq(branchWorkspaces.id, row.id))
      .run();
  } catch {
    db.update(branchWorkspaces)
      .set({ status: "stopped" })
      .where(eq(branchWorkspaces.id, row.id))
      .run();
  }
}

export async function destroyBranchWorkspace(
  projectId: string,
  branch: string,
): Promise<void> {
  const row = getBranchWorkspace(projectId, branch);
  const name = row?.containerName ?? branchContainerName(projectId, branch);
  try {
    await runDocker(["rm", "-f", name]);
  } catch {
    // missing
  }
  const path = row?.workspacePath ?? branchWorkspacePath(projectId, branch);
  rmSync(path, { recursive: true, force: true });
  if (row) {
    db.delete(branchWorkspaces).where(eq(branchWorkspaces.id, row.id)).run();
  }
}

export async function destroyProjectBranchWorkspaces(
  projectId: string,
): Promise<void> {
  const rows = db
    .select()
    .from(branchWorkspaces)
    .where(eq(branchWorkspaces.projectId, projectId))
    .all();
  for (const row of rows) {
    await destroyBranchWorkspace(projectId, row.branch);
  }
}

export { buildBranchContainerRunArgs };
