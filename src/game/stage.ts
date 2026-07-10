import { mulberry32, type Rand } from '../core/rng';

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

// ── 環境オブジェクト36種 ──────────────────────────────────────────────────
export type PropKind =
  | 'conifer' | 'broadleaf' | 'deadtree' | 'sakura' | 'bamboo'
  | 'rock' | 'towercrane' | 'portalkrane' | 'smokestack' | 'gastank'
  | 'watertower' | 'transformer' | 'antenna' | 'truck' | 'derelictcar'
  | 'forklift' | 'barricadecar' | 'concretebarrier' | 'fence' | 'watchpost'
  | 'tankhull' | 'scaffold' | 'streetlight' | 'signboard' | 'bench'
  | 'vendingmachine' | 'drumgroup' | 'pallet' | 'torii' | 'stonelantern'
  | 'well' | 'pier' | 'utilitypole' | 'rubble' | 'gasbottlegroup' | 'supplycrate';

/**
 * ミニシーン(超リアル化Layer C, R53-S2)のテンプレートID。
 * 各シーンは 2〜5 プロップの相対配置テンプレート(SCENE_TEMPLATES参照)を持ち、
 * シード決定論のアンカー位置+連続回転(シード回転)で配置される「物語性のある小場面」。
 */
export type MiniSceneId = 'shizai' | 'kenmon' | 'sandou' | 'jiko' | 'idobata' | 'kouba' | 'kyuukei';

export interface ObjectEntry {
  /** scatter='scene' の時は無視される(型都合上の代表prop。実際に置かれるkind群はsceneId側で決まる)。 */
  kind: PropKind;
  /** scatter='scene' の時は「シーンを何箇所配置するか」を表す。 */
  count: number;
  /**
   * 配置方式。'scene' はミニシーン(複数プロップの相対配置テンプレート)を count 回試行配置する。
   * scene 指定時は sceneId が必須(未設定ならそのエントリは無視される)。
   */
  scatter: 'random' | 'perimeter' | 'cluster' | 'scene';
  clusterRadius?: number;
  /** scatter='scene' の時のみ使用。ミニシーンテンプレートID(SCENE_TEMPLATES参照)。 */
  sceneId?: MiniSceneId;
}

/** ステージ個性レシピ。StageDef の任意フィールド。後方互換(未設定時は汎用配置) */
export interface StageRecipe {
  /** テーマ説明(1行) */
  theme: string;
  /** 配置する建造物アーキタイプ(1〜3棟) */
  buildings: BuildingKind[];
  notes?: string;
  /** 環境オブジェクト配置リスト(パイロット段階: DC+40箱/ステージ以内) */
  objects?: ObjectEntry[];
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
  /**
   * 破壊可能プロップ(BF5簡易版)。
   * ghost/decor/構造壁/床以外の小〜中型遮蔽プロップの約35%に決定論的に付与。
   * match.ts が個別メッシュ+コライダーを生成し HP0 で破壊演出+消滅を担う。
   */
  breakable?: { hp: number };
  structural?: boolean; // V31: 構造支持材(キャットウォーク支柱等)=絶対に破壊不可
  /** 環境オブジェクト由来のボックス。将来のマージ描画振り分け用マーカー */
  prop?: boolean;
  /** h > 3 の大型プロップに自動付与。シャドウキャスター対象フラグ */
  shadowCaster?: boolean;
}

export type SpawnPoint = [number, number, number];

/**
 * 環境プロップ1インスタンス分の「視覚配置」メタデータ(R53-S2 / M2c契約)。
 * コライダー生成(BoxSpec, buildProp() 経由)とは完全に独立した並行データ列だが、
 * generateStage() 内で同時に生成されるため常にboxesと同期している(座標系・インスタンス対応も同一)。
 *
 * ── M2c(match.ts オーナー)向け配線メモ ──────────────────────────────────
 * 1インスタンス = 1回の prop-visuals.buildPropVisual(kind, cx, cz, baseY=0, rotRad, scale, rand, palette)
 * 呼び出しに対応する。rand は呼び出し側(match.ts)が用意する決定論RNG(例: instance毎に
 * mulberry32(def.seed ^ index) 等)で構わない — 本フィールドはその「入力」だけを提供する。
 * kind が prop-visuals.PROP_VISUAL_KINDS に含まれない場合は、既存の箱ビジュアル
 * (buildProp() が生成した BoxSpec群、boxes 側にそのまま存在)へフォールバックすること。
 */
