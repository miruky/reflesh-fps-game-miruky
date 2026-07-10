// W-ENZA2 F4: 武器庫 ARMORY(mock04 逐語移植+実データ全結線)
// 正典: scratchpad/enza-mock-04.html。様式はarmory.css、ここはDOM構築と実配線のみ。
// ハリボテ禁止: 全ボタンが実機能(選択/装備/カモ/アタッチメント/出撃/戻る)を持つ。
// モックの架空値(編成コスト/口径/固定キル数)は置かず、実データのみ表示する。
import '../armory.css';
import { saveProfile } from '../../core/profile';
import {
  ATTACHMENT_DEFS,
  ATTACHMENT_SLOTS,
  applyAttachments,
  attachmentsForSlot,
  type AttachmentSlot,
} from '../../game/attachments';
import { OPTIC_SPECS, fitsMagnified } from '../../game/optics';
import {
  CAMO_IDS,
  CAMO_TIERS,
  CAMO_VISUALS,
  CAMO_WEAPON_IDS,
  KUNAI_CAMO_IDS,
  REWARD_CAMO_IDS,
  TOKOYAMI_CAMO,
  camoName,
  camoProgress,
  isCamoId,
  isCamoUnlocked,
  isKunaiCamoUnlocked,
  kunaiCamoProgress,
  type CamoId,
} from '../../game/camo';
import { GRENADE_KINDS, GRENADE_SPECS, type GrenadeKind } from '../../game/grenades';
import { isUnlocked, levelFromXp, unlockLevelOf } from '../../game/progression';
import {
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  computeWeaponBars,
  type ViewModelShape,
  type WeaponClass,
  type WeaponDef,
} from '../../game/weapons';
import type { Screen2Handle, Ui2Host, UiNav } from '../types';
// 出撃発火体はhub/deployと同一手順(台帳§3): carriedPerk解決→onStart。
// ヘルパは旧UIの公開export(読み取りのみ)。旧UI退役時はui2側の共有launch経路へ移設する(F1申し送り)
import { readLastZombiePerk, resolveCarriedPerk } from '../../ui/menu';

// ── 武器シルエットSVG(src/ui/menu.ts から複製。旧UI退役時に一本化する) ──────
const silCache = new Map<string, string>();

const CLASS_SHAPE: Record<WeaponClass, ViewModelShape> = {
  ar: 'rifle',
  smg: 'smg',
  marksman: 'dmr',
  sniper: 'sniper-bolt',
  shotgun: 'shotgun-pump',
  br: 'rifle',
  lmg: 'lmg-belt',
  pistol: 'pistol',
  launcher: 'launcher',
  exotic: 'rifle',
};

interface SilSpec {
  arch:
    | 'ar'
    | 'bullpup'
    | 'smg'
    | 'dmr'
    | 'sniper'
    | 'shotgun'
    | 'lmg'
    | 'pistol'
    | 'revolver'
    | 'fists';
  barrel?: number;
  mag?: 'curved' | 'straight' | 'box' | 'drum' | 'tube' | 'twin' | 'none';
  optic?: 'iron' | 'red' | 'scope' | 'long';
  stock?: 'full' | 'skel' | 'none' | 'bull';
}

const SHAPE_SIL: Record<ViewModelShape, SilSpec> = {
  rifle: { arch: 'ar', barrel: 118, mag: 'curved', optic: 'red', stock: 'full' },
  carbine: { arch: 'ar', barrel: 106, mag: 'curved', optic: 'red', stock: 'skel' },
  bullpup: { arch: 'bullpup', barrel: 116, mag: 'curved', optic: 'red', stock: 'full' },
  smg: { arch: 'smg', barrel: 98, mag: 'straight', optic: 'red', stock: 'skel' },
  pdw: { arch: 'smg', barrel: 92, mag: 'straight', optic: 'iron', stock: 'skel' },
  'machine-pistol': { arch: 'smg', barrel: 82, mag: 'straight', optic: 'iron', stock: 'none' },
  dmr: { arch: 'dmr', barrel: 120, mag: 'straight', optic: 'scope', stock: 'full' },
  'sniper-bolt': { arch: 'sniper', barrel: 124, mag: 'straight', optic: 'long', stock: 'full' },
  'dsr-bp': { arch: 'sniper', barrel: 126, mag: 'box', optic: 'long', stock: 'bull' },
  fists: { arch: 'fists' },
  'shotgun-pump': { arch: 'shotgun', barrel: 116, mag: 'tube', optic: 'iron', stock: 'full' },
  'shotgun-auto': { arch: 'shotgun', barrel: 112, mag: 'box', optic: 'iron', stock: 'full' },
  'shotgun-double': { arch: 'shotgun', barrel: 120, mag: 'twin', optic: 'iron', stock: 'full' },
  'lmg-belt': { arch: 'lmg', barrel: 122, mag: 'box', optic: 'red', stock: 'full' },
  'lmg-drum': { arch: 'lmg', barrel: 118, mag: 'drum', optic: 'red', stock: 'full' },
  pistol: { arch: 'pistol' },
  revolver: { arch: 'revolver' },
  launcher: { arch: 'lmg', barrel: 120, mag: 'tube', optic: 'iron', stock: 'none' },
  'sniper-semi': { arch: 'sniper', barrel: 122, mag: 'straight', optic: 'scope', stock: 'full' },
  antimateriel: { arch: 'sniper', barrel: 126, mag: 'straight', optic: 'long', stock: 'skel' },
  'shuriken-hand': { arch: 'fists' },
  'bow-japanese': { arch: 'sniper', barrel: 120, mag: 'none', optic: 'iron', stock: 'none' },
  'war-fan': { arch: 'fists' },
  musket: { arch: 'sniper', barrel: 128, mag: 'none', optic: 'iron', stock: 'full' },
  'lightning-staff': { arch: 'smg', barrel: 122, mag: 'none', optic: 'iron', stock: 'none' },
  minigun: { arch: 'lmg', barrel: 124, mag: 'drum', optic: 'iron', stock: 'none' },
};

