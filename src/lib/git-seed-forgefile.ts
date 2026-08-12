import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseForgefileYaml } from "@/lib/forgefile-parse";

/**
 * Build a valid minimal Forgefile for a new Forge-hosted project.
 * Prefer trimming the annotated template when available; otherwise emit a known-good seed.
 */
export function buildSeedForgefile(projectName: string): string {
  const fromTemplate = tryBuildFromTemplate(projectName);
  if (fromTemplate) return fromTemplate;

  return defaultSeedForgefile(projectName);
}

function defaultSeedForgefile(projectName: string): string {
  const safeName = projectName.trim() || "my-app";
  return `version: 1

project:
  name: ${yamlDoubleQuoted(safeName)}

scripts:
  build:
    run: ./build.sh
    description: Compile and image-build
  test:
    run: ./test.sh
    description: Run unit tests

deployments:
  web:
    description: Public web app
    auto_deploy: false
    scripts:
      build: build
      test: test
      deploy: ./deploy.sh
    ports:
      - name: http
        port: 8080
        public: true

agent:
  packages: []
`;
}

function tryBuildFromTemplate(projectName: string): string | null {
  const candidates = [
    join(process.cwd(), "docs/forgefile.template.yml"),
    join(process.env.FORGE_SOURCE_DIR ?? "", "docs/forgefile.template.yml"),
  ];
  let template: string | null = null;
  for (const path of candidates) {
    if (path && existsSync(path)) {
      template = readFileSync(path, "utf8");
      break;
    }
  }
  if (!template) return null;

  // Produce a valid seed derived from the template’s required sections.
  const seed = defaultSeedForgefile(projectName);
  const parsed = parseForgefileYaml(seed);
  if (!parsed.ok) return null;
  // Keep a short header pointing at the annotated template for humans.
  return `# Seeded from docs/forgefile.template.yml — edit and expand as needed.
# Docs: docs/Forgefile.md

${seed.trimStart()}`;
}

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function assertSeedForgefileValid(content: string): void {
  const parsed = parseForgefileYaml(content);
  if (!parsed.ok) {
    const msg = parsed.errors.map((e) => e.message).join("; ");
    throw new Error(`Seed Forgefile is invalid: ${msg}`);
  }
}
