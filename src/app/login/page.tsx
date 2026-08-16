"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { APP_DISPLAY_NAME, appDisplayInitial } from "@/lib/app-name";
import { Button, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Login failed");
        return;
      }

      const from = searchParams.get("from") ?? "/";
      router.push(from);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="forge-app-bg flex min-h-full flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--forge-accent-muted)] text-3xl font-bold text-[var(--forge-accent-hot)] ring-1 ring-[color-mix(in_srgb,var(--forge-accent)_40%,transparent)]">
            {appDisplayInitial()}
          </div>
          <h1 className="forge-page-title justify-center text-center">
            {APP_DISPLAY_NAME}
          </h1>
          <p className="forge-page-sub">
            Deploy, agents, and fleet health — one console
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          data-testid="login-form"
          className="forge-surface-elevated p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        >
          {error ? (
            <div className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--forge-danger)_30%,transparent)] bg-[var(--forge-danger-muted)] px-3 py-2 text-sm text-[var(--forge-danger)]">
              {error}
            </div>
          ) : null}

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
              Username
            </span>
            <Input
              type="text"
              name="username"
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--forge-muted)]">
              Password
            </span>
            <Input
              type="password"
              name="password"
              data-testid="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            data-testid="login-submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
