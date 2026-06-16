/**
 * walkthrough.mjs — self-recording site walkthrough (ad footage).
 *
 * Drives the public site with a smooth simulated cursor + click ripples and
 * records a video. Also saves screenshots per scene so you can verify it
 * rendered (incl. the WebGL hero) before using the clip.
 *
 *   BASE_URL=https://vsresearchlabs.com node scripts/walkthrough.mjs   (default: live)
 *   BASE_URL=http://localhost:5173 npm run walkthrough                 (local dev — run `npm run dev` first)
 *
 * Output:
 *   walkthrough/video/*.webm   — the recording (convert to mp4 in any editor)
 *   walkthrough/frames/*.png   — scene screenshots (sanity check)
 *
 * This is raw cinematic footage. For the "ad" polish (zoom, captions, music),
 * drop the .webm into Screen Studio / CapCut / Descript — see walkthrough/EDIT_PLAN.md.
 */

import { chromium } from 'playwright';
import { mkdir, readdir, rename, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = (process.env.BASE_URL || 'https://vsresearchlabs.com').replace(/\/+$/, '');
const OUT = 'walkthrough';
const VIDEO_DIR = join(OUT, 'video');
const FRAME_DIR = join(OUT, 'frames');
const VW = 1280, VH = 800;

const wait = (p, ms) => p.waitForTimeout(ms);

// Injected once per page: a fake cursor + a click ripple, animatable from Node.
const CURSOR_INIT = () => {
  const ensure = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    Object.assign(c.style, {
      position: 'fixed', left: '50%', top: '60%', width: '20px', height: '20px',
      marginLeft: '-10px', marginTop: '-10px', borderRadius: '50%',
      border: '2px solid rgba(26,23,20,0.85)', background: 'rgba(255,255,255,0.45)',
      boxShadow: '0 1px 6px rgba(26,23,20,0.25)', zIndex: '2147483647',
      pointerEvents: 'none', transition: 'left .65s cubic-bezier(.22,.61,.36,1), top .65s cubic-bezier(.22,.61,.36,1)',
    });
    document.body.appendChild(c);
  };
  if (document.body) ensure(); else addEventListener('DOMContentLoaded', ensure);
  window.__curMove = (x, y) => { const c = document.getElementById('__cur'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; } };
  window.__curClick = () => {
    const c = document.getElementById('__cur'); if (!c) return;
    const r = document.createElement('div');
    Object.assign(r.style, {
      position: 'fixed', left: c.style.left, top: c.style.top, width: '14px', height: '14px',
      marginLeft: '-7px', marginTop: '-7px', borderRadius: '50%', background: 'rgba(52,114,122,0.55)',
      zIndex: '2147483646', pointerEvents: 'none', transition: 'all .55s ease-out',
    });
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.width = '52px'; r.style.height = '52px'; r.style.marginLeft = '-26px'; r.style.marginTop = '-26px'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  };
};

async function moveTo(page, locator) {
  try {
    const box = await locator.first().boundingBox({ timeout: 3000 });
    if (!box) return false;
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(Math.min(box.y + box.height / 2, VH - 30));
    await page.evaluate(([x, y]) => window.__curMove?.(x, y), [x, y]);
    await wait(page, 750);
    return true;
  } catch { return false; }
}

async function clickEl(page, locator) {
  if (!(await moveTo(page, locator))) return false;
  await page.evaluate(() => window.__curClick?.());
  await wait(page, 200);
  await locator.first().click({ timeout: 5000 }).catch(() => {});
  return true;
}

async function smoothScrollTo(page, y, steps = 22) {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const t = from + (y - from) * (i / steps);
    await page.evaluate((v) => window.scrollTo(0, v), t);
    await wait(page, 55);
  }
}

async function pageHeight(page) {
  return page.evaluate(() => document.body.scrollHeight);
}

