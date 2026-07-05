import { mulberry32 } from '../core/rng';

// ── 映画的アトモスフィア(R11): THREE非依存の純型。render/atmosphere.ts と共有する ──
export type MoodId = 'day' | 'dusk' | 'night' | 'overcast' | 'snow';
export type GrassKind = 'none' | 'blade' | 'dry' | 'reed' | 'snowtuft';
// 'lava'(溶岩の火の粉/加算) と 'ash'(降灰/非加算) は ⑥ゾンビ荒廃ステージ用に追加。
// atmosphere.ts 側の PARTICLE_SPECS へ対応エントリを追加するまでは exhaustive Record が赤くなる(別担当対応)。
export type ParticleKind = 'none' | 'snow' | 'dust' | 'ember' | 'firefly' | 'lava' | 'ash';
export type SilhouetteKind = 'none' | 'mountain' | 'ridge' | 'skyline';

// カラーグレードのパラメータ束(表示前段の色収差/ビネット/グレイン/コントラスト/彩度/ティント)。
export interface GradeParams {
  tint: [number, number, number];
  contrast: number;
  saturation: number;
  vignette: number;
  vignetteR: number;
  grain: number;
  chroma: number;
}

export interface StagePalette {
  sky: string;
  fog: string;
  floor: string;
  wall: string;
  obstacle: string;
  accent: string;
  lightColor: string;
  lightIntensity: number;
  ambientIntensity: number;
  fogDensity: number;
  emissiveAccent: boolean;
  // ── リアル化(R5): 大気散乱/露出/Bloom。全optionalで既存パレットは無改変のままコンパイルできる ──
  turbidity?: number;
  rayleigh?: number;
  mieCoefficient?: number;
  mieDirectionalG?: number;
  elevation?: number;
  azimuth?: number;
  exposure?: number;
  environmentIntensity?: number;
  bloomStrength?: number;
  bloomThreshold?: number;
  // ── 映画的アトモスフィア(R11) ──
  mood?: MoodId;
  groundFog?: number;
  groundFogTop?: number;
  grassKind?: GrassKind;
  grassDensity?: number;
  particle?: ParticleKind;
  particleAmount?: number;
  silhouette?: SilhouetteKind;
  grade?: Partial<GradeParams>;
}

// ── 建造物アーキタイプ(R21 エリア超拡大) ──
/** stage.ts 内の buildXxx 関数が対応する 5 種のメガ建造物 */
export type BuildingKind = 'arena' | 'hangar' | 'tower' | 'warehouse' | 'cathedral';

/** ステージ個性レシピ。StageDef の任意フィールド。後方互換(未設定時は汎用配置) */
export interface StageRecipe {
  /** テーマ説明(1行) */
  theme: string;
  /** 配置する建造物アーキタイプ(1〜3棟) */
  buildings: BuildingKind[];
  notes?: string;
}

export interface StageDef {
  id: string;
  name: string;
  subtitle: string;
  seed: number;
  size: number;
  obstacleCount: number;
  maxHeight: number;
  botCount: number;
  palette: StagePalette;
  /** 任意: テーマ別レシピ(未設定なら汎用プロシージャル配置) */
  recipe?: StageRecipe;
}

export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  emissive: boolean;
  /**
   * true = 物理コライダーのみ生成・メッシュなし。
   * match.ts が isGhost フラグで scene.add をスキップ済み(R21 不可視境界壁)。
   */
  ghost?: boolean;
  /**
   * true = プレイアブル境界外の装飾ボックス。
   * 物理コライダーは存在するが ghost 壁の外側なので到達不可。
   * テスト・ミニマップのスポーン距離チェックでスキップ対象。
   */
  decor?: boolean;
}

export type SpawnPoint = [number, number, number];

export interface StageLayout {
  boxes: BoxSpec[];
  playerSpawns: SpawnPoint[];
  botSpawns: SpawnPoint[];
}

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function overlaps(a: Aabb, b: Aabb, margin: number): boolean {
  return (
    a.minX - margin < b.maxX &&
    a.maxX + margin > b.minX &&
    a.minZ - margin < b.maxZ &&
    a.maxZ + margin > b.minZ
  );
}

