import { RADAR_RANGE_M, RETICLE_COLORS } from '../core/settings';
import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match';
import { MOVE_SPEEDS } from '../game/player';

const SVG_NS = 'http://www.w3.org/2000/svg';

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// レティクル色IDをCSS色へ。未知IDはアクセント色に追従
function reticleColorValue(id: string): string {
  return RETICLE_COLORS.find((c) => c.id === id)?.value ?? 'var(--accent)';
}

type Project = (world: THREE.Vector3) => { x: number; y: number; behind: boolean };

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

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private compassMarks: Array<{ bearing: number; el: HTMLElement }> = [];
  private lastStreak = 0;
  private lastMoveState = '';
  private lastUltActive = false; // オーバードライブ発動の立ち上がり検出用
  private scopeOn = false; // スコープ表示の立ち上がり検出用
  private wasSteady = false; // 息止め成立の立ち上がり検出用(集中グリント再発火)

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-match-chip"><span data-id="modename">フリーフォーオール</span><i>LIVE</i></div>
        <div class="hud-score">
          <span><strong data-id="kills">0</strong><small>KILLS</small></span>
          <span><strong data-id="deaths">0</strong><small>DEATHS</small></span>
        </div>
        <div class="hud-streak" data-id="streak" hidden></div>
      </div>
      <div class="hud-top-center">
        <div class="hud-compass"><div class="hud-compass-strip" data-id="compass"></div><div class="hud-compass-needle"></div></div>
        <div class="hud-timer"><small>TIME</small><strong data-id="timer">5:00</strong></div>
        <div class="hud-objective">
          <div class="hud-teamscore">
            <span class="ts-mine" data-id="scoremine">0</span>
            <span class="ts-target" data-id="scoretarget"></span>
            <span class="ts-enemy" data-id="scoreenemy">0</span>
          </div>
          <div class="hud-zones" data-id="zones" hidden></div>
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
          <circle class="sc-refring-halo" r="60"></circle>
          <circle class="sc-refring" r="60"></circle>
          <use href="#sc-marks" class="sc-halo"></use>
          <use href="#sc-marks" class="sc-core"></use>
          <circle class="sc-dot-halo" r="1.6"></circle>
          <circle class="sc-dot" r="0.7"></circle>
          <circle class="sc-lock" r="5"></circle>
        </svg>
      </div>
      <div class="hud-hitmarker" data-id="hitmarker"><span></span><span></span><span></span><span></span></div>
      <div class="hud-reload" data-id="reload" hidden>
        <div class="hud-reload-bar"><div data-id="reloadfill"></div></div>
        <span>リロード中</span>
      </div>
      <div class="hud-cook" data-id="cook" hidden>
        <div class="hud-cook-bar"><div data-id="cookfill"></div></div>
      </div>
      <div class="hud-bottom-left">
        <div class="hud-vitals-heading"><span>VITAL</span><small data-id="hpmax">/ 100</small></div>
        <div class="hud-vitals-row">
          <div class="hud-hp-num" data-id="hp">100</div>
          <div class="hud-hp-bar"><div data-id="hpfill"></div></div>
        </div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-weapon-row"><span data-id="weaponslot">PRIMARY</span><strong class="hud-weapon" data-id="weapon"></strong></div>
        <div class="hud-ammo-row">
          <div class="hud-ammo"><span data-id="ammo">30</span><span class="hud-reserve" data-id="reserve">/ 120</span></div>
          <div class="hud-mode" data-id="mode"></div>
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
      <div class="hud-ult" data-id="ult">
        <div class="hud-ult-bar"><div data-id="ultfill"></div></div>
        <span class="hud-ult-label" data-id="ultlabel">ULT</span>
      </div>
      <div class="hud-death" data-id="death" hidden>
        <div class="hud-death-title">やられた</div>
        <div class="hud-death-sub">リスポーンまで <span data-id="respawn">0.0</span> 秒</div>
        <div class="hud-killcam" data-id="killcam" hidden></div>
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
    const toast = this.el['scoretoast'];
    if (toast) toast.innerHTML = '';
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

    const minutes = Math.floor(snap.timeLeft / 60);
    const seconds = Math.floor(snap.timeLeft % 60);
    this.text('timer', `${minutes}:${String(seconds).padStart(2, '0')}`);

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
    this.updateRadar(snap);
    this.pushIncoming(snap);
    this.updateDeath(snap);
    this.updateMovement(snap);
    this.updateBanner(snap);
    this.updateUlt(snap);

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
    if (!snap.alive) {
      crosshair.style.opacity = '0';
      return;
    }
    // スコープ覗き込み中はDOMスコープに任せ、通常クロスヘアは丸ごと消す
    // (.ch-dotはバー不透明度の影響を受けないため、コンテナごと0にする)
    if (snap.scopedWeapon && snap.adsProgress > 0.5) {
      crosshair.style.opacity = '0';
      return;
    }
    crosshair.style.opacity = '1';
    const fovRad = (snap.fov * Math.PI) / 180;
    const gap = 4 + (Math.tan(snap.spreadRad) / Math.tan(fovRad / 2)) * (height / 2);
    const barOpacity = String(Math.max(0, 1 - snap.adsProgress * 1.4));
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
    const on = snap.alive && snap.scopedWeapon && t > 0;
    scope.hidden = !on;
    if (!on) {
      this.scopeOn = false;
      this.wasSteady = false;
      return;
    }
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

    const reload = this.el['reload'];
    if (reload) reload.hidden = !snap.reloading;
    const fill = this.el['reloadfill'];
    if (fill && snap.reloading) fill.style.width = `${snap.reloadRatio * 100}%`;
  }

  private updateObjective(snap: MatchSnapshot): void {
    this.text('scoremine', String(snap.scoreMine));
    this.text('scoreenemy', String(snap.scoreEnemy));
    this.text('scoretarget', `先取 ${snap.scoreTarget}`);

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
    const fill = this.el['hpfill'];
    if (fill) {
      const ratio = snap.hp / snap.maxHp;
      fill.style.width = `${ratio * 100}%`;
      fill.classList.toggle('hp-low', ratio < 0.35);
    }
    const vignette = this.el['vignette'];
    if (vignette) {
      const ratio = snap.hp / snap.maxHp;
      // 瀕死(25%未満)は赤いビネットを脈動させる。脈動中はopacityをCSSアニメに委ねる
      const lowPulse = snap.alive && ratio < 0.25 && !snap.reduceMotion;
      vignette.classList.toggle('low', lowPulse);
      if (lowPulse) vignette.style.removeProperty('opacity');
      else vignette.style.opacity = String(Math.min(0.85, Math.max(0, (40 - snap.hp) / 40)));
    }
    if (snap.tookDamage) this.restartAnimation('flash', 'show');
  }

  private pushFeed(snap: MatchSnapshot): void {
    const feed = this.el['feed'];
    if (!feed) return;
    for (const entry of snap.feed) {
      const row = document.createElement('div');
      row.className = 'hud-feed-row';
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
    const strongest = snap.hits.includes('snipe')
      ? 'hm-snipe'
      : snap.hits.includes('kill')
        ? 'hm-kill'
        : snap.hits.includes('head')
          ? 'hm-head'
          : 'hm-hit';
    marker.classList.remove('hm-hit', 'hm-head', 'hm-kill', 'hm-snipe', 'show');
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
      const blip = blips[i] as unknown as { setAttribute: (k: string, v: string) => void; style: CSSStyleDeclaration };
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
    const killcam = this.el['killcam'];
    if (killcam) {
      killcam.hidden = snap.killcam === null;
      if (snap.killcam !== null) this.text('killcam', `キルカメラ: ${snap.killcam}`);
    }
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
