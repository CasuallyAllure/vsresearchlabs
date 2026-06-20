import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173';
const browser = await chromium.launch();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Ensure the webfont is actually loaded before judging finesse.
await page.evaluate(() => document.fonts && document.fonts.ready);

// Loader: V + wordmark revealed (~2000ms) and still held (<~3200ms).
await page.waitForTimeout(2900);
await page.screenshot({ path: 'scripts/_shot_loader.png', clip: { x: 440, y: 330, width: 400, height: 220 } });

// Let the loader exit, dismiss the gate, then capture the header wordmark.
await page.evaluate(() => { try { localStorage.setItem('vsrl_disclaimer_accepted_v1', new Date().toISOString()); } catch {} });
await page.waitForTimeout(1500);
const enter = page.getByRole('button', { name: /enter site/i });
if (await enter.count()) { await enter.first().click().catch(() => {}); await page.waitForTimeout(600); }
await page.screenshot({ path: 'scripts/_shot_header.png', clip: { x: 440, y: 0, width: 400, height: 110 } });

await browser.close();
console.log('done');
