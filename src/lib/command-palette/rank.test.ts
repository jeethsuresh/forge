import { describe, expect, it } from "vitest";
import {
  buildStaticPaletteItems,
  projectPaletteItems,
  rankPaletteItems,
} from "@/lib/command-palette/rank";

describe("rankPaletteItems", () => {
  const items = [
    ...buildStaticPaletteItems(),
    ...projectPaletteItems({
      id: "p1",
      name: "Alpha",
      githubRepo: "org/alpha",
      branch: "main",
    }),
    ...projectPaletteItems({
      id: "p2",
      name: "Beta",
      githubRepo: "org/beta",
      branch: "main",
    }),
  ];

  it("boosts deploy actions when on deploy tab", () => {
    const ranked = rankPaletteItems(items, "", {
      pathname: "/projects/p1",
      projectId: "p1",
      tab: "deploy",
    });
    const topTitles = ranked.slice(0, 8).map((r) => r.title);
    expect(topTitles.some((t) => /Deploy Alpha/i.test(t))).toBe(true);
  });

  it("searches by project name", () => {
    const ranked = rankPaletteItems(items, "beta", {
      pathname: "/",
      projectId: null,
      tab: null,
    });
    expect(ranked[0]?.title).toMatch(/Beta/i);
  });

  it("surfaces help catalog for help query", () => {
    const ranked = rankPaletteItems(items, "help", {
      pathname: "/",
    });
    expect(ranked.some((r) => r.kind === "help")).toBe(true);
    expect(ranked[0]?.kind).toBe("help");
  });
});
