/**
 * compoundData — curated canonical metadata for the biopeptide inventory.
 *
 * Source of truth for promoting the `biopeptideManifest.json` master list
 * into full product records and for generating uniform specimen-plate SVGs.
 *
 * INTEGRITY POLICY (mirrors src/lib/compoundIntelligence.ts — "nothing
 * invented"): `cas` and `mw` are populated ONLY where the value is a
 * well-established, verifiable fact. Where a value is uncertain, obscure,
 * or undefined (proprietary blends, extracts, mixtures), it is left out —
 * the specimen plate and the product identifier band both drop missing
 * fields gracefully rather than printing a guess. Mechanism / receptor /
 * study prose is NOT authored here; those modules stay closed for promoted
 * compounds until a real source is wired in.
 *
 * Compounds already shipped as rich products in products.json
 * (Semaglutide, Tirzepatide, Retatrutide, Ipamorelin, CJC-1295 DAC,
 * BPC-157, TB-500, Semax, Epitalon, AOD-9604, KPV) are NOT redefined here;
 * `modelToKey` routes their manifest rows to the EXISTING_* keys so the
 * build skips them (their variant ranges are widened separately).
 */

// Canonical keys for manifest models that already exist as rich products.
// The build uses these to (a) skip creating a duplicate and (b) widen the
// existing product's variant range to the manifest's full dose list.
export const EXISTING = {
  TIRZEPATIDE: { id: 'rs-tirzepatide-10mg' },
  RETATRUTIDE: { id: 'rs-retatrutide-5mg' },
  IPAMORELIN: { id: 'rs-ipamorelin-5mg' },
  SEMAX: { id: 'rs-semax-30mg' },
  EPITALON: { id: 'rs-epitalon-10mg' },
  KPV: { id: 'rs-kpv-10mg' },
  BPC157: { id: 'rs-bpc157-5mg' },
  TB500: { id: 'rs-tb500-5mg' },
  CJC_DAC: { id: 'rs-cjc1295-dac-2mg' },
  AOD9604: { id: 'rs-aod9604-5mg' },
  BAC_WATER: { id: 'rs-bacteriostatic-water-30ml' },
};

/**
 * META — curated metadata for every NEW canonical compound (manifest
 * models with no existing rich product). Keyed by canonical slug.
 *
 * Fields:
 *   name    display name (no dose suffix)
 *   abbr    short procurement chip (<= 5 chars)
 *   family  short pharmacological/class label (card eyebrow)
 *   eyebrow specimen-plate classification eyebrow (UPPERCASE)
 *   lead    one factual sentence → shortDescription / longDescription lead
 *   cas     CAS registry number — ONLY if confidently known, else omitted
 *   mw      molecular weight WITH unit — ONLY if confidently known
 *   type    ProductType ('peptide' | 'solvent'); omit for small molecules
 *   blend   true for multi-component blends (no single CAS/MW)
 *   liquid  true for solution products (mL specs) → liquid-fill plate
 *   purity  HPLC purity string (default "≥ 98%")
 */