function aabbOf(x: number, z: number, w: number, d: number): Aabb {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

const SPAWN_CLEARANCE = 6;
/** 建造物センターからスポーンまでの最低距離 */
const BUILD_SPAWN_CLEAR = 14;
const GRID = 2;
/** 不可視境界壁の高さ(m)。ジャンプ/ウォールランでも越えられない */
const GHOST_WALL_H = 24;

// ── 建造物配置ヘルパー ──────────────────────────────────────────────────

/**
 * ローカルオフセット (dx, dz) を rotSteps × 90° 回転させる。
 * rotSteps=1: 90°CW, 2: 180°, 3: 270°CW
 */
function rotXZ(dx: number, dz: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [dz, -dx];
    case 2:
      return [-dx, -dz];
    case 3:
      return [-dz, dx];
    default:
      return [dx, dz];
  }
}

/**
 * 建造物ローカル座標 → ワールド BoxSpec。
 * @param cx,cz  ワールド建造物中心
 * @param rot    回転ステップ(0-3)
 * @param lx,lz  ローカルオフセット(回転前)
 * @param yBot   ボックスの底 Y 座標
 * @param lw,lh,ld ローカル幅(X軸)/高さ/奥行き(Z軸)。奇数回転時に w/d を入れ替え
 */
function pb(
  cx: number,
  cz: number,
  rot: number,
  lx: number,
  lz: number,
  yBot: number,
  lw: number,
  lh: number,
  ld: number,
  color: string,
  emissive = false,
): BoxSpec {
  const [rx, rz] = rotXZ(lx, lz, rot);
  const [fw, fd] = rot & 1 ? [ld, lw] : [lw, ld];
  return { x: cx + rx, y: yBot + lh / 2, z: cz + rz, w: fw, h: lh, d: fd, color, emissive };
}

/** 建造物の軸平行バウンディングボックスサイズ [w, d] を返す(AABB 重複チェック用) */
function getBuildingFootprint(kind: BuildingKind, rot: number): [number, number] {
  const dims: Record<BuildingKind, [number, number]> = {
    arena: [44, 30],
    hangar: [40, 22],
    tower: [22, 22],
    warehouse: [56, 14],
    cathedral: [36, 22],
  };
  const [lw, ld] = dims[kind];
  return rot & 1 ? [ld, lw] : [lw, ld];
}

// ── 建造物アーキタイプ実装 ─────────────────────────────────────────────

/**
 * 直階段ボックス列を生成するヘルパー。
 * @param cx,cz  ワールド建造物中心
 * @param rot    回転ステップ(0-3)
 * @param lxStart,lzStart ローカル開始座標(step 0 の中心)
 * @param lxStep,lzStep  各ステップごとのローカル移動量(どちらか一方が 0.8m)
 * @param yBotStart  最初の段の底 Y
 * @param lw,ld  各段の幅/奥行き(m)
 * @param steps  段数
 * @param color  マテリアル色
 * 蹴上は固定 0.3m(autostep 0.4m 未満)。
 */
function buildStair(
  cx: number,
  cz: number,
  rot: number,
  lxStart: number,
  lzStart: number,
  lxStep: number,
  lzStep: number,
  yBotStart: number,
  lw: number,
  ld: number,
  steps: number,
  color: string,
): BoxSpec[] {
  const result: BoxSpec[] = [];
  for (let i = 0; i < steps; i++) {
    result.push(
      pb(cx, cz, rot, lxStart + i * lxStep, lzStart + i * lzStep, yBotStart + i * 0.3, lw, 0.3, ld, color),
    );
  }
  return result;
}

/**
 * アリーナ/体育館 (44×30×10m)
 * 短辺2面に10m×5.5m 開口。2Fキャットウォーク + 支柱6本。
 */
