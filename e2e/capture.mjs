/*
  W-ENZA2 全画面スクショ撮影(視覚検証の材料)。スモーク未到達の result/briefing も撮る。
  使い方: SHOT_DIR=<dir> node e2e/capture.mjs [--viewport=1920x1080]
  result は ?fkdemo の killcam 終了後に到達。briefing は campaign のミッションクリックで出る。
*/
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const val = (k, d) => (args.find((a) => a.startsWith(k + '=')) ?? '').split('=')[1] || d;
const VP = val('--viewport', '1920x1080');
const [VW, VH] = VP.split('x').map(Number);
const SHOT = process.env.SHOT_DIR || 'e2e/.shots';
mkdirSync(SHOT, { recursive: true });
const PORT = 5219;

const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}`;
const dl = Date.now() + 45000;
while (Date.now() < dl) {
  try { const x = await fetch(base); if (x.ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({
  channel: 'chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR ' + String(e).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 140)); });

const shot = async (name) => { await page.screenshot({ path: path.join(SHOT, `ui2-${VP}-${name}.png`) }); };
const q = async (sel, t = 5000) => { try { return await page.waitForSelector(sel, { state: 'visible', timeout: t }); } catch { return null; } };
const log = (...a) => console.log(...a);

await page.goto(base + '/?fkdemo', { waitUntil: 'domcontentloaded' });

// title
if (await q('[data-id="title-root"]', 12000)) { await page.waitForTimeout(1200); await shot('title'); log('title OK'); }
// hub
await (await q('[data-id="title-start"]'))?.click();
if (await q('[data-id="hub-root"]', 8000)) { await page.waitForTimeout(600); await shot('hub'); log('hub OK'); }
// deploy
await (await q('[data-id="hub-nav-deploy"]'))?.click();
if (await q('[data-id="scr-deploy"]')) { await page.waitForTimeout(400); await shot('deploy'); log('deploy OK'); }
await (await q('[data-id="back-to-hub"]', 2000))?.click(); await q('[data-id="hub-root"]', 3000);
// armory
await (await q('[data-id="hub-nav-armory"]'))?.click();
if (await q('[data-id="scr-armory"]')) { await page.waitForTimeout(600); await shot('armory'); log('armory OK'); }
await (await q('[data-id="back-to-hub"]', 2000))?.click(); await q('[data-id="hub-root"]', 3000);
// campaign
await (await q('[data-id="hub-nav-campaign"]'))?.click();
if (await q('[data-id="scr-campaign"]')) { await page.waitForTimeout(500); await shot('campaign'); log('campaign OK'); }
// briefing: 最初の解放ミッション行をクリック
{
  const mission = await page.$('[data-id="scr-campaign"] button.u2c-mission:not([disabled])');
  if (mission) {
    await mission.click();
    await page.waitForTimeout(600);
    // briefing画面(専用data-idが無ければ現在のDOMを撮る)
    await shot('briefing'); log('briefing OK');
    await (await q('[data-id="back-to-hub"], [data-id="brief-back"], [data-id="to-campaign"]', 2000))?.click();
  } else { log('briefing SKIP (no mission)'); }
}
if (!(await q('[data-id="hub-root"]', 3000))) { await (await q('[data-id="back-to-hub"]', 1500))?.click(); }
// options
await (await q('[data-id="hub-nav-options"]', 3000))?.click();
if (await q('[data-id="scr-options"]')) { await page.waitForTimeout(400); await shot('options'); log('options OK'); }
await (await q('[data-id="back-to-hub"]', 2000))?.click(); await q('[data-id="hub-root"]', 3000);
// deploy → 出撃 → HUD
await (await q('[data-id="hub-nav-deploy"]'))?.click(); await q('[data-id="scr-deploy"]', 3000); await page.waitForTimeout(300);
await (await q('[data-id="start"]'))?.focus(); await page.keyboard.press('Enter');
if (await q('#hud:not([hidden])', 20000)) {
  await page.waitForTimeout(2500); await shot('hud-ingame'); log('hud OK');
  // killcam一人称(fkdemo)
  const demo = await page.evaluate(() => (window.__fkDemo ? window.__fkDemo() : false));
  if (demo) {
    await page.waitForTimeout(900); await shot('killcam-fp'); log('killcam OK');
    // killcam(2.5+1.5s窓+slowmo)終了 → result
    await page.waitForTimeout(6500);
    await shot('result'); log('result (post-killcam) captured');
  } else { log('fkdemo SKIP'); }
}
log('ERRORS', errs.length, JSON.stringify(errs.slice(0, 6)));
await browser.close(); proc.kill('SIGTERM');
