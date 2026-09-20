import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentContainers,
  type AgentContainerStatus,
  type AgentKillReason,
} from "@/lib/db/schema";
import {
  dockerExecEnv,
  ensureDockerDaemon,
  readForgeContainerName,
} from "@/lib/docker-runtime";
import {
  AGENT_HEARTBEAT_INTERVAL_SEC,
  AGENT_WALL_CLOCK_MS,
} from "@/lib/agent-heartbeat";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";
const execFileAsync = promisify(execFile);

const DOCKER_SOCK_PATHS = [
  "/var/run/docker.sock",
  "/run/docker.sock",
  "/var/run/podman/podman.sock",
  "/run/podman/podman.sock",
];

export const DEFAULT_AGENT_IMAGE =
  process.env.FORGE_AGENT_IMAGE?.trim() || "forge-agent:latest";

export type StartAgentContainerOpts = {
  sessionId: string;
  projectId: string;
  branch: string;
  cloneUrl: string;
  opsBaseUrl: string;
  opsToken: string;
  gitUsername?: string;
  gitPassword?: string;
  heartbeatIntervalSec?: number;
  image?: string;
  agentPrompt?: string;
  cursorApiKey?: string;
  packagesJson?: string;
  cursorSessionId?: string;
  /**
   * Workspace path bind-mounted at /workspace/repo.
   * May be a Forge-container path (e.g. /data/repos/…); rewritten to the host
   * volume source before `docker run` so Podman does not mkdir /data on the host.
   */
  workspaceBind?: string;
};

export type DockerRunResult = { stdout: string; stderr: string };

export type AgentContainerDockerRunner = (
  args: string[],
) => Promise<DockerRunResult>;

let dockerRunner: AgentContainerDockerRunner | null = null;

/** Test seam: inject a fake docker CLI. Pass null to restore the real runner. */
export function setAgentContainerDockerRunner(
  runner: AgentContainerDockerRunner | null,
): void {
  dockerRunner = runner;
}

async function defaultDockerRunner(args: string[]): Promise<DockerRunResult> {
  await ensureDockerDaemon();
  return execFileAsync("docker", args, {
    env: dockerExecEnv(),
    maxBuffer: 5 * 1024 * 1024,
  });
}

function sanitizeDockerExecError(err: unknown, args: string[]): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const verb = args[0] ?? "command";
  if (/already in use/i.test(raw)) {
    return new Error(
      "Failed to start agent container: that name is already in use",
    );
  }
  if (verb === "run") {
    return new Error("Failed to start agent container");
  }
  return new Error(`docker ${verb} failed`);
}

function runDocker(args: string[]): Promise<DockerRunResult> {
  return (dockerRunner ?? defaultDockerRunner)(args).catch((err: unknown) => {
    throw sanitizeDockerExecError(err, args);
  });
}

const startAgentContainerInflight = new Map<
  string,
  Promise<{ containerId: string }>
>();

type NamedContainerState = {
  id: string;
  running: boolean;
  exitCode: number;
};

async function inspectNamedContainer(
  name: string,
): Promise<NamedContainerState | null> {
  try {
    const { stdout } = await runDocker([
      "inspect",
      "-f",
      "{{.Id}} {{.State.Running}} {{.State.ExitCode}}",
      name,
    ]);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const [idRaw, runningStr, codeStr] = parts;
    const runningToken = runningStr.toLowerCase();
    if (runningToken !== "true" && runningToken !== "false") return null;
    if (!idRaw) return null;
    const exitCode = Number.parseInt(codeStr ?? "", 10);
    return {
      id: idRaw.replace(/^sha256:/, "").slice(0, 64),
      running: runningToken === "true",
      exitCode: Number.isFinite(exitCode) ? exitCode : 0,
    };
  } catch {
    return null;
  }
}

function resolveCursorAgentBinInMount(agentDir: string): string {
  const cursorAgent = join(agentDir, "cursor-agent");
  if (existsSync(cursorAgent)) return "/opt/cursor-agent/cursor-agent";
  const agent = join(agentDir, "agent");
  if (existsSync(agent)) return "/opt/cursor-agent/agent";
  // Host path may not be visible inside this process (Forge container); prefer
  // the usual Cursor layout when we cannot probe the bind source.
  return "/opt/cursor-agent/cursor-agent";
}

/**
 * Confirm the agent session image exists locally. Avoids a registry pull of
 * `forge-agent` (which is not published) when the image was never built.
 */