export interface PropPlacement {
  kind: PropKind;
  /** ワールドX座標(該当インスタンスの中心。boxesの対応ボックス群と同じ地上点)。 */
  cx: number;
  /** ワールドZ座標。 */
  cz: number;
  /**
   * ヨー回転(ラジアン, 0-2π に正規化済み)。**視覚専用**。
   * コライダー(buildProp() が使う 0-3 の90°刻み量子化回転)には一切影響しない
   * — colliderは従来どおり軸整列のボックスのまま。rotRad は量子化回転を基準に
   * ±0.45rad(約26°)の範囲でジッタさせた値(標準化ジッタ, R53-S2)。
   */
  rotRad: number;
  /** スケール倍率(1.0 ± 0.12 の一様ジッタ)。視覚専用 — コライダー寸法は不変。 */
  scaleJitter: number;
}

export interface StageLayout {
  boxes: BoxSpec[];
  playerSpawns: SpawnPoint[];
  botSpawns: SpawnPoint[];
  /**
   * 環境プロップの視覚配置一覧(R53-S2)。recipe.objects が無いステージでは空配列。
   * boxes とは独立した列だが同一の generateStage() 呼び出しから生成されるため常に同期する。
   */
  propPlacements: PropPlacement[];
}

export interface Aabb {
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
    // 支柱 × 6 (V31: structural=キャットウォークの支持材なので破壊不可)
    { ...pb(cx, cz, rot, -13, -11, 0, 1, 5, 1, c), structural: true },
    { ...pb(cx, cz, rot, 0, -11, 0, 1, 5, 1, c), structural: true },
    { ...pb(cx, cz, rot, +13, -11, 0, 1, 5, 1, c), structural: true },
    { ...pb(cx, cz, rot, -13, +11, 0, 1, 5, 1, c), structural: true },
    { ...pb(cx, cz, rot, 0, +11, 0, 1, 5, 1, c), structural: true },
    { ...pb(cx, cz, rot, +13, +11, 0, 1, 5, 1, c), structural: true },
    // ── キャットウォーク登坂階段(N壁内側沿い, 東端 lx+0→+14, 18段×0.3m蹴上) ──
    // 上面y=5.4m で catwalk 上面 y=5.5m まで autostep 0.1m の1ステップ
    ...buildStair(cx, cz, rot, +0.4, -14, 0.8, 0, 0, 0.8, 2, 18, c),
    // ── キャットウォーク登坂階段(S壁内側沿い, 西端 lx-0→-14, 18段×0.3m蹴上) ──
    // N側と左右対称。上面y=5.4m → catwalk 上面 y=5.5m autostep 0.1m で乗れる
    ...buildStair(cx, cz, rot, -0.4, +14, -0.8, 0, 0, 0.8, 2, 18, c),
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
    // 祭壇台座 + オブジェ (台座は structural=true: 破壊すると上部オブジェが浮くため)
    { ...pb(cx, cz, rot, +14, 0, 0, 8, 1.5, 6, c), structural: true },
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

// ── 環境プロップ フットプリント近似 [w, d] (クリアランス計算用) ────────────
const PROP_FOOTPRINTS: Record<PropKind, [number, number]> = {
  conifer: [3, 3], broadleaf: [5, 5], deadtree: [2, 2], sakura: [5, 5], bamboo: [2, 2],
  rock: [3, 3], towercrane: [13, 5], portalkrane: [11, 4], smokestack: [2.5, 2.5],
  gastank: [5, 5], watertower: [4.5, 4.5], transformer: [3, 2.5], antenna: [1.5, 1.5],
  truck: [8, 3.5], derelictcar: [3, 5], forklift: [2.5, 3], barricadecar: [5, 5],
  concretebarrier: [1.5, 3], fence: [5, 1], watchpost: [4, 4], tankhull: [5, 7],
  scaffold: [4, 3], streetlight: [1, 1], signboard: [3, 1], bench: [2, 1],
  vendingmachine: [1.2, 0.8], drumgroup: [2, 2], pallet: [1.5, 1.2], torii: [4.5, 1.5],
  stonelantern: [1, 1], well: [2, 2], pier: [7, 3], utilitypole: [1, 1],
  rubble: [3, 3], gasbottlegroup: [1.5, 1.5], supplycrate: [2, 2],
};

/**
 * 環境プロップ36種の BoxSpec 配列を生成する。
 * - 全ボックスに prop:true
 * - h > 3 のボックスに shadowCaster:true
 * - 幹=world / 樹冠=decor / 構造材=structural / 小物=通常(breakable自動付与対象)
 */
export function buildProp(
  kind: PropKind,
  cx: number,
  cz: number,
  rot: number,
  _rand: () => number,
  palette: StagePalette,
): BoxSpec[] {
  const c = palette.obstacle;
  const ac = palette.accent;
  const e = palette.emissiveAccent;
  const BROWN = '#5a3a1a';
  const D_GREEN = '#2a5220';
  const GREEN = '#3a7a2a';
  const PINK = '#e8b4c8';
  const BAMBOO = '#6a9a4a';
  const STONE = '#8a8278';

  function p(
    lx: number,
    lz: number,
    yBot: number,
    lw: number,
    lh: number,
    ld: number,
    color: string,
    emissive = false,
    opts: { decor?: boolean; structural?: boolean } = {},
  ): BoxSpec {
    const base = pb(cx, cz, rot, lx, lz, yBot, lw, lh, ld, color, emissive);
    const box: BoxSpec = { ...base, prop: true };
    if (lh > 3) box.shadowCaster = true;
    if (opts.decor) box.decor = true;
    if (opts.structural) box.structural = true;
    return box;
  }

  switch (kind) {
    case 'conifer':
      return [
        p(0, 0, 0, 0.5, 3.5, 0.5, BROWN),
        p(0, 0, 2, 2.5, 4, 2.5, D_GREEN, false, { decor: true }),
      ];
    case 'broadleaf':
      return [
        p(0, 0, 0, 0.5, 3.5, 0.5, BROWN),
        p(0, 0, 2.5, 4.5, 3, 4.5, GREEN, false, { decor: true }),
      ];
    case 'deadtree':
      return [
        p(0, 0, 0, 0.4, 4.5, 0.4, BROWN),
        p(1, 0, 3.5, 2, 0.3, 0.3, BROWN, false, { decor: true }),
        p(0, 0.8, 3, 0.3, 0.3, 1.5, BROWN, false, { decor: true }),
      ];
    case 'sakura':
      return [
        p(0, 0, 0, 0.5, 3.5, 0.5, BROWN),
        p(0, 0, 2.5, 4.5, 3, 4.5, PINK, false, { decor: true }),
      ];
    case 'bamboo':
      return [
        p(0, 0, 0, 0.2, 6, 0.2, BAMBOO),
        p(0.5, 0.3, 0, 0.2, 5, 0.2, BAMBOO),
        p(-0.4, 0.5, 0, 0.2, 5.5, 0.2, BAMBOO),
      ];
    case 'rock':
      return [p(0, 0, 0, 2.2, 1.4, 2.2, STONE)];
    case 'towercrane':
      return [
        p(0, 0, 0, 1, 18, 1, c, false, { structural: true }),
        p(5, 0, 17, 10, 0.6, 0.8, c, false, { structural: true }),
        p(-2.5, 0, 17, 5, 0.6, 0.8, c, false, { structural: true }),
      ];
    case 'portalkrane':
      return [
        p(-4, 0, 0, 1, 8, 1, c, false, { structural: true }),
        p(4, 0, 0, 1, 8, 1, c, false, { structural: true }),
        p(0, 0, 8, 9.5, 0.8, 1, c, false, { structural: true }),
      ];
    case 'smokestack':
      return [p(0, 0, 0, 1.5, 16, 1.5, c, false, { structural: true })];
    case 'gastank':
      return [
        p(0, 0, 0, 3, 2, 3, c, false, { structural: true }),
        p(0, 0, 2, 4, 3.5, 4, c, false, { structural: true }),
      ];
    case 'watertower':
      return [
        p(0, 0, 0, 1.5, 5, 1.5, c, false, { structural: true }),
        p(0, 0, 5, 3.5, 3, 3.5, c, false, { structural: true }),
      ];
    case 'transformer':
      return [
        p(0, 0, 0, 2, 1.5, 1.5, c),
        p(-0.6, 0, 1.5, 0.2, 2, 0.2, c),
        p(0.6, 0, 1.5, 0.2, 2, 0.2, c),
      ];
    case 'antenna':
      return [p(0, 0, 0, 0.3, 12, 0.3, c, false, { structural: true })];
    case 'truck':
      return [
        p(-2, 0, 0, 2, 2.5, 2.5, c),
        p(1.5, 0, 0, 5, 2.2, 2.5, c),
      ];
    case 'derelictcar':
      return [p(0, 0, 0, 2, 1.3, 4, c)];
    case 'forklift':
      return [
        p(0, 0, 0, 1.5, 2, 2, c),
        p(0, 1.2, 0, 1, 2.5, 0.3, c),
      ];
    case 'barricadecar':
      return [
        p(-1.5, 0, 0, 2, 1.2, 4, c),
        p(1.5, 0, 0, 2, 1.2, 4, c),
      ];
    case 'concretebarrier':
      return [p(0, 0, 0, 0.6, 1, 2.4, c)];
    case 'fence':
      return [p(0, 0, 0, 4, 1.5, 0.15, c)];
    case 'watchpost':
      return [
        p(0, 0, 0, 0.5, 4, 0.5, c, false, { structural: true }),
        p(0, 0, 4, 3, 0.3, 3, c, false, { structural: true }),
      ];
    case 'tankhull':
      return [
        p(0, 0, 0, 4, 1.5, 6, c),
        p(0, 0, 1.5, 2, 0.8, 2, c),
      ];
    case 'scaffold':
      return [
        p(-1.4, 0, 0, 0.15, 3.5, 0.15, c, false, { structural: true }),
        p(1.4, 0, 0, 0.15, 3.5, 0.15, c, false, { structural: true }),
        p(0, 0, 3.5, 3.2, 0.2, 2, c, false, { structural: true }),
      ];
    case 'streetlight':
      return [
        p(0, 0, 0, 0.15, 5, 0.15, c),
        p(0.4, 0, 4.8, 0.8, 0.2, 0.4, ac, e),
      ];
    case 'signboard':
      return [
        p(0, 0, 0, 0.15, 3.5, 0.15, c),
        p(0, 0, 2.8, 2.5, 1, 0.1, ac, e),
      ];
    case 'bench':
      return [p(0, 0, 0, 1.5, 0.45, 0.5, c)];
    case 'vendingmachine':
      return [p(0, 0, 0, 0.7, 1.8, 0.4, c, e)];
    case 'drumgroup':
      return [
        p(-0.5, 0, 0, 0.6, 0.9, 0.6, c),
        p(0.5, 0, 0, 0.6, 0.9, 0.6, c),
        p(0, 0.6, 0, 0.6, 0.9, 0.6, c),
      ];
    case 'pallet':
      return [p(0, 0, 0, 1.2, 0.15, 0.8, c)];
    case 'torii':
      return [
        p(-1.5, 0, 0, 0.4, 3.5, 0.4, c),
        p(1.5, 0, 0, 0.4, 3.5, 0.4, c),
        p(0, 0, 3.3, 3.6, 0.3, 0.4, c),
      ];
    case 'stonelantern':
      return [
        p(0, 0, 0, 0.5, 0.3, 0.5, STONE),
        p(0, 0, 0.3, 0.35, 0.7, 0.35, STONE),
        p(0, 0, 1, 0.6, 0.3, 0.6, STONE),
      ];
    case 'well':
      return [
        p(0, 0, 0, 1.5, 0.6, 1.5, STONE),
        p(0, 0, 0.6, 0.15, 1, 0.15, c),
      ];
    case 'pier':
      return [
        p(-2, 0, 0, 0.3, 0.6, 0.3, c),
        p(2, 0, 0, 0.3, 0.6, 0.3, c),
        p(0, 0, 0.6, 6, 0.3, 2, c),
      ];
    case 'utilitypole':
      return [
        p(0, 0, 0, 0.25, 8, 0.25, c),
        p(0, 0, 7, 2, 0.15, 0.15, c),
      ];
    case 'rubble':
      return [
        p(0, 0, 0, 2.2, 0.8, 2.2, c),
        p(0.3, 0.3, 0.8, 1.4, 0.6, 1.4, c),
      ];
    case 'gasbottlegroup':
      return [
        p(-0.4, 0, 0, 0.3, 1.0, 0.3, c),
        p(0.4, 0, 0, 0.3, 1.0, 0.3, c),
        p(0, 0.4, 0, 0.3, 1.0, 0.3, c),
      ];
    case 'supplycrate':
      return [
        p(0, 0, 0, 1, 0.8, 1, ac),
        p(0.1, 0.1, 0.8, 1, 0.8, 1, ac),
      ];
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return [];
    }
  }
}

