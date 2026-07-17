#!/usr/bin/env bash
# deploy.sh — order-enforced production deploy (pro review 2026-07-17 §5.9).
#
# The three targets MUST land in this order (docs/DEPLOY_PLAN.md,
# docs/ROLLBACK.md): DB migrations first (functions may call new RPCs the
# moment they deploy), then edge functions, then the frontend. Each step is
# gated on the previous one succeeding; gates run before anything ships.
#
# Usage:
#   scripts/deploy.sh            # gates + all three targets, prompting per step
#   scripts/deploy.sh --db       # db push only
#   scripts/deploy.sh --fn NAME  # one edge function only (e.g. --fn place-order)
#   scripts/deploy.sh --frontend # build + wrangler deploy only
#
# HARD RULE (memory: deploy-from-main-repo): the frontend MUST build from the
# repo root — a git worktree has no .env, so VITE_SUPABASE_* would not be
# baked in and prod ships "backend not configured". This script refuses to
# run from anywhere but the repo root checkout.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if git rev-parse --git-common-dir >/dev/null 2>&1; then
  common="$(git rev-parse --git-common-dir)"; gitdir="$(git rev-parse --git-dir)"
  if [ "$common" != "$gitdir" ] && [ "$common" != ".git" ]; then
    echo "REFUSING: this looks like a git worktree. Build/deploy from the main checkout." >&2
    exit 1
  fi
fi

confirm() {
  read -r -p "$1 [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; exit 1; }
}

gates() {
  echo "── Gates: tsc, deno check, vitest+coverage, eslint, build ──"
  npx tsc -b
  DENO_NO_PACKAGE_JSON=1 deno check supabase/functions/
  npx vitest run --coverage
  npx eslint .
  npm run build
  echo "── Gates GREEN ──"
}

deploy_db() {
  echo "── DB: pending migrations ──"
  supabase migration list
  confirm "Push migrations to PROD?"
  supabase db push
  supabase migration list
}

deploy_fn() {
  local fn="$1"
  confirm "Deploy edge function '$fn' to PROD?"
  supabase functions deploy "$fn"
  supabase functions list | grep -i "$fn" || true
}

deploy_frontend() {
  [ -f .env ] || { echo "REFUSING: no .env at repo root — VITE_SUPABASE_* would not be baked in." >&2; exit 1; }
  confirm "Build + deploy frontend Worker to PROD?"
  npm run build
  npx wrangler deploy
  npx wrangler deployments list | head -8
}

case "${1:-all}" in
  --db)        deploy_db ;;
  --fn)        deploy_fn "${2:?usage: deploy.sh --fn NAME}" ;;
  --frontend)  deploy_frontend ;;
  all)
    gates
    deploy_db
    deploy_fn place-order
    deploy_frontend
    echo "── Deploy complete. Tag it: git tag deploy/edge/$(date +%F) ──"
    ;;
  *) echo "usage: deploy.sh [--db | --fn NAME | --frontend]" >&2; exit 1 ;;
esac
