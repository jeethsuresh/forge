export const PROJECT_BOOTSTRAP_PROMPT = `You are bootstrapping this Forge project after it was just created.

Do the following:
1. If files were imported from a host folder, confirm the import looks complete and leave the working tree clean.
2. Ensure there is a valid root Forgefile (create or fix it). Deploys fail closed without one.
3. Ensure docker-compose.yml (or compose.yml) exists and is valid. Include a service named app, and use \${HOST_PORT} for the public bind when a port is published. Follow Forge compose conventions (COMPOSE_PROJECT_NAME / --project-name).
4. Rewrite README.md so it describes this project instead of the seed stub.
5. Do not commit registry passwords or other Forge deploy-env secrets. Be careful with imported .env files.
6. Do not deploy unless the human asks. They will use Finish & deploy or Compose merge & deploy.`;

export function projectBootstrapPrompt(opts: {
  projectName: string;
  hostPath?: string | null;
}): string {
  const importLine = opts.hostPath?.trim()
    ? `Host folder imported from: ${opts.hostPath.trim()}`
    : "No host folder was imported; this started from the Forge seed commit.";
  return `${PROJECT_BOOTSTRAP_PROMPT}\n\nProject: ${opts.projectName}\n${importLine}\n`;
}