export const META = {
  // ── incretin-metabolic-agonists ────────────────────────────────────────────────────
  cagrilintide: {
    name: 'Cagrilintide', abbr: 'CGL', family: 'Amylin Analogue',
    eyebrow: 'LONG-ACTING AMYLIN ANALOGUE',
    lead: 'Long-acting amylin receptor agonist investigated in appetite-regulation research models.',
    cas: '1415456-99-3', mw: '4409.01 g/mol',
    formula: 'C194H312N54O59S2',
  },
  'cagrisema': {
    name: 'Cagrilintide + Semaglutide', abbr: 'CGS', family: 'Amylin / GLP-1 Blend',
    eyebrow: 'AMYLIN + GLP-1 CO-FORMULATION', blend: true,
    lead: 'Co-formulation of the amylin analogue cagrilintide with the GLP-1 agonist semaglutide.',
  },
  mazdutide: {
    name: 'Mazdutide', abbr: 'MZD', family: 'GLP-1 / Glucagon Agonist',
    eyebrow: 'GLP-1 / GLUCAGON DUAL AGONIST',
    lead: 'Dual GLP-1 and glucagon receptor agonist studied in metabolic research models.',
    cas: '2259884-03-0',
  },
  survodutide: {
    name: 'Survodutide', abbr: 'SVD', family: 'GLP-1 / Glucagon Agonist',
    eyebrow: 'GLP-1 / GLUCAGON DUAL AGONIST',
    lead: 'Glucagon/GLP-1 receptor dual agonist investigated in metabolic and hepatic research.',
    cas: '2805997-46-8', mw: '4231.69 g/mol',
  },

  // ── metabolic-cofactor ───────────────────────────────────────────────
  'nad-plus': {
    name: 'NAD+', abbr: 'NAD', family: 'Metabolic Cofactor',
    eyebrow: 'NICOTINAMIDE ADENINE DINUCLEOTIDE',
    lead: 'Nicotinamide adenine dinucleotide — a central redox cofactor in cellular energy metabolism.',
    cas: '53-84-9', mw: '663.43 g/mol',
    formula: 'C21H27N7O14P2',
  },
  'ss-31': {
    name: 'SS-31', abbr: 'SS31', family: 'Mitochondrial Peptide',
    eyebrow: 'CARDIOLIPIN-TARGETING PEPTIDE',
    lead: 'Mitochondria-targeting tetrapeptide (elamipretide) that associates with cardiolipin on the inner mitochondrial membrane.',
    cas: '736992-21-5', mw: '639.79 g/mol',
    formula: 'C32H49N9O5',
  },
  'mots-c': {
    name: 'MOTS-c', abbr: 'MOTS', family: 'Mitochondrial Peptide',
    eyebrow: 'MITOCHONDRIAL-DERIVED PEPTIDE',
    lead: 'Mitochondrial-derived peptide investigated in metabolic homeostasis and AMPK-pathway research.',
    cas: '1627580-64-7', mw: '2174.62 g/mol',
    formula: 'C101H152N28O22S2',
  },
  'lipo-c': {
    name: 'Lipo-C', abbr: 'LIPC', family: 'Lipotropic Blend',
    eyebrow: 'LIPOTROPIC INJECTION BLEND', blend: true, liquid: true,
    lead: 'Lipotropic solution combining methionine, inositol, choline and related cofactors.',
  },
  'l-carnitine': {
    name: 'L-Carnitine', abbr: 'LCAR', family: 'Metabolic Cofactor', liquid: true,
    eyebrow: 'FATTY-ACID TRANSPORT COFACTOR',
    lead: 'Quaternary ammonium compound that shuttles long-chain fatty acids into mitochondria for β-oxidation.',
    cas: '541-15-1', mw: '161.20 g/mol',
    formula: 'C7H15NO3',
  },
  adipotide: {
    name: 'Adipotide', abbr: 'ADP', family: 'Pro-Apoptotic Peptide',
    eyebrow: 'ADIPOSE-TARGETING PEPTIDE',
    lead: 'Pro-apoptotic peptidomimetic (FTPP) targeting the adipose vasculature in research models.',
    formula: 'C111H206N36O28S2',
    mw: '2557.20 g/mol',
  },
  aicar: {
    name: 'AICAR', abbr: 'AICR', family: 'AMPK Activator',
    eyebrow: 'AMPK ACTIVATOR · ACADESINE',
    lead: 'AMP-activated protein kinase activator (acadesine) used in cellular energy-sensing research.',
    cas: '2627-69-2', mw: '258.23 g/mol',
    formula: 'C9H14N4O5',
  },
  '5-amino-1mq': {
    name: '5-Amino-1MQ', abbr: '5AMQ', family: 'NNMT Inhibitor',
    eyebrow: 'NNMT ENZYME INHIBITOR',
    lead: 'Small-molecule inhibitor of nicotinamide N-methyltransferase (NNMT) studied in adipocyte metabolism.',
    cas: '42464-96-0', mw: '286.11 g/mol (iodide salt)',
    formula: 'C10H11IN2',
  },
  '10-amino-1mq': {
    name: '10-Amino-1MQ', abbr: '10MQ', family: 'NNMT Inhibitor',
    eyebrow: 'NNMT ENZYME INHIBITOR',
    lead: 'NNMT inhibitor analogue investigated alongside 5-amino-1MQ in metabolic research.',
  },

  // ── regenerative ─────────────────────────────────────────────────────
  'bpc-tb-blend': {
    name: 'BPC-157 + TB-500 Blend', abbr: 'BPTB', family: 'Regenerative Blend',
    eyebrow: 'REGENERATIVE PEPTIDE BLEND', blend: true,
    lead: 'Combination of the regenerative peptides BPC-157 and TB-500 for tissue-repair research.',
  },

  // ── immunomodulatory ─────────────────────────────────────────────────
  'ara-290': {
    name: 'ARA-290', abbr: 'A290', family: 'Tissue-Protective Peptide',
    eyebrow: 'INNATE REPAIR RECEPTOR AGONIST',
    lead: 'Erythropoietin-derived peptide (cibinetide) targeting the innate repair receptor in inflammation research.',
    cas: '1208243-50-8', mw: '1258.40 g/mol',
    formula: 'C51H84N16O21',
  },
  'thymosin-alpha-1': {
    name: 'Thymosin α-1', abbr: 'TA1', family: 'Immunomodulatory Peptide',
    eyebrow: 'THYMIC IMMUNOMODULATORY PEPTIDE',
    lead: 'Thymus-derived 28-amino-acid peptide (thymalfasin) studied in immune-modulation research.',
    cas: '62304-98-7', mw: '3108.30 g/mol',
    formula: 'C129H215N33O55',
  },
  thymalin: {
    name: 'Thymalin', abbr: 'TYM', family: 'Thymic Peptide',
    eyebrow: 'THYMIC POLYPEPTIDE FRACTION',
    lead: 'Thymic polypeptide preparation investigated for immune-regulatory bioregulator activity.',
  },
  'll-37': {
    name: 'LL-37', abbr: 'LL37', family: 'Antimicrobial Peptide',
    eyebrow: 'CATHELICIDIN HOST-DEFENCE PEPTIDE',
    lead: 'Human cathelicidin-derived 37-residue antimicrobial host-defence peptide.',
    cas: '154947-66-7', mw: '4493.33 g/mol',
    formula: 'C205H340N60O53',
  },
  vip: {
    name: 'VIP', abbr: 'VIP', family: 'Neuropeptide',
    eyebrow: 'VASOACTIVE INTESTINAL PEPTIDE',
    lead: 'Vasoactive intestinal peptide — a 28-residue neuropeptide studied in immune and vascular research.',
    cas: '37221-79-7', mw: '3326.80 g/mol',
    formula: 'C147H237N43O43S',
  },

  // ── gh-secretagogue ──────────────────────────────────────────────────
  'cjc-1295-no-dac': {
    name: 'CJC-1295 (No DAC)', abbr: 'CJCN', family: 'GHRH Analogue',
    eyebrow: 'GHRH ANALOGUE · MOD GRF (1-29)',
    lead: 'GHRH(1-29) analogue (Modified GRF 1-29) without the Drug Affinity Complex, for short-acting GH-axis research.',
    mw: '3367.90 g/mol',
  },
  'cjc-ipamorelin-blend': {
    name: 'CJC-1295 (No DAC) + Ipamorelin', abbr: 'CJIP', family: 'GH Secretagogue Blend',
    eyebrow: 'GHRH + GHRP SYNERGY BLEND', blend: true,
    lead: 'Combination of the GHRH analogue CJC-1295 (No DAC) with the GHS-R agonist ipamorelin.',
  },
  tesamorelin: {
    name: 'Tesamorelin', abbr: 'TSM', family: 'GHRH Analogue',
    eyebrow: 'STABILIZED GHRH ANALOGUE',
    lead: 'Stabilized GHRH(1-44) analogue investigated for GH-axis and visceral-adipose research.',
    cas: '218949-48-5', mw: '5135.86 g/mol',
    formula: 'C221H366N72O67S',
  },
  sermorelin: {
    name: 'Sermorelin', abbr: 'SMO', family: 'GHRH Analogue',
    eyebrow: 'GHRH (1-29) ANALOGUE',
    lead: 'GHRH(1-29) analogue that stimulates endogenous pulsatile growth-hormone release.',
    cas: '86168-78-7', mw: '3357.93 g/mol',
    formula: 'C149H246N44O42S',
  },
  'hexarelin-acetate': {
    name: 'Hexarelin Acetate', abbr: 'HEX', family: 'GH Secretagogue',
    eyebrow: 'GROWTH HORMONE-RELEASING PEPTIDE',
    lead: 'Synthetic hexapeptide GHS-R agonist (growth hormone-releasing peptide) studied for potent GH secretion.',
    cas: '140703-51-1', mw: '887.04 g/mol',
    formula: 'C47H58N12O6',
  },
  'ghrp-2-acetate': {
    name: 'GHRP-2 Acetate', abbr: 'GRP2', family: 'GH Secretagogue',
    eyebrow: 'GROWTH HORMONE-RELEASING PEPTIDE 2',
    lead: 'Growth hormone-releasing peptide-2 — a synthetic GHS-R agonist driving pulsatile GH release.',
    cas: '158861-67-7', mw: '817.97 g/mol',
    formula: 'C45H55N9O6',
  },
  'ghrp-6-acetate': {
    name: 'GHRP-6 Acetate', abbr: 'GRP6', family: 'GH Secretagogue',
    eyebrow: 'GROWTH HORMONE-RELEASING PEPTIDE 6',
    lead: 'Growth hormone-releasing peptide-6 — a hexapeptide GHS-R agonist studied for GH and appetite signaling.',
    cas: '87616-84-0', mw: '873.01 g/mol',
    formula: 'C46H56N12O6',
  },
  'mk-677': {
    name: 'MK-677', abbr: 'MK', family: 'GH Secretagogue',
    eyebrow: 'ORALLY-ACTIVE GHS-R AGONIST',
    lead: 'Orally-active non-peptide ghrelin-mimetic (ibutamoren) GHS-R agonist studied for sustained GH/IGF-1 elevation.',
    cas: '159752-10-0', mw: '624.77 g/mol (mesylate)',
    formula: 'C28H40N4O8S2',
  },

  // ── nootropic-neuroactive ────────────────────────────────────────────
  selank: {
    name: 'Selank', abbr: 'SLK', family: 'Nootropic Peptide',
    eyebrow: 'TUFTSIN-DERIVED ANXIOLYTIC PEPTIDE',
    lead: 'Synthetic tuftsin-derived heptapeptide studied for anxiolytic and cognitive-modulation research.',
    cas: '129954-34-3', mw: '751.91 g/mol',
    formula: 'C33H57N11O9',
  },
  dsip: {
    name: 'DSIP', abbr: 'DSIP', family: 'Neuropeptide',
    eyebrow: 'DELTA SLEEP-INDUCING PEPTIDE',
    lead: 'Delta sleep-inducing peptide — a nonapeptide investigated in sleep-architecture and stress research.',
    cas: '62568-57-4', mw: '848.81 g/mol',
    formula: 'C35H48N10O15',
  },
  dermorphin: {
    name: 'Dermorphin', abbr: 'DRM', family: 'Opioid Peptide',
    eyebrow: 'MU-OPIOID HEPTAPEPTIDE',
    lead: 'Naturally-occurring heptapeptide with high-affinity mu-opioid receptor activity, for analgesia research.',
    cas: '77614-16-5', mw: '803.92 g/mol',
    formula: 'C40H50N8O10',
  },

  // ── antioxidant-beauty ───────────────────────────────────────────────
  'ghk-cu': {
    name: 'GHK-Cu', abbr: 'GHK', family: 'Copper Peptide',
    eyebrow: 'COPPER TRIPEPTIDE-1',
    lead: 'Copper-binding tripeptide (GHK-Cu) studied for skin remodeling, angiogenesis, and antioxidant research.',
    cas: '49557-75-7', mw: '340.91 g/mol',
  },
  'pt-141': {
    name: 'PT-141', abbr: 'PT41', family: 'Melanocortin Agonist',
    eyebrow: 'MELANOCORTIN RECEPTOR AGONIST',
    lead: 'Melanocortin receptor agonist (bremelanotide) investigated for sexual-function and CNS research.',
    cas: '189691-06-3', mw: '1025.16 g/mol',
    formula: 'C50H68N14O10',
  },
  'melanotan-1': {
    name: 'Melanotan I', abbr: 'MT1', family: 'Melanocortin Agonist',
    eyebrow: 'α-MSH ANALOGUE · MELANOGENESIS',
    lead: 'Linear α-MSH analogue (afamelanotide) studied for melanogenesis and photoprotection research.',
    cas: '75921-69-6', mw: '1646.85 g/mol',
    formula: 'C78H111N21O19',
  },
  'melanotan-2': {
    name: 'Melanotan II', abbr: 'MT2', family: 'Melanocortin Agonist',
    eyebrow: 'CYCLIC α-MSH ANALOGUE',
    lead: 'Cyclic α-MSH analogue studied for melanogenesis and broad melanocortin-receptor research.',
    cas: '121062-08-6', mw: '1024.18 g/mol',
    formula: 'C50H69N15O9',
  },
  'lemon-bottle': {
    name: 'Lemon Bottle', abbr: 'LMB', family: 'Lipolytic Solution',
    eyebrow: 'LIPOLYTIC SOLUTION BLEND', blend: true, liquid: true,
    lead: 'Lipolytic solution blend combining riboflavin and lipotropic cofactors, supplied as a sterile liquid.',
  },
  glutathione: {
    name: 'Glutathione', abbr: 'GSH', family: 'Antioxidant Tripeptide',
    eyebrow: 'ENDOGENOUS ANTIOXIDANT TRIPEPTIDE',
    lead: 'Endogenous thiol tripeptide (γ-Glu-Cys-Gly) central to cellular redox defence and detoxification.',
    cas: '70-18-8', mw: '307.32 g/mol',
    formula: 'C10H17N3O6S',
  },
  'snap-8': {
    name: 'SNAP-8', abbr: 'SNP8', family: 'Cosmetic Peptide',
    eyebrow: 'ACETYL OCTAPEPTIDE-3',
    lead: 'Acetyl octapeptide-3 studied for SNARE-complex modulation in topical cosmetic research.',
    cas: '868844-74-0', mw: '1075.25 g/mol',
    formula: 'C41H70N16O16S',
  },
  'glow-blend-ghk': {
    name: 'GLOW Blend (TB-500 · BPC-157 · GHK)', abbr: 'GLOW', family: 'Regenerative Blend',
    eyebrow: 'REGENERATIVE / DERMAL BLEND', blend: true,
    lead: 'Blend of TB-500, BPC-157 and GHK for combined regenerative and dermal research applications.',
  },
  'glow-blend-cu': {
    name: 'GLOW Blend (BPC-157 · GHK-Cu · TB-500)', abbr: 'GLWC', family: 'Regenerative Blend',
    eyebrow: 'REGENERATIVE / DERMAL BLEND', blend: true,
    lead: 'Blend of BPC-157, GHK-Cu and TB-500 for combined regenerative and dermal research applications.',
  },
  'klow-blend': {
    name: 'KLOW Blend (GHK-Cu · TB-500 · BPC-157 · KPV)', abbr: 'KLOW', family: 'Regenerative Blend',
    eyebrow: 'MULTI-PEPTIDE DERMAL BLEND', blend: true,
    lead: 'Multi-peptide blend of GHK-Cu, TB-500, BPC-157 and KPV for dermal and regenerative research.',
  },

  // ── growth-factor-anabolic ───────────────────────────────────────────
  hgh: {
    name: 'HGH', abbr: 'HGH', family: 'Growth Hormone',
    eyebrow: 'RECOMBINANT SOMATROPIN',
    lead: 'Recombinant 191-amino-acid human growth hormone (somatropin) for growth-factor research.',
    cas: '12629-01-5', mw: '~22125 g/mol',
  },
  'igf-1-lr3': {
    name: 'IGF-1 LR3', abbr: 'IGF', family: 'Growth Factor',
    eyebrow: 'LONG R3 IGF-1 ANALOGUE',
    lead: 'Long R3 insulin-like growth factor-1 analogue with reduced IGFBP binding, for anabolic-signaling research.',
    mw: '9117.65 g/mol',
  },
  mgf: {
    name: 'MGF', abbr: 'MGF', family: 'Growth Factor',
    eyebrow: 'MECHANO GROWTH FACTOR',
    lead: 'Mechano growth factor — an IGF-1 splice variant (IGF-1Ec) studied in muscle-repair research.',
  },
  'peg-mgf': {
    name: 'PEG-MGF', abbr: 'PMGF', family: 'Growth Factor',
    eyebrow: 'PEGYLATED MECHANO GROWTH FACTOR',
    lead: 'PEGylated mechano growth factor with extended stability, for muscle-repair research.',
  },

  // ── bioregulator ─────────────────────────────────────────────────────
  'foxo4-dri': {
    name: 'FOXO4-DRI', abbr: 'FOXO', family: 'Senolytic Peptide',
    eyebrow: 'FOXO4 D-RETRO-INVERSO PEPTIDE',
    lead: 'FOXO4 D-retro-inverso peptide that disrupts the FOXO4–p53 interaction in senescence research.',
    cas: '2460055-10-9',
  },

  // ── reproductive-hormonal ────────────────────────────────────────────
  hmg: {
    name: 'HMG', abbr: 'HMG', family: 'Gonadotropin',
    eyebrow: 'HUMAN MENOPAUSAL GONADOTROPIN',
    lead: 'Human menopausal gonadotropin (menotropin) preparation with combined FSH and LH activity.',
  },
  gonadorelin: {
    name: 'Gonadorelin', abbr: 'GnRH', family: 'GnRH Analogue',
    eyebrow: 'GONADOTROPIN-RELEASING HORMONE',
    lead: 'Synthetic gonadotropin-releasing hormone (GnRH) decapeptide that stimulates pituitary LH/FSH release.',
    cas: '33515-09-2', mw: '1182.31 g/mol',
    formula: 'C55H75N17O13',
  },
  'kisspeptin-10': {
    name: 'Kisspeptin-10', abbr: 'KISS', family: 'Reproductive Peptide',
    eyebrow: 'KISS1-DERIVED DECAPEPTIDE',
    lead: 'KISS1-derived decapeptide that activates GPR54 to drive GnRH release in reproductive-axis research.',
    cas: '374675-21-5', mw: '1302.50 g/mol',
    formula: 'C63H83N17O14',
  },
  'oxytocin-acetate': {
    name: 'Oxytocin Acetate', abbr: 'OXT', family: 'Neurohypophysial Peptide',
    eyebrow: 'NONAPEPTIDE HORMONE',
    lead: 'Cyclic nonapeptide hormone studied for social-behaviour, parturition and lactation research.',
    cas: '50-56-6', mw: '1007.19 g/mol',
    formula: 'C43H66N12O12S2',
  },
  hcg: {
    name: 'HCG', abbr: 'HCG', family: 'Gonadotropin',
    eyebrow: 'HUMAN CHORIONIC GONADOTROPIN',
    lead: 'Human chorionic gonadotropin glycoprotein hormone with LH-like activity, dosed in international units.',
    cas: '9002-61-3',
  },
};

