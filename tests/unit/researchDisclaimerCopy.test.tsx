// @vitest-environment happy-dom
/**
 * Research-use (RUO) disclaimer coverage.
 *
 * Audit finding (docs/RESEARCH_CONTENT_SEPARATION_BLUEPRINT.md §3.6): three
 * user-facing surfaces carried no research-use notice at all — /cart (which
 * silently submits the stored attestation), /track (the highest-traffic
 * post-purchase page), and the cart drawer's confirm line understated what
 * the entry gate actually collected.
 *
 * These tests pin the disclaimer as RENDERED behaviour on each surface, and
 * pin the substance of the canonical wordings in siteConfig.compliance so a
 * future edit cannot quietly drop "not for human use", "veterinary", or the
 * 21+ element.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { siteConfig } from '../../src/config';
import { useCart } from '../../src/hooks/useCart';
import { CartDrawer } from '../../src/layout/CartDrawer';
import { GlobalFooter } from '../../src/layout/GlobalFooter';
import { TrackOrder } from '../../src/pages/TrackOrder';
import { makeProduct } from '../fixtures/product';

// The drawer's inquiry form mounts Turnstile, which injects a remote script
// tag the offline test environment refuses to load. Stubbed so the noise does
// not obscure the assertions.
vi.mock('../../src/components/security/Turnstile', () => ({
  Turnstile: () => null,
}));

afterEach(() => {
  cleanup();
  useCart.setState({ items: [], coupons: [] });
});

const { compliance } = siteConfig;

/** Case-insensitive whole-document text match, ignoring element boundaries. */
function documentText(): string {
  return document.body.textContent ?? '';
}

describe('siteConfig.compliance canonical wordings', () => {
  test('fullLine states research-use, human, and veterinary', () => {
    // Arrange / Act
    const line = compliance.fullLine.toLowerCase();

    // Assert
    expect(line).toContain('research');
    expect(line).toContain('human');
    expect(line).toContain('veterinary');
  });

  test('attestationLine claims exactly what DisclaimerGate collects — 21+, research-only, not for human or veterinary use', () => {
    // The gate (src/components/brand/DisclaimerGate.tsx) collects two ticks:
    // "I am 21 years of age or older" and "purchases are for research only
    // and not for human or animal consumption". Any surface restating that
    // attestation must not claim MORE than was actually collected.
    const line = compliance.attestationLine.toLowerCase();

    expect(line).toContain('21');
    expect(line).toContain('research');
    expect(line).toContain('not for human');
    expect(line).toContain('veterinary');
  });

  test('attestationRestatement carries the same three elements in second person', () => {
    const line = compliance.attestationRestatement.toLowerCase();

    expect(line).toContain('21');
    expect(line).toContain('research');
    expect(line).toContain('not for human');
    expect(line).toContain('veterinary');
    // Second-person: it addresses the buyer rather than speaking as them.
    expect(line).toContain('you');
  });

  test('internalLine is admin-facing and makes no buyer-facing use claim', () => {
    expect(compliance.internalLine.toLowerCase()).toContain('internal');
  });

  test('specimenLines keep the two-line vial etching intact', () => {
    expect(compliance.specimenLines[0].toLowerCase()).toContain('research use only');
    expect(compliance.specimenLines[1].toLowerCase()).toContain('not for human');
  });
});

describe('/track — post-purchase disclaimer coverage', () => {
  test('renders the full research-use disclaimer on the status-lookup view', () => {
    // Arrange / Act
    render(
      <MemoryRouter initialEntries={['/track']}>
        <TrackOrder />
      </MemoryRouter>,
    );

    // Assert
    expect(screen.getByText(compliance.fullLine)).toBeTruthy();
  });

  test('renders the disclaimer on the token-gated invoice view too', () => {
    render(
      <MemoryRouter initialEntries={['/track?t=abc123']}>
        <TrackOrder />
      </MemoryRouter>,
    );

    expect(screen.getByText(compliance.fullLine)).toBeTruthy();
  });
});

describe('CartDrawer — confirmation line matches the gate attestation', () => {
  test('renders the 21+/research-only/not-for-human attestation, not the old weaker line', () => {
    // Arrange — the confirm line lives on the drawer's inquiry form, which is
    // only reachable with a non-empty cart.
    useCart.setState({
      items: [{ product: makeProduct({ name: 'BPC-157 — 10mg' }), quantity: 1 }],
      coupons: [],
    });
    render(
      <MemoryRouter>
        <CartDrawer open onClose={() => {}} />
      </MemoryRouter>,
    );

    // Act
    fireEvent.click(screen.getByRole('button', { name: /review & send inquiry/i }));

    // Assert — the shipped wording is the config value...
    expect(screen.getByText(compliance.attestationLine)).toBeTruthy();
    // ...and the pre-fix wording, which omitted "not for human use" and the
    // 21+ element the gate required, is gone.
    expect(documentText()).not.toContain('I confirm I’m a real person');
    expect(documentText()).not.toContain("I confirm I'm a real person");
  });
});

describe('GlobalFooter — legibility of the compliance notice', () => {
  test('renders the footer research-use line at the same opacity as the copyright line', () => {
    // Arrange / Act — the notice previously rendered at text-ink/30, too
    // faint to read; it must sit at the footer's secondary-text level.
    render(
      <MemoryRouter>
        <GlobalFooter />
      </MemoryRouter>,
    );

    // Assert
    const line = screen.getByText(compliance.footerLine);
    expect(line.className).toContain('text-ink/45');
    expect(line.className).not.toContain('text-ink/30');
  });
});
