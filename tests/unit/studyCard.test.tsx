// @vitest-environment happy-dom
/**
 * StudyCard citation affordance.
 *
 * The external-link control existed before any study had an identifier, so it
 * never rendered. These tests pin both halves of the contract now that PMIDs
 * and DOIs exist: a resolvable identifier produces a real permalink, and an
 * unresolved study produces no link at all rather than a dead one.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { StudyCard, studyCitationHref } from '../../src/components/catalog/intelligence/StudyCard';
import type { ProductStudy } from '../../src/types/product';

afterEach(cleanup);

function makeStudy(overrides: Partial<ProductStudy> = {}): ProductStudy {
  return {
    title: 'A representative published study',
    source: 'Journal of Test Research',
    year: 2024,
    model: 'human',
    phase: 'Phase 2',
    ...overrides,
  };
}

function renderCard(study: ProductStudy) {
  render(<StudyCard study={study} index={0} />);
  return screen.queryByRole('link', { name: /open study source/i });
}

describe('studyCitationHref', () => {
  test('builds a PubMed permalink from a PMID', () => {
    // Arrange
    const study = makeStudy({ pmid: '37366315' });

    // Act
    const href = studyCitationHref(study);

    // Assert
    expect(href).toBe('https://pubmed.ncbi.nlm.nih.gov/37366315/');
  });

  test('builds a doi.org resolver link when only a DOI is present', () => {
    // Arrange
    const study = makeStudy({ doi: '10.1056/NEJMoa2301972' });

    // Act
    const href = studyCitationHref(study);

    // Assert
    expect(href).toBe('https://doi.org/10.1056/NEJMoa2301972');
  });

  test('prefers the PMID permalink when both identifiers are present', () => {
    // Arrange
    const study = makeStudy({ pmid: '37366315', doi: '10.1056/NEJMoa2301972' });

    // Act
    const href = studyCitationHref(study);

    // Assert
    expect(href).toBe('https://pubmed.ncbi.nlm.nih.gov/37366315/');
  });

  test('returns null when the study carries no identifier or url', () => {
    // Arrange
    const study = makeStudy();

    // Act
    const href = studyCitationHref(study);

    // Assert
    expect(href).toBeNull();
  });
});

describe('StudyCard citation link', () => {
  test('renders a PubMed permalink when the study has a PMID', () => {
    // Arrange
    const study = makeStudy({ pmid: '37366315' });

    // Act
    const link = renderCard(study);

    // Assert
    expect(link?.getAttribute('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/37366315/');
  });

  test('renders a doi.org link when the study has only a DOI', () => {
    // Arrange
    const study = makeStudy({ doi: '10.1016/j.cmet.2015.02.009' });

    // Act
    const link = renderCard(study);

    // Assert
    expect(link?.getAttribute('href')).toBe('https://doi.org/10.1016/j.cmet.2015.02.009');
  });

  test('renders the explicit url when no identifier was resolved', () => {
    // Arrange
    const study = makeStudy({ url: 'https://www.nejm.org/doi/10.1056/NEJMoa2032183' });

    // Act
    const link = renderCard(study);

    // Assert
    expect(link?.getAttribute('href')).toBe('https://www.nejm.org/doi/10.1056/NEJMoa2032183');
  });

  test('renders no link at all for an unresolved study', () => {
    // Arrange — trial-registry records with no publication stay link-free.
    const study = makeStudy();

    // Act
    const link = renderCard(study);

    // Assert
    expect(link).toBeNull();
  });

  test('keeps the meta band intact alongside the citation link', () => {
    // Arrange
    const study = makeStudy({ pmid: '37366315' });

    // Act
    renderCard(study);

    // Assert
    expect(screen.getByText('2024')).toBeDefined();
    expect(screen.getByText('Human Study')).toBeDefined();
    expect(screen.getByText('Journal of Test Research')).toBeDefined();
    expect(screen.getByText('Phase 2')).toBeDefined();
  });
});
