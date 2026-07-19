# Research Content Separation & Compliance Blueprint

**Status: AUDIT COMPLETE — awaiting approval. No implementation has begun.**
Date: 2026-07-19 · Audited against `main` = live = `34c74cb`

---

## 0. Executive summary — the one thing to read

The restructuring you asked for is **architecturally cheap and editorially expensive.**

The code is ready. `CompoundIntelligenceOverlay` is already a declarative,
data-driven module system where adding a new dossier section is a *one-line*
change that needs zero per-compound edits. The overlay is genuinely unified
(store and `/research` render the same component — verified). Cart, checkout,
and email carry **no** scientific content at all. There is **no schema.org
`Product`/`Offer` markup anywhere**, so nothing declares retail commerce to
search engines. The attestation gate is rigorous and well-built. These are real
assets.

What the audit found is that **the separation you want mostly already exists as
a seam — but three things sit on the wrong side of it, and the dossier's
scientific substance is much thinner than its presentation implies.**

Three findings outrank everything else in this document:

1. **`/documentation` publishes 10 fabricated quality documents as if they were
   genuine controlled records** — asserting an in-house "QC Division," a named
   "D. Kaplan, QC Director," ICH Q2(R1) / USP <62> method compliance, and
   `documentControlStatus: "CONTROLLED"`. The route is live, linked, and listed
   in `sitemap.xml`. Landing correctly seals its own preview behind "Archive in
   preparation" — three other surfaces do not. **Given that you are pursuing GLP
   credentials, this is the single highest-risk item on the site and it should be
   fixed before anything else in this blueprint.**

2. **The dossier has no citations.** 27 study records exist across 19 of 50
   generated compounds — **zero have a DOI, a PMID, or a URL**. The link
   affordance in `StudyCard` never renders for any of them. The only 9 links on
   the site are PubMed *search queries*, not permalinks, on 5 hand-authored
   products. Meanwhile `/research` promises every visitor "published studies."
   You cannot make the Research Dossier the educational backbone of a scientific
   institution while it cites nothing verifiable. **7 of your 12 target dossier
   sections — including References, FDA Resources, PubMed, and DOI — currently
   exist at zero.**

