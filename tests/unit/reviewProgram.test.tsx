// @vitest-environment happy-dom
/**
 * The completed-order review program's two buyer-facing surfaces (089).
 *
 * ReviewOrder is opened from the ask email with the order's lookup_token; the
 * supabase seam is mocked (same shape as referralCard.test.tsx) so a unit test
 * never touches the live client. Covered: the token gates, the submit path,
 * the refusal copy, and — the one that matters for the catalog's positioning —
 * that the form asks about FULFILMENT and says so.
 *
 * ServiceReviews renders nothing until something is approved, so the section
 * can be mounted on the catalog before the first review exists.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

const routerSeam = vi.hoisted(() => ({ token: 'tok-123' }));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(routerSeam.token ? { t: routerSeam.token } : {})],
}));

import { ReviewOrder } from '../../src/pages/ReviewOrder';
import { ServiceReviews } from '../../src/components/order/ServiceReviews';

afterEach(cleanup);
beforeEach(() => { seam.client = null; routerSeam.token = 'tok-123'; });

type RpcHandler = (args: unknown) => { data: unknown; error: unknown };

function makeClient(handlers: Record<string, RpcHandler>) {
  const rpc = vi.fn(async (name: string, args?: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  return { rpc };
}

const OPEN_PROMPT = () => ({ data: { ok: true, orderNumber: 'VSR-1042', name: 'Ada R.' }, error: null });

describe('ReviewOrder', () => {
  test('an eligible order renders the form, naming the order', async () => {
    seam.client = makeClient({ order_review_prompt: OPEN_PROMPT });
    render(<ReviewOrder />);

    expect(await screen.findByText(/How did order VSR-1042 arrive\?/)).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Fulfilment rating' })).toBeTruthy();
  });

  test('the prompt asks about FULFILMENT and says reviews describing use are not published', async () => {
    seam.client = makeClient({ order_review_prompt: OPEN_PROMPT });
    render(<ReviewOrder />);

    const copy = await screen.findByText(/packing, transit time, documentation and communication/i);
    expect(copy).toBeTruthy();
    expect(screen.getByText(/reviews describing use are not published/i)).toBeTruthy();
  });

  test('submitting sends the token, the rating and the comment, then thanks the buyer', async () => {
    const submit = vi.fn(() => ({ data: { ok: true, status: 'pending' }, error: null }));
    seam.client = makeClient({ order_review_prompt: OPEN_PROMPT, submit_order_review: submit });
    render(<ReviewOrder />);

    fireEvent.click(await screen.findByRole('radio', { name: '4 stars' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Arrived cold and well packed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      p_token: 'tok-123',
      p_rating: 4,
      p_comment: 'Arrived cold and well packed.',
    });
    expect(await screen.findByText('Thank you.')).toBeTruthy();
  });

  test('a rating is required — no rating, no RPC', async () => {
    const submit = vi.fn(() => ({ data: { ok: true }, error: null }));
    seam.client = makeClient({ order_review_prompt: OPEN_PROMPT, submit_order_review: submit });
    render(<ReviewOrder />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send feedback' }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/one to five stars/i);
  });

  test.each([
    ['not_found', /not valid/i],
    ['not_eligible', /opens a few days after delivery/i],
    ['already_reviewed', /already been reviewed/i],
  ])('a %s order shows its own plain explanation, never a crash', async (reason, pattern) => {
    seam.client = makeClient({ order_review_prompt: () => ({ data: { ok: false, reason }, error: null }) });
    render(<ReviewOrder />);

    expect(await screen.findByText(pattern)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  test('no token at all is refused without calling the RPC', async () => {
    routerSeam.token = '';
    const prompt = vi.fn(OPEN_PROMPT);
    seam.client = makeClient({ order_review_prompt: prompt });
    render(<ReviewOrder />);

    expect(await screen.findByText(/not valid/i)).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  test('a failed submit keeps the form open so the buyer can retry', async () => {
    seam.client = makeClient({
      order_review_prompt: OPEN_PROMPT,
      submit_order_review: () => ({ data: null, error: { message: 'boom' } }),
    });
    render(<ReviewOrder />);

    fireEvent.click(await screen.findByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Fulfilment rating' })).toBeTruthy();
  });
});

describe('ServiceReviews', () => {
  test('renders nothing at all when nothing is approved yet', async () => {
    seam.client = makeClient({
      public_service_reviews: () => ({ data: { rows: [], total: 0, average: null }, error: null }),
    });
    const { container } = render(<ServiceReviews />);

    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  test('renders approved feedback with the public name only — never the contact', async () => {
    seam.client = makeClient({
      public_service_reviews: () => ({
        data: {
          rows: [{ rating: 5, comment: 'Fast and well documented.', name: 'Ada R.', iso: '2026-08-20' }],
          total: 1,
          average: 4.8,
        },
        error: null,
      }),
    });
    render(<ServiceReviews />);

    expect(await screen.findByText('Fast and well documented.')).toBeTruthy();
    expect(screen.getByText(/Ada R\./)).toBeTruthy();
    expect(screen.getByText(/4\.8/)).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
  });
});
