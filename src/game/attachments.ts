import type { WeaponDef } from './weapons';
import { OPTIC_SPECS } from './optics';

export type AttachmentSlot = 'sight' | 'muzzle' | 'grip' | 'mag';

// 新光学の apply を OPTIC_SPECS から生成(単一真実源)。倍率光学は def.scope を絶対に立てず
// (match.ts の sniper 分岐 hijack 回避)、adsFovScale を host 非依存の絶対値で代入 + adsTimeMs。
// 1x ドットは倍率据置で ADS 速度/精度のみ改善。
function applyOptic(id: string): (def: WeaponDef) => void {
  return (def) => {
    const spec = OPTIC_SPECS[id];
    if (!spec) return;
    if (spec.magnified) {
      def.adsFovScale = spec.adsFovScale;
      if (spec.adsTimeMs != null) def.adsTimeMs = spec.adsTimeMs;
      def.spreadAdsDeg *= 0.7;
    } else {
      def.adsTimeMs *= 0.9;
      def.spreadAdsDeg *= 0.92;
    }
  };
}

export interface AttachmentDef {
  id: string;
  slot: AttachmentSlot;
  name: string;
  // メニューに表示する効果の要約
  pros: string;
  cons: string;
  apply: (def: WeaponDef) => void;
}

export const ATTACHMENT_SLOTS: Array<{ slot: AttachmentSlot; label: string }> = [
  { slot: 'sight', label: 'サイト' },
  { slot: 'muzzle', label: 'マズル' },
  { slot: 'grip', label: 'グリップ' },
  { slot: 'mag', label: 'マガジン' },
];

