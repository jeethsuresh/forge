"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Panel } from "@/components/ui";
import type { TicketView } from "@/lib/ticket-types";

export function TicketQueueSettings() {
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/settings/ticket-queue")
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
        setError(err instanceof Error ? err.message : "Failed to load queue");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(next: TicketView[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ticket-queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((ticket) => ticket.id) }),
      });
      const json = (await res.json()) as { tickets?: TicketView[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to reorder");
      setTickets(json.tickets ?? next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder");
      load();
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= tickets.length) return;
    const next = [...tickets];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    void persist(next);
  }

  function onDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const from = tickets.findIndex((ticket) => ticket.id === draggingId);
    const to = tickets.findIndex((ticket) => ticket.id === targetId);
    if (from < 0 || to < 0) {
      setDraggingId(null);
      return;
    }
    const next = [...tickets];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setDraggingId(null);
    void persist(next);
  }

  if (loading) {
    return <p className="text-sm text-[var(--forge-muted)]">Loading ticket queue…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--forge-muted)]">
        Forge runs one internal ticket agent at a time. This list is the order it
        will pick ready tickets (skipping blocked or already claimed work). Drag or
        use the buttons to reorder.
      </p>
      {error ? (
        <p className="text-sm text-[var(--forge-danger)]">{error}</p>
      ) : null}
      {tickets.length === 0 ? (
        <Panel className="p-4 text-sm text-[var(--forge-muted)]">
          No open tickets. Create tickets on a project board.
        </Panel>
      ) : (
        <ol className="space-y-2">
          {tickets.map((ticket, index) => (
            <li
              key={ticket.id}
              draggable
              onDragStart={() => setDraggingId(ticket.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDrop(ticket.id)}
              className="forge-surface flex items-center gap-3 px-3 py-2"
            >
              <span className="w-6 text-center font-mono text-xs text-[var(--forge-faint)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--forge-bright)]">
                  {ticket.projectName} #{ticket.number} {ticket.title}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={ticket.status === "in_progress" ? "info" : "neutral"}>
                    {ticket.status.replace("_", " ")}
                  </Badge>
                  {!ticket.ready && ticket.status === "todo" ? (
                    <Badge tone="warning">Blocked</Badge>
                  ) : null}
                  {ticket.claimedByKind ? (
                    <Badge tone="info">{ticket.claimedByKind}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${ticket.title} up`}
                  disabled={saving || index === 0}
                  onClick={() => move(index, -1)}
                >
                  Up
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${ticket.title} down`}
                  disabled={saving || index === tickets.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Down
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
