// 光学(サイト/スコープ)の単一真実源。
// viewmodel(3Dハウジング/レンズ)・match(MatchSnapshot)・hud(レティクル)・
// attachments(倍率/ADS)・progression(解放)が全てここを参照する。
//
// 設計要点:
//  - resolveOpticId(def) は WeaponDef 単一シグネチャ。内蔵スコープ形状(SCOPED_SHAPES)は
//    def.scope の真偽に依らず内蔵id(scope-dmr/scope-sniper/scope-dsr)を最優先で返す。
//    これで viewmodel(!!sil.scope)と match(def.scope===true)の DMR 判定分岐を統一する。
//  - magnified は def.scope とは独立。attachment 光学は def.scope を絶対に立てず
//    (match.ts の ~12 sniper 分岐 hijack を回避)、adsOpticActive/HUD だけを駆動する。
//  - sightY は resolveSightY の真実源。テスト固定値を厳密再現する。

import type { WeaponClass, ViewModelShape, WeaponDef } from './weapons';

// HUD が描くレティクルの種類(sightStyle = reticleKind)。
export type ReticleKind = 'mildot' | 'chevron' | 'holo' | 'circle-dot' | 'delta' | 'thermal' | 'dot';

// viewmodel buildGunBody の housing switch 分岐キー。
export type OpticHousing =
  | 'reflex'
  | 'holo'
  | 'rmr'
  | 'delta'
  | 'acog'
  | 'variable'
  | 'thermal'
  | 'hybrid'
  | 'canted'
  | 'scope';

export interface OpticSpec {
  id: string;
  reticleKind: ReticleKind;
  // true=倍率級。adsOpticActive/フルオーバーレイ判定に使用(def.scope とは独立)。
  magnified: boolean;
  // resolveSightY の真実源(ADS 収束 Y)。
  sightY: number;
  // viewmodel の housing switch 分岐。
  housing: OpticHousing;
  // レンズの共有材(glassThin=薄透過/glassScope=スコープ透過)。
  glassKind: 'thin' | 'scope';
  // 倍率光学は host 非依存の絶対値(乗算でなく代入)。1x 級は 1.0。
  adsFovScale: number;
  adsTimeMs?: number;
  // thermal/recon の琥珀等。housing/レティクルの色味に使う。
  tint?: number;
  // 武器割当ゲート(内蔵scope shape・pistol/revolver/fists の magnified除外)。
  fits?: (def: WeaponDef) => boolean;
}

// クラス既定のシルエット形状。def.shape 未指定時のフォールバック。
export function classDefault(cls: WeaponClass): ViewModelShape {
  switch (cls) {
    case 'ar':
      return 'rifle';
    case 'smg':
      return 'smg';
    case 'sniper':
      return 'sniper-bolt';
    case 'shotgun':
      return 'shotgun-pump';
    case 'br':
      return 'rifle';
    case 'lmg':
      return 'lmg-belt';
    case 'pistol':
      return 'pistol';
    case 'marksman':
      return 'dmr';
  }
}

// def から形状を解決(def.shape 優先、無ければクラス既定)。
export function resolveShape(def: WeaponDef): ViewModelShape {
  return def.shape ?? classDefault(def.class);
}

// 一体型スコープを持つ形状(sil.scope が非nullの3形状に一致)。
export const SCOPED_SHAPES: ReadonlySet<ViewModelShape> = new Set<ViewModelShape>([
  'dmr',
  'sniper-bolt',
  'dsr-bp',
]);

// 倍率光学を許可しない形状(拳銃系/素手)。
const MAGNIFIED_EXCLUDE: ReadonlySet<ViewModelShape> = new Set<ViewModelShape>([
  'pistol',
  'revolver',
  'machine-pistol',
  'fists',
]);

// 1x ドット: 内蔵スコープ機と素手を除く全武器に付く(拳銃OK)。
function fitsDot(def: WeaponDef): boolean {
  const shape = resolveShape(def);
  return !SCOPED_SHAPES.has(shape) && shape !== 'fists';
}
// 倍率光学: 内蔵スコープ機・拳銃系・素手を除外。
function fitsMagnified(def: WeaponDef): boolean {
  const shape = resolveShape(def);
  return !SCOPED_SHAPES.has(shape) && !MAGNIFIED_EXCLUDE.has(shape);
}

