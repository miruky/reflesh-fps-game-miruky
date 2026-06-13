import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match';

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

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-score"><span data-id="kills">0</span> キル <span class="hud-dim">/</span> <span data-id="deaths">0</span> デス</div>
        <div class="hud-streak" data-id="streak" hidden></div>
      </div>
      <div class="hud-top-center">
        <div class="hud-compass"><div class="hud-compass-strip" data-id="compass"></div><div class="hud-compass-needle"></div></div>
        <div class="hud-timer" data-id="timer">5:00</div>
      </div>
      <div class="hud-feed" data-id="feed"></div>
      <div class="hud-crosshair" data-id="crosshair">
        <span class="ch-dot"></span>
        <span class="ch-bar ch-t" data-id="cht"></span>
        <span class="ch-bar ch-b" data-id="chb"></span>
        <span class="ch-bar ch-l" data-id="chl"></span>
        <span class="ch-bar ch-r" data-id="chr"></span>
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
        <div class="hud-hp-num" data-id="hp">100</div>
        <div class="hud-hp-bar"><div data-id="hpfill"></div></div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-weapon" data-id="weapon"></div>
        <div class="hud-ammo"><span data-id="ammo">30</span><span class="hud-reserve" data-id="reserve">/ 120</span></div>
        <div class="hud-mode" data-id="mode"></div>
        <div class="hud-grenade"><span data-id="gname"></span><span class="hud-gcount" data-id="gcount"></span></div>
      </div>
      <div class="hud-dmg-layer" data-id="dmg"></div>
      <div class="hud-incoming" data-id="incoming"></div>
      <div class="hud-vignette" data-id="vignette"></div>
      <div class="hud-flash" data-id="flash"></div>
      <div class="hud-whiteout" data-id="whiteout"></div>
      <div class="hud-death" data-id="death" hidden>
        <div class="hud-death-title">やられた</div>
        <div class="hud-death-sub">リスポーンまで <span data-id="respawn">0.0</span> 秒</div>
      </div>
      <div class="hud-scoreboard" data-id="scoreboard" hidden>
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
    this.updateAmmo(snap);
    this.updateGrenade(snap);
    this.updateHp(snap);
    this.pushFeed(snap);
    this.pushHits(snap);
    this.pushDamageNumbers(snap, project);
    this.pushIncoming(snap);
    this.updateDeath(snap);

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
    if (!snap.alive) {
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

  private updateAmmo(snap: MatchSnapshot): void {
    this.text('weapon', snap.weaponName);
    this.text('ammo', String(snap.ammo));
    this.text('reserve', `/ ${snap.reserve}`);
    this.text('mode', snap.fireMode);
    const ammoEl = this.el['ammo'];
    if (ammoEl) ammoEl.classList.toggle('hud-ammo-low', snap.ammo <= 5);

    const reload = this.el['reload'];
    if (reload) reload.hidden = !snap.reloading;
    const fill = this.el['reloadfill'];
    if (fill && snap.reloading) fill.style.width = `${snap.reloadRatio * 100}%`;
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
    const fill = this.el['hpfill'];
    if (fill) {
      const ratio = snap.hp / snap.maxHp;
      fill.style.width = `${ratio * 100}%`;
      fill.classList.toggle('hp-low', ratio < 0.35);
    }
    const vignette = this.el['vignette'];
    if (vignette) {
      vignette.style.opacity = String(Math.min(0.85, Math.max(0, (40 - snap.hp) / 40)));
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
    const strongest = snap.hits.includes('kill')
      ? 'hm-kill'
      : snap.hits.includes('head')
        ? 'hm-head'
        : 'hm-hit';
    marker.classList.remove('hm-hit', 'hm-head', 'hm-kill', 'show');
    void marker.offsetWidth;
    marker.classList.add(strongest, 'show');
  }

  private pushDamageNumbers(snap: MatchSnapshot, project: Project): void {
    const layer = this.el['dmg'];
    if (!layer) return;
    for (const dn of snap.damageNumbers) {
      const point = project(dn.world);
      if (point.behind) continue;
      const node = document.createElement('span');
      node.className = 'hud-dmg-num';
      node.textContent = String(dn.amount);
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      layer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('rise'));
      window.setTimeout(() => node.remove(), 750);
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
  }

  private renderScoreboard(snap: MatchSnapshot): void {
    const body = this.el['scorerows'];
    if (!body) return;
    body.innerHTML = '';
    for (const row of snap.scoreboard) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'score-you';
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
