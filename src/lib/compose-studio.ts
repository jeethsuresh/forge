import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { findComposeFile } from "@/lib/docker";
import { IMAGE_STARTER_COMPOSE } from "@/lib/git-seed-image-project";
import { parseComposeYaml } from "@/lib/compose-document";
import { resolveClonePath } from "@/lib/paths";
import {
  checkoutLocalBranch,
  commitAllChanges,
  createBranchFromBase,
  pushBranch,
} from "@/lib/git-workspace";
import { mergeProjectBranch } from "@/lib/project-git-tree";
import { deployProject } from "@/lib/project-deploy";
import { projectRemoteUrl } from "@/lib/project-git-remote";

function composeBranchName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `forge/compose-${stamp}`;
}

function envPath(repoPath: string): string {
  return join(repoPath, ".env");
}

export type ComposeStudioState = {
  fileName: string | null;
  yaml: string;
  envText: string;
  warnings: string[];
  watchBranch: string;
};

export function readComposeStudioState(clonePath: string, watchBranch: string): ComposeStudioState {
  const repoPath = resolveClonePath(clonePath);
  const fileName = findComposeFile(repoPath);
  const yaml = fileName
    ? readFileSync(join(repoPath, fileName), "utf8")
    : "";
  const envFile = envPath(repoPath);
  const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const parsed = yaml ? parseComposeYaml(yaml) : { ok: true as const, warnings: [] as string[] };
  const warnings = parsed.ok ? parsed.warnings : [parsed.error];
  return { fileName, yaml, envText, warnings, watchBranch };
}

export async function saveComposeOnNewBranch(opts: {
  projectId: string;
  yaml: string;
  envText?: string;
  createIfMissing?: boolean;
}): Promise<{ branch: string; commitSha: string; fileName: string }> {
  const parsed = parseComposeYaml(opts.yaml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  const project = db.select().from(projects).where(eq(projects.id, opts.projectId)).get();
  if (!project) throw new Error("Project not found");
  const repoPath = resolveClonePath(project.clonePath);
  const watchBranch = project.branch;
  const branch = composeBranchName();
  const remote = projectRemoteUrl(project);

  await createBranchFromBase(remote, watchBranch, repoPath, branch, () => {});

  let fileName = findComposeFile(repoPath);
  if (!fileName) {
    if (!opts.createIfMissing && !opts.yaml.trim()) {
      throw new Error("No compose file in this project");
    }
    fileName = "docker-compose.yml";
  }
  const composeDest = join(repoPath, fileName);
  mkdirSync(dirname(composeDest), { recursive: true });
  writeFileSync(composeDest, opts.yaml.endsWith("\n") ? opts.yaml : `${opts.yaml}\n`);

  if (opts.envText !== undefined) {
    writeFileSync(envPath(repoPath), opts.envText);
  }

  const commitSha = await commitAllChanges(
    repoPath,
    `chore: update ${fileName}`,
  );
  if (!commitSha) {
    throw new Error("No compose changes to save");
  }
  await pushBranch(repoPath, branch);
  return { branch, commitSha, fileName };
}

export async function createStarterComposeBranch(projectId: string): Promise<{
  branch: string;
  commitSha: string;
  fileName: string;
}> {
  return saveComposeOnNewBranch({
    projectId,
    yaml: IMAGE_STARTER_COMPOSE,
    createIfMissing: true,
  });
}

export async function mergeComposeAndDeploy(opts: {
  projectId: string;
  branch: string;
}): Promise<{ deploymentId: string }> {
  const project = db.select().from(projects).where(eq(projects.id, opts.projectId)).get();
  if (!project) throw new Error("Project not found");
  const branch = opts.branch.trim();
  if (!branch.startsWith("forge/compose-")) {
    throw new Error("Refusing to merge a non-compose branch");
  }
  await mergeProjectBranch(project.clonePath, branch, project.branch, {
    watchBranch: project.branch,
  });
  await checkoutLocalBranch(project.clonePath, project.branch, () => {});
  const result = await deployProject({
    projectId: opts.projectId,
    branch: project.branch,
    trigger: "manual",
  });
  return { deploymentId: result.deploymentId };
}
