import '../mk3-menu.css';
import './enza-top.css'; // W-ENZA FB6: 焔座トップメニュー(.etop-*)
import '../mk3-phase2.css'; // R54-F7: ハイライトカード/フォトモード様式(p2-)
// ── W-ENZA FA2: 画面モジュール分割(機械的移送)。公開APIは不変 ──
import * as armoryScreen from './menu-screens/armory';
import * as resultScreen from './menu-screens/result';
import * as settingsScreen from './menu-screens/settings';
import * as lobbyScreen from './menu-screens/lobby';
import type { MenuScreenHost } from './menu-screens/host';
import { mountTitle } from './menu-screens/title';
import { BUILD_LABEL } from '../version';
import { type GamepadBinding, type PadAction } from '../core/gamepad';
import type { Input, UiNav } from '../core/input';
import { exportProfile, importProfile, saveProfile } from '../core/profile';
import { type Settings } from '../core/settings';
import { applyAttachments, ATTACHMENT_DEFS, type AttachmentSlot } from '../game/attachments';
import { GRENADE_KINDS } from '../game/grenades';
import type { MatchResult } from '../game/match';
import { MODE_IDS } from '../game/modes';
import { CAMPAIGN, type MissionDef } from '../game/campaign';
import {
  levelFromXp,
  rankFromRating,
  rankNameFor,
  type CampaignProgress,
  type CharmId,
  type MatchProgress,
  type Profile,
} from '../game/progression';
import { type CamoId } from '../game/camo';
// R53-W2: お守り(CHARMS)/ゾンビパーク(PERKS)は zombie-economy.ts が単一の真実。
// メニューは「継承の守り札」用のcarriedPerk解決(PERKS存在チェックのみ)にZombiePerkIdを使う
import { STAGES } from '../game/stages';
import type { SpaceBg } from './menu-bg';
import { WeaponPreview } from '../render/weapon-preview';
import {
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  type WeaponClass,
  type WeaponDef,
} from '../game/weapons';

// 旧 menu.ts 公開名の互換再export(単一の真実は menu-screens/shared.ts)
export type {
  MenuSelection,
  MenuCallbacks,
  DiffChip,
  StoryTone,
  StoryMarker,
} from './menu-screens/shared';
export {
  campaignTotals,
  missionRewardLabel,
  charmChipStatus,
  readLastZombiePerk,
  resolveCarriedPerk,
  latestTitle,
  weaponDiffChips,
  rankStampChar,
  EXOTIC_LORE,
  matchStoryMarkers,
} from './menu-screens/shared';
export { LAST_ZOMBIE_PERK_KEY } from '../game/zombie-economy';
import {
  LOADOUT_KEY,
  campaignTotals,
  latestTitle,
  rankStampChar,
  readLastZombiePerk,
  resolveCarriedPerk,
} from './menu-screens/shared';
import type { MenuSelection, MenuCallbacks, GradeInfo } from './menu-screens/shared';

