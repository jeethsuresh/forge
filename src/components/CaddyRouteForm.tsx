"use client";

import { FormEvent } from "react";
import type { HttpServerSummary, RouteFormValues } from "@/lib/caddy-config";

export function CaddyRouteForm({
  values,
  servers,
  inheritedHosts = [],
  inheritedPaths = [],
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  loading,
  disabled = false,
  showActions = true,
  formClassName = "space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5",
  datalistId = "caddy-server-names",
}: {
  values: RouteFormValues;
  servers: HttpServerSummary[];
  inheritedHosts?: string[];
  inheritedPaths?: string[];
  onChange: (values: RouteFormValues) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  showActions?: boolean;
  formClassName?: string;
  datalistId?: string;
}) {
  const serverOptions =
    servers.length > 0
      ? servers.map((server) => server.name)
      : [values.serverName || "srv0"];

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit?.();
      }}
      className={formClassName}
    >
      {(inheritedHosts.length > 0 || inheritedPaths.length > 0) && (
        <div className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
          Inherited from parent subroute:{" "}
          {inheritedHosts.length > 0 && (
            <span className="text-zinc-400">
              hosts {inheritedHosts.join(", ")}
            </span>
          )}
          {inheritedHosts.length > 0 && inheritedPaths.length > 0 && " · "}
          {inheritedPaths.length > 0 && (
            <span className="text-zinc-400">
              paths {inheritedPaths.join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            HTTP server
          </span>
          <input
            list={datalistId}
            value={values.serverName}
            onChange={(e) =>
              onChange({ ...values, serverName: e.target.value })
            }
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
            required
          />
          <datalist id={datalistId}>
            {serverOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Hosts
          </span>
          <input
            type="text"
            value={values.hosts}
            onChange={(e) => onChange({ ...values, hosts: e.target.value })}
            placeholder="app.example.com, www.example.com"
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Paths
          </span>
          <input
            type="text"
            value={values.paths}
            onChange={(e) => onChange({ ...values, paths: e.target.value })}
            placeholder="/api/*, /static/*"
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
          <span className="mt-1 block text-xs text-zinc-600">
            Comma-separated matchers. Provide at least one host or path.
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Handler
          </span>
          <select
            value={values.handlerKind}
            onChange={(e) =>
              onChange({
                ...values,
                handlerKind: e.target.value as RouteFormValues["handlerKind"],
              })
            }
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
          >
            <option value="reverse_proxy">Reverse proxy</option>
            <option value="file_server">File server</option>
            <option value="respond">Static response</option>
          </select>
        </label>

        {values.handlerKind === "reverse_proxy" && (
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Upstream dial
            </span>
            <input
              type="text"
              value={values.upstreamDial}
              onChange={(e) =>
                onChange({ ...values, upstreamDial: e.target.value })
              }
              placeholder="127.0.0.1:8080"
              disabled={disabled}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
              required
            />
          </label>
        )}

        {values.handlerKind === "file_server" && (
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Root directory
            </span>
            <input
              type="text"
              value={values.fileRoot}
              onChange={(e) => onChange({ ...values, fileRoot: e.target.value })}
              placeholder="/var/www"
              disabled={disabled}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
              required
            />
          </label>
        )}

        {values.handlerKind === "respond" && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-400">
                Status code
              </span>
              <input
                type="number"
                min={100}
                max={599}
                value={values.respondStatus}
                onChange={(e) =>
                  onChange({ ...values, respondStatus: e.target.value })
                }
                disabled={disabled}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-zinc-400">
                Response body
              </span>
              <textarea
                value={values.respondBody}
                onChange={(e) =>
                  onChange({ ...values, respondBody: e.target.value })
                }
                rows={3}
                disabled={disabled}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
                required
              />
            </label>
          </>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={loading || disabled}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
          >
            {submitLabel ?? "Save route"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={loading || disabled}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
}