function buildArena(cx: number, cz: number, rot: number, p: StagePalette): BoxSpec[] {
  const c = p.obstacle;
  const ac = p.accent;
  const e = p.emissiveAccent;
  return [
    pb(cx, cz, rot, 0, 0, -0.25, 44, 0.5, 30, c), // 床(上面 y=+0.25m → autostep0.4 で入場可)
    pb(cx, cz, rot, 0, -15, 0, 44, 10, 1, c), // N長辺壁
    pb(cx, cz, rot, 0, +15, 0, 44, 10, 1, c), // S長辺壁
    // W短辺壁: 左フランク/右フランク/まぐさ(開口 10m×5.5m)
    pb(cx, cz, rot, -22, -10, 0, 1, 10, 10, c),
    pb(cx, cz, rot, -22, +10, 0, 1, 10, 10, c),
    pb(cx, cz, rot, -22, 0, 5.5, 1, 4.5, 10, c),
    // E短辺壁
    pb(cx, cz, rot, +22, -10, 0, 1, 10, 10, c),
    pb(cx, cz, rot, +22, +10, 0, 1, 10, 10, c),
    pb(cx, cz, rot, +22, 0, 5.5, 1, 4.5, 10, c),
    pb(cx, cz, rot, 0, 0, 10, 44, 0.5, 30, c), // 屋根
    // 2F キャットウォーク (y=5)
    pb(cx, cz, rot, 0, -11, 5, 40, 0.5, 8, ac, e),
    pb(cx, cz, rot, 0, +11, 5, 40, 0.5, 8, ac, e),
    // 支柱 × 6
    pb(cx, cz, rot, -13, -11, 0, 1, 5, 1, c),
    pb(cx, cz, rot, 0, -11, 0, 1, 5, 1, c),
    pb(cx, cz, rot, +13, -11, 0, 1, 5, 1, c),
    pb(cx, cz, rot, -13, +11, 0, 1, 5, 1, c),
    pb(cx, cz, rot, 0, +11, 0, 1, 5, 1, c),
    pb(cx, cz, rot, +13, +11, 0, 1, 5, 1, c),
    // ── キャットウォーク登坂階段(N壁内側沿い, 東端 lx+0→+14, 18段×0.3m蹴上) ──
    // 上面y=5.4m で catwalk 上面 y=5.5m まで autostep 0.1m の1ステップ
    ...buildStair(cx, cz, rot, +0.4, -14, 0.8, 0, 0, 0.8, 2, 18, c),
  ];
}

/**
 * 格納庫 (40×22×10m)
 * 前面(W)全開口。奥にコンテナ積み5個。
 */
function buildHangar(cx: number, cz: number, rot: number, p: StagePalette): BoxSpec[] {
  const c = p.obstacle;
  return [
    pb(cx, cz, rot, 0, 0, -0.25, 40, 0.5, 22, c), // 床(上面 y=+0.25m → autostep0.4 で入場可)
    pb(cx, cz, rot, +20, 0, 0, 1, 10, 22, c), // バック壁
    pb(cx, cz, rot, 0, -11, 0, 40, 10, 1, c), // N壁
    pb(cx, cz, rot, 0, +11, 0, 40, 10, 1, c), // S壁
    pb(cx, cz, rot, 0, 0, 10, 40, 0.5, 22, c), // 屋根
    // コンテナ群
    pb(cx, cz, rot, +10, -4, 0, 5, 4, 5, c),
    pb(cx, cz, rot, +10, -4, 4, 5, 4, 5, c),
    pb(cx, cz, rot, +10, +4, 0, 5, 4, 5, c),
    pb(cx, cz, rot, +10, +4, 4, 5, 3, 5, c),
    pb(cx, cz, rot, +2, -4, 0, 5, 4, 5, c),
  ];
}

/**
 * 多層タワー (22×22×16m, 3フロア + コーナーピラー)
 * 4隅ピラーに挟まれたオープンフロア構造。
 * 地上から各フロアは BO3 移動(ジャンプ+マントル)でアクセス可能。
 */