export async function ensureAgentImage(
  image: string = DEFAULT_AGENT_IMAGE,
): Promise<void> {
  const ref = image.trim() || DEFAULT_AGENT_IMAGE;
  try {
    await runDocker(["image", "inspect", ref]);
    return;
  } catch {
    // fall through
  }

  throw new Error(
    `Unable to find agent image "${ref}" locally. Build it with ./build.sh (builds forge-agent:latest alongside forge-app), or set FORGE_AGENT_IMAGE to an existing local image.`,
  );
}

export function agentContainerName(sessionId: string): string {
  const short = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "session";
  return `forge-agent-${short}`;
}

type InspectMount = {
  Source?: string;
  Destination?: string;
};

/**
 * Map a path visible inside Forge to the host path Podman/Docker should bind.
 * `/data/repos/foo` is a volume mount inside forge_app_1; passing it unchanged
 * makes the host runtime try `mkdir /data` and fail with permission denied.
 */
export async function resolveHostBindPath(containerPath: string): Promise<string> {
  const path = containerPath.trim();
  if (!path) return path;

  const containerName = readForgeContainerName();
  if (!containerName) return path;

  let stdout: string;
  try {
    ({ stdout } = await runDocker(["inspect", containerName]));
  } catch {
    return path;
  }

  let mounts: InspectMount[] = [];
  try {
    const parsed = JSON.parse(stdout) as Array<{ Mounts?: InspectMount[] }>;
    mounts = parsed[0]?.Mounts ?? [];
  } catch {
    return path;
  }

  const matches = mounts
    .filter((mount) => {
      const dest = mount.Destination?.replace(/\/$/, "") || "";
      const source = mount.Source?.trim();
      if (!dest || !source) return false;
      return path === dest || path.startsWith(`${dest}/`);
    })
    .sort(
      (a, b) =>
        (b.Destination?.replace(/\/$/, "") ?? "").length -
        (a.Destination?.replace(/\/$/, "") ?? "").length,
    );

  const best = matches[0];
  if (!best?.Source || !best.Destination) return path;

  const dest = best.Destination.replace(/\/$/, "");
  const source = best.Source.replace(/\/$/, "");
  const suffix = path.slice(dest.length).replace(/^\/+/, "");
  return suffix ? `${source}/${suffix}` : source;
}

/**
 * Returns true if a docker -v / --mount argument targets a container runtime socket.
 */
export function mountArgTargetsDockerSock(arg: string): boolean {
  const lower = arg.toLowerCase();
  if (DOCKER_SOCK_PATHS.some((p) => lower.includes(p))) return true;
  if (lower.includes("docker.sock") || lower.includes("podman.sock")) return true;
  return false;
}

/**
 * Assert create/run argv never mounts a docker/podman socket into the agent.
 * Throws if a socket mount is present.
 */
export function assertNoDockerSockMount(args: string[]): void {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "-v" || arg === "--volume") {
      const value = args[i + 1] ?? "";
      if (mountArgTargetsDockerSock(value)) {
        throw new Error(
          `Refusing to mount container runtime socket into agent: ${value}`,
        );
      }
    }
    if (arg === "--mount") {
      const value = args[i + 1] ?? "";
      if (mountArgTargetsDockerSock(value)) {
        throw new Error(
          `Refusing to mount container runtime socket into agent: ${value}`,
        );
      }
    }
    if (mountArgTargetsDockerSock(arg) && (arg.includes(":") || arg.startsWith("type="))) {
      throw new Error(
        `Refusing to mount container runtime socket into agent: ${arg}`,
      );
    }
  }
}

