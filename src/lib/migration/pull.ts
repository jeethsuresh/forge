import { randomUUID } from "crypto";
import { applyMigrationManifest, type MigrationApplyResult } from "@/lib/migration/apply";
import {
  migrationSummary,
  parseMigrationManifest,
  type MigrationManifest,
  type MigrationSummary,
} from "@/lib/migration/manifest";

const PREVIEW_TTL_MS = 10 * 60 * 1000;

type StoredPreview = {
  baseUrl: string;
  cookie: string;
  manifest: MigrationManifest;
  expiresAt: number;
};

const previews = new Map<string, StoredPreview>();

export function parseMigrationBaseUrl(input: string): {
  baseUrl: string;
  insecureHttp: boolean;
} {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }
  if (url.username || url.password) {
    throw new Error("Put the username and password in the fields, not in the URL");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("Use the Forge base URL, for example https://forge.example");
  }
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    insecureHttp: url.protocol === "http:",
  };
}

export async function previewMigration(input: {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<{ previewId: string; summary: MigrationSummary }> {
  const parsed = parseMigrationBaseUrl(input.baseUrl);
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) {
    throw new Error("Username and password are required");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const login = await senderFetch(
    `${parsed.baseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    fetchImpl,
  );
  if (!login.ok) {
    let message = "Sender rejected the username or password";
    try {
      const body = (await login.json()) as { error?: string };
      if (body.error?.trim()) message = body.error.trim();
    } catch {
      // Keep the generic login error.
    }
    throw new Error(message);
  }
  const cookie = cookieHeaderFrom(login);
  if (!cookie) throw new Error("Sender did not start a session");

  const exported = await senderFetch(
    `${parsed.baseUrl}/api/settings/migration/export`,
    { headers: { cookie } },
    fetchImpl,
  );
  if (!exported.ok) {
    throw new Error(`Sender export failed (${exported.status})`);
  }
  const manifest = parseMigrationManifest(await exported.json());
  sweepPreviews();
  const previewId = randomUUID();
  previews.set(previewId, {
    baseUrl: parsed.baseUrl,
    cookie,
    manifest,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
  });
  return {
    previewId,
    summary: migrationSummary(manifest, parsed.insecureHttp),
  };
}

export async function applyMigrationPreview(
  previewId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MigrationApplyResult> {
  sweepPreviews();
  const stored = previews.get(previewId);
  if (!stored) {
    throw new Error("Migration review expired. Review the sender again.");
  }
  const bundles = new Map<string, Buffer>();
  for (const project of stored.manifest.projects) {
    if (!project.git?.hasCommits || bundles.has(project.git.slug)) continue;
    const slug = project.git.slug;
    const response = await senderFetch(
      `${stored.baseUrl}/api/settings/migration/repos/${encodeURIComponent(slug)}`,
      { headers: { cookie: stored.cookie } },
      fetchImpl,
    );
    if (!response.ok) {
      throw new Error(`Failed to download repository ${slug} (${response.status})`);
    }
    bundles.set(slug, Buffer.from(await response.arrayBuffer()));
  }
  const result = await applyMigrationManifest(stored.manifest, bundles);
  previews.delete(previewId);
  return result;
}

async function senderFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const response = await fetchImpl(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Sender URL redirected. Use the final Forge URL.");
  }
  return response;
}

function cookieHeaderFrom(response: Response): string {
  const fromList =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const pairs = fromList
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter(Boolean);
  if (pairs.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) {
      const first = single.split(";")[0]?.trim();
      if (first) pairs.push(first);
    }
  }
  return pairs.join("; ");
}

function sweepPreviews(): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(id);
  }
}