function tracerHex(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}
const rc = (x: number, y: number, w: number, h: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const pg = (pts: string): string => `<polygon points="${pts}"/>`;
const ci = (x: number, y: number, r: number): string => `<circle cx="${x}" cy="${y}" r="${r}"/>`;

function silOptic(kind: string | undefined, barrel: number, b: string[], a: string[]): void {
  if (kind === 'red') {
    b.push(rc(44, 10, 15, 6));
    a.push(`<rect x="46" y="11" width="4.5" height="4" fill="__T__"/>`);
  } else if (kind === 'scope') {
    b.push(rc(40, 9, 28, 6), rc(44, 15, 2, 2), rc(60, 15, 2, 2));
    a.push(`<rect x="64" y="9.5" width="3.4" height="5" fill="__T__"/>`);
  } else if (kind === 'long') {
    b.push(rc(34, 7, 42, 6), pg('76,7 82,9 82,11 76,13'), rc(44, 13, 2, 3), rc(64, 13, 2, 3));
    a.push(`<rect x="79.5" y="8.6" width="3" height="4.8" fill="__T__"/>`);
  } else {
    b.push(rc(barrel - 14, 13.5, 2, 4), rc(41, 13, 2, 4));
  }
}

function silMag(kind: string | undefined, b: string[]): void {
  if (kind === 'curved') b.push(pg('53,27 64,27 68,43 57,43'));
  else if (kind === 'straight') b.push(pg('53,27 63,27 64,42 55,42'));
  else if (kind === 'box') b.push(rc(52, 27, 13, 15));
  else if (kind === 'drum') b.push(rc(54, 27, 8, 4), ci(58, 35, 8.5));
}

function silInner(spec: SilSpec, tracer: string): string {
  const b: string[] = [];
  const a: string[] = [];
  const barrel = spec.barrel ?? 116;
  if (spec.arch === 'fists') {
    b.push(
      pg('46,16 70,16 76,20 76,32 70,36 46,36 42,32 42,20'),
      rc(50, 12, 4, 6),
      rc(57, 11, 4, 7),
      rc(64, 12, 4, 6),
      pg('42,24 36,28 40,34 46,32'),
    );
    a.push(`<rect x="70" y="22" width="6" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'pistol') {
    b.push(
      rc(44, 17, 40, 8),
      pg('48,25 62,25 58,42 44,41'),
      rc(60, 15, 3, 2),
      rc(46, 15, 3, 2),
      rc(60, 25, 10, 3),
    );
    a.push(`<rect x="82" y="18.5" width="4" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'revolver') {
    b.push(
      rc(48, 17, 22, 9),
      rc(70, 19, 22, 3),
      ci(58, 24, 7.2),
      pg('48,26 60,26 55,42 45,40'),
      pg('46,15 52,14 52,18 46,18'),
    );
    a.push(
      `<rect x="89" y="19" width="3.5" height="3.4" fill="${tracer}"/>`,
      `<circle cx="58" cy="24" r="2.4" fill="${tracer}"/>`,
    );
  } else {
    const bull = spec.arch === 'bullpup' || spec.stock === 'bull';
    b.push(bull ? rc(8, 16, 64, 11) : rc(34, 16, 36, 11));
    b.push(rc(64, 17, 10, 9));
    b.push(rc(72, 18.5, Math.max(4, barrel - 82), 6.5));
    b.push(rc(74, 20.2, barrel - 74, 2.6));
    if (!bull) {
      if (spec.stock === 'full') b.push(pg('8,17 22,15 34,16 34,27 8,28'));
      else if (spec.stock === 'skel')
        b.push(pg('10,16 34,16 34,18.5 16,19 16,24 34,24 34,27 10,27'));
    }
    b.push(pg('42,27 51,27 48,41 40,41'), rc(50, 27.5, 11, 3));
    if (spec.mag === 'tube') {
      b.push(rc(74, 24.4, barrel - 82, 2.6));
      b.push(rc(78, 22.6, 12, 2.2));
    } else if (spec.mag === 'twin') {
      b.push(rc(74, 24.2, barrel - 74, 2.6));
    } else if (bull) {
      b.push(pg('20,27 31,27 33,42 22,42'));
    } else {
      silMag(spec.mag, b);
    }
    silOptic(spec.optic, barrel, b, a);
    a.push(
      `<rect x="${barrel - 5}" y="19.4" width="5" height="3.4" fill="${tracer}"/>`,
      `<polygon points="${barrel},20.4 ${barrel + 4},21.6 ${barrel},22.8" fill="${tracer}" opacity="0.75"/>`,
    );
  }
  const body = b.join('');
  const accent = a.join('').replace(/__T__/g, tracer);
  return `<g fill="currentColor">${body}</g><g>${accent}</g>`;
}

function weaponSilSVG(shape: ViewModelShape, tracerColor: number): string {
  const key = `${shape}|${tracerColor}`;
  const hit = silCache.get(key);
  if (hit !== undefined) return hit;
  const spec = SHAPE_SIL[shape] ?? SHAPE_SIL.rifle;
  const svg = `<svg viewBox="0 0 128 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${silInner(spec, tracerHex(tracerColor))}</svg>`;
  silCache.set(key, svg);
  return svg;
}

// ── 表示語彙(モック04のタブ語彙。実クラスへの日本語銃器名の対応) ──────────
const TAB_LABELS: Record<WeaponClass, string> = {
  ar: '突撃銃',
  smg: '短機関銃',
  br: '戦闘小銃',
  marksman: '選抜射手銃',
  sniper: '狙撃銃',
  shotgun: '散弾銃',
  lmg: '軽機関銃',
  pistol: '拳銃',
  launcher: '発射器',
  exotic: '特殊兵装',
};
const CLASS_ORDER: readonly WeaponClass[] = [
  'ar',
  'smg',
  'br',
  'marksman',
  'sniper',
  'shotgun',
  'lmg',
  'launcher',
  'exotic',
];

const GRENADE_DESCS: Record<GrenadeKind, string> = {
  frag: '長押しでクッキング。爆発範囲ダメージ',
  smoke: '視線を遮る煙幕を張る',
  flash: '視界を白く焼く。正面で食らうと長い',
  incendiary: '着弾点に燃え続ける火災を残す',
};

type ArmoryView = 'primary' | 'secondary' | 'grenade';

const BAR_AXES: ReadonlyArray<[keyof ReturnType<typeof computeWeaponBars>, string]> = [
  ['power', '威力'],
  ['rate', '連射'],
  ['control', '制御'],
  ['range', '射程'],
  ['mobility', '機動'],
  ['handling', '取回'],
];

function modeLabel(def: WeaponDef): string {
  return def.mode === 'auto'
    ? 'フルオート'
    : def.mode === 'burst'
      ? `バースト${def.burstCount}`
      : '単発';
}

function derived(def: WeaponDef): { dps: number; shots: number; ttk: number; rpm: number } {
  const perShot = def.damage * def.pellets;
  const rps = def.rpm / 60;
  const shots = Math.max(1, Math.ceil(100 / Math.max(1, perShot)));
  return {
    dps: Math.round(perShot * rps),
    shots,
    ttk: Math.round(((shots - 1) * 60000) / Math.max(1, def.rpm)),
    rpm: def.rpm,
  };
}

// 実スペックのみから導出する説明文(架空の口径/逸話は書かない)
function descFor(def: WeaponDef): string {
  const d = derived(def);
  const cls = TAB_LABELS[def.class];
  const reach =
    def.range >= 200
      ? '長距離'
      : def.range >= 60
        ? '中距離'
        : def.range >= 25
          ? '近中距離'
          : '近距離';
  return (
    `${cls}「${def.name}」。${modeLabel(def)}・実効${d.rpm}rpm、${reach}戦向け。` +
    `胴撃ち確殺${d.shots}発(TTK ${d.ttk}ms)。装弾${def.magazineSize}発、予備弾は無限。`
  );
}

export function mountArmory(host: Ui2Host, root: HTMLElement): Screen2Handle {
  const profile = host.profile;
  const loadout = host.loadout;
  const level = (): number => levelFromXp(profile.xp).level;

  // 保存選択がロック中なら既定へ(旧renderWeaponsと同じフォールバック)
  if (!isUnlocked('weapon', loadout.primaryId, level())) loadout.primaryId = 'kaede-ar';
  if (!isUnlocked('weapon', loadout.secondaryId, level())) loadout.secondaryId = 'suzume';

  let view: ArmoryView = 'primary';
  let cls: WeaponClass = WEAPON_DEFS[loadout.primaryId]?.class ?? 'ar';
  let openPop: HTMLElement | null = null;

  root.innerHTML = `
    <div class="u2-armory" data-id="scr-armory">
      <div class="u2a-stage" data-view="primary">
        <div class="u2a-bg"></div>
        <div class="u2a-scan"></div>
        <div class="u2a-header">
          <div class="u2a-head-left">
            <button type="button" class="u2a-back" data-id="back-to-hub" title="メニューへ戻る" aria-label="メニューへ戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="#C4C9CF" stroke-width="1.6"></circle><rect x="11.2" y="1.5" width="1.6" height="6" fill="#C4C9CF"></rect><rect x="11.2" y="16.5" width="1.6" height="6" fill="#C4C9CF"></rect><rect x="1.5" y="11.2" width="6" height="1.6" fill="#C4C9CF"></rect><rect x="16.5" y="11.2" width="6" height="1.6" fill="#C4C9CF"></rect><circle cx="12" cy="12" r="2" fill="#FF6B2B"></circle></svg>
            </button>
            <div class="u2a-headings">
              <span class="u2a-kicker">クラス作成\u3000CUSTOM CLASS</span>
              <div class="u2a-titles" role="tablist" aria-label="装備の種別">
                <button type="button" class="u2a-title on" data-view-btn="primary" role="tab" aria-selected="true">メイン武器</button>
                <button type="button" class="u2a-title" data-view-btn="secondary" role="tab" aria-selected="false">サブ武器</button>
                <button type="button" class="u2a-title" data-view-btn="grenade" role="tab" aria-selected="false">投擲物</button>
              </div>
            </div>
          </div>
        </div>
        <div class="u2a-tabs" data-id="tabs" role="tablist" aria-label="武器カテゴリ"></div>
        <div class="u2a-list">
          <div class="u2a-rows" data-id="weapon-list"></div>
          <div class="u2a-exnote" data-id="exnote" hidden>
            <span class="u2a-dia"></span><span></span>
          </div>
        </div>
        <div class="u2a-detail">
          <div class="u2a-nameplate-row">
            <span class="u2a-nameplate" data-id="wname"></span>
            <span class="u2a-spec" data-id="wspec"></span>
            <span class="u2a-chips" data-id="wchips"></span>
          </div>
          <p class="u2a-desc" data-id="wdesc"></p>
          <div class="u2a-render">
            <div class="u2a-glow"></div>
            <canvas data-id="weapon-canvas"></canvas>
            <div class="u2a-floorshadow"></div>
            <span class="u2a-hint">3Dプレビュー · ドラッグで回転 / クリックで空撃ち</span>
          </div>
          <div class="u2a-stats" data-id="stats"></div>
          <div class="u2a-camo" data-id="camo"></div>
          <div class="u2a-slots" data-id="slots"></div>
        </div>
        <div class="u2a-band">
          <span class="u2a-band-status" data-id="band"></span>
          <div class="u2a-band-hints"><span>▲▼ 選択</span><span>LB / RB カテゴリ</span><span><b>Ⓑ</b> 戻る</span></div>
        </div>
      </div>
    </div>`;

  const stage = root.querySelector<HTMLElement>('.u2a-stage');
  const outer = root.querySelector<HTMLElement>('.u2-armory');
  const q = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`[data-id="${id}"]`);
    if (!el) throw new Error(`u2-armory: missing [data-id="${id}"]`);
    return el;
  };

  // ── 1920×1080ステージの等比フィット(zoom優先、非対応はtransform) ──────
  const fit = (): void => {
    if (!stage || !outer) return;
    const s = Math.min(outer.clientWidth / 1920, outer.clientHeight / 1080) || 1;
    if (typeof CSS !== 'undefined' && CSS.supports?.('zoom', '2')) {
      stage.style.setProperty('zoom', String(s));
      stage.style.transform = '';
    } else {
      stage.style.transform = `scale(${s})`;
      stage.style.transformOrigin = '50% 50%';
    }
  };
  fit();
  const ro = new ResizeObserver(fit);
  if (outer) ro.observe(outer);

  // ── アタッチメントのスロット表現(loadout.attachments⇔slotマップ) ─────
  const slotMap = (): Record<AttachmentSlot, string | null> => {
    const m: Record<AttachmentSlot, string | null> = {
      sight: null,
      muzzle: null,
      grip: null,
      mag: null,
    };
    for (const id of loadout.attachments) {
      const d = ATTACHMENT_DEFS[id];
      if (d) m[d.slot] = id;
    }
    return m;
  };
  const writeSlots = (m: Record<AttachmentSlot, string | null>): void => {
    loadout.attachments = (Object.values(m) as Array<string | null>).filter(
      (x): x is string => x !== null,
    );
    host.saveLoadout();
  };
  const opticFits = (id: string, def: WeaponDef): boolean => {
    const spec = OPTIC_SPECS[id];
    if (spec?.fits) return spec.fits(def);
    if (id === 'telescopic') return fitsMagnified(def);
    return true;
  };
  // 旧renderAttachmentsと同じ適合ゲート: 不適合光学/ロック品を静かに外す
  const ensureAttachmentGates = (): void => {
    const base = WEAPON_DEFS[loadout.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    const m = slotMap();
    for (const { slot } of ATTACHMENT_SLOTS) {
      const sel = m[slot];
      if (!sel) continue;
      if (!isUnlocked('attachment', sel, level()) || (slot === 'sight' && !opticFits(sel, base))) {
        m[slot] = null;
      }
    }
    writeSlots(m);
  };
  const currentPrimary = (): WeaponDef => {
    const base = WEAPON_DEFS[loadout.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    return applyAttachments(base, loadout.attachments);
  };
  const detailDef = (): WeaponDef => {
    if (view === 'secondary')
      return WEAPON_DEFS[loadout.secondaryId] ?? WEAPON_DEFS['suzume'] ?? currentPrimary();
    return currentPrimary();
  };

  const closePop = (): void => {
    openPop?.remove();
    openPop = null;
  };
  const onDocDown = (e: PointerEvent): void => {
    if (openPop && e.target instanceof Node && !openPop.parentElement?.contains(e.target))
      closePop();
  };
  document.addEventListener('pointerdown', onDocDown, true);
  // A4: ポップ表示中のEscapeはポップだけ閉じる(menu2側のグローバルEscapeでhubへ全画面バックさせない)
  const onDocKeydown = (e: KeyboardEvent): void => {
    if (openPop && e.key === 'Escape') {
      closePop();
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onDocKeydown, true);

  // ── カモ実績ヘルパ(実データ) ────────────────────────────────────────
  const camoUnlockedCount = (weaponId: string): number =>
    weaponId === 'fists'
      ? KUNAI_CAMO_IDS.filter((id) => isKunaiCamoUnlocked(id, profile.weaponStats['fists'])).length
      : CAMO_IDS.filter((id) =>
          isCamoUnlocked(id, weaponId, profile.weaponStats, profile.unlockedRewardCamos),
        ).length;
  const camoTotal = (weaponId: string): number =>
    weaponId === 'fists' ? KUNAI_CAMO_IDS.length : CAMO_IDS.length;
  const markFor = (weaponId: string): string | null => {
    if (weaponId === 'fists') {
      return isKunaiCamoUnlocked(TOKOYAMI_CAMO.id, profile.weaponStats['fists'])
        ? 'tokoyami'
        : null;
    }
    if (!CAMO_WEAPON_IDS.includes(weaponId)) return null;
    const has = (id: CamoId): boolean =>
      isCamoUnlocked(id, weaponId, profile.weaponStats, profile.unlockedRewardCamos);
    if (has('diamond')) return 'diamond';
    if (has('gold')) return 'gold';
    return null;
  };

  // ── タブ帯 ──────────────────────────────────────────────────────────
  const renderTabs = (): void => {
    const tabs = q('tabs');
    tabs.innerHTML = '';
    const lb = document.createElement('span');
    lb.className = 'u2a-pad u2a-pad--lb';
    lb.textContent = 'LB';
    tabs.appendChild(lb);
    if (view === 'primary') {
      const classes = CLASS_ORDER.filter((c) =>
        PRIMARY_IDS.some((id) => WEAPON_DEFS[id]?.class === c),
      );
      for (const c of classes) {
        const n = PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === c).length;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `u2a-tab${c === 'exotic' ? ' u2a-tab--exotic' : ''}${c === cls ? ' on' : ''}`;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(c === cls));
        b.innerHTML =
          (c === 'exotic' ? '<span class="u2a-dia"></span>' : '') +
          `${TAB_LABELS[c]}<span class="u2a-tab-n">${n}</span>`;
        b.addEventListener('click', () => {
          // A3: タブ再構築でフォーカスが失われるため、選択前にフォーカスがあれば選択後の.onへ戻す
          const hadFocus = q('tabs').contains(document.activeElement);
          cls = c;
          renderTabs();
          renderList();
          if (hadFocus)
            q('tabs')
              .querySelector<HTMLElement>('.u2a-tab.on')
              ?.focus({ preventScroll: true });
        });
        tabs.appendChild(b);
      }
    } else {
      const b = document.createElement('span');
      b.className = 'u2a-tab on';
      b.textContent = view === 'secondary' ? TAB_LABELS.pistol : '投擲物';
      tabs.appendChild(b);
    }
    const rb = document.createElement('span');
    rb.className = 'u2a-pad u2a-pad--rb';
    rb.textContent = 'RB';
    tabs.appendChild(rb);
  };

  // ── 左リスト ────────────────────────────────────────────────────────
  const weaponRow = (id: string, slot: 'primary' | 'secondary'): HTMLButtonElement => {
    const def = WEAPON_DEFS[id] ?? WEAPON_DEFS['kaede-ar']!;
    const lv = level();
    const unlocked = isUnlocked('weapon', id, lv);
    const selected = slot === 'primary' ? loadout.primaryId === id : loadout.secondaryId === id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `u2a-row${selected ? ' on selected' : ''}${unlocked ? '' : ' locked'}`;
    row.setAttribute('aria-pressed', String(selected));
    row.dataset.wid = id;
    const shape = def.shape ?? CLASS_SHAPE[def.class] ?? 'rifle';
    const kills = profile.weaponStats[id]?.kills ?? 0;
    const mastery =
      id === 'fists'
        ? CAMO_TIERS.filter((t) => isKunaiCamoUnlocked(t.id, profile.weaponStats['fists'])).length
        : CAMO_WEAPON_IDS.includes(id)
          ? CAMO_TIERS.filter((t) =>
              isCamoUnlocked(t.id, id, profile.weaponStats, profile.unlockedRewardCamos),
            ).length
          : null;
    const sub = unlocked
      ? mastery !== null
        ? `錬度${mastery}/${CAMO_TIERS.length} · ${kills.toLocaleString('ja-JP')}キル`
        : `${kills.toLocaleString('ja-JP')}キル`
      : `Lv${unlockLevelOf('weapon', id)}で解放 — あと${Math.max(0, unlockLevelOf('weapon', id) - lv)}`;
    const mark = unlocked ? markFor(id) : null;
    const lock = unlocked
      ? ''
      : '<svg width="15" height="17" viewBox="0 0 16 18" aria-hidden="true"><rect x="1" y="8" width="14" height="9" fill="none" stroke="#6E747C" stroke-width="1.4"></rect><path d="M4 8 V5.5 A4 4 0 0 1 12 5.5 V8" fill="none" stroke="#6E747C" stroke-width="1.4"></path></svg>';
    row.innerHTML =
      `<span class="u2a-sil">${weaponSilSVG(shape, def.tracerColor)}</span>` +
      `<span class="u2a-wtext"><span class="u2a-wname">${def.name}</span><span class="u2a-wsub">${sub}</span></span>` +
      (mark
        ? `<span class="u2a-mark u2a-mark--${mark}" title="${mark === 'gold' ? 'ゴールドカモ取得済' : mark === 'diamond' ? 'ダイヤカモ取得済' : '常闇取得済'}"></span>`
        : lock);
    if (!unlocked) {
      row.disabled = true;
      return row;
    }
    row.addEventListener('click', () => {
      // A3: リスト再構築でフォーカスが失われるため、選択前にフォーカスがあれば選択後の.onへ戻す
      const hadFocus = q('weapon-list').contains(document.activeElement);
      if (slot === 'primary') {
        loadout.primaryId = id;
        ensureAttachmentGates();
      } else {
        loadout.secondaryId = id;
      }
      host.saveLoadout();
      host.previewWeaponId(id);
      renderList();
      renderDetail();
      if (hadFocus)
        q('weapon-list')
          .querySelector<HTMLElement>('.u2a-row.on')
          ?.focus({ preventScroll: true });
    });
    return row;
  };

  const grenadeRow = (kind: GrenadeKind): HTMLButtonElement => {
    const spec = GRENADE_SPECS[kind];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `u2a-row${loadout.grenade === kind ? ' on selected' : ''}`;
    row.setAttribute('aria-pressed', String(loadout.grenade === kind));
    row.dataset.wid = kind;
    row.innerHTML =
      `<span class="u2a-wtext"><span class="u2a-wname">${spec.name} ×${spec.carry}</span>` +
      `<span class="u2a-wsub">${GRENADE_DESCS[kind]}</span></span>`;
    row.addEventListener('click', () => {
      // A3: リスト再構築でフォーカスが失われるため、選択前にフォーカスがあれば選択後の.onへ戻す
      const hadFocus = q('weapon-list').contains(document.activeElement);
      loadout.grenade = kind;
      host.saveLoadout();
      renderList();
      renderDetail();
      if (hadFocus)
        q('weapon-list')
          .querySelector<HTMLElement>('.u2a-row.on')
          ?.focus({ preventScroll: true });
    });
    return row;
  };

  const renderList = (): void => {
    const rows = q('weapon-list');
    rows.innerHTML = '';
    const exnote = q('exnote');
    if (view === 'primary') {
      for (const id of PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls)) {
        rows.appendChild(weaponRow(id, 'primary'));
      }
      const exoticIds = PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === 'exotic');
      const exoticNames = exoticIds.slice(0, 3).map((id) => WEAPON_DEFS[id]?.name ?? id);
      exnote.hidden = cls === 'exotic' || exoticIds.length === 0;
      const label = exnote.querySelector('span:last-child');
      if (label)
        label.textContent = `特殊兵装 EXOTIC ${exoticIds.length}種は専用タブへ\u3000—\u3000${exoticNames.join(' / ')} ほか`;
    } else if (view === 'secondary') {
      exnote.hidden = true;
      for (const id of SECONDARY_IDS) rows.appendChild(weaponRow(id, 'secondary'));
    } else {
      exnote.hidden = true;
      for (const kind of GRENADE_KINDS) rows.appendChild(grenadeRow(kind));
    }
    rows.querySelector<HTMLElement>('.u2a-row.on')?.scrollIntoView({ block: 'nearest' });
  };

  // ── 中央詳細 ────────────────────────────────────────────────────────
  const renderStats = (def: WeaponDef, base: WeaponDef): void => {
    const stats = q('stats');
    const bars = computeWeaponBars(def);
    const baseBars = computeWeaponBars(base);
    let html = '';
    for (const [key, label] of BAR_AXES) {
      const v = Math.max(0, Math.min(10, Math.round(bars[key])));
      const dv = Math.round(bars[key]) - Math.round(baseBars[key]);
      let pips = '';
      for (let i = 0; i < 10; i += 1) pips += `<i${i < v ? ' class="on"' : ''}></i>`;
      const cell =
        dv > 0
          ? `<span class="u2a-diffcell up">▲${dv}</span>`
          : dv < 0
            ? `<span class="u2a-diffcell down">▼${-dv}</span>`
            : `<span class="u2a-diffcell">—</span>`;
      html += `<div class="u2a-statrow"><span class="u2a-statlabel">${label}</span><span class="u2a-pips">${pips}</span>${cell}</div>`;
    }
    const d = derived(def);
    html += `<span class="u2a-ttk">TTK ${d.ttk}ms · DPS ${d.dps} · ${d.rpm}rpm · ${def.magazineSize}発+∞(確殺${d.shots})</span>`;
    stats.innerHTML = html;
  };

  const equip = (def: WeaponDef, camoId: CamoId | null): void => {
    // A3: カモ欄再構築でフォーカスが失われるため、選択前にフォーカスがあれば選択後の.onへ戻す
    const hadFocus = q('camo').contains(document.activeElement);
    if (camoId === null) delete profile.selectedCamos[def.id];
    else profile.selectedCamos[def.id] = camoId;
    saveProfile(profile);
    host.previewWeaponId(view === 'secondary' ? loadout.secondaryId : loadout.primaryId);
    renderDetail();
    if (hadFocus)
      q('camo')
        .querySelector<HTMLElement>('.u2a-swatch.on')
        ?.focus({ preventScroll: true });
  };

  const camoSwatch = (
    def: WeaponDef,
    camoId: CamoId | null,
    equipped: string | null,
  ): HTMLButtonElement => {
    const kunai = def.id === 'fists';
    const btn = document.createElement('button');
    btn.type = 'button';
    if (camoId === null) {
      btn.className = `u2a-swatch u2a-swatch--none${equipped === null ? ' on' : ''}`;
      btn.title = 'なし(標準の質感)';
      btn.addEventListener('click', () => equip(def, null));
      return btn;
    }
    const v = CAMO_VISUALS[camoId];
    const unlocked = kunai
      ? isKunaiCamoUnlocked(camoId, profile.weaponStats['fists'])
      : isCamoUnlocked(camoId, def.id, profile.weaponStats, profile.unlockedRewardCamos);
    btn.className = `u2a-swatch${unlocked && equipped === camoId ? ' on' : ''}${unlocked ? '' : ' locked'}`;
    btn.style.background = `linear-gradient(135deg, ${tracerHex(v.colorA)} 0%, ${tracerHex(v.colorB)} 55%, ${tracerHex(v.colorC)} 100%)`;
    if (unlocked) {
      btn.title = `${camoName(camoId)}${equipped === camoId ? '(装備中)' : ''}`;
      btn.addEventListener('click', () => equip(def, camoId));
    } else {
      const p = kunai
        ? kunaiCamoProgress(camoId, profile.weaponStats['fists'])
        : camoProgress(camoId, def.id, profile.weaponStats);
      btn.disabled = true;
      btn.title = `${camoName(camoId)} — ${p.label}(${p.current}/${p.target})`;
    }
    return btn;
  };

  const renderCamo = (def: WeaponDef): void => {
    const camo = q('camo');
    const supported = def.id === 'fists' || CAMO_WEAPON_IDS.includes(def.id);
    if (!supported) {
      camo.innerHTML = `<span class="u2a-camonote">${view === 'secondary' ? '副武器はカモ非対応' : 'この兵装はカモ非対応'}</span>`;
      return;
    }
    camo.innerHTML = '';
    const equipped = profile.selectedCamos[def.id] ?? null;
    const head = document.createElement('span');
    head.className = 'u2a-camohead';
    head.innerHTML = `カモ ${camoUnlockedCount(def.id)}/${camoTotal(def.id)}\u3000装備中: <b>${
      equipped !== null && isCamoId(equipped) ? camoName(equipped) : 'なし'
    }</b>`;
    camo.appendChild(head);
    const row = document.createElement('div');
    row.className = 'u2a-swatches';
    row.appendChild(camoSwatch(def, null, equipped));
    const ids: CamoId[] =
      def.id === 'fists'
        ? [...CAMO_TIERS.map((t) => t.id), TOKOYAMI_CAMO.id]
        : [...CAMO_TIERS.map((t) => t.id), 'diamond', 'dark-matter', ...REWARD_CAMO_IDS];
    for (const id of ids) row.appendChild(camoSwatch(def, id, equipped));
    camo.appendChild(row);
    // 次の解除(最初の未解放カモの実進捗)
    const nextId = ids.find((id) =>
      def.id === 'fists'
        ? !isKunaiCamoUnlocked(id, profile.weaponStats['fists'])
        : !isCamoUnlocked(id, def.id, profile.weaponStats, profile.unlockedRewardCamos),
    );
    const next = document.createElement('span');
    next.className = 'u2a-camonext';
    if (nextId) {
      const p =
        def.id === 'fists'
          ? kunaiCamoProgress(nextId, profile.weaponStats['fists'])
          : camoProgress(nextId, def.id, profile.weaponStats);
      next.textContent = `次の解除: ${camoName(nextId)} — ${p.label}(${p.current}/${p.target})`;
    } else {
      next.textContent = '全カモ解除済み';
    }
    camo.appendChild(next);
  };

  const renderSlots = (): void => {
    const slots = q('slots');
    slots.innerHTML = '';
    closePop();
    if (view === 'primary') {
      const base = WEAPON_DEFS[loadout.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
      const m = slotMap();
      for (const { slot, label } of ATTACHMENT_SLOTS) {
        const wrap = document.createElement('div');
        wrap.className = 'u2a-slotwrap';
        wrap.dataset.slot = slot; // A3: 選択後のフォーカス復元先を特定するための目印
        const sel = m[slot];
        const selDef = sel ? ATTACHMENT_DEFS[sel] : undefined;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `u2a-slot${selDef ? '' : ' empty'}`;
        btn.innerHTML = `<span class="u2a-slotkicker">${label}</span><span class="u2a-slotname">${selDef ? selDef.name : 'なし'}</span>`;
        btn.addEventListener('click', () => {
          if (openPop && openPop.parentElement === wrap) {
            closePop();
            return;
          }
          closePop();
          const pop = document.createElement('div');
          pop.className = 'u2a-pop';
          const lv = level();
          const choices: Array<{ id: string | null; name: string; sub: string; locked: boolean }> =
            [
              { id: null, name: 'なし', sub: '素の取り回し', locked: false },
              ...attachmentsForSlot(slot)
                .filter((a) => slot !== 'sight' || opticFits(a.id, base))
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  sub: a.cons === 'なし' ? a.pros : `${a.pros} / ${a.cons}`,
                  locked: !isUnlocked('attachment', a.id, lv),
                })),
            ];
          for (const c of choices) {
            const ob = document.createElement('button');
            ob.type = 'button';
            const on = (m[slot] ?? null) === c.id;
            ob.className = `u2a-popbtn${on ? ' on' : ''}`;
            ob.disabled = c.locked;
            ob.innerHTML = `<span class="u2a-popname">${c.name}</span><span class="u2a-popsub">${
              c.locked && c.id ? `Lv ${unlockLevelOf('attachment', c.id)} で解放` : c.sub
            }</span>`;
            if (!c.locked) {
              ob.addEventListener('click', () => {
                // A3: ポップ選択でスロット欄が再構築されフォーカスが失われるため、元スロットへ戻す
                const hadFocus = q('slots').contains(document.activeElement);
                const next = slotMap();
                next[slot] = c.id;
                writeSlots(next);
                ensureAttachmentGates();
                host.previewWeaponId(loadout.primaryId);
                closePop();
                renderDetail();
                if (hadFocus)
                  q('slots')
                    .querySelector<HTMLElement>(`[data-slot="${slot}"] .u2a-slot`)
                    ?.focus({ preventScroll: true });
              });
            }
            pop.appendChild(ob);
          }
          wrap.appendChild(pop);
          openPop = pop;
          pop.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
        });
        wrap.appendChild(btn);
        slots.appendChild(wrap);
      }
    }
    // CTA: この兵装で出撃(実発射経路=callbacks.onStart(loadout))
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'u2a-cta';
    cta.innerHTML = `この兵装で出撃<span class="u2a-glyph">A</span>`;
    cta.addEventListener('click', () => {
      // A2: 出撃直前にも不適合/ロック済みアタッチメントを再ゲート
      ensureAttachmentGates();
      loadout.carriedPerk = resolveCarriedPerk(loadout.charm, readLastZombiePerk());
      host.saveLoadout();
      host.callbacks.onStart(loadout);
    });
    slots.appendChild(cta);
  };

  const renderBand = (): void => {
    const lv = level();
    const owned = PRIMARY_IDS.filter((id) => isUnlocked('weapon', id, lv)).length;
    let gold = 0;
    let dia = 0;
    let dm = 0;
    for (const id of CAMO_WEAPON_IDS) {
      if (isCamoUnlocked('gold', id, profile.weaponStats, profile.unlockedRewardCamos)) gold += 1;
      if (isCamoUnlocked('diamond', id, profile.weaponStats, profile.unlockedRewardCamos)) dia += 1;
      if (isCamoUnlocked('dark-matter', id, profile.weaponStats, profile.unlockedRewardCamos))
        dm += 1;
    }
    q('band').textContent =
      `保有 ${owned}/${PRIMARY_IDS.length} · ゴールド${gold} · ダイヤ${dia} · ダークマター${dm} · 鍛神台はゾンビモード内「祠」で稼働`;
  };

  const renderDetail = (): void => {
    if (view === 'grenade') {
      const spec = GRENADE_SPECS[loadout.grenade];
      q('wname').textContent = spec.name;
      q('wspec').textContent = `投擲物 · 携行 ×${spec.carry}`;
      q('wchips').innerHTML = '';
      q('wdesc').textContent = GRENADE_DESCS[loadout.grenade];
      renderSlots();
      renderBand();
      return;
    }
    const def = detailDef();
    const base =
      view === 'secondary' ? def : (WEAPON_DEFS[loadout.primaryId] ?? WEAPON_DEFS['kaede-ar']!);
    q('wname').textContent = def.name;
    q('wspec').textContent =
      `${def.id.toUpperCase()} · ${modeLabel(def)} · 装弾${def.magazineSize}+∞`;
    const chips = q('wchips');
    chips.innerHTML = '';
    if (def.class === 'exotic') {
      const c = document.createElement('span');
      c.className = 'u2a-chip u2a-chip--gold';
      c.textContent = '特殊兵装 EXOTIC';
      chips.appendChild(c);
    }
    const supported = def.id === 'fists' || CAMO_WEAPON_IDS.includes(def.id);
    if (supported) {
      const c = document.createElement('span');
      c.className = 'u2a-chip';
      c.textContent = `カモ ${camoUnlockedCount(def.id)}/${camoTotal(def.id)}`;
      chips.appendChild(c);
    }
    q('wdesc').textContent = descFor(def);
    renderStats(def, base);
    renderCamo(def);
    renderSlots();
    renderBand();
    stage?.classList.toggle('u2a--shrine', view === 'primary' && cls === 'exotic');
  };

  // ── ビュー切替(メイン/サブ/投擲) ─────────────────────────────────────
  const setView = (v: ArmoryView): void => {
    view = v;
    stage?.setAttribute('data-view', v);
    root.querySelectorAll<HTMLButtonElement>('[data-view-btn]').forEach((b) => {
      const on = b.dataset.viewBtn === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderTabs();
    renderList();
    renderDetail();
    if (v !== 'grenade') {
      host.previewWeaponId(v === 'secondary' ? loadout.secondaryId : loadout.primaryId);
    }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-view-btn]').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.viewBtn as ArmoryView));
  });

  root
    .querySelector<HTMLButtonElement>('[data-id="back-to-hub"]')
    ?.addEventListener('click', () => host.back());

  // 初期描画+3Dプレビュー(canvasは[data-id="weapon-canvas"]、hostが生成/破棄を管理)
  // A2: 保存済みアタッチメントが不適合/ロック済みのまま試合開始できないよう初回にもゲートする
  ensureAttachmentGates();
  renderTabs();
  renderList();
  renderDetail();
  host.mountWeaponPreview();
  host.previewWeaponId(loadout.primaryId);
  root.querySelector<HTMLElement>('.u2a-row.on, .u2a-row')?.focus({ preventScroll: true });

  return {
    dispose(): void {
      closePop();
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onDocKeydown, true);
      ro.disconnect();
      host.teardownWeaponPreview();
      root.replaceChildren();
    },
    onGamepad(nav: UiNav): boolean {
      // A4: ポップ表示中は○/Escでポップだけ閉じる(menu2側の全画面バックへ誤爆させない)
      if (openPop && nav.back) {
        closePop();
        return true;
      }
      if (view === 'primary' && (nav.tabPrev || nav.tabNext)) {
        const classes = CLASS_ORDER.filter((c) =>
          PRIMARY_IDS.some((id) => WEAPON_DEFS[id]?.class === c),
        );
        const i = classes.indexOf(cls);
        if (i >= 0 && classes.length > 0) {
          const next = classes[(i + (nav.tabNext ? 1 : classes.length - 1)) % classes.length];
          if (next) {
            // A3: LB/RBでのタブ送りもフォーカスを持っていた要素の論理対象へ戻す
            const tabsHadFocus = q('tabs').contains(document.activeElement);
            const rowsHadFocus = q('weapon-list').contains(document.activeElement);
            cls = next;
            renderTabs();
            renderList();
            if (tabsHadFocus) {
              q('tabs')
                .querySelector<HTMLElement>('.u2a-tab.on')
                ?.focus({ preventScroll: true });
            } else if (rowsHadFocus) {
              q('weapon-list')
                .querySelector<HTMLElement>('.u2a-row.on')
                ?.focus({ preventScroll: true });
            }
          }
        }
        return true;
      }
      return false;
    },
  };
}
