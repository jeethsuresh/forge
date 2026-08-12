"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArtifactApi, ArtifactBuildApi } from "@/lib/artifact-types";
import { formatRelativeTime } from "@/lib/utils";
import { Badge, Button, SectionLabel } from "@/components/ui";

type ArtifactsResponse = {
  artifacts: ArtifactApi[];
};

function buildTone(
  status: ArtifactBuildApi["status"],
): "success" | "danger" | "neutral" | "warning" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "danger";
    case "running":
    case "pending":
      return "warning";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function ProjectArtifacts({
  projectId,
  className = "",
}: {
  projectId: string;
  className?: string;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactApi[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(() => {
    fetch(`/api/projects/${projectId}/artifacts`)
      .then((r) => r.json())
      .then((data: ArtifactsResponse) => {
        setArtifacts(data.artifacts ?? []);
        setLoaded(true);
      })
      .catch(() => {
        setArtifacts([]);
        setLoaded(true);
      });
  }, [projectId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  async function runBuild(name: string) {
    setBuilding(name);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/artifacts/${encodeURIComponent(name)}/build`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = (await res.json()) as {
        error?: string;
        build?: ArtifactBuildApi | null;
      };
      if (!res.ok) {
        setError(json.error ?? json.build?.errorMessage ?? "Build failed");
      } else if (json.build?.status === "failed") {
        setError(json.build.errorMessage ?? "Build failed");
      }
      fetchArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build failed");
    } finally {
      setBuilding(null);
    }
  }

  if (loaded && artifacts.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <SectionLabel>
        Artifacts
        {loaded ? ` · ${artifacts.length}` : ""}
      </SectionLabel>
      {error ? (
        <p className="mb-3 text-sm text-[var(--forge-danger)]">{error}</p>
      ) : null}
      {!loaded ? (
        <div className="h-24 animate-pulse rounded-2xl bg-[var(--forge-panel)]" />
      ) : (
        <div className="space-y-3">
          {artifacts.map((artifact) => {
            const latest = artifact.builds[0] ?? null;
            return (
              <div
                key={artifact.id}
                className="forge-surface flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium text-[var(--forge-bright)]">
                      {artifact.name}
                    </span>
                    {latest ? (
                      <Badge tone={buildTone(latest.status)} className="normal-case">
                        {latest.status}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="normal-case">
                        never built
                      </Badge>
                    )}
                  </div>
                  {artifact.description ? (
                    <p className="text-sm text-[var(--forge-muted)]">
                      {artifact.description}
                    </p>
                  ) : null}
                  <p className="font-mono text-xs text-[var(--forge-faint)]">
                    {artifact.buildCommand}
                    <span className="text-[var(--forge-faint)]"> → </span>
                    {artifact.outputPath}
                  </p>
                  {latest?.status === "failed" && latest.errorMessage ? (
                    <p className="text-xs text-[var(--forge-danger)]">
                      {latest.errorMessage}
                    </p>
                  ) : null}
                  {latest?.startedAt ? (
                    <p className="text-xs text-[var(--forge-muted)]">
                      Latest {formatRelativeTime(latest.startedAt)}
                      {latest.commitSha
                        ? ` · ${latest.commitSha.slice(0, 7)}`
                        : ""}
                      {latest.sizeBytes != null
                        ? ` · ${latest.sizeBytes} bytes`
                        : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={building === artifact.name}
                    onClick={() => void runBuild(artifact.name)}
                  >
                    {building === artifact.name ? "Building…" : "Build"}
                  </Button>
                  {latest?.status === "success" ? (
                    <a
                      className="inline-flex items-center rounded-lg border border-[var(--forge-line)] px-3 py-1.5 text-sm text-[var(--forge-accent)] hover:text-[var(--forge-accent-hot)]"
                      href={`/api/projects/${projectId}/artifacts/${encodeURIComponent(artifact.name)}/builds/${latest.id}/download`}
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
