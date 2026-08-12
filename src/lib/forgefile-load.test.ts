import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadForgefile, resolveForgefilePath, hashForgefileSource } from "@/lib/forgefile-load";

const BODY = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    scripts:
      deploy: ./deploy.sh
`;

describe("forgefile-load", () => {
  it("prefers Forgefile over forgefile.yml", () => {
    const root = mkdtempSync(join(tmpdir(), "ff-"));
    writeFileSync(join(root, "Forgefile"), BODY);
    writeFileSync(join(root, "forgefile.yml"), BODY);
    expect(resolveForgefilePath(root)?.endsWith("Forgefile")).toBe(true);
  });

  it("errors when both files exist with different content", () => {
    const root = mkdtempSync(join(tmpdir(), "ff-"));
    writeFileSync(join(root, "Forgefile"), BODY);
    writeFileSync(join(root, "forgefile.yml"), BODY + "\n# drift\n");
    expect(() => loadForgefile(root)).toThrow(/both/i);
  });

  it("returns missing error when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "ff-"));
    const loaded = loadForgefile(root);
    expect(loaded.parsed.ok).toBe(false);
  });

  it("hashes stably", () => {
    expect(hashForgefileSource(BODY)).toBe(hashForgefileSource(BODY));
  });
});
