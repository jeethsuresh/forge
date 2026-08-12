# Forge UI overhaul — implementation plan

> Spec: `docs/superpowers/specs/2026-08-12-ui-overhaul-design.md`

## File map

| Path | Responsibility |
|------|----------------|
| `src/app/globals.css` | Surface + semantic CSS tokens |
| `src/lib/project-swatch.ts` | Stable project identity colour |
| `src/lib/ui-status.ts` | Semantic status → token class helpers |
| `src/components/ui/*` | Button, Badge, Tabs, Panel, StatusDot, ProjectSwatch, Kbd |
| `src/components/HomeCommandCenter.tsx` | Fleet + needs-attention |
| `src/components/CommandPalette.tsx` | Near-fullscreen search/command UI |
| `src/lib/command-palette/*` | Corpus, ranking, help catalog |
| `src/app/(dashboard)/page.tsx` | Home |
| `src/app/(dashboard)/projects/page.tsx` | Redirect or reuse Home |
| `src/app/(dashboard)/projects/[id]/page.tsx` | Tab model + Overview + Deploy chrome |
| `src/components/AgentWorkspace.tsx` | Primary/overflow action chrome |
| `src/components/Sidebar.tsx` / `DashboardShell.tsx` | Home link, ⌘K, swatches |
| `README.md` | Palette docs + Future TODOs |

## Tasks

Execute in order from the approved Cursor plan todos: tokens → shell/home → project hub → density → palette → README → verify.
