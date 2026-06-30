import { mulberry32, range, type Rand } from '../core/rng';
import type { StageDef, StagePalette } from './stage';

// プロシージャル・ステージ生成のためのバイオーム定義。
// 手書きの STAGES(stages.ts)と同じ値域に収まるよう、各プロファイルの
// レンジは控えめに取り、floorL と obstacleL を必ず分離して可読性を担保する。
export type Biome = 'urban' | 'industrial' | 'desert' | 'snow' | 'neon' | 'verdant' | 'harbor' | 'dusk';

export const BIOMES: readonly Biome[] = [
  'urban',
  'industrial',
  'desert',
  'snow',
  'neon',
  'verdant',
  'harbor',
  'dusk',
];

interface BiomeProfile {
  hueBase: number;
  hueSpread: number;
  accentHueShift: number;
  satRange: [number, number];
  floorL: [number, number];
  obstacleL: [number, number];
  skyHue: number;
  skyL: [number, number];
  warmLight: boolean;
  emissive: boolean;
  densityPerSqM: [number, number];
  fog: [number, number];
  elevation: [number, number];
  turbidity: [number, number];
  rayleigh: [number, number];
  mie: [number, number];
  exposure: [number, number];
  env: [number, number];
  bloomStrength?: [number, number];
  namePool: readonly string[];
  subPool: readonly string[];
}

