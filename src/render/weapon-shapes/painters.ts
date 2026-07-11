// R58 painter レジストリ集約。各クラスファイルの *_PAINTERS を統合する(初期は全空)。
// Phase C は各クラスファイル側の *_PAINTERS へ登録するだけでよい(このファイルは触らない)。
import type { ModelKey } from '../../game/weapons';
import type { ShapePainter } from './toolkit';
import { AR_PAINTERS } from './ar';
import { SMG_PAINTERS } from './smg';
import { SNIPER_PAINTERS } from './sniper';
import { SHOTGUN_PAINTERS } from './shotgun';
import { LMG_PAINTERS } from './lmg';
import { PISTOL_PAINTERS } from './pistol';
import { SPECIAL_PAINTERS } from './special';

export const SHAPE_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  ...AR_PAINTERS,
  ...SMG_PAINTERS,
  ...SNIPER_PAINTERS,
  ...SHOTGUN_PAINTERS,
  ...LMG_PAINTERS,
  ...PISTOL_PAINTERS,
  ...SPECIAL_PAINTERS,
};
