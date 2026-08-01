/**
 * useConvertPreparedCart — the one I/O call behind "Convert to order".
 *
 * `admin_convert_prepared_cart` (083) is a SINGLE transactional verb by
 * necessity, and this hook is deliberately just as thin: it creates the order,
 * stamps the cart converted and revokes the link together, so there is no
 * window in which an order exists against a link the member could still open
 * and buy from a second time. Two RPCs from here could not promise that.
 *
 * Bounded with `rpcWithTimeout` for the same reason every other prepared-cart
 * call is: supabase-js awaits `auth.getSession()` before it reaches `fetch`, so
 * a stalled session read hangs the promise before a request is even made, and
 * `fetch` itself has no default timeout. That shipped once as a button pinned
 * on "Working…" forever. The timeout copy says the write may still have landed,
 * because aborting the client does not roll the server back — and on this path
 * "may still have landed" means "an order may exist", which the owner must
 * check rather than assume.
 *
 * All money maths are pure and live in src/lib/convertPreparedCart.ts; this
 * file does I/O only.
 */

import { useCallback, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { RPC_TIMEOUT_SECONDS, rpcWithTimeout } from '../../../lib/rpcTimeout';
import type { ConvertLine, DiscountDraft } from '../../../lib/convertPreparedCart';
import { convertDiscountPayload, convertLinesPayload } from '../../../lib/convertPreparedCart';
import { getErrorMessage } from './backend';

/**
 * What the conversion did. `already_converted` is not an error — it is the
 * guard working, and it carries the order the cart already became so the owner
 * is told what happened instead of that nothing did.
 */
export type ConvertResult =
  | { status: 'converted'; orderId: string; orderNumber: string; totalCents: number | null }
  | { status: 'already_converted'; orderId: string | null; orderNumber: string | null }
  | { status: 'not_found' }
  | { status: 'failed'; detail: string };

interface ConvertResponse {
  ok?: boolean;
  reason?: string;
  order_id?: string | null;
  order_number?: string | null;
  total_cents?: number | null;
}

export interface ConvertInput {
  cartId: string;
  buyerName: string;
  buyerContact: string;
  buyerOrganization: string | null;
  notes: string | null;
  lines: ConvertLine[];
  discount: DiscountDraft | null;
}

export function useConvertPreparedCart(): {
  converting: boolean;
  convert: (input: ConvertInput) => Promise<ConvertResult>;
} {
  const [converting, setConverting] = useState(false);

  const convert = useCallback(async (input: ConvertInput): Promise<ConvertResult> => {
    if (!supabase) return { status: 'failed', detail: 'Backend not configured.' };
    setConverting(true);
    try {
      const { data, error } = await rpcWithTimeout(
        supabase,
        'admin_convert_prepared_cart',
        {
          p_cart_id: input.cartId,
          p_buyer_name: input.buyerName,
          p_buyer_contact: input.buyerContact,
          p_buyer_organization: input.buyerOrganization,
          p_notes: input.notes,
          p_lines: convertLinesPayload(input.lines),
          p_discount: convertDiscountPayload(input.discount),
        },
        `Converting the cart did not respond within ${RPC_TIMEOUT_SECONDS}s. The order may still ` +
          'have been created — open All orders and check before trying again.',
      );

      if (error) {
        console.error('[preparedCart] admin_convert_prepared_cart failed', error);
        return { status: 'failed', detail: getErrorMessage(error) };
      }

      const body = data as ConvertResponse | null;
      if (body?.ok === true && body.order_id && body.order_number) {
        return {
          status: 'converted',
          orderId: body.order_id,
          orderNumber: body.order_number,
          totalCents: typeof body.total_cents === 'number' ? body.total_cents : null,
        };
      }
      if (body?.reason === 'already_converted') {
        return {
          status: 'already_converted',
          orderId: body.order_id ?? null,
          orderNumber: body.order_number ?? null,
        };
      }
      if (body?.reason === 'not_found') return { status: 'not_found' };

      console.error('[preparedCart] admin_convert_prepared_cart returned an unrecognised body', body);
      return { status: 'failed', detail: 'The server gave an unexpected answer. Check All orders before retrying.' };
    } catch (err) {
      console.error('[preparedCart] admin_convert_prepared_cart threw', err);
      return { status: 'failed', detail: getErrorMessage(err) };
    } finally {
      // In `finally`, so no path can leave the button stuck reading "Working…".
      setConverting(false);
    }
  }, []);

  return { converting, convert };
}
