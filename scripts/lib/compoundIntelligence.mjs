/**
 * compoundIntelligence — curated, source-verified pharmacology + study data
 * for the NEW canonical compounds promoted by buildInventory.mjs.
 *
 * INTEGRITY POLICY (mirrors compoundData.mjs and src/lib/compoundIntelligence.ts):
 * every value here is grounded in an authoritative source (PubChem, ChEMBL,
 * DrugBank, ClinicalTrials.gov, FDA labels, peer-reviewed journals). Mechanism /
 * receptor / pathway prose is established textbook pharmacology. `knownStudies`
 * lists ONLY studies whose existence was verified; uncertain or mis-attributed
 * citations are omitted rather than guessed. Compounds with no verifiable
 * clinical/named study carry an empty `knownStudies: []` — the Known Studies
 * module renders nothing rather than a fabricated reference.
 *
 * `model` values use the Product StudyModel enum: 'human' | 'in-vivo' |
 * 'in-vitro' | 'review' (preclinical animal work → 'in-vivo').
 *
 * Keyed by canonical slug (matches META in compoundData.mjs). Blends and
 * heterogeneous biologic preparations still get mechanism/receptor/pathway/
 * fdaStatus prose (their CAS/MW remain omitted in META by design).
 */

export const INTELLIGENCE = {
  // ── incretin-metabolic-agonists ──────────────────────────────────────────────────────
  cagrilintide: {
    mechanismSummary:
      'Long-acting acylated analogue of the pancreatic hormone amylin. A C20 fatty-diacid chain enables albumin binding for once-weekly dosing. It signals in hypothalamic and hindbrain satiety centres to suppress food intake, slow gastric emptying, and promote satiety.',
    receptorActivity:
      'Non-selective agonist at the amylin receptors (AMY1–3, calcitonin-receptor core complexed with RAMPs) and the calcitonin receptor; not selective among the AMY subtypes.',
    pathwaySummary:
      'Agonism of these Gs-coupled GPCRs raises intracellular cAMP in CNS appetite-regulating neurons, reducing energy intake.',
    fdaStatus: 'Investigational — Phase 3 (standalone and as the amylin arm of CagriSema)',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Development of Cagrilintide, a Long-Acting Amylin Analogue', source: 'J. Med. Chem. (ACS)', year: 2021, model: 'in-vitro', phase: 'Preclinical', pmid: '34288673', doi: '10.1021/acs.jmedchem.1c00565' },
      { title: 'REDEFINE 1: Coadministered Cagrilintide and Semaglutide in Overweight or Obesity', source: 'NEJM', year: 2025, model: 'human', phase: 'Phase 3', pmid: '40544433', doi: '10.1056/NEJMoa2502081' },
    ],
  },
  cagrisema: {
    mechanismSummary:
      'Fixed combination of two molecules: cagrilintide (amylin/calcitonin agonist) and semaglutide (GLP-1 agonist). The two act on complementary appetite pathways — amylin and incretin signalling — for additive reductions in food intake and body weight.',
    receptorActivity:
      'Combined activity at the amylin/calcitonin receptors (cagrilintide) and the GLP-1 receptor (semaglutide).',
    pathwaySummary:
      'Dual GPCR agonism: cAMP signalling via amylin/calcitonin receptors plus GLP-1R-mediated cAMP/PKA signalling in hypothalamic and hindbrain satiety circuits.',
    fdaStatus: 'Investigational — Phase 3 (regulatory filing submitted; not yet approved)',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'REDEFINE 1: Coadministered Cagrilintide and Semaglutide in Overweight or Obesity', source: 'NEJM', year: 2025, model: 'human', phase: 'Phase 3', pmid: '40544433', doi: '10.1056/NEJMoa2502081' },
      { title: 'REDEFINE 2: Cagrilintide–Semaglutide in Overweight or Obesity and Type 2 Diabetes', source: 'NEJM', year: 2025, model: 'human', phase: 'Phase 3', pmid: '40544432', doi: '10.1056/NEJMoa2502082' },
    ],
  },
  mazdutide: {
    mechanismSummary:
      'Synthetic long-acting oxyntomodulin analogue acting as a dual GLP-1 and glucagon receptor agonist. GLP-1R agonism enhances glucose-dependent insulin secretion and suppresses appetite, while glucagon-receptor agonism raises energy expenditure and lipolysis.',
    receptorActivity:
      'Balanced co-agonist at GLP-1R and the glucagon receptor (GCGR); a dual incretin–glucagon agonist rather than a single-receptor agent.',
    pathwaySummary:
      'Both receptors are Gs-coupled GPCRs; agonism raises cAMP/PKA signalling in pancreatic β-cells, hepatocytes, adipocytes, and hypothalamic neurons.',
    fdaStatus: 'Not FDA-approved; reported approved in China (2025), investigational elsewhere',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Once-Weekly Mazdutide in Chinese Adults with Obesity or Overweight (GLORY-1)', source: 'NEJM', year: 2025, model: 'human', phase: 'Phase 3', pmid: '40421736', doi: '10.1056/NEJMoa2411528' },
      { title: 'GLP-1/Glucagon Dual Agonist Mazdutide (IBI362) in Chinese Adults with Overweight or Obesity', source: 'eClinicalMedicine (Lancet)', year: 2022, model: 'human', phase: 'Phase 1b', pmid: '36247927', doi: '10.1016/j.eclinm.2022.101691' },
    ],
  },
  survodutide: {
    mechanismSummary:
      'Synthetic acylated peptide acting as a dual glucagon and GLP-1 receptor agonist. GLP-1R activation enhances glucose-dependent insulin secretion and reduces appetite, while glucagon-receptor activation raises hepatic energy expenditure and lipid oxidation — reducing body weight and liver fat.',
    receptorActivity:
      'Potent dual GCGR/GLP-1R agonist engineered for balanced dual-receptor activity rather than single-receptor selectivity.',
    pathwaySummary:
      'Both GCGR and GLP-1R are Gs-coupled GPCRs; agonism elevates cAMP/PKA signalling in liver, pancreas, and CNS appetite centres.',
    fdaStatus: 'Investigational — Phase 3 (FDA Breakthrough Therapy designation for MASH)',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'A Phase 2 Randomized Trial of Survodutide in MASH and Fibrosis', source: 'NEJM', year: 2024, model: 'human', phase: 'Phase 2', pmid: '38847460', doi: '10.1056/NEJMoa2401755' },
      { title: 'Survodutide Once Weekly for the Treatment of Adults with Obesity (SYNCHRONIZE-1)', source: 'NEJM', year: 2026, model: 'human', phase: 'Phase 3', pmid: '42253238', doi: '10.1056/NEJMoa2600751' },
    ],
  },

  // ── metabolic-cofactor ───────────────────────────────────────────────────
  'nad-plus': {
    mechanismSummary:
      'A fundamental coenzyme that carries electrons in redox reactions, cycling between NAD+ and NADH across glycolysis, the TCA cycle, and oxidative phosphorylation. Beyond redox, it is a consumed substrate for sirtuins, PARPs, and CD38 — linking it to gene regulation, DNA repair, and calcium signalling.',
    receptorActivity:
      'Not a receptor ligand; an enzyme cofactor/substrate for oxidoreductases, sirtuins (SIRT1–7), PARP enzymes, and CD38/CD157.',
    pathwaySummary:
      'Central to cellular energy metabolism and to sirtuin- and PARP-dependent signalling governing metabolism, stress response, and DNA repair.',
    fdaStatus: 'Not an approved drug — endogenous coenzyme / research compound',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'ss-31': {
    mechanismSummary:
      'A cell-permeable, mitochondria-targeting tetrapeptide (elamipretide) that concentrates on the inner mitochondrial membrane by binding cardiolipin. By stabilising cardiolipin–cytochrome-c interactions it preserves cristae structure and electron-transport efficiency, improving ATP output and lowering mitochondrial ROS.',
    receptorActivity:
      'Not a classic receptor ligand; its molecular target is the phospholipid cardiolipin on the inner mitochondrial membrane.',
    pathwaySummary:
      'Acts on the electron-transport chain by stabilising cardiolipin, enhancing oxidative phosphorylation and limiting ROS-mediated damage.',
    fdaStatus: 'Approved — Forzinity (elamipretide HCl), FDA accelerated approval 2025 for Barth syndrome',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Phase 2/3 Trial of Elamipretide in Barth Syndrome (with open-label extension)', source: 'Genetics in Medicine', year: 2021, model: 'human', phase: 'Phase 2/3', pmid: '33077895', doi: '10.1038/s41436-020-01006-8' },
    ],
  },
  'mots-c': {
    mechanismSummary:
      'A 16-amino-acid mitochondrial-derived peptide encoded within the mitochondrial 12S rRNA region. It inhibits the folate–methionine cycle and de novo purine biosynthesis, raising the AMP:ATP ratio and activating AMPK; it can also translocate to the nucleus to regulate stress-responsive gene expression.',
    receptorActivity:
      'Not a defined receptor agonist; acts intracellularly with AMPK as the principal downstream effector and modulation of folate one-carbon metabolism.',
    pathwaySummary:
      'Activates the AMPK energy-sensing pathway, enhancing glucose uptake, fatty-acid oxidation, and metabolic stress resistance.',
    fdaStatus: 'Preclinical / research only',
    humanTrialsConfirmed: false,
    knownStudies: [
      { title: 'The Mitochondrial-Derived Peptide MOTS-c Promotes Metabolic Homeostasis and Reduces Obesity and Insulin Resistance', source: 'Cell Metabolism', year: 2015, model: 'in-vivo', phase: 'Preclinical', pmid: '25738459', doi: '10.1016/j.cmet.2015.02.009' },
    ],
  },
  'lipo-c': {
    mechanismSummary:
      'A compounded lipotropic ("MIC") injection typically containing methionine, inositol, choline, and B-vitamins. The lipotropic components are proposed to support hepatic lipid metabolism and fat mobilisation — methionine as a methyl donor, choline for phospholipid/VLDL export, inositol in lipid signalling.',
    receptorActivity:
      'No single receptor or enzyme target — activity derives from the separate metabolic roles of its constituent nutrients.',
    pathwaySummary:
      'Constituents feed into hepatic one-carbon/methylation metabolism and lipid-transport pathways; no unified receptor-mediated pathway.',
    fdaStatus: 'Not approved — compounded nutritional injection',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  'l-carnitine': {
    mechanismSummary:
      'An endogenous quaternary amine essential for transporting long-chain fatty acids across the inner mitochondrial membrane for β-oxidation. It is the obligatory acyl-group carrier in the carnitine shuttle (CPT1 → CACT → CPT2), enabling fatty-acid-derived ATP production.',
    receptorActivity:
      'Not a receptor ligand; the substrate/cofactor of the carnitine acyltransferases (CPT1, CPT2) and carnitine-acylcarnitine translocase.',
    pathwaySummary:
      'Central to mitochondrial fatty-acid β-oxidation (the carnitine shuttle) supplying acetyl-CoA to the TCA cycle.',
    fdaStatus: 'Approved — levocarnitine (Carnitor) for carnitine deficiency; also a supplement',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  adipotide: {
    mechanismSummary:
      'A chimeric peptidomimetic (FTPP) linking a prohibitin-binding homing sequence (CKGGRAKDC) to a pro-apoptotic D-peptide, D(KLAKLAK)2. The homing domain targets prohibitin on white-adipose-tissue vascular endothelium; on internalisation the KLAKLAK moiety disrupts mitochondrial membranes, pruning the fat-tissue blood supply.',
    receptorActivity:
      'Targets prohibitin on adipose-tissue endothelium; the effector moiety is a membrane-disrupting pro-apoptotic peptide rather than a receptor agonist.',
    pathwaySummary:
      'Induces mitochondrial membrane disruption and the intrinsic apoptotic pathway selectively in adipose vascular endothelium.',
    fdaStatus: 'Not approved — Phase 1 oncology trial terminated; development discontinued',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Reversal of obesity by targeted ablation of adipose tissue', source: 'Nature Medicine', year: 2004, model: 'in-vivo', phase: 'Preclinical', pmid: '15133506', doi: '10.1038/nm1048' },
    ],
  },
  aicar: {
    mechanismSummary:
      'A cell-permeable adenosine analogue (acadesine) phosphorylated intracellularly to ZMP, an AMP-mimetic. ZMP allosterically activates AMP-activated protein kinase (AMPK), increasing glucose uptake and fatty-acid oxidation while suppressing hepatic gluconeogenesis, lipogenesis, and mTORC1 signalling.',
    receptorActivity:
      'Acts as an AMPK activator via its phosphorylated metabolite ZMP; also functions as an adenosine-regulating agent. Not a selective receptor ligand.',
    pathwaySummary:
      'Activates the AMPK energy-sensing pathway, shifting cells toward catabolic ATP generation and inhibiting mTORC1-driven anabolism.',
    fdaStatus: 'Not approved — acadesine reached Phase 3 (cardioprotection); WADA-prohibited',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Acadesine and Morbidity/Mortality in CABG: The RED-CABG Randomized Controlled Trial', source: 'JAMA', year: 2012, model: 'human', phase: 'Phase 3', pmid: '22782417', doi: '10.1001/jama.2012.7633' },
    ],
  },
  '5-amino-1mq': {
    mechanismSummary:
      'A small-molecule, substrate-site-directed inhibitor of nicotinamide N-methyltransferase (NNMT). By blocking NNMT-mediated methylation of nicotinamide (which consumes S-adenosylmethionine), it is proposed to raise cellular NAD+ salvage and SAM levels and reduce adipocyte lipogenesis.',
    receptorActivity:
      'Selective enzyme inhibitor of NNMT (reported IC50 ~1.2 µM); an enzyme inhibitor, not a receptor ligand.',
    pathwaySummary:
      'Inhibition of NNMT perturbs nicotinamide/NAD+ salvage and SAM-dependent methylation balance, influencing adipocyte energy metabolism.',
    fdaStatus: 'Preclinical / research only',
    humanTrialsConfirmed: false,
    knownStudies: [
      { title: 'A Small-Molecule Inhibitor of NNMT for the Treatment of Metabolic Disorders', source: 'Scientific Reports', year: 2018, model: 'in-vivo', phase: 'Preclinical', pmid: '29483571', doi: '10.1038/s41598-018-22081-7' },
    ],
  },
  '10-amino-1mq': {
    mechanismSummary:
      'Described as an analogue of 5-amino-1MQ intended to inhibit nicotinamide N-methyltransferase (NNMT), the SAM-dependent enzyme that methylates nicotinamide. The proposed effect — preserved NAD+ salvage and reduced adipocyte lipogenesis — is extrapolated from the 5-amino parent and not yet substantiated for this specific analogue.',
    receptorActivity:
      'Purported NNMT enzyme inhibitor by analogy to 5-amino-1MQ; no verified selectivity or potency data exist for this specific compound.',
    pathwaySummary:
      'Presumed inhibition of the NNMT / nicotinamide–NAD+ methylation pathway, by analogy only.',
    fdaStatus: 'Research-chemical only — no authoritative characterisation',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },

  // ── regenerative ───────────────────────────────────────────────────────
  'bpc-tb-blend': {
    mechanismSummary:
      'A blend of two synthetic peptides: BPC-157 (a stable gastric pentadecapeptide) and TB-500 (a thymosin-β4-related fragment). The combination is studied for synergistic tissue repair and angiogenesis; it has no single defined chemical identity.',
    receptorActivity:
      'No single receptor: BPC-157 modulates the nitric-oxide system and upregulates VEGFR2/growth-factor signalling; TB-500 acts mainly through G-actin sequestration.',
    pathwaySummary:
      'Proposed angiogenic and cytoprotective effects via VEGFR2–NO signalling (BPC-157) and actin-regulation/cell-migration pathways (TB-500); evidence is preclinical.',
    fdaStatus: 'Not approved — neither component is FDA-approved for human use',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },

  // ── immunomodulatory ─────────────────────────────────────────────────────
  'ara-290': {
    mechanismSummary:
      'An 11-amino-acid peptide (cibinetide) derived from the helix-B surface of erythropoietin. It mimics EPO’s tissue-protective, non-erythropoietic signalling to reduce inflammation and promote nerve and tissue repair without stimulating red-cell production.',
    receptorActivity:
      'Selective agonist of the innate repair receptor — a heteromer of the EPO receptor and the β-common receptor (CD131); it does not bind the classical homodimeric EPO receptor.',
    pathwaySummary:
      'Engages anti-apoptotic and anti-inflammatory cascades (JAK2/STAT, PI3K/Akt) to suppress pro-inflammatory cytokines and support small-nerve-fibre regeneration.',
    fdaStatus: 'Investigational — Orphan Drug & Fast Track (sarcoidosis-associated neuropathic pain)',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Cibinetide (ARA-290) in Sarcoidosis-Associated Small-Fibre Neuropathy — trial registration, no publication', source: 'ClinicalTrials.gov trial registration', year: 2017, model: 'human', phase: 'Phase 2b', nctId: 'NCT02039687' },
      { title: 'Cibinetide Improves Corneal Nerve Fiber Abundance in Patients With Sarcoidosis-Associated Small Nerve Fiber Loss and Neuropathic Pain', source: 'Invest. Ophthalmol. Vis. Sci.', year: 2017, model: 'human', phase: 'Phase 2', pmid: '28475703', doi: '10.1167/iovs.16-21291' },
    ],
  },
  'thymosin-alpha-1': {
    mechanismSummary:
      'A 28-amino-acid acetylated peptide (thymalfasin) originally isolated from thymic tissue. It is an immunomodulator that augments T-cell maturation and function and enhances both innate and adaptive immune responses.',
    receptorActivity:
      'Acts in part through Toll-like receptor signalling (notably TLR9/TLR2) on dendritic and other immune cells; it has no single high-affinity receptor and works pleiotropically.',
    pathwaySummary:
      'Stimulates Th1 cytokine production (IL-2, IFN-γ), promotes dendritic-cell and T-cell maturation, and increases NK-cell activity via TLR-mediated and NF-κB pathways.',
    fdaStatus: 'Not FDA-approved; reported approved in other jurisdictions as Zadaxin (chronic hepatitis B)',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  thymalin: {
    mechanismSummary:
      'A polypeptide complex purified from calf/bovine thymus — a thymic peptide fraction rather than a single molecule. It is used as an immune bioregulator believed to restore T-cell-mediated immunity and normalise immune balance.',
    receptorActivity:
      'No defined single-receptor activity; as a heterogeneous peptide mixture it exerts pleiotropic effects on thymocyte/T-cell differentiation.',
    pathwaySummary:
      'Reported to modulate T-lymphocyte differentiation, cytokine balance, and neuroendocrine-immune regulation; molecular pathways are not characterised for the mixture as a whole.',
    fdaStatus: 'Not FDA-approved; used clinically in Russia / Eastern Europe',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'll-37': {
    mechanismSummary:
      'The sole human cathelicidin antimicrobial peptide — a 37-residue cationic amphipathic peptide cleaved from the hCAP-18 precursor. It directly disrupts microbial membranes and exerts broad immunomodulatory and wound-healing effects.',
    receptorActivity:
      'Signals through receptors including FPR2 and P2X7 and modulates Toll-like receptor responses; also directly permeabilises microbial membranes independent of a receptor.',
    pathwaySummary:
      'Promotes chemotaxis, angiogenesis, and re-epithelialisation while modulating inflammatory signalling (FPR2–MAPK, TLR pathways), supporting innate immunity and tissue repair.',
    fdaStatus: 'Not FDA-approved — investigational',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Treatment with LL-37 is safe and effective in enhancing healing of hard-to-heal venous leg ulcers: a randomized, placebo-controlled clinical trial', source: 'Wound Repair and Regeneration', year: 2014, model: 'human', phase: 'Phase 1/2a', pmid: '25041740', doi: '10.1111/wrr.12211' },
      { title: 'Intratumoral LL-37 in Patients with Melanoma (first-in-human) — trial registration, no publication', source: 'ClinicalTrials.gov trial registration', year: 2015, model: 'human', phase: 'Phase 1', nctId: 'NCT02225366' },
    ],
  },
  vip: {
    mechanismSummary:
      'A 28-amino-acid neuropeptide of the secretin/glucagon superfamily that acts as a neurotransmitter/neuromodulator, producing smooth-muscle relaxation, vasodilation, bronchodilation, and broad anti-inflammatory and immunoregulatory effects.',
    receptorActivity:
      'Agonist at the class-B GPCRs VPAC1 and VPAC2 (and, with lower affinity, PAC1), which are Gs-coupled.',
    pathwaySummary:
      'Receptor activation raises cAMP via adenylate cyclase/PKA, driving smooth-muscle relaxation and downregulation of pro-inflammatory cytokines with expansion of regulatory T cells.',
    fdaStatus: 'Native VIP not approved; analogue aviptadil holds Orphan Drug designation',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Inhaled Vasoactive Intestinal Peptide Exerts Immunoregulatory Effects in Sarcoidosis', source: 'Am. J. Respir. Crit. Care Med.', year: 2010, model: 'human', phase: 'Phase 2', pmid: '20442436', doi: '10.1164/rccm.200909-1451OC' },
    ],
  },

  // ── gh-secretagogue ──────────────────────────────────────────────────────
  'cjc-1295-no-dac': {
    mechanismSummary:
      'A synthetic 29-amino-acid analogue of GHRH (Modified GRF 1-29) bearing substitutions (D-Ala2, Gln8, Ala15, Leu27) that resist enzymatic degradation. It binds pituitary GHRH receptors to stimulate pulsatile GH release. Lacking the Drug Affinity Complex, it has a short (~30-min) half-life and does not bind serum albumin.',
    receptorActivity:
      'Agonist at the GHRH receptor (GHRHR), a class-B GPCR on anterior-pituitary somatotrophs; selective for GHRHR, with no activity at the ghrelin/GHS receptor.',
    pathwaySummary:
      'GHRHR activation couples to Gs, raising cAMP and activating PKA to promote GH synthesis and pulsatile release; downstream GH elevates hepatic IGF-1.',
    fdaStatus: 'Not approved — research chemical only',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  'cjc-ipamorelin-blend': {
    mechanismSummary:
      'A two-component preparation combining CJC-1295 (No DAC), a GHRH-receptor agonist, with ipamorelin, a selective ghrelin/GHS-receptor agonist. The two act on complementary pituitary pathways to produce a synergistic, pulsatile increase in GH release; it is a physical mixture, not a single entity.',
    receptorActivity:
      'CJC-1295 No DAC targets the GHRH receptor; ipamorelin selectively targets the GHS-R1a (ghrelin) receptor with minimal effect on ACTH/cortisol or prolactin.',
    pathwaySummary:
      'GHRHR signals via Gs/cAMP/PKA while GHS-R1a signals via Gq/PLC/IP3-calcium; combined activation amplifies somatotroph GH secretion.',
    fdaStatus: 'Not approved — research chemical only',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  tesamorelin: {
    mechanismSummary:
      'A synthetic 44-amino-acid GHRH(1-44) analogue stabilised by an N-terminal trans-3-hexenoyl group that resists DPP-IV degradation. It stimulates pituitary GHRH receptors to increase endogenous pulsatile GH secretion and IGF-1, reducing visceral adipose tissue in HIV-associated lipodystrophy.',
    receptorActivity:
      'Selective agonist of the GHRH receptor (GHRHR) on pituitary somatotrophs; no direct action at the ghrelin/GHS receptor.',
    pathwaySummary:
      'GHRHR engagement activates the Gs–cAMP–PKA cascade driving GH release, elevating hepatic IGF-1 and IGFBP-3.',
    fdaStatus: 'Approved — Egrifta / Egrifta SV (excess abdominal fat in HIV lipodystrophy)',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Effects of Tesamorelin (TH9507) in HIV-Infected Patients with Excess Abdominal Fat', source: 'J. Clin. Endocrinol. Metab.', year: 2010, model: 'human', phase: 'Phase 3', pmid: '20554713', doi: '10.1210/jc.2010-0490' },
    ],
  },
  sermorelin: {
    mechanismSummary:
      'A synthetic 29-amino-acid peptide corresponding to the active N-terminal fragment of human GHRH (GHRH 1-29 NH2), the shortest fully functional GHRH fragment. It binds pituitary GHRH receptors to stimulate synthesis and pulsatile secretion of endogenous growth hormone.',
    receptorActivity:
      'Agonist at the GHRH receptor (GHRHR) on anterior-pituitary somatotrophs; selective for GHRHR.',
    pathwaySummary:
      'Activates the GHRHR–Gs–cAMP–PKA pathway to trigger GH release, raising circulating IGF-1.',
    fdaStatus: 'Formerly approved — Geref (sermorelin acetate); discontinued by the sponsor in 2008, FDA approval withdrawn 2009 (not for safety or effectiveness reasons)',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'hexarelin-acetate': {
    mechanismSummary:
      'A synthetic hexapeptide GH secretagogue (examorelin), a GHRP-6 analogue with a D-2-methyl-Trp substitution conferring enhanced stability and potency. It binds the ghrelin/GHS receptor to drive potent pulsatile GH release and also engages the CD36 scavenger receptor in cardiovascular tissue.',
    receptorActivity:
      'Agonist at the GHS-R1a (ghrelin) receptor; also binds CD36 in cardiac and vascular tissue. Among GHRPs it produces the most potent acute GH release in humans.',
    pathwaySummary:
      'GHS-R1a activation signals through Gq–PLC–IP3, raising intracellular calcium in somatotrophs to drive GH secretion.',
    fdaStatus: 'Not approved — investigational / research only',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'ghrp-2-acetate': {
    mechanismSummary:
      'A synthetic hexapeptide GH secretagogue (pralmorelin) that mimics endogenous ghrelin. It binds the ghrelin/GHS receptor in the pituitary and hypothalamus to stimulate and amplify pulsatile GH release.',
    receptorActivity:
      'Agonist at the GHS-R1a (ghrelin) receptor; mildly stimulates ACTH/cortisol and prolactin at higher doses.',
    pathwaySummary:
      'GHS-R1a coupling to Gq–PLC–IP3-calcium signalling in somatotrophs drives GH secretion.',
    fdaStatus: 'Not FDA-approved; reported approved in Japan as a GH-deficiency diagnostic',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'ghrp-6-acetate': {
    mechanismSummary:
      'One of the first-described GH-releasing peptides — a synthetic hexapeptide that binds the ghrelin/GHS receptor to stimulate pulsatile GH release and strongly stimulates appetite via central ghrelin-receptor signalling.',
    receptorActivity:
      'Agonist at the GHS-R1a (ghrelin) receptor in the pituitary and hypothalamus.',
    pathwaySummary:
      'GHS-R1a activates Gq–PLC–IP3-calcium signalling to trigger GH secretion from somatotrophs.',
    fdaStatus: 'Not approved — research / investigational only',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'mk-677': {
    mechanismSummary:
      'A non-peptide, orally active, long-acting ghrelin-receptor agonist (ibutamoren) built on a spiro-indoline-piperidine scaffold. It mimics ghrelin at the GHS receptor to produce sustained increases in GH and IGF-1 without raising cortisol, owing to oral bioavailability and a long half-life.',
    receptorActivity:
      'Selective non-peptide agonist of the GHS-R1a (ghrelin) receptor; does not appreciably activate cortisol pathways.',
    pathwaySummary:
      'GHS-R1a engages Gq–PLC–IP3-calcium signalling in pituitary somatotrophs, stimulating GH release and downstream hepatic IGF-1.',
    fdaStatus: 'Not approved — investigational (discontinued); WADA-prohibited',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Oral Ghrelin Mimetic (MK-677) on Body Composition in Healthy Older Adults: A Randomized Trial', source: 'Annals of Internal Medicine', year: 2008, model: 'human', phase: 'Phase 2', pmid: '18981485', doi: '10.7326/0003-4819-149-9-200811040-00003' },
    ],
  },

  // ── nootropic-neuroactive ──────────────────────────────────────────────
  selank: {
    mechanismSummary:
      'A synthetic heptapeptide derived from the endogenous immunomodulatory peptide tuftsin, developed in Russia. It is studied as an anxiolytic/nootropic acting via modulation of monoamine and GABAergic signalling and of brain-derived neurotrophic factor (BDNF) expression.',
    receptorActivity:
      'Not a classic single-receptor ligand; reported effects include modulation of GABAergic transmission and influence on serotonin/dopamine metabolism rather than direct high-affinity agonism.',
    pathwaySummary:
      'Implicated in enkephalin-degrading-enzyme inhibition, monoamine metabolism, and BDNF/neurotrophic and immune (interleukin) signalling.',
    fdaStatus: 'Not FDA-approved; registered as a pharmaceutical in Russia',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  dsip: {
    mechanismSummary:
      'A naturally occurring nonapeptide first isolated from rabbit cerebral venous blood. Its mechanism is poorly defined; it is associated with sleep modulation, stress/neuroendocrine effects, and antioxidant activity, but no single validated receptor target is established.',
    receptorActivity:
      'No well-characterised receptor has been identified; proposed actions are diffuse and not attributable to a defined high-affinity receptor.',
    pathwaySummary:
      'Proposed involvement in sleep regulation and hypothalamic-pituitary stress-hormone modulation, but pathways remain speculative.',
    fdaStatus: 'Not approved — no approved therapeutic indication',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  dermorphin: {
    mechanismSummary:
      'A naturally occurring opioid heptapeptide originally isolated from the skin of South American Phyllomedusa frogs, notable for a D-alanine residue. It is an extremely potent and selective agonist of the µ-opioid receptor, with analgesic potency far exceeding morphine on a molar basis.',
    receptorActivity:
      'High-potency, high-selectivity agonist at the µ-opioid receptor (MOR).',
    pathwaySummary:
      'Activates µ-opioid-receptor Gi/Go signalling, inhibiting adenylate cyclase and modulating neuronal excitability to produce analgesia.',
    fdaStatus: 'Not approved — no human therapeutic use',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },

  // ── antioxidant-beauty ─────────────────────────────────────────────────
  'ghk-cu': {
    mechanismSummary:
      'The copper(II) complex of the tripeptide glycyl-L-histidyl-L-lysine, a sequence naturally present in human plasma that declines with age. It acts as a copper carrier and signalling molecule that promotes wound healing, modulates extracellular-matrix remodelling, and stimulates collagen/glycosaminoglycan synthesis.',
    receptorActivity:
      'Not a defined single-receptor ligand; functions chiefly via copper delivery and modulation of growth-factor and matrix-related signalling.',
    pathwaySummary:
      'Implicated in TGF-β and metalloproteinase/matrix-remodelling pathways, angiogenesis, and antioxidant gene expression in skin and connective tissue.',
    fdaStatus: 'Not an approved drug; widely used as a cosmetic ingredient (Copper Tripeptide-1)',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'pt-141': {
    mechanismSummary:
      'A synthetic cyclic heptapeptide analogue of α-MSH (bremelanotide), derived from a metabolite of melanotan II. It treats hypoactive sexual desire disorder by activating central melanocortin receptors involved in sexual-arousal pathways.',
    receptorActivity:
      'Non-selective melanocortin-receptor agonist active at MC1R and MC3R–MC4R; the hypothalamic MC4 receptor is considered central to its effect on sexual desire.',
    pathwaySummary:
      'Activates hypothalamic melanocortin (MC4R) signalling rather than the vascular pathways targeted by PDE5 inhibitors.',
    fdaStatus: 'Approved — Vyleesi (2019), hypoactive sexual desire disorder in premenopausal women',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Bremelanotide for Hypoactive Sexual Desire Disorder: Two Randomized Phase 3 Trials (RECONNECT)', source: 'Obstetrics & Gynecology', year: 2019, model: 'human', phase: 'Phase 3', pmid: '31599840', doi: '10.1097/AOG.0000000000003500' },
    ],
  },
  'melanotan-1': {
    mechanismSummary:
      'A synthetic 13-amino-acid analogue of α-MSH (afamelanotide). It stimulates eumelanin production in the skin independent of UV exposure, providing photoprotection.',
    receptorActivity:
      'Potent agonist of the melanocortin-1 receptor (MC1R) on melanocytes, driving melanogenesis.',
    pathwaySummary:
      'Activates MC1R–cAMP signalling, upregulating tyrosinase and eumelanin synthesis.',
    fdaStatus: 'Approved — Scenesse (2019), erythropoietic protoporphyria',
    humanTrialsConfirmed: true,
    knownStudies: [
      { title: 'Afamelanotide for Erythropoietic Protoporphyria', source: 'NEJM', year: 2015, model: 'human', phase: 'Phase 3', pmid: '26132941', doi: '10.1056/NEJMoa1411481' },
    ],
  },
  'melanotan-2': {
    mechanismSummary:
      'A synthetic cyclic analogue of α-MSH that stimulates melanogenesis (tanning) and has effects on libido and appetite. It is a non-selective melanocortin-receptor agonist.',
    receptorActivity:
      'Non-selective agonist across melanocortin receptors (MC1R, MC3R, MC4R, MC5R); MC1R activity drives pigmentation and MC4R activity underlies sexual/appetite effects.',
    pathwaySummary:
      'Activates melanocortin-receptor cAMP signalling, driving both peripheral melanogenesis (MC1R) and central MC4R-mediated effects.',
    fdaStatus: 'Not approved — regulatory warnings issued against unapproved use',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'lemon-bottle': {
    mechanismSummary:
      'A proprietary multi-ingredient injectable lipolytic ("fat-dissolving") solution whose stated actives include riboflavin (vitamin B2), lecithin, and bromelain plus botanical extracts. The marketing claim is enzymatic/emulsifying breakdown of adipocyte membranes and accelerated fat metabolism.',
    receptorActivity:
      'Not applicable — a formulation rather than a single receptor-active molecule; no defined receptor target.',
    pathwaySummary:
      'Marketed as acting via lipolysis/adipocyte-membrane disruption and fat metabolism; no rigorously established mechanism or pathway.',
    fdaStatus: 'Not approved — unapproved injectable formulation',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  glutathione: {
    mechanismSummary:
      'An endogenous tripeptide (γ-Glu-Cys-Gly) and the body’s principal intracellular antioxidant. It neutralises reactive oxygen species and serves as a cofactor for detoxification and redox enzymes.',
    receptorActivity:
      'Not a receptor ligand; an enzyme substrate/cofactor (glutathione peroxidases, S-transferases) and a direct reducing agent.',
    pathwaySummary:
      'Central to cellular redox homeostasis, the glutathione/glutathione-disulfide cycle, and phase-II detoxification pathways.',
    fdaStatus: 'OTC supplement / compounded injectable — skin-lightening use not FDA-approved',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'snap-8': {
    mechanismSummary:
      'A synthetic octapeptide (acetyl octapeptide-3), an elongated derivative of acetyl hexapeptide-3 (Argireline). It is a cosmetic "anti-wrinkle" peptide designed to reduce muscle contraction by interfering with the SNARE complex involved in neurotransmitter release.',
    receptorActivity:
      'Not a receptor agonist; competes with SNAP-25 in the SNARE complex to reduce vesicle docking and neurotransmitter release at the neuromuscular junction (proposed mechanism).',
    pathwaySummary:
      'Proposed inhibition of SNARE-complex-mediated neurotransmitter exocytosis, reducing facial-muscle contraction.',
    fdaStatus: 'Not an approved drug — topical cosmetic ingredient',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  'glow-blend-ghk': {
    mechanismSummary:
      'A blend of three peptides — TB-500 (thymosin-β4 fragment), BPC-157 (gastric pentadecapeptide), and GHK (copper tripeptide-1) — studied for skin/connective-tissue repair and aesthetic "glow" effects. It has no single combined chemical identity.',
    receptorActivity:
      'No single receptor across the mixture: TB-500 sequesters G-actin; BPC-157 modulates NO/VEGFR2 signalling; GHK acts largely through copper delivery and gene-expression modulation.',
    pathwaySummary:
      'Proposed combined angiogenic, matrix-remodelling, and tissue-repair effects (collagen/elastin via GHK, actin-mediated migration via TB-500, VEGFR2–NO via BPC-157); evidence is preclinical.',
    fdaStatus: 'Not approved — no component approved for systemic human use',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  'glow-blend-cu': {
    mechanismSummary:
      'A blend of three peptides — BPC-157, GHK-Cu (the copper-bound tripeptide), and TB-500 — for skin regeneration and wound/tissue repair. It has no single combined chemical identity.',
    receptorActivity:
      'No single receptor across the mixture: GHK-Cu delivers copper and modulates gene expression and matrix enzymes; BPC-157 modulates NO/VEGFR2 signalling; TB-500 sequesters G-actin.',
    pathwaySummary:
      'Combined proposed effects on angiogenesis, collagen/glycosaminoglycan synthesis, antioxidant/copper-dependent enzymes, and cell migration; evidence is preclinical.',
    fdaStatus: 'Not approved — no component approved for systemic human use',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  'klow-blend': {
    mechanismSummary:
      'A blend of four peptides — GHK-Cu, TB-500, BPC-157, and KPV (the α-MSH-derived anti-inflammatory tripeptide Lys-Pro-Val) — studied for combined regenerative and anti-inflammatory/gut-repair effects. It has no single combined chemical identity.',
    receptorActivity:
      'No single receptor across the mixture: KPV exerts intracellular anti-inflammatory action (NF-κB inhibition, partly via PepT1) and melanocortin-related signalling; GHK-Cu delivers copper; BPC-157 modulates NO/VEGFR2; TB-500 sequesters G-actin.',
    pathwaySummary:
      'Proposed combined anti-inflammatory (NF-κB suppression by KPV), angiogenic, matrix-remodelling, and tissue-repair effects; evidence is preclinical.',
    fdaStatus: 'Not approved — no component approved for systemic human use',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },

  // ── growth-factor-anabolic ───────────────────────────────────────────────
  hgh: {
    mechanismSummary:
      'Recombinant human growth hormone (somatropin) — a 191-amino-acid single-chain polypeptide identical to pituitary GH. It binds the growth-hormone receptor to promote growth, protein anabolism, and lipolysis, with many anabolic effects mediated indirectly through hepatic IGF-1.',
    receptorActivity:
      'Agonist of the growth-hormone receptor (GHR), a class-I cytokine receptor; receptor dimerisation activates the JAK2–STAT5 cascade.',
    pathwaySummary:
      'GHR–JAK2–STAT5 signalling drives transcription of GH-responsive genes including IGF-1, with additional MAPK and PI3K activation.',
    fdaStatus: 'Approved — many brands (Genotropin, Norditropin, etc.) for GH deficiency and growth disorders',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'igf-1-lr3': {
    mechanismSummary:
      'A synthetic 83-amino-acid analogue of human IGF-1 with a 13-residue N-terminal extension and an Arg-for-Glu substitution at position 3. These changes markedly reduce IGF-binding-protein binding, increasing free bioactivity and half-life. It activates the IGF-1 receptor to drive proliferation, protein synthesis, and anti-apoptotic signalling.',
    receptorActivity:
      'Agonist of the type-1 IGF receptor (IGF-1R), a receptor tyrosine kinase; very low IGFBP affinity increases its free active fraction; cross-reacts with the insulin receptor at high concentrations.',
    pathwaySummary:
      'IGF-1R autophosphorylation activates PI3K–Akt–mTOR and Ras–MAPK pathways, promoting growth, survival, and protein synthesis.',
    fdaStatus: 'Not approved — research / cell-culture reagent only',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },
  mgf: {
    mechanismSummary:
      'A splice variant of the IGF-1 gene (IGF-1Ec) expressed in response to mechanical loading and tissue damage; the common research peptide is the ~24-residue C-terminal E-domain fragment. It is thought to act locally to activate satellite (muscle stem) cells and promote proliferation and tissue repair.',
    receptorActivity:
      'The mature IGF-1 portion of the full splice variant binds IGF-1R; the distinct C-terminal E-domain (MGF) peptide appears to act through a separate, incompletely characterised mechanism.',
    pathwaySummary:
      'Full IGF-1Ec signals via IGF-1R–PI3K/Akt and MAPK; the E-domain MGF peptide is implicated in satellite-cell activation through a partly IGF-1R-independent pathway.',
    fdaStatus: 'Not approved — research / preclinical only',
    humanTrialsConfirmed: false,
    knownStudies: [
      { title: 'IGF-1Ec / Mechano Growth Factor — a Splice Variant of IGF-1 within the Growth Plate', source: 'PLOS ONE', year: 2013, model: 'in-vitro', phase: 'Preclinical', pmid: '24146828', doi: '10.1371/journal.pone.0076133' },
      { title: 'Mechano Growth Factor Promotes Neurogenesis in the Aging Mouse Brain', source: 'Molecular Brain', year: 2017, model: 'in-vivo', phase: 'Preclinical', pmid: '28683812', doi: '10.1186/s13041-017-0304-0' },
    ],
  },
  'peg-mgf': {
    mechanismSummary:
      'The synthetic MGF C-terminal peptide covalently conjugated to polyethylene glycol (pegylation), which extends plasma half-life from minutes to potentially days versus unmodified MGF. The biological rationale mirrors MGF — local satellite-cell activation and tissue repair — with PEG added only to improve pharmacokinetic stability.',
    receptorActivity:
      'Putatively the same target profile as MGF: the C-terminal E-domain peptide acts via a partly IGF-1R-independent, incompletely characterised mechanism; pegylation alters pharmacokinetics, not the target.',
    pathwaySummary:
      'Presumed to share MGF’s satellite-cell activation pathway; the conjugated PEG does not itself signal.',
    fdaStatus: 'Not approved — research only',
    humanTrialsConfirmed: false,
    knownStudies: [],
  },

  // ── bioregulator ───────────────────────────────────────────────────────
  'foxo4-dri': {
    mechanismSummary:
      'A synthetic D-retro-inverso (all-D, reversed-sequence) peptide based on the FOXO4 region that binds p53. As a senolytic, it disrupts the FOXO4–p53 interaction in senescent cells, releasing p53 to the mitochondria and triggering targeted apoptosis of senescent ("zombie") cells.',
    receptorActivity:
      'Not a receptor ligand; an intracellular protein–protein-interaction inhibitor that competitively blocks FOXO4 binding to p53.',
    pathwaySummary:
      'By freeing p53 from FOXO4 sequestration, it activates p53-dependent mitochondrial (intrinsic) apoptosis selectively in senescent cells.',
    fdaStatus: 'Not approved — preclinical only',
    humanTrialsConfirmed: false,
    knownStudies: [
      { title: 'Targeted Apoptosis of Senescent Cells Restores Tissue Homeostasis in Response to Chemotoxicity and Aging', source: 'Cell', year: 2017, model: 'in-vivo', phase: 'Preclinical', pmid: '28340339', doi: '10.1016/j.cell.2017.02.031' },
      { title: 'Senolytic Peptide FOXO4-DRI Selectively Removes Senescent Cells From in vitro Expanded Human Chondrocytes', source: 'Front. Bioeng. Biotechnol.', year: 2021, model: 'in-vitro', phase: 'Preclinical', pmid: '33996787', doi: '10.3389/fbioe.2021.677576' },
    ],
  },

  // ── reproductive-hormonal ────────────────────────────────────────────────
  hmg: {
    mechanismSummary:
      'Human menopausal gonadotropin (menotropin) — a purified preparation from the urine of postmenopausal women containing both FSH and LH activity (typically ~1:1), often with residual hCG. It stimulates follicular development and ovulation in assisted reproduction.',
    receptorActivity:
      'Acts via the FSH receptor and the LH/hCG receptor on gonadal cells through its FSH and LH components, respectively.',
    pathwaySummary:
      'Stimulates gonadotropin-receptor signalling driving folliculogenesis and steroidogenesis in the gonads.',
    fdaStatus: 'Approved — menotropins (e.g. Menopur), indicated for use in an Assisted Reproductive Technology (ART) cycle',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  gonadorelin: {
    mechanismSummary:
      'Synthetic gonadotropin-releasing hormone (GnRH) — a decapeptide identical to the endogenous hypothalamic hormone. Pulsatile administration stimulates pituitary release of LH and FSH; continuous exposure paradoxically downregulates the axis.',
    receptorActivity:
      'Agonist at the pituitary GnRH receptor.',
    pathwaySummary:
      'Activates GnRH-receptor signalling in the anterior pituitary, driving secretion of LH and FSH.',
    fdaStatus: 'Formerly approved as a GnRH diagnostic/therapeutic agent (Factrel, Lutrepulse); both US products discontinued',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'kisspeptin-10': {
    mechanismSummary:
      'The C-terminal decapeptide fragment of kisspeptin (encoded by KISS1), the shortest bioactive kisspeptin and a key upstream regulator of reproductive endocrine function. It stimulates hypothalamic GnRH release, in turn driving LH/FSH secretion.',
    receptorActivity:
      'Agonist at the kisspeptin receptor KISS1R (GPR54), a GPCR on GnRH neurons.',
    pathwaySummary:
      'Activates KISS1R–Gq/PLC signalling on GnRH neurons, stimulating the hypothalamic-pituitary-gonadal axis.',
    fdaStatus: 'Not FDA-approved — investigational (research and clinical trials)',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  'oxytocin-acetate': {
    mechanismSummary:
      'An endogenous cyclic nonapeptide hormone synthesised in the hypothalamus and released from the posterior pituitary. It stimulates uterine smooth-muscle contraction during labour and milk ejection during lactation, and has central roles in social/bonding behaviour.',
    receptorActivity:
      'Agonist at the oxytocin receptor (OXTR), a Gq-coupled GPCR; also has weak activity at vasopressin receptors.',
    pathwaySummary:
      'Activates OXTR–Gq/PLC signalling, raising intracellular calcium to drive smooth-muscle contraction.',
    fdaStatus: 'Approved — Pitocin (labour induction/augmentation, postpartum bleeding)',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
  hcg: {
    mechanismSummary:
      'Human chorionic gonadotropin — a placental heterodimeric glycoprotein hormone (shared α subunit, unique β subunit). It mimics LH activity, supporting the corpus luteum in pregnancy and stimulating gonadal steroidogenesis; used clinically for ovulation induction and hypogonadism.',
    receptorActivity:
      'Agonist at the LH/hCG receptor (LHCGR), a Gs-coupled GPCR on ovarian and testicular cells.',
    pathwaySummary:
      'Activates LHCGR–Gs–cAMP signalling, driving steroidogenesis (progesterone/testosterone) and, in females, ovulation and luteal support.',
    fdaStatus: 'Approved — choriogonadotropin alfa (Ovidrel) for ART and ovulation induction; urinary hCG for ovulation induction, cryptorchidism and male hypogonadotropic hypogonadism',
    humanTrialsConfirmed: true,
    knownStudies: [],
  },
};

/**
 * REGULATORY — verified regulatory resources, chemical properties, and
 * research history, keyed by canonical slug.
 *
 * VERIFICATION POLICY (stricter than the rest of this file, because these are
 * outbound links a reader will follow):
 *
 *   fdaResources — every URL below was fetched and the response confirmed to
 *   name the expected product AND active ingredient before it was recorded.
 *   Application numbers were cross-checked against the openFDA drugsfda
 *   register; NCT identifiers against the ClinicalTrials.gov v2 API. No URL
 *   here was constructed from a pattern. A compound with no approved
 *   counterpart and no registered trial has NO entry — the absence is the
 *   accurate statement about that compound, and padding it with a database
 *   *search query* (which always "resolves", and proves nothing) is exactly
 *   the failure this policy exists to prevent.
 *
 *   appearance / solubility — quoted from the FDA prescribing information for
 *   the approved product containing that active ingredient, attributed inline.
 *   Where no label statement about the substance exists, the field is omitted.
 *   No solubility figure is ever estimated, interpolated, or inferred from a
 *   structurally similar compound.
 *
 *   developmentCodes / originator — taken from the sponsor and intervention
 *   `otherNames` fields of the verified ClinicalTrials.gov records, or from the
 *   title of a verified publication. Not from recollection.
 *
 * `references` is NOT authored here: it is derived in
 * src/lib/compoundIntelligence.ts from the knownStudies entries that already
 * carry a resolved PMID or DOI, so the reference list cannot drift from the
 * verified evidence or acquire a citation nobody checked.
 */
export const REGULATORY = {
  // ── Approved counterparts: Drugs@FDA + DailyMed + a registered trial ──────
  'pt-141': {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Vyleesi (bremelanotide), NDA 210557', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=210557' },
      { kind: 'dailymed', label: 'DailyMed — Vyleesi (bremelanotide) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=8c9607a2-5b57-4a59-b159-cf196deebdd9' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT02333071, Phase 3 bremelanotide in premenopausal HSDD', url: 'https://clinicaltrials.gov/study/NCT02333071' },
    ],
  },
  tesamorelin: {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Egrifta (tesamorelin), BLA 022505', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=022505' },
      { kind: 'dailymed', label: 'DailyMed — Egrifta SV (tesamorelin) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3d783378-b02d-4f19-99dd-0fc91a042224' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT02196831, tesamorelin effects on liver fat in HIV', url: 'https://clinicaltrials.gov/study/NCT02196831' },
    ],
    appearance: 'Supplied as a sterile, white to off-white, preservative-free lyophilized powder (FDA prescribing information, Egrifta SV).',
    developmentCodes: ['TH9507'],
  },
  'melanotan-1': {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Scenesse (afamelanotide), NDA 210797', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=210797' },
      { kind: 'dailymed', label: 'DailyMed — Scenesse (afamelanotide) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=94f53286-11dd-7fbb-e053-2a95a90a7c48' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT01605136, Phase 3 afamelanotide in erythropoietic protoporphyria', url: 'https://clinicaltrials.gov/study/NCT01605136' },
    ],
    appearance: 'Afamelanotide is a white to off-white powder (FDA prescribing information, Scenesse).',
    solubility: 'Freely soluble in water (FDA prescribing information, Scenesse).',
  },
  'ss-31': {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Forzinity (elamipretide), NDA 215244', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=215244' },
      { kind: 'dailymed', label: 'DailyMed — Forzinity (elamipretide hydrochloride) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=146bf34c-76f2-48db-ac07-fb29cce2cd75' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT03098797, elamipretide in Barth syndrome', url: 'https://clinicaltrials.gov/study/NCT03098797' },
    ],
    developmentCodes: ['MTP-131', 'SS-31'],
    originator: 'Stealth BioTherapeutics',
  },
  'oxytocin-acetate': {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Pitocin (oxytocin injection), NDA 018261', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=018261' },
      { kind: 'dailymed', label: 'DailyMed — Pitocin (oxytocin injection) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=6d4b2c25-2e5d-49b5-93bc-2ae8a20916d1' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT05782816, low- versus high-dose oxytocin for labour induction', url: 'https://clinicaltrials.gov/study/NCT05782816' },
    ],
  },
  hgh: {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Genotropin (somatropin), BLA 020280', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=020280' },
      { kind: 'dailymed', label: 'DailyMed — Genotropin (somatropin) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ffebf88b-d257-4542-9808-74d9b7167765' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT01088399, somatropin in growth hormone deficiency (HypoCCS)', url: 'https://clinicaltrials.gov/study/NCT01088399' },
    ],
    appearance: 'Supplied as a sterile, white lyophilized powder for reconstitution (FDA prescribing information, Genotropin).',
  },
  hcg: {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Ovidrel (choriogonadotropin alfa), BLA 021149', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=021149' },
      { kind: 'dailymed', label: 'DailyMed — Ovidrel (choriogonadotropin alfa) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a683e58a-63ea-44b8-a326-1a99a537bcf2' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT03687606, hCG and hCG plus hMG in hypogonadotropic hypogonadism', url: 'https://clinicaltrials.gov/study/NCT03687606' },
    ],
  },
  hmg: {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Menopur (menotropins), BLA 021663', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=021663' },
      { kind: 'dailymed', label: 'DailyMed — Menopur (menotropins) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=22c8db95-c3db-1770-8086-31356fbabe35' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT02554279, Menopur in a GnRH-antagonist IVF cycle', url: 'https://clinicaltrials.gov/study/NCT02554279' },
    ],
    appearance: 'Supplied as a sterile lyophilized powder for reconstitution (FDA prescribing information, Menopur).',
  },
  'l-carnitine': {
    fdaResources: [
      { kind: 'drugs-at-fda', label: 'Drugs@FDA — Carnitor (levocarnitine), NDA 018948', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=018948' },
      { kind: 'dailymed', label: 'DailyMed — Carnitor (levocarnitine) prescribing information', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d2133bc3-9c15-48bd-8b16-b8995a6a14cd' },
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT01665092, levocarnitine in severe sepsis (RACE)', url: 'https://clinicaltrials.gov/study/NCT01665092' },
    ],
    appearance: 'Levocarnitine is a white, crystalline, hygroscopic powder (FDA prescribing information, Carnitor).',
  },

  // ── Investigational: a registered trial only. No approval record exists,
  //    so none is linked. ──────────────────────────────────────────────────
  cagrilintide: {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT06065540, Phase 3 with a cagrilintide monotherapy arm', url: 'https://clinicaltrials.gov/study/NCT06065540' },
    ],
    originator: 'Novo Nordisk',
  },
  cagrisema: {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT05567796, Phase 3 CagriSema in obesity (REDEFINE 1)', url: 'https://clinicaltrials.gov/study/NCT05567796' },
    ],
    originator: 'Novo Nordisk',
  },
  survodutide: {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT06066515, Phase 3 survodutide in overweight or obesity', url: 'https://clinicaltrials.gov/study/NCT06066515' },
    ],
    developmentCodes: ['BI 456906'],
    originator: 'Boehringer Ingelheim',
  },
  mazdutide: {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT06184568, Phase 3 mazdutide versus semaglutide (DREAMS-3)', url: 'https://clinicaltrials.gov/study/NCT06184568' },
    ],
    developmentCodes: ['IBI362'],
    originator: 'Innovent Biologics',
  },
  'ara-290': {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT02039687, ARA 290 and corneal nerve fibre density in sarcoidosis', url: 'https://clinicaltrials.gov/study/NCT02039687' },
    ],
    developmentCodes: ['ARA 290', 'pHSBP', 'cibinetide'],
    originator: 'Araim Pharmaceuticals',
  },
  'll-37': {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT02225366, intratumoral LL-37 injection in melanoma', url: 'https://clinicaltrials.gov/study/NCT02225366' },
    ],
  },
  'thymosin-alpha-1': {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT04487444, thymalfasin (thymosin alpha-1) in COVID-19', url: 'https://clinicaltrials.gov/study/NCT04487444' },
    ],
  },
  gonadorelin: {
    // No DailyMed link: the US human gonadorelin products (Factrel, Lutrepulse)
    // are discontinued, and the only current gonadorelin label on DailyMed is a
    // veterinary product. Linking it as "the prescribing label" would be wrong.
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT01976728, pulsatile gonadorelin acetate in hypogonadotropic hypogonadism', url: 'https://clinicaltrials.gov/study/NCT01976728' },
    ],
  },
  vip: {
    fdaResources: [
      { kind: 'clinical-trial', label: 'ClinicalTrials.gov — NCT04360096, inhaled aviptadil (VIP analogue) in severe COVID-19', url: 'https://clinicaltrials.gov/study/NCT04360096' },
    ],
  },
};