function buildTower(cx: number, cz: number, rot: number, p: StagePalette): BoxSpec[] {
  const c = p.obstacle;
  const ac = p.accent;
  const e = p.emissiveAccent;
  return [
    // フロアスラブ (G/1F/2F)
    pb(cx, cz, rot, 0, 0, -0.25, 16, 0.5, 16, c), // G床(上面 y=+0.25m → autostep0.4 で入場可)
    pb(cx, cz, rot, 0, 0, 6, 16, 0.5, 16, ac, e),
    pb(cx, cz, rot, 0, 0, 12, 16, 0.5, 16, c),
    // 4隅コーナーピラー (高さ16m)
    pb(cx, cz, rot, -7, -7, 0, 2, 16, 2, c),
    pb(cx, cz, rot, +7, -7, 0, 2, 16, 2, c),
    pb(cx, cz, rot, -7, +7, 0, 2, 16, 2, c),
    pb(cx, cz, rot, +7, +7, 0, 2, 16, 2, c),
    // N/S 低遮蔽バリア × 各2段 (プレイヤーが伏せて隠れる)
    pb(cx, cz, rot, 0, -7.5, 0.5, 12, 1, 1, c),
    pb(cx, cz, rot, 0, +7.5, 0.5, 12, 1, 1, c),
    pb(cx, cz, rot, 0, -7.5, 6.5, 12, 1, 1, c),
    pb(cx, cz, rot, 0, +7.5, 6.5, 12, 1, 1, c),
    // ── 登坂階段 A: 東外周, G→1F (y=0→6.5m, 21段×0.3m蹴上) ──
    // 上面y=6.3m で 1F 上面 y=6.5m まで autostep 0.2m の1ステップ
    ...buildStair(cx, cz, rot, +9, +6.6, 0, -0.8, 0, 2, 0.8, 21, c),
    // ── 登坂階段 B: 西外周, 1F→2F (y=6.2→12.5m, 21段×0.3m蹴上) ──
    // yBotStart=6.2 → step0 上面=6.5m(1F床面合わせ), step20 上面=12.5m(2F床面ちょうど)
    ...buildStair(cx, cz, rot, -9, +6.6, 0, -0.8, 6.2, 2, 0.8, 21, c),
  ];
}

/**
 * 倉庫街ブロック (56×14×7m × 2連 + 貫通通路)
 * 建物 A(lx=-14) + 建物 B(lx=+14) + 中央通路。
 * 両端面は開口(入退場自由)。通路幅 4m × 高 7m。
 */
function buildWarehouse(cx: number, cz: number, rot: number, p: StagePalette): BoxSpec[] {
  const c = p.obstacle;
  return [
    // 倉庫 A (lx=-14 中心, 24m長×12m幅×7m高)
    pb(cx, cz, rot, -14, -6, 0, 24, 7, 1, c),
    pb(cx, cz, rot, -14, +6, 0, 24, 7, 1, c),
    pb(cx, cz, rot, -26, 0, 0, 1, 7, 12, c), // A 奥端壁
    pb(cx, cz, rot, -14, 0, 7, 24, 0.5, 12, c), // A 屋根
    // 倉庫 B (lx=+14 中心)
    pb(cx, cz, rot, +14, -6, 0, 24, 7, 1, c),
    pb(cx, cz, rot, +14, +6, 0, 24, 7, 1, c),
    pb(cx, cz, rot, +26, 0, 0, 1, 7, 12, c),
    pb(cx, cz, rot, +14, 0, 7, 24, 0.5, 12, c),
    // 貫通通路 (A-B 間, 4m幅)
    pb(cx, cz, rot, 0, -2.5, 0, 6, 3, 1, c),
    pb(cx, cz, rot, 0, +2.5, 0, 6, 3, 1, c),
    pb(cx, cz, rot, 0, 0, 3, 6, 0.5, 5, c),
    // 内部シェルフ(遮蔽)
    pb(cx, cz, rot, -18, -3, 0, 4, 3, 3, c),
    pb(cx, cz, rot, -10, +3, 0, 4, 3, 3, c),
    pb(cx, cz, rot, +18, -3, 0, 4, 3, 3, c),
    pb(cx, cz, rot, +10, +3, 0, 4, 3, 3, c),
  ];
}