/**
 * LAYMAN — curated, engaging plain-English summaries for the well-known
 * compounds (Retatrutide-style). Research register: describe what the
 * compound IS and what it is STUDIED FOR — never an outcome in a person.
 * No consumer drug-brand anchors, no human dosing/route language, no
 * second-person framing. Uses SummaryText highlight markup:
 *   **key term** (cyan) · ~reported finding~ (mint) · *emphasis* (white).
 * Keyed by canonical slug. Compounds without an entry fall back to
 * `META[key].lead` (a plain functional one-liner). Kept factual — the
 * obscure blends/extracts are intentionally left on the plain line.
 */
export const LAYMAN = {
  // incretin-metabolic-agonists
  cagrilintide:
    "Cagrilintide is a long-acting **amylin** analogue — an amylin-receptor agonist studied *alongside* GLP-1 agonists. It is investigated for **satiety signaling**, and paired with semaglutide (CagriSema) it is a widely studied *next-generation metabolic* research combination.",
  cagrisema:
    "CagriSema pairs the amylin analogue **cagrilintide** with the GLP-1 agonist **semaglutide** — engaging *two complementary appetite pathways*. It is one of the most-studied next-generation *metabolic-research* combinations.",
  mazdutide:
    "Mazdutide is a **GLP-1 + glucagon** dual agonist. The glucagon component adds *energy-expenditure* signaling on top of GLP-1 activity — studied in *metabolic research* models.",
  survodutide:
    "Survodutide is a **glucagon + GLP-1** dual agonist studied in *liver (MASH) and metabolic* research — the glucagon component is investigated for effects on *hepatic lipid metabolism*.",

  // metabolic-cofactor
  'nad-plus':
    "NAD+ is a central **energy and repair** coenzyme — it drives mitochondrial redox reactions and is a required substrate for the *sirtuin* enzymes. Cellular levels are ~reported to decline with age~ in published models, which is why it anchors much *cellular-aging and metabolic* research.",
  'ss-31':
    "SS-31 is a **mitochondria-targeting** peptide that binds *cardiolipin*, a lipid inside the cell's power plants. Research models report ~stabilized mitochondrial function~ and ~reduced oxidative stress~, so it is studied in cardiac, muscle, and *age-related bioenergetics* work.",
  'mots-c':
    "MOTS-c is a rare **mitochondrial-derived peptide** — encoded by the mitochondria themselves. It activates **AMPK**, the cell's metabolic master-sensor, and is investigated as an *exercise-mimetic*, with ~improved insulin sensitivity~ reported in animal models.",
  'l-carnitine':
    "L-Carnitine is the **carnitine shuttle** that transports long-chain fatty acids into mitochondria for β-oxidation. A staple of *fat-metabolism and exercise-physiology* research.",
  aicar:
    "AICAR is an **AMPK activator** — it shifts the cell into 'energy-burning' mode as though it had just exercised. Studied as an *exercise-mimetic*, with effects on ~endurance capacity~ and ~glucose metabolism~ reported in animal models.",
  adipotide:
    "Adipotide is an experimental **pro-apoptotic peptidomimetic** that homes to the vasculature of adipose tissue. A pre-clinical *metabolic-research* tool with a distinct vascular-targeting mechanism.",
  '5-amino-1mq':
    "5-Amino-1MQ is a small-molecule **NNMT inhibitor** studied in *adipocyte-metabolism* research — NNMT inhibition is investigated for effects on *cellular NAD+* and *adipocyte lipid metabolism*.",

  // regenerative
  'bpc-tb-blend':
    "A combined **BPC-157 + TB-500** stack — the two flagship *regeneration* peptides together, studied for ~tissue-repair signaling~ across gut, tendon, muscle, and vascular models.",

  // immunomodulatory
  'ara-290':
    "ARA-290 (cibinetide) is an **EPO-derived** peptide that engages the *innate repair receptor* without acting on red-blood-cell production. It is investigated in *neuroinflammation and neuropathic-pain* models, where ~reduced nerve inflammation~ has been reported.",
  'thymosin-alpha-1':
    "Thymosin α-1 is a thymus-derived **immune-modulating** peptide. It is investigated for effects on ~T-cell maturation and immune balance~ — a standing tool in *infection, vaccine-adjuvant, and immune-recovery* research.",
  'll-37':
    "LL-37 is an **endogenous antimicrobial peptide** — a frontline host-defense molecule that disrupts microbial membranes. Research models also report ~wound-repair signaling~ alongside its direct antimicrobial action; a core tool in *innate-immunity and infection* work.",
  vip:
    "VIP (Vasoactive Intestinal Peptide) is a signaling peptide with broad **anti-inflammatory** and vessel-relaxing roles. It's studied for *immune balance, gut, and chronic-inflammatory* research.",

  // gh-secretagogue
  'cjc-1295-no-dac':
    "CJC-1295 without DAC (Mod GRF 1-29) is the **short-acting GHRH** peptide — proposed to drive a *pulsatile* growth-hormone release that clears within hours. It is the classic study partner for a GHRP such as ipamorelin, the two *investigated together* for additive signaling.",
  'cjc-ipamorelin-blend':
    "The classic **CJC-1295 (No DAC) + Ipamorelin** stack — a GHRH paired with a GHRP. The combination is studied for a ~larger, more selective growth-hormone pulse~ than either peptide produces alone in research models.",
  tesamorelin:
    "Tesamorelin is a stabilized **GHRH** analogue. In published clinical trials, ~reduction of visceral adipose tissue~ was reported; proposed mechanisms involve stimulation of endogenous GH and IGF-1. It carries the most *human-trial* data among the GHRH peptides.",
  sermorelin:
    "Sermorelin is the classic **GHRH** peptide — the first 29 amino acids of the natural releasing hormone. It is studied as a pituitary-level stimulus for ~endogenous growth-hormone release~ in a *pulsatile* pattern.",
  'hexarelin-acetate':
    "Hexarelin is among the **most potent growth-hormone-releasing peptides**. Beyond the pronounced ~GH pulse~ reported in research models, it is studied for *cardioprotective* signaling through the CD36 receptor — unusual among the GHRPs.",
  'ghrp-2-acetate':
    "GHRP-2 is a potent **growth-hormone-releasing peptide**. Research models report a strong, selective ~GH pulse~ with comparatively mild appetite signaling. Frequently studied alongside a GHRH such as CJC-1295 for *additive* effect.",
  'ghrp-6-acetate':
    "GHRP-6 is the original **growth-hormone-releasing peptide** and a strong agonist at the *ghrelin* (hunger) receptor — research models report both ~GH release~ and ~pronounced appetite signaling~, making it a standard comparator in feeding-behavior work.",
  'mk-677':
    "MK-677 (ibutamoren) is an **oral, non-peptide** ghrelin-mimetic. Published studies report ~sustained GH and IGF-1 elevation~ across roughly a *24-hour* window, which is why it is one of the most-studied GH secretagogues in the class.",

  // nootropic-neuroactive
  selank:
    "Selank is a Russian **anxiolytic nootropic** peptide derived from the immune molecule tuftsin. Research models report ~anxiolytic activity without sedation~ and ~altered attention measures~, with proposed mechanisms involving BDNF and GABAergic signaling — a research cousin of *Semax*.",
  dsip:
    "DSIP (Delta Sleep-Inducing Peptide) is a natural brain peptide tied to **deep-sleep** rhythms. It is investigated in *sleep-architecture and stress-response* models, where ~changes in slow-wave sleep~ have been reported.",
  dermorphin:
    "Dermorphin is a naturally occurring heptapeptide and a potent, selective **µ-opioid receptor** agonist. Studied in *analgesia and opioid-pharmacology* research.",

  // antioxidant-beauty
  'ghk-cu':
    "GHK-Cu is the **copper-binding tripeptide** at the center of dermatological research. Studies report ~upregulated collagen and elastin signaling~ and ~angiogenic activity~, alongside antioxidant behavior — the backbone of *skin-remodeling, hair-follicle, and wound-healing* research.",
  'pt-141':
    "PT-141 (bremelanotide) is a **melanocortin receptor** agonist that acts centrally through the **brain** rather than the vascular system. Studied in *CNS and behavioral* research.",
  'melanotan-1':
    "Melanotan I is an **α-MSH** analogue studied for ~melanogenesis~ in *photoprotection* research — more targeted than Melanotan II, acting mainly on pigmentation pathways.",
  'melanotan-2':
    "Melanotan II is a broad, non-selective **melanocortin** agonist studied for ~melanogenesis~ and central melanocortin signaling — more potent and less selective than Melanotan I.",
  glutathione:
    "Glutathione is a key intracellular **antioxidant** — a tripeptide (γ-Glu-Cys-Gly) that neutralizes reactive oxygen species and serves as a cofactor in redox and detoxification enzymes. Studied in *oxidative-stress and redox* research.",
  'snap-8':
    "SNAP-8 is a topical **dermatological research peptide** (acetyl octapeptide-3) studied for **SNARE-complex modulation** — investigated in *topical dermatological* research for effects on expression-related muscle signaling.",

  // growth-factor-anabolic
  hgh:
    "HGH (somatropin) is **recombinant human growth hormone** — the full 191-amino-acid hormone. It is the reference compound for *growth-factor and tissue-anabolism* research that the secretagogue peptides stimulate indirectly.",
  'igf-1-lr3':
    "IGF-1 LR3 is a long-acting analogue of **insulin-like growth factor-1** with reduced IGF-binding-protein affinity, giving it an extended half-life. A potent *anabolic-signaling* research tool.",
  mgf:
    "MGF (Mechano Growth Factor) is an IGF-1 splice variant expressed in response to mechanical loading. Studied for ~satellite (muscle stem) cell activation~ and local tissue repair.",
  'peg-mgf':
    "PEG-MGF is **MGF** conjugated to PEG for extended circulating stability — studied for *satellite-cell activation and tissue-repair* signaling.",

  // bioregulator
  'foxo4-dri':
    "FOXO4-DRI is a **senolytic** research peptide designed to ~target senescent ('zombie') cells~ by disrupting the FOXO4–p53 interaction. A widely studied *cellular-senescence and longevity* research tool.",

  // reproductive-hormonal
  hmg:
    "HMG (menotropin) is a **gonadotropin** preparation carrying both FSH and LH activity, used in *fertility and reproductive-axis* research to ~stimulate gonadal function~.",
  gonadorelin:
    "Gonadorelin is **GnRH** — the master hormone that signals the pituitary to release LH and FSH. Used in *reproductive-axis* research to probe ~endogenous gonadotropin release~ under pulsatile stimulation.",
  'kisspeptin-10':
    "Kisspeptin-10 sits at the **top of the reproductive cascade**, acting on the GnRH neurons that drive the whole hormone axis. A key research tool for studying ~endogenous LH and FSH release~ and fertility signaling.",
  'oxytocin-acetate':
    "Oxytocin is a nine-amino-acid **neuropeptide hormone** central to *social bonding, trust, and lactation* physiology. Widely investigated in ~social-behavior~ and neuropsychiatric research models.",
  hcg:
    "HCG is a **gonadotropin** that mimics LH, signaling the gonads to produce sex hormones. In research it is used to probe ~endogenous testosterone or progesterone production~, and is supplied on an international-unit basis.",
};

