# Agent Assignment Rules
## Governance: V3.1 STRICT — Multi-Agent Execution Protocol

---

## 1. IDENTITY

Each agent operating in this project is assigned **one lane**. Your lane defines your identity for the entire execution. You are not a general-purpose agent. You are a lane agent.

| Lane | Phase Scope | Responsibility |
|---|---|---|
| `CONTROL` | P0 | Registry and rule maintenance only |
| `LANE_THEME` | P1, P2 | Token system + runtime injection |
| `LANE_SHELL` | P3 | App-shell layout architecture |
| `LANE_AUTH` | P4 | Authentication + multi-role system |
| `LANE_STATE` | P5 | Global state + server state |
| `LANE_COMPONENTS` | P6 | Component system migration |
| `LANE_ROUTING` | P7 | Routing performance + resilience |

---

## 2. PRE-EXECUTION CHECKLIST

Before writing a single file, every agent must complete this checklist in order:

### Step 1 — Read the Registry
Read `execution/registry.json` in full. Do not proceed until you have confirmed:
- The segment you are about to execute has `"status": "PENDING"`
- All segments listed in its `"depends_on"` array have `"status": "PASS"`
- If any dependency is not `PASS`, **halt and report to the coordinator**

### Step 2 — Read the Lane Map
Read `execution/lanes.json`. Confirm:
- Your lane is listed with the correct phase and segment scope
- Every file you intend to write appears in your lane's `owned_files` array
- If a file you need is in another lane's ownership, **halt and flag a shared file conflict**

### Step 3 — Read the Target Files
Before editing any existing file, read its current state in full. Never assume the file matches a prior version — another lane may have already modified it.

### Step 4 — Execute
Write only the files in your `owned_files` list. Nothing else.

### Step 5 — Update the Registry
After every segment passes its acceptance criteria, update `execution/registry.json`:
- Set `"status": "PASS"` for the completed segment
- Set `"assigned_agent"` to your lane identifier
- Set `_meta.last_updated` to the current date

---

## 3. SINGLE-LANE OWNERSHIP RULE

> **One agent. One lane. One phase scope. No exceptions.**

- You may not write files outside your `owned_files` list
- You may not modify files owned by another lane's directory
- You may not "help" another lane by modifying their files, even if you believe it would be faster
- You may not move files between directories without coordinator approval
- If a file you need is not in your lane, raise it as a dependency request — do not write it

Violations of lane ownership **invalidate the segment**. The segment must be re-executed from scratch.

---

## 4. SHARED FILE PROTOCOL

Two files are shared across multiple lanes: `src/main.tsx` and `src/App.tsx`. These files are the only exception to the single-lane rule, and they are governed by strict handoff rules.

### src/main.tsx — Touch Order
```
1. LANE_THEME    (P2-S2)  — Adds ThemeProvider + ThemeTuningProvider
2. LANE_STATE    (P5-S1)  — Adds QueryClientProvider
3. LANE_AUTH     (P4-S2)  — Adds AuthProvider
```
**Rule:** Read the current file before every edit. Never delete or reorder a provider that a previous lane inserted. Stack order is: `QueryClientProvider > ThemeProvider > ThemeTuningProvider > AuthProvider > App`.

### src/App.tsx — Touch Order
```
1. LANE_SHELL      (P3-S5)  — Rebuilds route structure, replaces Shell/Navbar/Footer
2. LANE_COMPONENTS (P6-S4)  — Adds root-level Cart overlay
3. LANE_ROUTING    (P7-S1)  — Converts imports to lazy
4. LANE_ROUTING    (P7-S2)  — Wraps routes in Suspense
5. LANE_ROUTING    (P7-S3)  — Wraps tree in ErrorBoundary
```
**Rule:** Read the current file before every edit. Never remove routing structure, shell wrappers, or overlays added by a previous lane. Each agent adds to the existing structure — they do not replace it.

---

## 5. DEPENDENCY ENFORCEMENT

Phases are gated. No phase may begin until its dependency phase is fully `PASS`.

```
P0 → no dependency     (always starts first)
P1 → requires P0 PASS
P2 → requires P1 PASS
P3 → requires P2 PASS
P4 → requires P3 PASS
P5 → requires P4 PASS
P6 → requires P5 PASS
P7 → requires P6 PASS
```

Segments within a phase execute sequentially unless the registry explicitly shows all intra-phase dependencies as `PASS`.

**Parallel execution is permitted** between lanes at the same phase depth, ONLY if:
1. Both phases have their dependency phase fully `PASS`
2. The two lanes own zero overlapping files in that execution window
3. The coordinator has confirmed the parallel window is open

---

## 6. WHAT YOU MAY NOT DO

The following actions are prohibited for all lane agents:

| Prohibited Action | Reason |
|---|---|
| Write a file not in your `owned_files` list | Lane violation |
| Begin a segment before its dependencies are `PASS` | Dependency violation |
| Skip reading the registry before execution | Protocol violation |
| Skip reading target files before editing them | Blind write — high risk of regression |
| Edit `execution/registry.json` except to mark your own segment `PASS` | CONTROL lane is the registry authority |
| Remove or override code added by a previous lane | Regression |
| Import GSAP in any component | LANE_COMPONENTS rule — Framer Motion only |
| Use hardcoded pixel values for spacing or animation timing | LANE_THEME rule — use CSS variable tokens |
| Create files in directories not owned by your lane | Directory violation |
| Run `npm install` without coordinator approval | Dependency management is coordinated |

---

## 7. BLOCKING AND ESCALATION

If at any point your execution is blocked — dependency not `PASS`, file conflict, lane ownership ambiguity — you must:

1. **Stop writing immediately**
2. Record your block state in plain language
3. Report to the coordinator with:
   - Which segment you are executing
   - Which file or dependency is blocking you
   - What you need to unblock
4. **Do not work around the block** by writing to a different file or a different segment

---

## 8. ACCEPTANCE CRITERIA ARE FINAL

Every segment in `registry.json` has an `acceptance_criteria` array. A segment is `PASS` only when **all** criteria are met — not most, not close. If any criterion is unmet, the segment stays `IN_PROGRESS` or reverts to `PENDING`.

Do not mark a segment `PASS` if the criteria are not fully satisfied. The next phase agent will build on your output. Incomplete work creates cascading failures.

---

## 9. VELARI IS THE CANONICAL REFERENCE

All decisions about naming, values, structure, and behavior default to the Velari Nights App as the reference system. The target system (`velari-systems-research`) must conform to Velari — not approximate it, not reinterpret it.

When in doubt about a token value, component shape, or architectural pattern, the Velari codebase is the source of truth.

Location: `/Users/velari/Documents/GitHub/VelariNights-APP`

---

*End of Agent Assignment Rules — V3.1 STRICT*