/**
 * 神殿/大聖堂ホール (36×22×14m)
 * 両端に 8m×10m 開口。列柱 8 本 + 祭壇。
 */
function buildCathedral(cx: number, cz: number, rot: number, p: StagePalette): BoxSpec[] {
  const c = p.obstacle;
  const ac = p.accent;
  const e = p.emissiveAccent;
  return [
    pb(cx, cz, rot, 0, 0, -0.25, 36, 0.5, 22, c), // 床(上面 y=+0.25m → autostep0.4 で入場可)
    pb(cx, cz, rot, 0, -11, 0, 36, 14, 1, c), // N長辺壁
    pb(cx, cz, rot, 0, +11, 0, 36, 14, 1, c), // S長辺壁
    // W短辺壁 (開口 8m×10m)
    pb(cx, cz, rot, -18, -7.5, 0, 1, 14, 7, c),
    pb(cx, cz, rot, -18, +7.5, 0, 1, 14, 7, c),
    pb(cx, cz, rot, -18, 0, 10, 1, 4, 8, c),
    // E短辺壁 (同)
    pb(cx, cz, rot, +18, -7.5, 0, 1, 14, 7, c),
    pb(cx, cz, rot, +18, +7.5, 0, 1, 14, 7, c),
    pb(cx, cz, rot, +18, 0, 10, 1, 4, 8, c),
    pb(cx, cz, rot, 0, 0, 14, 36, 0.5, 22, c), // 屋根
    // 列柱 4 ペア (N/S, y=0-12)
    pb(cx, cz, rot, -10, -7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, -10, +7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, -3, -7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, -3, +7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, +4, -7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, +4, +7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, +11, -7, 0, 2, 12, 2, ac, e),
    pb(cx, cz, rot, +11, +7, 0, 2, 12, 2, ac, e),
    // 祭壇台座 + オブジェ
    pb(cx, cz, rot, +14, 0, 0, 8, 1.5, 6, c),
    pb(cx, cz, rot, +14, 0, 1.5, 2, 3, 2, ac, e),
  ];
}

/** 建造物の BoxSpec 配列を生成するディスパッチャー */
function generateBuilding(
  kind: BuildingKind,
  cx: number,
  cz: number,
  rot: number,
  p: StagePalette,
): BoxSpec[] {
  switch (kind) {
    case 'arena':
      return buildArena(cx, cz, rot, p);
    case 'hangar':
      return buildHangar(cx, cz, rot, p);
    case 'tower':
      return buildTower(cx, cz, rot, p);
    case 'warehouse':
      return buildWarehouse(cx, cz, rot, p);
    case 'cathedral':
      return buildCathedral(cx, cz, rot, p);
  }
}

// ── 遠景シルエット(プレイアブル境界外の装飾) ────────────────────────────

function generateSilhouette(
  def: StageDef,
  half: number,
  rand: () => number,
): BoxSpec[] {
  const sil = def.palette.silhouette ?? 'none';
  if (sil === 'none') return [];
  const boxes: BoxSpec[] = [];
  // シルエット帯: half の 2.5〜2.86 倍の距離に配置(= camera.far 調整は統合担当)
  const outerR = half * 2.5;
  const col = def.palette.obstacle;

  if (sil === 'skyline') {
    const count = 6 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = outerR + rand() * half * 0.36;
      const sx = Math.cos(ang) * dist;
      const sz = Math.sin(ang) * dist;
      const sw = 12 + rand() * 28;
      const sh = 18 + rand() * 50;
      const sd = 4 + rand() * 4;
      boxes.push({ x: sx, y: sh / 2, z: sz, w: sw, h: sh, d: sd, color: col, emissive: false, decor: true });
    }
  } else if (sil === 'mountain') {
    const count = 4 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rand() * 0.5;
      const dist = outerR + rand() * half * 0.36;
      const sx = Math.cos(ang) * dist;
      const sz = Math.sin(ang) * dist;
      const baseW = 50 + rand() * 60;
      const baseH = 20 + rand() * 30;
      const midW = baseW * 0.55;
      const midH = baseH * 0.45;
      boxes.push({ x: sx, y: baseH / 2, z: sz, w: baseW, h: baseH, d: 8, color: col, emissive: false, decor: true });
      boxes.push({ x: sx, y: baseH + midH / 2, z: sz, w: midW, h: midH, d: 6, color: col, emissive: false, decor: true });
    }
  } else if (sil === 'ridge') {
    const count = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rand() * 0.3;
      const dist = outerR + rand() * half * 0.36;
      const sx = Math.cos(ang) * dist;
      const sz = Math.sin(ang) * dist;
      const length = 90 + rand() * 70;
      const height = 10 + rand() * 22;
      // 尾根は放射方向に対して直交して配置
      const useZ = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang));
      const sw = useZ ? 6 : length;
      const sd = useZ ? length : 6;
      boxes.push({ x: sx, y: height / 2, z: sz, w: sw, h: height, d: sd, color: col, emissive: false, decor: true });
    }
  }

  return boxes;
}

