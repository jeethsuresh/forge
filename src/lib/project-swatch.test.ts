import { describe, expect, it } from "vitest";
import {
  PROJECT_SWATCH_PALETTE,
  projectSwatch,
  projectSwatchIndex,
} from "@/lib/project-swatch";

describe("projectSwatch", () => {
  it("is stable for the same project id", () => {
    const a = projectSwatch("proj-abc");
    const b = projectSwatch("proj-abc");
    expect(a.hex).toBe(b.hex);
    expect(projectSwatchIndex("proj-abc")).toBe(projectSwatchIndex("proj-abc"));
  });

  it("picks from the curated palette", () => {
    const swatch = projectSwatch("another-id");
    expect(PROJECT_SWATCH_PALETTE).toContain(swatch.hex);
  });

  it("varies across different ids", () => {
    const indices = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(projectSwatchIndex),
    );
    expect(indices.size).toBeGreaterThan(1);
  });
});
