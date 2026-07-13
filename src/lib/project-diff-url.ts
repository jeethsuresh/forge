export type ProjectDiffMode =
  | "uncommitted"
  | "range"
  | "branch-vs-main"
  | "rebase"
  | "merge";

export interface ProjectDiffLinkParams {
  mode?: ProjectDiffMode;
  base?: string;
  head?: string;
  branch?: string;
  source?: string;
  onto?: string;
  target?: string;
  session?: string;
  file?: string;
}

export function buildProjectDiffHref(
  projectId: string,
  params: ProjectDiffLinkParams,
): string {
  const search = new URLSearchParams();
  search.set("tab", "diff");
  if (params.mode) search.set("mode", params.mode);
  if (params.base) search.set("base", params.base);
  if (params.head) search.set("head", params.head);
  if (params.branch) search.set("branch", params.branch);
  if (params.source) search.set("source", params.source);
  if (params.onto) search.set("onto", params.onto);
  if (params.target) search.set("target", params.target);
  if (params.session) search.set("session", params.session);
  if (params.file) search.set("file", params.file);
  return `/projects/${projectId}?${search.toString()}`;
}

export function agentSessionUncommittedDiffHref(
  projectId: string,
  sessionId: string,
): string {
  return buildProjectDiffHref(projectId, {
    mode: "uncommitted",
    session: sessionId,
  });
}

export function branchVsMainDiffHref(
  projectId: string,
  branch: string,
): string {
  return buildProjectDiffHref(projectId, {
    mode: "branch-vs-main",
    branch,
  });
}

export function rebasePreviewDiffHref(
  projectId: string,
  source: string,
  onto: string,
): string {
  return buildProjectDiffHref(projectId, {
    mode: "rebase",
    source,
    onto,
  });
}

export function mergePreviewDiffHref(
  projectId: string,
  source: string,
  target: string,
): string {
  return buildProjectDiffHref(projectId, {
    mode: "merge",
    source,
    target,
  });
}

export function commitRangeDiffHref(
  projectId: string,
  base: string,
  head: string,
): string {
  return buildProjectDiffHref(projectId, {
    mode: "range",
    base,
    head,
  });
}
