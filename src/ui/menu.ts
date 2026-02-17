import type { Settings } from '../core/settings';
import { saveSettings } from '../core/settings';
import type { Difficulty } from '../game/bot';
import type { ScoreRow } from '../game/match';
import { STAGES } from '../game/stages';
import { PRIMARY_IDS, WEAPON_DEFS } from '../game/weapons';

export interface MenuSelection {
  stageId: string;
  primaryId: string;
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
};

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
  ['ジャンプ', 'Space'],
  ['しゃがみ', 'C / 左Ctrl'],
  ['スプリント', '左Shift'],
  ['リロード', 'R'],
  ['武器切替', '1 / 2 / ホイール'],
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
    primaryId: 'kaede-ar',
    difficulty: 'normal',
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.showMain();
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
        </header>
        <div class="menu-columns">
          <section class="menu-section">
            <h2>ステージ</h2>
            <div class="stage-grid" data-id="stages"></div>
          </section>
          <div class="menu-side">
            <section class="menu-section">
              <h2>メイン武器</h2>
              <div class="weapon-list" data-id="weapons"></div>
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
    this.renderStages();
    this.renderWeapons();
    this.renderDifficulties();
    this.renderSettings(this.query('settings'));
    this.renderControls();
    this.query('start').addEventListener('click', () => this.callbacks.onStart(this.selection));
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

  showResult(result: { rows: ScoreRow[]; won: boolean; accuracy: number; headshots: number }): void {
    this.root.hidden = false;
    const mvp = result.rows[0];
    const rowsHtml = result.rows
      .map(
        (row) => `
        <tr class="${row.isPlayer ? 'score-you' : ''}">
          <td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>
        </tr>`,
      )
      .join('');
    this.root.innerHTML = `
      <div class="menu-screen menu-result">
        <div class="result-panel">
          <h1>${result.won ? '勝利' : '敗北'}</h1>
          <p class="result-mvp">MVP: ${mvp ? mvp.name : '-'}</p>
          <p class="result-stats">命中率 ${(result.accuracy * 100).toFixed(1)}% / ヘッドショット ${result.headshots}</p>
          <table class="result-table">
            <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
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
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id];
      if (!def) continue;
      const bars = WEAPON_BARS[id] ?? { power: 5, rate: 5, control: 5 };
      const card = document.createElement('button');
      card.className = 'weapon-card';
      card.dataset.weapon = id;
      card.innerHTML = `
        <span class="weapon-name">${def.name}</span>
        <span class="weapon-mode">${def.mode === 'auto' ? 'フルオート' : '単発'} / 装弾数 ${def.magazineSize}</span>
        ${this.bar('火力', bars.power)}
        ${this.bar('連射', bars.rate)}
        ${this.bar('制御', bars.control)}
      `;
      card.addEventListener('click', () => {
        this.selection.primaryId = id;
        this.markSelected(list, 'weapon', id);
      });
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