async function goto(page, path, label) {
  const url = BASE + path;
  // eslint-disable-next-line no-console
  console.log(`→ ${label}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await wait(page, 2200); // let lazy/3D + fonts settle
}

async function shot(page, name) {
  await page.screenshot({ path: join(FRAME_DIR, `${name}.png`) }).catch(() => {});
}

// Accept the "Research-Use Only" consent gate (two checkboxes + Enter site).
async function dismissGate(page) {
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) await boxes.nth(i).check({ timeout: 2000 }).catch(() => {});
  // Fallback: some gates use styled label rows, not real inputs.
  if (n === 0) {
    await page.getByText(/21 years/i).first().click({ timeout: 1500 }).catch(() => {});
    await page.getByText(/research only/i).first().click({ timeout: 1500 }).catch(() => {});
  }
  await wait(page, 400);
  await page.getByRole('button', { name: /enter site/i }).click({ timeout: 3000 })
    .catch(async () => { await page.locator('button:has-text("Enter")').first().click({ timeout: 2000 }).catch(() => {}); });
  await wait(page, 1500);
}

// Close the first-visit intro modal (it appears on every landing load).
async function dismissModal(page) {
  await page.locator('[aria-label="Dismiss intro"]').first().click({ timeout: 2000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await wait(page, 700);
}

async function main() {
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: { width: VW, height: VH } },
  });
  await context.addInitScript(CURSOR_INIT);
  // Pre-accept the Research-Use consent gate so it never blocks the recording.
  await context.addInitScript(() => {
    try { localStorage.setItem('vsrl_disclaimer_accepted_v1', new Date().toISOString()); } catch { /* ignore */ }
  });
  const page = await context.newPage();

  // ── Scene 1 — Landing hero + scroll ──────────────────────────────────────
  await goto(page, '/', 'Landing');
  await dismissGate(page);
  await dismissModal(page);
  await wait(page, 1700); // let the hero breathe on camera (post-gate)
  await shot(page, '01-landing-hero');
  // hover the social row / a CTA if present
  await moveTo(page, page.locator('a[href*="whatsapp"]'));
  const h = await pageHeight(page);
  await smoothScrollTo(page, h * 0.33); await wait(page, 700); await shot(page, '02-landing-mid');
  await smoothScrollTo(page, h * 0.62); await wait(page, 700); await shot(page, '03-landing-lower');
  await smoothScrollTo(page, h - VH); await wait(page, 700); await shot(page, '04-landing-footer');
  await smoothScrollTo(page, 0); await wait(page, 500);

  // ── Scene 2 — Catalog ────────────────────────────────────────────────────
  await goto(page, '/research-supplies/biopeptide', 'Catalog');
  await shot(page, '05-catalog-top');
  const ch = await pageHeight(page);
  await smoothScrollTo(page, ch * 0.35); await wait(page, 800); await shot(page, '06-catalog-grid');
  await moveTo(page, page.locator('a[href^="/product/"]'));

  // ── Scene 3 — Product ────────────────────────────────────────────────────
  const productHref = await page.locator('a[href^="/product/"]').first().getAttribute('href').catch(() => null);
  if (productHref) {
    await goto(page, productHref, 'Product');
    await shot(page, '07-product-top');
    const ph = await pageHeight(page);
    await smoothScrollTo(page, ph * 0.4); await wait(page, 900); await shot(page, '08-product-detail');
    await smoothScrollTo(page, 0); await wait(page, 400);
  }

  // ── Scene 4 — Track order ────────────────────────────────────────────────
  await goto(page, '/track', 'Track');
  await shot(page, '09-track');
  await moveTo(page, page.locator('input').first());
  await wait(page, 1200);

  // finalize
  const videoPath = await page.video()?.path();
  await context.close(); // flushes the video file
  await browser.close();

  // Name the freshest recording (by mtime) and clear the rest.
  try {
    const raw = (await readdir(VIDEO_DIR)).filter((f) => f.startsWith('page@') && f.endsWith('.webm'));
    const withTime = await Promise.all(raw.map(async (f) => ({ f, m: (await stat(join(VIDEO_DIR, f))).mtimeMs })));
    withTime.sort((a, b) => b.m - a.m);
    const dest = join(VIDEO_DIR, 'vsrl-walkthrough.webm');
    if (withTime.length) {
      await rm(dest, { force: true });
      await rename(join(VIDEO_DIR, withTime[0].f), dest).catch(() => {});
      for (const { f } of withTime.slice(1)) await rm(join(VIDEO_DIR, f), { force: true });
      // eslint-disable-next-line no-console
      console.log(`\n✓ Video: ${dest}`);
    }
  } catch { /* ignore */ }
  // eslint-disable-next-line no-console
  console.log(`✓ Frames: ${FRAME_DIR}/  (raw video path was ${videoPath})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
