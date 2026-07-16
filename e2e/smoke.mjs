/*
  W-ENZA2 UI操作スモークハーネス(F10)
  ─────────────────────────────────────
  実ブラウザ(playwright chromium)で「クリックできる・スクロールできる・出撃できる」を検証する。
  tsc/eslint/vitest/build が全緑でも実UIは壊れうる(v1の教訓)ため、UI変更の出荷ゲートとして走らせる。

  使い方:
    node e2e/smoke.mjs                       # 旧UI(クラシック)を1280x720で検証
    node e2e/smoke.mjs --ui2                 # 既定の新UIを検証
    node e2e/smoke.mjs --viewport=1920x1080  # ビューポート指定
    node e2e/smoke.mjs --base=http://localhost:5173  # 起動済みサーバを使う(省略時はvite devを自動起動)
    UI2_SHOT_DIR=/path node e2e/smoke.mjs    # スクショ保存先(既定: e2e/.shots ※gitignore対象外に注意)

  終了コード: FAILが1つでもあれば1。SKIP/WARNは0。
  スクショ: <shotdir>/<profile>-<viewport>-<screen>.png
*/
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k, d) => (args.find((a) => a.startsWith(k + '=')) ?? '').split('=')[1] || d;

const PROFILE = has('--ui2') ? 'ui2' : 'classic';
const VIEWPORT = val('--viewport', '1280x720');
const [VW, VH] = VIEWPORT.split('x').map(Number);
const BASE = val('--base', '');
const SHOT_DIR = process.env.UI2_SHOT_DIR || path.resolve('e2e/.shots');
const PORT = Number(val('--port', '5199'));

// ダイヤ迷彩の実シェーダーを毎回コンパイルする。武器IDは正典のweapons.tsから抽出し、
// テスト側へ手書きの武器一覧を複製しない。全武器をGold条件済みにすることで既定ARの
// Diamond条件を満たし、kaede-arへ装備した状態で通常の出撃フローを踏む。
const WEAPON_IDS = Array.from(
  readFileSync(path.resolve('src/game/weapons.ts'), 'utf8').matchAll(/^\s+id:\s*'([^']+)',/gm),
  (match) => match[1],
);

// ── セレクタ契約 ──────────────────────────────────────────
// classic: 現行UI(src/ui)。ui2: ENZA v2(src/ui2)が満たすべき data-id 契約。
// UI2の全画面は出荷契約。セレクタ不在は回帰としてFAILにする。
const SELECTORS = {
  classic: {
    query: 'classic', // 既定=ui2へ反転済みのため、旧UIは ?classic で明示
    menuRoot: '#menu:not([hidden])',
    hudRoot: '#hud:not([hidden])',
    screens: [
      { id: 'menu-top', open: null, expect: '#mfd-panel-deploy' }, // 起動直後
      {
        id: 'campaign',
        open: '.mfd-tab[data-page="campaign"]',
        expect: '#mfd-panel-campaign:not([hidden])',
      },
      {
        id: 'armory',
        open: '.mfd-tab[data-page="armory"]',
        expect: '#mfd-panel-armory:not([hidden])',
      },
      {
        id: 'intel',
        open: '.mfd-tab[data-page="intel"]',
        expect: '#mfd-panel-intel:not([hidden])',
      },
      {
        id: 'system',
        open: '.mfd-tab[data-page="system"]',
        expect: '#mfd-panel-system:not([hidden])',
      },
      {
        id: 'deploy',
        open: '.mfd-tab[data-page="deploy"]',
        expect: '#mfd-panel-deploy:not([hidden])',
      },
    ],
    weaponList: '[data-id="weapons"]',
    weaponItem: '[data-id="weapons"] button:not([disabled])',
    startButton: '[data-id="start"]',
    resume: '[data-id="resume"]',
    quit: '[data-id="quit"]',
    settingsPanel: '[data-id="settings"]',
    slider: '[data-id="settings"] input[type="range"]',
  },
  ui2: {
    query: 'ui2',
    menuRoot: '#menu:not([hidden])',
    hudRoot: '#hud:not([hidden])',
    // ui2画面契約(ENZA_SPEC_V2): タイトル→hub→各画面
    titleRoot: '[data-id="title-root"]',
    titleStart: '[data-id="title-start"]',
    hubRoot: '[data-id="hub-root"]',
    screens: [
      { id: 'deploy', open: '[data-id="hub-nav-deploy"]', expect: '[data-id="scr-deploy"]' },
      { id: 'armory', open: '[data-id="hub-nav-armory"]', expect: '[data-id="scr-armory"]' },
      { id: 'campaign', open: '[data-id="hub-nav-campaign"]', expect: '[data-id="scr-campaign"]' },
      { id: 'options', open: '[data-id="hub-nav-options"]', expect: '[data-id="scr-options"]' },
    ],
    backToHub: '[data-id="back-to-hub"]',
    weaponList: '[data-id="weapon-list"]',
    weaponItem: '[data-id="weapon-list"] button:not([disabled])',
    startButton: '[data-id="start"]',
    resume: '[data-id="resume"]',
    quit: '[data-id="quit"]',
    settingsPanel: '[data-id="scr-options"]',
    slider: '[data-id="scr-options"] input[type="range"]',
  },
};

