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

  it("chowns only forge-owned paths under /data, not the whole volume", () => {
    expect(script).toContain("chown_forge_data_paths");
    expect(script).toMatch(/for path in \/data\/repos \/data\/agent-home/);
    expect(script).not.toMatch(/chown -R node:node \/data[^/]/);
  });

  it("chowns sqlite wal/shm sidecars with forge.db", () => {
    expect(script).toContain("/data/forge.db-wal");
    expect(script).toContain("/data/forge.db-shm");
  });

  it("documents avoiding SELinux denials on bind-mounted podman sockets", () => {
    expect(script).toMatch(/SELinux blocks setattr on user_tmp_t sockets/);
  });

  it("chowns forge data paths before configuring git as node", () => {
    const chownIdx = script.indexOf("chown_forge_data_paths");
    const gitConfigIdx = script.indexOf("git config --global user.name");
    expect(chownIdx).toBeGreaterThan(-1);
    expect(gitConfigIdx).toBeGreaterThan(-1);
    expect(chownIdx).toBeLessThan(gitConfigIdx);
  });

  it("writes git credentials as the node user", () => {
    expect(script).toMatch(/gosu node env HOME="\$AGENT_HOME" python3/);
  });

  it("sets HOME to /data/agent-home before starting the app", () => {
    expect(script).toContain('AGENT_HOME="/data/agent-home"');
    expect(script).toContain('exec gosu node env HOME="$AGENT_HOME"');
  });
});
