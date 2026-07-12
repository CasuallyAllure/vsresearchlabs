# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Frontend Design Protocol (MANDATORY)

Before ANY frontend/UI work (new components, redesigns, style changes, page builds), consult the installed design skills in `.claude/skills/` — they are the first checkpoint, not an afterthought:

1. **ui-ux-pro-max** — searchable style/palette/typography/UX database; run its search for the relevant domain first.
2. **web-design-guidelines** — Vercel's interface guidelines; use as the compliance audit checklist after building.
3. **emil-design-eng** — polish philosophy: animation restraint, invisible details, interaction feel.
4. **high-end-visual-design / redesign-existing-projects** — anti-generic standards; blocks "cheap AI design" defaults.
5. **make-interfaces-feel-better** — spacing, borders, shadows, hit areas, interaction states.
6. **gpt-taste / brandkit / image-to-code / extract-design-system** — creative direction, brand systems, design-token extraction when relevant.

Design direction of record: `docs/DESIGN_2026_BLUEPRINT.md` (2026 glass/floating-module system) layered on the existing silver/graphite/cream palette. Read it before touching UI.
