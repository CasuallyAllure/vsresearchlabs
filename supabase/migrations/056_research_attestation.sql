-- 056_research_attestation
--
-- Compliance audit trail: every order records the buyer's research-use
-- disclaimer acceptance (21+, research-only terms, declared industry) as
-- captured by the DisclaimerGate at site entry and forwarded by the
-- place-order edge function at checkout.
--
-- Shape (written exclusively by place-order with the service role):
--   {
--     "accepted_at": "2026-07-13T18:22:04.511Z",  -- when the gate was accepted (client clock)
--     "recorded_at": "2026-07-13T19:01:33.020Z",  -- when the order stamped it (server clock)
--     "disclaimer_version": 2,                    -- gate copy/terms revision
--     "age_21_confirmed": true,
--     "research_use_confirmed": true,
--     "industry": "research_lab"                  -- declared purchaser industry (whitelisted)
--   }
-- NULL means the order predates this column or arrived from a client that
-- never sent an attestation (older cached bundle).

alter table public.orders
  add column if not exists research_attestation jsonb;

comment on column public.orders.research_attestation is
  'Research-use disclaimer acceptance snapshot (21+, research-only terms, declared industry) recorded at checkout by place-order. NULL = pre-feature order.';