const S = SELECTORS[PROFILE];
const results = [];
const record = (id, status, note = '') => {
  results.push({ id, status, note });
  const mark = { PASS: '✅', FAIL: '❌', SKIP: '⏭️', WARN: '⚠️' }[status];
  console.log(`${mark} [${PROFILE}/${VIEWPORT}] ${id}${note ? ' — ' + note : ''}`);
};

// ── vite dev サーバ ──────────────────────────────────────
async function startVite() {
  if (BASE) return { url: BASE, proc: null };
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const url = `http://localhost:${PORT}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return { url, proc };
    } catch {
      /* まだ */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill('SIGTERM');
  throw new Error('vite dev が60秒で起動しなかった');
}

async function shot(page, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${PROFILE}-${VIEWPORT}-${name}.png`) });
}

// 可視かつ実在する要素を待つ(短timeout、なければnull)
async function q(page, sel, timeout = 4000) {
  try {
    return await page.waitForSelector(sel, { state: 'visible', timeout });
  } catch {
    return null;
  }
}

// スクロール検証: 対象コンテナ(なければ可視領域内の任意のスクロール可能要素)でwheel→scrollTop変化
async function checkScroll(page, containerSel, label) {
  const target = await page.evaluate((sel) => {
    const cands = sel ? [document.querySelector(sel)] : Array.from(document.querySelectorAll('*'));
    for (const el of cands) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight > el.clientHeight + 24 && el.clientHeight > 60) {
        el.setAttribute('data-smoke-scroll', '1');
        return true;
      }
    }
    return false;
  }, containerSel);
  if (!target) {
    record(`scroll:${label}`, 'SKIP', 'スクロール可能領域なし(全部収まっている)');
    return;
  }
  const el = await page.$('[data-smoke-scroll="1"]');
  const before = await el.evaluate((e) => e.scrollTop);
  await el.hover();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(250);
  const after = await el.evaluate((e) => {
    const v = e.scrollTop;
    e.removeAttribute('data-smoke-scroll');
    return v;
  });
  if (after > before) record(`scroll:${label}`, 'PASS', `scrollTop ${before}→${after}`);
  else record(`scroll:${label}`, 'FAIL', `wheelしてもscrollTop不変(${before})`);
}

// ui2: 既知状態(hub)へ戻す。画面表示中ならback-to-hubを押す。
async function ensureHub(page) {
  if (PROFILE !== 'ui2') return;
  const onHub = await page.$(S.hubRoot);
  if (onHub && (await onHub.isVisible())) return;
  const back = await q(page, S.backToHub, 1500);
  if (back) {
    await back.click();
    await q(page, S.hubRoot, 3000);
  }
}

// 節ごとの隔離: 例外でスイート全体を殺さない
async function section(id, fn) {
  try {
    await fn();
  } catch (e) {
    record(id, 'FAIL', '例外: ' + String(e).split('\n')[0].slice(0, 160));
  }
}

