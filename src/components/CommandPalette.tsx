"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  buildStaticPaletteItems,
  projectPaletteItems,
  rankPaletteItems,
  type PaletteItem,
  type RankedPaletteItem,
} from "@/lib/command-palette/rank";
import { projectSwatch } from "@/lib/project-swatch";
import { Kbd } from "@/components/ui";

type ProjectSummary = {
  id: string;
  name: string;
  githubRepo?: string;
  branch?: string;
  isForge?: boolean;
};

type ProjectsResponse = {
  forgeProject: ProjectSummary | null;
  projects: ProjectSummary[];
};

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);

  const projectIdMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = projectIdMatch?.[1] ?? null;
  const tab = searchParams.get("tab");
  const sessionId = searchParams.get("session");

  const loadProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: ProjectsResponse) => {
        const list: ProjectSummary[] = [];
        if (data.forgeProject) list.push(data.forgeProject);
        list.push(...(data.projects ?? []));
        setProjects(list);
      })
      .catch(() => setProjects([]));
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setSelected(0);
    setOpen(true);
    openRef.current = true;
    loadProjects();
    window.setTimeout(() => inputRef.current?.focus(), 10);
  }, [loadProjects]);

  const closePalette = useCallback(() => {
    setOpen(false);
    openRef.current = false;
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) closePalette();
        else openPalette();
        return;
      }
      if (e.key === "Escape" && openRef.current) {
        e.preventDefault();
        closePalette();
      }
    }
    function onOpen() {
      openPalette();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("forge:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("forge:open-palette", onOpen);
    };
  }, [openPalette, closePalette]);

  const corpus: PaletteItem[] = useMemo(() => {
    const items = [...buildStaticPaletteItems()];
    for (const project of projects) {
      items.push(...projectPaletteItems(project));
    }
    return items;
  }, [projects]);

  const ranked: RankedPaletteItem[] = useMemo(
    () =>
      rankPaletteItems(corpus, query, {
        pathname,
        projectId,
        tab,
        sessionId,
      }),
    [corpus, query, pathname, projectId, tab, sessionId],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${selected}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, ranked]);

  function runItem(item: RankedPaletteItem) {
    if (item.href) {
      router.push(item.href);
      closePalette();
    }
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(ranked.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = ranked[selected];
      if (item) runItem(item);
    }
  }

  if (!open) return null;

  const active = ranked[selected] ?? null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/70"
        onClick={closePalette}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 flex h-[min(92vh,920px)] w-[min(96vw,1100px)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <span className="text-sm text-zinc-500">Search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search projects, actions, settings… or type help"
            className="min-h-11 flex-1 bg-transparent text-base text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            ref={listRef}
            className="min-h-0 w-full overflow-y-auto border-r border-zinc-800 sm:w-[55%]"
          >
            {ranked.length === 0 ? (
              <p className="px-4 py-8 text-sm text-zinc-500">
                No matches. Try a project name, deploy, agents, or help.
              </p>
            ) : (
              <ul className="py-2">
                {ranked.map((item, index) => {
                  const swatch = item.projectId
                    ? projectSwatch(item.projectId)
                    : null;
                  const isActive = index === selected;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-palette-index={index}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => runItem(item)}
                        className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                          isActive
                            ? "bg-zinc-800/90"
                            : "hover:bg-zinc-900/80"
                        }`}
                        style={
                          swatch && isActive
                            ? { boxShadow: `inset 3px 0 0 0 ${swatch.hex}` }
                            : undefined
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-zinc-100">
                            {item.title}
                          </div>
                          {item.subtitle && (
                            <div className="truncate font-mono text-xs text-zinc-500">
                              {item.subtitle}
                            </div>
                          )}
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
                            {item.matchReason} · {item.kind}
                          </div>
                        </div>
                        {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="hidden min-h-0 w-[45%] flex-col overflow-y-auto p-5 sm:flex">
            {active ? (
              <>
                <h2 className="text-lg font-semibold text-zinc-100">
                  {active.title}
                </h2>
                {active.subtitle && (
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {active.subtitle}
                  </p>
                )}
                <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                  {active.docs}
                </p>
                {active.href && (
                  <p className="mt-4 text-xs text-zinc-500">
                    Opens{" "}
                    <Link
                      href={active.href}
                      className="font-mono text-orange-400 hover:text-orange-300"
                      onClick={closePalette}
                    >
                      {active.href}
                    </Link>
                  </p>
                )}
                <div className="mt-auto border-t border-zinc-800 pt-4 text-xs text-zinc-500">
                  <p className="mb-2 font-medium text-zinc-400">Tips</p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      Type <span className="font-mono">help</span> or{" "}
                      <span className="font-mono">?</span> for the catalog
                    </li>
                    <li>Results boost from your current page and selection</li>
                    <li>Destructive actions confirm on the target screen</li>
                  </ul>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">
                Select a result to see documentation.
              </p>
            )}
          </aside>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate · <Kbd>Enter</Kbd> open
          </span>
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-200"
            onClick={() => {
              setQuery("help");
              setSelected(0);
            }}
          >
            Full help
          </button>
        </div>
      </div>
    </div>
  );
}