// ── ミニシーン(超リアル化Layer C, R53-S2) ──────────────────────────────
// 複数プロップの相対配置テンプレート(座標はシーン中心=アンカーからのローカルオフセット、
// dRotSteps はテンプレ内の相対量子化回転)。generateThemeObjects が
// アンカー位置+シーン全体の連続回転(シード回転)を独立RNGで決定し、
// 各メンバーへ buildProp() を1回ずつ呼んでboxes/propPlacedへ積む。
interface SceneMember {
  kind: PropKind;
  /** シーンアンカーからのローカルXオフセット(m, シーン回転前)。 */
  dx: number;
  /** シーンアンカーからのローカルZオフセット(m, シーン回転前)。 */
  dz: number;
  /** シーン基準角に対する相対量子化回転(0-3, コライダー生成にのみ使用)。 */
  dRotSteps: number;
}

const SCENE_TEMPLATES: Record<MiniSceneId, readonly SceneMember[]> = {
  // 資材置場: パレット2+補給箱+傾いたドラム缶群
  shizai: [
    { kind: 'pallet', dx: -1.2, dz: 0, dRotSteps: 0 },
    { kind: 'pallet', dx: 1.2, dz: 0.3, dRotSteps: 1 },
    { kind: 'supplycrate', dx: 0, dz: -1.8, dRotSteps: 2 },
    { kind: 'drumgroup', dx: 2.0, dz: -1.0, dRotSteps: 0 },
  ],
  // 検問: バリケード車+コンクリバリア列+フェンス
  kenmon: [
    { kind: 'barricadecar', dx: 0, dz: 0, dRotSteps: 0 },
    { kind: 'concretebarrier', dx: -3.2, dz: -2.5, dRotSteps: 1 },
    { kind: 'concretebarrier', dx: -3.2, dz: 0.5, dRotSteps: 1 },
    { kind: 'fence', dx: -3.2, dz: 3.5, dRotSteps: 1 },
  ],
  // 参道: 鳥居+石灯籠対+ベンチ
  sandou: [
    { kind: 'torii', dx: 0, dz: 0, dRotSteps: 0 },
    { kind: 'stonelantern', dx: -2.5, dz: -3, dRotSteps: 0 },
    { kind: 'stonelantern', dx: 2.5, dz: -3, dRotSteps: 0 },
    { kind: 'bench', dx: 0, dz: -6, dRotSteps: 2 },
  ],
  // 車両事故: 放置車+トラック+瓦礫
  jiko: [
    { kind: 'derelictcar', dx: -2, dz: 1, dRotSteps: 1 },
    { kind: 'truck', dx: 2.5, dz: -1, dRotSteps: 3 },
    { kind: 'rubble', dx: 0, dz: -3, dRotSteps: 0 },
  ],
  // 井戸端: 井戸+ベンチ+広葉樹
  idobata: [
    { kind: 'well', dx: 0, dz: 0, dRotSteps: 0 },
    { kind: 'bench', dx: 2.2, dz: 0.5, dRotSteps: 1 },
    { kind: 'broadleaf', dx: -2.5, dz: -1.5, dRotSteps: 0 },
  ],
  // 工場一角: 変圧器+ドラム缶+ガスボンベ+フェンス
  kouba: [
    { kind: 'transformer', dx: 0, dz: 0, dRotSteps: 0 },
    { kind: 'drumgroup', dx: 2.2, dz: -0.5, dRotSteps: 1 },
    { kind: 'gasbottlegroup', dx: -2.0, dz: 1.0, dRotSteps: 2 },
    { kind: 'fence', dx: 0, dz: 2.8, dRotSteps: 0 },
  ],
  // 休憩所: ベンチ対+自販機+街灯
  kyuukei: [
    { kind: 'bench', dx: -1.8, dz: 0, dRotSteps: 0 },
    { kind: 'bench', dx: 1.8, dz: 0, dRotSteps: 2 },
    { kind: 'vendingmachine', dx: 0, dz: -1.6, dRotSteps: 0 },
    { kind: 'streetlight', dx: 0, dz: 1.8, dRotSteps: 0 },
  ],
};

