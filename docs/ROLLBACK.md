# Rollback runbook

Backlog: P1-14 (`docs/SYSTEM_SCAN_2026-07-16.md`) — the README documents three
forward deploys and zero reverses.

This repo has **three independent, manual deploy targets**. `git push` deploys
nothing. So there is no "revert the commit and it's fixed" — reverting a commit
changes nothing in production until you re-run the relevant deploy below.

Verified against the tooling actually installed here: **wrangler 4.86.0**,
**supabase CLI 2.106.0**, Supabase project `ufaajzfuppohbxebftwp`, Cloudflare
Worker `vsresearchlabs` (`wrangler.jsonc`).

---

## Rollback order — the reverse of deploy order

Deploy order is migrations → edge functions → frontend (README, and the
per-wave deploy gate in `docs/REMEDIATION_BLUEPRINT.md`). **Roll back in the
reverse: frontend → edge functions → database.**

The database is last and, in practice, never — and that is by design, not
neglect. Migrations here are **additive-only**, which is exactly what makes the
other two rollbacks safe: old frontend and old function code still run against
the newer schema, because nothing they depend on was removed or renamed. Keep
migrations additive and rollback stays a two-target problem. Break that
convention and you lose the ability to roll back anything independently.

---

## 1. Frontend (Cloudflare Worker `vsresearchlabs`)

The only target with a real rollback verb.

```bash
wrangler versions list          # 10 most recent versions
wrangler rollback <version-id> -m "reason for rollback"
```

`wrangler rollback` takes an optional `[version-id]`; omit it to roll back to
the previous version. Add `-y` to skip prompts.

**Unverified caveat — confirm once, before you need it.** This Worker serves
static assets (`wrangler.jsonc` → `assets.directory: ./dist`). A Worker version
is expected to carry its asset manifest, so a rollback should restore the old
`dist/` too — but that has **not** been confirmed against this Worker. Do the
dry run described in "Operator: confirm this runbook once" below rather than
discovering the answer during an incident.

### Fallback: rebuild from a known-good commit

If `rollback` is unavailable or the version list doesn't reach far enough:

```bash
cd /Users/velari/Documents/GitHub/vsresearchlabs   # repo ROOT — see warning
git checkout <last-good-sha>
npm ci && npm run build && wrangler deploy
```

⚠ **Always from the repo root, never a git worktree.** Worktrees have no
`.env.local`, so `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` don't get baked
into the bundle and production boots into "backend not configured" — a
self-inflicted outage on top of the one you're fixing. `dist/` is gitignored,
so there is no prebuilt artifact to fall back to; it is always a rebuild.

### Release provenance — which commit is live?

Every build stamps `dist/version.json` (via `scripts/viteVersionStamp.ts`,
outside the hashed bundles so `dist/assets` stays byte-reproducible), and the
Worker serves `dist/` as-is — so the live origin identifies its own commit:

```bash
curl -s https://vsresearchlabs.com/version.json
# {"commit":"<full sha>","shortCommit":"…","branch":"…","source":"git|env|unknown","buildTime":"…"}
```

Check it **before and after** a rollback or redeploy to confirm what actually
changed (index.html also carries `<meta name="release" content="<sha>">`).
Manual `wrangler` deploys can additionally label the Worker version itself:
`npx wrangler versions upload --message "<sha>"` — optional; the message then
shows in `wrangler versions list`.

---

## 2. Edge functions (Supabase)

**There is no rollback verb.** `supabase functions` has `list`, `deploy`,
`delete`, `download`, `new`, `serve` — no `rollback`, no version history.

`supabase functions list` shows a version number per function (`place-order`
was at **56** on 2026-07-16), but that number only ever **increments**. There
is no way to ask the platform for the source of version 55.

**Step 0 — capture what's live before you overwrite it.** `download` fetches
the source of the *currently deployed* function. It cannot reach an older
version, so it is worth nothing after you deploy over it and everything
before:

```bash
supabase functions download <name>   # writes the LIVE source locally
```

Do this first, every time, and copy it somewhere outside the repo tree. It is
the one escape hatch that does not depend on git having a clean revert target —
which matters most in exactly the case where git doesn't.

So rolling back is rolling **forward to a new version that contains the old
code**:

```bash
cd /Users/velari/Documents/GitHub/vsresearchlabs   # repo root — config.toml must apply
git checkout <last-good-sha> -- supabase/functions/<name>
supabase functions deploy <name>
supabase functions list          # version incremented (e.g. 56 → 57); content is the old code
git checkout HEAD -- supabase/functions/<name>    # don't leave the tree reverted
```

