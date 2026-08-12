"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { composeProjectName } from "@/lib/compose-project-name";
import { Button, Input, PageHeader } from "@/components/ui";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, githubRepo, branch }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create project");
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

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Add project"
          subtitle="Watch a GitHub repository and auto-deploy on changes"
        />

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
              placeholder="My App"
              required
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
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
              Branch
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

          <p className="text-xs text-[var(--forge-faint)]">
            The repository must have{" "}
            <code className="text-[var(--forge-muted)]">build.sh</code> and{" "}
            <code className="text-[var(--forge-muted)]">deploy.sh</code> in its
            root.
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