/** テストや将来の拡張向けにミニシーンID一覧を列挙(prop-visuals.tsのPROP_VISUAL_KINDSと同じ流儀)。 */
export const MINI_SCENE_IDS: readonly MiniSceneId[] = Object.keys(SCENE_TEMPLATES) as MiniSceneId[];

/** 視覚ジッタの標準値(R53-S2): ヨーは量子化回転±ROT_JITTER、スケールは±SCALE_JITTERの一様分布。 */
const ROT_JITTER = 0.45; // rad(約26°)。量子化回転(0/90/180/270°)を軸に振れる範囲
// ★V-C修正: 細長プロップ(長辺/短辺>2)は±26°だと視覚端が軸整列コライダーから最大~1.3m
// はみ出す(弾すり抜け/見えない壁の体感リスク)。回転ジッタを±0.1rad(約6°)へ縮小する。
// 0.1 < π/4 なので量子化回転の復元(round&3)は引き続き一意
const ROT_JITTER_LONG = 0.1;
// ★W4A監査対応: 明示リストは portalkrane(2.75)/towercrane(2.6)/signboard(3.0)/torii(3.0) の
// 漏れを生んだため、PROP_FOOTPRINTS のアスペクト比(長辺/短辺>2)から構造的に導出する。
// 細長プロップは視覚回転が軸整列コライダーからはみ出しやすい(最大2.04m実測)ため±0.1radに抑える
const LONG_PROP_KINDS: ReadonlySet<string> = new Set(
  (Object.keys(PROP_FOOTPRINTS) as PropKind[]).filter((k) => {
    const [w, d] = PROP_FOOTPRINTS[k];
    return Math.max(w, d) / Math.min(w, d) > 2;
  }),
);
const SCALE_JITTER = 0.12; // ±12%