// ── 拡張視覚地形(境界外の装飾床, 4 ストリップ) ────────────────────────

function generateExtendedTerrain(def: StageDef, half: number): BoxSpec[] {
  const ext = Math.round(half * 0.65);
  const h = 0.3;
  const c = def.palette.floor;
  const fullW = def.size + ext * 2;
  return [
    { x: 0, y: h / 2, z: -(half + ext / 2), w: fullW, h, d: ext, color: c, emissive: false, decor: true },
    { x: 0, y: h / 2, z: half + ext / 2, w: fullW, h, d: ext, color: c, emissive: false, decor: true },
    { x: -(half + ext / 2), y: h / 2, z: 0, w: ext, h, d: def.size, color: c, emissive: false, decor: true },
    { x: half + ext / 2, y: h / 2, z: 0, w: ext, h, d: def.size, color: c, emissive: false, decor: true },
  ];
}

// シードから決定論的にレイアウトを生成する。障害物は原点対称に複製し、
// 対戦時にどのスポーンからも地形条件が同じになるようにする。
export function generateStage(def: StageDef): StageLayout {
  const rand = mulberry32(def.seed);
  const half = def.size / 2;
  const boxes: BoxSpec[] = [];

  // ① 不可視境界コライダーリング (ghost walls)
  // 高さ GHOST_WALL_H=24m の透明壁。コライダーのみ生成(match.ts が isGhost でスキップ)。
  for (const [x, z, w, d] of [
    [0, -(half + 0.5), def.size + 2, 1],
    [0, half + 0.5, def.size + 2, 1],
    [-(half + 0.5), 0, 1, def.size + 2],
    [half + 0.5, 0, 1, def.size + 2],
  ] as [number, number, number, number][]) {
    boxes.push({
      x,
      y: GHOST_WALL_H / 2,
      z,
      w,
      h: GHOST_WALL_H,
      d,
      color: def.palette.wall,
      emissive: false,
      ghost: true,
    });
  }

  // ② スポーン配置
  const edge = half - 4;
  const corners: SpawnPoint[] = [
    [edge, 0, edge],
    [-edge, 0, edge],
    [edge, 0, -edge],
    [-edge, 0, -edge],
  ];
  const botSpawns: SpawnPoint[] = [
    [0, 0, edge],
    [0, 0, -edge],
    [edge, 0, 0],
    [-edge, 0, 0],
    [edge / 2, 0, -edge / 2],
    [-edge / 2, 0, edge / 2],
  ];
  const baseCount = botSpawns.length; // 6
  const extra = Math.max(0, def.botCount - baseCount);
  for (let i = 0; i < extra; i += 1) {
    const ang = (i / Math.max(1, extra)) * Math.PI * 2 + 0.3;
    const r = edge * 0.6;
    botSpawns.push([
      Math.round((Math.cos(ang) * r) / GRID) * GRID,
      0,
      Math.round((Math.sin(ang) * r) / GRID) * GRID,
    ]);
  }
  const spawnGuards: SpawnPoint[] = [...corners, ...botSpawns];

  // ③ 建造物の配置 (recipe 指定時)
  // 建造物 AABB は placed にも追加し、後続の障害物が重ならないようにする。
  const placed: Aabb[] = [];
  let numPlaced = 0; // 障害物の配置数カウント(建造物は含まない)

  if (def.recipe) {
    for (const bk of def.recipe.buildings) {
      const [bfpW, bfpD] = getBuildingFootprint(bk, 0); // worst case for clearance
      const maxFootprintHalf = Math.max(bfpW, bfpD) / 2 + 4;

      let placed_ok = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const bx = Math.round(((rand() * 2 - 1) * half * 0.48) / GRID) * GRID;
        const bz = Math.round(((rand() * 2 - 1) * half * 0.48) / GRID) * GRID;
        const rot = Math.floor(rand() * 4);
        const [fpW, fpD] = getBuildingFootprint(bk, rot);

        // 境界内チェック (フットプリント全体が half-3 以内)
        if (Math.abs(bx) + fpW / 2 > half - 3 || Math.abs(bz) + fpD / 2 > half - 3) continue;

        const bAabb = aabbOf(bx, bz, fpW + 6, fpD + 6);

        // スポーン近接チェック
        const nearSpawn = spawnGuards.some(
          ([sx, , sz]) => Math.hypot(bx - sx, bz - sz) < BUILD_SPAWN_CLEAR + maxFootprintHalf,
        );
        if (nearSpawn) continue;

        // 他建造物との重複チェック
        if (placed.some((p) => overlaps(p, bAabb, 0))) continue;

        // 配置成功
        const buildBoxes = generateBuilding(bk, bx, bz, rot, def.palette);
        boxes.push(...buildBoxes);
        placed.push(aabbOf(bx, bz, fpW, fpD));
        placed_ok = true;
        break;
      }
      // 配置失敗時はスキップ(30回試行で見つからなければ建造物なし)
      void placed_ok;
    }
  }

  // ④ 拡張視覚地形 + 遠景シルエット(decor = 境界外装飾)
  boxes.push(...generateExtendedTerrain(def, half));
  boxes.push(...generateSilhouette(def, half, rand));

  // ⑤ ランダム障害物 (原点対称複製)
  let attempts = 0;
  while (numPlaced < def.obstacleCount && attempts < def.obstacleCount * 30) {
    attempts += 1;
    const x = Math.round(((rand() * 2 - 1) * (half - 5)) / GRID) * GRID;
    const z = Math.round(((rand() * 2 - 1) * (half - 5)) / GRID) * GRID;
    const w = Math.round(2 + rand() * 6);
    const d = Math.round(2 + rand() * 6);
    const low = rand() < 0.3;
    const h = low ? 1 + rand() * 0.3 : 1.8 + rand() * (def.maxHeight - 1.8);

    const nearSpawn = spawnGuards.some(
      ([sx, , sz]) => Math.hypot(x - sx, z - sz) < SPAWN_CLEARANCE,
    );
    if (nearSpawn) continue;

    const box = aabbOf(x, z, w, d);
    if (placed.some((p) => overlaps(p, box, 1))) continue;

    const accent = rand() < 0.18;
    const color = accent ? def.palette.accent : def.palette.obstacle;
    boxes.push({ x, y: h / 2, z, w, h, d, color, emissive: accent && def.palette.emissiveAccent });
    placed.push(box);
    numPlaced += 1;

    // 原点対称複製
    const mirror = aabbOf(-x, -z, w, d);
    const mirrorNearSpawn = spawnGuards.some(
      ([sx, , sz]) => Math.hypot(-x - sx, -z - sz) < SPAWN_CLEARANCE,
    );
    if ((x !== 0 || z !== 0) && !mirrorNearSpawn && !placed.some((p) => overlaps(p, mirror, 1))) {
      boxes.push({
        x: -x,
        y: h / 2,
        z: -z,
        w,
        h,
        d,
        color,
        emissive: accent && def.palette.emissiveAccent,
      });
      placed.push(mirror);
      numPlaced += 1;
    }
  }

  return { boxes, playerSpawns: corners, botSpawns };
}
