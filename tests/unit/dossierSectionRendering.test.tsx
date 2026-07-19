// @vitest-environment happy-dom
/**
 * The new dossier sections must appear only when they have something to say.
 *
 * `ReferenceList` and `FdaResourceList` are the two components that put
 * outbound links in front of a reader, so they carry the strictest contract in
 * the dossier: render the evidence, or render nothing. An empty list must not
 * produce a heading, an empty row, or a bare bullet — any of which would read
 * as "the data failed to load" instead of "no such evidence exists".
 *
 * These tests exercise the components directly rather than the overlay, which
 * mounts a portal, a focus trap, and the cart store. The overlay's own
 * contribution — deciding *whether* to mount them — is pinned by the
 * `has*` selectors in dossierReferenceSections.test.ts.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { ReferenceList } from '../../src/components/catalog/intelligence/ReferenceList';
import { FdaResourceList } from '../../src/components/catalog/intelligence/FdaResourceList';
import type { CompoundReference, FdaResource } from '../../src/types/product';

afterEach(cleanup);

const REFERENCE: CompoundReference = {
  citation: 'Triple-Hormone-Receptor Agonist Retatrutide for Obesity. NEJM, 2023.',
  pmid: '37366315',
  doi: '10.1056/NEJMoa2301972',
};

const RESOURCE: FdaResource = {
  kind: 'drugs-at-fda',
  label: 'Drugs@FDA — Ozempic (semaglutide), NDA 209637',
  url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=209637',
};

describe('ReferenceList', () => {
  test('renders nothing when the compound has no references', () => {
    // Arrange / Act
    const { container } = render(<ReferenceList references={[]} />);

    // Assert
    expect(container.innerHTML).toBe('');
  });

  test('renders the citation and links it by its most permanent identifier', () => {
    // Arrange / Act
    render(<ReferenceList references={[REFERENCE]} />);

    // Assert — PMID outranks the DOI
    expect(screen.getByText(REFERENCE.citation)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Open reference/ });
    expect(link.getAttribute('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/37366315/');
  });

  test('surfaces the identifier so the citation is checkable without clicking', () => {
    render(<ReferenceList references={[REFERENCE]} />);
    expect(screen.getByText('PMID 37366315')).toBeTruthy();
  });

  test('falls back to the DOI label when no PMID was resolved', () => {
    render(<ReferenceList references={[{ citation: 'A paper.', doi: '10.1/abc' }]} />);
    expect(screen.getByText('DOI 10.1/abc')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open reference/ }).getAttribute('href'))
      .toBe('https://doi.org/10.1/abc');
  });

  test('renders a reference with no identifier as text, never as a broken link', () => {
    // Arrange / Act — the data model forbids this; the guard is the safety net
    render(<ReferenceList references={[{ citation: 'An unverified claim.' }]} />);

    // Assert
    expect(screen.getByText('An unverified claim.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('opens external references safely in a new context', () => {
    render(<ReferenceList references={[REFERENCE]} />);
    const link = screen.getByRole('link', { name: /Open reference/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('FdaResourceList', () => {
  test('renders nothing when no regulatory resource was verified', () => {
    // Arrange / Act
    const { container } = render(<FdaResourceList resources={[]} />);

    // Assert — absence is the accurate statement; it gets no chrome
    expect(container.innerHTML).toBe('');
  });

  test('renders the label and links the verified record', () => {
    // Arrange / Act
    render(<FdaResourceList resources={[RESOURCE]} />);

    // Assert
    expect(screen.getByText(RESOURCE.label)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe(RESOURCE.url);
  });

  test('names the source register so the reader knows what they are opening', () => {
    render(<FdaResourceList resources={[
      RESOURCE,
      { kind: 'dailymed', label: 'DailyMed — Ozempic', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=abc' },
      { kind: 'clinical-trial', label: 'CT.gov — NCT03548935', url: 'https://clinicaltrials.gov/study/NCT03548935' },
    ]} />);

    expect(screen.getByText('Drugs@FDA')).toBeTruthy();
    expect(screen.getByText('DailyMed')).toBeTruthy();
    expect(screen.getByText('ClinicalTrials.gov')).toBeTruthy();
  });

  test('opens regulatory records safely in a new context', () => {
    render(<FdaResourceList resources={[RESOURCE]} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
