// W-ENZA2 コーディネータ(F1所有)。
// 旧Menuの公開契約を完全ミラーし、main.tsの ?ui2 分岐から1行スワップで使われる。
// 全画面は1920×1080固定ステージに構築され、ここが viewport へ scale-to-fit する。
// v1の教訓: 見た目より先に「遷移・フォーカス・出撃」が常に実動すること。
import './ui2.css';
import type { Input, UiNav } from '../core/input';
import type { Settings } from '../core/settings';
import { ATTACHMENT_DEFS } from '../game/attachments';
import type { MissionDef } from '../game/campaign';
import { GRENADE_KINDS } from '../game/grenades';
import type { MatchResult } from '../game/match';
import { MODE_IDS } from '../game/modes';
import type { CampaignProgress, MatchProgress, Profile } from '../game/progression';
import { STAGES } from '../game/stages';
import { WEAPON_DEFS } from '../game/weapons';
import { WeaponPreview } from '../render/weapon-preview';
import type { MenuCallbacks, MenuSelection } from '../ui/menu';
import type { SpaceBg } from '../ui/menu-bg';
import { mountArmory } from './screens/armory';
import { mountBriefing, mountCampaign, mountMissionResult } from './screens/campaign';
import { mountDeploy } from './screens/deploy';
import { mountHub } from './screens/hub';
import { mountOptions, mountPause } from './screens/options';
import { mountResult } from './screens/result';
import { mountTitle } from './screens/title';
import type { MenuApi, Screen2Handle, Screen2Id, ScreenMount, ScreenOpenOpts, Ui2Host } from './types';

const LOADOUT_KEY = 'hibana.loadout.v1'; // 旧UIと同一キー=兵装選択の完全互換

// ポーズだけは試合画面の上に薄く載る(他は不透明フルスクリーン)
const OVERLAY_SCREENS: ReadonlySet<Screen2Id> = new Set<Screen2Id>(['pause']);

// R56 焔座フルードステージ: レスポンシブ引き伸ばし(黒帯なし)へ移行済みの画面のみ。
// 波ごとにここへ追加していく(今回はhubのみ)。未追加の画面は従来のscale-to-fitのまま
// 完全維持される(この波での回帰ゼロを担保)。
const FLUID_SCREENS: ReadonlySet<Screen2Id> = new Set<Screen2Id>(['hub']);

// R55 W-C4[5]: onKeyのEsc除外はテキスト打鍵系のinput型のみを対象にする
// (checkbox/radio/range/buttonはEsc=戻るを妨げない)。ui2に現存するのはcheckbox/range/buttonのみだが、
// 将来text系inputが増えても安全なように型ベースで判定する。
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'number',
  'email',
  'password',
  'tel',
  'url',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

