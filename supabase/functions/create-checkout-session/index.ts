import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-04-10",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const { items, success_url, cancel_url } = await req.json();

    // Fetch product prices from DB
    const productIds = items.map((i: { product_id: string }) => i.product_id);
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price_cents, images")
      .in("id", productIds);

    if (productsError || !products) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch products" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build Stripe line_items
    const line_items = items.map((item: { product_id: string; quantity: number }) => {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) throw new Error(`Product not found: ${item.product_id}`);

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
            images: product.images?.slice(0, 1) || [],
          },
          unit_amount: product.price_cents,
        },
        quantity: item.quantity,
      };
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "AU"],
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
