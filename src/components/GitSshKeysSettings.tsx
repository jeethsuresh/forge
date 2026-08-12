"use client";

import { useCallback, useEffect, useState } from "react";

type SshKeyRow = {
  id: string;
  name: string;
  fingerprint: string;
  scope: "user" | "deploy";
  publicKey: string;
  createdAt: string | Date;
};

export function GitSshKeysSettings() {
  const [keys, setKeys] = useState<SshKeyRow[]>([]);
  const [authorizedKeysPath, setAuthorizedKeysPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [scope, setScope] = useState<"user" | "deploy">("user");
  const [saving, setSaving] = useState(false);

  const fetchKeys = useCallback(() => {
    fetch("/api/settings/git-ssh-keys")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<{
          keys: SshKeyRow[];
          authorizedKeysPath: string;
        }>;
      })
      .then((payload) => {
        setKeys(payload.keys);
        setAuthorizedKeysPath(payload.authorizedKeysPath);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/git-ssh-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, publicKey, scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Failed to add (${res.status})`);
      }
      setName("");
      setPublicKey("");
      setScope("user");
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(id: string) {
    setError(null);
    const res = await fetch(
      `/api/settings/git-ssh-keys?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed to remove (${res.status})`);
      return;
    }
    fetchKeys();
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading SSH keys…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-[var(--fg)]">Git SSH keys</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Register public keys for{" "}
          <code className="text-xs">git@&lt;host&gt;:&lt;slug&gt;.git</code>.
          Forge syncs{" "}
          <code className="text-xs">{authorizedKeysPath || "authorized_keys"}</code>{" "}
          for an optional git-ssh sidecar (see{" "}
          <code className="text-xs">docs/git-server.md</code>).
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={onAdd} className="space-y-3 rounded border border-[var(--border)] p-4">
        <div>
          <label className="block text-sm text-[var(--muted)]" htmlFor="ssh-name">
            Label
          </label>
          <input
            id="ssh-name"
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="laptop"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--muted)]" htmlFor="ssh-scope">
            Scope
          </label>
          <select
            id="ssh-scope"
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={scope}
            onChange={(e) =>
              setScope(e.target.value === "deploy" ? "deploy" : "user")
            }
          >
            <option value="user">User</option>
            <option value="deploy">Deploy</option>
          </select>
        </div>
        <div>
          <label
            className="block text-sm text-[var(--muted)]"
            htmlFor="ssh-pubkey"
          >
            Public key
          </label>
          <textarea
            id="ssh-pubkey"
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-xs"
            rows={3}
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="ssh-ed25519 AAAA… comment"
            required
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add key"}
        </button>
      </form>

      <ul className="space-y-3">
        {keys.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">No SSH keys registered.</li>
        ) : (
          keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-col gap-2 rounded border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium text-[var(--fg)]">{key.name}</div>
                <div className="truncate font-mono text-xs text-[var(--muted)]">
                  {key.fingerprint} · {key.scope}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(key.id)}
                className="shrink-0 rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
