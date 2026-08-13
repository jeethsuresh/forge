import { projectModeHref } from "@/lib/project-routes";

export type PaletteContext = {
  pathname: string;
  projectId?: string | null;
  tab?: string | null;
  sessionId?: string | null;
};

export type PaletteItemKind =
  | "navigation"
  | "project"
  | "action"
  | "help"
  | "settings";

export type PaletteItem = {
  id: string;
  kind: PaletteItemKind;
  title: string;
  subtitle?: string;
  keywords: string[];
  href?: string;
  /** Documentation shown in the detail pane */
  docs: string;
  shortcut?: string;
  projectId?: string;
};

export type RankedPaletteItem = PaletteItem & {
  score: number;
  matchReason: string;
};

function normalize(q: string): string {
  return q.trim().toLowerCase();
}

function includesAll(haystack: string, needles: string[]): boolean {
  return needles.every((n) => haystack.includes(n));
}

function tokenScore(query: string, item: PaletteItem): number {
  const q = normalize(query);
  if (!q) return 0;
  const hay = normalize(
    [item.title, item.subtitle ?? "", ...item.keywords].join(" "),
  );
  if (hay === q) return 100;
  if (hay.startsWith(q)) return 80;
  if (hay.includes(q)) return 50;
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && includesAll(hay, parts)) return 40;
  // prefix tokens
  let score = 0;
  for (const part of parts) {
    if (hay.includes(part)) score += 12;
  }
  return score;
}

function contextBoost(item: PaletteItem, ctx: PaletteContext, query: string): number {
  let boost = 0;
  const q = normalize(query);
  const onProject =
    ctx.projectId &&
    (item.projectId === ctx.projectId ||
      item.href?.includes(`/projects/${ctx.projectId}`));

  if (onProject) boost += 25;

  if (ctx.tab === "deploy" && /deploy|rollback|stop|log/i.test(item.id + item.title)) {
    boost += 20;
  }
  if (ctx.tab === "agents" && /agent|session|end|finish|log/i.test(item.id + item.title)) {
    boost += 20;
  }
  if (ctx.tab === "settings" || ctx.tab === "config") {
    if (item.kind === "settings" || /settings|routing|env/i.test(item.title)) {
      boost += 15;
    }
  }

  if (q && /fail|error|attention|broken/i.test(q) && /fail|attention|error/i.test(item.title + item.id)) {
    boost += 30;
  }

  if (!q && item.kind === "help") boost -= 5;
  if (!q && item.id.startsWith("recent:")) boost += 10;

  return boost;
}

export function rankPaletteItems(
  items: PaletteItem[],
  query: string,
  ctx: PaletteContext,
): RankedPaletteItem[] {
  const q = normalize(query);
  const helpMode = q === "?" || q === "help" || q.startsWith("help ");

  const ranked: RankedPaletteItem[] = items.map((item) => {
    const base = q ? tokenScore(query, item) : item.kind === "help" ? 5 : 15;
    const boost = contextBoost(item, ctx, query);
    let score = base + boost;
    let matchReason = q
      ? base > 0
        ? "Matches search"
        : "Related"
      : "Suggested";

    if (helpMode) {
      if (item.kind === "help") {
        score += 100;
        matchReason = "Help catalog";
      } else {
        score += 10;
        matchReason = "Command reference";
      }
    }

    if (onProjectMatch(item, ctx) && !q) {
      matchReason = "Current project";
    }

    return { ...item, score, matchReason };
  });

  return ranked
    .filter((item) => {
      if (helpMode) return true;
      if (!q) return item.score > 0;
      return item.score >= 12;
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function onProjectMatch(item: PaletteItem, ctx: PaletteContext): boolean {
  return Boolean(
    ctx.projectId &&
      (item.projectId === ctx.projectId ||
        item.href?.includes(`/projects/${ctx.projectId}`)),
  );
}

export function buildStaticPaletteItems(): PaletteItem[] {
  return [
    {
      id: "nav:home",
      kind: "navigation",
      title: "Go to Home",
      subtitle: "Fleet command center",
      keywords: ["home", "fleet", "overview", "dashboard"],
      href: "/",
      docs: "Open the Home command center: fleet health, needs-attention, and one-click Deploy / Agents.",
      shortcut: "G H",
    },
    {
      id: "nav:settings",
      kind: "settings",
      title: "Global settings",
      subtitle: "Routing, Caddy, access logs",
      keywords: ["settings", "caddy", "routing", "logs"],
      href: "/settings",
      docs: "Configure project routing, live Caddy routes, and access logs.",
    },
    {
      id: "nav:new-project",
      kind: "navigation",
      title: "Add project",
      keywords: ["new", "add", "create", "project"],
      href: "/projects/new",
      docs: "Register a new watched repository.",
    },
    {
      id: "help:shortcuts",
      kind: "help",
      title: "Keyboard shortcuts",
      keywords: ["help", "shortcuts", "keys", "?"],
      docs: "⌘/Ctrl+K opens this palette. Esc closes. ↑↓ move, Enter selects. Type to search projects, actions, and settings. Prefix with help or ? for the full catalog.",
      shortcut: "⌘K",
    },
    {
      id: "help:palette",
      kind: "help",
      title: "What can I do?",
      keywords: ["help", "commands", "search"],
      docs: "Search projects by name or repo. Jump to Deploy, Agents, Changes, or Settings. Context from your current page boosts relevant actions. Destructive actions open the target screen for confirmation.",
    },
  ];
}

export function projectPaletteItems(project: {
  id: string;
  name: string;
  githubRepo?: string;
  branch?: string;
  isForge?: boolean;
}): PaletteItem[] {
  const label = project.name;
  return [
    {
      id: `project:${project.id}:open`,
      kind: "project",
      title: `Open ${label}`,
      subtitle: project.githubRepo,
      keywords: [label, project.githubRepo ?? "", project.branch ?? "", "open"],
      href: projectModeHref(project.id, "overview"),
      docs: `Open Overview for ${label}.`,
      projectId: project.id,
    },
    {
      id: `project:${project.id}:deploy`,
      kind: "action",
      title: `Deploy ${label}`,
      subtitle: "Open Deploy",
      keywords: [label, "deploy", "redeploy", "rollback"],
      href: projectModeHref(project.id, "deploy"),
      docs: `Jump to Deploy for ${label}. Confirm deploy/rollback on that screen.`,
      projectId: project.id,
    },
    {
      id: `project:${project.id}:agents`,
      kind: "action",
      title: `Agents · ${label}`,
      subtitle: "Open Agents",
      keywords: [label, "agent", "session", "chat"],
      href: projectModeHref(project.id, "agents"),
      docs: `Open agent sessions for ${label}.`,
      projectId: project.id,
    },
    {
      id: `project:${project.id}:changes`,
      kind: "action",
      title: `Changes · ${label}`,
      keywords: [label, "diff", "changes", "commit"],
      href: projectModeHref(project.id, "changes"),
      docs: `Open Changes for ${label}.`,
      projectId: project.id,
    },
    {
      id: `project:${project.id}:settings`,
      kind: "settings",
      title: `Settings · ${label}`,
      keywords: [label, "config", "settings", "env", "routing"],
      href: projectModeHref(project.id, "settings"),
      docs: `Project settings: rename, branches, routing, env, history.`,
      projectId: project.id,
    },
  ];
}
