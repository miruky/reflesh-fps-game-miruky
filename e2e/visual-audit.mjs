/*
  一人称モーション＋描画性能の実画面監査。

  例:
    AUDIT_SHOT_DIR=/tmp/hibana-audit \
      node e2e/visual-audit.mjs --weapon=kaede-ar --quality=high --viewport=1920x1080
    AUDIT_SHOT_DIR=/tmp/hibana-r100 \
      node e2e/visual-audit.mjs --stage=z01 --mode=zombie --round=100 --frames=30

  出力:
    - idle / fire / ADS / reload 3時点 / sprint のPNG
    - rAF p50/p95/p99、perfhud、長時間タスク、JSヒープのJSON
*/
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installSilentAudio, SILENT_BROWSER_ARGS } from './silence-audio.mjs';

const args = process.argv.slice(2);
const val = (key, fallback) =>
  (args.find((arg) => arg.startsWith(`${key}=`)) ?? '').split('=').slice(1).join('=') || fallback;

const weaponId = val('--weapon', 'kaede-ar');
const camoId = val('--camo', weaponId === 'kaede-ar' ? 'diamond' : '');
const quality = val('--quality', 'high');
const stageId = val('--stage', 'kunren');
const mode = val('--mode', 'training');
const zombieStartRound = Number(val('--round', '1'));
const sampleFrameCount = Number(val('--frames', '180'));
const settleMs = Number(val('--settle-ms', '2500'));
const perfOnly = val('--perf-only', '0') === '1';
const reloadFrameCount = Number(val('--reload-frames', '0'));
const reloadFrameMs = Number(val('--reload-frame-ms', '120'));
const safeZombie = val('--safe-zombie', '0') === '1';
const softwareRenderer = val('--software', '0') === '1';
const viewportName = val('--viewport', '1920x1080');
const kunaiState = val('--kunai-state', 'normal');
const [width, height] = viewportName.split('x').map(Number);
const port = Number(val('--port', '5229'));
const baseArg = val('--base', '');
const shotDir = process.env.AUDIT_SHOT_DIR || path.resolve('e2e/.audit-shots');
const prefix = `${stageId}-${mode}-${weaponId}-${kunaiState}-${quality}-${viewportName}`;

const weaponSource = readFileSync(path.resolve('src/game/weapons.ts'), 'utf8');
const weaponIds = Array.from(
  weaponSource.matchAll(/^\s+id:\s*'([^']+)',/gm),
  (match) => match[1],
);
if (!weaponIds.includes(weaponId)) throw new Error(`unknown weapon: ${weaponId}`);
if (!['normal', 'dark', 'raitei', 'kokuraitei'].includes(kunaiState)) {
  throw new Error(`unknown kunai state: ${kunaiState}`);
}
if (weaponId !== 'fists' && kunaiState !== 'normal') {
  throw new Error('--kunai-state is only valid with --weapon=fists');
}
if (!['low', 'medium', 'high'].includes(quality)) throw new Error(`unknown quality: ${quality}`);
if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`bad viewport: ${viewportName}`);
if (!Number.isInteger(zombieStartRound) || zombieStartRound < 1 || zombieStartRound > 999) {
  throw new Error(`bad zombie round: ${zombieStartRound}`);
}
if (!Number.isInteger(sampleFrameCount) || sampleFrameCount < 1 || sampleFrameCount > 1000) {
  throw new Error(`bad frame count: ${sampleFrameCount}`);
}
if (!Number.isInteger(reloadFrameCount) || reloadFrameCount < 0 || reloadFrameCount > 40) {
  throw new Error(`bad reload frame count: ${reloadFrameCount}`);
}
if (!Number.isFinite(reloadFrameMs) || reloadFrameMs < 40 || reloadFrameMs > 1000) {
  throw new Error(`bad reload frame interval: ${reloadFrameMs}`);
}
if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 60_000) {
  throw new Error(`bad settle time: ${settleMs}`);
}

mkdirSync(shotDir, { recursive: true });

