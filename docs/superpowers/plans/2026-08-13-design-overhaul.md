# Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ground-up Orchestrator UI redesign: dual theme, split sidebar with per-mode status, intent routes, progressive-density home, and hero-surface project canvases.

**Architecture:** Semantic CSS tokens with `data-theme` on `<html>`; client theme preference in localStorage; project intent routes under `/projects/[id]/{deploy,agents,changes,settings}` with legacy `?tab=` redirects; shared project shell layout; mode status derived from fleet/detail signals for sidebar pulses.

**Tech Stack:** Next.js App Router, React client components, Tailwind v4 + CSS variables, Vitest, existing `src/components/ui/*`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-design-overhaul-design.md`
- Do not change Ops/backend behavior except additive list fields needed for sidebar status (e.g. active agent / dirty flag) when cheap.
- Preserve deep links (`session`, diff query params) on new paths.
- Run `./build.sh` → `./test.sh` before claiming done; never run Forge `./deploy.sh`.
- No cards-as-decoration; semantic status never overridden by project swatch.
- Commits only when the user/plan step requests them (this plan’s commit steps are authorized by “write the full spec and execute”).

## File map

| File | Responsibility |
|------|----------------|
| `src/app/globals.css` | Light + dark token sets; density/atmosphere utilities |
| `src/lib/theme.ts` | Preference type, resolve effective theme, storage key |
| `src/components/ThemeProvider.tsx` | Apply `data-theme`, listen to system changes |
| `src/lib/project-routes.ts` | Mode paths, legacy tab resolve, href builders |
| `src/lib/mode-status.ts` | Per-mode sidebar tone from project signals |
| `src/components/Sidebar.tsx` | Split fleet + expanded modes + status dots |
| `src/app/(dashboard)/projects/[id]/layout.tsx` | Shared project chrome (optional thin wrapper) |
| `src/app/(dashboard)/projects/[id]/page.tsx` | Overview canvas (extract from monolith) |
| `src/app/(dashboard)/projects/[id]/deploy/page.tsx` | Deploy mode |
| `src/app/(dashboard)/projects/[id]/agents/page.tsx` | Agents mode |
| `src/app/(dashboard)/projects/[id]/changes/page.tsx` | Changes mode |
| `src/app/(dashboard)/projects/[id]/settings/page.tsx` | Settings mode |
| `src/components/HomeCommandCenter.tsx` | Progressive density + intent CTAs |
| `src/lib/command-palette/rank.ts` | Intent hrefs |
| `src/lib/project-diff-url.ts` | Changes path hrefs |
| `src/components/GlobalSettings.tsx` | Theme preference UI |
| `src/app/layout.tsx` | Mount ThemeProvider; blocking theme script optional |

---

### Task 1: Theme tokens + resolution

**Files:**
- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`, `src/components/ThemeProvider.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/GlobalSettings.tsx`

**Interfaces:**
- Produces: `ThemePreference = "light" | "dark" | "system"`; `EffectiveTheme = "light" | "dark"`; `THEME_STORAGE_KEY`; `resolveEffectiveTheme(pref, systemDark)`; `readThemePreference()`; `writeThemePreference(pref)`

- [ ] **Step 1: Write failing tests for theme resolution**

```ts
// src/lib/theme.test.ts
import { describe, expect, it } from "vitest";
import { resolveEffectiveTheme } from "./theme";

describe("resolveEffectiveTheme", () => {
  it("maps light/dark directly", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });
  it("follows system when preference is system", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `./test.sh` (or vitest filter `theme.test`)  
Expected: FAIL cannot find module / resolveEffectiveTheme

- [ ] **Step 3: Implement `theme.ts` + CSS dual tokens + ThemeProvider + settings control**

- `:root` / `[data-theme="light"]` and `[data-theme="dark"]` (or default dark on `:root`, light overrides).
- Light: paper `#f7f5f1`, ink `#1a1814`, steel lines, same semantic hues adjusted for contrast.
- Dark: keep refined charcoal from current warm-ops (steel-cool the neutrals slightly).
- Inline script in `layout.tsx` before paint to set `data-theme` from localStorage + matchMedia (avoid flash).
- Global settings: Appearance section with Light / Dark / System.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts src/components/ThemeProvider.tsx src/app/globals.css src/app/layout.tsx src/components/GlobalSettings.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add dual theme tokens and preference control

