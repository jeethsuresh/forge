import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Forgefile } from "@/lib/forgefile-types";
import {
  resolveDeployTargetName,
  resolveRunString,
  runForgeCommand,
  splitRunCommand,
} from "@/lib/forgefile-run";

const MINIMAL: Forgefile = {
  version: 1,
  project: { name: "demo" },
  scripts: {
    build: { run: "./build.sh" },
    migrate: { run: "./scripts/migrate.sh" },
  },
  deployments: {
    web: {
      auto_deploy: false,
      scripts: { deploy: "./deploy.sh" },
      ports: [],
    },
  },
  artifacts: {},
  agent: { packages: [] },
};

describe("resolveRunString", () => {
  it("returns inline commands as-is", () => {
    expect(resolveRunString(MINIMAL, "./deploy.sh --target web")).toBe(
      "./deploy.sh --target web",
    );
  });

  it("resolves named script refs", () => {
    expect(resolveRunString(MINIMAL, "build")).toBe("./build.sh");
  });

  it("throws on unknown refs", () => {
    expect(() => resolveRunString(MINIMAL, "missing")).toThrow(/unknown script/i);
  });
});

describe("splitRunCommand", () => {
  it("splits on whitespace", () => {
    expect(splitRunCommand("./deploy.sh --target web")).toEqual([
      "./deploy.sh",
      "--target",
      "web",
    ]);
  });
});

describe("resolveDeployTargetName", () => {
  it("uses the single target when unspecified", () => {
    expect(resolveDeployTargetName(["web"])).toBe("web");
  });

  it("honors an explicit request", () => {
    expect(resolveDeployTargetName(["web", "api"], "api")).toBe("api");
  });

  it("throws when multiple targets and none specified", () => {
    expect(() => resolveDeployTargetName(["web", "api"])).toThrow(/specify deployment/i);
  });
});

describe("runForgeCommand", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the script with command args before forge args", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ff-run-"));
    const scriptPath = join(tempDir, "echo-script.sh");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
printf '%s\\n' "$@"
`,
    );
    chmodSync(scriptPath, 0o755);

    const lines: string[] = [];
    await runForgeCommand("./echo-script.sh --from-file", tempDir, (line) => {
      lines.push(line);
    }, { args: ["--project-name", "demo"] });

    const joined = lines.join("\n");
    expect(joined).toContain("--from-file");
    expect(joined).toContain("--project-name");
    expect(joined).toContain("demo");
    const fromIdx = joined.indexOf("--from-file");
    const projectIdx = joined.indexOf("--project-name");
    expect(fromIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeGreaterThan(fromIdx);
  });
});