export function buildAgentContainerRunArgs(
  opts: StartAgentContainerOpts,
): string[] {
  const image = opts.image?.trim() || DEFAULT_AGENT_IMAGE;
  const heartbeat =
    opts.heartbeatIntervalSec ?? AGENT_HEARTBEAT_INTERVAL_SEC;
  const name = agentContainerName(opts.sessionId);
  const hostMounts = resolveForgeHostMounts();

  const env: Record<string, string> = {
    FORGE_OPS_API_BASE: opts.opsBaseUrl.replace(/\/$/, ""),
    FORGE_OPS_API_TOKEN: opts.opsToken,
    FORGE_AGENT_SESSION_ID: opts.sessionId,
    FORGE_AGENT_PROJECT_ID: opts.projectId,
    FORGE_AGENT_BRANCH: opts.branch,
    FORGE_AGENT_CLONE_URL: opts.cloneUrl,
    FORGE_AGENT_HEARTBEAT_INTERVAL_SEC: String(heartbeat),
  };

  if (opts.gitUsername) env.FORGE_GIT_USERNAME = opts.gitUsername;
  if (opts.gitPassword) env.FORGE_GIT_PASSWORD = opts.gitPassword;
  if (opts.agentPrompt) env.FORGE_AGENT_PROMPT = opts.agentPrompt;
  if (opts.cursorApiKey) env.CURSOR_API_KEY = opts.cursorApiKey;
  if (opts.packagesJson) env.FORGE_AGENT_PACKAGES_JSON = opts.packagesJson;
  if (opts.cursorSessionId?.trim()) {
    env.FORGE_CURSOR_SESSION_ID = opts.cursorSessionId.trim();
  }

  if (hostMounts.cursorAgentDir) {
    env.FORGE_AGENT_BIN = resolveCursorAgentBinInMount(hostMounts.cursorAgentDir);
  }

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "host",
    "--label",
    `forge.agent.session=${opts.sessionId}`,
    "--label",
    `forge.agent.project=${opts.projectId}`,
    "--user",
    "0:0",
  ];

  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }

  // Optional shared worktree bind — never docker.sock.
  if (opts.workspaceBind?.trim()) {
    const bind = opts.workspaceBind.trim();
    if (mountArgTargetsDockerSock(bind)) {
      throw new Error(
        `Refusing workspace bind that looks like a container socket: ${bind}`,
      );
    }
    args.push("-v", `${bind}:/workspace/repo:z`);
  }

  if (hostMounts.cursorAgentDir) {
    const agentBind = `${hostMounts.cursorAgentDir}:/opt/cursor-agent:ro,z`;
    if (mountArgTargetsDockerSock(agentBind)) {
      throw new Error(
        `Refusing Cursor agent bind that looks like a container socket: ${agentBind}`,
      );
    }
    args.push("-v", agentBind);
  }

  // Intentionally no -v docker.sock / podman.sock mounts.
  args.push(image);

  assertNoDockerSockMount(args);
  return args;
}

function upsertContainerRow(input: {
  sessionId: string;
  containerId: string;
  image: string;
  status: AgentContainerStatus;
  startedAt: Date;
  deadlineAt: Date;
  killReason?: AgentKillReason | null;
}): void {
  const existing = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, input.sessionId))
    .get();

  if (existing) {
    db.update(agentContainers)
      .set({
        containerId: input.containerId,
        image: input.image,
        status: input.status,
        lastHeartbeatAt: input.startedAt,
        lastActivityAt: input.startedAt,
        startedAt: input.startedAt,
        deadlineAt: input.deadlineAt,
        killReason: input.killReason ?? null,
      })
      .where(eq(agentContainers.sessionId, input.sessionId))
      .run();
    return;
  }

  db.insert(agentContainers)
    .values({
      sessionId: input.sessionId,
      containerId: input.containerId,
      image: input.image,
      status: input.status,
      lastHeartbeatAt: input.startedAt,
      lastActivityAt: input.startedAt,
      startedAt: input.startedAt,
      deadlineAt: input.deadlineAt,
      killReason: input.killReason ?? null,
    })
    .run();
}

async function startAgentContainerUnlocked(
  opts: StartAgentContainerOpts,
): Promise<{ containerId: string }> {
  const image = opts.image?.trim() || DEFAULT_AGENT_IMAGE;
  await ensureAgentImage(image);

  const workspaceBind = opts.workspaceBind?.trim()
    ? await resolveHostBindPath(opts.workspaceBind.trim())
    : opts.workspaceBind;
  const args = buildAgentContainerRunArgs({ ...opts, workspaceBind });
  assertNoDockerSockMount(args);

  const name = agentContainerName(opts.sessionId);
  const live = await inspectNamedContainer(name);
  if (live?.running) {
    const existing = getAgentContainer(opts.sessionId);
    if (existing) {
      db.update(agentContainers)
        .set({
          containerId: live.id,
          image,
          status: "running",
        })
        .where(eq(agentContainers.sessionId, opts.sessionId))
        .run();
    } else {
      const startedAt = new Date();
      upsertContainerRow({
        sessionId: opts.sessionId,
        containerId: live.id,
        image,
        status: "running",
        startedAt,
        deadlineAt: new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS),
      });
    }
    return { containerId: live.id };
  }

  if (live) {
    try {
      await runDocker(["rm", "-f", name]);
    } catch {
      // Stopped leftover must not block a new run.
    }
  }

  const { stdout } = await runDocker(args);
  const containerId =
    stdout.trim().slice(0, 64) || agentContainerName(opts.sessionId);
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS);

  upsertContainerRow({
    sessionId: opts.sessionId,
    containerId,
    image,
    status: "running",
    startedAt,
    deadlineAt,
  });

  return { containerId };
}