EOF
)"
```

---

### Task 2: Project routes + mode status helpers

**Files:**
- Create: `src/lib/project-routes.ts`, `src/lib/project-routes.test.ts`, `src/lib/mode-status.ts`, `src/lib/mode-status.test.ts`
- Modify: `src/lib/project-diff-url.ts` (+ tests), `src/lib/command-palette/rank.ts` (+ tests)

**Interfaces:**
- Produces:
  - `ProjectMode = "overview" | "deploy" | "agents" | "changes" | "settings"`
  - `projectModeHref(id, mode, query?: Record<string,string>)`
  - `resolveProjectModeFromPath(pathname): { id, mode } | null`
  - `legacyTabToMode(tab): ProjectMode`
  - `modeStatuses(signals): Record<ProjectMode, SemanticTone>` (settings may be `"neutral"` unused)

```ts
export type ModeStatusSignals = {
  runtimeStatus: RuntimeStatus;
  isDeploying: boolean;
  latestDeployStatus: string | null;
  hasAttention: boolean; // overview hot
  agentLive: boolean;
  workingTreeDirty: boolean;
};
```

- [ ] **Step 1: Failing tests for hrefs, legacy tabs, mode tones**
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement helpers; update diff URL + palette to `/changes` paths**
- [ ] **Step 4: Tests PASS**
- [ ] **Step 5: Commit** `feat(ui): add project intent routes and mode status helpers`

---

### Task 3: Split sidebar with per-mode status

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Optionally extend: `src/app/api/projects/route.ts` with `hasLiveAgent?: boolean` and `workingTreeDirty?: boolean` if already cheap; otherwise derive deploy/overview from existing fields and treat agents/changes as neutral until detail fetch — **prefer additive API fields**.

- [ ] **Step 1: Unit-test pure path-active helpers if extracted**
- [ ] **Step 2: Implement expanded modes under active project; status dots on project + each mode; animate expand**
- [ ] **Step 3: Active detection via pathname prefixes (`/projects/id`, `/projects/id/deploy`, …)**
- [ ] **Step 4: Manual sanity + unit tests green**
- [ ] **Step 5: Commit** `feat(ui): expand project modes in sidebar with status pulses`

---

### Task 4: Intent route pages + legacy redirects

**Files:**
- Create route pages under `src/app/(dashboard)/projects/[id]/…`
- Modify monolith `page.tsx` to overview-only or shared `ProjectStudio` driven by mode prop
- Add client redirect when `?tab=` present → new path (preserve other query keys)

**Preferred structure:** Extract `ProjectStudio({ mode })` from current page; thin route files pass mode. Avoid duplicating fetch logic.

- [ ] **Step 1: Test legacy tab→path mapping (already in project-routes)**
- [ ] **Step 2: Extract shared studio component; wire five routes**
- [ ] **Step 3: Redirect effect/component for `?tab=`**
- [ ] **Step 4: Update in-app links (Home, DeployTargetPorts, etc.) to `projectModeHref`**
- [ ] **Step 5: Commit** `feat(ui): route project modes as first-class paths`

---

### Task 5: Home progressive density + intent CTAs

**Files:**
- Modify: `src/components/HomeCommandCenter.tsx`, `src/lib/fleet-attention.ts` (+ test for CTA href/reason)

- [ ] **Step 1: Extend attention items with `href` / primary action label**
- [ ] **Step 2: Calm layout omits empty attention lane; busy densifies hot rows**
- [ ] **Step 3: Tests for attention→href**
- [ ] **Step 4: Commit** `feat(ui): progressive-density home with intent CTAs`

---

### Task 6: Hero-surface canvases

**Files:**
- Modify studio mode sections in extracted component(s); `AgentWorkspace.tsx`, `ProjectDiffPanel.tsx`, deploy logs panel as needed for flex/min-h-0 hero fill

Rules per mode from spec table. Remove redundant in-page tablist (sidebar owns mode switch).

- [ ] **Step 1: Overview — attention narrative hero; compress meta**
- [ ] **Step 2: Deploy — logs flex-1 when deploying; CTA compact**
- [ ] **Step 3: Agents — transcript flex-1; session list slim when session open**
- [ ] **Step 4: Changes — diff viewer flex-1; tree/commit compressed**
- [ ] **Step 5: Settings — section form hero; slim nav**
- [ ] **Step 6: Commit** `feat(ui): give each project mode a hero work surface`

---

### Task 7: Polish + verification

- Sweep remaining `?tab=` links
- Motion: sidebar expand, density shift, pulse (CSS only)
- README short note on theme + routes if README documents UI
- `./build.sh` → `./test.sh`
- Commit: `feat(ui): finish design overhaul polish and link sweep`

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Dual theme day one | 1 |
| Split sidebar + mode status | 2–3 |
| Intent routes + legacy redirects | 2, 4 |
| Home progressive density | 5 |
| Hero surfaces / compress chrome | 6 |
| Palette/diff hrefs | 2, 7 |
| Motion trio | 3, 6, 7 |
| Build/test gate | 7 |