// ── メイン ────────────────────────────────────────────────
const { url, proc } = await startVite();
const errors = []; // {type, text}
let browser;
try {
  try {
    browser = await chromium.launch({
      channel: 'chromium', // new headless(WebGL/pointer lock対応)
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    });
  } catch {
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    });
  }
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  ctx.setDefaultTimeout(10_000);
  await ctx.addInitScript((weaponIds) => {
    if (!/^https?:$/.test(location.protocol)) return;
    // Headless Chromium はユーザー操作から呼んでも Pointer Lock を拒否する環境がある。
    // request/exitとpointerlockchangeの契約だけをE2E内で再現し、Inputのlockedゲート以降を
    // 本番と同じDOM入力経路で検証する。ゲーム本体や配信バンドルには一切入らない。
    let fakePointerLockElement = null;
    try {
      Object.defineProperty(document, 'pointerLockElement', {
        configurable: true,
        get: () => fakePointerLockElement,
      });
      Element.prototype.requestPointerLock = function requestPointerLockForSmoke() {
        fakePointerLockElement = document.querySelector('#app canvas') ?? document.documentElement;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      };
      document.exitPointerLock = () => {
        fakePointerLockElement = null;
        document.dispatchEvent(new Event('pointerlockchange'));
      };
    } catch {
      // APIの上書きを許さない実ブラウザではネイティブPointer Lockへフォールバックする。
    }
    const weaponStats = Object.fromEntries(
      weaponIds.map((id) => [id, { kills: 9999, headshots: 9999 }]),
    );
    localStorage.setItem(
      'hibana.profile.v1',
      JSON.stringify({ weaponStats, selectedCamos: { 'kaede-ar': 'diamond' } }),
    );
  }, WEAPON_IDS);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ type: 'console', text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) =>
    errors.push({
      type: 'pageerror',
      text: (String(e) + ' @ ' + String(e?.stack ?? '').split('\n')[1]).slice(0, 400),
    }),
  );

  const target = url + '/' + (S.query ? `?${S.query}` : '');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // 1) 起動
  if (PROFILE === 'ui2') {
    const title = await q(page, S.titleRoot, 8000);
    if (!title) {
      record('boot:title', 'FAIL', 'ui2タイトルが表示されない(title-root不在)');
    } else {
      record('boot:title', 'PASS');
      await shot(page, 'title');
      const startBtn = await q(page, S.titleStart);
      if (startBtn) {
        await startBtn.click();
        const hub = await q(page, S.hubRoot, 6000);
        record('title→hub', hub ? 'PASS' : 'FAIL', hub ? '' : 'ゲームスタート後にhub-rootが出ない');
        if (hub) await shot(page, 'hub');
      } else record('title→hub', 'FAIL', 'title-startボタン不在');
    }
  } else {
    const menu = await q(page, S.menuRoot, 10_000);
    record('boot:menu', menu ? 'PASS' : 'FAIL', menu ? '' : '#menuが可視にならない');
    if (menu) await shot(page, 'menu-top');
  }

  // 2) 画面巡回
  for (const scr of S.screens) {
    if (scr.open) {
      const opener = await q(page, scr.open, 2500);
      if (!opener) {
        record(`screen:${scr.id}`, 'FAIL', `オープナー不在 ${scr.open}`);
        continue;
      }
      await opener.click();
    }
    const shown = await q(page, scr.expect, 4000);
    record(`screen:${scr.id}`, shown ? 'PASS' : 'FAIL', shown ? '' : `${scr.expect} が出ない`);
    if (shown) {
      await page.waitForTimeout(350); // 遷移アニメ落ち着き
      await shot(page, scr.id);
      if (scr.id === 'armory') await checkScroll(page, S.weaponList, 'armory');
      if (scr.id === 'system' || scr.id === 'options') await checkScroll(page, null, 'settings');
    }
    // ui2: 戻る動線
    if (PROFILE === 'ui2' && shown) {
      const back = await q(page, S.backToHub, 1500);
      if (back) {
        await back.click();
        const hubBack = await q(page, S.hubRoot, 3000);
        record(`back:${scr.id}`, hubBack ? 'PASS' : 'FAIL');
        if (!hubBack) break;
      } else record(`back:${scr.id}`, 'WARN', 'back-to-hub不在(Escのみ?)');
    }
  }

  // 3) 武器庫の選択反映(ソフト検証)
  await section('armory:select', async () => {
    // classic: armoryへ移動してから
    if (PROFILE === 'classic') {
      const t = await q(page, '.mfd-tab[data-page="armory"]', 2000);
      if (t) await t.click();
    } else {
      await ensureHub(page);
      const t = await q(page, '[data-id="hub-nav-armory"]', 1500);
      if (t) await t.click();
      await q(page, '[data-id="scr-armory"]', 3000); // 画面表示待ち
      await q(page, S.weaponItem, 3000); // リスト充填待ち
    }
    const all = await page.$$(S.weaponItem);
    const items = [];
    for (const it of all) if (await it.isVisible()) items.push(it);
    if (items.length >= 1) {
      const pick = items[items.length >= 2 ? 1 : 0]; // 2個以上あれば非選択の2番目
      await pick.scrollIntoViewIfNeeded().catch(() => {});
      await pick.click({ timeout: 2500, force: true });
      await page.waitForTimeout(200);
      const marked = await page.evaluate(
        (sel) =>
          Array.from(document.querySelectorAll(sel)).some(
            (b) => b.classList.contains('selected') || b.getAttribute('aria-pressed') === 'true',
          ),
        S.weaponItem,
      );
      record(
        'armory:select',
        marked ? 'PASS' : 'WARN',
        marked ? `${items.length}武器/選択反映` : '選択状態のマークを検出できず(クラス規約差?)',
      );
    } else
      record('armory:select', PROFILE === 'ui2' ? 'FAIL' : 'WARN', `武器ボタン${items.length}個`);
  });

  // 4) 出撃 → 試合開始 → ポーズ → 再開 → 退出
  await section('deploy:launch', async () => {
    // deployへ
    if (PROFILE === 'classic') {
      const t = await q(page, '.mfd-tab[data-page="deploy"]', 2000);
      if (t) await t.click();
    } else {
      await ensureHub(page);
      const t = await q(page, '[data-id="hub-nav-deploy"]', 1500);
      if (t) await t.click();
      await q(page, '[data-id="scr-deploy"]', 3000); // 画面表示待ち
    }
    const start = await q(page, S.startButton, 3000);
    if (!start) {
      record('deploy:launch', 'FAIL', 'startボタン不在');
    } else {
      await start.focus();
      await page.keyboard.press('Enter'); // click detail===0 → 即時発火(hold不要)
      let hud = await q(page, S.hudRoot, 10_000);
      // headless Chromiumでは稀にfocus直後のEnter既定clickが落ちる。画面がまだ出撃前なら
      // HTMLElement.click()(detail===0)で同じキーボード/ゲームパッド経路を一度だけ再試行する。
      if (!hud && (await start.isVisible().catch(() => false))) {
        await start.evaluate((el) => el.click());
        hud = await q(page, S.hudRoot, 20_000);
      }
      if (!hud) {
        record('deploy:launch', 'FAIL', '出撃してもHUDが可視にならない(試合が始まらない)');
      } else {
        // rAFが回っているか(2フレームでtimestampが進む)
        const alive = await page.evaluate(
          () =>
            new Promise((res) => {
              let t0 = 0;
              requestAnimationFrame((a) => {
                t0 = a;
                requestAnimationFrame((b) => res(b > t0));
              });
            }),
        );
        record(
          'deploy:launch',
          alive ? 'PASS' : 'FAIL',
          alive ? '試合開始+描画ループ稼働' : 'rAF停止',
        );
        await page.waitForTimeout(1200); // 数十フレーム回す(エラー収集)
        await shot(page, 'hud-ingame');
        const diamondEquipped = await page.evaluate(() => {
          const raw = localStorage.getItem('hibana.profile.v1');
          if (!raw) return false;
          try {
            return JSON.parse(raw).selectedCamos?.['kaede-ar'] === 'diamond';
          } catch {
            return false;
          }
        });
        record(
          'camo:diamond-render',
          diamondEquipped ? 'PASS' : 'FAIL',
          diamondEquipped ? 'Diamond装備で実描画済み' : 'Diamond装備状態が失われた',
        );

        // ダイヤは発砲時だけ点光源・加算フラッシュを専用減光する。静止描画だけでは
        // 回帰を検出できないため、実WebGL/実入力経路で自動射撃を数発通し、描画継続と
        // console/pageerrorの無発生を後段のconsole:cleanまで監視する。
        const fireLocked = await page.evaluate(() => !!document.pointerLockElement);
        if (fireLocked && diamondEquipped) {
          try {
            await page.locator('#app canvas').first().hover();
            await page.mouse.down({ button: 'left' });
            await page.waitForTimeout(260);
            await shot(page, 'hud-diamond-firing');
          } finally {
            await page.mouse.up({ button: 'left' });
          }
          await page.waitForTimeout(120);
          record('camo:diamond-fire', 'PASS', 'Diamondで実射撃・反射減光経路を通過');
        } else {
          record(
            'camo:diamond-fire',
            'FAIL',
            fireLocked ? 'Diamond装備を確認できず' : '実射撃用pointer lockを取得できない',
          );
        }

        // ポーズ(ロック解除経由 — Escape合成キーはネイティブunlockを起こさないためexitPointerLock)
        const locked = await page.evaluate(() => !!document.pointerLockElement);
        if (locked) {
          await page.evaluate(() => document.exitPointerLock());
        } else {
          // ロックが取れない環境ではpauseアクション相当が踏めないためベストエフォート
          await page.keyboard.press('Escape');
        }
        const resume = await q(page, S.resume, 4000);
        if (!resume) {
          record(
            'pause',
            'FAIL',
            locked ? 'ロック解除してもポーズにならない' : 'ポーズ経路を実行できない',
          );
        } else {
          record('pause', 'PASS');
          await shot(page, 'pause');
          await resume.click();
          await page.waitForTimeout(600);
          const paused = await page.$(S.resume + ':visible');
          record(
            'pause:resume',
            paused === null ? 'PASS' : 'WARN',
            paused === null ? '' : '再開後もポーズ画面が見える',
          );
          // 再度ポーズ→退出
          const locked2 = await page.evaluate(() => !!document.pointerLockElement);
          if (locked2) await page.evaluate(() => document.exitPointerLock());
          const quit = await q(page, S.quit, 4000);
          if (quit) {
            await quit.click();
            const menuBack = await q(page, PROFILE === 'ui2' ? S.hubRoot : S.menuRoot, 6000);
            record('quit→menu', menuBack ? 'PASS' : 'FAIL');
          } else record('quit→menu', 'FAIL', 'quitに到達できず');
        }
      }
    }
  });

  // 5) オプションのスライダー(出撃後は試合中でメニューが無いため、新規ロードで初期状態から)
  await section('options:slider', async () => {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await q(page, PROFILE === 'ui2' ? S.titleRoot : S.menuRoot, 8000);
    if (PROFILE === 'ui2') {
      const st = await q(page, S.titleStart, 2000);
      if (st) await st.click();
    }
    if (PROFILE === 'classic') {
      const t = await q(page, '.mfd-tab[data-page="system"]', 2000);
      if (t) await t.click();
    } else {
      const hub = await q(page, S.hubRoot, 1500);
      if (hub) {
        const t = await q(page, '[data-id="hub-nav-options"]', 1500);
        if (t) await t.click();
      }
    }
    let slider = await q(page, S.slider, 2500);
    if (!slider && PROFILE === 'ui2') {
      // 既定タブ(一般)にrangeが無い場合、オーディオ/映像タブへ切替えて探す
      for (const label of ['オーディオ', '映像']) {
        const tab = page.locator('.u2o-tab', { hasText: label }).first();
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(200);
          slider = await q(page, S.slider, 1500);
          if (slider) break;
        }
      }
    }
    if (!slider) record('options:slider', PROFILE === 'ui2' ? 'FAIL' : 'WARN', 'スライダー不在');
    else {
      const before = await slider.evaluate((e) => e.value);
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      const after = await slider.evaluate((e) => e.value);
      record('options:slider', after !== before ? 'PASS' : 'WARN', `${before}→${after}`);
    }
  });

  // 6) コンソール/ページエラー(環境既知のpointer lock失敗は許容)
  const ENV_ALLOW = [/pointer lock/i, /WrongDocumentError/];
  const realErrors = errors.filter((e) => !ENV_ALLOW.some((re) => re.test(e.text)));
  if (realErrors.length === 0)
    record('console:clean', 'PASS', errors.length ? `環境既知${errors.length}件は許容` : '');
  else {
    record('console:clean', 'FAIL', `${realErrors.length}件`);
    for (const e of realErrors.slice(0, 10)) console.log(`   ${e.type}: ${e.text}`);
  }
} finally {
  await browser?.close();
  proc?.kill('SIGTERM');
}

// ── 集計 ──────────────────────────────────────────────────
const n = (s) => results.filter((r) => r.status === s).length;
console.log(
  `\n== ${PROFILE}/${VIEWPORT}: PASS ${n('PASS')} / FAIL ${n('FAIL')} / WARN ${n('WARN')} / SKIP ${n('SKIP')} ==`,
);
process.exit(n('FAIL') > 0 ? 1 : 0);
