import type { ProjectGitGraph } from "@/lib/project-git-graph";

export const COL_WIDTH = 52;
export const LANE_HEIGHT = 48;
export const GRAPH_PADDING_X = 20;
export const GRAPH_PADDING_Y = 12;

export const BRANCH_COLORS = [
  "#fb923c",
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#facc15",
];

export interface GraphNode {
  sha: string;
  x: number;
  y: number;
  lane: number;
  isHead: boolean;
}

export interface GraphTrack {
  branch: string;
  path: string;
  color: string;
  dashed?: boolean;
}

export interface GraphLayout {
  columns: string[];
  nodes: GraphNode[];
  tracks: GraphTrack[];
  width: number;
  height: number;
  laneByBranch: Record<string, number>;
}

export type GraphPreviewOp =
  | { kind: "merge"; source: string; target: string }
  | { kind: "rebase"; source: string; onto: string }
  | null;

function laneY(lane: number): number {
  return GRAPH_PADDING_Y + lane * LANE_HEIGHT + LANE_HEIGHT / 2;
}

function columnX(column: number): number {
  return GRAPH_PADDING_X + column * COL_WIDTH;
}

/** Prefer the lowest lane index so shared commits sit on a named branch row. */
function primaryLane(lanes: number[]): number {
  if (lanes.length === 0) return 0;
  return Math.min(...lanes);
}

export function buildGraphLayout(
  graph: ProjectGitGraph,
  preview: GraphPreviewOp = null,
): GraphLayout {
  const branchOrder = graph.branches.map((branch) => branch.name);
  const laneByBranch = new Map(
    branchOrder.map((name, index) => [name, index] as const),
  );
  const shaToColumn = new Map(
    graph.columns.map((sha, index) => [sha, index] as const),
  );
  const branchHeads = new Set(
    graph.branches.map((branch) => branch.headSha).filter(Boolean),
  );

  const nodeLanes = new Map<string, number[]>();
  for (const [branchName, path] of Object.entries(graph.branchPaths)) {
    const lane = laneByBranch.get(branchName);
    if (lane === undefined) continue;
    for (const sha of path) {
      const lanes = nodeLanes.get(sha) ?? [];
      lanes.push(lane);
      nodeLanes.set(sha, lanes);
    }
  }

  const nodes: GraphNode[] = graph.columns.map((sha) => {
    const column = shaToColumn.get(sha) ?? 0;
    const lanes = nodeLanes.get(sha) ?? [0];
    const lane = primaryLane(lanes);
    return {
      sha,
      x: columnX(column),
      y: laneY(lane),
      lane,
      isHead: branchHeads.has(sha),
    };
  });

  const nodeBySha = new Map(nodes.map((node) => [node.sha, node] as const));
  const tracks: GraphTrack[] = branchOrder.map((branchName, index) => {
    const path = graph.branchPaths[branchName] ?? [];
    const points = path
      .map((sha) => nodeBySha.get(sha))
      .filter((node): node is GraphNode => node !== undefined);
    const pathData =
      points.length === 0
        ? ""
        : `M ${points.map((point) => `${point.x},${point.y}`).join(" L ")}`;
    return {
      branch: branchName,
      path: pathData,
      color: BRANCH_COLORS[index % BRANCH_COLORS.length] ?? "#94a3b8",
    };
  });

  if (preview?.kind === "merge") {
    const sourceHead = graph.branches.find((b) => b.name === preview.source)?.headSha;
    const targetHead = graph.branches.find((b) => b.name === preview.target)?.headSha;
    const from = sourceHead ? nodeBySha.get(sourceHead) : undefined;
    const to = targetHead ? nodeBySha.get(targetHead) : undefined;
    if (from && to) {
      tracks.push({
        branch: `preview-merge-${preview.source}-${preview.target}`,
        path: `M ${from.x},${from.y} L ${to.x},${to.y}`,
        color: "#fbbf24",
        dashed: true,
      });
    }
  }

  if (preview?.kind === "rebase") {
    const sourceLane = laneByBranch.get(preview.source);
    const ontoHead = graph.branches.find((b) => b.name === preview.onto)?.headSha;
    const ontoNode = ontoHead ? nodeBySha.get(ontoHead) : undefined;
    const sourcePath = graph.branchPaths[preview.source] ?? [];
    const sourceExclusive = sourcePath.filter((sha) => {
      const lanes = nodeLanes.get(sha) ?? [];
      return lanes.length === 1 && lanes[0] === sourceLane;
    });

    if (ontoNode && sourceLane !== undefined && sourceExclusive.length > 0) {
      const previewPoints = [
        ontoNode,
        ...sourceExclusive.map((sha, index) => ({
          sha,
          x: columnX((shaToColumn.get(ontoHead!) ?? 0) + 1 + index),
          y: laneY(sourceLane),
          lane: sourceLane,
          isHead: false,
        })),
      ];
      tracks.push({
        branch: `preview-rebase-${preview.source}-${preview.onto}`,
        path: `M ${previewPoints.map((p) => `${p.x},${p.y}`).join(" L ")}`,
        color: "#fbbf24",
        dashed: true,
      });
      for (const point of previewPoints.slice(1)) {
        nodes.push({
          ...point,
          isHead: false,
        });
      }
    }
  }

  const width =
    GRAPH_PADDING_X * 2 +
    Math.max(graph.columns.length - 1, 0) * COL_WIDTH +
    COL_WIDTH;
  const height =
    GRAPH_PADDING_Y * 2 + Math.max(branchOrder.length, 1) * LANE_HEIGHT;

  return {
    columns: graph.columns,
    nodes,
    tracks,
    width,
    height,
    laneByBranch: Object.fromEntries(laneByBranch),
  };
}