/** 任意の角度を [0, 2π) へ正規化する。 */
function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  return ((rad % twoPi) + twoPi) % twoPi;
}

/**
 * 量子化回転(0-3, 90°刻み)を基準に ±ROT_JITTER の視覚専用ヨーを引く。
 * コライダーは常にこの quantSteps のまま軸整列(rotRadは一切参照されない)。
 */
function jitterRotRad(quantSteps: number, visRand: Rand, kind?: string): number {
  // visRand は kind に依らず必ず1回消費(決定論ストリームの安定性維持)
  const amp = kind !== undefined && LONG_PROP_KINDS.has(kind) ? ROT_JITTER_LONG : ROT_JITTER;
  return normalizeAngle(quantSteps * (Math.PI / 2) + (visRand() * 2 - 1) * amp);
}

function jitterScale(visRand: Rand): number {
  return 1 + (visRand() * 2 - 1) * SCALE_JITTER;
}

/**
 * ミニシーン1箇所を試行配置する。アンカー位置+シーン全体の連続回転(sceneRot)を
 * visRand(独立RNG)で決め、テンプレのローカルオフセットを sceneRot で回転させて
 * 各メンバーのワールド座標を得る。全メンバーが境界内・クリアランスOKな試行が
 * 見つかるまで最大20回リトライ(既存の建造物/障害物配置と同じ方針)。
 * 失敗時は静かに諦める(シーンが1つ減るだけで既存配置には一切影響しない)。
 */