/**
 * Normalize a manifest `model` string to a canonical key.
 * Returns either:
 *   - an EXISTING.* descriptor (already a rich product → skip + widen), or
 *   - a string key present in META (new compound to create), or
 *   - null (could not classify; the build will warn and skip).
 */
export function modelToKey(model) {
  const m = model.trim().toLowerCase();

  // Existing rich products (+ their manifest aliases / salt forms).
  if (m === 'tirzepatide') return EXISTING.TIRZEPATIDE;
  if (m === 'retatrutide') return EXISTING.RETATRUTIDE;
  if (m === 'ipamorelin') return EXISTING.IPAMORELIN;
  if (m === 'semax') return EXISTING.SEMAX;
  if (m === 'epitalon' || m === 'epithalon') return EXISTING.EPITALON;
  if (m === 'kpv' || m === 'lysine-proline-valine') return EXISTING.KPV;
  if (m === 'bpc 157' || m === 'bpc-157' || m === 'bpc 157 acetate') return EXISTING.BPC157;
  if (m.startsWith('tb500') || m.startsWith('tb-500')) return EXISTING.TB500;
  if (m === 'cjc-1295 with dac') return EXISTING.CJC_DAC;
  if (m === 'aod-9604' || m === 'aod9604') return EXISTING.AOD9604;
  if (m === 'bacteriostatic water') return EXISTING.BAC_WATER;

  // CJC-1295 no-DAC naming variants → one canonical compound.
  if (
    m === 'cjc-1295 no dac' ||
    m === 'cjc-1295 without dac' ||
    m === 'cjc-1295 (without dac)'
  ) return 'cjc-1295-no-dac';
  if (m === 'cjc-1295 no dac 5mg + ipa 5mg') return 'cjc-ipamorelin-blend';

  // Blends.
  if (m === 'blend: bpc 5mg + tb 5mg' || m === 'blend: bpc + tb') return 'bpc-tb-blend';
  if (m === 'cagrilintide 5mg + semaglutide 5mg' || m === 'cagrilintide + semaglutide') return 'cagrisema';
  if (m === 'glow blend: tb 10mg + bpc-157 10mg + ghk 50mg') return 'glow-blend-ghk';
  if (m === 'blend: bpc-157 10mg + ghk-cu 50mg + tb-500 10mg') return 'glow-blend-cu';
  if (
    m === 'blend: cu 50mg + tb 10mg + bc 10mg + kpv 1mg' ||
    m === 'blend: 10mg + bpc-157 10mg + ghk 50mg + k'
  ) return 'klow-blend';

  // Direct-name compounds.
  const direct = {
    'cagrilintide': 'cagrilintide',
    'mazdutide': 'mazdutide',
    'survodutide': 'survodutide',
    'nad+': 'nad-plus',
    'ss-31': 'ss-31',
    'mots-c': 'mots-c',
    'lipo-c': 'lipo-c',
    'l-carnitine': 'l-carnitine',
    'adipotide': 'adipotide',
    'aicar': 'aicar',
    '5-amino-1mq': '5-amino-1mq',
    '10-amino-1mq': '10-amino-1mq',
    'ara 290': 'ara-290',
    'thymosin α-1': 'thymosin-alpha-1',
    'thymalin': 'thymalin',
    'll-37': 'll-37',
    'vip': 'vip',
    'tesamorelin': 'tesamorelin',
    'sermorelin': 'sermorelin',
    'hexarelin acetate': 'hexarelin-acetate',
    'ghrp-2 acetate': 'ghrp-2-acetate',
    'ghrp-6 acetate': 'ghrp-6-acetate',
    'mk-677': 'mk-677',
    'selank': 'selank',
    'dsip': 'dsip',
    'dermorphin': 'dermorphin',
    'ghk-cu': 'ghk-cu',
    'pt-141': 'pt-141',
    'melanotan i': 'melanotan-1',
    'melanotan ii': 'melanotan-2',
    'lemon bottle': 'lemon-bottle',
    'glutathione': 'glutathione',
    'snap-8': 'snap-8',
    'hgh': 'hgh',
    'igf-1 lr3': 'igf-1-lr3',
    'mgf': 'mgf',
    'peg-mgf': 'peg-mgf',
    'foxo4-dri': 'foxo4-dri',
    'hmg': 'hmg',
    'gonadorelin': 'gonadorelin',
    'gonadorelin acetate': 'gonadorelin',
    'kisspeptin-10': 'kisspeptin-10',
    'oxytocin acetate': 'oxytocin-acetate',
    'hcg': 'hcg',
  };
  if (direct[m]) return direct[m];

  return null;
}
