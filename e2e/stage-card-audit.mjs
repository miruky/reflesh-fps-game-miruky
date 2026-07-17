/* Headless/muted audit for every static stage card and the real UI2 deploy screen. */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const val = (key, fallback) =>
  (args.find((arg) => arg.startsWith(`${key}=`)) ?? '').split('=').slice(1).join('=') || fallback;
const base = val('--base', 'http://127.0.0.1:5229');
const output = val('--output', '/tmp/hibana-stage-card-audit');
const assetDir = path.resolve('public/assets/stage-thumbs');
const stageIds = readdirSync(assetDir)
  .filter((name) => name.endsWith('.webp'))
  .map((name) => name.slice(0, -5))
  .sort();
mkdirSync(output, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
  await page.goto(`${base}/?ui2`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('[data-id="title-start"]').click();
  await page.locator('[data-id="hub-nav-deploy"]').click();
  await page.locator('[data-section="stage"]').click();
  await page.locator('.u2d-stagecard img[src]').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  const panel = page.locator('[data-id="panel-body"]');
  await panel.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'multiplayer-top.png') });
  await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: path.join(output, 'multiplayer-bottom.png') });

  const inspectVisibleCards = () => page.locator('.u2d-stagecard').evaluateAll((cards) =>
    cards.map((card) => {
      const img = card.querySelector('img');
      return {
        id: card.getAttribute('data-stage'),
        src: img?.getAttribute('src') ?? '',
        loaded: Boolean(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
        size: img ? [img.naturalWidth, img.naturalHeight] : [0, 0],
      };
    }),
  );
  const multiplayer = await inspectVisibleCards();

  await page.locator('[data-section="mode"]').click();
  await page.locator('[data-mode="zombie"]').click();
  await page.locator('[data-section="stage"]').click();
  await page.locator('.u2d-stagecard img[src]').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await panel.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'zombie-top.png') });
  await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: path.join(output, 'zombie-bottom.png') });
  const zombie = await inspectVisibleCards();

  await page.locator('[data-section="mode"]').click();
  await page.locator('[data-mode="training"]').click();
  await page.locator('[data-section="stage"]').click();
  await page.locator('.u2d-stagecard img[src]').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  await panel.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'training.png') });
  const training = await inspectVisibleCards();

  const fetches = await page.evaluate(async (ids) => Promise.all(ids.map(async (id) => {
    const response = await fetch(`./assets/stage-thumbs/${id}.webp`, { cache: 'no-store' });
    const bytes = await response.arrayBuffer();
    return {
      id,
      ok: response.ok,
      status: response.status,
      type: response.headers.get('content-type') ?? '',
      bytes: bytes.byteLength,
    };
  })), stageIds);
  const report = { stageIds, multiplayer, zombie, training, fetches, errors };
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const bad = [
    ...multiplayer.filter((card) => !card.loaded),
    ...zombie.filter((card) => !card.loaded),
    ...training.filter((card) => !card.loaded),
  ];
  if (stageIds.length !== 31 || bad.length > 0 || fetches.some((item) => !item.ok || item.bytes < 1_000) || errors.length > 0) {
    console.error(JSON.stringify({ count: stageIds.length, bad, fetches, errors }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ count: stageIds.length, multiplayer: multiplayer.length, zombie: zombie.length, training: training.length, errors }, null, 2));
  }
} finally {
  await browser.close();
}
