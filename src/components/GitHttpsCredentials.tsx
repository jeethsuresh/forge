"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import {
  GIT_HTTPS_BASIC_USERNAME,
  gitHttpsPasswordHelp,
} from "@/lib/git-https-auth";

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

export function GitHttpsCredentials() {
  const password = gitHttpsPasswordHelp();
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-[var(--forge-muted)]">
        Git HTTPS (when git asks for a username and password)
      </div>
      <CopyValue label="Username" value={GIT_HTTPS_BASIC_USERNAME} />
      <CopyValue label="Password" value={password} />
      <p className="text-xs text-[var(--forge-faint)]">
        Git Basic auth uses any username (we show{" "}
        <code className="text-[var(--forge-muted)]">git</code>) and the Ops or
        agent token as the password — not the dashboard login. Example:{" "}
        <code className="text-[var(--forge-muted)]">
          https://{GIT_HTTPS_BASIC_USERNAME}:&lt;token&gt;@host/api/git/&lt;slug&gt;.git
        </code>
      </p>
    </div>
  );
}
