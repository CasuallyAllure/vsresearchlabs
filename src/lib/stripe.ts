import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './supabase';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

interface CheckoutItem {
  product_id: string;
  quantity: number;
}

export async function createCheckoutSession(
  items: CheckoutItem[],
  successUrl: string,
  cancelUrl: string
) {
  // Call the Supabase Edge Function
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: {
      items,
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  });

  if (error) throw error;

  // Redirect to Stripe Checkout
  const stripe = await stripePromise;
  if (!stripe) throw new Error('Stripe failed to load');

  window.location.href = data.url;
}
