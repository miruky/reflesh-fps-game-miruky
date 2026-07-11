// R58 武器シルエット集約。SHAPE_SPECS(全 ModelKey 網羅=tsc が移動漏れを検出)+ SHAPE_PAINTERS。
// viewmodel.ts はここから import する(旧・インラインSHAPE_SPECSを置換)。
import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import { AR_SHAPES } from './ar';
import { SMG_SHAPES } from './smg';
import { SNIPER_SHAPES } from './sniper';
import { SHOTGUN_SHAPES } from './shotgun';
import { LMG_SHAPES } from './lmg';
import { PISTOL_SHAPES } from './pistol';
import { SPECIAL_SHAPES } from './special';

// 全 ModelKey を網羅した寸法表。satisfies Record<ModelKey, Silhouette> なので、
// weapons.ts が ModelKey を増やして対応エントリを置き忘れると tsc がキー欠落を検出する。
export const SHAPE_SPECS = {
  ...AR_SHAPES,
  ...SMG_SHAPES,
  ...SNIPER_SHAPES,
  ...SHOTGUN_SHAPES,
  ...LMG_SHAPES,
  ...PISTOL_SHAPES,
  ...SPECIAL_SHAPES,
} satisfies Record<ModelKey, Silhouette>;

export { SHAPE_PAINTERS } from './painters';
export type {
  Silhouette, ScopeSpec, DetailSpec, ShadeMode,
  FeedKind, HandguardKind, StockKind, MuzzleDevice, AccentBand,
} from './types';
export { chamferBox, col, setColor, PAL, type PainterCtx, type ShapePainter, type Movable } from './toolkit';
