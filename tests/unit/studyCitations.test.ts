/**
 * Data-integrity pins for study citations.
 *
 * Every published study record on the site must either carry a resolvable
 * identifier or carry none at all. The failure modes these tests exist to
 * catch are the two that a scientific supplier cannot afford:
 *
 *   1. a malformed identifier, which links a reader to nothing;
 *   2. a PubMed *search query* standing in for a citation, which silently
 *      drifts as PubMed's index changes and can return a different paper —
 *      or no paper — than the one the title claims.
 *
 * A study with no identifier is acceptable and deliberate: several records
 * are trial-registry entries with no corresponding publication. What is not
 * acceptable is an identifier that does not resolve to the cited work.
 */
import { describe, expect, test } from 'vitest';

import generatedCompounds from '../../src/data/biopeptideCompounds.generated.json';
import productRecords from '../../src/data/products.json';
import type { ProductStudy } from '../../src/types/product';

interface StudyBearing {
  slug: string;
  knownStudies?: ProductStudy[];
  casNumber?: string;
}

/** Both datasets, unwrapped to the shape the scans below walk. */
function allRecords(): StudyBearing[] {
  return [
    ...(generatedCompounds as unknown as StudyBearing[]),
    ...(productRecords as unknown as StudyBearing[]),
  ];
}

/** Every study record across both datasets, tagged with its owning slug. */
function allStudies(): { slug: string; study: ProductStudy }[] {
  return allRecords().flatMap((record) =>
    (record.knownStudies ?? []).map((study) => ({ slug: record.slug, study })),
  );
}

/** `PMID: 12345678` — 1–8 digits, no prefix, no whitespace. */
const PMID_PATTERN = /^\d{1,8}$/;
/** `10.<4–9 digit registrant>/<suffix>` — the DOI handle syntax. */
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
/** A PubMed search query masquerading as a citation permalink. */
const PUBMED_SEARCH_PATTERN = /pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/;
/** `NCT` followed by exactly 8 digits — the ClinicalTrials.gov identifier. */
const NCT_PATTERN = /^NCT\d{8}$/;

/**
 * A note asserting a measured result: any digit, or a comparative operator
 * that only appears in quantitative prose. Deliberately broad — a false
 * positive costs one citation, a false negative ships an unsourced number.
 */
const QUANTITATIVE_NOTE_PATTERN = /[\d×%]|\bfold\b|\bp\s*[<>=]/i;

function hasResolvableIdentifier(study: ProductStudy): boolean {
  return Boolean(study.pmid || study.doi || study.nctId);
}

/**
 * Citations the PubMed verification pass found to be fabricated. Pinned by the
 * pair a reader would use to look the paper up — journal and year — because a
 * reworded title must not let the same phantom source back in.
 */
const RETRACTED_CITATIONS: { slug: string; source: string; year: number }[] = [
  { slug: 'bpc157-5mg', source: 'Biochemical Pharmacology', year: 2019 },
  { slug: 'bpc157-5mg', source: 'Muscle & Nerve', year: 2014 },
  { slug: 'semaglutide-5mg', source: 'Journal of Neuroinflammation', year: 2022 },
  { slug: 'tirzepatide-10mg', source: 'Molecular Metabolism', year: 2020 },
  { slug: 'thymosin-alpha-1', source: 'Antiviral Therapy', year: 2009 },
  { slug: 'ipamorelin-5mg', source: 'Journal of Pharmacology and Experimental Therapeutics', year: 2005 },
];

describe('study citation identifiers', () => {
  test('every PMID is a bare numeric PubMed identifier', () => {
    // Arrange
    const withPmid = allStudies().filter(({ study }) => study.pmid !== undefined);

    // Act
    const malformed = withPmid.filter(({ study }) => !PMID_PATTERN.test(study.pmid ?? ''));

    // Assert
    expect(malformed.map((m) => `${m.slug}: ${m.study.pmid}`)).toEqual([]);
    expect(withPmid.length).toBeGreaterThan(0);
  });

  test('every DOI uses the bare 10.<registrant>/<suffix> handle syntax', () => {
    // Arrange
    const withDoi = allStudies().filter(({ study }) => study.doi !== undefined);

    // Act
    const malformed = withDoi.filter(({ study }) => !DOI_PATTERN.test(study.doi ?? ''));

    // Assert
    expect(malformed.map((m) => `${m.slug}: ${m.study.doi}`)).toEqual([]);
    expect(withDoi.length).toBeGreaterThan(0);
  });

  test('no study cites a PubMed search query in place of a permalink', () => {
    // Arrange
    const studies = allStudies();

    // Act
    const searchQueries = studies.filter(({ study }) =>
      PUBMED_SEARCH_PATTERN.test(study.url ?? ''),
    );

    // Assert
    expect(searchQueries.map((s) => `${s.slug}: ${s.study.url}`)).toEqual([]);
  });

  test('a study carrying a DOI also carries the PMID it was resolved from', () => {
    // Arrange — both identifiers are written together during resolution, so a
    // DOI standing alone means it was sourced without PubMed corroboration.
    const studies = allStudies();

    // Act
    const doiWithoutPmid = studies.filter(({ study }) => study.doi && !study.pmid);

    // Assert
    expect(doiWithoutPmid.map((s) => `${s.slug}: ${s.study.doi}`)).toEqual([]);
  });

  test('every NCT identifier is a bare NCT######## registry number', () => {
    // Arrange
    const withNct = allStudies().filter(({ study }) => study.nctId !== undefined);

    // Act
    const malformed = withNct.filter(({ study }) => !NCT_PATTERN.test(study.nctId ?? ''));

    // Assert
    expect(malformed.map((m) => `${m.slug}: ${m.study.nctId}`)).toEqual([]);
    expect(withNct.length).toBeGreaterThan(0);
  });
});

