// @vitest-environment happy-dom
/**
 * The archive blur must never stand in for the disclosure.
 *
 * The owner's preferred treatment for the illustrative documentation archive
 * is the landing page's blur-behind-a-seal, applied to `/documentation`,
 * `/documentation/:id`, and the product-page document slots. The risk that
 * comes with it is obvious: a blurred fake certificate with no label reads as
 * a real one that simply has not loaded.
 *
 * These tests pin that the blur and the words ship together — the veil is
 * present AND says the records are not issued, and the plain-language notice
 * still names them as illustrative placeholders.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import { ArchivePreparationVeil } from '../../src/components/documents/ArchivePreparationVeil';
import { SampleArchiveNotice } from '../../src/components/documents/SampleArchiveNotice';
import { DocumentSlot } from '../../src/components/documents/DocumentSlot';
import type { Document } from '../../src/types';

afterEach(cleanup);

const PLACEHOLDER_COA: Document = {
  id: 'doc-sample-coa',
  productAbbreviation: 'TST',
  productName: 'Test Compound',
  documentType: 'Certificate of Analysis',
  batchId: 'TST-2026-001',
  issuedDate: '2026-01-01',
  thumbnailUrl: '/docs/coa.svg',
  issuer: 'VS Research Labs QC Division',
  isSamplePlaceholder: true,
};

describe('ArchivePreparationVeil', () => {
  test('blurs its content behind a seal that says the records are not issued', () => {
    // Arrange / Act
    const { container } = render(
      <ArchivePreparationVeil>
        <p>Certificate body</p>
      </ArchivePreparationVeil>,
    );

    // Assert — the blur is applied, and it is labelled.
    expect(container.querySelector('[class*="blur-"]')).not.toBeNull();
    expect(screen.getByText(/archive in preparation/i)).toBeTruthy();
    expect(screen.getByText(/not issued records/i)).toBeTruthy();
  });

  test('renders the veiled content inert by default', () => {
    const { container } = render(
      <ArchivePreparationVeil>
        <p>Certificate body</p>
      </ArchivePreparationVeil>,
    );

    const veiled = container.querySelector('[class*="blur-"]') as HTMLElement;
    expect(veiled.getAttribute('aria-hidden')).toBe('true');
    expect(veiled.className).toContain('pointer-events-none');
  });

  test('leaves the content reachable and announced when interactive', () => {
    const { container } = render(
      <ArchivePreparationVeil interactive>
        <p>Certificate body</p>
      </ArchivePreparationVeil>,
    );

    const veiled = container.querySelector('[class*="blur-"]') as HTMLElement;
    expect(veiled.getAttribute('aria-hidden')).toBeNull();
    expect(veiled.className).not.toContain('pointer-events-none');
  });

  test('passes the content through untouched once the archive is real', () => {
    const { container } = render(
      <ArchivePreparationVeil active={false}>
        <p>Certificate body</p>
      </ArchivePreparationVeil>,
    );

    expect(container.querySelector('[class*="blur-"]')).toBeNull();
    expect(screen.queryByText(/archive in preparation/i)).toBeNull();
    expect(screen.getByText('Certificate body')).toBeTruthy();
  });
});

describe('SampleArchiveNotice', () => {
  test('states plainly that the records are not issued quality records', () => {
    render(<SampleArchiveNotice />);

    expect(screen.getByText(/not issued quality records/i)).toBeTruthy();
    expect(screen.getByText(/illustrative placeholders/i)).toBeTruthy();
  });
});

describe('DocumentSlot', () => {
  test('veils a placeholder record instead of filing it as a certificate', () => {
    // Arrange / Act
    const { container } = render(
      <MemoryRouter>
        <DocumentSlot documents={[PLACEHOLDER_COA]} />
      </MemoryRouter>,
    );

    // Assert — blurred, labelled, and not openable as a filed record.
    expect(container.querySelector('[class*="blur-"]')).not.toBeNull();
    expect(screen.getByText(/archive in preparation/i)).toBeTruthy();
    expect(screen.getByText(/not an issued record/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('still shows an unfilled slot when no record of any kind exists', () => {
    render(
      <MemoryRouter>
        <DocumentSlot documents={[]} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/awaiting upload/i).length).toBe(4);
    expect(screen.queryByText(/archive in preparation/i)).toBeNull();
  });
});