export async function startAgentContainer(
  opts: StartAgentContainerOpts,
): Promise<{ containerId: string }> {
  const existing = startAgentContainerInflight.get(opts.sessionId);
  if (existing) return existing;

  const started = startAgentContainerUnlocked(opts).finally(() => {
    if (startAgentContainerInflight.get(opts.sessionId) === started) {
      startAgentContainerInflight.delete(opts.sessionId);
    }
  });
  startAgentContainerInflight.set(opts.sessionId, started);
  return started;
}

export async function waitForAgentContainerExit(
  sessionId: string,
): Promise<number> {
  const name = agentContainerName(sessionId);

  for (let attempt = 0; attempt < 30; attempt++) {
    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    const target = row?.containerId || name;

    try {
      const { stdout } = await runDocker(["wait", target]);
      const code = Number.parseInt(stdout.trim(), 10);
      const exitCode = Number.isFinite(code) ? code : 0;
      // SIGTERM (143) is how docker rm -f / stop kills a container. If a
      // replacement for this session is already running, wait on that instead
      // of failing the turn.
      if (exitCode === 143) {
        const live = await inspectNamedContainer(name);
        if (live?.running) {
          try {
            const waited = await runDocker(["wait", live.id]);
            const next = Number.parseInt(waited.stdout.trim(), 10);
            return Number.isFinite(next) ? next : 0;
          } catch {
            continue;
          }
        }
      }
      return exitCode;
    } catch {
      const state = await inspectAgentContainerState(sessionId);
      if (state.running === true) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (typeof state.exitCode === "number") return state.exitCode;
      if (state.running === false) return 0;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return 0;
}

export type AgentContainerInspectState = {
  running: boolean | null;
  exitCode: number | null;
};

export async function inspectAgentContainerState(
  sessionId: string,
): Promise<AgentContainerInspectState> {
  const row = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();
  if (!row || row.status === "removed" || row.status === "stopped") {
    return { running: false, exitCode: null };
  }

  const name = agentContainerName(sessionId);
  try {
    const { stdout } = await runDocker([
      "inspect",
      "-f",
      "{{.State.Running}} {{.State.ExitCode}}",
      row.containerId || name,
    ]);
    const [runningStr, codeStr] = stdout.trim().split(/\s+/);
    const exitCode = Number.parseInt(codeStr ?? "", 10);
    return {
      running: runningStr?.toLowerCase() === "true",
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
    };
  } catch {
    return { running: null, exitCode: null };
  }
}

export async function stopAgentContainer(sessionId: string): Promise<void> {
  const row = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();

  const name = agentContainerName(sessionId);
  const target = row?.containerId || name;

  try {
    await runDocker(["stop", "-t", "10", target]);
  } catch {
    try {
      await runDocker(["stop", "-t", "10", name]);
    } catch {
      // already stopped / missing
    }
  }

  if (row) {
    db.update(agentContainers)
      .set({ status: "stopped" })
      .where(eq(agentContainers.sessionId, sessionId))
      .run();
  }
}

export async function removeAgentContainer(sessionId: string): Promise<void> {
  const row = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();

  const name = agentContainerName(sessionId);
  const target = row?.containerId || name;

  try {
    await runDocker(["rm", "-f", target]);
  } catch {
    try {
      await runDocker(["rm", "-f", name]);
    } catch {
      // already removed
    }
  }

  if (row) {
    db.update(agentContainers)
      .set({ status: "removed" })
      .where(eq(agentContainers.sessionId, sessionId))
      .run();
  }
}

export async function agentContainerIsRunning(
  sessionId: string,
): Promise<boolean> {
  const state = await inspectAgentContainerState(sessionId);
  return state.running === true;
}

export function setAgentContainerKillReason(
  sessionId: string,
  killReason: AgentKillReason,
): void {
  db.update(agentContainers)
    .set({ killReason, status: "stopped" })
    .where(eq(agentContainers.sessionId, sessionId))
    .run();
}

export function clearAgentContainerKillReason(sessionId: string): void {
  db.update(agentContainers)
    .set({ killReason: null })
    .where(eq(agentContainers.sessionId, sessionId))
    .run();
}

export function getAgentContainer(sessionId: string) {
  return db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();
}
