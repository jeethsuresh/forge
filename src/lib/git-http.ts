import { spawn } from "child_process";
import { basename, dirname } from "path";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import {
  authenticateOpsRequest,
  type OpsAuth,
} from "@/lib/ops-api-auth";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { barePathForSlug } from "@/lib/git-paths";

export type GitHttpAccess =
  | { ok: true; actor: "session" | "ops-global" | "ops-session"; projectId?: string }
  | { ok: false; status: 401 | 403; error: string };

export type GitHttpService = "git-upload-pack" | "git-receive-pack";

export function normalizeGitHttpSlug(slugParam: string): string {
  return slugParam.trim().replace(/\.git$/i, "");
}

export function isReceivePackService(
  service: string | null,
  pathSegments: string[],
): boolean {
  if (service === "git-receive-pack") return true;
  return pathSegments.some((p) => p === "git-receive-pack");
}

function decodeBasicToken(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString(
      "utf8",
    );
    const colon = decoded.indexOf(":");
    if (colon < 0) return decoded.trim() || null;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    // Prefer password (git credential helpers put the token there).
    if (pass.trim()) return pass.trim();
    return user.trim() || null;
  } catch {
    return null;
  }
}

function presentedBearerOrBasic(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const bearer = authorization.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }
  return decodeBasicToken(authorization);
}

/**
 * Authorize read/write against a Forge bare repo slug.
 * Dashboard session, global Ops token, or project-scoped session Ops token.
 */
export async function authorizeGitHttpAccess(
  request: Request,
  slug: string,
  write: boolean,
): Promise<GitHttpAccess> {
  void write;
  const cleanSlug = normalizeGitHttpSlug(slug);
  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, cleanSlug))
    .get();
  if (!repo) {
    return { ok: false, status: 403, error: "Repository not found" };
  }

  const linked = db
    .select()
    .from(projects)
    .where(eq(projects.gitRepositoryId, repo.id))
    .get();

  // Session cookie (dashboard)
  try {
    const session = await getIronSession<SessionData>(
      await cookies(),
      sessionOptions,
    );
    if (session.isLoggedIn && session.userId) {
      return { ok: true, actor: "session", projectId: linked?.id };
    }
  } catch {
    // cookies() may throw outside a request context — fall through
  }

  // Ops / agent tokens via Authorization header (Bearer or Basic password)
  const tokenOverride = presentedBearerOrBasic(request);
  let ops: OpsAuth | null = null;
  if (tokenOverride) {
    const synthetic = new Request(request.url, {
      headers: { Authorization: `Bearer ${tokenOverride}` },
    });
    ops = authenticateOpsRequest(synthetic);
  } else {
    ops = authenticateOpsRequest(request);
  }

  if (ops?.kind === "global") {
    return { ok: true, actor: "ops-global", projectId: linked?.id };
  }

  if (ops?.kind === "session") {
    if (!linked || linked.id !== ops.projectId) {
      return {
        ok: false,
        status: 403,
        error: "Ops session is not authorized for this repository",
      };
    }
    return {
      ok: true,
      actor: "ops-session",
      projectId: ops.projectId,
    };
  }

  return { ok: false, status: 401, error: "Authentication required" };
}

function parseCgiResponse(raw: Buffer): {
  status: number;
  headers: Headers;
  body: Buffer;
} {
  const sep = raw.indexOf("\r\n\r\n");
  const sepN = raw.indexOf("\n\n");
  const cut = sep >= 0 ? sep : sepN;
  if (cut < 0) {
    return { status: 200, headers: new Headers(), body: raw };
  }
  const headerBytes = raw.subarray(0, cut);
  const bodyStart = cut + (sep >= 0 ? 4 : 2);
  const body = raw.subarray(bodyStart);
  const headerText = headerBytes.toString("utf8");
  const headers = new Headers();
  let status = 200;
  for (const line of headerText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.toLowerCase() === "status") {
      const code = Number.parseInt(value, 10);
      if (!Number.isNaN(code)) status = code;
      continue;
    }
    headers.append(key, value);
  }
  return { status, headers, body };
}