function defaultSelection(): MenuSelection {
  return {
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
}

export class Menu2 implements MenuApi {
  private readonly letterbox: HTMLElement;
  private readonly stage: HTMLElement;
  private active: { id: Screen2Id; handle: Screen2Handle } | null = null;
  private titleDismissed = false;
  private readonly selection: MenuSelection = defaultSelection();
  private weaponPreview: WeaponPreview | null = null;
  private readonly host: Ui2Host & { openScreen: (id: string, opts?: { section?: string }) => void };
  private readonly onResize = (): void => this.applyScale();
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (this.root.hidden) return;
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const t = ev.target;
    // R55 W-C6[16]: selectはポップアップ展開中、ブラウザがEscをネイティブに消費して
    // ドロップダウンを閉じるだけで、このwindow keydownまでは伝播してこない(素通しは不要)。
    // 一方、ポップアップが閉じている状態でselectにフォーカスが残っているだけのEscは
    // ここまで届くため、無条件除外すると「戻る」が効かなくなっていた。よって選択要素自体は
    // 除外せず、テキスト打鍵系のinput型(text/number/search等)のみ除外する。
    // checkbox/radio/range/button型はEsc=戻るを通す(R55 W-C4[5]の判定と同型)。
    if (t instanceof HTMLInputElement && TEXT_ENTRY_INPUT_TYPES.has(t.type)) return;
    // タイトル画面は自前でEscを処理する(クレジットモーダル)
    if (this.active?.id === 'title') return;
    ev.preventDefault();
    this.backAction();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly profile: Profile,
    private readonly callbacks: MenuCallbacks,
    private readonly input: Input,
  ) {
    this.root.innerHTML = '';
    this.letterbox = document.createElement('div');
    this.letterbox.className = 'u2-letterbox';
    this.stage = document.createElement('div');
    this.stage.className = 'u2-stage';
    this.letterbox.appendChild(this.stage);
    this.root.appendChild(this.letterbox);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.applyScale();
    this.loadLoadout();

    this.host = {
      settings: this.settings,
      profile: this.profile,
      callbacks: this.callbacks,
      input: this.input,
      buildLabel: BUILD_LABEL_SAFE,
      reducedMotion: () =>
        this.settings.reduceMotion ||
        (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
      open: (id, opts) => this.open(id, opts),
      openScreen: (id, opts) => this.open(id as Screen2Id, opts as ScreenOpenOpts),
      back: () => this.open('hub'),
      loadout: this.selection,
      saveLoadout: () => this.saveLoadout(),
      mountWeaponPreview: () => this.mountWeaponPreview(),
      teardownWeaponPreview: () => this.teardownPreview(),
      previewWeaponId: (id) => {
        const def = WEAPON_DEFS[id];
        if (def) this.weaponPreview?.setWeapon(def);
      },
      suspendWeaponPreview: () => this.weaponPreview?.suspend(),
      resumeWeaponPreview: () => this.weaponPreview?.resume(),
    };
    this.showMain();
  }

  // ── 公開API(旧Menuミラー) ─────────────────────────────
  showMain(): void {
    this.open(this.titleDismissed ? 'hub' : 'title');
  }

  showPause(): void {
    this.open('pause');
  }

  showResult(result: MatchResult, progress: MatchProgress): void {
    this.open('result', { result, progress });
  }

  showMissionResult(result: MatchResult, progress: CampaignProgress): void {
    this.open('mission-result', { result, campaignProgress: progress });
  }

  showBriefing(mission: MissionDef): void {
    this.open('briefing', { mission });
  }

  hide(): void {
    this.disposeActive();
    this.teardownPreview();
    this.root.hidden = true;
  }

  attachBg(bg: SpaceBg): void {
    // ENZA2は各画面がCSS/SVGの自前情景を持つ — WebGL宇宙は止めてGPUを空ける
    (bg as unknown as { stop?: () => void }).stop?.();
  }

  handleGamepad(nav: UiNav): void {
    if (this.root.hidden) return;
    if (this.active?.handle.onGamepad?.(nav)) return;
    const list = this.focusables();
    if (list.length === 0) {
      if (nav.back) this.backAction();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    if (idx < 0) {
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm) {
        list[0]?.focus({ preventScroll: true });
        list[0]?.scrollIntoView({ block: 'nearest' });
      }
      if (nav.back) this.backAction();
      return;
    }
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
      if (cur instanceof HTMLInputElement && cur.type === 'checkbox') cur.click();
      else cur?.click();
      return;
    }
    if (nav.back) this.backAction();
  }

  // ── 遷移 ─────────────────────────────────────────────
  open(id: Screen2Id, opts?: ScreenOpenOpts): void {
    this.disposeActive();
    this.teardownPreview();
    this.root.hidden = false;
    this.letterbox.classList.toggle('u2-letterbox--overlay', OVERLAY_SCREENS.has(id));
    this.stage.dataset.screen = id;
    this.stage.setAttribute('data-id', `scr-${id}`);
    this.stage.innerHTML = '';
    this.stage.classList.toggle('u2-stage--fluid', FLUID_SCREENS.has(id));
    this.applyScale();
    let handle: Screen2Handle;
    if (id === 'title') {
      handle = mountTitle(this.host, this.stage, () => {
        this.titleDismissed = true;
        this.open('hub');
      });
    } else {
      const mount = SCREENS[id];
      handle = mount(this.host, this.stage, opts);
    }
    this.active = { id, handle };
    requestAnimationFrame(() => {
      if (this.active?.id !== id) return;
      // W-C[11][15]: 画面が既にフォーカスを自分の意図した要素へ置いていたら尊重する
      // (コーディネータの汎用再フォーカスが、武器行/CTA等の初期フォーカスを戻るボタンへ
      //  奪ってしまう不整合の根治)。宣言的な [data-autofocus] を最優先し、次いで既に
      //  ステージ内へ入っているフォーカス、最後に従来の focusables()[0]。
      const declared = this.stage.querySelector<HTMLElement>('[data-autofocus]');
      if (declared && declared.offsetParent !== null) {
        declared.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && this.stage.contains(active)) return;
      this.focusables()[0]?.focus({ preventScroll: true });
    });
  }

  private backAction(): void {
    // 画面が明示する「戻る」相当を優先(旧gamepadBackのid契約を継承)
    for (const did of ['resume', 'back-to-hub', 'brief-back', 'to-campaign', 'menu', 'quit']) {
      const btn = this.stage.querySelector<HTMLElement>(`[data-id="${did}"]`);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return;
      }
    }
    if (this.active && this.active.id !== 'hub' && this.active.id !== 'title') this.open('hub');
  }

  private disposeActive(): void {
    this.active?.handle.dispose();
    this.active = null;
  }

  private applyScale(): void {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    // --u2sは画面を問わず常時更新する: フルード画面(u2-stage--fluid)の各グループは
    // これを個別にtransform:scaleして端アンカー引き伸ばしを行う。
    this.stage.style.setProperty('--u2s', String(s));
    if (this.stage.classList.contains('u2-stage--fluid')) {
      // フルード画面: stage自体のtransformは各グループ側の責務(黒帯なし・端アンカー)
      this.stage.style.transform = '';
    } else {
      // レガシー画面: 従来通りstage全体をscale-to-fit(黒帯あり・完全現状維持)
      this.stage.style.transform = `scale(${s})`;
    }
  }

  private focusables(): HTMLElement[] {
    // W-C3[8]: 装飾用の◀▶ステッパー等はtabindex="-1"で自前フォーカス管理するため、
    // 汎用ゲームパッド走査(▲▼/Ⓐ)から除外する(視覚ハイライトとのズレ防止)。
    return Array.from(
      this.stage.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), select, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
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

  // ── 兵装選択の永続化(旧UIとlocalStorage完全互換) ──────
  private loadLoadout(): void {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MenuSelection>;
      if (saved.stageId && STAGES.some((s) => s.id === saved.stageId)) this.selection.stageId = saved.stageId;
      if (saved.primaryId && WEAPON_DEFS[saved.primaryId]) this.selection.primaryId = saved.primaryId;
      if (saved.secondaryId && WEAPON_DEFS[saved.secondaryId]) this.selection.secondaryId = saved.secondaryId;
      if (saved.mode && MODE_IDS.includes(saved.mode)) this.selection.mode = saved.mode;
      if (saved.grenade && GRENADE_KINDS.includes(saved.grenade)) this.selection.grenade = saved.grenade;
      if (saved.difficulty && ['easy', 'normal', 'hard'].includes(saved.difficulty)) {
        this.selection.difficulty = saved.difficulty;
      }
      if (saved.missionDifficulty && ['easy', 'normal', 'hard'].includes(saved.missionDifficulty)) {
        this.selection.missionDifficulty = saved.missionDifficulty;
      }
      if (typeof saved.zombieStartRound === 'number') {
        this.selection.zombieStartRound = Math.max(1, Math.min(999, Math.round(saved.zombieStartRound)));
      }
      if (typeof saved.hellMode === 'boolean') this.selection.hellMode = saved.hellMode;
      if (typeof saved.allGiantMode === 'boolean') this.selection.allGiantMode = saved.allGiantMode;
      if (typeof saved.rogueRun === 'boolean') this.selection.rogueRun = saved.rogueRun;
      const att = (saved.attachments ?? []).filter((id) => ATTACHMENT_DEFS[id]);
      if (att.length > 0) this.selection.attachments = att;
    } catch {
      // 壊れた保存値は初期値で開く
    }
  }

  private saveLoadout(): void {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.selection));
  }

  // ── ARMORY 3Dプレビュー(旧menu.tsのmountWeaponPreview移植) ──
  private mountWeaponPreview(): void {
    const canvas = this.stage.querySelector<HTMLCanvasElement>('[data-id="weapon-canvas"]');
    if (!canvas) return;
    if (!this.weaponPreview) {
      try {
        this.weaponPreview = new WeaponPreview(canvas);
        this.weaponPreview.setReduceMotion(this.host.reducedMotion());
      } catch {
        this.weaponPreview = null; // WebGL不可の環境ではプレビュー無し
        return;
      }
    }
    this.weaponPreview.start();
    this.weaponPreview.resume();
    this.weaponPreview.resize();
    const def = WEAPON_DEFS[this.selection.primaryId];
    if (def) this.weaponPreview.setWeapon(def);
  }

  private teardownPreview(): void {
    if (this.weaponPreview) {
      this.weaponPreview.dispose();
      this.weaponPreview = null;
    }
  }
}

// version.tsのBUILD_LABELを間接参照(テストでのimport順序に依存しないよう定数化)
import { BUILD_LABEL } from '../version';
const BUILD_LABEL_SAFE = BUILD_LABEL;

const SCREENS: Record<Exclude<Screen2Id, 'title'>, ScreenMount> = {
  hub: mountHub,
  deploy: mountDeploy,
  armory: mountArmory,
  campaign: mountCampaign,
  options: mountOptions,
  pause: mountPause,
  briefing: mountBriefing,
  result: mountResult,
  'mission-result': mountMissionResult,
};
