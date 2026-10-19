"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Input, Panel, TextArea } from "@/components/ui";
import type { TicketStatus, TicketView } from "@/lib/ticket-types";
import { projectModeHref } from "@/lib/project-routes";

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

export function ProjectTicketsBoard({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followupTitle, setFollowupTitle] = useState("");
  const [followupBusy, setFollowupBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/projects/${projectId}/tickets`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<{ tickets: TicketView[] }>;
      })
      .then((json) => {
        setTickets(json.tickets);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load tickets");
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  async function create() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const json = (await res.json()) as { ticket?: TicketView; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setTitle("");
      setDescription("");
      load();
      if (json.ticket) setSelectedId(json.ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function followup() {
    if (!selected) return;
    setFollowupBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tickets/${selected.id}/followup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: followupTitle }),
        },
      );
      const json = (await res.json()) as { followup?: TicketView; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create followup");
      setFollowupTitle("");
      load();
      if (json.followup) setSelectedId(json.followup.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create followup");
    } finally {
      setFollowupBusy(false);
    }
  }

  async function release() {
    if (!selected) return;
    const res = await fetch(
      `/api/projects/${projectId}/tickets/${selected.id}/release`,
      { method: "POST" },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to release");
      return;
    }
    load();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <Panel className="shrink-0 p-4">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--forge-muted)]">
              Title
            </span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              placeholder="What should an agent do?"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--forge-muted)]">
              Description
            </span>
            <TextArea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Context, constraints, and done definition"
              className="min-h-11"
            />
          </label>
          <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
            {saving ? "Creating…" : "Create ticket"}
          </Button>
        </form>
        {error ? (
          <p className="mt-3 text-sm text-[var(--forge-danger)]">{error}</p>
        ) : null}
      </Panel>

      {loading ? (
        <p className="text-sm text-[var(--forge-muted)]">Loading tickets…</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid min-h-0 gap-3 overflow-hidden md:grid-cols-3">
            {COLUMNS.map((column) => {
              const cards = tickets.filter((ticket) => ticket.status === column.status);
              return (
                <section
                  key={column.status}
                  className="flex min-h-0 flex-col rounded-[12px] border border-[var(--forge-line)] bg-[var(--forge-panel)]"
                >
                  <header className="flex items-center justify-between px-3 py-2">
                    <h2 className="text-sm font-semibold text-[var(--forge-bright)]">
                      {column.label}
                    </h2>
                    <span className="text-xs text-[var(--forge-muted)]">
                      {cards.length}
                    </span>
                  </header>
                  <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                    {cards.length === 0 ? (
                      <li className="px-2 py-6 text-center text-xs text-[var(--forge-faint)]">
                        No tickets
                      </li>
                    ) : (
                      cards.map((ticket) => (
                        <li key={ticket.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(ticket.id)}
                            className={`w-full rounded-[10px] border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forge-accent)] ${
                              selectedId === ticket.id
                                ? "border-[var(--forge-accent)] bg-[var(--forge-accent-muted)]"
                                : "border-[var(--forge-line)] bg-[var(--forge-elevated)] hover:bg-[var(--forge-hover)]"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-[var(--forge-faint)]">
                                #{ticket.number}
                              </span>
                              {!ticket.ready && ticket.status === "todo" ? (
                                <Badge tone="warning">Blocked</Badge>
                              ) : null}
                              {ticket.claimedByKind ? (
                                <Badge tone="info">{ticket.claimedByKind}</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm font-medium text-[var(--forge-bright)]">
                              {ticket.title}
                            </p>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </div>

          <aside className="min-h-0 overflow-y-auto">
            {selected ? (
              <Panel className="p-4">
                <p className="font-mono text-xs text-[var(--forge-faint)]">
                  #{selected.number}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--forge-bright)]">
                  {selected.title}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--forge-muted)]">
                  {selected.description || "No description."}
                </p>
                {selected.blockedBy.length > 0 ? (
                  <p className="mt-3 text-xs text-[var(--forge-warning)]">
                    Blocked by{" "}
                    {selected.blockedBy
                      .map((item) => `#${item.number} ${item.title}`)
                      .join(", ")}
                  </p>
                ) : null}
                {selected.followups.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--forge-muted)]">
                    Followups:{" "}
                    {selected.followups
                      .map((item) => `#${item.number} ${item.title}`)
                      .join(", ")}
                  </p>
                ) : null}
                {selected.agentSessionId ? (
                  <Link
                    href={projectModeHref(projectId, "agents", {
                      session: selected.agentSessionId,
                    })}
                    className="mt-3 inline-block text-sm text-[var(--forge-accent-hot)]"
                  >
                    Open agent session
                  </Link>
                ) : null}
                {selected.status === "in_progress" ? (
                  <div className="mt-4">
                    <Button type="button" variant="secondary" onClick={() => void release()}>
                      Release to todo
                    </Button>
                  </div>
                ) : null}
                <form
                  className="mt-4 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void followup();
                  }}
                >
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-[var(--forge-muted)]">
                      Followup ticket
                    </span>
                    <Input
                      value={followupTitle}
                      onChange={(event) => setFollowupTitle(event.target.value)}
                      placeholder="Work that depends on this ticket"
                      required
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={followupBusy || !followupTitle.trim()}
                  >
                    {followupBusy ? "Creating…" : "Create followup"}
                  </Button>
                </form>
              </Panel>
            ) : (
              <p className="px-2 text-sm text-[var(--forge-muted)]">
                Select a ticket to see details and create followups.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
