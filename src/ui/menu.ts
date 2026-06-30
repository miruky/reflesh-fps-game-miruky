import { easeOutCubic } from '../core/easing';
import { exportProfile, importProfile, saveProfile } from '../core/profile';
import {
  DEFAULT_SETTINGS,
  MATCH_LENGTHS,
  RETICLE_COLORS,
  RETICLE_STYLES,
  UI_ACCENTS,
  saveSettings,
  type Settings,
} from '../core/settings';
import {
  ATTACHMENT_DEFS,
  ATTACHMENT_SLOTS,
  attachmentsForSlot,
  type AttachmentSlot,
} from '../game/attachments';
import type { Difficulty } from '../game/bot';
import { GRENADE_KINDS, GRENADE_SPECS, type GrenadeKind } from '../game/grenades';
import type { MatchResult } from '../game/match';
import { MODE_DEFS, MODE_IDS, type GameMode } from '../game/modes';
import {
  CHALLENGES,
  isUnlocked,
  levelFromXp,
  rankFromRating,
  unlockLevelOf,
  type MatchProgress,
  type Profile,
} from '../game/progression';
import { STAGES } from '../game/stages';
import { TEAM_PALETTES } from '../game/teamcolors';
import { PRIMARY_IDS, WEAPON_DEFS } from '../game/weapons';

export interface MenuSelection {
  stageId: string;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
}

export interface MenuCallbacks {
  onStart: (selection: MenuSelection) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChanged: () => void;
}

interface WeaponBars {
  power: number;
  rate: number;
  control: number;
}

const WEAPON_BARS: Record<string, WeaponBars> = {
  'kaede-ar': { power: 7, rate: 7, control: 6 },
  'tsubaki-smg': { power: 5, rate: 9, control: 5 },
  'yamasemi-dmr': { power: 9, rate: 3, control: 8 },
  'hiiragi-sg': { power: 9, rate: 2, control: 4 },
  'miyama-br': { power: 7, rate: 6, control: 7 },
  'kumagera-lmg': { power: 6, rate: 6, control: 3 },
};

const GRENADE_DESCS: Record<GrenadeKind, string> = {
  frag: '長押しでクッキング。爆発範囲ダメージ',
  smoke: '視線を遮る煙幕を張る',
  flash: '視界を白く焼く。正面で食らうと長い',
  incendiary: '着弾点に燃え続ける火災を残す',
};

const LOADOUT_KEY = 'hibana.loadout.v1';

const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: '新兵', desc: '反応が遅く、よく外す' },
  { id: 'normal', label: '兵士', desc: '標準的な腕前' },
  { id: 'hard', label: '精鋭', desc: '反応が速く、正確に当てる' },
];

const CONTROLS: Array<[string, string]> = [
  ['移動', 'W A S D'],
  ['視点', 'マウス'],
  ['射撃', '左クリック'],
  ['ADS(覗き込み)', '右クリック'],
  ['ジャンプ / よじ登り', 'Space(空中で前進)'],
  ['スラスト二段ジャンプ', '空中で Space'],
  ['しゃがみ', 'C / 左Ctrl'],
  ['スプリント', '左Shift'],
  ['スライディング', 'スプリント中に C'],
  ['スライドジャンプ', 'スライド中に Space'],
  ['ウォールラン', '壁沿いを空中で前進(自動)'],
  ['ウォールジャンプ', 'ウォールラン中に Space'],
  ['リーン', 'Q / E'],
  ['リロード', 'R'],
  ['武器切替', '1 / 2 / ホイール'],
  ['グレネード', 'G 長押しで構え、離して投擲'],
  ['投擲物切替', '3'],
  ['近接攻撃', 'V'],
  ['アルティメット', 'F(ゲージ満タンで発動)'],
  ['息止め(スコープ)', 'Shift(覗き込み中に揺れを止める)'],
  ['スコアボード', 'Tab'],
  ['ポーズ', 'Esc'],
];

const LOGO_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="hibanaのロゴ">
  <title>hibana</title>
  <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="3" opacity="0.55"/>
  <path d="M32 4v12M32 48v12M4 32h12M48 32h12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <path class="spark" d="M32 22l3.2 6.8L42 32l-6.8 3.2L32 42l-3.2-6.8L22 32l6.8-3.2z"/>
