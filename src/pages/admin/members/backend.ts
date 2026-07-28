/**
 * Shared backend-error classification for the Members sub-view hooks — the
 * same "migrations not applied yet → calm note, not a crash" posture the whole
 * membership surface uses (mirrors CustomerAccountPanels / useMembersData).
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/** True when a failure looks like a Phase 2 object (073) not being applied:
 *  undefined table/column (42P01/42703) or PostgREST's missing-function code. */
export function isMissingBackend(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42P01' || code === '42703' || code === 'PGRST202') return true;
  return /does not exist|could not find the function|schema cache/i.test(getErrorMessage(error));
}
