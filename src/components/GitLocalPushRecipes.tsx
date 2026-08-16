"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { localPushRecipes } from "@/lib/git-local-push-recipes";
import { GitHttpsCredentials } from "@/components/GitHttpsCredentials";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--forge-muted)]">
          {label}
        </span>
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-[10px] border border-[var(--forge-border)] bg-[var(--forge-panel)] p-3 font-mono text-xs text-[var(--forge-bright)] whitespace-pre-wrap">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function GitLocalPushRecipes({
  httpsUrl,
  sshUrl,
  defaultBranch,
}: {
  httpsUrl: string;
  sshUrl?: string | null;
  defaultBranch: string;
}) {
  const recipes = localPushRecipes({ httpsUrl, defaultBranch });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-medium text-[var(--forge-muted)]">
          HTTPS (smart HTTP)
        </div>
        <code className="mt-1 block break-all font-mono text-xs text-[var(--forge-bright)]">
          {httpsUrl}
        </code>
      </div>
      <GitHttpsCredentials />
      {sshUrl ? (
        <div>
          <div className="text-xs font-medium text-[var(--forge-muted)]">
            SSH
          </div>
          <code className="mt-1 block break-all font-mono text-xs text-[var(--forge-bright)]">
            {sshUrl}
          </code>
          <p className="mt-1.5 text-xs text-[var(--forge-faint)]">
            Register keys under Global settings → Git SSH.
          </p>
        </div>
      ) : null}
      <CopyBlock
        label="New folder or repo with no origin"
        text={recipes.noOrigin}
      />
      <CopyBlock
        label="Existing origin (e.g. GitHub)"
        text={recipes.existingOrigin}
      />
    </div>
  );
}
