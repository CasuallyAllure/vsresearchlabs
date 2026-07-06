-- 030_revoke_public_execute_mark_paid.sql
--
-- Follow-up to 029. Postgres grants EXECUTE on functions to the PUBLIC
-- pseudo-role by default, and `anon`/`authenticated` inherit it — so 029's
-- `revoke ... from anon, authenticated` left the function still callable by
-- anon (verified live: an anon RPC call reached the function body). Revoke
-- from PUBLIC as well to actually close the direct-call path. The
-- mark-payment-claimed Edge Function uses the service role, which bypasses
-- grants, so the buyer "I've sent payment" flow is unaffected.

revoke execute on function mark_payment_claimed(uuid) from public;
revoke execute on function mark_payment_claimed(uuid) from anon, authenticated;