async function startVite() {
  if (baseArg) return { url: baseArg, proc: null };
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return { url, proc };
    } catch {
      // 起動待ち
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  proc.kill('SIGTERM');
  throw new Error('vite dev did not start');
}

async function visible(page, selector, timeout = 10_000) {
  return page.waitForSelector(selector, { state: 'visible', timeout });
}

const { url, proc } = await startVite();
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      ...SILENT_BROWSER_ARGS,
      '--enable-precise-memory-info',
      ...(softwareRenderer ? ['--use-angle=swiftshader', '--use-gl=angle'] : []),
    ],
  });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(installSilentAudio);
  await context.addInitScript(
    ({
      allWeaponIds,
      primaryId,
      selectedCamoId,
      graphicsQuality,
      selectedStageId,
      selectedMode,
      selectedZombieRound,
      useSafeZombie,
    }) => {
      let fakePointerLockElement = null;
      try {
        Object.defineProperty(document, 'pointerLockElement', {
          configurable: true,
          get: () => fakePointerLockElement,
        });
        Element.prototype.requestPointerLock = function requestPointerLockForAudit() {
          fakePointerLockElement = document.querySelector('#app canvas') ?? document.documentElement;
          document.dispatchEvent(new Event('pointerlockchange'));
          return Promise.resolve();
        };
        document.exitPointerLock = () => {
          fakePointerLockElement = null;
          document.dispatchEvent(new Event('pointerlockchange'));
        };
      } catch {
        // ネイティブPointer Lockを使用
      }

      const weaponStats = Object.fromEntries(
        allWeaponIds.map((id) => [id, { kills: 9999, headshots: 9999 }]),
      );
      localStorage.setItem(
        'hibana.profile.v1',
        JSON.stringify({
          xp: 99_999_999,
          weaponStats,
          selectedCamos: selectedCamoId ? { [primaryId]: selectedCamoId } : {},
          ...(useSafeZombie
            ? { charms: { unlocked: ['perkcarry'], equipped: 'perkcarry' } }
            : {}),
        }),
      );
      localStorage.setItem(
        'hibana.loadout.v1',
        JSON.stringify({
          stageId: selectedStageId,
          mode: selectedMode,
          primaryId,
          secondaryId: 'suzume',
          attachments: [],
          grenade: 'frag',
          difficulty: 'normal',
          missionDifficulty: 'normal',
          hellMode: false,
          allGiantMode: false,
          rogueRun: false,
          zombieStartRound: selectedZombieRound,
          ...(useSafeZombie ? { charm: 'perkcarry' } : {}),
        }),
      );
      if (useSafeZombie) {
        localStorage.setItem('hibana.zombie.lastPerk.v1', JSON.stringify('juggernog'));
      }
      localStorage.setItem(
        'hibana.settings.v1',
        JSON.stringify({
          graphicsQuality,
          screenShake: 1,
          reduceMotion: false,
          radarEnabled: false,
        }),
      );

      globalThis.__hibanaAuditLongTasks = [];
      if ('PerformanceObserver' in globalThis) {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              globalThis.__hibanaAuditLongTasks.push(entry.duration);
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {
          // longtask非対応環境
        }
      }
    },
    {
      allWeaponIds: weaponIds,
      primaryId: weaponId,
      selectedCamoId: camoId,
      graphicsQuality: quality,
      selectedStageId: stageId,
      selectedMode: mode,
      selectedZombieRound: zombieStartRound,
      useSafeZombie: safeZombie,
    },
  );

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));

  await page.goto(`${url}/?ui2&perfhud=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await visible(page, '[data-id="title-start"]', 15_000);
  await page.locator('[data-id="title-start"]').click();
  await visible(page, '[data-id="hub-root"]');
  await page.locator('[data-id="hub-nav-deploy"]').click();
  await visible(page, '[data-id="scr-deploy"]');
  await page.locator('[data-id="start"]').evaluate((element) => element.click());
  await visible(page, '#hud:not([hidden])', 50_000);
  await page.waitForTimeout(settleMs);

  // クナイは通常／黒帝／雷帝／黒雷帝を同じ実試合経路で監査する。訓練場は毎フレーム
  // ゲージ満タンになるため、製品入力(M/N)だけで再現でき、内部状態の直書きは不要。
  if (weaponId === 'fists' && kunaiState !== 'normal') {
    if (mode !== 'training') throw new Error('kunai emperor-state audit requires training mode');
    if (kunaiState === 'dark') {
      await page.keyboard.press('KeyM');
    } else if (kunaiState === 'raitei') {
      await page.keyboard.press('KeyN');
    } else {
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press('KeyM');
        await page.waitForTimeout(140);
      }
    }
    await page.waitForTimeout(1800);
  }

  const shot = async (name) => {
    await page.screenshot({ path: path.join(shotDir, `${prefix}-${name}.png`) });
  };

  const sampleFrames = async (count = sampleFrameCount) =>
    page.evaluate(
      (frameCount) =>
        new Promise((resolve) => {
          const samples = [];
          let previous = 0;
          const tick = (now) => {
            if (previous > 0) samples.push(now - previous);
            previous = now;
            if (samples.length >= frameCount) resolve(samples);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      count,
    );

  await shot('idle');
  const idleFrames = await sampleFrames();

  let activeFrames = [];
  let reloadObserved = null;
  if (!perfOnly) {
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(55);
    await shot('fire-055ms');
    await page.waitForTimeout(95);
    await shot('fire-150ms');
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(250);

    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(380);
    await shot('ads');
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(250);

    if (weaponId !== 'fists') {
      await page.keyboard.press('KeyR');
      // 訓練モードの無限弾薬などで入力が受理されない場合を、
      // PNGがあるだけで「モーション検査済み」と誤判定しないよう記録する。
      await page.waitForTimeout(20);
      reloadObserved = await page.locator('[data-id="reload"]').isVisible();
      if (reloadFrameCount > 0) {
        for (let frame = 1; frame <= reloadFrameCount; frame += 1) {
          await page.waitForTimeout(reloadFrameMs);
          await shot(`reload-seq-${String(frame).padStart(2, '0')}-${frame * reloadFrameMs}ms`);
        }
      } else {
        for (const [delay, name] of [
          [220, 'reload-220ms'],
          [380, 'reload-600ms'],
          [420, 'reload-1020ms'],
        ]) {
          await page.waitForTimeout(delay);
          await shot(name);
        }
      }
      await page.waitForTimeout(2400);
    }

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    await shot('sprint');
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(300);

    activeFrames = await sampleFrames();
  }
  const telemetry = await page.evaluate(() => {
    const memory = performance.memory;
    const canvas = document.querySelector('#app canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      perfhud: document.querySelector('#perfhud')?.textContent ?? '',
      renderer: gl
        ? {
            label: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            css: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
            buffer: canvas ? [canvas.width, canvas.height] : null,
            devicePixelRatio,
          }
        : null,
      longTasks: globalThis.__hibanaAuditLongTasks ?? [],
      heap: memory
        ? {
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize,
            limit: memory.jsHeapSizeLimit,
          }
        : null,
      pointerLocked: Boolean(document.pointerLockElement),
    };
  });

  const describe = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (value) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
    const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
    return {
      count: samples.length,
      meanMs: Number(mean.toFixed(3)),
      p50Ms: Number(percentile(0.5).toFixed(3)),
      p95Ms: Number(percentile(0.95).toFixed(3)),
      p99Ms: Number(percentile(0.99).toFixed(3)),
      maxMs: Number(Math.max(...samples).toFixed(3)),
    };
  };

  const report = {
    weaponId,
    kunaiState,
    camoId,
    quality,
    stageId,
    mode,
    zombieStartRound,
    sampleFrameCount,
    perfOnly,
    reloadFrameCount,
    reloadFrameMs,
    reloadObserved,
    safeZombie,
    softwareRenderer,
    viewport: viewportName,
    idle: describe(idleFrames),
    active: activeFrames.length > 0 ? describe(activeFrames) : null,
    ...telemetry,
    errors,
  };
  const reportPath = path.join(shotDir, `${prefix}-report.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  proc?.kill('SIGTERM');
}
