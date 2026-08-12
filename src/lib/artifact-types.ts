export type ArtifactBuildStatusApi =
  | "pending"
  | "running"
  | "success"
  | "failed";

export type ArtifactBuildApi = {
  id: string;
  artifactId: string;
  projectId: string;
  status: ArtifactBuildStatusApi;
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
