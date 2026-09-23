"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type MigrationSummary = {
  projectNames: string[];
  repositorySlugs: string[];
  secretCount: number;
  sshKeyCount: number;
  insecureHttp: boolean;
};

type ImportedProject = {
  id: string;
  name: string;
  slug: string | null;
};

export function MigrationSettings() {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"review" | "import" | null>(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [imported, setImported] = useState<ImportedProject[] | null>(null);

  const showHttpWarning = url.trim().toLowerCase().startsWith("http://");

  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy("review");
    setError("");
    setImported(null);
    setPreviewId(null);
    setSummary(null);
    try {
      const res = await fetch("/api/settings/migration/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, username, password }),
      });
      const body = (await res.json()) as {
        error?: string;
        previewId?: string;
        summary?: MigrationSummary;
      };
      if (!res.ok || !body.previewId || !body.summary) {
        setError(body.error ?? "Review failed");
        return;
      }
      setPassword("");
      setPreviewId(body.previewId);
      setSummary(body.summary);
    } catch {
      setError("Review failed");
    } finally {
      setBusy(null);
    }
  }

  async function importInstall() {
    if (!previewId) return;
    setBusy("import");
    setError("");
    try {
      const res = await fetch("/api/settings/migration/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewId }),
      });
      const body = (await res.json()) as {
        error?: string;
        projects?: ImportedProject[];
      };
      if (!res.ok || !body.projects) {
        setError(body.error ?? "Import failed");
        return;
      }
      setImported(body.projects);
      setPreviewId(null);
    } catch {
      setError("Import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="forge-surface p-5" data-testid="migration-settings">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--forge-bright)]">
        Migrate
      </h2>
      <p className="mt-1 text-sm text-pretty text-[var(--forge-muted)]">
        Pull projects, git repositories, configuration, secrets, and Git SSH
        public keys from another Forge install. Local branches, agents, and
        Caddy config stay on the sender. Nothing is deployed.
      </p>

      <form onSubmit={review} className="mt-4 space-y-3">
        <div>
          <label className="block text-sm text-[var(--forge-muted)]" htmlFor="migrate-url">
            Sender URL
          </label>
          <Input
            id="migrate-url"
            className="mt-1 w-full"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://forge.example"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        </div>
        {showHttpWarning ? (
          <p className="text-sm text-[var(--forge-warning)]" role="status">
            This URL is not HTTPS. The password and secrets will travel in clear
            text.
          </p>
        ) : null}
        <div>
          <label
            className="block text-sm text-[var(--forge-muted)]"
            htmlFor="migrate-username"
          >
            Username
          </label>
          <Input
            id="migrate-username"
            className="mt-1 w-full"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div>
          <label
            className="block text-sm text-[var(--forge-muted)]"
            htmlFor="migrate-password"
          >
            Password
          </label>
          <Input
            id="migrate-password"
            className="mt-1 w-full"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required={!previewId}
          />
        </div>
        <Button type="submit" variant="primary" disabled={busy !== null}>
          {busy === "review" ? "Reviewing…" : "Review"}
        </Button>
      </form>

      {error ? (
        <p className="mt-4 text-sm text-[var(--forge-danger)]" role="alert">
          {error}
        </p>
      ) : null}

      {summary && previewId ? (
        <div className="mt-5 border-t border-[var(--forge-line)] pt-4">
          <h3 className="text-sm font-semibold text-[var(--forge-bright)]">
            Ready to import
          </h3>
          {summary.insecureHttp ? (
            <p className="mt-1 text-sm text-[var(--forge-warning)]">
              The sender URL is HTTP, so this import is not encrypted.
            </p>
          ) : null}
          <p className="mt-2 text-sm text-[var(--forge-muted)]">
            {summary.projectNames.length} projects, {summary.repositorySlugs.length}{" "}
            repositories, {summary.secretCount} secrets, {summary.sshKeyCount} SSH
            keys.
          </p>
          {summary.projectNames.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--forge-bright)]">
              {summary.projectNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--forge-muted)]">
              The sender has no projects. Secrets and SSH keys will still be
              copied.
            </p>
          )}
          <Button
            className="mt-4"
            variant="primary"
            disabled={busy !== null}
            onClick={() => void importInstall()}
          >
            {busy === "import" ? "Importing…" : "Import"}
          </Button>
        </div>
      ) : null}

      {imported ? (
        <div className="mt-5 border-t border-[var(--forge-line)] pt-4">
          <h3 className="text-sm font-semibold text-[var(--forge-bright)]">
            Imported
          </h3>
          {imported.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--forge-muted)]">
              No projects were on the sender. Secrets and SSH keys were copied
              when they were present.
            </p>
          ) : (
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--forge-bright)]">
              {imported.map((project) => (
                <li key={project.id}>{project.name}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
