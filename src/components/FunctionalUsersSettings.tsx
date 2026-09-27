"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

type FunctionalUserRow = {
  id: string;
  name: string;
  token: string;
  tokenVersion: number;
  createdAt: string | Date;
};

function CopyToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">Secret</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block break-all font-mono text-xs text-[var(--fg)]">{token}</code>
    </div>
  );
}

export function FunctionalUsersSettings() {
  const [users, setUsers] = useState<FunctionalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    fetch("/api/settings/functional-users")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<{ users: FunctionalUserRow[] }>;
      })
      .then((payload) => {
        setUsers(payload.users);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/functional-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Failed to register (${res.status})`);
      }
      setName("");
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setSaving(false);
    }
  }

  async function onRegenerate(id: string) {
    if (
      !window.confirm(
        "Regenerate this secret? Existing MCP clients using the old fmu.* token will fail until you update them.",
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/settings/functional-users/${encodeURIComponent(id)}/regenerate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to regenerate (${res.status})`);
      }
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    if (
      !window.confirm(
        "Revoke this functional user? Its fmu.* secret will stop working immediately.",
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/settings/functional-users/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to revoke (${res.status})`);
      }
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading MCP agents…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-[var(--fg)]">MCP agents</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Register functional users for external MCP clients. Each secret is a remintable{" "}
          <code className="text-xs">fmu.*</code> token with full Ops access on every
          project. Container agents keep using <code className="text-xs">fos.*</code>.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={onRegister}
        className="space-y-3 rounded border border-[var(--border)] p-4"
      >
        <div>
          <label className="block text-sm text-[var(--muted)]" htmlFor="mcp-agent-name">
            Name
          </label>
          <input
            id="mcp-agent-name"
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="claude-desktop"
            required
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? "Registering…" : "Register"}
        </Button>
      </form>

      <ul className="space-y-3">
        {users.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">No MCP agents registered.</li>
        ) : (
          users.map((user) => (
            <li
              key={user.id}
              className="space-y-3 rounded border border-[var(--border)] p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-[var(--fg)]">{user.name}</div>
                  <div className="text-xs text-[var(--muted)]">
                    Created {new Date(user.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyId === user.id}
                    onClick={() => void onRegenerate(user.id)}
                  >
                    Regenerate
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busyId === user.id}
                    onClick={() => void onRevoke(user.id)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
              <CopyToken token={user.token} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
