"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { composeProjectName } from "@/lib/compose-project-name";
import { GitLocalPushRecipes } from "@/components/GitLocalPushRecipes";
import { Button, Input, PageHeader } from "@/components/ui";

type Mode = "create" | "import" | "image";

type CreatedProject = {
  id: string;
  httpsCloneUrl?: string | null;
  sshCloneUrl?: string | null;
  gitSlug?: string | null;
  gitCloneToken?: string | null;
  agentSessionId?: string | null;
  deploymentId?: string | null;
  importError?: string | null;
  agentError?: string | null;
};

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [hostPath, setHostPath] = useState("");
  const [image, setImage] = useState("");
  const [containerPort, setContainerPort] = useState("");
  const [hostPort, setHostPort] = useState("");
  const [registryUser, setRegistryUser] = useState("");
  const [registryPassword, setRegistryPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedProject | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name: name.trim() || undefined,
          slug: slug.trim() || undefined,
          githubRepo: mode === "import" ? githubRepo : undefined,
          branch,
          hostPath: mode === "create" ? hostPath.trim() || undefined : undefined,
          image: mode === "image" ? image.trim() : undefined,
          containerPort:
            mode === "image" && containerPort.trim()
              ? Number(containerPort)
              : undefined,
          hostPort:
            mode === "image" && hostPort.trim() ? Number(hostPort) : undefined,
          registryUser: mode === "image" ? registryUser.trim() || undefined : undefined,
          registryPassword:
            mode === "image" ? registryPassword || undefined : undefined,
        }),
      });

      const data = (await res.json()) as CreatedProject & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to create project");
        if (data.id) {
          setCreated(data);
        }
        return;
      }

      if (mode === "image") {
        router.push(`/projects/${data.id}/compose`);
        router.refresh();
        return;
      }

      if (mode === "create") {
        if (data.agentSessionId) {
          router.push(`/projects/${data.id}/agents?session=${data.agentSessionId}`);
          router.refresh();
          return;
        }
        setCreated(data);
        router.refresh();
        return;
      }

      router.push(`/projects/${data.id}`);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const submitLabel =
    mode === "import"
      ? "Import project"
      : mode === "image"
        ? "Create and deploy image"
        : "Create project";

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Add project"
          subtitle="New Forge repo (optional host folder), import GitHub, or run a registry image"
        />

        {created ? (
          <div className="forge-surface-elevated space-y-5 p-6">
            <p className="text-sm text-[var(--forge-muted)]">
              Forge repo{" "}
              <code className="text-[var(--forge-bright)]">
                {created.gitSlug}
              </code>{" "}
              is ready.
              {created.importError ? ` Import failed: ${created.importError}` : ""}
              {created.agentError ? ` Agent: ${created.agentError}` : ""}
            </p>
            {created.httpsCloneUrl ? (
              <GitLocalPushRecipes
                httpsUrl={created.httpsCloneUrl}
                sshUrl={created.sshCloneUrl}
                defaultBranch={branch.trim() || "main"}
                cloneToken={created.gitCloneToken}
              />
            ) : null}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Back
              </Button>
              <Link
                href={`/projects/${created.id}`}
                className="inline-flex items-center rounded-[10px] bg-[var(--forge-accent)] px-4 py-2 text-sm font-semibold text-[var(--forge-on-accent)]"
              >
                Open project
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant={mode === "create" ? "primary" : "secondary"}
                onClick={() => setMode("create")}
              >
                New project
              </Button>
              <Button
                type="button"
                variant={mode === "import" ? "primary" : "secondary"}
                onClick={() => setMode("import")}
              >
                Import GitHub
              </Button>
              <Button
                type="button"
                variant={mode === "image" ? "primary" : "secondary"}
                onClick={() => setMode("image")}
              >
                From image
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="forge-surface-elevated space-y-5 p-6">
              {error ? (
                <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--forge-danger)_30%,transparent)] bg-[var(--forge-danger-muted)] px-3 py-2 text-sm text-[var(--forge-danger)]">
                  {error}
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                  Display name
                </span>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    mode === "import"
                      ? "Optional (defaults from repo)"
                      : mode === "image"
                        ? "Optional (defaults from image)"
                        : "My App"
                  }
                  required={mode === "create"}
                />
                {name.trim() ? (
                  <p className="mt-1.5 font-mono text-xs text-[var(--forge-faint)]">
                    Compose project name:{" "}
                    <span className="text-[var(--forge-accent-hot)]">
                      {composeProjectName(name)}
                    </span>
                  </p>
                ) : null}
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                  Git slug (optional)
                </span>
                <Input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-app"
                  className="font-mono text-sm"
                />
              </label>

              {mode === "import" ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                    GitHub repository
                  </span>
                  <Input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="owner/repo or https://github.com/owner/repo"
                    className="font-mono text-sm"
                    required
                  />
                  <p className="mt-1.5 text-xs text-[var(--forge-faint)]">
                    One-shot import into Forge. GitHub is not kept as a dual remote.
                  </p>
                </label>
              ) : mode === "image" ? (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Image
                    </span>
                    <Input
                      type="text"
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="nginx:latest or ghcr.io/org/app:1.2"
                      className="font-mono text-sm"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Container port (optional)
                    </span>
                    <Input
                      type="number"
                      value={containerPort}
                      onChange={(e) => setContainerPort(e.target.value)}
                      placeholder="Inspect ExposedPorts or 8080"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Host port (optional)
                    </span>
                    <Input
                      type="number"
                      value={hostPort}
                      onChange={(e) => setHostPort(e.target.value)}
                      placeholder="Picks a free port if empty"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Registry username (optional)
                    </span>
                    <Input
                      type="text"
                      value={registryUser}
                      onChange={(e) => setRegistryUser(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Registry password / token
                    </span>
                    <Input
                      type="password"
                      value={registryPassword}
                      onChange={(e) => setRegistryPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                      Host folder (optional)
                    </span>
                    <Input
                      type="text"
                      value={hostPath}
                      onChange={(e) => setHostPath(e.target.value)}
                      placeholder="/home/you/src/my-app"
                      className="font-mono text-sm"
                    />
                    <p className="mt-1.5 text-xs text-[var(--forge-faint)]">
                      Seeds README + Forgefile, then copies this absolute host path
                      (except .git) as a second commit and starts a bootstrap agent.
                    </p>
                  </label>
                </>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
                  Default branch
                </span>
                <Input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="font-mono text-sm"
                  required
                />
              </label>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? "Working…" : submitLabel}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
