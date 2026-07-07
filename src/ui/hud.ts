import { RADAR_RANGE_M, RETICLE_COLORS } from '../core/settings';
import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match';
import { MOVE_SPEEDS } from '../game/player';
import { SUPPRESS_BADGE, ALWAYS_BADGE, medalRank, starPoints, type MedalEvent, type MedalId } from '../game/medals';

const SVG_NS = 'http://www.w3.org/2000/svg';

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// レティクル色IDをCSS色へ。未知IDはアクセント色に追従
function reticleColorValue(id: string): string {
  return RETICLE_COLORS.find((c) => c.id === id)?.value ?? 'var(--accent)';
}

type Project = (world: THREE.Vector3) => { x: number; y: number; behind: boolean };

// 正多角形(頂点を真上に向ける)のSVG points文字列。バッジの六角/八角に使う
function ngonPoints(cx: number, cy: number, n: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// バッジ中央のアイコン(階級ごと)。crosshair/chevron/star/bolt
function badgeIcon(tier: MedalEvent['tier']): string {
  if (tier === 'bronze') {
    return '<circle cx="60" cy="60" r="15"/><line x1="60" y1="37" x2="60" y2="83"/><line x1="37" y1="60" x2="83" y2="60"/>';
  }
  if (tier === 'silver') {
    return '<polyline points="44,66 60,52 76,66"/><polyline points="44,80 60,66 76,80"/>';
  }
  if (tier === 'gold') {
    return `<polygon points="${starPoints(60, 60, 5, 17, 7)}" fill="#fff" stroke="none"/>`;
  }
  return '<polyline points="65,36 49,62 60,62 55,84 75,56 64,56 65,36"/>';
}

const DIRECTIONS: Array<[number, string]> = [
  [0, '北'],
  [45, '北東'],
  [90, '東'],
  [135, '南東'],
  [180, '南'],
  [225, '南西'],
  [270, '西'],
  [315, '北西'],
];

const FEED_LIFETIME_MS = 4200;
const PX_PER_DEG = 2.2;
// ハードポイント/KC ミニマップ描画: ゾーン半径(match.tsの ZONE_RADIUS=3.5 と合わせる)
const ZONE_R = 3.5;

// ── R21 マルチキルバナー ──────────────────────────────────────────────────────────────────
// マルチキル系メダルID(これらはバナーへルーティングし、pushMedalText/pushBadgeを出さない)
// 既存8 + チェーン拡張8 = 16件
const MULTI_KILL_IDS: ReadonlySet<MedalId> = new Set<MedalId>([
  'double-kill', 'triple-kill', 'fury-kill', 'frenzy-kill',
  'super-kill', 'mega-kill', 'ultra-kill', 'kill-chain',
  'chain-10', 'chain-12', 'chain-15', 'chain-18',
  'chain-20', 'chain-25', 'chain-30', 'chain-35',
]);

type MkCfg = {
  pips: number;
  color: string;
  slamScale: number; // スラムインの強度(scale 値, 大きいほど強い)
  chromaPx: number;  // クロマ収差のtext-shadowずれ幅(px)
  lifetimeMs: number; // バナー表示時間(ms)
};

// 段ごとの迫力設定: white→blue→orange→red→gold へ段階的に色/強度が上がる
const MK_CFG: Partial<Record<MedalId, MkCfg>> = {
  'double-kill':  { pips: 2, color: '#eef2f6', slamScale: 1.20, chromaPx: 0,   lifetimeMs: 2200 },
  'triple-kill':  { pips: 3, color: '#4ea8ff', slamScale: 1.25, chromaPx: 0.8, lifetimeMs: 2200 },
  'fury-kill':    { pips: 4, color: '#ff9a3c', slamScale: 1.30, chromaPx: 1.4, lifetimeMs: 2400 },
  'frenzy-kill':  { pips: 5, color: '#ff5a3c', slamScale: 1.35, chromaPx: 2.0, lifetimeMs: 2600 },
  'super-kill':   { pips: 6, color: '#ff3a2c', slamScale: 1.38, chromaPx: 2.3, lifetimeMs: 2800 },
  'mega-kill':    { pips: 7, color: '#ffcf4d', slamScale: 1.40, chromaPx: 2.5, lifetimeMs: 3000 },
  'ultra-kill':   { pips: 8, color: '#ffcf4d', slamScale: 1.40, chromaPx: 2.5, lifetimeMs: 3200 },
  'kill-chain':   { pips: 9,  color: '#ffd700', slamScale: 1.40, chromaPx: 3.0, lifetimeMs: 3600 },
  // L: チェーン拡張(chain-10~chain-35 はバナーへ)
  'chain-10': { pips: 10, color: '#ffd700', slamScale: 1.42, chromaPx: 3.0, lifetimeMs: 3800 },
  'chain-12': { pips: 12, color: '#ffd700', slamScale: 1.43, chromaPx: 3.2, lifetimeMs: 4000 },
  'chain-15': { pips: 15, color: '#e0c0ff', slamScale: 1.44, chromaPx: 3.5, lifetimeMs: 4200 },
  'chain-18': { pips: 18, color: '#e0c0ff', slamScale: 1.45, chromaPx: 3.8, lifetimeMs: 4500 },
  'chain-20': { pips: 20, color: '#c0a0ff', slamScale: 1.46, chromaPx: 4.0, lifetimeMs: 4800 },
  'chain-25': { pips: 25, color: '#c0a0ff', slamScale: 1.47, chromaPx: 4.2, lifetimeMs: 5000 },
  'chain-30': { pips: 30, color: '#ff80ff', slamScale: 1.48, chromaPx: 4.5, lifetimeMs: 5200 },
  'chain-35': { pips: 35, color: '#ff80ff', slamScale: 1.48, chromaPx: 4.8, lifetimeMs: 5500 },
};

// 円形HPリングの可視弧長。r=38 の円周(2π·38≈238.76)の 240°/360°=2/3 が見える弧。
// stroke-dasharray '159.17 238.76' と対で使い、offset=ARC*(1-hp比) で満欠を描く。
const HP_ARC_LEN = 159.17;

// スコアストリーク3段の到達キル数(updateBanner の TRIPLE/RAMPAGE/UNSTOPPABLE と対応)。
const SS_TIERS: readonly number[] = [3, 5, 7];

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private compassMarks: Array<{ bearing: number; el: HTMLElement }> = [];
  private lastStreak = 0;
  private lastMoveState = '';
  private lastUltActive = false; // オーバードライブ発動の立ち上がり検出用
  private scopeOn = false; // スコープ表示の立ち上がり検出用
  private wasSteady = false; // 息止め成立の立ち上がり検出用(集中グリント再発火)
  private badgeSeq = 0; // バッジSVGの一意ID用カウンタ(gradient/filterのid衝突回避)
  private readonly badgeQueue: MedalEvent[] = []; // ALWAYS_BADGE複数同時→500ms間隔キュー
  private badgeQueueTimer = 0;
  private lastHpOff = ''; // HPリングの stroke-dashoffset 直近書込み値(無変化フレームの書込み抑止)
  private lastPipMag = -1; // 弾ピップの生成済み本数(=装弾数)。変化時のみ作り直す
  private lastPipAmmo = -1; // 弾ピップの点灯本数(=残弾)。変化時のみ点灯を更新
  private lastSsStreak = -1; // スコアストリーク段の直近キル数(変化時のみ更新)
  private lastZombiePerks: string = '';
  // ── R21 マルチキルバナー ──
  private mkBannerMs = 0;   // Date.now() at last multi-kill banner show(upgrade window 判定用)
  private mkTimerId = 0;    // setTimeout handle(自動消去・中断再設定用)
  // ── BO2 ミニマップ ──
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapStageSize = 60;
  private minimapBoxes: Array<{ x: number; z: number; w: number; d: number; handle?: number }> = [];
  // ── ファイナルキルカム: body 直下の独立オーバーレイ(hud.hide() の影響を受けない) ──
  private readonly fkcRoot: HTMLElement;
  private readonly fkcFlashEl: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-top-left ig-panel ig-panel--hud">
        <div class="hud-match-chip"><span data-id="modename">フリーフォーオール</span><i>LIVE</i></div>
        <div class="hud-score">
          <span><strong data-id="kills">0</strong><small>KILLS</small></span>
          <span><strong data-id="deaths">0</strong><small>DEATHS</small></span>
        </div>
        <div class="hud-streak" data-id="streak" hidden></div>
      </div>
      <div class="hud-top-center">
        <div class="hud-compass"><div class="hud-compass-strip" data-id="compass"></div><div class="hud-compass-needle"></div></div>
        <div class="hud-heading" aria-hidden="true"><span data-id="hdg">0</span><i>°</i></div>
        <div class="hud-timer"><small>TIME</small><strong data-id="timer">5:00</strong></div>
        <div class="hud-objective">
          <div class="hud-teamscore" data-id="teamscore">
            <span class="ts-mine" data-id="scoremine">0</span>
            <span class="ts-target" data-id="scoretarget"></span>
            <span class="ts-enemy" data-id="scoreenemy">0</span>
          </div>
          <div class="hud-zones" data-id="zones" hidden></div>
          <div class="hud-mission" data-id="mission" hidden>
            <div class="hud-mission-obj" data-id="obj-text"></div>
            <div class="hud-mission-bar"><i data-id="obj-bar"></i></div>
            <div class="hud-mission-wave" data-id="obj-wave"></div>
          </div>
          <div class="hud-zombie" data-id="zombie" hidden>
            <div class="hud-zombie-round"><small>ROUND</small><strong data-id="zround">1</strong></div>
            <div class="hud-zombie-stat"><span data-id="zkills">0</span> KILLS · <span data-id="zpoints">0</span> PTS</div>
          </div>
          <div class="hud-training" data-id="training" hidden>
            <div class="hud-training-row"><small>DPS</small><strong data-id="tr-dps">0.0</strong></div>
            <div class="hud-training-row"><small>命中率</small><strong data-id="tr-acc">0%</strong></div>
            <div class="hud-training-row"><small>HS率</small><strong data-id="tr-hs">0%</strong></div>
            <div class="hud-training-row"><small>連続HIT</small><strong data-id="tr-streak">0</strong></div>
          </div>
          <div class="hud-boss" data-id="boss" hidden>
            <div class="hud-boss-name" data-id="boss-name">BOSS</div>
            <div class="hud-boss-bar"><i data-id="boss-bar"></i></div>
          </div>
        </div>
      </div>
      <div class="hud-announce" data-id="announce"></div>
      <div class="hud-state-bar" aria-hidden="true">
        <div class="hud-hell" data-id="hell" hidden>
          <span class="hud-hell-badge">超鬼畜</span>
        </div>
        <div class="hud-dark-emperor" data-id="darkemperor" hidden>
          <span class="hud-de-badge">黒帝</span>
          <span class="hud-de-timer" data-id="detimer">5:00</span>
        </div>
        <div class="hud-raitei" data-id="raitei" hidden>
          <span class="hud-raitei-badge">雷帝</span>
        </div>
        <div class="hud-kokuraitei" data-id="kokuraitei" hidden>
          <span class="hud-kokuraitei-badge">黒雷帝</span>
        </div>
        <div class="hud-charge-gauge" data-id="chargegauge" hidden>
          <div class="hud-charge-fill" data-id="chargefill"></div>
        </div>
        <div class="hud-spin-gauge" data-id="spingauge" hidden>
          <div class="hud-spin-fill" data-id="spinfill"></div>
        </div>
      </div>
      <div class="hud-feed" data-id="feed"></div>
      <div class="hud-crosshair" data-id="crosshair">
        <span class="ch-dot"></span>
        <span class="ch-bar ch-t" data-id="cht"></span>
        <span class="ch-bar ch-b" data-id="chb"></span>
        <span class="ch-bar ch-l" data-id="chl"></span>
        <span class="ch-bar ch-r" data-id="chr"></span>
      </div>
      <div class="hud-scope" data-id="scope" hidden>
        <div class="sc-back"></div>
        <div class="sc-mask"></div>
        <div class="sc-frame">
          <div class="sc-glass"><i class="sc-grid"></i></div>
          <svg class="sc-frame-svg" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <circle class="sc-ring" r="95"></circle>
            <circle class="sc-chroma sc-c" r="95"></circle>
            <circle class="sc-chroma sc-m" r="95"></circle>
            <g class="sc-brackets">
              <polyline points="-40,-26 -40,-40 -26,-40"></polyline>
              <polyline points="40,-26 40,-40 26,-40"></polyline>
              <polyline points="-40,26 -40,40 -26,40"></polyline>
              <polyline points="40,26 40,40 26,40"></polyline>
            </g>
            <g class="sc-cardinals">
              <line x1="0" y1="-95" x2="0" y2="-88"></line>
              <line x1="0" y1="95" x2="0" y2="88"></line>
              <line x1="-95" y1="0" x2="-88" y2="0"></line>
              <line x1="95" y1="0" x2="88" y2="0"></line>
            </g>
          </svg>
          <div class="sc-glint" data-id="scopeglint"></div>
          <div class="sc-readout"><span data-id="scoperange">0</span><i>M</i> · <span data-id="scopezoom">3.1</span><i>X</i></div>
          <div class="sc-breath"><i data-id="scopebreath"></i></div>
        </div>
        <svg class="sc-cross" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <g id="sc-marks">
              <line x1="-92" y1="0" x2="-2.5" y2="0"></line>
              <line x1="2.5" y1="0" x2="92" y2="0"></line>
              <line x1="0" y1="-92" x2="0" y2="-2.5"></line>
              <line x1="0" y1="2.5" x2="0" y2="92"></line>
              <line x1="-3" y1="20" x2="3" y2="20"></line>
              <line x1="-5" y1="34" x2="5" y2="34"></line>
              <line x1="-7" y1="48" x2="7" y2="48"></line>
            </g>
          </defs>
          <!-- R13: レティクルは data-reticle で厳密に1種のみ可視。既存ミルドット十字を rk-mildot に内包 -->
          <g class="rk rk-mildot">
            <circle class="sc-refring-halo" r="60"></circle>
            <circle class="sc-refring" r="60"></circle>
            <use href="#sc-marks" class="sc-halo"></use>
            <use href="#sc-marks" class="sc-core"></use>
            <circle class="sc-dot-halo" r="1.6"></circle>
            <circle class="sc-dot" r="0.7"></circle>
          </g>
          <!-- ACOG: 中央シェブロン(▲)+下方スタジア線 -->
          <g class="rk rk-chevron">
            <path class="sc-halo" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <path class="sc-core" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <line class="sc-core" x1="0" y1="22" x2="0" y2="30"></line>
            <line class="sc-core" x1="0" y1="40" x2="0" y2="46"></line>
          </g>
          <!-- ハイブリッド: 外リング+中央ドット(CQB) -->
          <g class="rk rk-circle-dot">
            <circle class="sc-refring-halo" r="34" fill="none"></circle>
            <circle class="sc-refring" r="34" fill="none"></circle>
            <line class="sc-core" x1="-46" y1="0" x2="-40" y2="0"></line>
            <line class="sc-core" x1="46" y1="0" x2="40" y2="0"></line>
            <line class="sc-core" x1="0" y1="-46" x2="0" y2="-40"></line>
            <line class="sc-core" x1="0" y1="46" x2="0" y2="40"></line>
            <circle class="sc-dot-halo" r="1.8"></circle>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- サーマル: 琥珀十字+アパーチャ(色はCSSの data-reticle='thermal' で暖色化) -->
          <g class="rk rk-thermal">
            <line class="sc-halo" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-halo" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-halo" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-halo" x1="0" y1="6" x2="0" y2="30"></line>
            <line class="sc-core" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-core" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-core" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-core" x1="0" y1="6" x2="0" y2="30"></line>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- DSR精密レティクル: BO2 DSR-50風極細十字(native スナイパー専用) -->
          <g class="rk rk-dsr">
            <!-- メイン十字アーム(ハロー/薄影) -->
            <line class="sc-dsr-halo" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-halo" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-halo" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-halo" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- メイン十字アーム(白0.85) -->
            <line class="sc-dsr-line" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-line" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-line" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-line" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- ミル目盛り 水平左: マイナー(±10,30,50,70)・メジャー(±20,40,60) -->
            <line class="sc-dsr-tick" x1="-10" y1="-1.5" x2="-10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-20" y1="-3" x2="-20" y2="3"></line>
            <line class="sc-dsr-tick" x1="-30" y1="-1.5" x2="-30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-40" y1="-3" x2="-40" y2="3"></line>
            <line class="sc-dsr-tick" x1="-50" y1="-1.5" x2="-50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-60" y1="-3" x2="-60" y2="3"></line>
            <line class="sc-dsr-tick" x1="-70" y1="-1.5" x2="-70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-80" y1="-2" x2="-80" y2="2"></line>
            <!-- ミル目盛り 水平右(左の鏡) -->
            <line class="sc-dsr-tick" x1="10" y1="-1.5" x2="10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="20" y1="-3" x2="20" y2="3"></line>
            <line class="sc-dsr-tick" x1="30" y1="-1.5" x2="30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="40" y1="-3" x2="40" y2="3"></line>
            <line class="sc-dsr-tick" x1="50" y1="-1.5" x2="50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="60" y1="-3" x2="60" y2="3"></line>
            <line class="sc-dsr-tick" x1="70" y1="-1.5" x2="70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="80" y1="-2" x2="80" y2="2"></line>
            <!-- ホールドオーバーマーク(垂直下方・距離推定) -->
            <line class="sc-dsr-hold" x1="-4" y1="20" x2="4" y2="20"></line>
            <line class="sc-dsr-hold" x1="-6" y1="34" x2="6" y2="34"></line>
            <line class="sc-dsr-hold" x1="-8" y1="48" x2="8" y2="48"></line>
            <!-- 中央アンバー照準点(ハロー+コア) -->
            <circle class="sc-dsr-center-halo" r="2"></circle>
            <circle class="sc-dsr-center" r="1"></circle>
          </g>
          <circle class="sc-lock" r="5"></circle>
        </svg>
      </div>
      <div class="hud-hitmarker" data-id="hitmarker"><span></span><span></span><span></span><span></span><span class="hm-diamond"></span></div>
      <div class="hud-reload" data-id="reload" hidden>
        <div class="hud-reload-bar"><div data-id="reloadfill"></div></div>
        <span>リロード中</span>
      </div>
      <div class="hud-cook" data-id="cook" hidden>
        <div class="hud-cook-bar"><div data-id="cookfill"></div></div>
      </div>
      <div class="hud-bottom-left ig-panel ig-panel--hud">
        <div class="hud-vitals-heading"><span>VITAL</span><small data-id="hpmax">/ 100</small></div>
        <div class="hud-vitals-row">
          <div class="hud-hp-ring">
            <svg class="hp-ring-svg" viewBox="-50 -50 100 100" aria-hidden="true">
              <circle class="hp-ring-track" r="38" transform="rotate(-210)" fill="none" stroke-dasharray="159.17 238.76"></circle>
              <circle class="hp-ring-fill" data-id="hpring" r="38" transform="rotate(-210)" fill="none" stroke-dasharray="159.17 238.76" stroke-dashoffset="0"></circle>
            </svg>
            <div class="hud-hp-num" data-id="hp">100</div>
          </div>
        </div>
      </div>
      <div class="hud-zperks" data-id="zperks" hidden></div>
      <div class="hud-bottom-right ig-panel ig-panel--hud ig-panel--ember">
        <div class="hud-weapon-row"><span data-id="weaponslot">PRIMARY</span><strong class="hud-weapon" data-id="weapon"></strong></div>
        <div class="hud-ammo-row">
          <div class="hud-ammo-line">
            <div class="hud-ammo"><span data-id="ammo">30</span><span class="hud-reserve" data-id="reserve">/ 120</span></div>
            <div class="hud-mode" data-id="mode"></div>
          </div>
          <div class="hud-ammo-pips" data-id="ammopips" aria-hidden="true"></div>
        </div>
        <div class="hud-grenade"><span>UTILITY</span><strong data-id="gname"></strong><span class="hud-gcount" data-id="gcount"></span></div>
      </div>
      <!-- BO2 方形ミニマップ: 左上固定。UAV 発動時のみ敵ドット表示 -->
      <canvas class="hud-minimap" data-id="minimap" width="144" height="144" aria-hidden="true"></canvas>
      <!-- BO2 スコアストリークパネル: 右側・弾薬表示の上 (7スロット) -->
      <div class="hud-bo2-ss" aria-hidden="true">
        <div class="hud-bo2-ss-next" data-id="bo2ssnext"></div>
        <div class="hud-bo2-ss-cauav" data-id="bo2cauav" hidden>COUNTER UAV <span data-id="bo2cauavt">30</span>s</div>
        ${[0,1,2,3,4,5,6].map((i) => `
        <div class="hud-bo2-slot" data-id="bo2slot${i}">
          <span class="hud-bo2-key">${3+i}</span>
          <span class="hud-bo2-icon" data-id="bo2icon${i}"></span>
          <span class="hud-bo2-name" data-id="bo2name${i}"></span>
        </div>`).join('')}
      </div>
      <!-- RC-XD操縦オーバーレイ: 操縦中のみ表示 -->
      <div class="hud-rcxd-overlay" data-id="rcxdoverlay" hidden>
        <div class="hud-rcxd-label">RC-XD</div>
        <div class="hud-rcxd-hint">[LClick] 起爆 · [RClick/ESC] キャンセル</div>
        <div class="hud-rcxd-timer"><span data-id="rcxdtimer">30</span>s</div>
      </div>
      <div class="hud-radar" data-id="radar" hidden>
        <div class="radar-sweep"></div>
        <svg class="radar-svg" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="radar-ring" r="46"></circle>
          <circle class="radar-ring radar-ring-inner" r="23"></circle>
          <line class="radar-ax" x1="0" y1="-46" x2="0" y2="46"></line>
          <line class="radar-ax" x1="-46" y1="0" x2="46" y2="0"></line>
          <g data-id="radarblips"></g>
          <path class="radar-self" d="M0,-5 L4,4 L0,1.5 L-4,4 Z"></path>
        </svg>
      </div>
      <!-- ハードポイント方向インジケータ: プレイヤーヨー基準の矢印+状態チップ+カウントダウ��� -->
      <div class="hud-hp-indicator" data-id="hpindicator" hidden>
        <div class="hud-hp-arrow-wrap" data-id="hparrowwrap">
          <svg class="hud-hp-arrow-svg" viewBox="-12 -12 24 24" aria-hidden="true">
            <polygon class="hud-hp-arrow-shape" points="0,-10 6,6 0,2 -6,6" data-id="hparrowshape"/>
          </svg>
        </div>
        <div class="hud-hp-chip" data-id="hpchip">HP</div>
        <div class="hud-hp-time" data-id="hptime">60</div>
      </div>
      <!-- キルコンファーム演出バナー(CONFIRMED / DENIED) -->
      <div class="hud-kc-event" data-id="kcevent" hidden></div>
      <div class="hud-dmg-layer" data-id="dmg"></div>
      <div class="hud-incoming" data-id="incoming"></div>
      <div class="hud-xp-ribbon" data-id="xpribbon" aria-live="polite" aria-atomic="false"></div>
      <div class="hud-vignette" data-id="vignette"></div>
      <div class="hud-flash" data-id="flash"></div>
      <div class="hud-ultflash" data-id="ultflash"></div>
      <div class="hud-whiteout" data-id="whiteout"></div>
      <div class="hud-speedlines" data-id="speedlines"></div>
      <div class="hud-move" data-id="move" hidden>
        <span class="hud-move-state" data-id="movestate"></span>
        <div class="hud-move-bar"><div data-id="speedfill"></div></div>
      </div>
      <div class="hud-banner" data-id="banner"></div>
      <!-- R21 マルチキルバナー: 画面中央上寄り。single要素再利用・スカルピップ計数器付き -->
      <div class="hud-multikill-banner" data-id="mkbanner" hidden>
        <div class="mk-inner">
          <div class="mk-label" data-id="mklabel"></div>
          <div class="mk-pips" data-id="mkpips" aria-hidden="true"></div>
        </div>
      </div>
      <div class="hud-medal-stack" data-id="medalstack"></div>
      <div class="hud-badge-stack" data-id="badgestack"></div>
      <div class="hud-ult" data-id="ult">
        <div class="hud-ult-bar"><div data-id="ultfill"></div></div>
        <span class="hud-ult-label" data-id="ultlabel">ULT</span>
      </div>
      <div class="hud-ss-panel" aria-hidden="true">
        <div class="hud-ss-slot" data-id="ss0"><i class="ss-fill" data-id="ss0f"></i><b>3</b></div>
        <div class="hud-ss-slot" data-id="ss1"><i class="ss-fill" data-id="ss1f"></i><b>5</b></div>
        <div class="hud-ss-slot" data-id="ss2"><i class="ss-fill" data-id="ss2f"></i><b>7</b></div>
      </div>
      <div class="hud-zbuy" data-id="zbuy" hidden></div>
      <!-- ガンゲーム: 右上にランク + 武器名 + トップ3リーダーボード -->
      <div class="hud-gg" data-id="gg" hidden>
        <div class="hud-gg-rank" data-id="ggrank">1/20</div>
        <div class="hud-gg-weapon" data-id="ggweapon"></div>
        <div class="hud-gg-top3" data-id="ggtop3"></div>
      </div>
      <div class="hud-death" data-id="death" hidden>
        <div class="hud-death-title">やられた</div>
        <div class="hud-death-sub">リスポーンまで <span data-id="respawn">0.0</span> 秒</div>
      </div>
      <!-- R11 キルカメラ・シネマ: #hud直下(生存時は.hud-death暗幕の外)。
           opacity と body.killcam-active のみで駆動。fixed inset:0 がビューポート解決 -->
      <div class="kc-veil" data-id="kcveil" aria-hidden="true"></div>
      <div class="kc-flash" data-id="kcflash" aria-hidden="true"></div>
      <div class="kc-vign" data-id="kcvign" aria-hidden="true"></div>
      <div class="kc-bars" aria-hidden="true"><i class="kc-bar kc-bar-t"></i><i class="kc-bar kc-bar-b"></i></div>
      <div class="kc-card" data-id="kccard" aria-hidden="true">
        <div class="kc-banner">KILLED BY</div>
        <div class="kc-name" data-id="kcname"></div>
        <div class="kc-weapon" data-id="kcweapon"></div>
        <div class="kc-dist"><span data-id="kcdist">0</span><i>M</i></div>
        <div class="kc-timer"><i data-id="kctimer"></i></div>
      </div>
      <div class="hud-scoreboard" data-id="scoreboard" hidden>
        <header><span data-id="scoremode"></span><strong data-id="scoregoal"></strong></header>
        <table>
          <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
          <tbody data-id="scorerows"></tbody>
        </table>
      </div>
      <div class="hud-zrevive-flash" data-id="zreviveflash"></div>
      <div class="hud-zboss-flash" data-id="zbossflash"></div>
    `;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((node) => {
      this.el[node.dataset.id ?? ''] = node;
    });
    this.buildCompass();
    this.buildScope();
    this.buildRadar();
    // スコープの暗い周辺マスクが上のスコア/キルフィードを暗く沈めないよう、
    // スコープを最前(=描画最背面)へ移し、他のHUDがマスクの上に描かれるようにする
    const scopeEl = this.el['scope'];
    if (scopeEl) this.root.insertBefore(scopeEl, this.root.firstChild);

    // ── ファイナルキルカム オーバーレイ: body 直下へ追加(hud.hide() に影響されない) ──
    this.fkcRoot = document.createElement('div');
    this.fkcRoot.className = 'hud-fkc';
    this.fkcRoot.setAttribute('aria-hidden', 'true');
    this.fkcRoot.innerHTML = `
      <div class="hud-fkc-flash"></div>
      <div class="hud-fkc-bar hud-fkc-bar-t"></div>
      <div class="hud-fkc-bar hud-fkc-bar-b"></div>
      <div class="hud-fkc-banner">
        <span class="hud-fkc-hairline"></span>
        <span class="hud-fkc-label"><span class="hud-fkc-scan"></span>FINAL KILLCAM</span>
        <span class="hud-fkc-hairline"></span>
      </div>
      <div class="hud-fkc-skip">SKIP : クリック / SPACE</div>
    `;
    document.body.appendChild(this.fkcRoot);
    this.fkcFlashEl = this.fkcRoot.querySelector('.hud-fkc-flash') as HTMLElement;
  }

  /**
   * ミニマップを一度だけセットアップする(試合開始時に main.ts から呼ぶ)。
   * ステージのボックスデータを保持し、毎フレーム drawMinimap() で直接描画する。
   */
  setupMinimap(
    boxes: ReadonlyArray<{ x: number; z: number; w: number; d: number }>,
    stageSize: number,
  ): void {
    this.minimapStageSize = stageSize;
    this.minimapBoxes = Array.from(boxes);
    // minimap canvas の 2D コンテキストを取得(ボックスは毎フレーム直接描画するためoffscreenは不要)
    const canvas = this.el['minimap'] as HTMLCanvasElement | undefined;
    if (canvas) {
      this.minimapCtx = canvas.getContext('2d');
    }
  }

  // スコープのミルティックを #sc-marks に追加する。<use>が2回参照するので
  // ハロー(暗縁)とコア(白)の両方へ自動的に描かれる
  private buildScope(): void {
    const marks = this.root.querySelector('#sc-marks');
    if (!marks) return;
    const TICKS: ReadonlyArray<[number, number]> = [
      [16, 2.4],
      [32, 1.8],
      [48, 1.2],
    ];
    const line = (x1: number, y1: number, x2: number, y2: number): void => {
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(x1));
      el.setAttribute('y1', String(y1));
      el.setAttribute('x2', String(x2));
      el.setAttribute('y2', String(y2));
      marks.appendChild(el);
    };
    for (const [r, h] of TICKS) {
      line(r, -h, r, h); // 右腕
      line(-r, -h, -r, h); // 左腕
      line(-h, r, h, r); // 下腕
      line(-h, -r, h, -r); // 上腕
    }
  }

  private buildCompass(): void {
    const strip = this.el['compass'];
    if (!strip) return;
    this.compassMarks = DIRECTIONS.map(([bearing, label]) => {
      const mark = document.createElement('span');
      mark.className = bearing % 90 === 0 ? 'hud-compass-major' : 'hud-compass-minor';
      mark.textContent = label;
      strip.appendChild(mark);
      return { bearing, el: mark };
    });
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  reset(): void {
    const feed = this.el['feed'];
    if (feed) feed.innerHTML = '';
    const dmg = this.el['dmg'];
    if (dmg) dmg.innerHTML = '';
    this.lastStreak = 0;
    this.lastMoveState = '';
    this.lastUltActive = false;
    this.scopeOn = false;
    this.wasSteady = false;
    this.lastSsStreak = -1; // 段の再描画を次フレームで強制(前試合の残値を持ち越さない)
    this.lastZombiePerks = '';
    const zperks = this.el['zperks'];
    if (zperks) { zperks.innerHTML = ''; zperks.hidden = true; }
    const zbuy = this.el['zbuy'];
    if (zbuy) { zbuy.hidden = true; zbuy.textContent = ''; }
    const deEl = this.el['darkemperor'];
    if (deEl) deEl.hidden = true;
    const raiteiEl = this.el['raitei'];
    if (raiteiEl) raiteiEl.hidden = true;
    const kokuraiteiEl = this.el['kokuraitei'];
    if (kokuraiteiEl) kokuraiteiEl.hidden = true;
    const chargeEl = this.el['chargegauge'];
    if (chargeEl) chargeEl.hidden = true;
    const spinEl = this.el['spingauge'];
    if (spinEl) spinEl.hidden = true;
    // R21 マルチキルバナーのリセット(前試合の残表示・タイマーを完全クリア)
    if (this.mkTimerId) { window.clearTimeout(this.mkTimerId); this.mkTimerId = 0; }
    this.mkBannerMs = 0;
    const mkbanner = this.el['mkbanner'];
    if (mkbanner) {
      mkbanner.hidden = true;
      mkbanner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
    }
    // R11 キルカメラ状態の完全クリア(試合開始/離脱で黒幕やビネットを残さない)
    document.body.classList.remove('killcam-active');
    // ファイナルキルカム オーバーレイもクリア
    this.fkcRoot.classList.remove('fkc-active');
    for (const id of ['kcveil', 'kcflash'] as const) {
      const n = this.el[id];
      if (n) n.style.opacity = '0';
    }
    const vign = this.el['kcvign'];
    if (vign) vign.classList.remove('final');
    // R30: スコアイベントはXPリボン(右下)へ一本化。試合ごとに残留行をクリア
    const ribbon = this.el['xpribbon'];
    if (ribbon) ribbon.innerHTML = '';
    const badges = this.el['badgestack'];
    if (badges) badges.innerHTML = '';
    const medalStack = this.el['medalstack'];
    if (medalStack) medalStack.innerHTML = '';
    // バッジキューリセット
    this.badgeQueue.length = 0;
    if (this.badgeQueueTimer) { window.clearInterval(this.badgeQueueTimer); this.badgeQueueTimer = 0; }
    // ミニマップ: 試合ごとにクリア(前試合のキャッシュを持ち越さない)
    if (this.minimapCtx) {
      this.minimapCtx.clearRect(0, 0, 144, 144);
    }
  }

  update(
    snap: MatchSnapshot,
    width: number,
    height: number,
    project: Project,
    showScoreboard: boolean,
  ): void {
    this.text('kills', String(snap.kills));
    this.text('deaths', String(snap.deaths));
    this.text('modename', snap.modeName);

    const streak = this.el['streak'];
    if (streak) {
      streak.hidden = snap.streak < 2;
      streak.textContent = `連続キル ${snap.streak}`;
    }

    // R16: ゾンビモードはタイマー/チームスコアを隠し、ラウンド/キル/ポイントを表示する
    const zombie = this.el['zombie'];
    const inZombie = snap.zombieRound !== undefined;
    if (zombie) zombie.hidden = !inZombie;
    if (inZombie) {
      const teamscore = this.el['teamscore'];
      if (teamscore) teamscore.hidden = true;
    }

    // 訓練場: タイマー/チームスコア/ミニマップを隠し、計測HUDを表示する
    const inTraining = snap.trainingStats !== undefined;
    const trainingEl = this.el['training'];
    if (trainingEl) trainingEl.hidden = !inTraining;
    if (inTraining && snap.trainingStats) {
      const ts = snap.trainingStats;
      this.text('tr-dps', ts.dps.toFixed(1));
      this.text('tr-acc', `${Math.round(ts.accuracy * 100)}%`);
      this.text('tr-hs', `${Math.round(ts.hsRate * 100)}%`);
      this.text('tr-streak', String(ts.streak));
      const teamscore = this.el['teamscore'];
      if (teamscore) teamscore.hidden = true;
    }

    // ミニマップ: ゾンビ/訓練場モードでは非表示にしてK/Dパネルとの重なりを解消する。
    // 非表示時、CSS側の #hud:has(.hud-minimap[hidden]) .hud-top-left が左上通常位置へ戻す。
    const minimapEl = this.el['minimap'];
    if (minimapEl) minimapEl.hidden = inZombie || inTraining;
    const timerEl = this.el['timer'];
    if (timerEl && timerEl.parentElement) {
      (timerEl.parentElement as HTMLElement).style.display = (inZombie || inTraining) ? 'none' : '';
    }
    if (inZombie) {
      this.text('zround', String(snap.zombieRound ?? 1));
      this.text('zkills', String(snap.zombieKills ?? 0));
      this.text('zpoints', String(snap.zombiePoints ?? 0));
    } else if (!inTraining) {
      const minutes = Math.floor(snap.timeLeft / 60);
      const seconds = Math.floor(snap.timeLeft % 60);
      this.text('timer', `${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    this.updateCompass(snap.yaw, width);
    this.updateCrosshair(snap, height);
    this.updateScope(snap, width, height);
    this.updateAmmo(snap);
    this.updateGrenade(snap);
    this.updateObjective(snap);
    this.updateHp(snap);
    this.pushFeed(snap);
    this.pushHits(snap);
    this.pushDamageNumbers(snap, project);
    this.pushXpRibbon(snap);
    this.pushMedals(snap);
    this.updateRadar(snap);
    this.pushIncoming(snap);
    this.updateDeath(snap);
    this.updateMovement(snap);
    this.updateBanner(snap);
    this.updateUlt(snap);
    this.updateScorestreak(snap);
    this.updateBO2Streaks(snap);
    this.updateZombieShopHud(snap);
    this.pushZombiePointFloats(snap, project);
    this.updateZombieReviveFlash(snap);
    this.updateZombieBossFlash(snap);
    this.updateDarkEmperorHud(snap);
    this.updateRaiteiHud(snap);
    this.updateKokuraiteiHud(snap);
    const hellEl = this.el['hell'];
    if (hellEl) hellEl.hidden = !snap.hellMode;
    this.updateChargeGauge(snap);
    this.updateSpinGauge(snap);
    this.drawMinimap(snap);
    this.updateGunGameHud(snap);

    const scoreboard = this.el['scoreboard'];
    if (scoreboard) {
      scoreboard.hidden = !showScoreboard;
      if (showScoreboard) this.renderScoreboard(snap);
    }
  }

  private text(id: string, value: string): void {
    const node = this.el[id];
    if (node && node.textContent !== value) node.textContent = value;
  }

  private updateCompass(yaw: number, _width: number): void {
    const headingDeg = ((-yaw * 180) / Math.PI + 360 * 4) % 360;
    // コンパス帯のmask外に置いた数値方位(3桁ゼロ詰め・360°は0°へ丸め込む)
    this.text('hdg', String(Math.round(headingDeg) % 360).padStart(3, '0'));
    for (const mark of this.compassMarks) {
      const relative = ((mark.bearing - headingDeg + 540) % 360) - 180;
      const visible = Math.abs(relative) <= 65;
      mark.el.style.opacity = visible ? '1' : '0';
      if (visible) {
        // ラベル自身の幅の半分を引いて文字の中心を目盛り位置に合わせる
        mark.el.style.transform = `translateX(${relative * PX_PER_DEG}px) translateX(-50%)`;
      }
    }
  }

  private updateCrosshair(snap: MatchSnapshot, height: number): void {
    const crosshair = this.el['crosshair'];
    if (!crosshair) return;
    // 形状・色はユーザー設定に追従(腰だめクロスヘア)
    if (crosshair.dataset.reticle !== snap.reticleStyle) {
      crosshair.dataset.reticle = snap.reticleStyle;
    }
    crosshair.style.setProperty('--reticle-color', reticleColorValue(snap.reticleColor));
    // 覗き込み量を毎フレーム公開。CSS側で circle/chevron 擬似要素レティクルを
    // ADS進行に応じて消し込む(barはJSのopacityで消えるが擬似要素は非対象なため)。
    crosshair.style.setProperty('--ads', String(snap.adsProgress));
    if (!snap.alive) {
      crosshair.style.opacity = '0';
      return;
    }
    // スコープ/倍率光学の覗き込み中はDOMスコープに任せ、通常クロスヘアは丸ごと消す
    // (.ch-dotはバー不透明度の影響を受けないため、コンテナごと0にする)
    if ((snap.scopedWeapon || snap.adsOpticActive) && snap.adsProgress > 0.5) {
      crosshair.style.opacity = '0';
      return;
    }
    crosshair.style.opacity = '1';
    const fovRad = (snap.fov * Math.PI) / 180;
    const gap = 4 + (Math.tan(snap.spreadRad) / Math.tan(fovRad / 2)) * (height / 2);
    // ADS序盤で4本バーを素早く消す(係数2.5=ads≈0.4で消灯)。擬似要素はCSSで同係数消去。
    const barOpacity = String(Math.max(0, 1 - snap.adsProgress * 2.5));
    const set = (id: string, transform: string) => {
      const bar = this.el[id];
      if (bar) {
        bar.style.transform = transform;
        bar.style.opacity = barOpacity;
      }
    };
    set('cht', `translate(-50%, ${-gap - 9}px)`);
    set('chb', `translate(-50%, ${gap}px)`);
    set('chl', `translate(${-gap - 9}px, -50%)`);
    set('chr', `translate(${gap}px, -50%)`);
  }

  // DSR風スコープ。adsProgress 0.5→1で開き、ピン留めの照準点は常に中央=弾着点。
  // 揺れはフレーム/グラスの視差にのみ使う(reduceMotion時は無効)
  private updateScope(snap: MatchSnapshot, width: number, height: number): void {
    const scope = this.el['scope'];
    if (!scope) return;
    const t = clampN((snap.adsProgress - 0.5) / 0.5, 0, 1);
    // R13: ネイティブ狙撃(scopedWeapon)に加え、後付け倍率光学(adsOpticActive)でもオーバーレイを開く
    const on = snap.alive && (snap.scopedWeapon || snap.adsOpticActive) && t > 0;
    scope.hidden = !on;
    if (!on) {
      this.scopeOn = false;
      this.wasSteady = false;
      return;
    }
    // レティクル種別と光学クラス(native=全画面暗転 / magnified=後付け光学は軽量オーバーレイで
    // ビューモデルを残す)を data属性で公開。CSSが厳密に1レティクルだけ可視化+暗転量を切替
    if (scope.dataset.reticle !== snap.sightStyle) scope.dataset.reticle = snap.sightStyle;
    const opticClass = snap.scopedWeapon ? 'native' : 'magnified';
    if (scope.dataset.opticClass !== opticClass) scope.dataset.opticClass = opticClass;
    scope.style.opacity = String(t);
    scope.style.setProperty('--in', String(t));
    scope.style.setProperty('--conv', String(1 - t));
    scope.style.setProperty('--scope-reticle', reticleColorValue(snap.reticleColor));
    scope.style.setProperty('--breath', String(snap.scope.breath01));

    const lens = Math.min(width, height);
    const fovRad = (snap.fov * Math.PI) / 180;
    const pxPerDeg = ((lens / 2) * (Math.PI / 180)) / Math.tan(fovRad / 2);
    const cap = lens * 0.025;
    const swx = snap.reduceMotion ? 0 : clampN(snap.scope.sway.x * pxPerDeg, -cap, cap);
    const swy = snap.reduceMotion ? 0 : clampN(snap.scope.sway.y * pxPerDeg, -cap, cap);
    scope.style.setProperty('--swx', `${swx}px`);
    scope.style.setProperty('--swy', `${swy}px`);

    scope.classList.toggle('steady', snap.scope.steady);
    scope.classList.toggle('engaged', snap.aimAssistEngaged);
    scope.classList.toggle('reduced', snap.reduceMotion);

    // 立ち上がり(覗き込み開始)でレンズグリント
    if (!this.scopeOn) {
      if (!snap.reduceMotion) this.restartAnimation('scopeglint', 'show');
      this.scopeOn = true;
    }
    // 息止め成立の瞬間にもグリントを再発火し「集中した」手応えを返す
    if (snap.scope.steady && !this.wasSteady && !snap.reduceMotion) {
      this.restartAnimation('scopeglint', 'show');
    }
    this.wasSteady = snap.scope.steady;
    this.text('scoperange', snap.rangeM > 0 ? String(Math.round(snap.rangeM)) : '--');
    this.text('scopezoom', snap.zoomX.toFixed(1));
  }

  private updateAmmo(snap: MatchSnapshot): void {
    this.text('weapon', snap.weaponName);
    this.text('weaponslot', snap.weaponSlot);
    this.text('ammo', String(snap.ammo));
    // リザーブ弾は無限。有限値が来た場合のみ数値を表示する
    this.text('reserve', Number.isFinite(snap.reserve) ? `/ ${snap.reserve}` : '/ ∞');
    this.text('mode', snap.fireMode);
    const ammoEl = this.el['ammo'];
    if (ammoEl) ammoEl.classList.toggle('hud-ammo-low', snap.ammo <= 5);
    this.updateAmmoPips(snap);

    const reload = this.el['reload'];
    if (reload) reload.hidden = !snap.reloading;
    const fill = this.el['reloadfill'];
    if (fill && snap.reloading) fill.style.width = `${snap.reloadRatio * 100}%`;
  }

  // 現在武器の装弾数。match.ts が snap.magSize を供給すればそれを採用し、
  // 無い間は「装備直後の残弾=満タン=装弾数」を利用した最大残弾トラッカでフォールバックする。
  private magSizeOf(snap: MatchSnapshot): number {
    // magSize は MatchSnapshot の必須フィールド(match.tsが weapon.magazine.capacity を供給)
    return Math.max(1, Math.floor(snap.magSize));
  }

  // 弾ピップ列。装弾数ぶんのセルを一度だけ生成し、残弾に応じて先頭から点灯する。
  // ピップ本数は snap.magSize(=装弾数)基準で正規化(/30 の固定スケール誤りを回避)。
  private updateAmmoPips(snap: MatchSnapshot): void {
    const host = this.el['ammopips'];
    if (!host) return;
    const mag = this.magSizeOf(snap);
    // 大容量/無限(素手 magSize 999 等)はピップ列を出さず数値表示のみに退避する。
    // 上限を設けないとDOMノードが弾倉容量ぶん無制限に増えHUDが崩れヒッチする
    if (mag > 60) {
      if (this.lastPipMag !== 0) {
        host.replaceChildren();
        this.lastPipMag = 0;
        this.lastPipAmmo = -1;
      }
      return;
    }
    if (mag !== this.lastPipMag) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < mag; i += 1) frag.appendChild(document.createElement('i'));
      host.replaceChildren(frag);
      this.lastPipMag = mag;
      this.lastPipAmmo = -1; // セル再生成後は必ず点灯を貼り直す
    }
    if (snap.ammo !== this.lastPipAmmo) {
      const pips = host.children;
      for (let i = 0; i < pips.length; i += 1) {
        (pips[i] as HTMLElement).classList.toggle('spent', i >= snap.ammo);
      }
      this.lastPipAmmo = snap.ammo;
    }
  }

  // BO3起点の縦3段スコアストリーク計器。専用スナップショットは持たないため、
  // 既存のキルストリーク(TRIPLE/RAMPAGE/UNSTOPPABLE の到達点)への進捗を可視化する。
  private updateScorestreak(snap: MatchSnapshot): void {
    if (snap.streak === this.lastSsStreak) return;
    this.lastSsStreak = snap.streak;
    for (let i = 0; i < SS_TIERS.length; i += 1) {
      const at = SS_TIERS[i] ?? 1;
      const fill = this.el[`ss${i}f`];
      if (fill) fill.style.transform = `scaleY(${clampN(snap.streak / at, 0, 1)})`;
      const slot = this.el[`ss${i}`];
      if (slot) slot.classList.toggle('ss-ready', snap.streak >= at);
    }
  }

  // ── BO2 スコアストリークパネル ────────────────────────────────────────────────────────
  // 7スロット縦積みパネル。バンク済み=lit、非バンク=dim。次のストリークまでの残pts上部表示。
  // idx:  0=RC-XD / 1=UAV / 2=HK / 3=CarePackage / 4=CounterUAV / 5=Lightning / 6=SensorTurret
  private readonly BO2_SVG_ICONS = [
    // RC-XD: ラジコン車 (車体+アンテナ)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="13" width="16" height="6" rx="1"/><circle cx="8" cy="20" r="1.8"/><circle cx="16" cy="20" r="1.8"/><line x1="15" y1="13" x2="17" y2="8"/><line x1="17" y1="8" x2="17" y2="5"/></svg>`,
    // UAV: レーダーディッシュ (円 + 放射線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="14" r="3"/><path d="M5 20 C5 12 19 12 19 20"/><line x1="12" y1="11" x2="12" y2="4"/><line x1="12" y1="4" x2="7" y2="8"/><line x1="12" y1="4" x2="17" y2="8"/></svg>`,
    // Hunter-Killer: ドローン (六角 + 線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polygon points="12,4 19,8 19,16 12,20 5,16 5,8"/><line x1="5" y1="8" x2="1" y2="6"/><line x1="19" y1="8" x2="23" y2="6"/><line x1="5" y1="16" x2="1" y2="18"/><line x1="19" y1="16" x2="23" y2="18"/></svg>`,
    // Care Package: 落下クレート (箱+降下線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="6" y="13" width="12" height="8" rx="1"/><line x1="12" y1="2" x2="12" y2="13"/><line x1="8" y1="6" x2="12" y2="2"/><line x1="16" y1="6" x2="12" y2="2"/><line x1="6" y1="17" x2="18" y2="17"/></svg>`,
    // Counter UAV: 妨害アンテナ (電波遮断)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="20"/><path d="M6 8 C6 4 18 4 18 8"/><path d="M4 12 C4 6 20 6 20 12"/><line x1="4" y1="4" x2="20" y2="20"/></svg>`,
    // Lightning Strike: 稲妻ボルト
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polyline points="13,2 7,13 12,13 11,22 17,11 12,11 13,2"/></svg>`,
    // Sensor Turret: 砲台
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="14" width="10" height="6" rx="1"/><rect x="9" y="10" width="6" height="4"/><line x1="12" y1="10" x2="12" y2="4"/><line x1="12" y1="4" x2="17" y2="7"/></svg>`,
  ];

  private readonly BO2_NAMES = ['RC-XD', 'UAV', 'HK MISSILE', 'CARE PKG', 'C-UAV', 'LIGHTNING', 'SENTRY'];
  private readonly BO2_COSTS = [325, 425, 525, 550, 600, 750, 800];
  private readonly BO2_SLOT_COUNT = 7;

  private updateBO2Streaks(snap: MatchSnapshot): void {
    // ゾンビモードではパネルを隠す
    const panel = this.root.querySelector<HTMLElement>('.hud-bo2-ss');
    // V31修正: ガンゲームでもストリークパネルを隠す(ストリーク無効モード)
    const ssHidden = snap.zombieRound !== undefined || snap.ggRank !== undefined;
    if (panel) panel.hidden = ssHidden;
    // F-01: BO3縦3段パネルは BO2 7スロットと排他。どちらのモードでも非表示
    const ssPanel = this.root.querySelector<HTMLElement>('.hud-ss-panel');
    if (ssPanel) ssPanel.hidden = true;
    if (ssHidden) return;

    // 各スロットのリット状態更新
    for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
      const slot = this.el[`bo2slot${i}`];
      if (!slot) continue;
      const banked = snap.streakBanked[i] ?? false;
      slot.classList.toggle('bo2-banked', banked);
      // アイコン: 初回のみ設定
      const iconEl = this.el[`bo2icon${i}`];
      if (iconEl && !iconEl.firstChild) {
        iconEl.innerHTML = this.BO2_SVG_ICONS[i] ?? '';
      }
      const nameEl = this.el[`bo2name${i}`];
      if (nameEl && !nameEl.textContent) {
        nameEl.textContent = this.BO2_NAMES[i] ?? '';
      }
    }
    // 次の未バンクストリークまでの残り pts
    const nextEl = this.el['bo2ssnext'];
    if (nextEl) {
      let nextLabel = '';
      for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
        if (!(snap.streakBanked[i] ?? false)) {
          const cost = this.BO2_COSTS[i] ?? 0;
          const rem = Math.max(0, cost - snap.streakProgress);
          nextLabel = rem === 0 ? '' : `${rem} PTS`;
          break;
        }
      }
      if (nextEl.textContent !== nextLabel) nextEl.textContent = nextLabel;
    }
    // Counter UAV アクティブ表示
    const cauavEl = this.el['bo2cauav'];
    if (cauavEl) {
      cauavEl.hidden = !snap.streakCauavActive;
      if (snap.streakCauavActive) {
        const tEl = this.el['bo2cauavt'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakCauavTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
    // RC-XD 操縦オーバーレイ
    const rcxdOverlay = this.el['rcxdoverlay'];
    if (rcxdOverlay) {
      rcxdOverlay.hidden = !snap.streakRcxdActive;
      if (snap.streakRcxdActive) {
        const tEl = this.el['rcxdtimer'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakRcxdTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
  }

  // ── BO2 方形ミニマップ描画 ────────────────────────────────────────────────────────────
  private drawMinimap(snap: MatchSnapshot): void {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const MAP = 144;
    const CX = MAP / 2;
    const CY = MAP / 2;
    const scale = (MAP * 0.82) / this.minimapStageSize;
    const yaw = snap.yaw;

    ctx.clearRect(0, 0, MAP, MAP);

    // 背景
    ctx.fillStyle = 'rgba(8,12,18,0.88)';
    ctx.fillRect(0, 0, MAP, MAP);

    // 外枠
    ctx.strokeStyle = 'rgba(180,160,100,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, MAP - 1, MAP - 1);

    // ── 回転コンテキスト: プレイヤー中心・ヨー回転 ──
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-yaw);

    // 障害物ボックス
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.7;
    for (const b of this.minimapBoxes) {
      // V31: 破壊済みプロップはミニマップからも消す
      if (b.handle !== undefined && snap.destroyedPropHandles?.has(b.handle)) continue;
      ctx.strokeRect(b.x * scale - b.w * scale / 2, b.z * scale - b.d * scale / 2, b.w * scale, b.d * scale);
    }

    // 味方ドット (青)
    ctx.fillStyle = '#5ab0ff';
    for (const ally of snap.minimapAllies) {
      ctx.beginPath();
      ctx.arc(ally.relX * scale, ally.relZ * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 敵ドット (赤, UAV スナップ, opacity フェード)
    for (const enemy of snap.minimapEnemies) {
      ctx.globalAlpha = enemy.opacity;
      ctx.fillStyle = '#ff5040';
      ctx.beginPath();
      ctx.arc(enemy.relX * scale, enemy.relZ * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── ハードポイントゾーン(回転コンテキスト内) ──
    if (snap.hardpointZoneRelX !== undefined && snap.hardpointZoneRelZ !== undefined) {
      const zx = snap.hardpointZoneRelX * scale;
      const zz = snap.hardpointZoneRelZ * scale;
      const zr = ZONE_R * scale;
      const hpColor = snap.hardpointOwner === 'mine'
        ? 'rgba(90,176,255,0.85)'
        : snap.hardpointOwner === 'enemy'
          ? 'rgba(255,80,64,0.85)'
          : 'rgba(255,215,0,0.85)';
      ctx.strokeStyle = hpColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zx, zz, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hpColor;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HP', zx, zz);
    }

    // ── キルコンファーム ドッグタグ(回転コンテキスト内) ──
    if (snap.kcTagPositions) {
      for (const tag of snap.kcTagPositions) {
        ctx.fillStyle = tag.isEnemy ? 'rgba(255,215,0,0.9)' : 'rgba(255,60,60,0.9)';
        ctx.beginPath();
        ctx.arc(tag.relX * scale, tag.relZ * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 発砲ブリップ(BO2本物仕様: 敵発砲位置を1秒間赤点表示。UAV赤点とは別レイヤ)
    if (snap.fireBlips) {
      for (const blip of snap.fireBlips) {
        const alpha = (1 - blip.age01) * 0.9;
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ff3020';
        ctx.beginPath();
        ctx.arc(blip.relX * scale, blip.relZ * scale, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // プレイヤーアロー (中心固定・常に上向き)
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(CX, CY - 6);
    ctx.lineTo(CX + 4, CY + 4);
    ctx.lineTo(CX, CY + 1);
    ctx.lineTo(CX - 4, CY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // UAV アクティブ時: 上部に "UAV" ラベル
    if (snap.streakUavActive) {
      const t = Math.floor(snap.streakUavTimeLeft);
      ctx.fillStyle = 'rgba(255,200,60,0.9)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`UAV ${t}s`, CX, 11);
    }
  }

  private updateObjective(snap: MatchSnapshot): void {
    // ── ハードポイント方向インジケータ ──
    const hpInd = this.el['hpindicator'];
    if (hpInd) {
      const hasHp = snap.hardpointTimeLeft !== undefined;
      hpInd.hidden = !hasHp;
      if (hasHp) {
        // 矢印の回転(0=前方)
        const wrap = this.el['hparrowwrap'];
        if (wrap && snap.hardpointZoneAngle !== undefined) {
          wrap.style.transform = `rotate(${(snap.hardpointZoneAngle * 180) / Math.PI}deg)`;
        }
        // 占拠チップの色クラス
        const chip = this.el['hpchip'];
        if (chip) {
          chip.classList.toggle('hp-mine', snap.hardpointOwner === 'mine');
          chip.classList.toggle('hp-enemy', snap.hardpointOwner === 'enemy');
          chip.classList.toggle('hp-contested', snap.hardpointContested === true);
          const label = snap.hardpointContested ? 'CONTEST' : snap.hardpointOwner === 'mine' ? 'SECURE' : snap.hardpointOwner === 'enemy' ? 'LOSING' : 'EMPTY';
          if (chip.textContent !== label) chip.textContent = label;
        }
        // カウントダウン
        const timeEl = this.el['hptime'];
        if (timeEl) {
          const t = Math.ceil(snap.hardpointTimeLeft ?? 60);
          const txt = String(t);
          if (timeEl.textContent !== txt) timeEl.textContent = txt;
          timeEl.classList.toggle('hp-time-warn', (snap.hardpointTimeLeft ?? 60) <= 10);
        }
        // 矢印形状の色(SVG fill は style 経由でも効く)
        const shape = this.el['hparrowshape'];
        if (shape) {
          const col = snap.hardpointContested ? '#ffffff' : snap.hardpointOwner === 'mine' ? 'var(--accent)' : snap.hardpointOwner === 'enemy' ? '#ff4040' : '#ffd700';
          shape.style.fill = col;
        }
      }
    }

    // ── キルコンファーム演出 ──
    if (snap.kcEvent) this.pushKcEvent(snap.kcEvent);

    const isMission = snap.missionId !== undefined;
    // ストーリーは先取スコアを隠し、目的・進捗・波・ボスHPを出す
    const teamscore = this.el['teamscore'];
    if (teamscore) teamscore.hidden = isMission;
    this.text('scoremine', String(snap.scoreMine));
    this.text('scoreenemy', String(snap.scoreEnemy));
    // 先取ラベルは有限のときだけ('先取 Infinity'の壊れ表示を防ぐ)
    this.text('scoretarget', Number.isFinite(snap.scoreTarget) ? `先取 ${snap.scoreTarget}` : '');

    const mission = this.el['mission'];
    if (mission) {
      mission.hidden = !isMission;
      if (isMission) {
        this.text('obj-text', snap.objectiveText ?? '');
        const bar = this.el['obj-bar'];
        if (bar)
          bar.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.objectiveProgress01 ?? 0))})`;
        const total = snap.waveTotal ?? 0;
        this.text('obj-wave', total > 1 ? `WAVE ${snap.waveIndex ?? 0}/${total}` : '');
      }
    }
    const boss = this.el['boss'];
    if (boss) {
      const showBoss = snap.bossHp01 !== undefined;
      boss.hidden = !showBoss;
      if (showBoss) {
        const bb = this.el['boss-bar'];
        if (bb) bb.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.bossHp01 ?? 0))})`;
        const nameEl = this.el['boss-name'];
        if (nameEl) {
          const label = snap.zombieRound !== undefined ? '巨躯' : 'BOSS';
          if (nameEl.textContent !== label) nameEl.textContent = label;
        }
        if (snap.zombieRound !== undefined) {
          boss.classList.add('hud-boss--zombie');
        } else {
          boss.classList.remove('hud-boss--zombie');
        }
      }
    }

    const zones = this.el['zones'];
    if (zones) {
      zones.hidden = snap.zones.length === 0;
      if (snap.zones.length > 0) {
        // 拠点ピルは数が固定なので毎フレーム作り直さず属性だけ更新する
        if (zones.childElementCount !== snap.zones.length) {
          zones.innerHTML = '';
          for (const zone of snap.zones) {
            const pill = document.createElement('span');
            pill.className = 'hud-zone-pill';
            pill.textContent = zone.id;
            zones.appendChild(pill);
          }
        }
        snap.zones.forEach((zone, i) => {
          const pill = zones.children[i] as HTMLElement;
          pill.classList.toggle('zone-mine', zone.owner === 'mine');
          pill.classList.toggle('zone-enemy', zone.owner === 'enemy');
          pill.classList.toggle('zone-contested', zone.contested || zone.capturing !== null);
        });
      }
    }

    const announce = this.el['announce'];
    if (announce) {
      for (const message of snap.announcements) {
        const node = document.createElement('div');
        node.className = 'hud-announce-row';
        node.textContent = message;
        announce.appendChild(node);
        window.setTimeout(() => {
          node.classList.add('announce-out');
          window.setTimeout(() => node.remove(), 400);
        }, 2600);
      }
      while (announce.childElementCount > 3) announce.firstElementChild?.remove();
    }
  }

  private updateGrenade(snap: MatchSnapshot): void {
    this.text('gname', snap.grenadeName);
    this.text('gcount', `x ${snap.grenadeCount}`);
    const grenade = this.el['gcount'];
    if (grenade) grenade.classList.toggle('hud-gcount-empty', snap.grenadeCount === 0);

    const cook = this.el['cook'];
    if (cook) cook.hidden = snap.cookRatio <= 0;
    const fill = this.el['cookfill'];
    if (fill && snap.cookRatio > 0) {
      fill.style.width = `${snap.cookRatio * 100}%`;
      fill.classList.toggle('cook-danger', snap.cookRatio > 0.7);
    }

    const whiteout = this.el['whiteout'];
    if (whiteout) whiteout.style.opacity = String(Math.min(1, snap.whiteout * 1.15));
  }

  private updateHp(snap: MatchSnapshot): void {
    this.text('hp', String(snap.hp));
    this.text('hpmax', `/ ${snap.maxHp}`);
    const ring = this.el['hpring'];
    if (ring) {
      const ratio = clampN(snap.hp / snap.maxHp, 0, 1);
      // 満タンで offset=0(弧が全て見える)、0で offset=ARC(弧が消える)。
      const off = (HP_ARC_LEN * (1 - ratio)).toFixed(2);
      if (off !== this.lastHpOff) {
        ring.setAttribute('stroke-dashoffset', off);
        this.lastHpOff = off;
      }
      ring.classList.toggle('hp-low', ratio < 0.35);
    }
    const vignette = this.el['vignette'];
    if (vignette) {
      const ratio = snap.hp / snap.maxHp;
      // 瀕死(25%未満)は赤いビネットを脈動させる。脈動中はopacityをCSSアニメに委ねる
      const lowPulse = snap.alive && ratio < 0.25 && !snap.reduceMotion;
      vignette.classList.toggle('low', lowPulse);
      if (lowPulse) vignette.style.removeProperty('opacity');
      // V18修正: 絶対HP40固定だと maxHp=300(ニンジャ)で13%まで警告が出ない(reduceMotion層は特に)。
      // maxHp比率(40%窓)へ較正して maxHp に追従させる
      else {
        const dmgWindow = snap.maxHp * 0.4;
        vignette.style.opacity = String(
          Math.min(0.85, Math.max(0, (dmgWindow - snap.hp) / dmgWindow)),
        );
      }
    }
    if (snap.tookDamage) this.restartAnimation('flash', 'show');
  }

  private pushFeed(snap: MatchSnapshot): void {
    const feed = this.el['feed'];
    if (!feed) return;
    for (const entry of snap.feed) {
      const row = document.createElement('div');
      row.className = 'hud-feed-row';
      row.dataset.kind = entry.headshot ? 'hs' : entry.weapon === '近接' ? 'melee' : '';
      const killer = document.createElement('span');
      killer.className = entry.killer === 'あなた' ? 'feed-you' : 'feed-name';
      killer.textContent = entry.killer;
      const weapon = document.createElement('span');
      weapon.className = entry.headshot ? 'feed-weapon feed-hs' : 'feed-weapon';
      weapon.textContent = entry.headshot ? `${entry.weapon}(HS)` : entry.weapon;
      const victim = document.createElement('span');
      victim.className = entry.victim === 'あなた' ? 'feed-you' : 'feed-name';
      victim.textContent = entry.victim;
      row.append(killer, weapon, victim);
      feed.appendChild(row);
      window.setTimeout(() => {
        row.classList.add('feed-out');
        window.setTimeout(() => row.remove(), 400);
      }, FEED_LIFETIME_MS);
    }
    while (feed.childElementCount > 6) feed.firstElementChild?.remove();
  }

  private pushHits(snap: MatchSnapshot): void {
    const marker = this.el['hitmarker'];
    if (!marker || snap.hits.length === 0) return;
    // R20 ティア言語: snipe > kill > head > hit > limb(最弱)を1段だけ選ぶ。
    // 'limb'はmatch.ts側の配線待ちだが、HUDのティア対応(クラス/CSS)は先に用意しておく
    // (MatchSnapshot.hits の型は既に 'limb' を含む)。
    const strongest = snap.hits.includes('snipe')
      ? 'hm-snipe'
      : snap.hits.includes('kill')
        ? 'hm-kill'
        : snap.hits.includes('head')
          ? 'hm-head'
          : snap.hits.includes('hit')
            ? 'hm-hit'
            : 'hm-limb';
    marker.classList.remove('hm-hit', 'hm-head', 'hm-kill', 'hm-snipe', 'hm-limb', 'show');
    void marker.offsetWidth;
    marker.classList.add(strongest, 'show');

    // キル確定時、画面中心から広がる光輪(省モーション時はスキップ)。
    // スコープ覗き込み中はクロスヘアが opacity:0 になるため、隠れない #hud 直下へ付ける
    if ((strongest === 'hm-kill' || strongest === 'hm-snipe') && !snap.reduceMotion) {
      const ring = document.createElement('span');
      ring.className =
        strongest === 'hm-snipe' ? 'hud-kill-ring hud-kill-ring--snipe' : 'hud-kill-ring';
      this.root.appendChild(ring);
      window.setTimeout(() => ring.remove(), 220);
    }
    // R20 hm-kill: 6本の細針が中心から弾ける高速な放射スパーク(kill-ringと同型のDOM+寿命)。
    // reduceMotion時はスキーム全体を出さない(spawnゲート=CSSアニメも走らない)
    if (strongest === 'hm-kill' && !snap.reduceMotion) {
      const spark = document.createElement('span');
      spark.className = 'hud-hit-spark';
      spark.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
      this.root.appendChild(spark);
      window.setTimeout(() => spark.remove(), 200);
    }
  }

  private pushDamageNumbers(snap: MatchSnapshot, project: Project): void {
    const layer = this.el['dmg'];
    if (!layer) return;
    for (const dn of snap.damageNumbers) {
      const point = project(dn.world);
      if (point.behind) continue;
      const node = document.createElement('span');
      node.className =
        dn.kind === 'kill'
          ? 'hud-dmg-num hud-dmg-num--kill'
          : dn.kind === 'head'
            ? 'hud-dmg-num hud-dmg-num--head'
            : 'hud-dmg-num';
      node.textContent = String(dn.amount);
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      layer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('rise'));
      window.setTimeout(() => node.remove(), 750);
    }
  }

  // メダル表示: 初取得=中央のバッジ解放カード / 2回目以降=左の大文字。HSは抑止(フィードのみ)
  // R21: マルチキル系はバナーへルーティングし、従来のテキスト行/バッジには出さない
  // 同一キルで複数バッジ: medalRank最上位を即時表示、残りは500ms間隔キューへ
  private pushMedals(snap: MatchSnapshot): void {
    // medalRank降順にソートして最上位バッジを即時に出す
    const sorted = [...snap.medals].sort((a, b) => medalRank(b.id) - medalRank(a.id));
    let topBadgeFired = false;
    for (const m of sorted) {
      if (SUPPRESS_BADGE.has(m.id)) continue;
      if (MULTI_KILL_IDS.has(m.id)) {
        this.pushMultiKillBanner(m, snap.reduceMotion);
        continue;
      }
      if (m.firstUnlock || ALWAYS_BADGE.has(m.id)) {
        if (!topBadgeFired) {
          this.renderBadge(m);
          topBadgeFired = true;
        } else if (this.badgeQueue.length < 2) {
          // キュー上限2: 溢れた分はテキストフィードへ降格
          this.badgeQueue.push(m);
          if (!this.badgeQueueTimer) {
            this.badgeQueueTimer = window.setInterval(() => { this.flushBadgeQueue(); }, 500);
          }
        } else {
          this.pushMedalText(m);
        }
      } else {
        this.pushMedalText(m);
      }
    }
  }

  private flushBadgeQueue(): void {
    const m = this.badgeQueue.shift();
    if (!m) {
      window.clearInterval(this.badgeQueueTimer);
      this.badgeQueueTimer = 0;
      return;
    }
    this.renderBadge(m);
  }

  // R21 マルチキルバナー: 画面中央上寄りに段階エスカレーション演出で表示する。
  // 連続段更新(1.5秒以内)はバナー昇格更新(スケールパンチ+ピップ追加)。単一バナー要素を再利用。
  private pushMultiKillBanner(m: MedalEvent, reduceMotion: boolean): void {
    const cfg = MK_CFG[m.id];
    if (!cfg) return;

    const banner = this.el['mkbanner'];
    if (!banner) return;
    const label = this.el['mklabel'];
    const pips = this.el['mkpips'];

    const now = Date.now();
    // 1.5秒以内に既バナーが表示中ならアップグレード(パンチ)。それ以外はスラムイン
    const upgrading = !banner.hidden && (now - this.mkBannerMs) < 1500;

    // 既存の消去タイマーをキャンセル
    if (this.mkTimerId) {
      window.clearTimeout(this.mkTimerId);
      this.mkTimerId = 0;
    }

    // ── ラベル更新 ──
    if (label) {
      if (label.textContent !== m.name) label.textContent = m.name;
      label.style.color = cfg.color;
      // クロマ収差: 赤/青をずらした二重残像(段が上がるほど増幅)
      if (cfg.chromaPx > 0) {
        label.style.textShadow = [
          `${cfg.chromaPx}px 0 0 rgba(255,30,30,0.55)`,
          `${-cfg.chromaPx}px 0 0 rgba(30,80,255,0.50)`,
          `0 0 26px ${cfg.color}`,
          `0 2px 8px rgba(0,0,0,0.92)`,
        ].join(', ');
      } else {
        label.style.textShadow = `0 0 26px ${cfg.color}, 0 2px 8px rgba(0,0,0,0.92)`;
      }
    }

    // ── スカルピップ列: アセットレス inline SVG 菱形。キル数ぶん全点灯 ──
    if (pips) {
      const pipSvg =
        `<svg class="mk-pip" viewBox="0 0 10 10" aria-hidden="true">` +
        `<polygon points="5,0.5 9.5,5 5,9.5 0.5,5"` +
        ` fill="currentColor" stroke="currentColor" stroke-width="1"/></svg>`;
      let pipHtml = '';
      for (let i = 0; i < cfg.pips; i += 1) pipHtml += pipSvg;
      pips.innerHTML = pipHtml;
      pips.style.color = cfg.color;
    }

    // スラム強度を CSS 変数で公開(keyframe が参照)
    banner.style.setProperty('--mk-scale', String(cfg.slamScale));

    if (reduceMotion) {
      // 省モーション: アニメなし即時表示
      banner.hidden = false;
      banner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
    } else if (upgrading) {
      // アップグレード: 既存バナーをスケールパンチ
      banner.classList.remove('mk-enter', 'mk-exit');
      void banner.offsetWidth; // reflow でアニメ再起動
      banner.classList.add('mk-punch');
      banner.hidden = false;
    } else {
      // 新規: スラムイン
      banner.classList.remove('mk-punch', 'mk-exit');
      banner.hidden = false;
      void banner.offsetWidth;
      banner.classList.add('mk-enter');
    }

    this.mkBannerMs = now;

    // 表示時間経過後に消去
    this.mkTimerId = window.setTimeout(() => {
      this.mkTimerId = 0;
      if (!banner.hidden) {
        if (reduceMotion) {
          banner.hidden = true;
          banner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
        } else {
          banner.classList.remove('mk-enter', 'mk-punch');
          void banner.offsetWidth;
          banner.classList.add('mk-exit');
          window.setTimeout(() => {
            banner.hidden = true;
            banner.classList.remove('mk-exit');
          }, 300);
        }
      }
    }, cfg.lifetimeMs);
  }

  private renderBadge(m: MedalEvent): void {
    const stack = this.el['badgestack'];
    if (!stack) return;
    const card = document.createElement('div');
    card.className = 'hud-badge';
    card.style.color = m.color;
    const tag = m.firstUnlock ? '実績解放' : '達成';
    card.innerHTML = `${this.makeBadgeSvg(m)}<div class="badge-name">${m.name}</div><div class="badge-tag">${tag}</div>`;
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));
    window.setTimeout(() => {
      card.classList.add('out');
      window.setTimeout(() => card.remove(), 500);
    }, 3200);
    // cap 2
    while (stack.childElementCount > 2) stack.firstElementChild?.remove();
  }

  private pushMedalText(m: MedalEvent): void {
    const stack = this.el['medalstack'];
    if (!stack) return;
    const row = document.createElement('div');
    row.className = 'hud-medal';
    row.style.color = m.color;
    const combo = m.combo >= 2 ? `<i>×${m.combo}</i>` : '';
    row.innerHTML = `<span>${m.name}</span>${combo}`;
    stack.appendChild(row);
    requestAnimationFrame(() => row.classList.add('show'));
    window.setTimeout(() => {
      row.classList.add('out');
      window.setTimeout(() => row.remove(), 400);
    }, 1800);
    while (stack.childElementCount > 6) stack.firstElementChild?.remove();
  }

  // 階級ごとに形の違うエンブレムをSVGで生成(盾/六角/星/八角 + 金属グラデ + グロー + 中央アイコン)
  private makeBadgeSvg(m: MedalEvent): string {
    const id = `bdg${this.badgeSeq++}`;
    const shape =
      m.tier === 'bronze'
        ? '<path d="M60 8 L106 24 V62 C106 90 86 106 60 116 C34 106 14 90 14 62 V24 Z"/>'
        : m.tier === 'gold'
          ? `<polygon points="${starPoints(60, 60, 5, 52, 23)}"/>`
          : `<polygon points="${ngonPoints(60, 60, m.tier === 'silver' ? 6 : 8, 52)}"/>`;
    return `<svg viewBox="0 0 120 120" class="badge-svg" aria-hidden="true">
      <defs>
        <radialGradient id="${id}g" cx="50%" cy="36%" r="68%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
          <stop offset="0.4" stop-color="currentColor" stop-opacity="0.92"/>
          <stop offset="1" stop-color="#080a0e" stop-opacity="0.96"/>
        </radialGradient>
        <filter id="${id}f" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="currentColor" flood-opacity="0.9"/>
        </filter>
      </defs>
      <g filter="url(#${id}f)" fill="url(#${id}g)" stroke="currentColor" stroke-width="3" stroke-linejoin="round">${shape}</g>
      <g class="badge-icon" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${badgeIcon(m.tier)}</g>
    </svg>`;
  }

  // レーダーのブリップ(敵マーカー)を上限数だけプールしておく。毎フレーム属性更新のみ
  private buildRadar(): void {
    const group = this.el['radarblips'];
    if (!group) return;
    for (let i = 0; i < 12; i += 1) {
      const blip = document.createElementNS(SVG_NS, 'circle');
      blip.setAttribute('class', 'radar-blip');
      blip.setAttribute('r', '2.6');
      blip.setAttribute('cx', '0');
      blip.setAttribute('cy', '0');
      (blip as unknown as HTMLElement).style.display = 'none';
      group.appendChild(blip);
    }
  }

  // 視認できている敵を相対方位で円形レーダーに描く。透視防止のため可視判定済みのみ来る
  private updateRadar(snap: MatchSnapshot): void {
    const radar = this.el['radar'];
    const group = this.el['radarblips'];
    if (!radar || !group) return;
    const on = snap.radarEnabled && snap.alive;
    radar.hidden = !on;
    if (!on) return;
    const blips = group.children;
    for (let i = 0; i < blips.length; i += 1) {
      const blip = blips[i] as unknown as {
        setAttribute: (k: string, v: string) => void;
        style: CSSStyleDeclaration;
      };
      const bearing = snap.enemyBearings[i];
      if (!bearing) {
        blip.style.display = 'none';
        continue;
      }
      const rr = Math.min(44, (bearing.dist / RADAR_RANGE_M) * 44);
      blip.setAttribute('cx', (Math.sin(bearing.angle) * rr).toFixed(1));
      blip.setAttribute('cy', (-Math.cos(bearing.angle) * rr).toFixed(1));
      blip.style.display = '';
    }
  }

  // R30 ダメージ方向アーク: 画面中央周りの赤い弧セグメント(被弾方向に幅40°、0.6sフェード)。
  // PostFXの方向ヴィネット(uHitDir)と2チャンネル併走=シェーダは面の赤み、DOMは輪郭の方位。
  // reduceMotion時はグロー無しの簡略描画(CSSの .rm)。
  private pushIncoming(snap: MatchSnapshot): void {
    const layer = this.el['incoming'];
    if (!layer) return;
    for (const angle of snap.incoming) {
      const DEG = 40;
      const R = 82;
      const halfRad = (DEG / 2) * (Math.PI / 180);
      const a0 = angle - halfRad;
      const a1 = angle + halfRad;
      const x0 = Math.sin(a0) * R;
      const y0 = -Math.cos(a0) * R;
      const x1 = Math.sin(a1) * R;
      const y1 = -Math.cos(a1) * R;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', snap.reduceMotion ? 'hud-incoming-arc rm' : 'hud-incoming-arc');
      svg.setAttribute('viewBox', '-100 -100 200 200');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
      path.setAttribute('class', 'hud-incoming-arc-path');
      svg.appendChild(path);
      layer.appendChild(svg);
      window.setTimeout(() => svg.remove(), 620);
    }
  }

  // R30 スコアイベントリボン: 右下(ストリークUI付近)に「+100 キル」等が上へ積み上がる。
  // snap.scoreEvents(消費型・キル/HS/確保/メダルXP)を単一コンテナへ append、
  // 2.5sフェード(2150ms表示+350ms退場)・最大4行。旧中央トーストはR30で本リボンへ一本化。
  private pushXpRibbon(snap: MatchSnapshot): void {
    const layer = this.el['xpribbon'];
    if (!layer || snap.scoreEvents.length === 0) return;
    for (const ev of snap.scoreEvents) {
      const row = document.createElement('div');
      row.className = 'xp-ribbon-row';
      row.innerHTML = `<b>+${ev.xp}</b><span>${ev.label}</span>`;
      layer.appendChild(row);
      requestAnimationFrame(() => row.classList.add('show'));
      window.setTimeout(() => {
        row.classList.add('out');
        window.setTimeout(() => row.remove(), 350);
      }, 2150);
    }
    while (layer.childElementCount > 4) layer.firstElementChild?.remove();
  }

  private updateDeath(snap: MatchSnapshot): void {
    const death = this.el['death'];
    if (!death) return;
    death.hidden = snap.alive;
    if (!snap.alive) this.text('respawn', snap.respawnIn.toFixed(1));

    // ── R11 キルカメラ・シネマ(#hud直下・opacity/body classで駆動) ──
    // シネマ枠はカメラの真実(killcamCamActive)に連動=bailで観戦へ切替時も乖離しない
    const kcActive = snap.killcamCamActive && snap.killcamWeapon !== null;
    document.body.classList.toggle('killcam-active', kcActive);
    if (kcActive) {
      if (snap.killcam !== null) this.text('kcname', snap.killcam);
      if (snap.killcamWeapon !== null) this.text('kcweapon', snap.killcamWeapon);
      this.text('kcdist', String(snap.killcamDistM));
      const timer = this.el['kctimer'];
      if (timer) timer.style.width = `${Math.max(0, Math.min(1, snap.killcamRatio)) * 100}%`;
    }
    // 黒幕/フラッシュ/終盤ビネットは opacity のみ(遷移で常時滑らかに減衰)
    const veil = this.el['kcveil'];
    if (veil) veil.style.opacity = String(Math.max(0, Math.min(1, snap.deathVeil)));
    const flash = this.el['kcflash'];
    if (flash) flash.style.opacity = String(Math.max(0, Math.min(1, snap.killcamFlash)));
    const vign = this.el['kcvign'];
    if (vign) vign.classList.toggle('final', snap.killcamFinal);
  }

  private updateMovement(snap: MatchSnapshot): void {
    // スピードライン: スプリント速度を超えた量に応じて画面の縁を締める
    const speedlines = this.el['speedlines'];
    if (speedlines) {
      const over = (snap.speed - MOVE_SPEEDS.sprint) / (MOVE_SPEEDS.airMax - MOVE_SPEEDS.sprint);
      // 画面揺れ軽減(アクセシビリティ)時はスピードラインを出さない
      speedlines.style.opacity =
        snap.alive && !snap.reduceMotion ? String(Math.min(0.55, Math.max(0, over) * 0.6)) : '0';
    }

    const move = this.el['move'];
    let state = '';
    if (snap.wallRunning) state = 'WALL RUN';
    else if (snap.sliding) state = 'SLIDE';
    else if (snap.airborne) state = 'AIR';
    if (move) {
      move.hidden = state === '' || !snap.alive;
      // 状態が切り替わった瞬間だけラベルを更新してパルスさせる
      if (state !== this.lastMoveState && state !== '') {
        this.text('movestate', state);
        move.classList.remove('show');
        void move.offsetWidth;
        move.classList.add('show');
      }
      const fill = this.el['speedfill'];
      if (fill) fill.style.width = `${Math.min(100, (snap.speed / MOVE_SPEEDS.airMax) * 100)}%`;
    }
    this.lastMoveState = state;
  }

  // アルティメットの充填メーター。満タンで点灯、発動中はオーバードライブ表示
  private updateUlt(snap: MatchSnapshot): void {
    const fill = this.el['ultfill'];
    if (fill) fill.style.width = `${Math.min(100, snap.ultCharge * 100)}%`;
    const ult = this.el['ult'];
    if (ult) {
      ult.hidden = !snap.alive;
      ult.classList.toggle('ult-ready', snap.ultCharge >= 1 && !snap.ultActive);
      ult.classList.toggle('ult-active', snap.ultActive);
    }
    const label = this.el['ultlabel'];
    if (label) {
      const text = snap.ultActive ? 'OVERDRIVE' : snap.ultCharge >= 1 ? 'ULT 準備完了 [F]' : 'ULT';
      if (label.textContent !== text) label.textContent = text;
    }
    // 発動の瞬間に画面側の閃光を一度だけ出す(ワールド側の炸裂はカメラ内側で
    // 見えないため)。単発のソフトパルスでreduceMotion時は出さない
    if (snap.ultActive && !this.lastUltActive && !snap.reduceMotion) {
      this.restartAnimation('ultflash', 'show');
    }
    this.lastUltActive = snap.ultActive;
  }

  // 連続キルの節目で中央上にバナーを出す
  private updateBanner(snap: MatchSnapshot): void {
    const banner = this.el['banner'];
    if (!banner) return;
    if (snap.streak > this.lastStreak && snap.streak >= 3) {
      const labels: Record<number, string> = {
        3: 'TRIPLE KILL',
        4: 'MULTI KILL',
        5: 'RAMPAGE',
        7: 'UNSTOPPABLE',
        10: 'GODLIKE',
      };
      const label = labels[snap.streak] ?? `KILLSTREAK ×${snap.streak}`;
      const node = document.createElement('div');
      node.className = 'hud-banner-row';
      node.textContent = label;
      banner.appendChild(node);
      window.setTimeout(() => {
        node.classList.add('banner-out');
        window.setTimeout(() => node.remove(), 400);
      }, 1400);
      while (banner.childElementCount > 2) banner.firstElementChild?.remove();
    }
    this.lastStreak = snap.streak;
  }

  private renderScoreboard(snap: MatchSnapshot): void {
    const body = this.el['scorerows'];
    if (!body) return;
    this.text('scoremode', snap.modeName);
    this.text('scoregoal', `先取 ${snap.scoreTarget}`);
    body.innerHTML = '';
    for (const row of snap.scoreboard) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'score-you';
      else if (snap.teamBased && row.isAlly) tr.className = 'score-ally';
      const name = document.createElement('td');
      name.textContent = row.name;
      const kills = document.createElement('td');
      kills.textContent = String(row.kills);
      const deaths = document.createElement('td');
      deaths.textContent = String(row.deaths);
      tr.append(name, kills, deaths);
      body.appendChild(tr);
    }
  }

  /** キルコンファーム CONFIRMED / DENIED バナーを一時表示する */
  private pushKcEvent(ev: 'confirmed' | 'denied'): void {
    const el = this.el['kcevent'];
    if (!el) return;
    el.textContent = ev === 'confirmed' ? 'CONFIRMED' : 'DENIED';
    el.dataset.kind = ev;
    el.hidden = false;
    el.classList.remove('kc-show', 'kc-out');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('kc-show');
    window.setTimeout(() => {
      el.classList.add('kc-out');
      window.setTimeout(() => { el.hidden = true; el.classList.remove('kc-show', 'kc-out'); }, 350);
    }, 900);
  }

  private restartAnimation(id: string, className: string): void {
    const node = this.el[id];
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  // ── ファイナルキルカム ──────────────────────────────────────────────

  /** ファイナルキルカム開始: シネマバー + バナーを表示する */
  showFinalKillcam(): void {
    this.fkcRoot.classList.add('fkc-active');
  }

  /** ファイナルキルカム終了: オーバーレイを隠す。スコープが残っていたら消す */
  hideFinalKillcam(): void {
    this.fkcRoot.classList.remove('fkc-active');
    // キルカム終了時にスコープオーバーレイを確実に閉じる
    const scope = this.el['scope'];
    if (scope) {
      scope.hidden = true;
      this.scopeOn = false;
    }
  }

  /**
   * フラッシュ強度(0..1)とスコープ状態を毎フレーム更新する。
   * adsRatio > 0.85 かつ isScope のときスコープオーバーレイを表示する。
   * viewmodelは非表示のまま、既存の hud-scope 要素をキルカム中も駆動する。
   */
  updateFinalKillcam(flash: number, adsRatio = 0, isScope = false): void {
    this.fkcFlashEl.style.opacity = String(flash > 0.001 ? flash : 0);

    const scope = this.el['scope'];
    if (!scope) return;

    // スコープオーバーレイ: ADS率>0.85 かつ scope武器でのキルの場合のみ表示
    const scopeOn = isScope && adsRatio > 0.85;
    scope.hidden = !scopeOn;
    if (!scopeOn) {
      this.scopeOn = false;
      return;
    }
    // 既存の data属性と CSS変数を最小限セット(通常プレイの updateScope と同じ仕組み)
    const t = Math.min(1, (adsRatio - 0.5) / 0.5);
    scope.style.opacity = String(t);
    scope.style.setProperty('--in', String(t));
    scope.style.setProperty('--conv', String(1 - t));
    // キルカム中: 息揺れなし・glintなし・steady/engaged クラスなし
    scope.style.setProperty('--breath', '0');
    scope.style.setProperty('--swx', '0px');
    scope.style.setProperty('--swy', '0px');
    scope.classList.remove('steady', 'engaged');
    // 初回entry でグリント
    if (!this.scopeOn) {
      this.restartAnimation('scopeglint', 'show');
      this.scopeOn = true;
    }
  }

  private updateZombieShopHud(snap: MatchSnapshot): void {
    const inZombie = snap.zombieRound !== undefined;

    // ── パーク所持アイコン ──
    const zperks = this.el['zperks'];
    if (zperks) {
      zperks.hidden = !inZombie;
      const stacks = snap.zombiePerkStacks ?? {};
      // V23: quick-reviveはスタックMapに入らない(チャージ制)ため、チャージ数をキー/描画に含める
      const revCharges = snap.zombieQuickReviveCharges ?? 0;
      const key =
        (snap.zombiePerks ?? []).map((pid) => `${pid}:${stacks[pid] ?? 1}`).join(',') +
        `|rev:${revCharges}`;
      if (inZombie && key !== this.lastZombiePerks) {
        this.lastZombiePerks = key;
        zperks.innerHTML = '';
        const PERK_COLORS: Record<string, string> = {
          juggernog: '#ff3333',
          'speed-cola': '#33ffee',
          'double-tap': '#ff9933',
          'stamin-up': '#ffee33',
          'quick-revive': '#3355ff',
        };
        const PERK_LABELS: Record<string, string> = {
          juggernog: 'JUG',
          'speed-cola': 'SPD',
          'double-tap': 'DBL',
          'stamin-up': 'STM',
          'quick-revive': 'REV',
        };
        const PERK_ARIA: Record<string, string> = {
          juggernog: 'ジャガーノグ: 最大HP増加',
          'speed-cola': 'スピードコーラ: リロード速度上昇',
          'double-tap': 'ダブルタップ: 射速2倍',
          'stamin-up': 'スタミンアップ: 移動速度上昇',
          'quick-revive': 'クイックリバイブ: 高速復活',
        };
        for (const pid of snap.zombiePerks ?? []) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = PERK_ARIA[pid] ?? pid;
          chip.setAttribute('aria-label', PERK_ARIA[pid] ?? pid);
          chip.style.setProperty('--zp-color', PERK_COLORS[pid] ?? '#fff');
          const abbr = document.createElement('span');
          abbr.textContent = PERK_LABELS[pid] ?? pid.slice(0, 3).toUpperCase();
          chip.appendChild(abbr);
          const n = stacks[pid] ?? 1;
          if (n > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${n}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
        // V23: quick-revive所持チップ(チャージ制のためスタックMap外。所持中のみ表示)
        if (revCharges > 0) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = 'クイックリバイブ: 高速復活';
          chip.setAttribute('aria-label', 'クイックリバイブ: 高速復活');
          chip.style.setProperty('--zp-color', '#3355ff');
          const abbr = document.createElement('span');
          abbr.textContent = 'REV';
          chip.appendChild(abbr);
          if (revCharges > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${revCharges}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
      }
    }

    // ── 購入プロンプト ──
    const zbuy = this.el['zbuy'];
    if (zbuy) {
      const prompt = snap.zombieShopPrompt;
      zbuy.hidden = !inZombie || !prompt;
      if (inZombie && prompt) {
        const text = prompt.label;
        if (zbuy.dataset.label !== text || zbuy.dataset.afford !== String(prompt.canAfford)) {
          zbuy.dataset.label = text;
          zbuy.dataset.afford = String(prompt.canAfford);
          zbuy.textContent = text;
          zbuy.classList.toggle('zbuy-broke', !prompt.canAfford);
        }
      }
    }
  }

  private pushZombiePointFloats(snap: MatchSnapshot, project: Project): void {
    if (!snap.zombiePointFloats?.length) return;
    const layer = this.el['dmg'];
    if (!layer) return;
    for (const pf of snap.zombiePointFloats) {
      const pt = project(pf.world);
      if (pt.behind) continue;
      const node = document.createElement('span');
      node.className = 'hud-zpfloat';
      node.textContent = `+${pf.amount}`;
      node.style.left = `${pt.x}px`;
      node.style.top = `${pt.y - 30}px`;
      layer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('rise'));
      window.setTimeout(() => node.remove(), 900);
    }
  }

  private updateZombieReviveFlash(snap: MatchSnapshot): void {
    const el = this.el['zreviveflash'];
    if (!el) return;
    const v = snap.zombieReviveFlash ?? 0;
    el.style.opacity = v > 0.001 ? String(v) : '0';
  }

  private updateZombieBossFlash(snap: MatchSnapshot): void {
    const el = this.el['zbossflash'];
    if (!el) return;
    const v = snap.zombieBossFlash ?? 0;
    el.style.opacity = v > 0.001 ? String(v) : '0';
  }

  private updateDarkEmperorHud(snap: MatchSnapshot): void {
    const el = this.el['darkemperor'];
    if (!el) return;
    const secs = snap.darkEmperorS ?? 0;
    // 黒雷帝が最上位: 黒雷帝発動中は黒帝バッジを隠す(黒雷帝バッジが単独表示)
    const active = secs > 0 && !snap.kokuraiteiMode;
    el.hidden = !active;
    if (active) {
      const timerEl = this.el['detimer'];
      if (snap.darkEmperorPermanent) {
        if (timerEl) timerEl.hidden = true;
      } else {
        if (timerEl) timerEl.hidden = false;
        const mm = Math.floor(secs / 60);
        const ss = Math.floor(secs % 60);
        this.text('detimer', `${mm}:${String(ss).padStart(2, '0')}`);
      }
    }
  }

  private updateRaiteiHud(snap: MatchSnapshot): void {
    const el = this.el['raitei'];
    if (!el) return;
    // バッジ優先度: 黒雷帝 > 黒帝 > 雷帝。上位モード発動中は雷帝バッジを隠す
    const darkActive = (snap.darkEmperorS ?? 0) > 0;
    el.hidden = !(snap.raiteiMode && !snap.kokuraiteiMode && !darkActive);
  }

  private updateKokuraiteiHud(snap: MatchSnapshot): void {
    const el = this.el['kokuraitei'];
    if (!el) return;
    el.hidden = !snap.kokuraiteiMode;
  }

  private updateChargeGauge(snap: MatchSnapshot): void {
    const el = this.el['chargegauge'];
    if (!el) return;
    const ratio = snap.chargeRatio ?? 0;
    el.hidden = ratio <= 0;
    if (ratio > 0) {
      const fill = this.el['chargefill'];
      if (fill) {
        (fill as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
        fill.classList.toggle('charge-full', ratio >= 1);
        fill.classList.toggle('charge-kokuraitei', !!snap.kokuraiteiMode);
      }
    }
  }

  // 修羅スピンアップRPMゲージ(hud-charge-gauge流儀の小ゲージ)。minigun装備+スピン>0のみ表示。
  // 発射開始しきい(400rpm≒0.22)まで緑、以降は黄、フルスピン間近(≥0.85)で赤
  private updateSpinGauge(snap: MatchSnapshot): void {
    const el = this.el['spingauge'];
    if (!el) return;
    const spin = snap.minigunSpin01 ?? 0;
    el.hidden = spin <= 0;
    if (spin > 0) {
      const fill = this.el['spinfill'];
      if (fill) {
        (fill as HTMLElement).style.width = `${Math.round(spin * 100)}%`;
        fill.classList.toggle('spin-mid', spin >= 0.22 && spin < 0.85);
        fill.classList.toggle('spin-hot', spin >= 0.85);
      }
    }
  }

  // ── ガンゲーム HUD ──────────────────────────────────────────────────────────────────────
  private updateGunGameHud(snap: MatchSnapshot): void {
    const el = this.el['gg'];
    if (!el) return;
    const inGG = snap.ggRank !== undefined;
    el.hidden = !inGG;
    if (!inGG) return;

    const rank = snap.ggRank!;
    this.text('ggrank', `${rank} / 20`);
    this.text('ggweapon', snap.ggWeaponName ?? '');

    // ランクアップフラッシュ(1フレームだけ演出クラスを付与)
    if (snap.ggRankUpFlash) {
      el.classList.add('gg-rankup');
      setTimeout(() => el.classList.remove('gg-rankup'), 600);
    }
    if (snap.ggSetback) {
      el.classList.add('gg-setback');
      setTimeout(() => el.classList.remove('gg-setback'), 600);
    }

    // トップ3リーダーボード
    const top3El = this.el['ggtop3'];
    if (top3El && snap.ggTop3) {
      top3El.innerHTML = snap.ggTop3.map((e, i) =>
        `<div class="gg-top3-row${e.isPlayer ? ' gg-top3-you' : ''}">` +
        `<span class="gg-top3-pos">${i + 1}</span>` +
        `<span class="gg-top3-name">${e.isPlayer ? 'YOU' : e.name}</span>` +
        `<span class="gg-top3-rank">${e.rank}</span>` +
        `</div>`
      ).join('');
    }
  }
}