function tryPlaceScene(
  sceneId: MiniSceneId,
  def: StageDef,
  half: number,
  allSpawns: readonly [number, number][],
  buildingPlaced: Aabb[],
  propPlaced: Aabb[],
  boxes: BoxSpec[],
  visRand: Rand,
  placementsOut: PropPlacement[] | undefined,
): void {
  const template = SCENE_TEMPLATES[sceneId];
  const anchorMargin = 14; // 最遠オフセット(参道の-6m等)+プロップ半径を見込んだ安全マージン

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ax = Math.round(((visRand() * 2 - 1) * (half - anchorMargin)) / GRID) * GRID;
    const az = Math.round(((visRand() * 2 - 1) * (half - anchorMargin)) / GRID) * GRID;
    const sceneRot = visRand() * Math.PI * 2;
    const cos = Math.cos(sceneRot);
    const sin = Math.sin(sceneRot);

    const resolved: Array<{ kind: PropKind; px: number; pz: number; rotSteps: number }> = [];
    let ok = true;
    for (const member of template) {
      const px = ax + member.dx * cos - member.dz * sin;
      const pz = az + member.dx * sin + member.dz * cos;
      const fp = PROP_FOOTPRINTS[member.kind];

      if (Math.abs(px) + fp[0] / 2 > half - 3 || Math.abs(pz) + fp[1] / 2 > half - 3) {
        ok = false;
        break;
      }
      const nearSpawn = allSpawns.some(([sx, sz]) => Math.hypot(px - sx, pz - sz) < SPAWN_CLEARANCE);
      if (nearSpawn) {
        ok = false;
        break;
      }
      const propAabb = aabbOf(px, pz, fp[0] + 3, fp[1] + 3);
      if (buildingPlaced.some((b) => overlaps(b, propAabb, 0))) {
        ok = false;
        break;
      }
      const propFootAabb = aabbOf(px, pz, fp[0], fp[1]);
      if (propPlaced.some((b) => overlaps(b, propFootAabb, 1.5))) {
        ok = false;
        break;
      }
      // シーン内の既配置メンバー同士のクリアランス(テンプレ座標の想定内なら通常発生しない)
      if (resolved.some((r) => Math.hypot(r.px - px, r.pz - pz) < 1.5)) {
        ok = false;
        break;
      }

      const rotSteps = (Math.round(sceneRot / (Math.PI / 2)) + member.dRotSteps) & 3;
      resolved.push({ kind: member.kind, px, pz, rotSteps });
    }
    if (!ok || resolved.length === 0) continue;

    for (const r of resolved) {
      const propBoxes = buildProp(r.kind, r.px, r.pz, r.rotSteps, visRand, def.palette);
      boxes.push(...propBoxes);
      const fp = PROP_FOOTPRINTS[r.kind];
      propPlaced.push(aabbOf(r.px, r.pz, fp[0], fp[1]));
      if (placementsOut) {
        placementsOut.push({
          kind: r.kind,
          cx: r.px,
          cz: r.pz,
          rotRad: jitterRotRad(r.rotSteps, visRand, r.kind),
          scaleJitter: jitterScale(visRand),
        });
      }
    }
    return; // 配置成功
  }
  // 20回失敗 → このシーン箇所は諦める(既存の建造物配置と同じ方針。他配置は無傷)
}

