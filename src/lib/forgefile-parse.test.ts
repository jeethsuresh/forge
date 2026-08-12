import { describe, expect, it } from "vitest";
import { parseForgefileYaml } from "@/lib/forgefile-parse";

const MINIMAL = `
version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    scripts:
      build: build
      deploy: ./deploy.sh --target web
    ports:
      - name: http
        port: 8080
        public: true
`;

describe("parseForgefileYaml", () => {
  it("parses a minimal valid Forgefile", () => {
    const result = parseForgefileYaml(MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    expect(result.value.project.name).toBe("demo");
    expect(result.value.deployments.web.auto_deploy).toBe(false);
    expect(result.value.deployments.web.ports[0]?.port).toBe(8080);
  });

  it("rejects missing version", () => {
    const result = parseForgefileYaml("project:\n  name: x\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /version/i.test(e.message))).toBe(true);
  });

  it("rejects empty deployments", () => {
    const result = parseForgefileYaml(`
version: 1
project:
  name: demo
scripts: {}
deployments: {}
`);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate host ports across deployments", () => {
    const result = parseForgefileYaml(`
version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  a:
    scripts:
      deploy: ./deploy.sh -t a
    ports:
      - name: http
        port: 8080
        public: true
  b:
    scripts:
      deploy: ./deploy.sh -t b
    ports:
      - name: http
        port: 8080
        public: false
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /port/i.test(e.message))).toBe(true);
  });
});
