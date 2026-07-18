/**
 * Unit tests for src/lib/pubchem.ts — pubchemImageUrl().
 *
 * The module builds a PubChem PUG REST image URL. It NEVER fetches — it only
 * composes a string — so these tests need no network stub. They pin the two
 * resolution branches (curated CID vs. name fallback), the size option, and
 * that the substance name is URL-encoded so peptide names with spaces / Greek
 * letters produce a valid URL rather than rendering the wrong molecule.
 */
import { describe, expect, test } from 'vitest';
import { pubchemImageUrl, PUBCHEM_CID_BY_NAME } from '../../src/lib/pubchem';

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';

describe('pubchemImageUrl', () => {
  test('uses the curated CID when the substance is in the map', () => {
    expect(pubchemImageUrl('Retatrutide')).toBe(
      `${BASE}/cid/171390338/PNG?record_type=2d&image_size=large`,
    );
  });

  test('is case- and whitespace-insensitive on the CID lookup', () => {
    expect(pubchemImageUrl('  RETATRUTIDE  ')).toBe(
      `${BASE}/cid/171390338/PNG?record_type=2d&image_size=large`,
    );
  });

  test('falls back to name resolution when no CID is curated', () => {
    expect(pubchemImageUrl('Aspirin')).toBe(
      `${BASE}/name/Aspirin/PNG?record_type=2d&image_size=large`,
    );
  });

  test('URL-encodes a name with spaces', () => {
    expect(pubchemImageUrl('Copper Peptide')).toBe(
      `${BASE}/name/Copper%20Peptide/PNG?record_type=2d&image_size=large`,
    );
  });

  test('honors the small size option', () => {
    expect(pubchemImageUrl('Aspirin', { size: 'small' })).toContain('image_size=small');
  });

  test('defaults to the large size', () => {
    expect(pubchemImageUrl('Aspirin', {})).toContain('image_size=large');
  });

  test('resolves a Greek-letter peptide name by curated CID', () => {
    // "thymosin α-1" is a map key — verifies the trim+lowercase key path hits.
    expect(pubchemImageUrl('Thymosin α-1')).toBe(
      `${BASE}/cid/16130571/PNG?record_type=2d&image_size=large`,
    );
  });
});

describe('PUBCHEM_CID_BY_NAME', () => {
  test('keys are already lowercased so the lookup can normalize the input', () => {
    for (const key of Object.keys(PUBCHEM_CID_BY_NAME)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});