export async function runGitHttpBackend(opts: {
  barePath: string;
  method: string;
  pathInfo: string;
  queryString: string;
  body?: Buffer;
  contentType?: string | null;
}): Promise<Response> {
  const repoRoot = dirname(opts.barePath);
  const repoName = basename(opts.barePath);
  const pathInfo = opts.pathInfo.startsWith("/")
    ? opts.pathInfo
    : `/${opts.pathInfo}`;
  const fullPathInfo = `/${repoName}${pathInfo === "/" ? "" : pathInfo}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: repoRoot,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: fullPathInfo,
    REQUEST_METHOD: opts.method.toUpperCase(),
    QUERY_STRING: opts.queryString,
    CONTENT_TYPE: opts.contentType ?? "",
    CONTENT_LENGTH: String(opts.body?.byteLength ?? 0),
    REMOTE_USER: "forge",
    REMOTE_ADDR: "127.0.0.1",
    GATEWAY_INTERFACE: "CGI/1.1",
    SERVER_PROTOCOL: "HTTP/1.1",
    SCRIPT_NAME: "/api/git",
  };

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", ["http-backend"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(
          new Error(
            `git http-backend exited ${code}: ${Buffer.concat(errChunks).toString("utf8")}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    if (opts.body && opts.body.byteLength > 0) {
      child.stdin.write(opts.body);
    }
    child.stdin.end();
  });

  const parsed = parseCgiResponse(raw);
  return new Response(new Uint8Array(parsed.body), {
    status: parsed.status,
    headers: parsed.headers,
  });
}

/**
 * Smart HTTP entry: info/refs + upload-pack / receive-pack via git http-backend.
 */
export async function handleGitSmartHttp(
  request: Request,
  slugParam: string,
  pathSegments: string[] = [],
): Promise<Response> {
  const slug = normalizeGitHttpSlug(slugParam);
  let barePath: string;
  try {
    barePath = barePathForSlug(slug);
  } catch {
    return new Response("Invalid repository", { status: 400 });
  }

  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, slug))
    .get();
  if (!repo || !existsSync(barePath)) {
    return new Response("Repository not found", { status: 404 });
  }

  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  const write = isReceivePackService(service, pathSegments);
  const access = await authorizeGitHttpAccess(request, slug, write);
  if (!access.ok) {
    return new Response(access.error, {
      status: access.status,
      headers: {
        "WWW-Authenticate": 'Basic realm="Forge Git", charset="UTF-8"',
      },
    });
  }

  const pathInfo =
    pathSegments.length === 0
      ? url.pathname.includes("/info/refs")
        ? "/info/refs"
        : "/"
      : `/${pathSegments.join("/")}`;

  // Prefer explicit trailing path from the route; fall back to URL after slug.git
  let resolvedPathInfo = pathInfo;
  const marker = `/${slug}.git`;
  const pathname = url.pathname;
  const idx = pathname.indexOf(marker);
  if (idx >= 0) {
    resolvedPathInfo = pathname.slice(idx + marker.length) || "/";
  } else {
    const idx2 = pathname.indexOf(`/api/git/${slug}`);
    if (idx2 >= 0) {
      const rest = pathname.slice(idx2 + `/api/git/${slug}`.length);
      resolvedPathInfo = rest.replace(/^\.git/, "") || "/";
    }
  }

  if (pathSegments.length > 0) {
    resolvedPathInfo = `/${pathSegments.join("/")}`;
  }

  const body =
    request.method.toUpperCase() === "POST"
      ? Buffer.from(await request.arrayBuffer())
      : undefined;

  return runGitHttpBackend({
    barePath: repo.barePath,
    method: request.method,
    pathInfo: resolvedPathInfo,
    queryString: url.searchParams.toString(),
    body,
    contentType: request.headers.get("content-type"),
  });
}
