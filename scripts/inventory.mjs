#!/usr/bin/env node
/**
 * inventory.mjs — terminal read/receive access to live inventory.
 *
 *   node scripts/inventory.mjs stock [query]      what's in stock, per dose
 *   node scripts/inventory.mjs low                doses at/below their reorder point
 *   node scripts/inventory.mjs receive <sku> <dose> <qty> [--set]
 *
 * Auth: signs in as the dedicated bot admin (INVENTORY_BOT_EMAIL/PASSWORD in
 * .env.local) exactly as the browser does. The write RPC `import_inventory` is
 * gated on is_admin(), which reads auth.uid() — a service-role key has no
 * auth.uid() and would be rejected, so a real admin session is required.
 *
 * Every write goes through `import_inventory`, the same RPC the admin UI and
 * CSV importer call, so stock_movements and the audit log stay honest.
 *
 * Availability wording mirrors src/lib/productOverrides.ts (isVariantPublic /
 * has24hrSupply). Keep the two in sync — if this file disagrees with the
 * storefront, the storefront is right.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;

/** import_inventory sets on_hand ABSOLUTELY; receiving is additive, so we read
 *  the current value and send current+qty. Single-operator shop — no locking. */
const RECEIVE_IS_ADDITIVE = true;

// ── env ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  for (const file of ['.env', '.env.local']) {
    let raw;
    try {
      raw = readFileSync(`${ROOT}${file}`, 'utf8');
    } catch {
      continue; // optional
    }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m) continue;
      env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'INVENTORY_BOT_EMAIL', 'INVENTORY_BOT_PASSWORD'];
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing in .env/.env.local: ${missing.join(', ')}`);
  process.exit(1);
}

// ── catalog names (SKU → product name) ───────────────────────────────────────

function loadNames() {
  const names = {};
  for (const file of ['../src/data/products.json', '../src/data/biopeptideCompounds.generated.json']) {
    let list;
    try {
      list = require(file);
    } catch {
      continue;
    }
    for (const p of Array.isArray(list) ? list : []) {
      if (p?.sku && p?.name) names[p.sku] = p.name;
    }
  }
  return names;
}

// ── availability rule — mirrors src/lib/productOverrides.ts ──────────────────

const has24hrSupply = (v) => v.on_hand > 0 || v.inbound_units > 0;

function isPublic(v) {
  if (v.hidden) return false;
  if (v.price_cents != null) return true;
  return v.on_hand > 0 || v.inbound_units > 0 || v.lead_days != null;
}

function statusOf(v) {
  if (!isPublic(v)) return 'HIDDEN';
  return has24hrSupply(v) ? '24hr' : 'sourced';
}

const usd = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

// ── supabase ─────────────────────────────────────────────────────────────────

async function signIn() {
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: env.INVENTORY_BOT_EMAIL,
    password: env.INVENTORY_BOT_PASSWORD,
  });
  if (error) throw new Error(`Bot admin sign-in failed: ${error.message}`);
  return supabase;
}

/** Per-dose rows. Prefers the table (has reorder_at/cost); falls back to the
 *  public view if RLS ever denies the table to this role. */
async function fetchVariants(supabase) {
  const table = await supabase
    .from('product_variant_stock')
    .select('sku, dose, on_hand, inbound_units, price_cents, lead_days, hidden, reorder_at')
    .order('sku');
  if (!table.error) return table.data;

  const view = await supabase
    .from('public_variant_overrides')
    .select('sku, dose, on_hand, inbound_units, price_cents, lead_days, hidden')
    .order('sku');
  if (view.error) throw new Error(`Could not read inventory: ${view.error.message}`);
  return view.data.map((r) => ({ ...r, reorder_at: null }));
}

// ── commands ─────────────────────────────────────────────────────────────────

function printRows(rows, names) {
  if (!rows.length) {
    console.log('No matching doses.');
    return;
  }
  const line = (r) => {
    const name = names[r.sku] ?? r.sku;
    const inbound = r.inbound_units > 0 ? ` +${r.inbound_units} inbound` : '';
    const lead = r.lead_days != null ? ` lead ${r.lead_days}d` : '';
    return [
      statusOf(r).padEnd(8),
      `${name} ${r.dose}`.padEnd(30),
      `on hand ${String(r.on_hand).padStart(3)}${inbound}`.padEnd(22),
      usd(r.price_cents).padStart(8),
      lead,
      `  ${r.sku}`,
    ].join(' ');
  };
  for (const r of rows) console.log(line(r));

  const fast = rows.filter((r) => isPublic(r) && has24hrSupply(r)).length;
  const sourced = rows.filter((r) => isPublic(r) && !has24hrSupply(r)).length;
  const hidden = rows.filter((r) => !isPublic(r)).length;
  console.log(`\n${rows.length} doses — ${fast} shipping in 24hr, ${sourced} sourced (7–10 days), ${hidden} hidden from catalog`);
}

async function cmdStock(supabase, names, query) {
  const rows = await fetchVariants(supabase);
  const q = (query ?? '').toLowerCase();
  const matched = q
    ? rows.filter((r) => `${r.sku} ${names[r.sku] ?? ''} ${r.dose}`.toLowerCase().includes(q))
    : rows;
  printRows(matched, names);
}

async function cmdLow(supabase, names) {
  const rows = await fetchVariants(supabase);
  const low = rows.filter((r) => {
    if (!isPublic(r)) return false;
    if (r.reorder_at != null) return r.on_hand <= r.reorder_at;
    return r.on_hand === 0 && r.inbound_units === 0; // no threshold set — flag true zeros
  });
  printRows(low, names);
}

async function cmdReceive(supabase, names, [sku, dose, qtyRaw, ...flags]) {
  if (!sku || !dose || !qtyRaw) {
    console.error('Usage: receive <sku> <dose> <qty> [--set]');
    process.exit(1);
  }
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
    console.error(`qty must be a non-negative whole number, got "${qtyRaw}"`);
    process.exit(1);
  }
  const absolute = flags.includes('--set') || !RECEIVE_IS_ADDITIVE;

  const rows = await fetchVariants(supabase);
  const current = rows.find((r) => r.sku === sku && r.dose === dose);
  if (!current) {
    const near = rows.filter((r) => r.sku === sku).map((r) => r.dose);
    console.error(
      near.length
        ? `No dose "${dose}" for ${sku}. Tracked doses: ${near.join(', ')}`
        : `SKU ${sku} is not tracked in inventory.`,
    );
    process.exit(1);
  }

  const before = current.on_hand;
  const after = absolute ? qty : before + qty;
  const name = names[sku] ?? sku;

  const { data, error } = await supabase.rpc('import_inventory', {
    p_rows: [{ sku, dose, on_hand: String(after) }],
  });
  if (error) throw new Error(`import_inventory failed: ${error.message}`);
  if (data?.errors?.length) {
    console.error(`Rejected: ${JSON.stringify(data.errors)}`);
    process.exit(1);
  }
  if (data?.applied !== 1) {
    console.error(`Not applied (on_hand may already be ${after}). Response: ${JSON.stringify(data)}`);
    process.exit(1);
  }

  console.log(`${name} ${dose} (${sku}): on hand ${before} → ${after}${absolute ? ' (set)' : ` (+${qty})`}`);
  const wasFast = has24hrSupply(current);
  const nowFast = has24hrSupply({ ...current, on_hand: after });
  if (!wasFast && nowFast) console.log('Now shows "24 Hour Shipping" on the catalog.');
  if (wasFast && !nowFast) console.log('No longer 24hr — now shows "Shipping 7–10 business days".');
}

// ── main ─────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);

try {
  const supabase = await signIn();
  const names = loadNames();

  if (cmd === 'stock') await cmdStock(supabase, names, rest[0]);
  else if (cmd === 'low') await cmdLow(supabase, names);
  else if (cmd === 'receive') await cmdReceive(supabase, names, rest);
  else {
    console.error('Usage:\n  inventory.mjs stock [query]\n  inventory.mjs low\n  inventory.mjs receive <sku> <dose> <qty> [--set]');
    process.exit(1);
  }
  await supabase.auth.signOut();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
