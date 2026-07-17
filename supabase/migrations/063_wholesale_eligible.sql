-- =============================================================================
-- VS Research Labs — Server-authoritative wholesale eligibility (P0-3)
-- =============================================================================
-- place-order granted 27–40% wholesale pack pricing to ANY sku, priced off the
-- client's own number. Server eligibility reduced to: non-empty sku + client-sent
-- unit > 0 + qty >= 3. A signed-in buyer ordering 10 × a $200 microcentrifuge was
-- billed $800 under the quoted retail price — on a product no tile ever offered
-- wholesale on. The catalog gate existed only on the client.
--
-- The client's rule is category-based: wholesale is offered on the biopeptide
-- catalog only (BiopeptideResearchSupplies.tsx), never on supplies/equipment.
-- `category` travels in the order payload, but it is attacker-controlled — a
-- forged "biopeptide-research-supplies" would restore the exploit verbatim. So
-- eligibility becomes a server-side fact, on the same table the checkout already
-- reads to price and ship the line.
--
-- Default FALSE — fail closed. A dose only sells by the case when an operator has
-- said so. Consequence to know about: a NEW sku imported after this migration
-- gets wholesale_eligible = false and will not sell at pack pricing until it is
-- flipped (see §3). That is the safe direction: the failure mode is "customer
-- pays retail", not "we ship a case at 40% off by accident".
--
-- Additive. Re-runnable.
-- =============================================================================

-- ── 1. Schema: the flag ──────────────────────────────────────────────────────

alter table product_variant_stock
  add column if not exists wholesale_eligible boolean not null default false;

comment on column product_variant_stock.wholesale_eligible is
  'Server authority for pack (wholesale) pricing on this (sku, dose). place-order '
  'requires it — a line whose resolved variant row is not eligible NEVER enters '
  'the wholesale plan, regardless of the category the client claims. Defaults '
  'false: new doses do not sell by the case until an operator enables them.';

-- ── 2. Seed: compounds yes, supplies/equipment no ────────────────────────────
-- Derived from the catalog category the client already gates on, so client
-- display and server billing agree by construction on the data as it stands
-- today:
--   • eligible  = every sku in `biopeptide-research-supplies`
--                 (src/data/products.json + biopeptideCompounds.generated.json)
--   • NOT eligible = `laboratory-equipment` — the 5 VSR-LE-* instruments plus
--                 the three consumables that carry an RS-style sku and would
--                 slip through any prefix rule:
--                   VSR-RS-BAC-030  Bacteriostatic Water
--                   VSR-RS-SYR-100  Research Syringes
--                   VSR-RS-ACE-003  Acetic Acid
--                 (VSR-LE-PIP-SET, the micropipette set, is in the same group.)
-- Enumerated rather than pattern-matched precisely because the sku prefix lies:
-- "VSR-RS-" means research supply, not compound.
--
-- Rows for skus not listed here keep the false default — including DB-only
-- legacy skus with no catalog entry (e.g. VSR-RS-CU100, VSR-RS-WA10), which are
-- not orderable from the storefront and must not be pack-priced.

update product_variant_stock
   set wholesale_eligible = true,
       updated_at         = now()
 where sku in (
    'VSR-RS-5AMQ', 'VSR-RS-A290', 'VSR-RS-ADMX', 'VSR-RS-ADP',
    'VSR-RS-AICR', 'VSR-RS-AOD-005', 'VSR-RS-BPC-005', 'VSR-RS-BPTB',
    'VSR-RS-CGL', 'VSR-RS-CGS', 'VSR-RS-CJC-002', 'VSR-RS-CJCN',
    'VSR-RS-CJIP', 'VSR-RS-DRM', 'VSR-RS-DSIP', 'VSR-RS-EPT-010',
    'VSR-RS-FOXO', 'VSR-RS-GHK', 'VSR-RS-GLOW', 'VSR-RS-GLWC',
    'VSR-RS-GNRH', 'VSR-RS-GRP2', 'VSR-RS-GRP6', 'VSR-RS-GSH',
    'VSR-RS-GSK', 'VSR-RS-HCG', 'VSR-RS-HEX', 'VSR-RS-HGH',
    'VSR-RS-HMG', 'VSR-RS-IGF', 'VSR-RS-IPA-005', 'VSR-RS-KISS',
    'VSR-RS-KLOW', 'VSR-RS-KPV-010', 'VSR-RS-LCAR', 'VSR-RS-LIPC',
    'VSR-RS-LL37', 'VSR-RS-LMB', 'VSR-RS-MGF', 'VSR-RS-MK',
    'VSR-RS-MOTS', 'VSR-RS-MT1', 'VSR-RS-MT2', 'VSR-RS-MZD',
    'VSR-RS-NAD', 'VSR-RS-OXT', 'VSR-RS-PIN-005', 'VSR-RS-PMGF',
    'VSR-RS-PT41', 'VSR-RS-RTT-005', 'VSR-RS-SEM-005', 'VSR-RS-SLK',
    'VSR-RS-SMO', 'VSR-RS-SMX-030', 'VSR-RS-SNP8', 'VSR-RS-SS31',
    'VSR-RS-SVD', 'VSR-RS-TA1', 'VSR-RS-TB4-005', 'VSR-RS-TSM',
    'VSR-RS-TYM', 'VSR-RS-TZP-010', 'VSR-RS-VIP'
   )
   and wholesale_eligible is distinct from true;

-- ── 3. Operator note — enabling a new compound ───────────────────────────────
-- There is deliberately no new admin RPC here: import_inventory is the single
-- write path for stock/pricing (admin UI, CSV importer and scripts/inventory.mjs
-- all route through it) and re-declaring that large function to carry one boolean
-- is a bigger blast radius than this packet earns. Until it grows a
-- `wholesale_eligible` column, enable a new compound with:
--
--   update product_variant_stock set wholesale_eligible = true
--    where sku = 'VSR-RS-NEW';
--
-- Follow-on (not this packet): add `wholesale_eligible` to import_inventory's
-- per-row fields and to public_variant_overrides, then gate the client's
-- wholesaleDoses() on it so a flag flipped false also stops the tile advertising
-- a case. Today the seed matches the client's category gate exactly, so the two
-- agree; they can only drift if someone flips a flag by hand.
