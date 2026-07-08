"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

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

      const from = searchParams.get("from") ?? "/projects";
      router.push(from);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/20 text-2xl font-bold text-orange-400">
            O
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100">{APP_DISPLAY_NAME}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Local Docker deployment orchestrator
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
        >
          {error && (
            <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Username
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
              autoComplete="username"
              required
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
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
