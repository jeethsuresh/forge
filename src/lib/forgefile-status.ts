import type { Forgefile } from "@/lib/forgefile-types";
import {
  getProjectForgefile,
  listDeployTargets,
  projectForgefile,
} from "@/lib/forgefile-project";
import { resolveClonePath } from "@/lib/paths";
import type { Project } from "@/lib/db/schema";

export type ForgefileStatusPayload = {
  status: "missing" | "invalid" | "valid" | "unknown";
  contentHash: string | null;
  commitSha: string | null;
  sourcePath: string | null;
  errorMessage: string | null;
  forgefile: Forgefile | null;
  deployTargets: Array<{
    name: string;
    description: string | null;
    autoDeploy: boolean;
    subdomain: string | null;
    composeSlug: string | null;
    ports: unknown;
    scripts: unknown;
  }>;
};

export function buildForgefileStatusPayload(
  project: Project,
  options?: { refresh?: boolean },
): ForgefileStatusPayload {
  if (options?.refresh !== false) {
    try {
      projectForgefile(project.id, resolveClonePath(project.clonePath));
    } catch {
      // Projection errors are persisted by projectForgefile when possible.
    }
  }

  const row = getProjectForgefile(project.id);
  if (!row) {
    return {
      status: "unknown",
      contentHash: null,
      commitSha: null,
      sourcePath: null,
      errorMessage: "Forgefile has not been projected yet",
      forgefile: null,
      deployTargets: [],
    };
  }

  let forgefile: Forgefile | null = null;
  if (row.status === "valid") {
    try {
      forgefile = JSON.parse(row.parsedJson) as Forgefile;
    } catch {
      forgefile = null;
    }
  }

  const deployTargets = listDeployTargets(project.id).map((t) => ({
    name: t.name,
    description: t.description,
    autoDeploy: t.autoDeploy,
    subdomain: t.subdomain,
    composeSlug: t.composeSlug,
    ports: JSON.parse(t.portsJson || "[]") as unknown,
    scripts: JSON.parse(t.scriptsJson || "{}") as unknown,
  }));

  return {
    status: row.status,
    contentHash: row.contentHash,
    commitSha: row.commitSha,
    sourcePath: row.sourcePath,
    errorMessage: row.errorMessage,
    forgefile,
    deployTargets,
  };
}
