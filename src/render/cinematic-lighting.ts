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
}

const PROFILES: Readonly<Record<MoodId, CinematicLightingProfile>> = {
  day: { fogScale: 0.5, hemiScale: 0.34, fillScale: 0.08, sunScale: 0.88, environmentCap: 0.56 },
  dusk: { fogScale: 0.7, hemiScale: 0.4, fillScale: 0.12, sunScale: 0.92, environmentCap: 0.6 },
  night: { fogScale: 0.8, hemiScale: 0.46, fillScale: 0.1, sunScale: 0.82, environmentCap: 0.46 },
  overcast: { fogScale: 0.64, hemiScale: 0.44, fillScale: 0.06, sunScale: 0.84, environmentCap: 0.5 },
  snow: { fogScale: 0.9, hemiScale: 0.42, fillScale: 0.08, sunScale: 0.86, environmentCap: 0.54 },
};

// ゾンビ専用: 色調は夜のまま、敵・床・退路の中間調だけを持ち上げる。
// ライト数は増やさず既存2灯とIBLの係数だけを変えるため、draw call/GPU負荷は不変。
const READABLE_UNDEAD: CinematicLightingProfile = {
  fogScale: 0.5,
  hemiScale: 0.86,
  fillScale: 0.24,
  sunScale: 1,
  environmentCap: 0.76,
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
