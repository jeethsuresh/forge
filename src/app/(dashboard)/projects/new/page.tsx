"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { composeProjectName } from "@/lib/compose-project-name";

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
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-100">
          Add project
        </h1>
        <p className="mb-8 text-sm text-zinc-500">
          Watch a GitHub repository and auto-deploy on changes
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-6"
        >
          {error && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Display name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-orange-500/50"
              required
            />
            {name.trim() && (
              <p className="mt-1.5 font-mono text-xs text-zinc-500">
                Compose project name:{" "}
                <span className="text-orange-400">
                  {composeProjectName(name)}
                </span>
              </p>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              GitHub repository
            </span>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Branch
            </span>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
              required
            />
          </label>

          <p className="text-xs text-zinc-600">
            The repository must have <code className="text-zinc-500">build.sh</code>{" "}
            and <code className="text-zinc-500">deploy.sh</code> in its root.
          </p>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
