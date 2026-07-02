-- 029_harden_public_surface.sql
--
-- Pre-launch security hardening.
--
-- 1. mark_payment_claimed() was granted to anon + authenticated in 020 so the
--    buyer's "I've sent payment" flow could advance an order. In practice the
--    flow runs exclusively through the mark-payment-claimed Edge Function,
--    which uses the service role and resolves the buyer's lookup_token to an
--    order before calling this RPC. The direct grant meant anyone holding an
--    order UUID could flip any order to payment_claimed without presenting a
--    token. Revoke it: the service role is unaffected by grants, so the Edge
--    Function (and therefore the /track payment flow) keeps working.
--
-- 2. inquiries / inquiry_items / contact_messages rely on RLS default-deny
--    for writes (no write policies exist; inserts happen only via Edge
--    Functions using the service role). Supabase's default role grants still
--    leave table-level INSERT/UPDATE/DELETE privileges in place, so a future
--    policy mistake would silently open public writes. Make the deny explicit
--    at the privilege level as well — the service role bypasses both layers,
--    so nothing about the existing intake flows changes.

revoke execute on function mark_payment_claimed(uuid) from anon, authenticated;

revoke insert, update, delete on table inquiries        from anon, authenticated;
revoke insert, update, delete on table inquiry_items    from anon, authenticated;
revoke insert, update, delete on table contact_messages from anon, authenticated;