// 8バイオーム。floorL と obstacleL のレンジは最近接エッジで 0.10 以上離し、
// 生成色の HSL 明度差が常に 0.08 を超えるようにしている。
const BIOME_PROFILES: Record<Biome, BiomeProfile> = {
  urban: {
    hueBase: 215,
    hueSpread: 18,
    accentHueShift: 150,
    satRange: [0.05, 0.18],
    floorL: [0.62, 0.72],
    obstacleL: [0.38, 0.48],
    skyHue: 205,
    skyL: [0.72, 0.82],
    warmLight: false,
    emissive: false,
    densityPerSqM: [0.006, 0.01],
    fog: [0.008, 0.013],
    elevation: [40, 55],
    turbidity: [2.5, 4],
    rayleigh: [1.2, 1.8],
    mie: [0.004, 0.006],
    exposure: [0.95, 1.05],
    env: [0.85, 1.0],
    namePool: ['崩落区', '管制街', '灰の通り', '高架下'],
    subPool: ['見通しの効く市街戦', '灰に沈む交差点の制圧戦', '直線の射線が刺さる街路'],
  },
  industrial: {
    hueBase: 28,
    hueSpread: 16,
    accentHueShift: 195,
    satRange: [0.25, 0.45],
    floorL: [0.3, 0.4],
    obstacleL: [0.5, 0.62],
    skyHue: 30,
    skyL: [0.45, 0.58],
    warmLight: true,
    emissive: false,
    densityPerSqM: [0.008, 0.013],
    fog: [0.014, 0.02],
    elevation: [6, 18],
    turbidity: [8, 14],
    rayleigh: [0.9, 1.4],
    mie: [0.006, 0.012],
    exposure: [1.0, 1.1],
    env: [0.4, 0.6],
    namePool: ['錆の工区', '溶鉱炉', '配管区', '廃製鉄所'],
    subPool: ['鉄骨に阻まれる近距離戦', '錆びた回廊の取り合い', '配管が射線を断つ密集戦'],
  },
  desert: {
    hueBase: 42,
    hueSpread: 12,
    accentHueShift: 175,
    satRange: [0.3, 0.5],
    floorL: [0.62, 0.74],
    obstacleL: [0.42, 0.52],
    skyHue: 48,
    skyL: [0.78, 0.88],
    warmLight: true,
    emissive: false,
    densityPerSqM: [0.004, 0.008],
    fog: [0.006, 0.011],
    elevation: [58, 72],
    turbidity: [3, 6],
    rayleigh: [0.8, 1.2],
    mie: [0.002, 0.004],
    exposure: [1.05, 1.2],
    env: [0.9, 1.05],
    namePool: ['灼熱砂丘', '風蝕谷', '枯れ井戸', '砂嵐前線'],
    subPool: ['遮蔽の乏しい我慢比べ', '陽炎ゆらぐ広域戦', '砂塵に紛れる長射程戦'],
  },
  snow: {
    hueBase: 210,
    hueSpread: 25,
    accentHueShift: 25,
    satRange: [0.03, 0.12],
    floorL: [0.78, 0.88],
    obstacleL: [0.55, 0.66],
    skyHue: 210,
    skyL: [0.8, 0.9],
    warmLight: false,
    emissive: false,
    densityPerSqM: [0.006, 0.01],
    fog: [0.022, 0.032],
    elevation: [15, 28],
    turbidity: [1, 2.5],
    rayleigh: [0.3, 0.6],
    mie: [0.001, 0.003],
    exposure: [0.92, 1.0],
    env: [0.95, 1.1],
    namePool: ['吹雪山稜', '凍結湖', '白の迷彩', '氷霧地帯'],
    subPool: ['深い霧と白の迷彩', '凍てつく見合い戦', '視界を奪う吹雪の遭遇戦'],
  },
  neon: {
    hueBase: 280,
    hueSpread: 60,
    accentHueShift: 160,
    satRange: [0.1, 0.25],
    floorL: [0.14, 0.22],
    obstacleL: [0.32, 0.42],
    skyHue: 250,
    skyL: [0.06, 0.14],
    warmLight: false,
    emissive: true,
    densityPerSqM: [0.008, 0.012],
    fog: [0.02, 0.028],
    elevation: [-6, 4],
    turbidity: [12, 18],
    rayleigh: [0.4, 0.8],
    mie: [0.015, 0.025],
    exposure: [1.1, 1.25],
    env: [0.4, 0.55],
    bloomStrength: [0.7, 1.1],
    namePool: ['夜市', '電脳街', '虹彩区', '残光通り'],
    subPool: ['ネオンだけが頼りの夜戦', '明滅する看板の下の接近戦', '闇に瞬く発光体の市街戦'],
  },
  verdant: {
    hueBase: 110,
    hueSpread: 30,
    accentHueShift: -80,
    satRange: [0.2, 0.4],
    floorL: [0.38, 0.48],
    obstacleL: [0.58, 0.7],
    skyHue: 195,
    skyL: [0.7, 0.82],
    warmLight: true,
    emissive: false,
    densityPerSqM: [0.007, 0.011],
    fog: [0.009, 0.014],
    elevation: [40, 55],
    turbidity: [3, 6],
    rayleigh: [1.3, 1.9],
    mie: [0.003, 0.005],
    exposure: [0.98, 1.08],
    env: [0.85, 1.0],
    namePool: ['密林遺構', '苔生す回廊', '緑庭園', '蔦の谷'],
    subPool: ['緑陰を縫う回り込み戦', '苔むす石組みの近接戦', '繁茂に隠れる伏撃戦'],
  },
  harbor: {
    hueBase: 205,
    hueSpread: 22,
    accentHueShift: 165,
    satRange: [0.18, 0.35],
    floorL: [0.55, 0.66],
    obstacleL: [0.34, 0.44],
    skyHue: 215,
    skyL: [0.55, 0.68],
    warmLight: false,
    emissive: false,
    densityPerSqM: [0.005, 0.009],
    fog: [0.008, 0.013],
    elevation: [12, 24],
    turbidity: [4, 8],
    rayleigh: [1.6, 2.4],
    mie: [0.003, 0.005],
    exposure: [0.98, 1.08],
    env: [0.8, 0.95],
    namePool: ['黄昏埠頭', '停泊地', '潮風桟橋', '濃霧の港'],
    subPool: ['長い射線が通る広域戦', 'コンテナ越しの遠近両戦', '汐風わたる埠頭の制圧戦'],
  },
  dusk: {
    hueBase: 285,
    hueSpread: 35,
    accentHueShift: 70,
    satRange: [0.18, 0.38],
    floorL: [0.3, 0.4],
    obstacleL: [0.5, 0.62],
    skyHue: 300,
    skyL: [0.45, 0.58],
    warmLight: true,
    emissive: false,
    densityPerSqM: [0.006, 0.01],
    fog: [0.012, 0.018],
    elevation: [4, 14],
    turbidity: [7, 12],
    rayleigh: [2.4, 3.4],
    mie: [0.004, 0.007],
    exposure: [1.0, 1.1],
    env: [0.55, 0.72],
    bloomStrength: [0.5, 0.85],
    namePool: ['黄昏丘陵', '残照の尾根', '紫煙台地', '暮色の砦'],
    subPool: ['夕暮れの逆光を背負う丘', '残照に染まる高低差戦', '紫に暮れる稜線の撃ち合い'],
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// THREE非依存の純関数なHSL→#rrggbb変換。h は 0..360 へラップ、s/l は 0..1 クランプ。
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lum = clamp(l, 0, 1);

  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = lum - c / 2;
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// バイオームプロファイルから StagePalette を決定論的に生成する。
// 色はすべて hslToHex で #rrggbb。floorL/obstacleL のレンジ分離で可読性を担保。
export function generatePalette(rand: Rand, biome: Biome): StagePalette {
  const p = BIOME_PROFILES[biome];
  const hue = p.hueBase + range(rand, -p.hueSpread, p.hueSpread);
  const sat = range(rand, p.satRange[0], p.satRange[1]);
  const floorL = range(rand, p.floorL[0], p.floorL[1]);
  const obstacleL = range(rand, p.obstacleL[0], p.obstacleL[1]);
  const wallL = clamp(Math.min(floorL, obstacleL) - 0.07, 0.04, 0.96);
  const accentSat = clamp(p.satRange[1] + 0.4, 0, 1);
  const accentL = range(rand, 0.5, 0.62);
  const skyL = range(rand, p.skyL[0], p.skyL[1]);
  const skySat = clamp(sat * 0.7 + 0.05, 0, 1);
  const fogL = clamp(skyL * 0.96, 0, 1);

  const palette: StagePalette = {
    sky: hslToHex(p.skyHue, skySat, skyL),
    fog: hslToHex(p.skyHue, skySat, fogL),
    floor: hslToHex(hue, sat, floorL),
    wall: hslToHex(hue, sat * 0.85, wallL),
    obstacle: hslToHex(hue + 6, sat, obstacleL),
    accent: hslToHex(hue + p.accentHueShift, accentSat, accentL),
    lightColor: hslToHex(p.warmLight ? 38 : 214, 0.22, 0.88),
    lightIntensity: p.emissive ? range(rand, 0.6, 0.95) : range(rand, 1.2, 1.85),
    ambientIntensity: p.emissive ? range(rand, 0.35, 0.55) : range(rand, 0.7, 1.0),
    fogDensity: range(rand, p.fog[0], p.fog[1]),
    emissiveAccent: p.emissive,
    turbidity: range(rand, p.turbidity[0], p.turbidity[1]),
    rayleigh: range(rand, p.rayleigh[0], p.rayleigh[1]),
    mieCoefficient: range(rand, p.mie[0], p.mie[1]),
    elevation: range(rand, p.elevation[0], p.elevation[1]),
    azimuth: range(rand, 70, 290),
    exposure: range(rand, p.exposure[0], p.exposure[1]),
    environmentIntensity: range(rand, p.env[0], p.env[1]),
  };
  if (p.bloomStrength) {
    palette.bloomStrength = range(rand, p.bloomStrength[0], p.bloomStrength[1]);
  }
  return palette;
}

// シードからステージ定義を生成する。biome未指定時はシードから決める。
export function generateStageDef(seed: number, biome?: Biome): StageDef {
  const pr = mulberry32(seed ^ 0x5bf03635);
  // biome指定の有無に関わらず必ず1ドロー消費する。こうしないと指定有/無でRNG列が
  // ずれ、stageDefFromId(生成id) が元の生成と一致しなくなる(ラウンドトリップ破綻)
  const auto = BIOMES[Math.floor(pr() * BIOMES.length)] ?? 'urban';
  const b = biome ?? auto;
  const P = BIOME_PROFILES[b];
  const size = Math.round((56 + pr() * 22) / 2) * 2;
  const density = range(pr, P.densityPerSqM[0], P.densityPerSqM[1]);
  const obstacleCount = clamp(Math.round(size * size * density), 12, 40);
  const maxHeight = Math.round((3 + pr() * 2) * 10) / 10;
  const botCount = 4 + Math.floor(pr() * 5);
  const name = P.namePool[Math.floor(pr() * P.namePool.length)] ?? b;
  const subtitle = P.subPool[Math.floor(pr() * P.subPool.length)] ?? b;
  const palette = generatePalette(pr, b);
  return {
    id: `gen-${b}-${seed >>> 0}`,
    name,
    subtitle,
    seed,
    size,
    obstacleCount,
    maxHeight,
    botCount,
    palette,
  };
}

// `gen-<biome>-<seed>` 形式のidからステージ定義を復元する。不正なら null。
export function stageDefFromId(id: string): StageDef | null {
  const m = /^gen-([a-z]+)-(\d+)$/.exec(id);
  if (!m) return null;
  const b = m[1];
  const s = m[2];
  if (b === undefined || s === undefined) return null;
  if (!(BIOMES as readonly string[]).includes(b)) return null;
  return generateStageDef(Number(s), b as Biome);
}
