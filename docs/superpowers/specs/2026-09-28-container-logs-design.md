# Container logs and runtime Up/Down badges

Date: 2026-09-28  
Status: approved for implementation  
Related: `docs/superpowers/plans/2026-08-12-forge-2.0-service-directory.md`

## Problem

Forge shows compose containers and service-directory Up/Down badges, but:

1. There is no way to read **per-container logs** in the UI. Agents debugging a crash only have deploy script output, which often omits the container’s own stdout/stderr — especially when the container exits during start.
2. Service-directory **Down** is wrong for running stacks. Observation treats a missing parsed publish list as down, and HTTP health probes overwrite runtime with down. Podman `docker ps --format json` often has an empty `Ports` string even while the container is running.

## Goals

1. Persist the latest docker logs (and start-failure inspect error) for each compose container in SQLite so the UI and Ops/agents can read them after the container exits or is removed.
2. Show those logs in the project UI (overview + deploy containers table), including containers that failed to start.
3. Expose the same snapshot on Ops: `GET /api/ops/projects/{projectId}/containers/{containerName}/logs`.
4. Up/Down badges follow **container runtime**: if a compose container for that deploy target is running, the badge is **Up**, never Down.

## Non-goals

- Streaming/follow logs (snapshot + on-demand refresh is enough).
- Storing full historical log versions per capture (one latest snapshot per container name).
- Replacing deployment logs or agent session logs.
- Auto-redeploy on health failure (unchanged).

## Runtime status (Up / Down)

`service_directory.status` is **runtime**, not HTTP health.

- **Up** when at least one compose container for that deploy target is running (`state` is `running` / `up…`, or docker `Status` starts with `Up`).
- **Down** when no such container is running (missing, created, exited, dead).
- Unpublished or unparsable ports do **not** force Down. They only affect `boundPort`.
- HTTP health probes still record `lastCheckedAt`, `lastLatencyMs`, and `lastError`. A failed probe must **not** set status to Down while a container is running. A successful probe may set status Up.

UI labels are `Up` / `Down` (capitalized). Container row pills use the same rule, not a raw `state === "running"` string compare that misses `Up`.

A periodic refresh (service-health tick) re-observes runtime from `docker ps -a` so badges stay correct between deploys.

## Stored logs

Table `container_logs`:

| Column | Notes |
|---|---|
| `id` | uuid |
| `project_id` | cascade delete |
| `compose_slug` | compose `-p` name |
| `container_name` | docker name |
| `service` | compose service |
| `state` | last seen docker state |
| `status` | last seen docker status text |
| `logs` | sanitized stdout+stderr snapshot |
| `inspect_error` | `State.Error` / start failure text, nullable |
| `deployment_id` | optional, last deploy that triggered capture |
| `captured_at` | timestamp |

Unique `(project_id, container_name)`. Upsert latest snapshot.

Capture:

- After deploy observe (success).
- After deploy failure / rollback (so start-crash logs survive `compose down`).
- On demand when UI/Ops GET logs (`?refresh=1` always pulls live docker first).
- During the runtime refresh tick (best-effort; do not block health probes if docker logs hang).

Collection: `docker logs --tail 2000` plus `docker inspect` `State` (`Error`, `ExitCode`, `OOMKilled`, `Status`). If logs are empty but inspect reports a start error, store that as the snapshot body prefix. Redact `fos.*` / `fgc.*` / bearer tokens the same way agent container logs do. Cap stored text at 100_000 characters (keep the tail).

Removed containers keep the last snapshot until the project is deleted.

## APIs

Dashboard (cookie): `GET /api/projects/{id}/containers/{containerName}/logs?tail=200&refresh=0|1`

Ops: `GET /api/ops/projects/{projectId}/containers/{containerName}/logs` with the same query. Session tokens are project-scoped. Register `ops.project.container_logs.get` and a curl example in the agent prompt.

Response:

```ts
{
  projectId: string;
  containerName: string;
  service: string;
  state: string;
  status: string;
  logs: string;
  inspectError: string | null;
  capturedAt: string;
  refreshed: boolean;
}
```

404 if the project has no stored row and live docker has no such container.

## UI

Replace the static containers lists on Overview and Deploy with an expandable per-container panel: service name, **Up**/**Down** pill, docker status/ports, **Logs** disclosure that fetches the snapshot (refresh on open). Empty logs show the inspect error or “No logs captured yet”.

## Testing

- Observation: running container + empty Ports → Up; no containers → Down; unpublished port stays Up while the stack runs.
- Health: HTTP 503 sets `lastError` but leaves status Up if a container is running.
- Log helpers: redact secrets, cap length, upsert by container name, inspect-error fallback when docker logs are empty.
- Catalog includes the new Ops GET path (registry maps it to a callable tool).