</svg>`;

export class Menu {
  private selection: MenuSelection = {
    stageId: STAGES[0]?.id ?? 'kunren',
    mode: 'ffa',
    primaryId: 'kaede-ar',
    attachments: [],
    grenade: 'frag',
    difficulty: 'normal',
  };
  private readonly attachmentBySlot: Record<AttachmentSlot, string | null> = {
    sight: null,
    muzzle: null,
    grip: null,
    mag: null,
  };
  private activePage = 'deploy'; // 現在表示中のMFDページ

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly profile: Profile,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.loadLoadout();
    this.showMain();
  }

  private playerLevel(): number {
    return levelFromXp(this.profile.xp).level;
  }

  // 前回のロードアウトを復元する。存在しないIDは黙って捨てる
  private loadLoadout(): void {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MenuSelection>;
      if (saved.stageId && STAGES.some((s) => s.id === saved.stageId)) {
        this.selection.stageId = saved.stageId;
      }
      if (saved.primaryId && (PRIMARY_IDS as readonly string[]).includes(saved.primaryId)) {
        this.selection.primaryId = saved.primaryId;
      }
      if (saved.mode && MODE_IDS.includes(saved.mode)) {
        this.selection.mode = saved.mode;
      }
      if (saved.grenade && GRENADE_KINDS.includes(saved.grenade)) {
        this.selection.grenade = saved.grenade;
      }
      if (saved.difficulty && ['easy', 'normal', 'hard'].includes(saved.difficulty)) {
        this.selection.difficulty = saved.difficulty;
      }
      for (const id of saved.attachments ?? []) {
        const def = ATTACHMENT_DEFS[id];
        if (def) this.attachmentBySlot[def.slot] = id;
      }
    } catch {
      // 壊れた保存値は初期値で開く
    }
  }

  private syncAttachments(): void {
    this.selection.attachments = Object.values(this.attachmentBySlot).filter(
      (id): id is string => id !== null,
    );
  }

  private saveLoadout(): void {
    this.syncAttachments();
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.selection));
  }

  hide(): void {
    this.root.hidden = true;
  }

  showMain(): void {
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-main">
        <div class="console-bezel">
          <header class="menu-header telemetry-rail">
            <span class="sys-lamps" aria-hidden="true">
              <i data-sys="O2"><b></b>O2</i><i data-sys="PWR"><b></b>PWR</i>
              <i data-sys="NAV"><b></b>NAV</i><i data-sys="LINK"><b></b>LINK</i>
            </span>
            <span class="menu-logo">${LOGO_SVG}</span>
            <div class="wordmark">
              <h1>hibana</h1>
              <p class="menu-tagline">Orbital Dropdeck · 軌道降下管制盤</p>
            </div>
            <div class="nav-readout" aria-hidden="true">
              <span>ALT <b>408</b>KM</span><span>VEL <b>7.62</b>KM·S⁻¹</span><span class="nav-eta">DROP WINDOW <b>T-00:43</b></span>
            </div>
          </header>
          <p class="menu-touchnote">この作品はキーボードとマウスで操作します。スマートフォンやタブレットでは遊べません。PCで開いてください。</p>
          <section class="deployment-briefing" aria-label="出撃構成">
            <div class="briefing-heading">
              <span>Deployment briefing</span>
              <strong>出撃構成</strong>
            </div>
            <dl class="briefing-loadout">
              <div><dt>Stage</dt><dd data-id="brief-stage"></dd></div>
              <div><dt>Mode</dt><dd data-id="brief-mode"></dd></div>
              <div><dt>Primary</dt><dd data-id="brief-weapon"></dd></div>
              <div><dt>Utility</dt><dd data-id="brief-grenade"></dd></div>
              <div><dt>Threat</dt><dd data-id="brief-difficulty"></dd></div>
            </dl>
            <div class="deploy-lever">
              <span class="lever-beacon" aria-hidden="true"></span>
              <button class="menu-start" data-id="start">
                <span>出撃する</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h13m-5-5 5 5-5 5M19 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span class="lever-eta" aria-hidden="true">降下軌道 LOCKED · 1G</span>
            </div>
          </section>
          <div class="console-body">
            <nav class="mfd-rail" role="tablist" aria-label="管制ページ">
              <button class="mfd-tab" type="button" role="tab" data-page="deploy" id="mfd-tab-deploy" aria-controls="mfd-panel-deploy"><b>01</b><span>DEPLOY</span><small>降下管制</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="armory" id="mfd-tab-armory" aria-controls="mfd-panel-armory"><b>02</b><span>ARMORY</span><small>兵装</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="intel" id="mfd-tab-intel" aria-controls="mfd-panel-intel"><b>03</b><span>INTEL</span><small>戦況</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="system" id="mfd-tab-system" aria-controls="mfd-panel-system"><b>04</b><span>SYSTEM</span><small>系統</small></button>
            </nav>
            <div class="mfd-deck">
              <section class="mfd-page" data-page="deploy" role="tabpanel" id="mfd-panel-deploy" aria-labelledby="mfd-tab-deploy">
                <div class="mfd-hero" aria-hidden="true">
                  <div class="hero-limb"></div>
                  <div class="hero-readout"><span>ORBIT <b>412</b>KM</span><span>ATMO <b>1.0</b>G</span><span>LZ <b>SECURE</b></span></div>
                  <div class="hero-grid"></div>
                </div>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>降下目標</h2>
                    <div class="stage-grid" data-id="stages"></div>
                  </section>
                  <section class="menu-section">
                    <h2>交戦規定</h2>
                    <div class="mode-list" data-id="modes"></div>
                  </section>
                  <section class="menu-section">
                    <h2>脅威レベル</h2>
                    <div class="difficulty-list" data-id="difficulties"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="armory" role="tabpanel" id="mfd-panel-armory" aria-labelledby="mfd-tab-armory" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>メイン武器</h2>
                    <div class="weapon-list" data-id="weapons"></div>
                  </section>
                  <section class="menu-section">
                    <h2>アタッチメント</h2>
                    <div class="attach-panel" data-id="attachments"></div>
                  </section>
                  <section class="menu-section">
                    <h2>投擲物</h2>
                    <div class="grenade-list" data-id="grenades"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="intel" role="tabpanel" id="mfd-panel-intel" aria-labelledby="mfd-tab-intel" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>戦績</h2>
                    <div class="menu-profile" data-id="profile"></div>
                  </section>
                  <section class="menu-section">
                    <h2>任務</h2>
                    <div class="challenge-list" data-id="challenges"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="system" role="tabpanel" id="mfd-panel-system" aria-labelledby="mfd-tab-system" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>設定</h2>
                    <div data-id="settings"></div>
                  </section>
                  <section class="menu-section menu-controls">
                    <h2>操作</h2>
                    <div class="controls-grid" data-id="controls"></div>
                  </section>
                </div>
              </section>
            </div>
          </div>
          <footer class="console-status" aria-hidden="true">
            <span class="status-dot"></span><span>SYS NOMINAL</span><span class="status-fill"></span><span>hibana // tactical sim</span>
          </footer>
        </div>
      </div>
    `;
    this.renderProfile();
    this.renderChallenges();
    this.renderStages();
    this.renderModes();
    this.renderWeapons();
    this.renderAttachments();
    this.renderGrenades();
    this.renderDifficulties();
    this.renderSettings(this.query('settings'));
    this.renderControls();
    this.renderBriefing();
    this.wireMfd();
    this.query('start').addEventListener('click', () => {
      this.saveLoadout();
      this.callbacks.onStart(this.selection);
    });
  }

  // MFDのタブ切替を結線する。クリック+矢印キー(roving tabindex)でページを行き来する
  private wireMfd(): void {
    const rail = this.root.querySelector<HTMLElement>('.mfd-rail');
    if (!rail) return;
    const tabs = Array.from(rail.querySelectorAll<HTMLButtonElement>('.mfd-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.setMfdPage(tab.dataset.page ?? 'deploy'));
    });
    rail.addEventListener('keydown', (e) => {
      const dir =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (dir === 0) return;
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.dataset.page === this.activePage);
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      if (next) {
        this.setMfdPage(next.dataset.page ?? 'deploy');
        next.focus();
      }
    });
    this.setMfdPage(this.activePage);
  }

  private setMfdPage(page: string): void {
    this.activePage = page;
    this.root.querySelectorAll<HTMLElement>('.mfd-page').forEach((p) => {
      const on = p.dataset.page === page;
      p.hidden = !on;
      p.classList.toggle('active', on);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.mfd-tab').forEach((t) => {
      const on = t.dataset.page === page;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  showPause(): void {
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-pause">
        <div class="pause-panel" role="dialog" aria-modal="true" aria-label="一時停止">
          <h1>一時停止</h1>
          <button class="menu-start" data-id="resume">再開する</button>
          <section class="menu-section">
            <h2>設定</h2>
            <div data-id="settings"></div>
          </section>
          <button class="menu-quiet" data-id="quit">メニューに戻る</button>
        </div>
      </div>
    `;
    this.renderSettings(this.query('settings'));
    this.query('resume').addEventListener('click', () => this.callbacks.onResume());
    this.query('quit').addEventListener('click', () => this.callbacks.onQuit());
    this.query('resume').focus({ preventScroll: true });
  }

  showResult(result: MatchResult, progress: MatchProgress): void {
    this.root.hidden = false;
    const mvp = result.rows[0];
    const rowsHtml = result.rows
      .map(
        (row) => `
        <tr class="${row.isPlayer ? 'score-you' : result.teamScores && row.isAlly ? 'score-ally' : ''}">
          <td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>
        </tr>`,
      )
      .join('');
    const teamScoreHtml = result.teamScores
      ? `<p class="result-teamscore"><span class="ts-mine" data-id="tsmine">0</span> - <span class="ts-enemy" data-id="tsenemy">0</span></p>`
      : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-result${result.won ? ' result-won' : ''}">
        <div class="result-panel" role="dialog" aria-modal="true" aria-label="試合結果">
          <p class="result-mode">${result.modeName}</p>
          <h1>${result.won ? '勝利' : '敗北'}</h1>
          ${teamScoreHtml}
          <p class="result-mvp">MVP: ${mvp ? mvp.name : '-'}</p>
          <p class="result-stats">命中率 ${(result.accuracy * 100).toFixed(1)}% / ヘッドショット ${result.headshots}</p>
          <table class="result-table">
            <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${this.progressHtml(progress)}
          <div class="result-buttons">
            <button class="menu-start" data-id="restart">もう一度</button>
            <button class="menu-quiet" data-id="menu">メニューに戻る</button>
          </div>
        </div>
      </div>
    `;
    this.query('restart').addEventListener('click', () => this.callbacks.onRestart());
    this.query('menu').addEventListener('click', () => this.callbacks.onQuit());
    this.countUp(this.query('xptotal'), progress.xpTotal);
    if (result.teamScores) {
      this.countUp(this.query('tsmine'), result.teamScores.mine, 650);
      this.countUp(this.query('tsenemy'), result.teamScores.enemy, 650);
    }
    this.query('restart').focus({ preventScroll: true });
  }

  // リザルト下部の獲得XP・レベル・レート変動の表示
  private progressHtml(progress: MatchProgress): string {
    const xpRows = progress.xpBreakdown
      .map(
        (entry) =>
          `<li><span class="xp-label">${entry.label}</span><span class="xp-value">+${entry.xp}</span></li>`,
      )
      .join('');
    const level = progress.levelAfter;
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const levelUp =
      level.level > progress.levelBefore.level
        ? `<p class="result-levelup">レベルアップ Lv ${progress.levelBefore.level} から Lv ${level.level} へ</p>`
        : '';
    const unlocks = progress.newUnlocks.length
      ? `<ul class="result-unlocks">${progress.newUnlocks
          .map((u) => `<li>${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${u.name}</li>`)
          .join('')}</ul>`
      : '';
    const delta = progress.ratingAfter - progress.ratingBefore;
    const rankNote =
      progress.rankAfter.name === progress.rankBefore.name
        ? `階級 ${progress.rankAfter.name}`
        : delta > 0
          ? `${progress.rankAfter.name} へ昇格`
          : `${progress.rankAfter.name} へ降格`;
    const rating =
      delta === 0
        ? `<p class="result-rating">レート ${progress.ratingAfter} / ${rankNote}</p>`
        : `<p class="result-rating">レート ${progress.ratingBefore} <span class="${delta > 0 ? 'rating-up' : 'rating-down'}">${delta > 0 ? '+' : ''}${delta}</span> / ${rankNote}</p>`;
    const recordsHtml = progress.newRecords.length
      ? `<p class="result-record">自己ベスト更新 ${progress.newRecords.join(' / ')}</p>`
      : '';
    return `
      <section class="result-progress">
        <ul class="result-xp-list">${xpRows}</ul>
        <p class="result-xp-total">獲得 <span data-id="xptotal">0</span> XP</p>
        <div class="result-levelrow">
          <span class="result-level">Lv ${level.level}</span>
          <span class="profile-xpbar"><i style="width:${xpRatio}%"></i></span>
        </div>
        ${levelUp}
        ${unlocks}
        ${recordsHtml}
        ${rating}
      </section>
    `;
  }

  private query(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!node) throw new Error(`menu element not found: ${id}`);
    return node;
  }

  // prefers-reduced-motionの利用者には演出を飛ばして即値を見せる
  private get prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  // 0から目標値まで数字を駆け上がらせる。画面差し替えで要素が外れたら止める
  private countUp(el: HTMLElement, to: number, durationMs = 750): void {
    if (this.prefersReducedMotion || to <= 0) {
      el.textContent = String(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - start) / durationMs);
      el.textContent = String(Math.round(easeOutCubic(p) * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // 一覧の各行へ入場の段差(--i)を与える。CSS側でanimation-delayに使う
  private stagger(container: HTMLElement): void {
    Array.from(container.children).forEach((child, i) => {
      (child as HTMLElement).style.setProperty('--i', String(i));
    });
  }

  private renderStages(): void {
    const grid = this.query('stages');
    STAGES.forEach((stage, index) => {
      const card = document.createElement('button');
      card.className = 'stage-card';
      card.dataset.stage = stage.id;
      const palette = stage.palette;
      card.innerHTML = `
        <span class="stage-preview">${this.stagePreview(stage, index)}</span>
        <span class="stage-card-body">
          <span class="stage-swatch" aria-hidden="true">
            <i style="background:${palette.floor}"></i><i style="background:${palette.wall}"></i>
            <i style="background:${palette.obstacle}"></i><i style="background:${palette.accent}"></i>
          </span>
          <span class="stage-name">${stage.name}</span>
          <span class="stage-sub">${stage.subtitle}</span>
          <span class="stage-meta">${stage.size}m 四方 / BOT ${stage.botCount}体 / Seed ${stage.seed}</span>
        </span>
      `;
      card.addEventListener('click', () => {
        this.selection.stageId = stage.id;
        this.markSelected(grid, 'stage', stage.id);
        this.renderBriefing();
      });
      grid.appendChild(card);
    });
    this.stagger(grid);
    this.markSelected(grid, 'stage', this.selection.stageId);
  }

  private stagePreview(stage: (typeof STAGES)[number], index: number): string {
    const palette = stage.palette;
    const blocks = Array.from({ length: 5 }, (_, blockIndex) => {
      const x = 13 + blockIndex * 27;
      const y = 35 + ((stage.seed + blockIndex * 11) % 30);
      const width = 12 + ((stage.seed + blockIndex * 7) % 13);
      const height = 10 + ((stage.seed + blockIndex * 5) % 18);
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1" fill="${blockIndex % 2 === 0 ? palette.wall : palette.obstacle}" opacity="${0.68 + blockIndex * 0.05}"/>`;
    }).join('');
    const routeY = 28 + ((stage.seed * 3) % 42);
    return `
      <svg viewBox="0 0 160 92" role="img" aria-label="${stage.name}の戦域プレビュー">
        <title>${stage.name}の戦域プレビュー</title>
        <rect width="160" height="92" fill="${palette.sky}"/>
        <path d="M0 29 34 18l32 12 30-17 64 21v58H0Z" fill="${palette.floor}"/>
        <g>${blocks}</g>
        <path d="M8 ${routeY} C42 ${routeY - 18}, 78 ${routeY + 20}, 151 ${routeY - 7}" fill="none" stroke="${palette.accent}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${index % 2 === 0 ? '1 7' : '8 5'}"/>
        <circle cx="${24 + ((stage.seed * 2) % 104)}" cy="${24 + (stage.seed % 48)}" r="4" fill="${palette.accent}"/>
        <path d="M12 12h28M12 17h18" stroke="${palette.lightColor}" stroke-width="2" opacity=".72"/>
      </svg>`;
  }

  private renderWeapons(): void {
    const list = this.query('weapons');
    const level = this.playerLevel();
    // 保存されていた選択がロック中(記録の読み込み直後など)なら初期武器へ戻す
    if (!isUnlocked('weapon', this.selection.primaryId, level)) {
      this.selection.primaryId = 'kaede-ar';
    }
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id];
      if (!def) continue;
      const bars = WEAPON_BARS[id] ?? { power: 5, rate: 5, control: 5 };
      const unlocked = isUnlocked('weapon', id, level);
      const card = document.createElement('button');
      card.className = unlocked ? 'weapon-card' : 'weapon-card locked';
      card.dataset.weapon = id;
      const mode = def.mode === 'auto' ? 'フルオート' : def.mode === 'burst' ? 'バースト' : '単発';
      const lockNote = unlocked
        ? ''
        : `<span class="locked-note">Lv ${unlockLevelOf('weapon', id)} で解放</span>`;
      card.innerHTML = `
        <span class="weapon-name">${def.name}</span>
        <span class="weapon-mode">${mode} / 装弾数 ${def.magazineSize}</span>
        ${this.bar('火力', bars.power)}
        ${this.bar('連射', bars.rate)}
        ${this.bar('制御', bars.control)}
        ${lockNote}
      `;
      if (unlocked) {
        card.addEventListener('click', () => {
          this.selection.primaryId = id;
          this.markSelected(list, 'weapon', id);
          this.renderBriefing();
        });
      } else {
        card.disabled = true;
      }
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'weapon', this.selection.primaryId);
  }

  private bar(label: string, value: number): string {
    // 数値も併記し、棒はscaleXで描く(GPU合成・リフローなし)
    return `
      <span class="stat-row">
        <span class="stat-label">${label}</span>
        <span class="stat-bar"><i style="transform:scaleX(${value / 10})"></i></span>
        <span class="stat-num">${value}</span>
      </span>`;
  }

  private renderProfile(): void {
    const panel = this.query('profile');
    const level = levelFromXp(this.profile.xp);
    const rank = rankFromRating(this.profile.rating);
    const stats = this.profile.stats;
    const winRate = stats.matches > 0 ? ((stats.wins / stats.matches) * 100).toFixed(0) : '-';
    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
    const accuracy =
      stats.shotsFired > 0 ? ((stats.shotsHit / stats.shotsFired) * 100).toFixed(1) : '-';
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const records = this.profile.records;
    const streakNow =
      records.currentWinStreak >= 2
        ? ` <span class="profile-streak">${records.currentWinStreak}連勝中</span>`
        : '';
    const recordsLine =
      records.mostKills > 0 || records.bestWinStreak > 0
        ? `<div class="profile-records">自己ベスト 最多キル <b>${records.mostKills}</b> / 最長連勝 <b>${records.bestWinStreak}</b>${streakNow}</div>`
        : '';
    panel.innerHTML = `
      <div class="profile-top">
        <span class="profile-rank">${rank.name}</span>
        <span class="profile-rating">レート ${this.profile.rating}</span>
        <span class="profile-level">Lv ${level.level}</span>
      </div>
      <div class="profile-xpbar"><i style="width:${xpRatio}%"></i></div>
      <div class="profile-stats">${stats.matches}戦 / 勝率 ${winRate}% / K/D ${kd} / 命中 ${accuracy}%</div>
      ${recordsLine}
      <div class="profile-actions">
        <button class="profile-btn" data-id="export">記録を書き出す</button>
        <button class="profile-btn" data-id="import">記録を読み込む</button>
      </div>
    `;
    this.query('export').addEventListener('click', () => exportProfile(this.profile));
    this.query('import').addEventListener('click', () => {
      importProfile((imported) => {
        Object.assign(this.profile, imported);
        saveProfile(this.profile);
        this.showMain();
      });
    });
  }

  private renderChallenges(): void {
    const list = this.query('challenges');
    for (const challenge of CHALLENGES) {
      const done = this.profile.completedChallenges.includes(challenge.id);
      const [current, goal] = challenge.progress(this.profile.stats, this.profile.weaponKills);
      const row = document.createElement('div');
      row.className = done ? 'challenge-row challenge-done' : 'challenge-row';
      row.innerHTML = `
        <span class="challenge-name">${challenge.name}</span>
        <span class="challenge-desc">${challenge.desc}</span>
        <span class="challenge-bar"><i style="width:${done ? 100 : (current / goal) * 100}%"></i></span>
        <span class="challenge-xp">${done ? '達成' : `${challenge.xp} XP`}</span>
      `;
      list.appendChild(row);
    }
    this.stagger(list);
  }

  private renderModes(): void {
    const list = this.query('modes');
    for (const id of MODE_IDS) {
      const def = MODE_DEFS[id];
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.dataset.mode = id;
      card.innerHTML = `
        <span class="mode-name">${def.name}</span>
        <span class="mode-desc">${def.desc}</span>
      `;
      card.addEventListener('click', () => {
        this.selection.mode = id;
        this.markSelected(list, 'mode', id);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'mode', this.selection.mode);
  }

  private renderAttachments(): void {
    const panel = this.query('attachments');
    const level = this.playerLevel();
    for (const { slot, label } of ATTACHMENT_SLOTS) {
      // ロック中のアタッチメントが選択に残っていたら外す
      const selected = this.attachmentBySlot[slot];
      if (selected && !isUnlocked('attachment', selected, level)) {
        this.attachmentBySlot[slot] = null;
      }
      const row = document.createElement('div');
      row.className = 'attach-row';
      const name = document.createElement('span');
      name.className = 'attach-slot';
      name.textContent = label;
      row.appendChild(name);

      const buttons = document.createElement('div');
      buttons.className = 'attach-options';
      const choices: Array<{ id: string | null; text: string; title: string }> = [
        { id: null, text: 'なし', title: '' },
        ...attachmentsForSlot(slot).map((a) => ({
          id: a.id,
          text: a.name,
          title: a.cons === 'なし' ? a.pros : `${a.pros} / ${a.cons}`,
        })),
      ];
      for (const choice of choices) {
        const btn = document.createElement('button');
        btn.className = 'attach-btn';
        btn.textContent = choice.text;
        if (choice.title) btn.title = choice.title;
        btn.dataset.attach = choice.id ?? 'none';
        if (choice.id && !isUnlocked('attachment', choice.id, level)) {
          btn.classList.add('locked');
          btn.disabled = true;
          btn.title = `Lv ${unlockLevelOf('attachment', choice.id)} で解放`;
          buttons.appendChild(btn);
          continue;
        }
        btn.addEventListener('click', () => {
          this.attachmentBySlot[slot] = choice.id;
          this.syncAttachments();
          buttons.querySelectorAll('.attach-btn').forEach((node) => {
            const on = (node as HTMLElement).dataset.attach === (choice.id ?? 'none');
            node.classList.toggle('selected', on);
            node.setAttribute('aria-pressed', String(on));
          });
          this.renderBriefing();
        });
        const active = (this.attachmentBySlot[slot] ?? 'none') === (choice.id ?? 'none');
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', String(active));
        buttons.appendChild(btn);
      }
      row.appendChild(buttons);
      panel.appendChild(row);
    }
    this.syncAttachments();
  }

  private renderGrenades(): void {
    const list = this.query('grenades');
    for (const kind of GRENADE_KINDS) {
      const spec = GRENADE_SPECS[kind];
      const card = document.createElement('button');
      card.className = 'grenade-card';
      card.dataset.grenade = kind;
      card.innerHTML = `
        <span class="grenade-name">${spec.name} <span class="grenade-carry">x ${spec.carry}</span></span>
        <span class="grenade-desc">${GRENADE_DESCS[kind]}</span>
      `;
      card.addEventListener('click', () => {
        this.selection.grenade = kind;
        this.markSelected(list, 'grenade', kind);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'grenade', this.selection.grenade);
  }

  private renderDifficulties(): void {
    const list = this.query('difficulties');
    for (const item of DIFFICULTIES) {
      const card = document.createElement('button');
      card.className = 'difficulty-card';
      card.dataset.difficulty = item.id;
      card.innerHTML = `<span class="difficulty-name">${item.label}</span><span class="difficulty-desc">${item.desc}</span>`;
      card.addEventListener('click', () => {
        this.selection.difficulty = item.id;
        this.markSelected(list, 'difficulty', item.id);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'difficulty', this.selection.difficulty);
  }

  private renderBriefing(): void {
    const stage = STAGES.find((item) => item.id === this.selection.stageId) ?? STAGES[0];
    const mode = MODE_DEFS[this.selection.mode];
    const weapon = WEAPON_DEFS[this.selection.primaryId];
    const grenade = GRENADE_SPECS[this.selection.grenade];
    const difficulty = DIFFICULTIES.find((item) => item.id === this.selection.difficulty);
    this.query('brief-stage').textContent = stage?.name ?? '-';
    this.query('brief-mode').textContent = mode.name;
    this.query('brief-weapon').textContent = weapon?.name ?? '-';
    this.query('brief-grenade').textContent =
      this.selection.attachments.length > 0
        ? `${grenade.name} / Attach ${this.selection.attachments.length}`
        : grenade.name;
    this.query('brief-difficulty').textContent = difficulty?.label ?? '-';
  }

  private markSelected(container: HTMLElement, key: string, value: string): void {
    container.querySelectorAll<HTMLElement>('[data-' + key + ']').forEach((node) => {
      const on = node.dataset[key] === value;
      node.classList.toggle('selected', on);
      // 選択トグルであることと現在の状態を支援技術へ伝える
      node.setAttribute('aria-pressed', String(on));
    });
  }

  private renderControls(): void {
    const grid = this.query('controls');
    for (const [label, keys] of CONTROLS) {
      const action = document.createElement('span');
      action.className = 'control-action';
      action.textContent = label;
      const key = document.createElement('span');
      key.className = 'control-key';
      key.textContent = keys;
      grid.append(action, key);
    }
  }

  private renderSettings(container: HTMLElement): void {
    container.className = 'settings-panel';
    container.innerHTML = '';
    container.append(
      this.slider('マウス感度', 0.2, 3, 0.05, this.settings.sensitivity, (v) => {
        this.settings.sensitivity = v;
      }),
      this.slider('視野角(FOV)', 60, 110, 1, this.settings.fov, (v) => {
        this.settings.fov = v;
      }),
      this.slider('全体音量', 0, 1, 0.05, this.settings.volMaster, (v) => {
        this.settings.volMaster = v;
      }),
      this.slider('効果音量', 0, 1, 0.05, this.settings.volSfx, (v) => {
        this.settings.volSfx = v;
      }),
      this.slider('UI音量', 0, 1, 0.05, this.settings.volUi, (v) => {
        this.settings.volUi = v;
      }),
      this.slider('UIの大きさ', 0.8, 1.3, 0.05, this.settings.uiScale, (v) => {
        this.settings.uiScale = v;
      }),
      this.checkbox('ADSをトグルにする', this.settings.adsToggle, (v) => {
        this.settings.adsToggle = v;
      }),
      this.checkbox('しゃがみをトグルにする', this.settings.crouchToggle, (v) => {
        this.settings.crouchToggle = v;
      }),
      this.checkbox('Y軸を反転する', this.settings.invertY, (v) => {
        this.settings.invertY = v;
      }),
      this.checkbox('画面の揺れを軽減する', this.settings.reduceMotion, (v) => {
        this.settings.reduceMotion = v;
      }),
      this.select(
        'UIのアクセント',
        UI_ACCENTS.map((a) => ({ value: a.id, label: a.name })),
        this.settings.uiAccent,
        (v) => {
          this.settings.uiAccent = v;
        },
      ),
      this.select(
        '敵味方の配色',
        TEAM_PALETTES.map((p) => ({ value: p.id, label: p.name })),
        this.settings.teamPaletteId,
        (v) => {
          this.settings.teamPaletteId = v;
        },
      ),
      this.select(
        '試合時間',
        MATCH_LENGTHS.map((m) => ({ value: String(m.value), label: m.label })),
        String(this.settings.matchLengthS),
        (v) => {
          this.settings.matchLengthS = Number(v);
        },
      ),
      this.checkbox('エイムアシスト', this.settings.aimAssist, (v) => {
        this.settings.aimAssist = v;
      }),
      this.slider('エイムアシスト強度', 0, 1, 0.05, this.settings.aimAssistStrength, (v) => {
        this.settings.aimAssistStrength = v;
      }),
      this.slider('ADS感度倍率', 0.3, 1.5, 0.05, this.settings.adsSensMul, (v) => {
        this.settings.adsSensMul = v;
      }),
      this.slider('画面の揺れ', 0, 1, 0.05, this.settings.screenShake, (v) => {
        this.settings.screenShake = v;
      }),
      this.checkbox('簡易レーダーを表示', this.settings.radarEnabled, (v) => {
        this.settings.radarEnabled = v;
      }),
      this.slider('アナウンサー音量', 0, 1, 0.05, this.settings.announcerVolume, (v) => {
        this.settings.announcerVolume = v;
      }),
      this.select(
        'レティクル形状',
        RETICLE_STYLES.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleStyle,
        (v) => {
          this.settings.reticleStyle = v;
        },
      ),
      this.select(
        'レティクル色',
        RETICLE_COLORS.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleColor,
        (v) => {
          this.settings.reticleColor = v;
        },
      ),
    );

    // 設定を既定へ戻すボタン
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'setting-reset';
    reset.textContent = '設定を既定に戻す';
    reset.addEventListener('click', () => {
      Object.assign(this.settings, DEFAULT_SETTINGS);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderSettings(container);
    });
    container.appendChild(reset);
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const display = document.createElement('span');
    display.className = 'setting-value';
    display.textContent = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      apply(v);
      display.textContent = String(v);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input, display);
    return row;
  }

  // 汎用セレクト。反映タイミングは項目による(配色/試合時間は次の試合開始時、
  // アクセント色やレティクルは即時)
  private select(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    apply: (v: string) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      input.appendChild(node);
    }
    input.value = value;
    input.addEventListener('change', () => {
      apply(input.value);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input);
    return row;
  }

  private checkbox(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row setting-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    const text = document.createElement('span');
    text.textContent = label;
    input.addEventListener('change', () => {
      apply(input.checked);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(input, text);
    return row;
  }
}
