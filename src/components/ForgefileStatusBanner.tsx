"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Panel } from "@/components/ui";
import { buildForgefileBootstrapPrompt } from "@/lib/forgefile-bootstrap";

export type ForgefileBannerStatus = {
  status: "missing" | "invalid" | "valid" | "unknown";
  errorMessage?: string | null;
};

export function ForgefileStatusBanner({
  projectId,
  projectName,
  branch,
  status,
  errorMessage,
}: {
  projectId: string;
  projectName: string;
  branch: string;
  status: ForgefileBannerStatus["status"];
  errorMessage?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (status === "valid") return null;

  const title =
    status === "missing"
      ? "Forgefile required"
      : status === "invalid"
        ? "Forgefile is invalid"
        : "Forgefile status unknown";

  const detail =
    status === "missing"
      ? "This project needs a root Forgefile before deploy or script runs. Create one with an agent, or add Forgefile manually."
      : status === "invalid"
        ? errorMessage ||
          "The Forgefile failed validation. Fix it before deploying."
        : "Forge has not projected a Forgefile for this checkout yet.";

  async function startBootstrapAgent() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          prompt: buildForgefileBootstrapPrompt(projectName),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessionId?: string;
      };
      if (!res.ok) {
        alert(json.error ?? "Failed to start Forgefile agent");
        return;
      }
      const params = new URLSearchParams({ tab: "agents" });
      if (json.sessionId) params.set("session", json.sessionId);
      router.push(`/projects/${projectId}?${params.toString()}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      elevated
      className="border border-[color-mix(in_srgb,var(--forge-warning)_35%,transparent)] bg-[var(--forge-warning-muted)] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--forge-warning)]">
            {title}
          </p>
          <p className="text-sm text-[var(--forge-bright)]">{detail}</p>
        </div>
        <Button
          size="sm"
          variant="warning"
          disabled={loading}
          onClick={() => void startBootstrapAgent()}
          className="shrink-0"
        >
          {loading ? "Starting…" : "Create Forgefile with agent"}
        </Button>
      </div>
    </Panel>
  );
}
