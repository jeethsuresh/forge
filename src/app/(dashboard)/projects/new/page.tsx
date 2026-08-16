"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { composeProjectName } from "@/lib/compose-project-name";
import { GitLocalPushRecipes } from "@/components/GitLocalPushRecipes";
import { Button, Input, PageHeader } from "@/components/ui";

type Mode = "create" | "import" | "local";

type CreatedProject = {
  id: string;
  httpsCloneUrl?: string | null;
  sshCloneUrl?: string | null;
  gitSlug?: string | null;
};

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [branch, setBranch] = useState("main");
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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create project");
        return;
      }

      if (mode === "local") {
        setCreated({
          id: data.id,
          httpsCloneUrl: data.httpsCloneUrl,
          sshCloneUrl: data.sshCloneUrl,
          gitSlug: data.gitSlug,
        });
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
      : mode === "local"
        ? "Create empty Forge repo"
        : "Create project";
  const loadingLabel =
    mode === "import"
      ? "Importing…"
      : mode === "local"
        ? "Creating…"
        : "Creating…";

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Add project"
          subtitle="Create a Forge-hosted repo, import once from GitHub, or push an existing local checkout"
        />

        {created ? (
          <div className="forge-surface-elevated space-y-5 p-6">
            <p className="text-sm text-[var(--forge-muted)]">
              Empty Forge repo{" "}
              <code className="text-[var(--forge-bright)]">
                {created.gitSlug}
              </code>{" "}
              is ready. Run one of these from your checkout (recipes append to{" "}
              <code className="text-[var(--forge-muted)]">AGENTS.md</code> with{" "}
              <code className="text-[var(--forge-muted)]">cat &gt;&gt;</code>
              ).
            </p>
            {created.httpsCloneUrl ? (
              <GitLocalPushRecipes
                httpsUrl={created.httpsCloneUrl}
                sshUrl={created.sshCloneUrl}
                defaultBranch={branch.trim() || "main"}
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
                Create empty
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
                variant={mode === "local" ? "primary" : "secondary"}
                onClick={() => setMode("local")}
              >
                Add local
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
                  placeholder={mode === "import" ? "Optional (defaults from repo)" : "My App"}
                  required={mode !== "import"}
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
              ) : mode === "local" ? (
                <p className="text-xs text-[var(--forge-faint)]">
                  Creates an empty Forge-hosted repo (no seed commit). After
                  create you will get copy-paste git commands to add{" "}
                  <code className="text-[var(--forge-muted)]">origin</code> or{" "}
                  <code className="text-[var(--forge-muted)]">forge</code> and
                  push.
                </p>
              ) : (
                <p className="text-xs text-[var(--forge-faint)]">
                  Seeds a README and a minimal{" "}
                  <code className="text-[var(--forge-muted)]">Forgefile</code>. Clone
                  URLs appear on the project Settings tab.
                </p>
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
                  {loading ? loadingLabel : submitLabel}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
