# Forge UI overhaul design

**Date:** 2026-08-12  
**Status:** Approved for implementation

## Goals

Optimize equally for three daily jobs:

1. Fleet overview (what’s healthy / needs attention)
2. Deploy / redeploy / rollback
3. Agent sessions

Constraints:

- ≤3 clicks from app open to each job
- Strong colour language (semantic + project identity)
- Raycast-like density + Railway-like project-as-hero
- Near-fullscreen Cmd/Ctrl+K search + command palette with documentation
- Ship as one continuous block (tokens → shell/home → project hub → density → palette → README)

## Information architecture

### Home (`/`)

Command center (replaces redirect to `/projects`):

- Fleet tiles: each project as hero object with identity colour stripe, runtime state, last deploy, active agent
- Needs-attention lane (failed deploy, blocked by agent, update available, unexpected stop)
- Per-tile actions: Open · Deploy · Agents

`/projects` reuses the same Home fleet UI (or redirects to `/`).

### Project hub (`/projects/[id]`)

Tabs (URL `?tab=`):

| Tab | `?tab=` | Owns |
|-----|---------|------|
| Overview | `overview` (default) | Health, last deploy, active agent, containers peek, CTAs |
| Deploy | `deploy` | Deploy/redeploy/rollback/stop, logs, containers; git tree collapsed by default |
| Agents | `agents` | Sessions + chat |
| Changes | `diff` | Diff / commit / edit |
| Settings | `settings` | Rename, branches, routing, env, history, danger zone |

Legacy: `?tab=config` redirects to `settings`.

### Global settings

Unchanged routes; reachable from sidebar and Cmd+K.

## Colour system

### Surfaces

`bg-app` → `bg-panel` → `bg-elevated` → `bg-overlay`

### Semantic tokens

| Token | Meaning |
|-------|---------|
| success | Healthy / success |
| warning | Degraded / deploying / needs attention |
| danger | Failed / destructive |
| info | Agent running / streaming |
| neutral | Idle / archived / unknown |
| accent | Primary CTA (warm orange) |

### Project identity

Stable hue from hash of project id. Used as stripe on Home, Sidebar, palette rows. Never overrides semantic status badges.

### Action colour

- Deploy / primary → accent
- Stop / Rollback → danger
- Agent running indicators → info

## Command palette

- Trigger: Cmd/Ctrl+K; Esc closes
- Near-fullscreen modal (~90–95% viewport)
- Search corpus: projects, sessions, deploys, settings sections, help
- Context-aware ranking from current route + selection + typed query
- Detail/docs pane; `?` / `help` opens catalog
- Destructive actions navigate to confirm on target screen
- Documented in-palette, shortcuts UI, and README

## Density

- Shared UI primitives under `src/components/ui/`
- Deploy: one primary CTA; secondary/overflow for pause/rollback/stop
- Agents: primary Send / Finish & deploy / Stop; Session overflow for the rest
- Branch graph on Deploy collapsed by default

## Out of scope

Backend/Ops API features, Monaco rewrite, light mode, motion system, dedicated per-intent routes, server FTS.

## Future (README TODOs)

- Light mode + theme toggle
- Rich motion / transition system
- Dedicated routes per intent (not only `?tab=`)
- External/heavier design-system package
- Server-backed full-text search across logs/history

## Testing

- Unit tests: project swatch hash, status→colour, palette ranking/context
- `./build.sh` → `./test.sh` green; preserve `?tab=` deep links with redirects
