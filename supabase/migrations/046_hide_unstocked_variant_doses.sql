-- 046_hide_unstocked_variant_doses.sql
--
-- Hide specific per-dose strengths the owner marked "xx" in the master sheet
-- (= "list the product, but never offer this strength"). The public catalog's
-- visibility rule is price-driven: a variant with price_cents = NULL is not
-- shown as a dose option (see src/lib/productOverrides.ts isVariantPublic),
-- and a product disappears entirely only when none of its doses have a price.
--
-- Each pair below is a single strength of a multi-dose product whose sibling
-- doses stay priced/visible, so clearing the price hides just that strength.
-- One-time data fix; re-pricing any of these later (admin inline edit or a
-- CSV import) re-lists it. on_hand / lead_days are left untouched.

update product_variant_stock v
set price_cents = null,
    updated_at = now()
from (values
    ('VSR-RS-GHK','50mg'),
    ('VSR-RS-SMO','5mg'),
    ('VSR-RS-TSM','5mg'),
    ('VSR-RS-TSM','10mg'),
    ('VSR-RS-TA1','5mg'),
    ('VSR-RS-AOD-005','2mg'),
    ('VSR-RS-AOD-005','5mg'),
    ('VSR-RS-MOTS','20mg'),
    ('VSR-RS-MOTS','40mg'),
    ('VSR-RS-DSIP','5mg'),
    ('VSR-RS-5AMQ','10mg'),
    ('VSR-RS-TB4-005','5mg'),
    ('VSR-RS-KISS','5mg')
) as hide(sku, dose)
where v.sku = hide.sku and v.dose = hide.dose;
