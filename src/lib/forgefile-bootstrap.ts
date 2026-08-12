/** Reuse the existing manual agent session source for Forgefile bootstrap. */
export const FORGEFILE_BOOTSTRAP_SOURCE = "manual" as const;

export function buildForgefileBootstrapPrompt(projectName: string): string {
  return `Create a valid root Forgefile for project "${projectName}".

Requirements:
1. Add a YAML \`Forgefile\` at the repository root with \`version: 1\`.
2. Follow patterns in \`docs/forgefile.template.yml\` (or copy and trim unused options).
3. Inspect existing repo scripts (\`build.sh\`, \`test.sh\`, \`deploy.sh\`, \`teardown.sh\`, and any maintenance scripts) and declare them under \`scripts\` and at least one \`deployments\` target.
4. Prefer script references for shared build/test commands; use inline \`run\` strings when a deploy target needs distinct flags.
5. Leave \`auto_deploy\` false unless the operator already relies on watcher deploys for a target.
6. Commit the Forgefile (and only related docs if needed). Do not deploy until the Forgefile validates.

Until the Forgefile is valid, do not start a production deploy.`;
}
