import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const harnessDir = join(process.cwd(), "scripts/test/harness");

function runHarness(script: string): void {
  const result = spawnSync("bash", [join(harnessDir, script)], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${script} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

describe("shell harness Layer B", () => {
  it("resolve_docker_socket trusts configured path when TCP is ready", () => {
    runHarness("resolve-docker-socket.sh");
  });

  it("normalize_source_permissions chowns root:root under FORGE_RUN_AS_ROOT", () => {
    runHarness("normalize-source-permissions.sh");
  });

  it("runtime probe fails with clear daemon error not buildx-only", () => {
    runHarness("build-preflight.sh");
  });

  it("compose build uses host network for RUN instructions", () => {
    runHarness("compose-build-network.sh");
  });

  it("npm ci retries after node-gyp ETIMEDOUT", () => {
    runHarness("npm-ci-retry.sh");
  });

  it("agent container uses host workspace binds and local forge-agent image", () => {
    runHarness("agent-container-startup.sh");
  });

  it("agent git checkout on a bind-mounted repo needs uid 0 (exit 128 otherwise)", () => {
    runHarness("agent-container-git-bind.sh");
  });
});
