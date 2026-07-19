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
}

/** Every study record across both datasets, tagged with its owning slug. */
function allStudies(): { slug: string; study: ProductStudy }[] {
  const records = [
    ...(generatedCompounds as unknown as StudyBearing[]),
    ...(productRecords as unknown as StudyBearing[]),
  ];
  return records.flatMap((record) =>
    (record.knownStudies ?? []).map((study) => ({ slug: record.slug, study })),
  );
}

/** `PMID: 12345678` — 1–8 digits, no prefix, no whitespace. */
const PMID_PATTERN = /^\d{1,8}$/;
/** `10.<4–9 digit registrant>/<suffix>` — the DOI handle syntax. */
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
/** A PubMed search query masquerading as a citation permalink. */
const PUBMED_SEARCH_PATTERN = /pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/;

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
});
