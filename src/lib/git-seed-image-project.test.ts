import { describe, expect, it } from "vitest";
import { parseForgefileYaml } from "@/lib/forgefile-parse";
import { buildImageProjectSeed } from "./git-seed-image-project";

describe("buildImageProjectSeed", () => {
  it("emits a valid Forgefile, app compose service, and IMAGE env", () => {
    const seed = buildImageProjectSeed({
      projectName: "Demo Nginx",
      image: "nginx:latest",
      containerPort: 80,
      hostPort: 3456,
    });

    const forgefile = seed.files.Forgefile;
    expect(forgefile).toBeTruthy();
    const parsed = parseForgefileYaml(forgefile);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.project.name).toBe("Demo Nginx");
      expect(parsed.value.deployments.web.auto_deploy).toBe(false);
      expect(parsed.value.deployments.web.ports?.[0]?.port).toBe(3456);
    }

    expect(seed.files["docker-compose.yml"]).toContain("app:");
    expect(seed.files["docker-compose.yml"]).toContain("${IMAGE}");
    expect(seed.files["docker-compose.yml"]).toContain(
      "${HOST_PORT}:${CONTAINER_PORT}",
    );
    expect(seed.files[".env"]).toContain("IMAGE=nginx:latest");
    expect(seed.files[".env"]).toContain("CONTAINER_PORT=80");
    expect(JSON.stringify(seed.files)).not.toMatch(/PASSWORD|secret-token/i);
    expect(seed.executable).toEqual(
      expect.arrayContaining([
        "build.sh",
        "test.sh",
        "deploy.sh",
        "teardown.sh",
        "scripts/lib/common.sh",
      ]),
    );
  });
});