Expect the version number to go **up**, not down. That is success, not a
failed rollback.

⚠ **Deploy from the repo root so `supabase/config.toml` is picked up.**
It sets `verify_jwt = false` for `mark-payment-claimed`. That function is the
"I've sent payment" link in invoice emails; those clicks carry no JWT. Deploy
it without that config applied and the gateway 401s every payment
confirmation — a silent break of the payment path, discovered only by a
customer who can't confirm.

### The precondition: a clean revert target must exist

This only works if the last-good source is something you can actually check
out. Where commits fuse a function change with unrelated work, `<last-good-sha>`
for `place-order` may not be any single commit — which is precisely when you're
authoring a fix under pressure instead of rolling back.

**Tag every edge-function deploy** so the target always exists. There are
currently **zero tags in this repo**:

```bash
git tag -a deploy/edge/2026-07-16 -m "place-order v56"
git push origin deploy/edge/2026-07-16
```

---

## 3. Database — forward-fix only

**56 migrations, zero down-scripts.** There is no rollback and this runbook is
not going to pretend otherwise.

- `supabase db reset` **resets the LOCAL database only**. Never reach for it
  against production.
- Recovery from a bad migration = **author a new, higher-numbered migration
  that corrects it**, following the house rules (additive, idempotent guard,
  `set search_path`, revoked from `public`).
- Before a risky push, take a backup you can actually restore from:
  `supabase db dump -f backup-$(date +%F).sql`, plus point-in-time recovery on
  the Supabase dashboard.

The honest mitigation is upstream, not downstream: keep migrations additive and
idempotent so a bad one is inert rather than destructive.

---

## Operator: confirm this runbook once

Per PAR-F2's acceptance criteria, and while nothing is on fire:

1. `wrangler versions list` — confirm it reaches back past the current deploy.
2. `wrangler rollback --help` — confirm the verb and flags.
3. Roll back to the previous version on a quiet moment, confirm the site still
   serves correctly (**this is the step that settles the asset-manifest caveat
   in §1**), then roll forward again.
4. Re-deploy one low-risk edge function (e.g. `resolve-video`) from an older
   SHA and confirm the version increments and behavior reverts.

---

## Operator: branch protection on `main`

**ACTIVE since 2026-07-18.** Applied with the operator's standing authorization
(the settings below, verbatim) and verified by reading the protection object
back:

```json
{"strict": true, "contexts": ["checks", "e2e", "integration"], "enforce_admins": false,
 "conversation_resolution": true, "force_pushes": false, "deletions": false,
 "approvals": 0}
```

(`integration` — the real-Postgres money-RPC + RLS tier, see
docs/INTEGRATION_TESTS.md — was added to the required contexts on 2026-07-18
after proving green on PR #12.)

`enforce_admins` is deliberately **false** — the solo operator keeps the
direct-push hatch; the gate binds PRs (dependabot included), which now require
all three CI jobs green and up-to-date branches. To inspect or re-apply:
`gh api repos/CasuallyAllure/vsresearchlabs/branches/main/protection`.

⚠ If `ci.yml`'s job ids ever change, update the required contexts in the same
PUT — a renamed job means the old required check never reports and every PR
blocks indefinitely.

The intended configuration of record (what is live today):

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| — Required approvals | `0` (solo operator; the CI gate is the point, not review) |
| Require status checks to pass before merging | ✅ |
| — Required checks | **`checks`**, **`e2e`**, and **`integration`** (the job ids in `ci.yml`; these are the names GitHub reports) |
| — Require branches to be up to date before merging | ✅ |
| Require conversation resolution | ✅ |
| Do not allow bypassing the above settings | ⬜ (leave off — a solo operator needs the hatch) |
| Allow force pushes | ⬜ |
| Allow deletions | ⬜ |

Equivalent via API (how it was applied — a JSON body via `--input`, because
`-f 'restrictions=null'` would send the string `"null"`, not JSON null):

```bash
gh api -X PUT repos/CasuallyAllure/vsresearchlabs/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input protection.json   # required_status_checks {strict, contexts:[checks,e2e,integration]},
                            # enforce_admins false, reviews 0, restrictions null,
                            # required_conversation_resolution true,
                            # allow_force_pushes false, allow_deletions false
```

Context: the repo is ~98% direct-to-main (272 commits / 5 merges). Before
protection, the Workers Builds auto-lane twice deployed before/despite CI;
direct pushes still deploy (the hatch is intentional), but every PR — including
dependabot's — now has a real merge gate.
