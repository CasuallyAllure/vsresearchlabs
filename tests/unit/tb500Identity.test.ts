/**
 * TB-500 identity guard.
 *
 * "TB-500" is genuinely ambiguous in the research-supply market. Two
 * doping-control analyses of commercial TB-500 material (PMID 23084823,
 * 22962027) found it to be Ac-LKKTETQ — a seven-residue actin-binding
 * fragment — while CAS 77591-33-4 / MW 4963.50 describe full-length
 * 43-residue thymosin beta-4. Those are different molecules.
 *
 * The catalog previously asserted the full-length identifiers on the
 * standalone product while its own blend records described TB-500 as a
 * "thymosin-beta4-related fragment" — the dataset contradicted itself.
 *
 * Until a lot-specific certificate of analysis establishes what actually
 * ships, the product states the relationship and the ambiguity rather than
 * a molecular identity it cannot substantiate. These tests pin that: a
 * specification sheet may omit a field, but it may not publish a value for
 * the wrong molecule.
 *
 * If a COA later confirms the supplied species, restoring the matching
 * identifiers is the correct change — and this suite should be updated in
 * the same commit, deliberately.
 */
import { describe, expect, test } from 'vitest';
import products from '../../src/data/products.json';

interface CatalogRecord {
  slug?: string;
  name?: string;
  casNumber?: string;
  molecularWeight?: string;
  laymanSummary?: string;
  longDescription?: string;
  shortDescription?: string;
  mechanismSummary?: string;
}

const TB500 = (products as CatalogRecord[]).find((p) => p.slug === 'tb500-5mg');

/** Identifiers that belong to full-length thymosin beta-4, not the fragment. */
const FULL_LENGTH_CAS = '77591-33-4';
const FULL_LENGTH_MW = '4963';

describe('TB-500 molecular identity', () => {
  test('the record exists', () => {
    expect(TB500).toBeDefined();
  });

  test('does not publish the full-length thymosin beta-4 CAS number', () => {
    expect(TB500?.casNumber ?? '').not.toContain(FULL_LENGTH_CAS);
  });

  test('does not publish the full-length thymosin beta-4 molecular weight', () => {
    expect(TB500?.molecularWeight ?? '').not.toContain(FULL_LENGTH_MW);
  });

  test('discloses that supplied material is commonly the actin-binding fragment', () => {
    // Arrange — the disclosure may live in either customer-facing register.
    const prose = `${TB500?.laymanSummary ?? ''} ${TB500?.longDescription ?? ''}`;

    // Assert — the fragment sequence is named, not merely alluded to.
    expect(prose).toContain('Ac-LKKTETQ');
    expect(prose.toLowerCase()).toContain('fragment');
  });

  test('does not claim the product IS thymosin beta-4', () => {
    const prose = [
      TB500?.laymanSummary,
      TB500?.longDescription,
      TB500?.shortDescription,
      TB500?.mechanismSummary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // "a synthetic form of thymosin b4" / "analogue of ... thymosin b4"
    // assert an identity the catalog cannot substantiate per lot.
    expect(prose).not.toContain('synthetic form of **thymosin');
    expect(prose).not.toContain('synthetic thymosin β4 analogue');
    expect(prose).not.toContain('synthetic analogue of the naturally occurring peptide thymosin');
  });
});