3. **The `laymanSummary` layer is the compliance exposure, not the product
   pages.** 63 records render human clinical outcomes into the public dossier:
   brand-name drugs ("*Ozempic*", "*Wegovy*", "*Mounjaro*"), human weight-loss
   percentages ("~24%~ over 48 weeks"), a route of administration ("taken
   intranasally so it reaches the brain quickly"), and outcome claims ("~speeds
   healing of tendon, muscle, and gut tissue~"). The category taxonomy itself
   reads consumer-health — including a class literally labeled
   **"Antioxidant / Beauty"** and a "hormones & libido group."

**Net:** roughly 30% of this project is moving code, and 70% is sourcing,
authoring, and removing content. The blueprint below is sequenced accordingly —
compliance removals first (they reduce risk immediately and need no new data),
then the structural split, then the long content build.

---

## 1. Audit — current state

### 1.1 The data topology (this changes every count)

The site is fed by **two disjoint datasets merged at
`src/stores/productStore.ts:29-32`**:

| Source | Records | Nature |
|---|---|---|
| `src/data/products.json` | 21 (13 peptides + 8 equipment) | Hand-authored, **rich** — has study URLs and `notes` bullets |
| `src/data/biopeptideCompounds.generated.json` | 50 | Machine-generated — **no URLs, no notes** |

Zero slug overlap; 71 products total; `/research` shows 48 peptides. **The
flagship, Retatrutide, lives in the hand-authored file** — so the best dossier
on the site is not representative of the other 50.

### 1.2 What each surface renders today

**`ProductPage.tsx` is a second, hand-forked copy of the dossier.** It reads the
same `getCompoundIntelligence()` output and renders near-identical modules:

| Module | ProductPage | Overlay |
|---|---|---|
| Summary | `:212` | `:444` |
| Mechanism of Action | `:240` | `:284` |
| Receptor / Target Activity | `:247` | `:285` |
| Signaling Pathway | `:254` | `:286` |
| Known Studies | `:261` | `:290` |
| Procurement | `:273` | `:289` |
| Analytical Parameters | *absent* | `:287` |
| Documentation | `:287` | *absent* |

**This fork is the natural seam for the whole project** — ProductPage becomes
spec-sheet-only, the Overlay becomes dossier-only. There are in fact **four**
renderers of the scientific triad (add `CompoundIntelligenceHero` and
`HeroHoloCarousel`, which reimplement the shared primitives locally).

### 1.3 Content depth (measured, not estimated)

| Field | Coverage | Median length |
|---|---|---|
| `mechanismSummary` / `receptorActivity` / `pathwaySummary` / `laymanSummary` | **50/50** | 268 / 133 / 129 / 194 chars |
| `longDescription` | 50/50 | 306 chars — **but ¶2–3 are identical boilerplate on all 50** |
| `casNumber`, `molecularWeight` | **36/50** | — |
| `knownStudies` | **19/50** (27 records) | — |
| Structures (3D) | **1/48** | — |
| Video | **1/48** | — |

**The entire scientific payload is ~1,000 characters per compound**, of which the
long description is two-thirds boilerplate. Every compound renders exactly 6
modules; 28 of 48 show a "Planned" placeholder where studies would go.

### 1.4 What is genuinely strong (do not regress)

- `getCompoundIntelligence()` as the single selector — every surface routes
  through it; the overlay touches zero raw fields.
- The `ModuleDef` discriminated union + single render loop — the growth mechanism.
- **The anti-fabrication discipline in code**: `parseReceptorTargets` returns
  `[]` rather than inventing EC50s; the module contract states "Nothing here is
  invented." The architecture is honest — the data is empty.
- The dual register (layman + technical) and its disciplined hedging voice
  ("studied as", "investigated in") — this is the style guide for new sections.
- `LegalDisclaimer.tsx:50-88` — **the best copy on the site**; the voice
  everything else should be rewritten toward.
- The attestation gate: 21+, research-use, and a required industry selection,
  stored structurally and attached to every order.
- No schema.org `Product`/`Offer` anywhere. **Do not add it during this work.**

---

## 2. Duplication list

### 2.1 Same content, two homes → **relocate**

| Content | Current homes | Target |
|---|---|---|
| mechanism / receptor / pathway / studies / physiological outcome | ProductPage + Overlay + Hero + HeroCarousel | **DOSSIER-ONLY** — ProductPage gets a link |
| `laymanSummary` | ProductPage + Overlay + Hero | **DOSSIER-ONLY** |
| `fdaStatus` / `humanTrialsConfirmed` | 4 sites | **DOSSIER-ONLY** + a plain RUO chip on the spec sheet |
| `ProcurementSheet` (9 fields) | ProductPage ×2 + Overlay | **PRODUCT-PAGE-ONLY** — drop the Overlay's Procurement module |
| `testingStandard` | ProcurementSheet **and** Analytical Parameters | **PRODUCT-PAGE-ONLY** — remove from `buildAnalytical` (`compoundIntelligence.ts:244`) |
| `longDescription` | ProductPage `:228` **and** silently again as the `ci.summary` fallback | **PRODUCT-PAGE-ONLY** — fixes a real double-render bug |

### 2.2 Legitimately dual → **leave alone**

`name`, `sku`, `abbreviation`, `family`, `casNumber`, `molecularWeight`,
`researchClassification` (taxonomy/filtering only), `shortDescription` (tile blurb).

### 2.3 Duplicated prose → **single-source**

- **RUO disclaimers: 20+ hardcoded sites in 7 different wordings.**
  `src/config/clients/vsresearchlabs.ts:33-41` defines a canonical block that
  **essentially nothing reads from**. Plus all 50 compounds end
  `longDescription` with the disclaimer at the data level.
- Legal clauses duplicated verbatim between `LegalDisclaimer.tsx` and `Terms.tsx`.
- Category blurbs duplicated across page + modal (3 pairs).
- Shipping copy copy-pasted 3–4×; the Bay Area delivery claim in 3 places.

### 2.4 Already clean → **do not touch**

**Cart, checkout, and transactional email carry name + SKU + price only.** No
scientific content leaks into the money path. Verified across `cartActions.ts`,
`place-order/handler.ts`, and `invoiceEmail.ts`.

---

## 3. Compliance findings

### 3.1 CRITICAL — fabricated quality documents published as authentic

`src/data/documents.json` holds 10 records with **no placeholder marker**,
asserting `"issuer": "VS Research Labs QC Division"`, `"issuedBy": "D. Kaplan,
QC Director"`, `"standardReference": "ICH Q2(R1) · USP <62>"`, `"instrumentId":
"ESI-QTOF-VSR-001"`, and `"documentControlStatus": "CONTROLLED"`. Every
`thumbnailUrl` points at one of 6 generic SVGs — there are no real PDFs.
`pageCount` and `fileSizeKb` are invented.

Landing seals its preview ("Archive in preparation — live certificates & batch
records to be updated"). **`/documentation`, `/documentation/:id`, and every
product's `DocumentSlot` render the same data unsealed**, and the route is in
`sitemap.xml`. Related: the catalog tile badge reads **"Certified · ≥98%"**
with no COA behind it, and **every invoice carries a numeric purity guarantee**
("if independent third-party testing comes back below 98–99% purity… full
refund") naming no lab and no method.

### 3.2 HIGH — human-use read in the educational layer

63 `laymanSummary` records render into the public dossier. Representative:

- "…brand names *Ozempic* and *Wegovy*… mean body-weight reduction of
  approximately ~15%~… supporting *once-weekly* research dosing"
- "…mean body-weight reduction of approximately ~24%~ over 48 weeks — among the
  largest reported for this class"
- "~speeds healing of tendon, muscle, and gut tissue~"
- "…taken intranasally so it reaches the brain quickly"
- "the famous **copper peptide** of skin science… ~signals collagen and elastin repair~"

The taxonomy compounds it (`compoundIntelligence.ts:71-93`): "The appetite &
metabolism family — the GLP-1 group (the same class as Ozempic and Mounjaro)",
"The hormones & libido group", "The brain group — researched for focus, mood,
and memory", and a displayed class label **"Antioxidant / Beauty"**.

`VideoIntroModule` greets first-time visitors with "the same signaling molecules
**your body** already produces… Production naturally decreases with age."

Five pages actively prompt users into this register: *"read what it does in
plain terms."*

### 3.3 HIGH — e-commerce framing

A full consumer loyalty program (points, "Earn 1 point per $1", "redeem 40% off
ANY compound"), limited-time offers ("15% off the entire order — limited time",
`LTO` badges), a buy-2-get-1-free mechanic, price anchoring ("A $60 vial comes
to $36… 40% off"), and a `Checkout` / "Your order." register. `MemberAccessGate`
— a full promotional offer stack — is the **first thing every guest sees**.

Note the contradiction: `About.tsx` claims the catalog is "not sold off an open
storefront checkout," which the current site does not honor.

### 3.4 HIGH — one phrasing to remove outright

`legal/Shipping.tsx:62-65`: *"Shipments are packed **discreetly**… Outer
packaging **does not disclose contents**."* For a laboratory supplier this reads
as concealment rather than professional handling. Recommend: *"Shipments are
packed in research-appropriate protective packaging with contents identified on
the enclosed documentation."*

### 3.5 MEDIUM — unsupported superlatives

"Highest purity, on demand." (H1), "all supplied at research-grade purity",
"research-grade consistency" ("research-grade" is undefined and unregulated),
"Compound of the Month" (promotional framing), plus comparative claims like
"more potent and less selective than Melanotan I."

Entity-name inconsistency: `Velari Systems LLC` vs `Velari Systems Research Labs`.

### 3.6 Disclaimer coverage gaps

| Surface | RUO present? |
|---|---|
| Global footer, nav, Landing, gate, Terms, invoices, most emails | ✅ |
| **`/cart`** | ❌ **missing entirely** — yet it silently submits an attestation |
| CartDrawer | ⚠️ weak — "acquiring these materials for legitimate research use"; no "not for human use", no 21+ |
| **`/track`** | ❌ missing |
| **`/documentation`** | ❌ missing (and serves §3.1) |
| send-inquiry buyer copy | ⚠️ drops "Not for Human Use" |
| shipment/processing/delivered emails | ⚠️ short form, omits "veterinary" |

Also note: the footer RUO line renders at **30% opacity**.

### 3.7 Dead code containing liabilities (flagged, not deleted)

`src/components/landing/TestimonialBlock.tsx` contains three invented named
testimonials ("M. Chen, Research Procurement Lead"). It is imported nowhere.
Per your standing rule I have not removed pre-existing dead code — but this file
should be deleted rather than left to be re-imported by someone later.

---

## 4. Target architecture

### 4.1 Product page → Laboratory Specification Sheet

Reorganized into four blocks, all objective:

1. **Identification** — Product Name · Catalog Number (SKU) · CAS · Synonyms/abbreviation
2. **Physical & Chemical Data** — Molecular Formula* · Molecular Weight · Appearance* · Form · Purity + method · Solubility* · Sequence (peptides)*
3. **Handling & Storage** — Storage Condition · Shelf Life · Shipping Condition · Laboratory Handling*
4. **Supply & Documentation** — Lot / Batch · Certificate of Analysis · Lead Time · Testing Standard · Unit of Measure · Country of Origin · Manufacturer
5. **Designation** — a single plain Research Use Only statement
6. **→ Research Dossier** — one prominent link. No scientific prose on this page.

`*` = does not exist in the data model today (see §5).

**Two existing bugs this fixes:** purity/form/mass are currently **not rendered
on the product page at all** (they live only in the overlay), and lot/batch
silently omit for all 50 generated compounds.

### 4.2 Research Dossier → the scientific reference

Keep the existing overlay and its module system. Target sections, mapped to
reality:

| Target section | Today | Action |
|---|---|---|
| Compound Overview | PARTIAL (50/50) | Restructure only |
| Molecular Characteristics | PARTIAL (36/50 CAS+MW) | Source the missing 14; add formula/sequence |
| Chemical Properties | **NONE** | Author |
| Research History | **NONE** | Author |
| Summary of Published Literature | WEAK (20/48, no links) | Author + source |
| Current Areas of Investigation | **NONE** | Author |
| Regulatory Status | ✅ **COMPLETE (50/50)** | Keep; structure it |
| **References** | **NONE** | **Source — the largest gap** |
| **FDA Resources** | **NONE** | Source |
| **PubMed References** | **NONE** | Source |
| **DOI References** | **NONE** | Source |
| Additional Sources | 1/48 | Grow |

**Scorecard: 1 of 12 sections complete, 4 partial, 7 at zero.**

### 4.3 The growth property to protect

Because every module is conditional (`if (field)`), a section with no data simply
doesn't render — so content can be authored **compound by compound over months**
without shipping empty sections. Combined with the existing "Planned" placeholder
pattern, the architecture already supports honest incremental growth. **This is
what makes the long-term vision work without another restructuring.**

---

## 5. Data-model changes required

**Product / spec sheet — absent entirely:** molecular formula, appearance,
solubility/reconstitution, peptide sequence, laboratory handling, technical
references, per-variant specs (`ProductVariant` is `{dose}` only).

**Dossier — absent entirely:** `references[]` (with `doi`, `pmid`, `url`,
`authors`, `journal`), research history, literature synthesis, current
investigation, structured regulatory status.

**Two data-honesty problems to resolve before a spec sheet is credible:**
`manufacturer` is the literal string "Vetted global production partners" and
`countryOfOrigin` is "Global partner network" on **all 50** compounds. Neither is
a manufacturer or a country. Either source the real values or remove the rows —
a procurement-grade spec sheet cannot carry them as-is.

**COA infrastructure does not exist.** No documents table, no storage bucket, no
admin upload path, no batch join key. Batch/lot/COA data is inherently
per-shipment and **cannot** live in JSON. This is a backend project (migration
068+, storage bucket, RLS, admin upload UI), not a content edit.

**Authoring path (verified):** author in `scripts/lib/compoundIntelligence.mjs`
(the generator's source of truth), run `npm run gen:inventory:check` to preview
the diff. The drop-guard and TOMBSTONED set **did land** — the old "never run
gen:inventory" warning in `docs/REMEDIATION_BLUEPRINT.md` is now stale, though
two hand-diverged records (`korean-glutathione`, `10-amino-1mq`) must be
reconciled before the file round-trips. `products.json` is hand-maintained and
safe to edit directly.

---

## 6. Implementation plan

Sequenced so risk drops immediately and no wave depends on content that doesn't
exist yet.

### Wave 0 — Compliance triage *(no new data required; ship first)*
1. Seal or remove the fabricated QC documents; gate `/documentation` behind the
   same "Archive in preparation" seal Landing already uses; drop it from
   `sitemap.xml`.
2. "Certified · ≥98%" → "Purity (HPLC): ≥98% (stated specification)".
3. Remove the numeric purity refund guarantee from invoices, or name the
   standard and method behind it.
4. Rewrite "packed discreetly / does not disclose contents."
5. "Highest purity, on demand." → a documentable claim.
6. Add RUO to `/cart`, `/track`, `/documentation`; strengthen the CartDrawer
   line; normalize the 7 email wordings to one constant; raise footer opacity.
7. Delete `TestimonialBlock.tsx` (fabricated testimonials, dead code).
8. Single-source every disclaimer from `siteConfig.compliance`.

### Wave 1 — Language & taxonomy
9. Rewrite the 63 `laymanSummary` records into a research register: remove brand
   names, human outcome percentages, routes of administration, and second-person
   physiology. Keep them readable — the dual register is an asset; it is the
   *framing* that must change, not the accessibility.
10. Rewrite the classification taxonomy ("Antioxidant / Beauty" → "Antioxidant /
    Dermatological Research"; "hormones & libido group" → "endocrine signaling");
    add the "research models" qualifier that `ResearchSuppliesHub` already uses
    correctly to `BottomNav` captions.
11. Rewrite `VideoIntroModule` slide 1 out of the "your body" frame.
12. Propagate "Add to Inquiry" over "+ Add"; "Checkout" → "Submit Requisition";
    "Terms of Sale" → "Terms of Supply".

### Wave 2 — The structural split *(the actual restructuring)*
13. Convert `ProductPage` to the spec sheet in §4.1; remove the five scientific
    modules; add the dossier link.
14. Surface purity/form/mass on the product page (fixes the current omission).
15. Remove `Procurement Data` from the overlay; remove `testingStandard` from
    `buildAnalytical`; fix the `longDescription` double-render.
16. Strip the trailing disclaimer paragraph from all 50 `longDescription` values
    and render it as chrome instead.
17. Extract the duplicated category/shipping copy to shared constants.
18. Migrate `CompoundIntelligenceHero` onto the shared `IntelModule` primitives
    so new dossier sections need adding in one place, not three.

### Wave 3 — Dossier expansion *(the long content build)*
19. Add a structured `references[]` type with `doi` / `pmid` / `url`, plus a
    `ReferenceList` module and an `FDA Resources` module.
20. Replace the 9 PubMed *search* URLs with resolved PMIDs; add real citations
    compound by compound, newest-evidence-first.
21. Add the four missing narrative sections as data arrives, using the "Planned"
    placeholder honestly until then.
22. Fix the `buildStructure.mjs` attribution mismatch (Sun vs Zhao, same PDB) and
    surface the structure provenance that is already computed but never rendered.

### Wave 4 — Real documentation infrastructure *(backend)*
23. Migration 068+: documents table, storage bucket, RLS, batch/lot join key,
    admin upload UI, per-variant COA linkage. Only after this can §3.1's
    placeholders be replaced with genuine records.

**Waves 0–2 are code and copy — I can execute them.** Wave 3 is primarily
sourcing, where I can build the structures and scaffold citations but you (or a
scientific reviewer) should verify every reference before it publishes. Wave 4 is
a backend project sized like the checkout work.

---

## 7. Open questions for you

1. **The promotional layer** (points, LTO, BOGO, wholesale % off) — retire
   entirely, or convert to contract/volume pricing tiers? It's revenue-relevant,
   so it's your call, not mine. Volume pricing is entirely legitimate for a
   research supplier; *"40% off ANY compound"* framing is not.
2. **The layman register** — soften the framing but keep accessibility (my
   recommendation), or drop to a single technical register?
3. **Manufacturer / country of origin** — can real values be sourced, or should
   those rows be removed?
4. **`/documentation`** — seal it until real COAs exist, or remove the route for now?
5. **Skincare category** — the "Beauty" framing is the hardest to reconcile with a
   laboratory positioning. Reframe as dermatological research, or reconsider the
   category's place in the catalog?

---

*Audit performed across four independent read-only passes (product/catalog
surfaces, dossier system, duplication/data-model, compliance/positioning), each
verified against source with file:line citations and counted against the actual
data files. No code was changed.*
