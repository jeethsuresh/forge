# Orchestrator design overhaul (ground-up)

**Date:** 2026-08-13  
**Status:** Approved for implementation  
**Supersedes (UI chrome):** `2026-08-12-ui-overhaul-design.md` for shell, home, project navigation, and visual system. Backend/Forge 2.0 behavior unchanged.

## Goals (equal weight)

1. **Clarity of state** — At a glance, know what is healthy, broken, deploying, or waiting on an agent — without opening pages.
2. **Natural workflows** — Deploy, agent work, rollback, create/import require fewer decisions; primary action is always obvious.
3. **Visual identity** — Dual theme from day one; signal-board + editorial + steel restraint; not generic dark ops chrome.

## Product metaphor

**Hybrid cockpit → studio**

- **Home (`/`)** = fleet cockpit (lobby).
- **Project** = studio workplace.
- Navigation stays in one sidebar (Approach 2): fleet always visible; modes expand under the active project.

## Design principles (why)

| Principle | Rule | Why it works |
|-----------|------|--------------|
| Signal first | Semantic status color carries meaning; chrome is quiet | Operators scan for fire, not decoration |
| Editorial structure | Strong type hierarchy; generous air when calm | Calm UI = trustworthy “all clear” |
| Steel restraint | Sharp geometry, mono for machine truth, cool neutrals | Precision without glow/pill theater |
| Progressive density | Airy when idle; dense when busy | Same surface, different jobs |
| Hero surface | Each mode’s primary artifact owns the viewport | Diff/log/chat must be readable |
| Compress chrome | Secondary UI collapses to edges when hero is active | Density serves the use-case, not equal panels |
| Status in nav | Every sidebar row (project + mode) shows pulse | Never open a page to discover activity |
| One primary action | One unmistakable CTA per busy surface | Reduces decision paralysis |

## Information architecture

### Shell

```
[ Brand / Orchestrator ]
[ Cmd+K ]
────────────────
Fleet
  ○ Project A          (runtime + attention)
  ● Project B (active) (expanded)
      Overview         (health / attention)
      Deploy           (deploy pulse / last result)
      Agents           (live / idle)
      Changes          (dirty / clean)
      Settings         (no status theater)
  ○ Project C
  ○ Orchestrator (Self)
────────────────
[ New project ]
[ Global settings ]
```

### Routes

| Mode | Path | Legacy |
|------|------|--------|
| Overview | `/projects/[id]` | `?tab=overview` |
| Deploy | `/projects/[id]/deploy` | `?tab=deploy` |
| Agents | `/projects/[id]/agents` | `?tab=agents` |
| Changes | `/projects/[id]/changes` | `?tab=diff` |
| Settings | `/projects/[id]/settings` | `?tab=settings`, `?tab=config` |

Preserve query params used today (`session`, diff `mode`/`base`/`head`, etc.) on the new paths. Redirect old `?tab=` URLs.

### Home cockpit

**Calm fleet**

- Short status line (“N projects · all healthy”).
- Editorial project rows: name, one status phrase, one primary action.
- Needs-attention lane **omitted** when empty (no empty box).
- Identity stripe + status only — no card chrome.

**Busy / broken fleet**

- Needs-attention rises first.
- Hot projects densify (last deploy, live agent, failure reason).
- Healthy projects shrink to quiet one-liners.
- Primary CTA = fix intent (Deploy / Agents / Forgefile), not generic Open.

Services/ports directory = secondary strip below fleet.

### Project modes (studio)

Shared rules:

- Header = mode name + one status sentence (no badge piles).
- **Hero surface** owns most vertical/horizontal space.
- Surrounding chrome compresses.
- Destructive actions confirm in place with consequence text.

| Mode | Hero surface | Compress | Busy behavior |
|------|--------------|----------|---------------|
| Overview | Health / attention narrative | Meta, ports, teasers | Attention stack deep-links to fixing modes |
| Deploy | Live logs (busy) or last result + CTA (calm) | History, git tree, artifacts | Logs expand; history collapses |
| Agents | Transcript + composer | Session list → slim rail/overlay while chatting | Live session densifies; idle = airy picker |
| Changes | Diff / code viewer | File tree + commit form → edges | Dirty densifies file list; clean = short empty state |
| Settings | Active section form | Slim section nav | No status theater |

Deploy primary CTA: Deploy / Redeploy (or Update/Redeploy Forge). Rollback / Stop secondary but reachable.

## Visual system

### Personality

- **Signal board** — status does the talking; chrome nearly disappears.
- **Editorial** — typography hierarchy, magazine-like structure when calm.
- **Steel notes** — cool neutrals, sharp rows, mono for SHAs/logs/code.

### Dual theme (required day one)

- Semantic tokens identical in meaning across themes: `success`, `warning`, `danger`, `info`, `neutral`, `accent`.
- **Light:** paper ground, ink text, cool steel lines; accent sparingly for primary CTA.
- **Dark:** charcoal ground, bright ink; same semantics (not a naive invert).
- Preference: `light` | `dark` | `system`, persisted (localStorage), toggle in Global settings.
- Apply via `data-theme` (or class) on `<html>`; system uses `prefers-color-scheme`.

### Surfaces & components

- Almost no cards; borders only to separate interaction regions.
- Sidebar: flat list, status dots, identity stripe (decorative only — never overrides status).
- Reuse/extend `src/components/ui/*` and CSS tokens in `globals.css`.

### Motion (exactly these intentional motions)

1. Sidebar expand/collapse of project modes.
2. Density shift when a job goes busy (hero expands).
3. Status dot pulse while deploying / agent live.

No decorative motion when idle.

## Sidebar status model

| Row | Signal | Tones |
|-----|--------|-------|
| Project | Runtime + any child attention | success / warning / danger / info / neutral |
| Overview | Healthy vs needs attention (Forgefile, unexpected stop, etc.) | success / warning / danger |
| Deploy | Idle success / in progress / failed | success / warning / danger |
| Agents | Live session / idle | info / neutral |
| Changes | Dirty / clean | warning / neutral |
| Settings | None | — |

Home attention reasons and sidebar mode pulses must share vocabulary (extend `fleet-attention` / `ui-status` as needed).

## Command palette

Keep near-fullscreen Cmd/Ctrl+K. Update hrefs to intent routes. Ranking/docs behavior unchanged in spirit.

## Out of scope

- Backend / Ops API feature work
- Monaco rewrite
- New product features beyond presentation of existing data
- External design-system package

## Testing

- Unit: theme resolution, sidebar mode status mapping, attention→CTA hrefs, legacy `?tab=` → path redirects, palette hrefs.
- `./build.sh` → `./test.sh` green before finish.
- Manual: light/dark/system; calm vs busy home; each mode hero fills viewport; sidebar status matches canvas.

## Implementation order

1. Tokens + theme provider + settings control  
2. Mode status helpers + sidebar split nav  
3. Intent routes + legacy redirects  
4. Home progressive density + intent CTAs  
5. Project mode layouts with hero-surface compression  
6. Palette/link sweep + motion polish + README note  
