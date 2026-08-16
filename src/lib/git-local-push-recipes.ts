import { forgeHttpsUrlWithToken } from "@/lib/git-https-auth";

export function forgeLocalAgentsNote(): string {
  return `## Git remotes (Forge)

Push to Forge by default. If \`origin\` is this Forge URL, use \`git push -u origin <branch>\`.
If \`origin\` still points at GitHub, use the \`forge\` remote (\`git config remote.pushDefault forge\`) and do not \`git push origin\` unless a human asked to update GitHub.
Deploy and agents clone from Forge when this project has a Forge git repository.
`;
}

export function localPushRecipes(opts: {
  httpsUrl: string;
  defaultBranch: string;
  /** Per-repo fgc.* clone token; embeds into remote URLs when set. */
  cloneToken?: string | null;
}): { noOrigin: string; existingOrigin: string } {
  const rawUrl = opts.httpsUrl.trim();
  const url =
    opts.cloneToken?.trim()
      ? forgeHttpsUrlWithToken(rawUrl, opts.cloneToken.trim())
      : rawUrl;
  const branch = opts.defaultBranch.trim() || "main";
  const note = forgeLocalAgentsNote();
  const appendAgents = `cat >> AGENTS.md << 'EOF'\n${note}EOF`;

  const noOrigin = [
    "cd /path/to/repo",
    "git init   # skip if already a repo",
    `git remote add origin ${url}`,
    appendAgents,
    "git add AGENTS.md",
    'git commit -m "docs: push to Forge by default"',
    `git push -u origin ${branch}`,
  ].join("\n");

  const existingOrigin = [
    "cd /path/to/repo",
    `git remote add forge ${url}`,
    "git config remote.pushDefault forge",
    appendAgents,
    "git add AGENTS.md",
    'git commit -m "docs: push to Forge by default"',
    `git push -u forge ${branch}`,
  ].join("\n");

  return { noOrigin, existingOrigin };
}
