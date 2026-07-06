import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ENTRYPOINT = join(process.cwd(), "docker-entrypoint.sh");

describe("docker-entrypoint agent-home setup", () => {
  const script = readFileSync(ENTRYPOINT, "utf8");

  it("pre-creates the Cursor CLI chats directory under agent-home", () => {
    expect(script).toMatch(
      /mkdir -p[^\n]*\/data\/agent-home\/\.cursor\/chats/,
    );
  });

  it("recursively chowns agent-home for the node runtime user", () => {
    expect(script).toMatch(/chown -R node:node \/data\/repos \/data\/agent-home/);
    expect(script).not.toMatch(
      /chown -R node:node \/data\/repos \/data\/agent-home\/\.cache \/data\/agent-home\/\.config/,
    );
  });

  it("sets HOME to /data/agent-home before starting the app", () => {
    expect(script).toContain('AGENT_HOME="/data/agent-home"');
    expect(script).toContain('exec gosu node env HOME="$AGENT_HOME"');
  });
});