export const ATTACHMENT_DEFS: Record<string, AttachmentDef> = {
  reflex: {
    id: 'reflex',
    slot: 'sight',
    name: 'リフレックスサイト',
    pros: 'ADS速度+15% / ADS精度+10%',
    cons: 'なし',
    apply: (def) => {
      def.adsTimeMs *= 0.85;
      def.spreadAdsDeg *= 0.9;
    },
  },
  telescopic: {
    id: 'telescopic',
    slot: 'sight',
    name: 'テレスコピックサイト',
    pros: 'ズーム倍率+25% / ADS精度+30%',
    cons: 'ADS速度-20%',
    apply: (def) => {
      def.adsFovScale *= 0.78;
      def.spreadAdsDeg *= 0.7;
      def.adsTimeMs *= 1.2;
    },
  },
  // ── ③追加光学(sight スロット・OPTIC_SPECS 駆動)──
  holographic: {
    id: 'holographic',
    slot: 'sight',
    name: 'ホロサイト',
    pros: 'ADS速度+10% / 広い視界のホロレティクル',
    cons: 'なし',
    apply: applyOptic('holographic'),
  },
  delta: {
    id: 'delta',
    slot: 'sight',
    name: 'デルタサイト',
    pros: 'ADS速度+10% / エッチングされたデルタレティクル',
    cons: 'なし',
    apply: applyOptic('delta'),
  },
  pico: {
    id: 'pico',
    slot: 'sight',
    name: 'ピコドット',
    pros: 'ADS速度+10% / 極小で視界を遮らない',
    cons: 'なし',
    apply: applyOptic('pico'),
  },
  canted: {
    id: 'canted',
    slot: 'sight',
    name: 'カンテッドサイト',
    pros: 'ADS速度+10% / 副照準ドット',
    cons: 'なし',
    apply: applyOptic('canted'),
  },
  acog: {
    id: 'acog',
    slot: 'sight',
    name: 'ACOGスコープ',
    pros: '中倍率ズーム / ADS精度+30%',
    cons: 'ADS速度低下',
    apply: applyOptic('acog'),
  },
  variable: {
    id: 'variable',
    slot: 'sight',
    name: 'バリアブルスコープ',
    pros: '高倍率ズーム / ADS精度+30%',
    cons: 'ADS速度低下',
    apply: applyOptic('variable'),
  },
  thermal: {
    id: 'thermal',
    slot: 'sight',
    name: 'リコンスコープ',
    pros: '倍率ズーム / 暗視で標的が浮かぶ',
    cons: 'ADS速度低下',
    apply: applyOptic('thermal'),
  },
  hybrid: {
    id: 'hybrid',
    slot: 'sight',
    name: 'ハイブリッドサイト',
    pros: '近接ドット+倍率マグの複合 / ADS精度+30%',
    cons: 'ADS速度低下',
    apply: applyOptic('hybrid'),
  },
  suppressor: {
    id: 'suppressor',
    slot: 'muzzle',
    name: 'サプレッサー',
    pros: '発砲してもBOTにほぼ気づかれない',
    cons: '射程-15%',
    apply: (def) => {
      def.suppressed = true;
      def.falloff = {
        start: def.falloff.start * 0.85,
        end: def.falloff.end * 0.85,
        minFactor: def.falloff.minFactor,
      };
    },
  },
  compensator: {
    id: 'compensator',
    slot: 'muzzle',
    name: 'コンペンセイター',
    pros: '縦反動-25% / ブルーム-20%',
    cons: 'なし',
    apply: (def) => {
      def.recoilPattern = def.recoilPattern.map((step) => ({
        pitch: step.pitch * 0.75,
        yaw: step.yaw,
      }));
      def.bloomPerShotDeg *= 0.8;
    },
  },
  vertical: {
    id: 'vertical',
    slot: 'grip',
    name: 'バーティカルグリップ',
    pros: '横反動-40% / 縦反動-15%',
    cons: 'なし',
    apply: (def) => {
      def.recoilPattern = def.recoilPattern.map((step) => ({
        pitch: step.pitch * 0.85,
        yaw: step.yaw * 0.6,
      }));
    },
  },
  angled: {
    id: 'angled',
    slot: 'grip',
    name: 'アングルドグリップ',
    pros: 'ADS速度+25%',
    cons: 'なし',
    apply: (def) => {
      def.adsTimeMs *= 0.75;
    },
  },
  extended: {
    id: 'extended',
    slot: 'mag',
    name: '拡張マガジン',
    pros: '装弾数+50%',
    cons: 'リロード時間+15%',
    apply: (def) => {
      def.magazineSize = Math.round(def.magazineSize * 1.5);
      def.reloadTacticalMs *= 1.15;
      def.reloadEmptyMs *= 1.15;
    },
  },
  quick: {
    id: 'quick',
    slot: 'mag',
    name: 'クイックマガジン',
    pros: 'リロード時間-25%',
    cons: '装弾数-15%',
    apply: (def) => {
      def.reloadTacticalMs *= 0.75;
      def.reloadEmptyMs *= 0.75;
      // リザーブ弾は全武器無限のため、装弾数を削ることを実効デメリットとする
      def.magazineSize = Math.max(1, Math.round(def.magazineSize * 0.85));
    },
  },
};

export function attachmentsForSlot(slot: AttachmentSlot): AttachmentDef[] {
  return Object.values(ATTACHMENT_DEFS).filter((a) => a.slot === slot);
}

// ベース定義を変更せず、アタッチメント適用済みのコピーを返す。
// 同一スロットに複数指定された場合は後勝ちにせず最初の1つだけ適用する
export function applyAttachments(base: WeaponDef, ids: string[]): WeaponDef {
  const def: WeaponDef = {
    ...base,
    falloff: { ...base.falloff },
    recoilPattern: base.recoilPattern.map((step) => ({ ...step })),
  };
  const usedSlots = new Set<AttachmentSlot>();
  const applied: string[] = [];
  for (const id of ids) {
    const attachment = ATTACHMENT_DEFS[id];
    if (!attachment || usedSlots.has(attachment.slot)) continue;
    usedSlots.add(attachment.slot);
    attachment.apply(def);
    applied.push(id);
  }
  def.attachmentIds = applied;
  return def;
}