describe('no quantitative claim without a resolvable source', () => {
  // This is the regression that matters most. A fabricated study is caught by
  // review; an *orphaned finding* — a measured number whose source was removed
  // or never existed — reads as corroborated and is not. So the observed
  // bullets and the identifier rise and fall together.

  test('a study with observed findings always carries pmid, doi, or nctId', () => {
    // Arrange
    const withNotes = allStudies().filter(({ study }) => (study.notes ?? []).length > 0);

    // Act
    const unsourced = withNotes.filter(({ study }) => !hasResolvableIdentifier(study));

    // Assert
    expect(unsourced.map((s) => `${s.slug}: ${s.study.title}`)).toEqual([]);
    expect(withNotes.length).toBeGreaterThan(0);
  });

  test('an identifier-free study asserts no quantitative result', () => {
    // Arrange — identifier-free records are legitimate (trial registrations
    // awaiting publication), but they may not carry measured claims.
    const identifierFree = allStudies().filter(({ study }) => !hasResolvableIdentifier(study));

    // Act
    const quantitative = identifierFree.flatMap(({ slug, study }) =>
      (study.notes ?? [])
        .filter((note) => QUANTITATIVE_NOTE_PATTERN.test(note))
        .map((note) => `${slug}: ${note}`),
    );

    // Assert
    expect(quantitative).toEqual([]);
  });
});

describe('citations removed by the PubMed verification pass', () => {
  test.each(RETRACTED_CITATIONS)(
    'no study on $slug cites $source $year',
    ({ slug, source, year }) => {
      // Arrange
      const studies = allStudies();

      // Act
      const survivors = studies.filter(
        (entry) =>
          entry.slug === slug && entry.study.source === source && entry.study.year === year,
      );

      // Assert
      expect(survivors.map((s) => s.study.title)).toEqual([]);
    },
  );

  test('no study anywhere reproduces the fabricated UCP-1 magnitude', () => {
    // Arrange — the quantitative note travelled with its phantom source; if it
    // reappears under a different citation, the transfer this pass forbids has
    // happened.
    const studies = allStudies();

    // Act
    const orphaned = studies.flatMap(({ slug, study }) =>
      (study.notes ?? []).filter((note) => note.includes('2.3×')).map((note) => `${slug}: ${note}`),
    );

    // Assert
    expect(orphaned).toEqual([]);
  });
});

describe('trial registrations link to their ClinicalTrials.gov record', () => {
  test.each([
    { slug: 'ara-290', nctId: 'NCT02039687' },
    { slug: 'll-37', nctId: 'NCT02225366' },
  ])('$slug cites $nctId as a registration, not a publication', ({ slug, nctId }) => {
    // Arrange
    const studies = allStudies().filter((entry) => entry.slug === slug);

    // Act
    const registration = studies.find((entry) => entry.study.nctId === nctId);

    // Assert
    expect(registration).toBeDefined();
    expect(registration?.study.source).toMatch(/trial registration/i);
    // The identifier must not be buried in free text where it cannot resolve.
    expect(registration?.study.source).not.toContain(nctId);
  });
});

describe('stored chemistry specifications', () => {
  test('igf-1-lr3 carries no CAS number', () => {
    // Arrange — the previously stored CAS resolved to an unrelated ionizable
    // lipid, not the 83-residue protein, so the row must simply not render.
    const record = allRecords().find((r) => r.slug === 'igf-1-lr3');

    // Act
    const cas = record?.casNumber;

    // Assert
    expect(record).toBeDefined();
    expect(cas ?? '').toBe('');
  });
});
