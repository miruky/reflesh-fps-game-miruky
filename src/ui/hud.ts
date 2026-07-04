import { RADAR_RANGE_M, RETICLE_COLORS } from '../core/settings';
import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match';
import { MOVE_SPEEDS } from '../game/player';
import { SUPPRESS_BADGE, ALWAYS_BADGE, starPoints, type MedalEvent } from '../game/medals';

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
  private lastHpOff = ''; // HPリングの stroke-dashoffset 直近書込み値(無変化フレームの書込み抑止)
  private lastPipMag = -1; // 弾ピップの生成済み本数(=装弾数)。変化時のみ作り直す
  private lastPipAmmo = -1; // 弾ピップの点灯本数(=残弾)。変化時のみ点灯を更新
  private lastSsStreak = -1; // スコアストリーク段の直近キル数(変化時のみ更新)

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
          <div class="hud-boss" data-id="boss" hidden>
            <div class="hud-boss-name" data-id="boss-name">BOSS</div>
            <div class="hud-boss-bar"><i data-id="boss-bar"></i></div>
          </div>
        </div>
      </div>
      <div class="hud-announce" data-id="announce"></div>
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
      <div class="hud-score-toast" data-id="scoretoast"></div>
      <div class="hud-dmg-layer" data-id="dmg"></div>
      <div class="hud-incoming" data-id="incoming"></div>
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
    // R11 キルカメラ状態の完全クリア(試合開始/離脱で黒幕やビネットを残さない)
    document.body.classList.remove('killcam-active');
    for (const id of ['kcveil', 'kcflash'] as const) {
      const n = this.el[id];
      if (n) n.style.opacity = '0';
    }
    const vign = this.el['kcvign'];
    if (vign) vign.classList.remove('final');
    const toast = this.el['scoretoast'];
    if (toast) toast.innerHTML = '';
    const badges = this.el['badgestack'];
    if (badges) badges.innerHTML = '';
    const medalStack = this.el['medalstack'];
    if (medalStack) medalStack.innerHTML = '';
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
    const timerEl = this.el['timer'];
    if (timerEl && timerEl.parentElement) {
      (timerEl.parentElement as HTMLElement).style.display = inZombie ? 'none' : '';
    }
    if (inZombie) {
      this.text('zround', String(snap.zombieRound ?? 1));
      this.text('zkills', String(snap.zombieKills ?? 0));
      this.text('zpoints', String(snap.zombiePoints ?? 0));
    } else {
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
    this.pushScoreEvents(snap);
    this.pushMedals(snap);
    this.updateRadar(snap);
    this.pushIncoming(snap);
    this.updateDeath(snap);
    this.updateMovement(snap);
    this.updateBanner(snap);
    this.updateUlt(snap);
    this.updateScorestreak(snap);

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

  private updateObjective(snap: MatchSnapshot): void {
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
      const showBoss = isMission && snap.bossHp01 !== undefined;
      boss.hidden = !showBoss;
      if (showBoss) {
        const bb = this.el['boss-bar'];
        if (bb) bb.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.bossHp01 ?? 0))})`;
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

  // スコア獲得トースト(+100 キル等)。即時報酬を可視化する。最大3件・1秒で消える
  private pushScoreEvents(snap: MatchSnapshot): void {
    const layer = this.el['scoretoast'];
    if (!layer || snap.scoreEvents.length === 0) return;
    for (const ev of snap.scoreEvents) {
      const row = document.createElement('div');
      row.className = 'score-toast-row';
      row.innerHTML = `<b>+${ev.xp}</b><span>${ev.label}</span>`;
      layer.appendChild(row);
      requestAnimationFrame(() => row.classList.add('show'));
      window.setTimeout(() => {
        row.classList.add('out');
        window.setTimeout(() => row.remove(), 260);
      }, 900);
    }
    while (layer.childElementCount > 3) layer.firstElementChild?.remove();
  }

  // メダル表示: 初取得=中央のバッジ解放カード / 2回目以降=左の大文字。HSは抑止(フィードのみ)
  private pushMedals(snap: MatchSnapshot): void {
    for (const m of snap.medals) {
      if (SUPPRESS_BADGE.has(m.id)) continue;
      // R18: レベルの高い実績(ALWAYS_BADGE=キルストリーク大台/希少偉業)は取得済みでも毎回
      // バッジを出す(達成感・気持ち良さ)。日常的に出る状況キル系・低tierは初回のみバッジ。
      if (m.firstUnlock || ALWAYS_BADGE.has(m.id)) this.pushBadge(m);
      else this.pushMedalText(m);
    }
  }

  private pushBadge(m: MedalEvent): void {
    const stack = this.el['badgestack'];
    if (!stack) return;
    const card = document.createElement('div');
    card.className = 'hud-badge';
    card.style.color = m.color; // SVGの currentColor / アクセントに使う
    // V18: 初回取得は「実績解放」、再取得(ALWAYS_BADGE)は達成表記(「解放」の誤表示を避ける)
    const tag = m.firstUnlock ? '実績解放' : '達成';
    card.innerHTML = `${this.makeBadgeSvg(m)}<div class="badge-name">${m.name}</div><div class="badge-tag">${tag}</div>`;
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));
    window.setTimeout(() => {
      card.classList.add('out');
      window.setTimeout(() => card.remove(), 500);
    }, 3200);
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
    while (stack.childElementCount > 4) stack.firstElementChild?.remove();
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

  private pushIncoming(snap: MatchSnapshot): void {
    const layer = this.el['incoming'];
    if (!layer) return;
    for (const angle of snap.incoming) {
      const wrap = document.createElement('div');
      wrap.className = 'hud-incoming-wrap';
      wrap.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
      const wedge = document.createElement('div');
      wedge.className = 'hud-incoming-wedge';
      wrap.appendChild(wedge);
      layer.appendChild(wrap);
      window.setTimeout(() => wrap.remove(), 900);
    }
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

  private restartAnimation(id: string, className: string): void {
    const node = this.el[id];
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }
}
