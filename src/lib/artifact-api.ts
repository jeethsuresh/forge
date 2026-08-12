import { basename } from "path";
import {
  getArtifactBuild,
  listArtifactBuilds,
} from "@/lib/artifact-build";
import {
  createDiskArtifactStorage,
  verifyArtifactDownloadToken,
} from "@/lib/artifact-storage";
import { listArtifacts } from "@/lib/forgefile-project";
import { resolveArtifactsRoot } from "@/lib/paths";
import type { Artifact, ArtifactBuild } from "@/lib/db/schema";

function toIso(value: Date | number | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

export type ArtifactBuildApi = {
  id: string;
  artifactId: string;
  projectId: string;
  status: ArtifactBuild["status"];
  commitSha: string | null;
  branch: string | null;
  storageKey: string | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type ArtifactApi = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  buildCommand: string;
  outputPath: string;
  contentType: string | null;
  updatedAt: string;
  builds: ArtifactBuildApi[];
};

export function serializeArtifactBuild(row: ArtifactBuild): ArtifactBuildApi {
  return {
    id: row.id,
    artifactId: row.artifactId,
    projectId: row.projectId,
    status: row.status,
    commitSha: row.commitSha,
    branch: row.branch,
    storageKey: row.storageKey,
    sizeBytes: row.sizeBytes,
    errorMessage: row.errorMessage,
    startedAt: toIso(row.startedAt) ?? new Date(0).toISOString(),
    completedAt: toIso(row.completedAt),
  };
}

export function serializeArtifact(
  row: Artifact,
  builds: ArtifactBuild[],
): ArtifactApi {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    buildCommand: row.buildCommand,
    outputPath: row.outputPath,
    contentType: row.contentType,
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
    builds: builds.map(serializeArtifactBuild),
  };
}

export function listProjectArtifactsApi(projectId: string): ArtifactApi[] {
  const decls = listArtifacts(projectId);
  return decls.map((decl) => {
    const builds = listArtifactBuilds(projectId, decl.name, 10);
    return serializeArtifact(decl, builds);
  });
}

export type ArtifactDownloadResult =
  | {
      ok: true;
      absolutePath: string;
      contentType: string;
      filename: string;
      sizeBytes: number | null;
    }
  | { ok: false; status: number; error: string };

export async function openArtifactDownload(opts: {
  projectId: string;
  name: string;
  buildId: string;
  token?: string | null;
}): Promise<ArtifactDownloadResult> {
  const build = getArtifactBuild(opts.buildId);
  if (!build || build.projectId !== opts.projectId) {
    return { ok: false, status: 404, error: "Build not found" };
  }

  const decls = listArtifacts(opts.projectId);
  const artifact = decls.find((a) => a.name === opts.name);
  if (!artifact || build.artifactId !== artifact.id) {
    return { ok: false, status: 404, error: "Artifact build not found" };
  }

  if (build.status !== "success" || !build.storageKey) {
    return {
      ok: false,
      status: 409,
      error: build.errorMessage
        ? `Build failed: ${build.errorMessage}`
        : "Build is not available for download",
    };
  }

  if (opts.token) {
    if (!verifyArtifactDownloadToken(opts.token, build.storageKey)) {
      return {
        ok: false,
        status: 403,
        error: "Invalid or expired download token",
      };
    }
  }

  const storage = createDiskArtifactStorage(resolveArtifactsRoot());
  const got = await storage.get(build.storageKey);
  if (!got) {
    return {
      ok: false,
      status: 404,
      error: "Artifact file missing from storage",
    };
  }

  return {
    ok: true,
    absolutePath: got.absolutePath,
    contentType: artifact.contentType ?? "application/octet-stream",
    filename: basename(artifact.outputPath),
    sizeBytes: build.sizeBytes,
  };
}
