import type { MoodId } from '../game/stage';

export interface CinematicLightingProfile {
  /** StagePalette.fogDensity へ掛ける表示専用係数。AI視認係数は変更しない。 */
  readonly fogScale: number;
  /** palette.ambientIntensity へ掛ける HemisphereLight 係数。 */
  readonly hemiScale: number;
  /** palette.lightIntensity へ掛ける逆光フィル係数。 */
  readonly fillScale: number;
  /** 主平行光の強度係数。HDR合成時のアルベド飽和を抑える。 */
  readonly sunScale: number;
  /** scene.environmentIntensity の上限。 */
  readonly environmentCap: number;
  /** 明るいパレットのフォグが遠景を白く洗うのを防ぐ線形色係数。 */
  readonly fogColorScale: number;
  /** フォグを可視空の地平色へ寄せる量。 */
  readonly fogSkyMix: number;
  /** Sky.js HDR出力の表示用係数。IBLベイクには適用しない。 */
  readonly visibleSkyScale: number;
  /** 可視空の線形HDR上限。Bloom閾値を十分下回る。 */
  readonly visibleSkyClamp: number;
}

const PROFILES: Readonly<Record<MoodId, CinematicLightingProfile>> = {
  // IBL/Hemisphereの無方向光を減らし、同じシャドウ付き主平行光へ
  // 比重を移す。明るさを落とす設定ではなく、接地面・屋根・窓奥の
  // 明暗比を戻すためのライティング比である。ライト数とshadow passは不変。
  day: {
    fogScale: 0.38,
    hemiScale: 0.28,
    fillScale: 0.06,
    sunScale: 0.98,
    environmentCap: 0.42,
    fogColorScale: 0.72,
    fogSkyMix: 0.12,
    visibleSkyScale: 0.13,
    visibleSkyClamp: 0.42,
  },
  dusk: {
    fogScale: 0.5,
    hemiScale: 0.32,
    fillScale: 0.1,
    sunScale: 1,
    environmentCap: 0.44,
    fogColorScale: 0.7,
    fogSkyMix: 0.16,
    visibleSkyScale: 0.14,
    visibleSkyClamp: 0.43,
  },
  night: {
    fogScale: 0.44,
    hemiScale: 0.38,
    fillScale: 0.08,
    sunScale: 0.9,
    environmentCap: 0.34,
    fogColorScale: 0.68,
    fogSkyMix: 0.12,
    visibleSkyScale: 0.13,
    visibleSkyClamp: 0.34,
  },
  overcast: {
    fogScale: 0.44,
    hemiScale: 0.34,
    fillScale: 0.05,
    sunScale: 0.94,
    environmentCap: 0.38,
    fogColorScale: 0.68,
    fogSkyMix: 0.1,
    visibleSkyScale: 0.12,
    visibleSkyClamp: 0.37,
  },
  snow: {
    fogScale: 0.5,
    hemiScale: 0.33,
    fillScale: 0.06,
    sunScale: 0.92,
    environmentCap: 0.42,
    fogColorScale: 0.73,
    fogSkyMix: 0.06,
    visibleSkyScale: 0.11,
    visibleSkyClamp: 0.39,
  },
};

// ゾンビ専用: 色調は夜のまま、敵・床・退路の中間調だけを持ち上げる。
// ライト数は増やさず既存2灯とIBLの係数だけを変えるため、draw call/GPU負荷は不変。
const READABLE_UNDEAD: CinematicLightingProfile = {
  fogScale: 0.4,
  hemiScale: 0.68,
  fillScale: 0.21,
  sunScale: 0.98,
  environmentCap: 0.58,
  fogColorScale: 0.67,
  fogSkyMix: 0.08,
  visibleSkyScale: 0.12,
  visibleSkyClamp: 0.36,
};

export function cinematicLightingProfile(
  mood: MoodId,
  readableUndead = false,
): CinematicLightingProfile {
  return readableUndead ? READABLE_UNDEAD : PROFILES[mood];
}

export function cinematicVisualFogDensity(
  baseDensity: number,
  mood: MoodId,
  readableUndead = false,
): number {
  return baseDensity * cinematicLightingProfile(mood, readableUndead).fogScale;
}
