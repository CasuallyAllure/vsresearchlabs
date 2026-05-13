import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-04-10",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

Deno.serve(async (req: Request) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, {
      status: 400,
    });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Get line items from the session
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    // Calculate total
    const totalCents = lineItems.data.reduce(
      (sum, item) => sum + (item.amount_total || 0),
      0
    );

    // Insert order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        stripe_session_id: session.id,
        customer_email: session.customer_details?.email || "",
        customer_name: session.customer_details?.name || null,
        shipping_address: session.shipping_details?.address || null,
        status: "paid",
        total_cents: totalCents,
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("Failed to insert order:", orderError);
      return new Response("Failed to insert order", { status: 500 });
    }

    // Insert order items
    const orderItems = lineItems.data.map((item) => ({
      order_id: order.id,
      product_id: item.price?.product as string,
      quantity: item.quantity || 1,
      price_cents: item.amount_total || 0,
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItems);

    if (itemsError) {
      console.error("Failed to insert order items:", itemsError);
    }

    // Send confirmation email via Resend
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "VS Research Labs <orders@vsresearchlabs.com>",
          to: session.customer_details?.email,
          subject: `Order Confirmation — ${order.id}`,
          html: `
            <h1>Thank you for your order, ${session.customer_details?.name || "Researcher"}!</h1>
            <p>Order ID: ${order.id}</p>
            <p>Total: $${(totalCents / 100).toFixed(2)}</p>
            <hr />
            <p><em>For Research Purposes Only — Not for Human Use</em></p>
          `,
        }),
      });
    } catch (emailError) {
      console.error("Failed to send confirmation email:", emailError);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