export class Menu {
  private selection: MenuSelection = {
    stageId: STAGES[0]?.id ?? 'kunren',
    mode: 'ffa',
    primaryId: 'kaede-ar',
    attachments: [],
    grenade: 'frag',
    difficulty: 'normal',
    secondaryId: 'suzume',
    hellMode: false,
    allGiantMode: false,
    rogueRun: false,
    missionDifficulty: 'normal',
  };
  private weaponPreview: WeaponPreview | null = null; // ARMORYの3Dプレビュー(遅延生成)
  private readonly attachmentBySlot: Record<AttachmentSlot, string | null> = {
    sight: null,
    muzzle: null,
    grip: null,
    mag: null,
  };
  private activePage = 'deploy'; // 現在表示中のMFDページ
  private capturingAction: PadAction | null = null; // リバインド捕捉中のアクション
  private bindNote = ''; // 競合解消などの通知文(リバインド表の下に表示)
  private captureCleanup: (() => void) | null = null; // 捕捉中の keydown リスナ等の後始末
  private bg: SpaceBg | null = null; // メニュー背景の宇宙(ページ連動カメラ)。attachBgで注入
  private wipeTimer = 0; // 画面遷移ワイプのフォールバックタイマ(animationend不発でも畳む)
  private mfdWiped = false; // 初回マウントはワイプ抑止(ベゼル入場と二重演出にしない)
  private gradeSeq = 0; // 戦闘評価シジルの一意ID用カウンタ(gradient/filterのid衝突回避)
  // W-ENZA FB6: 起動後にタイトル画面(FB5)を一度だけ挟む。ゲームスタートで解除
  private titleDismissed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly profile: Profile,
    private readonly callbacks: MenuCallbacks,
    private readonly input: Input,
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
      if (saved.primaryId && PRIMARY_IDS.includes(saved.primaryId)) {
        this.selection.primaryId = saved.primaryId;
      }
      if (saved.secondaryId && SECONDARY_IDS.includes(saved.secondaryId)) {
        this.selection.secondaryId = saved.secondaryId;
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
      // R53-W2: ストーリーミッション難易度(既定normal)。既存のdifficulty永続化と同じ流儀
      if (saved.missionDifficulty && ['easy', 'normal', 'hard'].includes(saved.missionDifficulty)) {
        this.selection.missionDifficulty = saved.missionDifficulty;
      }
      // V27修正: 保存はされるが復元されていなかった(往復の非対称)。クランプして復元
      if (typeof saved.zombieStartRound === 'number') {
        this.selection.zombieStartRound = Math.max(
          1,
          Math.min(999, Math.round(saved.zombieStartRound)),
        );
      }
      if (typeof saved.hellMode === 'boolean') this.selection.hellMode = saved.hellMode;
      if (typeof saved.allGiantMode === 'boolean') this.selection.allGiantMode = saved.allGiantMode;
      if (typeof saved.rogueRun === 'boolean') this.selection.rogueRun = saved.rogueRun;
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

  // main.ts から宇宙背景を注入する。初回フォーカスを即送出して画角を現在ページへ一致させる
  attachBg(bg: SpaceBg): void {
    this.bg = bg;
    bg.setFocus(this.activePage);
  }

  // 背景の遷移状態(recede/soft/killcam)を一括で解除し、宇宙背景のDoFも戻す。
  // hide()とshowMain()冒頭で呼び、モーダル由来の暗転やワイプがメニューに残らないようにする
  private clearBgTransition(): void {
    document.body.classList.remove('bg-recede', 'bg-soft', 'killcam-active');
    this.bg?.setModalDim(0);
    if (this.wipeTimer !== 0) {
      window.clearTimeout(this.wipeTimer);
      this.wipeTimer = 0;
    }
  }

  hide(): void {
    // メニューを隠す瞬間に必ずリバインド捕捉を畳む。捕捉中のまま試合へ復帰すると
    // 最初のパッド入力がリバインドに食われ、設定が静かに書き換わるのを防ぐ
    this.endCapture();
    this.teardownPreview();
    this.clearBgTransition();
    this.root.hidden = true;
  }

  // ── コントローラだけでのメニュー操作(トップページ含む全画面) ──
  // D-pad/左スティック=フォーカス移動, ×=決定, ○=戻る, L1/R1=MFDタブ切替,
  // セレクト/スライダーに合わせている時は左右で値を増減する。
  handleGamepad(nav: UiNav): void {
    if (this.root.hidden || this.capturingAction) return; // リバインド捕捉中は介入しない
    const list = this.focusables();
    if (list.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    // まだ何も選んでいなければ最初の要素を選ぶだけ(初回の方向入力でハイライト)
    if (idx < 0) {
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm) {
        list[0]?.focus();
        list[0]?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    if (nav.tabPrev || nav.tabNext) {
      this.cycleMfdPage(nav.tabNext ? 1 : -1);
      return;
    }

    // セレクト/スライダーは左右で値を変える(上下はフォーカス移動)
    const cur = list[idx];
    if (cur instanceof HTMLSelectElement && (nav.left || nav.right)) {
      const n = cur.options.length;
      cur.selectedIndex = Math.max(0, Math.min(n - 1, cur.selectedIndex + (nav.right ? 1 : -1)));
      cur.dispatchEvent(new Event('change'));
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range' && (nav.left || nav.right)) {
      const step = Number(cur.step) || 1;
      const v = Number(cur.value) + (nav.right ? step : -step);
      cur.value = String(Math.max(Number(cur.min), Math.min(Number(cur.max), v)));
      cur.dispatchEvent(new Event('input'));
      return;
    }

    if (nav.up || (nav.left && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx - 1);
      return;
    }
    if (nav.down || (nav.right && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx + 1);
      return;
    }
    if (nav.confirm) {
      const el = list[idx];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.click();
      else el?.click();
      return;
    }
    if (nav.back) this.gamepadBack();
  }

  // 現在の画面で見えている操作可能要素(ボタン/セレクト/入力)
  private focusables(): HTMLElement[] {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  private focusAt(list: HTMLElement[], i: number): void {
    const n = list.length;
    const idx = ((i % n) + n) % n;
    const el = list[idx];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  private cycleMfdPage(dir: number): void {
    const tabs = ['campaign', 'deploy', 'armory', 'intel', 'system'];
    const i = tabs.indexOf(this.activePage);
    if (i < 0) return; // メインMFD以外(ポーズ/結果)ではタブ切替しない
    const next = tabs[(i + dir + tabs.length) % tabs.length] ?? 'deploy';
    this.setMfdPage(next);
    this.focusables()[0]?.focus({ preventScroll: true });
  }

  // ○ボタン: 画面ごとの「戻る/再開」相当を押す
  private gamepadBack(): void {
    for (const id of ['brief-back', 'to-campaign', 'menu', 'quit', 'resume', 'retry-mission']) {
      const el = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el && el.offsetParent !== null) {
        el.click();
        return;
      }
    }
  }

  // リバインド捕捉の後始末を一箇所に集約する。Input側のコールバック解除・
  // keydownリスナ除去・捕捉状態クリアを冪等に行う
  private endCapture(): void {
    this.input.cancelCapture();
    if (this.captureCleanup) {
      this.captureCleanup();
      this.captureCleanup = null;
    }
    this.capturingAction = null;
  }

  showMain(): void {
    // ── W-ENZA FB6: 初回はタイトル画面(FB5実装)を挟む。スタブ(空要素)の間は素通り ──
    if (!this.titleDismissed) {
      const titleEl = mountTitle(this.screenHost(), () => {
        this.titleDismissed = true;
        this.showMain();
      });
      if (titleEl.childElementCount > 0) {
        this.clearBgTransition();
        this.teardownPreview();
        this.root.hidden = false;
        this.root.innerHTML = '';
        this.root.appendChild(titleEl);
        this.bg?.setScene('title');
        return;
      }
      // FB5未着地(スタブ)の間はタイトルなし起動として確定させる
      this.titleDismissed = true;
    }
    this.clearBgTransition();
    this.mfdWiped = false; // 再マウント: 最初の setMfdPage はワイプせず即時
    this.teardownPreview();
    this.root.hidden = false;
    // ── 焔座トップメニューの実データ(モック文言のハードコード禁止 — 全て実プロファイル/定義から) ──
    const level = levelFromXp(this.profile.xp);
    const rankName = rankNameFor(level.level).name;
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const stats = this.profile.stats;
    const records = this.profile.records;
    const profileTitle = latestTitle(this.profile.titles);
    const cleared = new Set(this.profile.campaign.clearedMissions);
    const totals = campaignTotals(CAMPAIGN);
    const nextEntry = CAMPAIGN.flatMap((c) => c.missions.map((m) => ({ ch: c, m }))).find(
      (x) => !cleared.has(x.m.id),
    );
    const primaryName = WEAPON_DEFS[this.selection.primaryId]?.name ?? '—';
    const navSub = {
      campaign: `制圧 ${cleared.size}/${totals.missions}`,
      deploy: `対戦${MODE_IDS.length}モード · ${STAGES.length}ステージ`,
      armory: `兵装${PRIMARY_IDS.length + SECONDARY_IDS.length}種 · ${primaryName}`,
      intel: `撃破 ${stats.kills.toLocaleString('ja-JP')} · 最長連勝 ${records.bestWinStreak}`,
      system: '設定 · 操作 · プロファイル',
    };
    const navItem = (
      num: string,
      page: string,
      kanji: string,
      kicker: string,
      sub: string,
    ): string => `
      <button class="mfd-tab etop-navitem" type="button" role="tab" data-page="${page}" id="mfd-tab-${page}" aria-controls="mfd-panel-${page}">
        <b class="etop-nav-num enza-num" aria-hidden="true">${num}</b>
        <span class="etop-nav-main"><span class="etop-nav-kanji">${kanji}</span><small class="etop-nav-kicker">${kicker}</small></span>
        <span class="etop-nav-sub">${sub}</span>
      </button>`;
    this.root.innerHTML = `
      <div class="menu-screen menu-main etop-root">
        <header class="etop-header">
          <div class="etop-brand">
            <span class="etop-brand-kicker">ブラウザFPS — 熾火の系譜</span>
            <h1 class="etop-wordmark" aria-label="FPS-reFlesh"><span>FPS-RE</span><em>FLESH</em></h1>
          </div>
          <div class="etop-header-side">
            <div class="etop-meta enza-num" aria-hidden="true">焔座 ENZA UI · BUILD ${BUILD_LABEL}</div>
            <aside class="etop-player" aria-label="プロファイル">
              <span class="etop-player-stamp" aria-hidden="true"><b>${rankStampChar(rankName)}</b></span>
              <div class="etop-player-body">
                <span class="etop-player-kicker">超越階級${profileTitle ? ` · ${profileTitle}` : ''}</span>
                <b class="etop-player-rank">${rankName}</b>
                <div class="etop-player-lvrow">
                  <span class="etop-player-lv enza-num">Lv ${level.level.toLocaleString('ja-JP')}</span>
                  <span class="etop-player-pct enza-num">${Math.round(xpRatio)}%</span>
                </div>
                <div class="etop-xpbar" role="img" aria-label="次のレベルまで${Math.round(xpRatio)}%"><i style="width:${xpRatio}%"></i></div>
              </div>
            </aside>
          </div>
        </header>
        <p class="menu-touchnote etop-touchnote">この作品はキーボードとマウスで操作します。スマートフォンやタブレットでは遊べません。PCで開いてください。</p>
        <div class="etop-body">
          <div class="etop-left">
            <nav class="mfd-rail etop-nav" role="tablist" aria-label="管制ページ">
              ${navItem('01', 'campaign', '戦役', 'CAMPAIGN', navSub.campaign)}
              ${navItem('02', 'deploy', '出撃', 'SORTIE', navSub.deploy)}
              ${navItem('03', 'armory', '武器庫', 'ARMORY', navSub.armory)}
              ${navItem('04', 'intel', '戦況', 'INTEL', navSub.intel)}
              ${navItem('05', 'system', '系統', 'SYSTEM', navSub.system)}
              <i class="mfd-ink" aria-hidden="true"></i>
            </nav>
            <aside class="etop-dock">
              <button class="etop-continue" data-id="etop-continue" type="button">
                <span class="etop-dock-kicker">キャンペーン続行</span>
                <b class="etop-continue-name">${nextEntry ? `${nextEntry.ch.title} — ${nextEntry.m.title}` : '全戦役 制圧済み'}</b>
                <span class="etop-continue-prog enza-num">${cleared.size}/${totals.missions} 制圧 · ★${totals.starsMax}満点</span>
              </button>
              <section class="daily-panel etop-daily" aria-label="本日のチャレンジ" data-id="daily-panel"></section>
            </aside>
          </div>
          <div class="mfd-deck etop-deck">
            <section class="mfd-page" data-page="campaign" role="tabpanel" id="mfd-panel-campaign" aria-labelledby="mfd-tab-campaign" hidden>
              <div class="campaign-screen" data-id="campaign"></div>
            </section>
            <section class="mfd-page" data-page="deploy" role="tabpanel" id="mfd-panel-deploy" aria-labelledby="mfd-tab-deploy">
              <div class="etop-squad-slot" data-id="squad-card"></div>
              <div class="mfd-cols mfd-cols--deploy">
                <section class="menu-section">
                  <h2>降下目標</h2>
                  <div class="stage-grid" data-id="stages"></div>
                </section>
                <section class="menu-section">
                  <h2>交戦規定</h2>
                  <div class="mode-list" data-id="modes"></div>
                </section>
                <section class="menu-section zombie-round-section" data-id="rogue-wrap" hidden>
                  <h2>輪廻(ローグラン)</h2>
                  <label class="menu-toggle"><input type="checkbox" data-id="rogueRun"><span>輪廻で出撃<small class="toggle-desc"> — ミサゴ拳銃のみ・R1固定で開始し、ラウンドクリアごとに供物カードで強化を積む。累計到達で恒久の加護が解放。お守り/開始ラウンド/超鬼畜/全巨躯とは排他</small></span></label>
                </section>
                <section class="menu-section zombie-round-section" data-id="zombie-round-wrap" hidden>
                  <h2>開始ラウンド</h2>
                  <div class="zombie-round-selector" data-id="zombie-round-selector"></div>
                </section>
                <section class="menu-section">
                  <h2>脅威レベル</h2>
                  <div class="difficulty-list" data-id="difficulties"></div>
                </section>
                <section class="menu-section">
                  <h2>特殊オプション</h2>
                  <label class="menu-toggle"><input type="checkbox" data-id="hellMode"><span>超鬼畜モード<small class="toggle-desc"> — 全敵HP/攻撃力/速度が大幅強化。達人向け高難度(ゾンビにも適用)</small></span></label>
                  <label class="menu-toggle"><input type="checkbox" data-id="allGiantMode"><span>全巨躯モード<small class="toggle-desc"> — 全敵がエリートサイズ。視認困難+追尾射撃(ゾンビにも適用)</small></span></label>
                </section>
                <section class="menu-section zombie-round-section" data-id="charm-wrap" hidden>
                  <h2>お守り</h2>
                  <div class="charm-grid" data-id="charm-grid"></div>
                </section>
              </div>
              <div class="etop-stageband-slot" data-id="stage-band"></div>
            </section>
            <section class="mfd-page" data-page="armory" role="tabpanel" id="mfd-panel-armory" aria-labelledby="mfd-tab-armory" hidden>
              <div class="armory-layout">
                <div class="armory-list">
                  <section class="menu-section">
                    <h2>メイン武器</h2>
                    <div class="wclass-tabs" data-id="wclass-tabs" role="tablist" aria-label="武器クラス"></div>
                    <div class="weapon-grid" data-id="weapons"></div>
                  </section>
                  <section class="menu-section">
                    <h2>副武器</h2>
                    <div class="weapon-grid weapon-grid--sec" data-id="secondaries"></div>
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
                <aside class="armory-preview ig-panel ig-scan">
                  <canvas class="weapon-canvas" data-id="weapon-canvas"></canvas>
                  <div class="armory-readout">
                    <div class="armory-wname" data-id="armory-wname"></div>
                    <div class="armory-bars" data-id="armory-bars"></div>
                    <div class="armory-stats" data-id="armory-stats"></div>
                    <div class="armory-camo" data-id="armory-camo" hidden></div>
                    <div class="mk3m-exotic-lore" data-id="armory-exotic" hidden></div>
                    <p class="armory-hint">ドラッグで回転・クリックで空撃ち・武器をクリックで選択</p>
                  </div>
                </aside>
              </div>
              <div class="etop-armory-launch">
                <button class="menu-start enza-cta etop-start etop-armory-start" data-id="armory-start">
                  <i class="mk3m-hold-fill" aria-hidden="true"></i>
                  <span class="etop-start-label">この兵装で出撃</span>
                  <small class="etop-start-hint">長押しで降下</small>
                </button>
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
        <section class="etop-launch" aria-label="出撃構成">
          <dl class="etop-brief">
            <div><dt>降下地点</dt><dd data-id="brief-stage"></dd></div>
            <div><dt>交戦規定</dt><dd data-id="brief-mode"></dd></div>
            <div><dt>主兵装</dt><dd data-id="brief-weapon"></dd></div>
            <div><dt>投擲</dt><dd data-id="brief-grenade"></dd></div>
            <div><dt>脅威</dt><dd data-id="brief-difficulty"></dd></div>
            <div data-id="brief-zombie-round" hidden><dt>開始R</dt><dd data-id="brief-zombie-round-val"></dd></div>
          </dl>
          <button class="menu-start enza-cta etop-start" data-id="start">
            <i class="mk3m-hold-fill" aria-hidden="true"></i>
            <span class="etop-start-label">出撃する</span>
            <small class="etop-start-hint">長押しで降下</small>
          </button>
        </section>
        <footer class="etop-foot" aria-hidden="true">
          <span class="etop-copy">© 2026 MIRUKY WORKS · TypeScript + Three.js + Rapier · 完全ブラウザ動作</span>
          <span class="etop-hints enza-num">▲▼ 選択 · Enter 決定 · ←→ ページ · Esc ポーズ</span>
        </footer>
      </div>
    `;
    this.renderProfile();
    this.renderChallenges();
    this.renderDailies();
    this.renderStages();
    this.renderModes();
    this.renderZombieRoundSelector();
    this.renderCharmSelector();
    this.renderRogueToggle();
    this.renderWeapons();
    this.renderSecondaries();
    this.renderAttachments();
    this.renderGrenades();
    this.renderDifficulties();
    this.renderSpecialOptions();
    this.renderSettings(this.query('settings'));
    this.renderControls();
    this.renderCampaign();
    this.renderBriefing();
    this.wireMfd();
    this.query('etop-continue').addEventListener('click', () => this.setMfdPage('campaign'));
    // R53 MK.III: 出撃レバーは hold-to-launch(ポインタ300ms長押し)。キーボード/
    // ゲームパッド(el.click()=detail 0)は従来どおり即時発火(パッドの長押し入力経路が
    // 無いため — 判断は実装報告に記載)
    const launch = (): void => {
      this.saveLoadout();
      // R53-W2: 「継承の守り札」装備時のみ、前試合の最終パークをlocalStorageから解決する
      // (書き込み側はmatch.ts担当で今回未配線。未設定なら常にundefinedの無害なノーオペ)
      this.selection.carriedPerk = resolveCarriedPerk(this.selection.charm, readLastZombiePerk());
      this.callbacks.onStart(this.selection);
    };
    this.wireHoldToLaunch(this.query('start'), launch);
    // W-ENZA FB6追補: 武器庫右下「この兵装で出撃」(モック04)。同一発火経路・別id
    this.wireHoldToLaunch(this.query('armory-start'), launch);
  }

  // R53 MK.III: hold-to-launch。ポインタは300ms長押しで発火(離すとキャンセル+フィル巻き戻し)。
  // detail===0 のclick(キーボードEnter/Space・ゲームパッドの el.click())は即時発火を維持する。
  // ポインタ由来のclick(detail>0)は hold 完了側で発火済みのため握りつぶす(二重発火防止)。
  private wireHoldToLaunch(btn: HTMLElement, fire: () => void): void {
    let timer = 0;
    const clear = (): void => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      btn.classList.remove('mk3m-holding');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.classList.add('mk3m-holding');
      timer = window.setTimeout(() => {
        timer = 0;
        btn.classList.remove('mk3m-holding');
        fire();
      }, 300);
    });
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('pointercancel', clear);
    // ★V-D修正: 押下保持中に alt-tab / タブ非表示になっても300msタイマーが発火しないよう
    // フォーカス喪失系でもキャンセルする(意図しない出撃の防止)
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') clear();
    });
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) {
        clear();
        fire();
      }
    });
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderCampaign(): void {
    lobbyScreen.renderCampaign(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private missionChip(mission: MissionDef): HTMLElement {
    return lobbyScreen.missionChip(this.screenHost(), mission);
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  showBriefing(mission: MissionDef): void {
    lobbyScreen.showBriefing(this.screenHost(), mission);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  showMissionResult(result: MatchResult, progress: CampaignProgress): void {
    resultScreen.showMissionResult(this.screenHost(), result, progress);
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
    // 初回マウント(wireMfd末の同一ページ呼び)はワイプ無しで即時。以降はワイプ演出。
    // ワイプは swap を同期実行するためフォーカス/プレビュー/aria の挙動は従来どおり。
    if (!this.mfdWiped) {
      this.mfdWiped = true;
      this.applyMfdPage(page);
      return;
    }
    this.wipe(() => this.applyMfdPage(page));
  }

  // 実際のページ差し替え。ページ連動の宇宙背景フォーカスとMFDインク移動もここで駆動する
  private applyMfdPage(page: string): void {
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
    // ARMORY表示時のみ3Dプレビューを起動(遅延生成)。他ページでは止める
    if (page === 'armory') this.mountWeaponPreview();
    else this.weaponPreview?.suspend();
    // ページに応じて宇宙背景の画角を寄せ、MFDインクを現在タブへ滑らせる
    this.bg?.setFocus(page);
    // W-ENZA: 背景シーンの単一切替点(FB7契約)。出撃管制=夕暮れ都市、他=宇宙+地球。
    // タイトル表示中の'title'はshowMain冒頭のタイトル分岐が担う(FA4契約: 冪等+0.6sクロスフェード)
    this.bg?.setScene(page === 'deploy' ? 'lobby' : 'top');
    this.updateMfdInk();
  }

  // MFDインク(選択タブへ滑るインジケータ)を現在タブの座標へ移す。
  // レイアウト確定後(rAF)に offset 系を読み、縦横どちらの表現にも使えるCSS変数で渡す
  private updateMfdInk(): void {
    const ink = this.root.querySelector<HTMLElement>('.mfd-ink');
    if (!ink) return;
    const page = this.activePage;
    requestAnimationFrame(() => {
      const tab = this.root.querySelector<HTMLElement>(`.mfd-tab[data-page="${page}"]`);
      if (!ink.isConnected || !tab) return;
      ink.style.setProperty('--ink-x', `${tab.offsetLeft}px`);
      ink.style.setProperty('--ink-y', `${tab.offsetTop}px`);
      ink.style.setProperty('--ink-w', `${tab.offsetWidth}px`);
      ink.style.setProperty('--ink-h', `${tab.offsetHeight}px`);
    });
  }

  // 画面遷移ワイプ。swap は同期実行(フォーカス/プレビュー/aria を既存どおり保つ)し、
  // 直後にデッキへ .wipe を一瞬載せて掃引で見せる。省モーションは swap のみで演出なし。
  // animationend 不発(タブ休止/GPU/CSS未適用)でも setTimeout フォールバックで確実に畳む。
  private wipe(swap: () => void): void {
    swap();
    if (this.prefersReducedMotion) return;
    const deck = this.root.querySelector<HTMLElement>('.mfd-deck');
    if (!deck) return;
    if (this.wipeTimer !== 0) window.clearTimeout(this.wipeTimer);
    deck.classList.remove('wipe');
    deck.getBoundingClientRect(); // reflowを強制し .wipe アニメを確実に再発火させる
    deck.classList.add('wipe');
    const clear = (): void => {
      if (this.wipeTimer !== 0) {
        window.clearTimeout(this.wipeTimer);
        this.wipeTimer = 0;
      }
      deck.classList.remove('wipe');
    };
    const onEnd = (e: AnimationEvent): void => {
      if (e.target !== deck) return; // 子ページの入場アニメのバブルは無視
      deck.removeEventListener('animationend', onEnd);
      clear();
    };
    deck.addEventListener('animationend', onEnd);
    // フォールバックは掃引アニメ長(mfd-wipe 0.36s)より確実に長く。短いとanimationend
    // 前に毎回打ち切ってしまい主経路が死ぬ。真の不発時のみ畳む保険にする
    this.wipeTimer = window.setTimeout(() => {
      deck.removeEventListener('animationend', onEnd);
      clear();
    }, 480);
  }

  // ARMORYの3D武器プレビューを必要時に生成・再開する
  private mountWeaponPreview(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-id="weapon-canvas"]');
    if (!canvas) return;
    if (!this.weaponPreview) {
      try {
        this.weaponPreview = new WeaponPreview(canvas);
        this.weaponPreview.setReduceMotion(this.prefersReducedMotion);
      } catch {
        // WebGLが使えない環境ではプレビュー無し(リスト/ステータスは従来通り出る)
        this.weaponPreview = null;
        return;
      }
    }
    this.weaponPreview.start();
    this.weaponPreview.resume();
    this.weaponPreview.resize();
    // 3Dとステータス読み出しを同じ武器へ同期(setWeaponだけだと読み出しが取り残される)
    this.previewWeapon(this.currentPrimaryDef());
  }

  // root.innerHTML を差し替える前に必ず呼ぶ。プレビューのGLコンテキストを確実に破棄する
  private teardownPreview(): void {
    if (this.weaponPreview) {
      this.weaponPreview.dispose();
      this.weaponPreview = null;
    }
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  showPause(): void {
    settingsScreen.showPause(this.screenHost());
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  showResult(result: MatchResult, progress: MatchProgress): void {
    resultScreen.showResult(this.screenHost(), result, progress);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private highlightsHtml(result: MatchResult): string {
    return resultScreen.highlightsHtml(this.screenHost(), result);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private matchStoryHtml(result: MatchResult, progress: MatchProgress): string {
    return resultScreen.matchStoryHtml(this.screenHost(), result, progress);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private gradeSigilHtml(grade: GradeInfo): string {
    return resultScreen.gradeSigilHtml(this.screenHost(), grade);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private progressHtml(progress: MatchProgress): string {
    return resultScreen.progressHtml(this.screenHost(), progress);
  }

  private query(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!node) throw new Error(`menu element not found: ${id}`);
    return node;
  }

  // prefers-reduced-motionの利用者には演出を飛ばして即値を見せる。
  // R14: OSのメディアクエリだけでなくアプリ内設定(画面の揺れを軽減)も併用(JS/WebGL演出の二重ゲート)
  private get prefersReducedMotion(): boolean {
    return (
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
      this.settings.reduceMotion
    );
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private countUp(el: HTMLElement, to: number, durationMs = 750): void {
    resultScreen.countUp(this.screenHost(), el, to, durationMs);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private stagger(container: HTMLElement): void {
    resultScreen.stagger(this.screenHost(), container);
  }

  // 分割委譲: menu-screens/result.ts へ移送済み
  private staggerXpList(): void {
    resultScreen.staggerXpList(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderStages(): void {
    lobbyScreen.renderStages(this.screenHost());
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderWeapons(): void {
    armoryScreen.renderWeapons(this.screenHost());
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private showWeaponClass(cls: WeaponClass): void {
    armoryScreen.showWeaponClass(this.screenHost(), cls);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderSecondaries(): void {
    armoryScreen.renderSecondaries(this.screenHost());
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private weaponCard(id: string, slot: 'primary' | 'secondary'): HTMLButtonElement {
    return armoryScreen.weaponCard(this.screenHost(), id, slot);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private refreshDiffChips(slot: 'primary' | 'secondary'): void {
    armoryScreen.refreshDiffChips(this.screenHost(), slot);
  }

  // 選択中の主武器(アタッチメント適用済み)
  private currentPrimaryDef(): WeaponDef {
    const base = WEAPON_DEFS[this.selection.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    return applyAttachments(base, this.selection.attachments);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private previewWeapon(def: WeaponDef): void {
    armoryScreen.previewWeapon(this.screenHost(), def);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderArmoryReadout(def: WeaponDef): void {
    armoryScreen.renderArmoryReadout(this.screenHost(), def);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderCamoSection(def: WeaponDef): void {
    armoryScreen.renderCamoSection(this.screenHost(), def);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderKunaiCamoSection(def: WeaponDef, host: HTMLElement): void {
    armoryScreen.renderKunaiCamoSection(this.screenHost(), def, host);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private camoChip(
    def: WeaponDef,
    camoId: CamoId | null,
    equipped: string | null,
    mastery = false,
    kunai = false,
  ): HTMLButtonElement {
    return armoryScreen.camoChip(this.screenHost(), def, camoId, equipped, mastery, kunai);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private equipCamo(def: WeaponDef, camoId: CamoId | null): void {
    armoryScreen.equipCamo(this.screenHost(), def, camoId);
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private bar(label: string, value: number): string {
    return armoryScreen.bar(this.screenHost(), label, value);
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
    // R53-W2: 称号(profile.titles)があれば階級表示の隣に最新のものを小さく出す
    const profileTitle = latestTitle(this.profile.titles);
    const titleHtml = profileTitle
      ? `<span class="profile-title-badge">${profileTitle}</span>`
      : '';
    panel.innerHTML = `
      <div class="profile-top">
        <span class="profile-rank">LV.${level.level} ${rankNameFor(level.level).name}</span>
        ${titleHtml}
        <span class="profile-rating">SR ${this.profile.rating} / ${rank.name}</span>
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

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderChallenges(): void {
    lobbyScreen.renderChallenges(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderDailies(): void {
    lobbyScreen.renderDailies(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderModes(): void {
    lobbyScreen.renderModes(this.screenHost());
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderAttachments(): void {
    armoryScreen.renderAttachments(this.screenHost());
  }

  // 分割委譲: menu-screens/armory.ts へ移送済み
  private renderGrenades(): void {
    armoryScreen.renderGrenades(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderDifficulties(): void {
    lobbyScreen.renderDifficulties(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderSpecialOptions(): void {
    lobbyScreen.renderSpecialOptions(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderRogueToggle(): void {
    lobbyScreen.renderRogueToggle(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private applyRogueExclusivity(): void {
    lobbyScreen.applyRogueExclusivity(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderZombieRoundSelector(): void {
    lobbyScreen.renderZombieRoundSelector(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderCharmSelector(): void {
    lobbyScreen.renderCharmSelector(this.screenHost());
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private equipCharm(id: CharmId | null): void {
    lobbyScreen.equipCharm(this.screenHost(), id);
  }

  // 分割委譲: menu-screens/lobby.ts へ移送済み
  private renderBriefing(): void {
    lobbyScreen.renderBriefing(this.screenHost());
  }

  private markSelected(container: HTMLElement, key: string, value: string): void {
    container.querySelectorAll<HTMLElement>('[data-' + key + ']').forEach((node) => {
      const on = node.dataset[key] === value;
      node.classList.toggle('selected', on);
      // 選択トグルであることと現在の状態を支援技術へ伝える
      node.setAttribute('aria-pressed', String(on));
    });
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private renderControls(): void {
    settingsScreen.renderControls(this.screenHost());
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private renderSettings(container: HTMLElement): void {
    settingsScreen.renderSettings(this.screenHost(), container);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private buildGamepadSettings(): HTMLElement {
    return settingsScreen.buildGamepadSettings(this.screenHost());
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private renderGamepadBindings(host: HTMLElement, layoutSelect: HTMLSelectElement): void {
    settingsScreen.renderGamepadBindings(this.screenHost(), host, layoutSelect);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private startCapture(
    action: PadAction,
    host: HTMLElement,
    layoutSelect: HTMLSelectElement,
  ): void {
    settingsScreen.startCapture(this.screenHost(), action, host, layoutSelect);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private assignBinding(action: PadAction, binding: GamepadBinding): void {
    settingsScreen.assignBinding(this.screenHost(), action, binding);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private subhead(label: string, code: string): HTMLElement {
    return settingsScreen.subhead(this.screenHost(), label, code);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
  ): HTMLElement {
    return settingsScreen.slider(this.screenHost(), label, min, max, step, value, apply);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private select(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    apply: (v: string) => void,
  ): HTMLElement {
    return settingsScreen.select(this.screenHost(), label, options, value, apply);
  }

  // 分割委譲: menu-screens/settings.ts へ移送済み
  private checkbox(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement {
    return settingsScreen.checkbox(this.screenHost(), label, value, apply);
  }

  // ── W-ENZA FA2: 画面モジュールへの遅延クロージャDI(makeStoryHost と同方式) ──
  private _screenHost: MenuScreenHost | null = null;
  private screenHost(): MenuScreenHost {
    if (this._screenHost) return this._screenHost;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this._screenHost = {
      get attachmentBySlot() {
        return self.attachmentBySlot;
      },
      get bg() {
        return self.bg;
      },
      get bindNote() {
        return self.bindNote;
      },
      set bindNote(v) {
        self.bindNote = v;
      },
      get callbacks() {
        return self.callbacks;
      },
      get captureCleanup() {
        return self.captureCleanup;
      },
      set captureCleanup(v) {
        self.captureCleanup = v;
      },
      get capturingAction() {
        return self.capturingAction;
      },
      set capturingAction(v) {
        self.capturingAction = v;
      },
      get gradeSeq() {
        return self.gradeSeq;
      },
      set gradeSeq(v) {
        self.gradeSeq = v;
      },
      get input() {
        return self.input;
      },
      get profile() {
        return self.profile;
      },
      get root() {
        return self.root;
      },
      get selection() {
        return self.selection;
      },
      get settings() {
        return self.settings;
      },
      get weaponPreview() {
        return self.weaponPreview;
      },
      applyRogueExclusivity: () => self.applyRogueExclusivity(),
      assignBinding: (action, binding) => self.assignBinding(action, binding),
      bar: (label, value) => self.bar(label, value),
      buildGamepadSettings: () => self.buildGamepadSettings(),
      camoChip: (def, camoId, equipped, mastery, kunai) =>
        self.camoChip(def, camoId, equipped, mastery, kunai),
      checkbox: (label, value, apply) => self.checkbox(label, value, apply),
      clearBgTransition: () => self.clearBgTransition(),
      countUp: (el, to, durationMs) => self.countUp(el, to, durationMs),
      currentPrimaryDef: () => self.currentPrimaryDef(),
      endCapture: () => self.endCapture(),
      equipCamo: (def, camoId) => self.equipCamo(def, camoId),
      equipCharm: (id) => self.equipCharm(id),
      gradeSigilHtml: (grade) => self.gradeSigilHtml(grade),
      highlightsHtml: (result) => self.highlightsHtml(result),
      markSelected: (container, key, value) => self.markSelected(container, key, value),
      matchStoryHtml: (result, progress) => self.matchStoryHtml(result, progress),
      missionChip: (mission) => self.missionChip(mission),
      playerLevel: () => self.playerLevel(),
      get prefersReducedMotion() {
        return self.prefersReducedMotion;
      },
      previewWeapon: (def) => self.previewWeapon(def),
      progressHtml: (progress) => self.progressHtml(progress),
      query: (id) => self.query(id),
      refreshDiffChips: (slot) => self.refreshDiffChips(slot),
      renderArmoryReadout: (def) => self.renderArmoryReadout(def),
      renderAttachments: () => self.renderAttachments(),
      renderBriefing: () => self.renderBriefing(),
      renderCamoSection: (def) => self.renderCamoSection(def),
      renderCharmSelector: () => self.renderCharmSelector(),
      renderGamepadBindings: (host, layoutSelect) => self.renderGamepadBindings(host, layoutSelect),
      renderKunaiCamoSection: (def, host) => self.renderKunaiCamoSection(def, host),
      renderRogueToggle: () => self.renderRogueToggle(),
      renderSettings: (container) => self.renderSettings(container),
      renderStages: () => self.renderStages(),
      renderZombieRoundSelector: () => self.renderZombieRoundSelector(),
      saveLoadout: () => self.saveLoadout(),
      select: (label, options, value, apply) => self.select(label, options, value, apply),
      setMfdPage: (page) => self.setMfdPage(page),
      showBriefing: (mission) => self.showBriefing(mission),
      showMain: () => self.showMain(),
      showWeaponClass: (cls) => self.showWeaponClass(cls),
      slider: (label, min, max, step, value, apply) =>
        self.slider(label, min, max, step, value, apply),
      stagger: (container) => self.stagger(container),
      staggerXpList: () => self.staggerXpList(),
      startCapture: (action, host, layoutSelect) => self.startCapture(action, host, layoutSelect),
      subhead: (label, code) => self.subhead(label, code),
      syncAttachments: () => self.syncAttachments(),
      teardownPreview: () => self.teardownPreview(),
      weaponCard: (id, slot) => self.weaponCard(id, slot),
    };
    return this._screenHost;
  }
}