// 光学レジストリ(12=光学を倍以上)。9着脱ハウジング + 3内蔵スコープ。
export const OPTIC_SPECS: Record<string, OpticSpec> = {
  // ── 1x ドット系(magnified:false・glassThin・adsFovScale=1.0) ──
  reflex: {
    id: 'reflex',
    reticleKind: 'dot',
    magnified: false,
    sightY: 0.08,
    housing: 'reflex',
    glassKind: 'thin',
    adsFovScale: 1.0,
    fits: fitsDot,
  },
  holographic: {
    id: 'holographic',
    reticleKind: 'holo',
    magnified: false,
    sightY: 0.08,
    housing: 'holo',
    glassKind: 'thin',
    adsFovScale: 1.0,
    fits: fitsDot,
  },
  delta: {
    id: 'delta',
    reticleKind: 'delta',
    magnified: false,
    sightY: 0.08,
    housing: 'delta',
    glassKind: 'thin',
    adsFovScale: 1.0,
    fits: fitsDot,
  },
  pico: {
    id: 'pico',
    reticleKind: 'dot',
    magnified: false,
    sightY: 0.08,
    housing: 'rmr',
    glassKind: 'thin',
    adsFovScale: 1.0,
    fits: fitsDot,
  },
  canted: {
    id: 'canted',
    reticleKind: 'dot',
    magnified: false,
    sightY: 0.08,
    housing: 'canted',
    glassKind: 'thin',
    adsFovScale: 1.0,
    fits: fitsDot,
  },
  // ── 倍率系(magnified:true・glassScope・adsFovScale=絶対値) ──
  acog: {
    id: 'acog',
    reticleKind: 'chevron',
    magnified: true,
    sightY: 0.085,
    housing: 'acog',
    glassKind: 'scope',
    adsFovScale: 0.55,
    adsTimeMs: 280,
    fits: fitsMagnified,
  },
  variable: {
    id: 'variable',
    reticleKind: 'mildot',
    magnified: true,
    sightY: 0.085,
    housing: 'variable',
    glassKind: 'scope',
    adsFovScale: 0.42,
    adsTimeMs: 320,
    fits: fitsMagnified,
  },
  thermal: {
    id: 'thermal',
    reticleKind: 'thermal',
    magnified: true,
    sightY: 0.085,
    housing: 'thermal',
    glassKind: 'scope',
    adsFovScale: 0.5,
    adsTimeMs: 300,
    tint: 0xffb060,
    fits: fitsMagnified,
  },
  hybrid: {
    id: 'hybrid',
    reticleKind: 'circle-dot',
    magnified: true,
    sightY: 0.08,
    housing: 'hybrid',
    glassKind: 'scope',
    adsFovScale: 0.62,
    adsTimeMs: 260,
    fits: fitsMagnified,
  },
  // ── 内蔵スコープ(attachment ではない。resolveOpticId が shape から解決) ──
  // sightY はテスト固定値を厳密再現: dmr=0.085 / sniper-bolt=0.08 / dsr-bp=0.092。
  'scope-dmr': {
    id: 'scope-dmr',
    reticleKind: 'mildot',
    magnified: true,
    sightY: 0.085,
    housing: 'scope',
    glassKind: 'scope',
    adsFovScale: 0.42,
  },
  'scope-sniper': {
    id: 'scope-sniper',
    reticleKind: 'mildot',
    magnified: true,
    sightY: 0.08,
    housing: 'scope',
    glassKind: 'scope',
    adsFovScale: 0.3,
  },
  'scope-dsr': {
    id: 'scope-dsr',
    reticleKind: 'mildot',
    magnified: true,
    sightY: 0.092,
    housing: 'scope',
    glassKind: 'scope',
    adsFovScale: 0.32,
  },
};

// def から光学idを解決(単一シグネチャ)。
//  1. 内蔵スコープ形状(SCOPED_SHAPES)を最優先で内蔵id へ。def.scope の真偽に依らない。
//  2. attachmentIds の sight 光学(OPTIC_SPECS に載るもの)を解決。
//  3. どれでもなければ 'iron'(レジストリ外センチネル)。
export function resolveOpticId(def: WeaponDef): string {
  const shape = resolveShape(def);
  if (SCOPED_SHAPES.has(shape)) {
    if (shape === 'dmr') return 'scope-dmr';
    if (shape === 'dsr-bp') return 'scope-dsr';
    return 'scope-sniper';
  }
  const attachments = def.attachmentIds ?? [];
  for (const id of attachments) {
    const om = OPTIC_SPECS[id];
    if (om) return id;
  }
  return 'iron';
}
