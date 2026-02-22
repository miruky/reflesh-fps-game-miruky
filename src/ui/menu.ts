import { exportProfile, importProfile, saveProfile } from '../core/profile';
import type { Settings } from '../core/settings';
import { saveSettings } from '../core/settings';
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
  ['しゃがみ', 'C / 左Ctrl'],
  ['スプリント', '左Shift'],
  ['スライディング', 'スプリント中に C'],
  ['リーン', 'Q / E'],
  ['リロード', 'R'],
  ['武器切替', '1 / 2 / ホイール'],
  ['グレネード', 'G 長押しで構え、離して投擲'],
  ['投擲物切替', '3'],
  ['近接攻撃', 'V'],
  ['スコアボード', 'Tab'],
  ['ポーズ', 'Esc'],
];

const LOGO_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="hibanaのロゴ">
  <title>hibana</title>
  <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="3" opacity="0.55"/>
  <path d="M32 4v12M32 48v12M4 32h12M48 32h12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <path d="M32 22l3.2 6.8L42 32l-6.8 3.2L32 42l-3.2-6.8L22 32l6.8-3.2z" fill="#ff5a3c"/>
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
        <header class="menu-header">
          <span class="menu-logo">${LOGO_SVG}</span>
          <div>
            <h1>hibana</h1>
            <p class="menu-tagline">ブラウザで動く3D FPS</p>
          </div>
          <div class="menu-profile" data-id="profile"></div>
        </header>
        <div class="menu-columns">
          <div>
            <section class="menu-section">
              <h2>ステージ</h2>
              <div class="stage-grid" data-id="stages"></div>
            </section>
            <section class="menu-section">
              <h2>任務</h2>
              <div class="challenge-list" data-id="challenges"></div>
            </section>
          </div>
          <div class="menu-side">
            <section class="menu-section">
              <h2>モード</h2>
              <div class="mode-list" data-id="modes"></div>
            </section>
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
            <section class="menu-section">
              <h2>BOTの腕前</h2>
              <div class="difficulty-list" data-id="difficulties"></div>
            </section>
            <section class="menu-section">
              <h2>設定</h2>
              <div data-id="settings"></div>
            </section>
            <button class="menu-start" data-id="start">出撃する</button>
          </div>
        </div>
        <footer class="menu-controls">
          <h2>操作</h2>
          <div class="controls-grid" data-id="controls"></div>
        </footer>
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
    this.query('start').addEventListener('click', () => {
      this.saveLoadout();
      this.callbacks.onStart(this.selection);
    });
  }

  showPause(): void {
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-pause">
        <div class="pause-panel">
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
      ? `<p class="result-teamscore"><span class="ts-mine">${result.teamScores.mine}</span> - <span class="ts-enemy">${result.teamScores.enemy}</span></p>`
      : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-result">
        <div class="result-panel">
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
    return `
      <section class="result-progress">
        <ul class="result-xp-list">${xpRows}</ul>
        <p class="result-xp-total">獲得 ${progress.xpTotal} XP</p>
        <div class="result-levelrow">
          <span class="result-level">Lv ${level.level}</span>
          <span class="profile-xpbar"><i style="width:${xpRatio}%"></i></span>
        </div>
        ${levelUp}
        ${unlocks}
        ${rating}
      </section>
    `;
  }

  private query(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!node) throw new Error(`menu element not found: ${id}`);
    return node;
  }

  private renderStages(): void {
    const grid = this.query('stages');
    for (const stage of STAGES) {
      const card = document.createElement('button');
      card.className = 'stage-card';
      card.dataset.stage = stage.id;
      const palette = stage.palette;
      card.innerHTML = `
        <span class="stage-swatch" aria-hidden="true">
          <i style="background:${palette.floor}"></i><i style="background:${palette.wall}"></i>
          <i style="background:${palette.obstacle}"></i><i style="background:${palette.accent}"></i>
        </span>
        <span class="stage-name">${stage.name}</span>
        <span class="stage-sub">${stage.subtitle}</span>
        <span class="stage-meta">${stage.size}m 四方 / BOT ${stage.botCount}体</span>
      `;
      card.addEventListener('click', () => {
        this.selection.stageId = stage.id;
        this.markSelected(grid, 'stage', stage.id);
      });
      grid.appendChild(card);
    }
    this.markSelected(grid, 'stage', this.selection.stageId);
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
        });
      } else {
        card.disabled = true;
      }
      list.appendChild(card);
    }
    this.markSelected(list, 'weapon', this.selection.primaryId);
  }

  private bar(label: string, value: number): string {
    return `
      <span class="stat-row">
        <span class="stat-label">${label}</span>
        <span class="stat-bar"><i style="width:${value * 10}%"></i></span>
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
    panel.innerHTML = `
      <div class="profile-top">
        <span class="profile-rank">${rank.name}</span>
        <span class="profile-rating">レート ${this.profile.rating}</span>
        <span class="profile-level">Lv ${level.level}</span>
      </div>
      <div class="profile-xpbar"><i style="width:${xpRatio}%"></i></div>
      <div class="profile-stats">${stats.matches}戦 / 勝率 ${winRate}% / K/D ${kd} / 命中 ${accuracy}%</div>
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
      });
      list.appendChild(card);
    }
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
            node.classList.toggle(
              'selected',
              (node as HTMLElement).dataset.attach === (choice.id ?? 'none'),
            );
          });
        });
        if ((this.attachmentBySlot[slot] ?? 'none') === (choice.id ?? 'none')) {
          btn.classList.add('selected');
        }
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
      });
      list.appendChild(card);
    }
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
      });
      list.appendChild(card);
    }
    this.markSelected(list, 'difficulty', this.selection.difficulty);
  }

  private markSelected(container: HTMLElement, key: string, value: string): void {
    container.querySelectorAll<HTMLElement>('[data-' + key + ']').forEach((node) => {
      node.classList.toggle('selected', node.dataset[key] === value);
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
      this.checkbox('ADSをトグルにする', this.settings.adsToggle, (v) => {
        this.settings.adsToggle = v;
      }),
    );
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
