"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { GIT_HTTPS_BASIC_USERNAME } from "@/lib/git-https-auth";

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--forge-muted)]">
          {label}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block break-all font-mono text-xs text-[var(--forge-bright)]">
        {value}
      </code>
    </div>
  );
}

export function GitHttpsCredentials({
  cloneToken,
  onRegenerate,
  regenerating = false,
}: {
  /** Per-repo fgc.* token used as the git HTTPS password. */
  cloneToken?: string | null;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
}) {
  const password = cloneToken?.trim() || "";
  const username = GIT_HTTPS_BASIC_USERNAME;

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-[var(--forge-muted)]">
        Git HTTPS clone token (push / pull only for this repo)
      </div>
      <CopyValue label="Username" value={username} />
      {password ? (
        <CopyValue label="Password (clone token)" value={password} />
      ) : (
        <p className="text-xs text-[var(--forge-faint)]">
          Clone token not available yet. Open Settings after the Forge repo is
          linked, or regenerate.
        </p>
      )}
      {onRegenerate ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={regenerating}
          onClick={() => {
            if (
              !window.confirm(
                "Regenerate this clone token? Existing remotes using the old password will stop working until you update them.",
              )
            ) {
              return;
            }
            void onRegenerate();
          }}
        >
          {regenerating ? "Regenerating…" : "Regenerate clone token"}
        </Button>
      ) : null}
      <p className="text-xs text-[var(--forge-faint)]">
        This token only authorizes git clone/fetch/push for this Forge
        repository. It cannot call Ops or other APIs. Example:{" "}
        <code className="text-[var(--forge-muted)]">
          https://{username}:&lt;token&gt;@host/api/git/&lt;slug&gt;.git
        </code>
      </p>
    </div>
  );
}
