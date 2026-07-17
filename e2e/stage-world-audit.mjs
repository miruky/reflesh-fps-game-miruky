/*
 * 全固定ステージの実ゲーム描画監査。
 * 1つのheadless Chromiumを使い回し、ステージごとに独立contextを開く。
 * OS SpeechSynthesis / WebAudio / HTMLMedia / Chromium出力を全層で無音化し、
 * 画面のフォーカスは奪わない。
 *
 *   node e2e/stage-world-audit.mjs
 *   node e2e/stage-world-audit.mjs --quality=high --output=/tmp/hibana-worlds
 *   node e2e/stage-world-audit.mjs --stage=z01
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installSilentAudio, SILENT_BROWSER_ARGS } from './silence-audio.mjs';

const args = process.argv.slice(2);
const val = (key, fallback) =>
  (args.find((arg) => arg.startsWith(`${key}=`)) ?? '').split('=').slice(1).join('=') || fallback;
const quality = val('--quality', 'high');
const onlyStage = val('--stage', '');
const output = val('--output', '/tmp/hibana-stage-world-audit');
const port = Number(val('--port', '5241'));
const settleMs = Number(val('--settle-ms', '650'));
const viewportName = val('--viewport', '1280x720');
const [width, height] = viewportName.split('x').map(Number);
if (!['low', 'medium', 'high'].includes(quality)) throw new Error(`bad quality: ${quality}`);
if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`bad viewport: ${viewportName}`);

const allStageIds = readdirSync(path.resolve('public/assets/stage-thumbs'))
  .filter((name) => name.endsWith('.webp'))
  .map((name) => name.replace(/\.webp$/, ''))
  .sort((a, b) => a.localeCompare(b));
const stageIds = onlyStage ? allStageIds.filter((id) => id === onlyStage) : allStageIds;
if (stageIds.length === 0) throw new Error(`unknown stage: ${onlyStage}`);
mkdirSync(output, { recursive: true });

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
const url = `http://localhost:${port}`;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) break;
  } catch {
    // Vite起動待ち
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (Date.now() >= deadline) {
  vite.kill('SIGTERM');
  throw new Error('vite dev did not start');
}

let browser;
const results = [];
try {
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info',
      ...SILENT_BROWSER_ARGS,
    ],
  });

  for (const stageId of stageIds) {
    const mode = /^z\d\d$/.test(stageId) ? 'zombie' : stageId === 'renshujo' ? 'training' : 'tdm';
    const errors = [];
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(installSilentAudio);
    await context.addInitScript(
      ({ selectedStageId, selectedMode, graphicsQuality }) => {
        let fakePointerLockElement = null;
        try {
          Object.defineProperty(document, 'pointerLockElement', {
            configurable: true,
            get: () => fakePointerLockElement,
          });
          Element.prototype.requestPointerLock = function requestPointerLockForWorldAudit() {
            fakePointerLockElement = document.querySelector('#app canvas') ?? document.documentElement;
            document.dispatchEvent(new Event('pointerlockchange'));
            return Promise.resolve();
          };
          document.exitPointerLock = () => {
            fakePointerLockElement = null;
            document.dispatchEvent(new Event('pointerlockchange'));
          };
        } catch {
          // 上書き不可環境はネイティブPointer Lockへフォールバック。
        }
        localStorage.setItem('hibana.profile.v1', JSON.stringify({
          xp: 99_999_999,
          weaponStats: { 'kaede-ar': { kills: 9999, headshots: 9999 } },
          selectedCamos: { 'kaede-ar': 'diamond' },
          charms: { unlocked: ['perkcarry'], equipped: 'perkcarry' },
        }));
        localStorage.setItem('hibana.loadout.v1', JSON.stringify({
          stageId: selectedStageId,
          mode: selectedMode,
          primaryId: 'kaede-ar',
          secondaryId: 'suzume',
          attachments: [],
          grenade: 'frag',
          difficulty: 'normal',
          missionDifficulty: 'normal',
          hellMode: false,
          allGiantMode: false,
          rogueRun: false,
          zombieStartRound: 1,
          charm: 'perkcarry',
        }));
        localStorage.setItem('hibana.zombie.lastPerk.v1', JSON.stringify('juggernog'));
        localStorage.setItem('hibana.settings.v1', JSON.stringify({
          graphicsQuality,
          masterVolume: 0,
          sfxVolume: 0,
          musicVolume: 0,
          announcerVolume: 0,
          screenShake: 0,
          reduceMotion: false,
          radarEnabled: false,
        }));
      },
      { selectedStageId: stageId, selectedMode: mode, graphicsQuality: quality },
    );

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
    const startedAt = performance.now();
    let ok = false;
    try {
      await page.goto(`${url}/?ui2&perfhud=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator('[data-id="title-start"]').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('[data-id="title-start"]').click();
      await page.locator('[data-id="hub-root"]').waitFor({ state: 'visible' });
      await page.locator('[data-id="hub-nav-deploy"]').click();
      await page.locator('[data-id="scr-deploy"]').waitFor({ state: 'visible' });
      await page.locator('[data-id="start"]').evaluate((element) => element.click());
      await page.locator('#hud:not([hidden])').waitFor({ state: 'visible', timeout: 50_000 });
      await page.waitForTimeout(settleMs);
      await page.screenshot({ path: path.join(output, `${stageId}.png`) });
      ok = true;
    } catch (error) {
      errors.push(`audit: ${String(error)}`);
    }
    const perfhud = await page.locator('#perf-hud').textContent().catch(() => null);
    const heap = await page.evaluate(() => {
      const memory = performance.memory;
      return memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize } : null;
    }).catch(() => null);
    results.push({
      stageId,
      mode,
      ok,
      elapsedMs: Math.round(performance.now() - startedAt),
      perfhud,
      heap,
      errors,
    });
    await context.close();
    process.stdout.write(`${ok && errors.length === 0 ? 'OK' : 'NG'} ${stageId}\n`);
  }
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}

const report = {
  quality,
  viewport: viewportName,
  stages: results.length,
  passed: results.filter((entry) => entry.ok && entry.errors.length === 0).length,
  failed: results.filter((entry) => !entry.ok || entry.errors.length > 0).length,
  results,
};
writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ stages: report.stages, passed: report.passed, failed: report.failed }, null, 2));
if (report.failed > 0) process.exitCode = 1;