/**
 * StageRecipe.objects に従い環境プロップを配置する。
 * 別シード(def.seed ^ 0x7e57ab1e)を使用→既存レイアウトRNG非汚染。
 * クリアランス: スポーン6m / 建造物AABB+2m / プロップ間1.5m
 *
 * placementsOut を渡すと、配置した全インスタンス(既存スキャッタ+ミニシーン共通)の
 * 視覚メタデータ(PropPlacement: kind/cx/cz/rotRad/scaleJitter)を追記する。
 * rotRad/scaleJitter は本関数内部で独立に導出した visRand(def.seedから派生する別の
 * mulberry32)でのみ消費するため、既存の rand(位置決定/量子化回転)の消費列には一切影響しない
 * — 既存ステージの配置結果(boxes)は placementsOut の有無に関わらず完全に同一。
 */
export function generateThemeObjects(
  def: StageDef,
  buildingPlaced: Aabb[],
  rand: () => number,
  placementsOut?: PropPlacement[],
): BoxSpec[] {
  const objects = def.recipe?.objects;
  if (!objects?.length) return [];

  const half = def.size / 2;
  const boxes: BoxSpec[] = [];
  const propPlaced: Aabb[] = [];
  // 視覚ジッタ+ミニシーン専用の独立RNG(既存rand非汚染)。def.seedから派生する固定シード。
  const visRand = mulberry32(def.seed ^ 0x9e3779b9);

  // 固定スポーン座標を決定論的に再現(rand消費なし)
  const edge = half - 4;
  const allSpawns: [number, number][] = [
    [edge, edge], [-edge, edge], [edge, -edge], [-edge, -edge],
    [0, edge], [0, -edge], [edge, 0], [-edge, 0],
    [edge / 2, -edge / 2], [-edge / 2, edge / 2],
  ];
  const extraCount = Math.max(0, def.botCount - 6);
  for (let i = 0; i < extraCount; i++) {
    const ang = (i / Math.max(1, extraCount)) * Math.PI * 2 + 0.3;
    const r = edge * 0.6;
    allSpawns.push([
      Math.round((Math.cos(ang) * r) / GRID) * GRID,
      Math.round((Math.sin(ang) * r) / GRID) * GRID,
    ]);
  }

  for (const entry of objects) {
    // ミニシーン(R53-S2): 独立RNG(visRand)のみを消費するため既存randの消費列は無傷。
    // count は「シーンを何箇所配置するか」。sceneId未設定のエントリは黙って無視する。
    if (entry.scatter === 'scene') {
      if (entry.sceneId) {
        for (let i = 0; i < entry.count; i += 1) {
          tryPlaceScene(entry.sceneId, def, half, allSpawns, buildingPlaced, propPlaced, boxes, visRand, placementsOut);
        }
      }
      continue;
    }

    const fp = PROP_FOOTPRINTS[entry.kind];

    // クラスター中心を1エントリにつき1回決定
    let clusterCx = 0;
    let clusterCz = 0;
    if (entry.scatter === 'cluster') {
      clusterCx = Math.round(((rand() * 2 - 1) * (half - 20)) / GRID) * GRID;
      clusterCz = Math.round(((rand() * 2 - 1) * (half - 20)) / GRID) * GRID;
    }

    for (let n = 0; n < entry.count; n++) {
      let placedOk = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        let px: number;
        let pz: number;

        if (entry.scatter === 'random') {
          px = Math.round(((rand() * 2 - 1) * (half - 10)) / GRID) * GRID;
          pz = Math.round(((rand() * 2 - 1) * (half - 10)) / GRID) * GRID;
        } else if (entry.scatter === 'perimeter') {
          const side = Math.floor(rand() * 4);
          const along = Math.round(((rand() * 2 - 1) * (half - 12)) / GRID) * GRID;
          const depth = Math.round((half - 8 - rand() * 12) / GRID) * GRID;
          switch (side) {
            case 0: px = along; pz = -depth; break;
            case 1: px = along; pz = depth; break;
            case 2: px = -depth; pz = along; break;
            default: px = depth; pz = along; break;
          }
        } else {
          // cluster
          const r = entry.clusterRadius ?? 10;
          px = Math.round((clusterCx + (rand() * 2 - 1) * r) / GRID) * GRID;
          pz = Math.round((clusterCz + (rand() * 2 - 1) * r) / GRID) * GRID;
          px = Math.max(-(half - 8), Math.min(half - 8, px));
          pz = Math.max(-(half - 8), Math.min(half - 8, pz));
        }

        // スポーンクリアランス
        const nearSpawn = allSpawns.some(([sx, sz]) => Math.hypot(px - sx, pz - sz) < SPAWN_CLEARANCE);
        if (nearSpawn) continue;

        // 建造物クリアランス
        const propAabb = aabbOf(px, pz, fp[0] + 3, fp[1] + 3);
        if (buildingPlaced.some((b) => overlaps(b, propAabb, 0))) continue;

        // プロップ間クリアランス(1.5m)
        const propFootAabb = aabbOf(px, pz, fp[0], fp[1]);
        if (propPlaced.some((b) => overlaps(b, propFootAabb, 1.5))) continue;

        const propRot = Math.floor(rand() * 4);
        const propBoxes = buildProp(entry.kind, px, pz, propRot, rand, def.palette);
        boxes.push(...propBoxes);
        propPlaced.push(aabbOf(px, pz, fp[0], fp[1]));
        placedOk = true;
        // 視覚ジッタ(R53-S2): visRandのみ消費(既存randの消費列に影響しない=既存配置ビット不変)
        if (placementsOut) {
          placementsOut.push({
            kind: entry.kind,
            cx: px,
            cz: pz,
            rotRad: jitterRotRad(propRot, visRand, entry.kind),
            scaleJitter: jitterScale(visRand),
          });
        }
        break;
      }
      void placedOk;
    }
  }

  return boxes;
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

  // ③.5 テーマ環境オブジェクト(別シード・既存レイアウトRNG非汚染)
  const propRand = mulberry32(def.seed ^ 0x7e57ab1e);
  const propPlacements: PropPlacement[] = [];
  boxes.push(...generateThemeObjects(def, placed, propRand, propPlacements));

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

  // ⑥ breakable 付与 ── 小〜中型遮蔽プロップの約35%に決定論的にHP付与する。
  // 別シード(def.seed ^ 0x1a2b3c4d)を使うことで既存レイアウトRNGに影響を与えない。
  // 除外基準: ghost / decor / 幅>8(構造壁) / h<0.8(床・屋根スラブ) / h>10(巨大柱)
  //           / 縦横アスペクト>5(細長い壁パネル)
  // HP: 120-260 の範囲で体積の平方根に比例(小さい箱は折れやすく、大きい箱は頑丈)。
  const breakRng = mulberry32(def.seed ^ 0x1a2b3c4d);
  for (const box of boxes) {
    if (box.ghost || box.decor || box.structural) continue;
    const maxXZ = Math.max(box.w, box.d);
    const minXZ = Math.min(box.w, box.d);
    if (maxXZ > 8 || box.h < 0.8 || box.h > 10) continue;
    if (minXZ > 0 && maxXZ / minXZ > 5) continue;
    if (breakRng() > 0.35) continue;
    const vol = box.w * box.h * box.d;
    box.breakable = { hp: Math.max(120, Math.min(260, Math.round(120 + Math.sqrt(vol) * 10))) };
  }

  return { boxes, playerSpawns: corners, botSpawns, propPlacements };
}
