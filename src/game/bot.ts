import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrapAngle } from './aimassist';
import type { Rand } from '../core/rng';
import { applyGravityStep } from './player';

// 胴体カプセルは首までの高さに留め、頭の判定球をカプセルの外に出す。
// 全身を覆うカプセルにすると水平レイが常に胴体へ先に当たり、
// ヘッドショットが成立しなくなる。頭頂は足元から1.9mでプレイヤーと同じ。
const BODY_HALF = 0.45;
const BODY_RADIUS = 0.35;
const CENTER_TO_FEET = BODY_HALF + BODY_RADIUS;
const HEAD_OFFSET = 0.88;
const HEAD_RADIUS = 0.22;
const MOVE_SPEED = 3.4;
// BOTの既定HP。プレイヤー武器の one-shot(満タン即死)メダル判定の基準値であり、
// 各 BotTuning.maxHp の既定でもある(実際の判定はインスタンスの bot.maxHp を見る)
export const BOT_MAX_HP = 100;

// カプセル中心からこの高さより下への着弾は脚部扱い
export const HIP_OFFSET_Y = -0.1;

// ── kind別の体格・挙動定数(コライダーと見た目を一致させる単一の真実)──
// drone: 浮遊球+頂部センサードーム(弱点)。CENTER_TO_FEET相当は0
const DRONE_BODY_RADIUS = 0.55;
const DRONE_HEAD_RADIUS = 0.2;
const DRONE_HEAD_OFFSET = 0.45;
const DRONE_HOVER_ALT = 2.2; // スポーン高からのホバー基準高度
const DRONE_BOB_AMP = 0.35; // ホバーの上下ボブ振幅
const DRONE_BOB_HZ = 0.9;
const DRONE_VERT_SPEED = 4; // 高度追従の上限速度(m/s)。スポーン直後は離陸になる
const DRONE_ENGAGE_FAR = 24; // これより遠いと接近
const DRONE_ENGAGE_NEAR = 12; // これより近いと離脱
// tank: 大型車体cuboid+砲塔後部エンジングリル球(背面弱点)
const TANK_HALF_W = 1.6;
const TANK_HALF_H = 0.7;
const TANK_HALF_L = 2.2;
const TANK_HEAD_RADIUS = 0.35;
const TANK_HEAD_Y = 1.0;
const TANK_HEAD_Z = 0.9; // +z=背面(facingは-z)
const TANK_TURN_RATE = 0.7; // 車体旋回の上限(rad/s)=側面へ回り込む攻略の物理的根拠
const TANK_TURRET_RATE = 1.6; // 砲塔旋回(rad/s)。車体より速く、先に照準が付く
// turret: 固定砲台。カプセル筐体+頂部センサードーム(弱点)
const TURRET_BODY_HALF = 0.5;
const TURRET_BODY_RADIUS = 0.4;
const TURRET_HEAD_RADIUS = 0.25;
const TURRET_HEAD_OFFSET = 0.7;
const TURRET_TRACK_RATE = 2.4; // 追尾旋回(rad/s)
const TURRET_SWEEP_RATE = 0.9; // 非交戦時の首振り(rad/s)
// tank/turretは砲身が目標へ向くまで発砲を保留する角度。旋回上限を
// 「側面へ回れば撃たれない」という実際の攻略窓にする(設計検証のfix反映)
const AIM_GATE_RAD = 0.22;
// humanoid/drone: 機械的slew aimDir がこの角度内に収束するまで発砲を保留する
// (≈0.10rad/5.7°。初弾がピクセルパーフェクトにならず、動く標的では追従遅れで外す)
const AIM_FIRE_COS = Math.cos(0.1);
// ゾンビ近接。個体クールダウン(match側でグローバルrate-limit + i-frameを重ねる)
const ZOMBIE_MELEE_RANGE = 2.3;
const ZOMBIE_MELEE_CD = 1.1;
// ── ゾンビ登坂アシスト(箱/瓦礫/低い壁へゆっくり這い上がる)──
// autostep(0.75m)を越える障害物に前進を阻まれたら、重力の代わりに上向き速度を
// 与えて乗り上がる。安全弁: 前方レイで実体を確認し、開始足元Yからの上限高さで
// 青天井を防ぎ、水平が通れば自然に登坂終了→重力で着地する。ゾンビ専用。
const ZOMBIE_CLIMB_SPEED = 1.6; // 登坂中の上向き速度(m/s)。ゆっくり這い上がる
const ZOMBIE_CLIMB_MAX_H = 2.4; // 開始足元Yから越えられる最大高さ(m)。これ以上の壁は登らない
const ZOMBIE_CLIMB_COOLDOWN = 1.2; // 上限まで登っても越えられない壁で登坂を封じる時間(2.4m浮遊バウンド防止)
const ZOMBIE_CLIMB_PROBE = 0.7; // 前方の障害物検出レイ長(m)。カプセル半径(0.35)+余白
const ZOMBIE_CLIMB_BLOCK = 0.4; // moved/wish がこれ未満なら「前進を阻まれた」と判定
const ZOMBIE_CLIMB_RAY_YS = [-0.4, 0.1] as const; // 前方レイの高さ(体中心基準=膝〜胸)
// R21修正: 登坂フェーズ化で縁チャタリングを根治。最小継続時間でblocked解消≠乗り上げ完了の
// 誤終了を防ぎ、最大継続時間で無限上昇の安全弁を維持する。
const ZOMBIE_CLIMB_MIN_S = 0.4; // 登坂の最小継続時間(縁でblocked解消しても乗り上げまで続ける)
const ZOMBIE_CLIMB_MAX_S = 2.5; // 登坂の最大継続時間(それ以上は必ず打ち切り)
// humanoid アンスタック(R21新規)
const HUMANOID_STUCK_TH = 0.8;  // 前進不能がこの秒数続いたらアンスタック発動
const HUMANOID_UNSTUCK_S = 0.6; // 横ステア/heading転換のラッチ時間
const HUMANOID_PROBE_D = 0.9;   // アンスタック用サイドレイ長(m)
const TANK_SMOKE_OPACITY = 0.85;

export type Difficulty = 'easy' | 'normal' | 'hard';
// 敵の階層。normal=通常兵、elite=精鋭(高HP/俊敏)、boss=章末の超強敵
export type BotTier = 'normal' | 'elite' | 'boss';
// 敵のアーキタイプ。humanoid=従来の人型、drone=飛行、tank=大型戦車、turret=固定砲台、
// zombie=BO2式ラウンド制の近接群れ(銃無し・前傾シャンブル)
export type BotKind = 'humanoid' | 'drone' | 'tank' | 'turret' | 'zombie';

export interface BotTuning {
  spreadDeg: number;
  reactionS: number;
  damage: number;
  burstPauseMin: number;
  burstPauseMax: number;
  // ── R6: 階層/個体差 ──
  maxHp: number;
  moveSpeedMul: number; // 基準移動速度への倍率
  scale: number; // 見た目スケール(当たり判定との乖離を避けるため原則1)
  headOffset: number; // 頭コライダー/頭位置の高さ
  viewDistM: number; // 索敵可能距離(m)
  // ── R16: spot-time 知覚 + 機械的エイム(matchのperceive/updateShootingが参照)──
  // 静止プレイヤーを中心視野で発見するまでの基準秒。moveFactor/cone/距離/霧で実効速度が変わる
  spotTimeS: number;
  // 照準(aimDir)を目標へ寄せる角速度(rad/s)。小さいほど初弾が甘く追従が遅れる=機械的
  aimSlewRadS: number;
}

export const DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { spreadDeg: 5.5, reactionS: 0.6, damage: 8, burstPauseMin: 1.0, burstPauseMax: 1.6, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 55, spotTimeS: 1.8, aimSlewRadS: 2.6 },
  normal: { spreadDeg: 3.2, reactionS: 0.38, damage: 11, burstPauseMin: 0.7, burstPauseMax: 1.2, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 60, spotTimeS: 1.1, aimSlewRadS: 4.2 },
  hard: { spreadDeg: 1.9, reactionS: 0.22, damage: 14, burstPauseMin: 0.5, burstPauseMax: 0.9, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 68, spotTimeS: 0.6, aimSlewRadS: 6.3 },
};

// 階層ごとの上書き差分。base(難度)へスプレッドして合成する。
// scale は hitreg(当たり判定とのズレ)回避のため拡大せず、威圧は色/発光で表現する。
export const ELITE_TUNING: Partial<BotTuning> = {
  maxHp: 180,
  moveSpeedMul: 1.15,
  reactionS: 0.2,
  spreadDeg: 1.8,
  damage: 15,
  viewDistM: 75,
  spotTimeS: 0.45,
  aimSlewRadS: 7.0,
};
export const BOSS_TUNING: Partial<BotTuning> = {
  maxHp: 900,
  moveSpeedMul: 0.92,
  reactionS: 0.16,
  spreadDeg: 1.5,
  damage: 18,
  scale: 1,
  viewDistM: 90,
  burstPauseMin: 0.35,
  burstPauseMax: 0.7,
  spotTimeS: 0.3,
  aimSlewRadS: 8.5,
};

// 難度×階層から実効 BotTuning を合成する(単一の真実)。base配列を破壊しない新オブジェクト。
export function tuningFor(tier: BotTier, difficulty: Difficulty): BotTuning {
  const base = DIFFICULTY[difficulty];
  if (tier === 'boss') return { ...base, ...BOSS_TUNING };
  if (tier === 'elite') return { ...base, ...ELITE_TUNING };
  return { ...base };
}

// アーキタイプごとの上書き差分。match側が tuningFor(tier, difficulty) の結果へ
// さらにスプレッドして合成する想定(ELITE/BOSS_TUNINGと同じ流儀)。
export const KIND_TUNING: Record<BotKind, Partial<BotTuning>> = {
  humanoid: {},
  drone: { maxHp: 60, moveSpeedMul: 1.4, viewDistM: 70, spotTimeS: 0.4 },
  tank: {
    maxHp: 2200,
    damage: 26,
    moveSpeedMul: 0.45,
    viewDistM: 90,
    reactionS: 0.5,
    burstPauseMin: 1.6,
    burstPauseMax: 2.4,
    spotTimeS: 0.4,
    aimSlewRadS: 1.4,
  },
  turret: { maxHp: 160, moveSpeedMul: 0, viewDistM: 65, spotTimeS: 0.4, aimSlewRadS: 1.2 },
  // ゾンビは銃を持たず近接のみ。HP/速度は spawnZombie が tuning に載せて渡す(致命バグ回避=
  // spawnBot merge で KIND_TUNING が後勝ちになるため maxHp/moveSpeedMul は絶対に入れない)。
  // damage=爪の一撃, reactionS/burstPause は発砲経路に入らないので実質未使用。
  zombie: { viewDistM: 120, reactionS: 0, damage: 22, burstPauseMin: 99, burstPauseMax: 99 },
};

// アーキタイプごとの体格(コンストラクタ/respawnAtの単一の真実)
const KIND_FEET_OFFSET: Record<BotKind, number> = {
  humanoid: CENTER_TO_FEET,
  drone: 0, // 浮遊するので足元オフセットなし
  tank: TANK_HALF_H,
  turret: TURRET_BODY_HALF + TURRET_BODY_RADIUS,
  zombie: CENTER_TO_FEET, // 人型と同じカプセル体格
};
// humanoid以外は頭(弱点)コライダーの高さを体格で固定する(tuningと乖離させない)
const KIND_HEAD_OFFSET: Record<BotKind, number> = {
  humanoid: HEAD_OFFSET,
  drone: DRONE_HEAD_OFFSET,
  tank: TANK_HEAD_Y,
  turret: TURRET_HEAD_OFFSET,
  zombie: HEAD_OFFSET,
};
// 死亡演出の長さ(s)。humanoid/zombieは膝崩れ→前傾横倒しの2段演出のため 0.6 に延長
const KIND_DEATH_S: Record<BotKind, number> = {
  humanoid: 0.6,
  drone: 1.1,
  tank: 1.4,
  turret: 0.5,
  zombie: 0.6,
};

export const BOT_NAMES = [
  'アサギ',
  'クレナイ',
  'フジ',
  'ヤマブキ',
  'ルリイロ',
  'スミレ',
  'カリヤス',
  'ワカバ',
] as const;

export interface BotContext {
  // 現在見えている交戦対象の目の位置。誰も見えなければnull
  targetEye: THREE.Vector3 | null;
  // 非交戦時に向かう地点(ドミネーションの拠点など)。なければ徘徊する
  objective: THREE.Vector3 | null;
  tuning: BotTuning;
  rand: Rand;
  onShoot: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  // ゾンビの近接ヒット通知(match側でグローバルrate-limit + i-frameを適用して多段一撃を防ぐ)
  onMelee?: (bot: Bot) => void;
}

// 角度を上限付きで目標へ寄せる(tank車体/砲塔・turretヘッドのslew制御)
function stepAngle(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  return current + THREE.MathUtils.clamp(diff, -maxStep, maxStep);
}

// 新kindメッシュ用の共通ヘルパ(humanoid buildMesh内ローカル版と同形)
function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

// ── AAAローポリ造形ヘルパ ──────────────────────────────────────────────
// 寸法キーで共有するジオメトリキャッシュ。これらは決してシーンへ直接載せず
// (mergeByMaterialが必ずclone()してから焼く)、試合dispose(scene.traverse)の
// 対象外に留める。buildPropDecorのテンプレ流儀と同じく、豆腐解消の基礎になる。
const CHAMFER_GEO_CACHE = new Map<string, THREE.ExtrudeGeometry>();
const PRISM_GEO_CACHE = new Map<string, THREE.CylinderGeometry>();

// 角を落とした箱(面取りボックス)。ExtrudeGeometryで角丸矩形を押し出し、
// ベベルで稜線を柔らかくして「積み木の豆腐」感を消す。中心原点へ寄せる。
function chamferBox(w: number, h: number, d: number, ch = 0.03): THREE.ExtrudeGeometry {
  const key = `${w}_${h}_${d}_${ch}`;
  const cached = CHAMFER_GEO_CACHE.get(key);
  if (cached) return cached;
  const r = Math.min(ch, w / 2 - 1e-3, h / 2 - 1e-3);
  const hw = w / 2;
  const hh = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const depth = Math.max(1e-3, d - ch * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: ch,
    bevelSize: ch,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 2,
  });
  geo.translate(0, 0, -depth / 2); // 押し出し方向(Z)を中心へ
  geo.computeVertexNormals();
  CHAMFER_GEO_CACHE.set(key, geo);
  return geo;
}

// 上下で半径の異なる多角柱(既定は八角)。八角prism胴で箱シルエットを解消する。
// フラット面が前を向くよう π/sides 回し、Z方向スケールで扁平な胴断面を作る。
function taperPrism(rTop: number, rBot: number, h: number, sides = 8, scaleZ = 1): THREE.CylinderGeometry {
  const key = `${rTop}_${rBot}_${h}_${sides}_${scaleZ}`;
  const cached = PRISM_GEO_CACHE.get(key);
  if (cached) return cached;
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, sides, 1);
  geo.rotateY(Math.PI / sides);
  if (scaleZ !== 1) geo.scale(1, 1, scaleZ);
  geo.computeVertexNormals();
  PRISM_GEO_CACHE.set(key, geo);
  return geo;
}

// merge後の単一メッシュへ縦方向AOを頂点カラーとして焼く(下ほど暗い接地感)。
// 材質は vertexColors:true 前提。base色だけを畳み、emissive(被弾発光)には非干渉。
function applyAO(geo: THREE.BufferGeometry, yMin: number, yMax: number, floor = 0.6): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const range = Math.max(1e-4, yMax - yMin);
  for (let i = 0; i < n; i += 1) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - yMin) / range, 0, 1);
    const ao = floor + (1 - floor) * t;
    arr[i * 3] = ao;
    arr[i * 3 + 1] = ao;
    arr[i * 3 + 2] = ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// ルート配下のMeshを (材質参照, castShadow) タプルでグルーピングし、各群を1メッシュへ畳む。
// 影を落とすシルエット群と no-shadow ディテール群を別メッシュに分けることで影パスを抑える。
// merge前に index を toNonIndexed で正規化(indexed/非indexed混在のクラッシュ回避)、
// 空群skip、merged===null は throw で早期検知。全入力は position/normal/uv のみで属性一致。
function mergeByMaterial(root: THREE.Object3D): THREE.Mesh[] {
  root.updateWorldMatrix(true, true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<
    string,
    { mat: THREE.Material; castShadow: boolean; geos: THREE.BufferGeometry[] }
  >();
  const scratch = new THREE.Matrix4();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = obj.material as THREE.Material;
    const key = `${mat.uuid}_${obj.castShadow ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) {
      g = { mat, castShadow: obj.castShadow, geos: [] };
      groups.set(key, g);
    }
    scratch.multiplyMatrices(rootInv, obj.matrixWorld);
    const baked = obj.geometry.clone();
    baked.applyMatrix4(scratch);
    const norm = baked.index ? baked.toNonIndexed() : baked;
    if (norm !== baked) baked.dispose();
    g.geos.push(norm);
  });
  const out: THREE.Mesh[] = [];
  for (const g of groups.values()) {
    if (g.geos.length === 0) continue;
    const merged = mergeGeometries(g.geos, false);
    if (merged === null) throw new Error('mergeByMaterial: mergeGeometries returned null');
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.castShadow;
    mesh.receiveShadow = false;
    out.push(mesh);
    for (const geo of g.geos) geo.dispose();
  }
  return out;
}

// 崩落ディゾルブ用GLSL注入。discardは常時コンパイルせず #ifdef USE_DISSOLVE で
// ゲート(early-Z保護)。死亡時に material.defines.USE_DISSOLVE を定義して初めて
// 有効化する。頂点は rig原点へ寄せて崩落感を、フラグメントはハッシュノイズ閾値で溶解。
function applyDissolve(mat: THREE.MeshStandardMaterial, u: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = u;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n#ifdef USE_DISSOLVE\nuniform float uDissolve;\nvarying vec3 vDisPos;\n#endif',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef USE_DISSOLVE\n  vDisPos = transformed;\n  transformed -= normalize(transformed + vec3(0.0, 1e-4, 0.0)) * uDissolve * 0.28;\n#endif',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n#ifdef USE_DISSOLVE\nuniform float uDissolve;\nvarying vec3 vDisPos;\nfloat disHash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\n#endif',
      )
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n#ifdef USE_DISSOLVE\n  if (disHash(floor(vDisPos * 13.0)) < uDissolve) discard;\n#endif',
      );
  };
  // defines 差でプログラムを別キャッシュへ(onBeforeCompile材の変種取り違え防止)
  mat.customProgramCacheKey = () =>
    mat.defines && mat.defines.USE_DISSOLVE !== undefined ? 'dissolve1' : 'dissolve0';
}

// kind別メッシュのマテリアル一式。humanoidのbuildMeshと同じレシピ
// (チーム色装甲+暗い下地+チーム色emissive+ガンメタ)を共有する
interface KindMats {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  gun: THREE.MeshStandardMaterial;
  tierGlow: number;
}
function makeKindMats(color: number, tier: BotTier): KindMats {
  const c = new THREE.Color(color);
  const tierGlow = tier === 'boss' ? 0.55 : tier === 'elite' ? 0.28 : 0;
  const armor = new THREE.MeshStandardMaterial({
    color: c,
    roughness: tier === 'normal' ? 0.5 : 0.4,
    metalness: 0.3,
    emissive: c.clone(),
    emissiveIntensity: tierGlow,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.42),
    roughness: 0.6,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x0d0f13,
    emissive: c.clone(),
    emissiveIntensity: 0.9, // Neutral+Bloom前提で白飛びを抑える(バイザーと同値)
    roughness: 0.3,
  });
  const gun = new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.5 });
  return { armor, dark, glow, gun, tierGlow };
}

let botUidSeq = 0;

export class Bot {
  // 生成ごと一意のインスタンスID(表示名は8種を再利用するため、リベンジ等の同一性判定に使う)
  readonly uid = botUidSeq++;
  readonly body: RAPIER.RigidBody;
  readonly bodyCollider: RAPIER.Collider;
  readonly headCollider: RAPIER.Collider;
  // 追加の当たり判定(tankの砲塔など)。matchがbody部位としてtags登録する
  readonly extraColliders: RAPIER.Collider[] = [];
  readonly group = new THREE.Group();
  readonly maxHp: number;
  readonly tuning: BotTuning;
  readonly tier: BotTier;

  hp = 100;
  alive = true;
  respawnIn = 0;
  kills = 0;
  deaths = 0;
  // 警戒(0より大きい間)。銃声などの「音」への反応で、音源方向を向いて調査し
  // 視野もやや広がるが、360度の千里眼にはならない(自然なステルスを守る)
  alert = 0;
  // 警戒の対象位置(銃声/被弾の方向)。調査行動でここへ振り向く
  alertPos: THREE.Vector3 | null = null;
  // 被弾直後の短い戦闘覚醒。この間だけ扇形/全周検知(撃たれたら振り向くのは自然)
  pain = 0;
  // 被弾方向(bot→射手)。humanoidはこの±120°扇形のみpain検知(千里眼を防ぐ)。
  // tank/turret/droneは painDir を見ず従来どおり pain 全周(R8ボス非回帰)
  painDir: THREE.Vector3 | null = null;
  blind = 0; // フラッシュで目が眩んでいる残り秒数

  // ── R16 spot-time 知覚FSM(matchのperceiveが積分・遷移を駆動する共有状態)──
  spotAwareness = 0; // 発見メータ 0..1.3。0.9でSPOTTED / 0.15でLOST
  aiState: 'patrol' | 'search' | 'combat' = 'patrol';
  lkp: THREE.Vector3 | null = null; // 最後に視認した位置(last known position)
  engageGrace = 0; // 見失い直後に lkp へ撃ち/寄り続ける猶予(壁越し千里眼にしない自然減衰)
  lastTargetEye: THREE.Vector3 | null = null;
  lastCandidateUid = -1; // 対象切替の検出(FFA/TDMで覚醒を移譲しない)
  lastRawVisible = false; // uid%3バケットの非担当フレームでLOS結果を再利用

  // ── R16 機械的エイム: aimDirを目標へ aimSlewRadS で寄せ、updateShootingはこの方向へ撃つ ──
  readonly aimDir = new THREE.Vector3();

  // ── R16 ゾンビ ──
  zombieRunMul = 1; // 走行個体のローカル速度倍率(moveSpeedは readonly のため別持ち)
  private meleeTimer = 0; // 個体の近接クールダウン
  private climbing = false; // 登坂アシスト作動中(前フレームのブロック検知で点火)
  private climbBaseY = 0; // 登坂開始時の足元中心Y。上限高さ判定の起点(青天井防止)
  private climbCooldownS = 0; // 越えられない壁で登坂を封じる残り時間(2.4m浮遊バウンド防止)
  private climbMinS = 0;          // R21: 登坂の最小継続残り時間(縁チャタリング防止)
  private climbElapsedS = 0;      // R21: 今回の登坂セッション経過時間(最大継続時間の起点)
  // humanoid アンスタック(R21新規)
  private stuckTimer = 0;         // 前進不能の累積時間(HUMANOID_STUCK_TH 超えで発動)
  private unstuckSteerS = 0;      // 横ステア/heading転換のラッチ残り時間
  private unstuckStrafeOverride: number | null = null; // 戦闘中の strafe 方向上書き(null=通常)
  // horizSpeedMps 用
  private _prevBodyPos = new THREE.Vector3(); // 前フレームの剛体位置
  private _horizSpeed = 0;        // 直近フレームの水平速度(m/s)
  private reactionJitter = 1; // 反応時間の個体差倍率(constructorで名前ハッシュから確定)
  private fireOnset = 0; // 交戦開始時の追加発砲遅延(s)

  private readonly controller: RAPIER.KinematicCharacterController;
  private heading = 0;
  private headingTimer = 0;
  private strafeSign = 1;
  private strafeTimer = 0;
  private velY = 0;
  private reaction = 0;
  private burstLeft = 0;
  private shotTimer = 0;
  private pauseTimer = 0;
  private dyingTimer = 0;

  // 歩行アニメ用。胴体ボブと四肢スイングを駆動する
  private readonly rig = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private walkPhase = 0;
  private walkAmp = 0;
  private hitFlash = 0; // 被弾時に装甲を一瞬発光させる残り時間
  private flinch = 0; // 被弾時に一瞬のけぞる残り時間
  private armorMat: THREE.MeshStandardMaterial | null = null;
  private tierGlowBase = 0; // 階層由来の常時発光量(被弾発光の戻り先)
  private readonly moveSpeed: number;
  private readonly headOff: number;

  // ── kind別ステート ──
  private readonly world: RAPIER.World; // droneの壁/床レイキャスト用
  private readonly feetOffset: number; // スポーン点(足元)→剛体中心の高さ
  private readonly bobPhase: number; // 群れを非同期化するボブ位相(名前から決定論)
  private hoverBaseY: number; // droneのホバー基準高度
  private anim = 0; // ローター回転/ボブ/スイープの経過時間
  private bank = 0; // droneのロールバンク
  private wanderTurn = 0; // droneの旋回徘徊レート(rad/s)
  private wanderYaw = 0; // tankの徘徊方位
  private turretYaw = 0; // tankの砲塔方位(車体headingと独立に追従)
  private sweepCenter = 0; // turretの首振り中心(設置向き)
  private dieVel = 0; // droneの墜落速度(kinematicは放置では落ちないので自前積分)
  private dieBaseY = 0; // tankの沈み込み基準
  private dieFloorY: number | null = null; // droneの墜落床(死亡時にレイ1本で確定)
  private readonly rotors: THREE.Group[] = []; // droneのローター(syncMeshでspin)
  private turretGroup: THREE.Group | null = null; // tankの旋回砲塔
  private turretHead: THREE.Group | null = null; // turretの旋回ヘッド
  private tankBarrel: THREE.Group | null = null; // tankの砲身ピボット(死亡で俯角→respawnで復帰)
  private readonly turretLegs: THREE.Group[] = []; // turretの三脚(死亡で開脚→respawnで復帰)
  private radarDish: THREE.Group | null = null; // elite/boss turretのレーダー皿(syncMeshでspin)
  private armRig: THREE.Group | null = null; // humanoidの両腕+ライフル一体(微スウェイ)
  private readonly deathTilt: number; // 死亡横倒しの向き(名前ハッシュ由来の決定論)
  // 崩落ディゾルブ: spawn時 value=0。死亡でdefines点火し updateDying で 0→1 へ進める。
  // armor/dark/gun/track の全不透明材で1本のuniformを共有する(glowは除外)
  private readonly dissolveU = { value: 0 };
  private readonly dissolveMats: THREE.MeshStandardMaterial[] = [];
  private smoke: THREE.Group | null = null; // tank死亡時の黒煙
  private readonly smokePuffs: { mesh: THREE.Mesh; baseY: number }[] = [];
  private smokeMat: THREE.MeshStandardMaterial | null = null;
  // 死亡時に消灯し、respawnで復元する発光マテリアル(tankのグリル/droneのアイ等)
  private readonly glowMats: { mat: THREE.MeshStandardMaterial; base: number }[] = [];

  constructor(
    world: RAPIER.World,
    readonly name: string,
    spawn: THREE.Vector3,
    color: number,
    tuning: BotTuning,
    readonly team: number = 1,
    tier: BotTier = 'normal',
    readonly kind: BotKind = 'humanoid',
  ) {
    this.world = world;
    this.tuning = tuning;
    this.tier = tier;
    this.maxHp = tuning.maxHp;
    this.hp = tuning.maxHp;
    this.moveSpeed = MOVE_SPEED * tuning.moveSpeedMul;
    // humanoidは難度/階層tuningの頭高、他kindは体格から固定(コライダーと常に一致)
    this.headOff = kind === 'humanoid' ? tuning.headOffset : KIND_HEAD_OFFSET[kind];
    this.feetOffset = KIND_FEET_OFFSET[kind];
    this.hoverBaseY = spawn.y + DRONE_HOVER_ALT;
    let phase = 0;
    for (let i = 0; i < name.length; i += 1) phase += name.charCodeAt(i);
    this.bobPhase = (phase * 0.7) % (Math.PI * 2);
    // 横倒しの傾き向き(名前ハッシュで個体差。-0.3..+0.3rad の左右リーン)
    this.deathTilt = ((phase % 5) - 2) * 0.15;
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      spawn.y + this.feetOffset,
      spawn.z,
    );
    this.body = world.createRigidBody(desc);
    if (kind === 'drone') {
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(DRONE_BODY_RADIUS),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(DRONE_HEAD_RADIUS).setTranslation(0, DRONE_HEAD_OFFSET, 0),
        this.body,
      );
    } else if (kind === 'tank') {
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(TANK_HALF_W, TANK_HALF_H, TANK_HALF_L),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(TANK_HEAD_RADIUS).setTranslation(0, TANK_HEAD_Y, TANK_HEAD_Z),
        this.body,
      );
      // 砲塔の当たり判定(シルエットの主要部を撃って素通りしないように)。部位はbody扱い
      this.extraColliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.8, 0.3, 0.85).setTranslation(0, 0.95, 0.1),
          this.body,
        ),
      );
    } else if (kind === 'turret') {
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(TURRET_BODY_HALF, TURRET_BODY_RADIUS),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(TURRET_HEAD_RADIUS).setTranslation(0, TURRET_HEAD_OFFSET, 0),
        this.body,
      );
    } else {
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(BODY_HALF, BODY_RADIUS),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(HEAD_RADIUS).setTranslation(0, this.headOff, 0),
        this.body,
      );
    }
    // KCCはhumanoid/tank/zombieが使用するが生成は共通(最小差分。World破棄で回収される)
    this.controller = world.createCharacterController(0.05);
    // R18: ゾンビは小さい段差(バリケード/瓦礫/縁石)を乗り越えて詰めてくる。autostep高さを
    // 0.4→0.75へ上げ、最小幅も緩めて群れが地形に引っかからず押し寄せるように
    if (kind === 'zombie') {
      this.controller.enableAutostep(0.75, 0.2, true);
    } else {
      this.controller.enableAutostep(0.4, 0.3, true);
    }
    this.controller.enableSnapToGround(0.4);

    if (kind === 'drone') this.buildDroneMesh(color, tier);
    else if (kind === 'tank') this.buildTankMesh(color, tier);
    else if (kind === 'turret') this.buildTurretMesh(color, tier);
    else if (kind === 'zombie') this.buildZombieMesh(color);
    else this.buildMesh(color, tier);
    // 名前ハッシュ由来の決定論的な反応個体差(0.7〜1.4)と初弾オンセット(0〜0.35s)。
    // 分隊の同時発砲を desync し、機械的な一斉射撃を自然に散らす(spot-timeとは別系統)
    this.reactionJitter = 0.7 + ((phase * 13) % 71) / 71 * 0.7;
    this.fireOnset = ((phase * 7) % 53) / 53 * 0.35;
    // 当たり判定は固定のまま、見た目だけ階層スケール(原則1.0なので無害)
    if (tuning.scale !== 1) this.group.scale.setScalar(tuning.scale);
  }

  // チーム色装甲の八角prism胴・胸甲/パウルドロン・ヘルメット/バイザー・
  // 両腕一体のarmRigで構成した脱豆腐ヒューマノイド兵士。当たり判定(胴カプセル+
  // 頭球)は別管理なので、コライダー内側に収めつつ見た目は自由に肉付けできる。
  // 各パーツは寸法キャッシュのジオメトリをmergeByMaterialで(材質,castShadow)別に
  // 畳み、applyAOで縦AOを焼く。影を落とすのは胴シルエットと腿のみに絞る。
  private buildMesh(color: number, tier: BotTier): void {
    const c = new THREE.Color(color);
    const boss = tier === 'boss';
    // 強敵は常時わずかに発光する装甲で威圧する(視覚スケール差もbossのみ付与)
    const tierGlow = boss ? 0.55 : tier === 'elite' ? 0.28 : 0;
    const armor = new THREE.MeshStandardMaterial({
      color: c,
      roughness: tier === 'normal' ? 0.55 : 0.42,
      metalness: tier === 'normal' ? 0.14 : 0.34,
      emissive: c.clone(),
      emissiveIntensity: tierGlow,
      vertexColors: true,
    });
    this.armorMat = armor;
    this.tierGlowBase = tierGlow;
    const dark = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.34),
      roughness: 0.62,
      metalness: 0.2,
      vertexColors: true,
    });
    const gun = new THREE.MeshStandardMaterial({
      color: 0x202227,
      roughness: 0.5,
      metalness: 0.45,
      vertexColors: true,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0d0f13,
      emissive: c.clone(),
      emissiveIntensity: 0.9, // Neutral+Bloom前提で白飛びを抑える(バイザー)
      roughness: 0.3,
    });

    // root配下へメッシュ片を積むだけの薄いヘルパ(mergeByMaterialが後で畳む)
    const P = (
      root: THREE.Object3D,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      cast: boolean,
      rx = 0,
      ry = 0,
      rz = 0,
    ): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx !== 0 || ry !== 0 || rz !== 0) m.rotation.set(rx, ry, rz);
      m.castShadow = cast;
      root.add(m);
    };
    // ルートを畳んで対象へ追加し、pivot静止Yを織り込んだ縦AOを焼く
    const finalize = (root: THREE.Object3D, target: THREE.Object3D, restY: number): void => {
      const meshes = mergeByMaterial(root);
      for (const mesh of meshes) applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.6);
      for (const mesh of meshes) target.add(mesh);
    };

    // bossは胸甲/パウルドロンを肥大させ独自クレストを足す(コライダーは据置)
    const chestW = boss ? 0.5 : 0.42;
    const pauldX = boss ? 0.33 : 0.3;
    const pauldW = boss ? 0.24 : 0.2;

    // ── 胴・頭(静止・影を落とすシルエット群 + no-shadowディテール)──
    const bodyRoot = new THREE.Group();
    // armor(cast): 八角prism胴・肩ヨーク・胸甲・ゴルゲット・パウルドロン・ヘルメット
    P(bodyRoot, taperPrism(0.3, 0.22, 0.6, 8, 0.62), armor, 0, 0.15, 0, true); // 八角胴
    P(bodyRoot, taperPrism(0.2, 0.31, 0.14, 8, 0.7), armor, 0, 0.44, 0, true); // 肩ヨーク(上広がり)
    P(bodyRoot, chamferBox(chestW, 0.3, 0.14, 0.04), armor, 0, 0.28, -0.09, true); // 胸甲
    P(bodyRoot, chamferBox(0.28, 0.09, 0.24, 0.03), armor, 0, 0.5, 0, true); // ゴルゲット
    P(bodyRoot, chamferBox(pauldW, 0.15, 0.24, 0.04), armor, -pauldX, 0.45, 0, true); // 左パウルドロン
    P(bodyRoot, chamferBox(pauldW, 0.15, 0.24, 0.04), armor, pauldX, 0.45, 0, true); // 右パウルドロン
    P(bodyRoot, new THREE.SphereGeometry(0.2, 16, 12), armor, 0, 0.9, 0.01, true); // ヘルメットドーム
    P(bodyRoot, chamferBox(0.3, 0.1, 0.3, 0.03), armor, 0, 0.97, 0.0, true); // ヘルメット冠
    if (boss) P(bodyRoot, chamferBox(0.05, 0.15, 0.26, 0.02), armor, 0, 1.03, 0.02, true); // クレスト
    // dark(no-shadow): 腰・首・頭・バックパック・ベルト・非対称ポーチ・アンテナ
    P(bodyRoot, taperPrism(0.24, 0.18, 0.2, 8, 0.66), dark, 0, -0.22, 0, false); // 腰
    P(bodyRoot, new THREE.CylinderGeometry(0.07, 0.09, 0.12, 10), dark, 0, 0.6, 0, false); // 首
    P(bodyRoot, new THREE.SphereGeometry(0.17, 16, 12), dark, 0, 0.86, 0, false); // 頭
    P(bodyRoot, chamferBox(0.3, 0.34, 0.14, 0.03), dark, 0, 0.28, 0.19, false); // バックパック
    P(bodyRoot, chamferBox(0.36, 0.07, 0.3, 0.02), dark, 0, -0.03, 0, false); // ベルト
    P(bodyRoot, chamferBox(0.12, 0.13, 0.09, 0.02), dark, -0.17, -0.1, -0.13, false); // 左ポーチ(大)
    P(bodyRoot, chamferBox(0.09, 0.1, 0.08, 0.02), dark, 0.19, -0.05, -0.12, false); // 右ポーチ(小)
    P(bodyRoot, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), dark, 0.13, 0.66, 0.15, false, 0.25, 0, 0.15); // アンテナ
    // glow(no-shadow): バイザー・胸発光帯
    P(bodyRoot, chamferBox(0.24, 0.06, 0.05, 0.02), glow, 0, 0.85, -0.155, false); // 発光バイザー
    P(bodyRoot, new THREE.BoxGeometry(0.3, 0.045, 0.02), glow, 0, 0.2, -0.175, false); // 胸の発光帯
    finalize(bodyRoot, this.rig, 0);

    // ── 腕(両腕+ライフル一体のarmRig。微スウェイの土台)──
    const armRig = new THREE.Group();
    armRig.position.set(0, 0.42, 0);
    this.armRig = armRig;
    const armRoot = new THREE.Group();
    const buildArm = (sx: number): void => {
      const g = new THREE.Group();
      g.position.set(sx * 0.28, 0.06, 0.0);
      g.rotation.x = -1.15;
      g.rotation.z = -sx * 0.35;
      P(g, chamferBox(0.11, 0.28, 0.11, 0.03), armor, 0, -0.13, 0, false); // 上腕(armor)
      P(g, chamferBox(0.095, 0.26, 0.095, 0.03), armor, 0, -0.34, 0.02, false); // 前腕(armor)
      P(g, chamferBox(0.08, 0.09, 0.11, 0.02), dark, 0, -0.47, 0.03, false); // グローブ(dark)
      armRoot.add(g);
    };
    buildArm(-1);
    buildArm(1);
    // 構えるライフル(gun)
    const rifle = new THREE.Group();
    rifle.position.set(0.02, -0.08, -0.36);
    P(rifle, chamferBox(0.07, 0.09, 0.42, 0.02), gun, 0, 0, 0, false); // レシーバ
    P(rifle, new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), gun, 0, 0.01, -0.34, false, Math.PI / 2, 0, 0); // 銃身
    P(rifle, chamferBox(0.05, 0.16, 0.08, 0.02), gun, 0, -0.12, 0.04, false); // マガジン
    P(rifle, chamferBox(0.05, 0.08, 0.14, 0.02), gun, 0, -0.02, 0.26, false); // ストック
    P(rifle, new THREE.BoxGeometry(0.03, 0.05, 0.06), gun, 0, 0.08, -0.04, false); // サイト
    armRoot.add(rifle);
    finalize(armRoot, armRig, armRig.position.y);
    this.rig.add(armRig);

    // ── 脚(股関節ピボット + 膝ピボット)。歩行で前後にスイングする ──
    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number): void => {
      pivot.position.set(sx, -0.16, 0);
      knee.position.set(0, -0.3, 0);
      const thighRoot = new THREE.Group();
      P(thighRoot, chamferBox(0.15, 0.32, 0.16, 0.03), armor, 0, -0.15, 0, true); // 腿(影を落とす)
      finalize(thighRoot, pivot, pivot.position.y);
      const shinRoot = new THREE.Group();
      P(shinRoot, chamferBox(0.13, 0.1, 0.15, 0.03), dark, 0, 0.0, 0.01, false); // 膝ガード
      P(shinRoot, chamferBox(0.12, 0.3, 0.13, 0.03), dark, 0, -0.15, 0, false); // 脛
      P(shinRoot, chamferBox(0.14, 0.09, 0.27, 0.03), dark, 0, -0.3, -0.045, false); // ブーツ(底≈-0.80)
      finalize(shinRoot, knee, pivot.position.y + knee.position.y);
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -0.12);
    buildLeg(this.legR, this.kneeR, 0.12);

    if (boss) {
      // 視覚のみ拡大(コライダー不変)。rig原点(=剛体中心)基準の等比拡大だと
      // ブーツ底(rigローカル≈-0.80)が0.80*(1.12-1)≈0.096沈むので同量持ち上げて接地を戻す
      this.rig.scale.setScalar(1.12);
      this.rig.position.y += 0.8 * 0.12;
    }
    this.group.add(this.rig);
  }

  // 腐敗色の低ポリ人型ゾンビ。銃/armRigのライフルは持たず、前へ垂らした両腕と
  // シャンブル脚(legL/legR/kneeL/kneeR)を持つ。多数描画のため部位は最小限に絞り、
  // mergeByMaterialで (armor/dark/glow)×(cast/no-cast) へ畳む(1体≈3〜4ドローコール)。
  // 影を落とすシルエットは胴と腿のみ。no-cast片は userData.noShadow=true を焼き、
  // 距離LOD/近接影トグル(setCastShadow)が誤って影を点けないようにする。
  private buildZombieMesh(color: number): void {
    const c = new THREE.Color(color);
    const armor = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.85,
      metalness: 0.05,
      vertexColors: true,
    });
    this.armorMat = armor;
    this.tierGlowBase = 0;
    const dark = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.4),
      roughness: 0.9,
      metalness: 0.02,
      vertexColors: true,
    });
    // 腐った眼光。bloomThresholdでおもちゃ化しないよう低強度(≤0.5)に抑える
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0a0d07,
      emissive: new THREE.Color(0x8fbf4a),
      emissiveIntensity: 0.42,
      roughness: 0.4,
    });
    this.glowMats.push({ mat: glow, base: 0.42 });

    const P = (
      root: THREE.Object3D,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      cast: boolean,
      rx = 0,
      ry = 0,
      rz = 0,
    ): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx !== 0 || ry !== 0 || rz !== 0) m.rotation.set(rx, ry, rz);
      m.castShadow = cast;
      root.add(m);
    };
    // 畳んで縦AOを焼き、no-cast片には noShadow を記録(setCastShadowのLODが尊重する)
    const finalize = (root: THREE.Object3D, target: THREE.Object3D, restY: number): void => {
      const meshes = mergeByMaterial(root);
      for (const mesh of meshes) {
        applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.55);
        if (!mesh.castShadow) mesh.userData.noShadow = true;
        target.add(mesh);
      }
    };

    // ── 胴・頭(影を落とすシルエット + no-shadowディテール)──
    const bodyRoot = new THREE.Group();
    P(bodyRoot, taperPrism(0.24, 0.2, 0.58, 7, 0.66), armor, 0, 0.16, 0, true); // やせ細った胴
    P(bodyRoot, chamferBox(0.34, 0.24, 0.13, 0.03), armor, 0, 0.31, -0.05, true); // 露出した肋骨帯
    P(bodyRoot, taperPrism(0.2, 0.16, 0.18, 7, 0.7), dark, 0, -0.2, 0, false); // 腰
    P(bodyRoot, new THREE.CylinderGeometry(0.055, 0.07, 0.14, 8), dark, 0.02, 0.56, -0.02, false, 0.18, 0, 0.12); // 傾いた首
    P(bodyRoot, new THREE.SphereGeometry(0.16, 12, 10), dark, 0.03, 0.72, -0.05, false); // うなだれた頭
    P(bodyRoot, chamferBox(0.16, 0.05, 0.05, 0.02), dark, 0.03, 0.7, -0.18, false); // 顎
    // 落ちくぼんだ眼光(左右)
    P(bodyRoot, new THREE.SphereGeometry(0.026, 8, 6), glow, -0.05, 0.74, -0.17, false);
    P(bodyRoot, new THREE.SphereGeometry(0.026, 8, 6), glow, 0.1, 0.74, -0.17, false);
    P(bodyRoot, new THREE.BoxGeometry(0.16, 0.03, 0.02), glow, 0.02, 0.22, -0.16, false); // 胸の腐敗発光帯
    finalize(bodyRoot, this.rig, 0);

    // ── 前へ垂らした両腕(armRig。銃は持たない)──
    const armRig = new THREE.Group();
    armRig.position.set(0, 0.4, 0);
    this.armRig = armRig;
    const armRoot = new THREE.Group();
    const buildArm = (sx: number, reach: number): void => {
      const g = new THREE.Group();
      g.position.set(sx * 0.26, 0.05, -0.02);
      g.rotation.x = -1.35 - reach; // ほぼ水平に前へ突き出す
      g.rotation.z = -sx * 0.12;
      P(g, chamferBox(0.09, 0.27, 0.09, 0.02), armor, 0, -0.13, 0, false); // 上腕
      P(g, chamferBox(0.075, 0.27, 0.075, 0.02), dark, 0, -0.36, 0.01, false); // 前腕
      P(g, chamferBox(0.07, 0.06, 0.11, 0.02), dark, 0, -0.5, 0.03, false); // 手
      armRoot.add(g);
    };
    buildArm(-1, 0.18);
    buildArm(1, 0.05); // 左右非対称の伸ばしで不気味さを出す
    finalize(armRoot, armRig, armRig.position.y);
    this.rig.add(armRig);

    // ── 脚(股関節ピボット + 膝ピボット)。humanoidと同じ骨格でシャンブル歩容 ──
    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number): void => {
      pivot.position.set(sx, -0.16, 0);
      knee.position.set(0, -0.3, 0);
      const thighRoot = new THREE.Group();
      P(thighRoot, chamferBox(0.13, 0.32, 0.14, 0.03), armor, 0, -0.15, 0, true); // 腿(影)
      finalize(thighRoot, pivot, pivot.position.y);
      const shinRoot = new THREE.Group();
      P(shinRoot, chamferBox(0.11, 0.3, 0.12, 0.03), dark, 0, -0.15, 0, false); // 脛
      P(shinRoot, chamferBox(0.13, 0.08, 0.24, 0.03), dark, 0, -0.3, -0.04, false); // 足(底≈-0.80)
      finalize(shinRoot, knee, pivot.position.y + knee.position.y);
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -0.11);
    buildLeg(this.legR, this.kneeR, 0.11);

    this.group.add(this.rig);
  }

  // 機械ボット共通のメッシュ生成。castShadowを明示し、影を落とさない
  // ディテールは userData.noShadow=true を記録(respawnでblanket復元しないため)。
  private mechMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    cast: boolean,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rx !== 0 || ry !== 0 || rz !== 0) mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = cast;
    mesh.userData.noShadow = !cast;
    return mesh;
  }

  // 崩落ディゾルブ材を登録(spawn時はdefines未点火=early-Z保護。死亡で点火)
  private registerDissolve(...mats: THREE.MeshStandardMaterial[]): void {
    for (const mat of mats) {
      applyDissolve(mat, this.dissolveU);
      this.dissolveMats.push(mat);
    }
  }

  // 死亡時: 崩落ディゾルブのdefinesを一度だけ点火し、影を落とす胴も影を止める
  // (ディゾルブ中に実体のない固い影が残らないように)
  private startDissolve(): void {
    for (const mat of this.dissolveMats) {
      if (!mat.defines) mat.defines = {};
      if (mat.defines.USE_DISSOLVE === undefined) {
        mat.defines.USE_DISSOLVE = '';
        mat.needsUpdate = true;
      }
    }
    if (this.dissolveMats.length > 0) this.setMechShadows(false);
  }

  // ディゾルブ変種(dissolve1)を事前コンパイルさせるためのdefine一時トグル。
  // match側が on→renderer.compile→off の順で呼び、初回機械撃破のシェーダstutterを消す。
  // valueは0のままなのでprewarm後offしても見た目は不変(early-Zはprewarm後に復元)
  prewarmDissolve(on: boolean): void {
    for (const mat of this.dissolveMats) {
      if (!mat.defines) mat.defines = {};
      if (on) mat.defines.USE_DISSOLVE = '';
      else delete mat.defines.USE_DISSOLVE;
      mat.needsUpdate = true;
    }
  }

  // 機械ボットのcastShadowを一括制御。復元は userData.noShadow を尊重する
  private setMechShadows(enabled: boolean): void {
    this.rig.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = enabled && obj.userData.noShadow !== true;
    });
  }

  // 飛行ドローン: 面分割コア+放熱スリット+十字アーム4本+プロップガード付きローター
  // +下向き発光アイ。頂部の発光ドームが弱点コライダー(ball 0.2 @+0.45)の視覚ヒント。
  private buildDroneMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    const elite = tier !== 'normal';
    const mp = this.mechMesh.bind(this);
    this.rig.add(
      mp(new THREE.IcosahedronGeometry(0.34, 1), m.armor, 0, 0, 0, true), // コア(面分割=パネル。唯一の影)
      mp(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 8), m.dark, 0, -0.14, 0, false, 0, Math.PI / 8, 0), // 下部リング
      mp(new THREE.CylinderGeometry(0.1, 0.14, 0.16, 10), m.dark, 0, 0.3, 0, false), // 首
      mp(new THREE.SphereGeometry(DRONE_HEAD_RADIUS - 0.02, 14, 10), m.glow, 0, DRONE_HEAD_OFFSET, 0, false), // 頂部センサードーム(弱点)
      mp(new THREE.SphereGeometry(0.09, 10, 8), m.glow, 0, -0.24, -0.16, false), // 下向き発光アイ
      mp(new THREE.CylinderGeometry(0.06, 0.09, 0.18, 8), m.gun, 0, -0.32, 0, false), // 腹部ガンポッド
    );
    // 前面の放熱スリット(no-shadow)
    for (let i = 0; i < 3; i += 1) {
      this.rig.add(mp(new THREE.BoxGeometry(0.22, 0.018, 0.02), m.gun, 0, 0.05 - i * 0.06, -0.33, false));
    }
    // 十字アーム4本+各先端に回転ローター(プロップガードリング付き)
    for (let i = 0; i < 4; i += 1) {
      const arm = new THREE.Group();
      arm.rotation.y = Math.PI / 4 + (Math.PI / 2) * i;
      arm.add(mp(boxGeo(0.09, 0.05, 0.58), m.dark, 0, 0.1, -0.42, false));
      arm.add(mp(new THREE.TorusGeometry(0.26, 0.018, 6, 16), m.gun, 0, 0.16, -0.66, false, Math.PI / 2, 0, 0)); // プロップガード
      const rotor = new THREE.Group();
      rotor.position.set(0, 0.16, -0.66);
      rotor.add(mp(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8), m.gun, 0, 0, 0, false)); // シャフト
      rotor.add(mp(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 6), m.dark, 0, 0.05, 0, false, 0, 0, Math.PI / 2)); // ブレード
      rotor.add(mp(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 6), m.dark, 0, 0.05, 0, false, Math.PI / 2, 0, 0));
      this.rotors.push(rotor);
      arm.add(rotor);
      this.rig.add(arm);
    }
    // elite/boss: 側面センサーフィン(パーツ数で格を表現)
    if (elite) {
      for (const sx of [-1, 1] as const) {
        this.rig.add(mp(chamferBox(0.03, 0.12, 0.18, 0.01).clone(), m.armor, sx * 0.34, 0.02, 0, false));
      }
    }
    this.registerDissolve(m.armor, m.dark, m.gun);
    this.group.add(this.rig);
  }

  // 大型戦車: 面取り車体+サイドスカート/フェンダー/スプロケット+旋回砲塔+砲盾+
  // 俯仰砲身ピボット。elite/boss は ERA(反応装甲)ブロックとコアキシャル砲身で格を出す。
  // 背面のエンジングリル発光が弱点コライダー(ball 0.35 @ y+1.0, z+0.9)の視覚ヒント。
  private buildTankMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    const elite = tier !== 'normal';
    const track = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9, metalness: 0.1 });
    const mp = this.mechMesh.bind(this);
    // 車体(コライダー cuboid(1.6, 0.7, 2.2) の内側に収める)。影は上部車体のみ
    this.rig.add(
      mp(chamferBox(2.5, 0.8, 4.3, 0.06).clone(), m.armor, 0, 0.15, 0, true), // 上部車体(影)
      mp(boxGeo(2.3, 0.6, 3.4), m.dark, 0, -0.35, 0, false), // 下部シャシー
      mp(chamferBox(2.3, 0.5, 0.7, 0.05).clone(), m.armor, 0, 0.34, -1.95, false, 0.35, 0, 0), // 傾斜グレイシス
      mp(boxGeo(1.7, 0.1, 0.03), m.glow, 0, 0.56, -2.16, false), // 前照灯バー
    );
    // 履帯(影)+サイドスカート+フェンダー+転輪+スプロケット(+elite: ERAブロック)
    for (const sx of [-1, 1] as const) {
      this.rig.add(mp(boxGeo(0.6, 0.8, 4.4), track, sx * 1.28, -0.3, 0, true)); // 履帯(影)
      this.rig.add(mp(chamferBox(0.12, 0.5, 4.0, 0.03).clone(), m.dark, sx * 1.34, 0.1, 0, false)); // サイドスカート
      this.rig.add(mp(boxGeo(0.7, 0.12, 1.0), m.dark, sx * 1.28, 0.42, -1.7, false)); // 前フェンダー
      for (let k = 0; k < 5; k += 1) {
        this.rig.add(mp(new THREE.CylinderGeometry(0.26, 0.26, 0.64, 12), m.gun, sx * 1.28, -0.44, -1.6 + k * 0.8, false, 0, 0, Math.PI / 2)); // 転輪
      }
      for (const zz of [-2.0, 2.0] as const) {
        this.rig.add(mp(new THREE.CylinderGeometry(0.3, 0.3, 0.66, 8), m.gun, sx * 1.28, -0.3, zz, false, 0, 0, Math.PI / 2)); // スプロケット
      }
      if (elite) {
        for (let k = 0; k < 4; k += 1) {
          this.rig.add(mp(boxGeo(0.5, 0.18, 0.5), m.armor, sx * 0.9, 0.55, -1.2 + k * 0.8, false)); // ERAブロック
        }
      }
    }
    // 旋回砲塔(影)+キューポラ+砲盾+俯仰砲身ピボット(死亡でブローオフ/俯角)
    const turret = new THREE.Group();
    turret.position.set(0, 0.95, 0.1);
    turret.add(mp(chamferBox(1.6, 0.6, 1.7, 0.06).clone(), m.armor, 0, 0, 0, true)); // 砲塔本体(影)
    turret.add(mp(chamferBox(1.0, 0.28, 0.9, 0.04).clone(), m.dark, 0, 0.42, 0.15, false)); // キューポラ
    turret.add(mp(new THREE.SphereGeometry(0.1, 10, 8), m.glow, 0, 0.5, 0.22, false)); // キューポラ照準器
    const barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0.05, -0.7);
    barrelPivot.add(mp(chamferBox(0.5, 0.42, 0.3, 0.03).clone(), m.armor, 0, 0, 0.1, false)); // 砲盾(mantlet)
    barrelPivot.add(mp(new THREE.CylinderGeometry(0.08, 0.11, 2.2, 10), m.gun, 0, 0, -1.2, false, Math.PI / 2, 0, 0)); // 砲身
    barrelPivot.add(mp(new THREE.CylinderGeometry(0.13, 0.13, 0.32, 10), m.gun, 0, 0, -2.35, false, Math.PI / 2, 0, 0)); // マズルブレーキ
    if (tier === 'boss') {
      barrelPivot.add(mp(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), m.gun, 0.18, -0.08, -0.9, false, Math.PI / 2, 0, 0)); // コアキシャル砲身
    }
    this.tankBarrel = barrelPivot;
    turret.add(barrelPivot);
    this.turretGroup = turret;
    this.rig.add(turret);
    // 背面エンジングリル(発光=弱点コライダー位置の視覚ヒント)。
    // 弱点コライダーは車体固定なので、砲塔ではなく車体側へ付けて常に一致させる
    this.rig.add(
      mp(boxGeo(0.9, 0.44, 0.16), m.glow, 0, 1.0, 0.92, false),
      mp(boxGeo(0.98, 0.08, 0.2), m.dark, 0, 1.11, 0.9, false),
      mp(boxGeo(0.98, 0.08, 0.2), m.dark, 0, 0.87, 0.9, false),
    );
    // グリル上の放熱スリット(no-shadow)
    for (let i = 0; i < 4; i += 1) {
      this.rig.add(mp(boxGeo(0.85, 0.03, 0.02), m.gun, 0, 0.82 + i * 0.1, 0.99, false));
    }
    // 死亡時の黒煙(通常は非表示。dyingTimer中に立ち上らせる)
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x0b0b0d,
      roughness: 1,
      transparent: true,
      opacity: TANK_SMOKE_OPACITY,
    });
    this.smokeMat = smokeMat;
    const smoke = new THREE.Group();
    smoke.visible = false;
    const radii = [0.4, 0.52, 0.66];
    for (let i = 0; i < radii.length; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(radii[i] ?? 0.5, 10, 8), smokeMat);
      puff.position.set((i - 1) * 0.3, 1.1 + i * 0.35, 1.0);
      smoke.add(puff);
      this.smokePuffs.push({ mesh: puff, baseY: puff.position.y });
    }
    this.smoke = smoke;
    this.rig.add(smoke);
    this.registerDissolve(m.armor, m.dark, m.gun, track);
    this.group.add(this.rig);
  }

  // 固定タレット: 開脚可能な三脚ベース+旋回ヘッド+2連銃身+索敵アイ+放熱スリット。
  // elite/boss は回転レーダー皿で格を出す。頂部の発光ドームが弱点コライダー
  // (ball 0.25 @+0.7)の視覚ヒント。三脚は turretLegs に格納し死亡で開脚→respawn復帰。
  private buildTurretMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    const elite = tier !== 'normal';
    const mp = this.mechMesh.bind(this);
    // 三脚ベース(接地アンカー。剛体中心は足元から0.9m)。脚はno-shadow
    for (let i = 0; i < 3; i += 1) {
      const leg = new THREE.Group();
      leg.rotation.y = (Math.PI * 2 * i) / 3;
      leg.add(mp(chamferBox(0.14, 0.85, 0.2, 0.03).clone(), m.dark, 0, -0.55, -0.3, false, 0.45, 0, 0)); // 脚
      leg.add(mp(chamferBox(0.2, 0.08, 0.34, 0.02).clone(), m.dark, 0, -0.88, -0.52, false)); // 接地パッド
      this.turretLegs.push(leg);
      this.rig.add(leg);
    }
    // 支柱(影)+ヨーク(影)。カプセルコライダー(0.5/0.4)に合わせた太さ
    this.rig.add(
      mp(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 10), m.dark, 0, -0.35, 0, true), // 支柱(影)
      mp(chamferBox(0.62, 0.3, 0.62, 0.04).clone(), m.armor, 0, 0.2, 0, true), // ヨーク(影)
    );
    // 旋回ヘッド(ベースは固定のままheadingへ追従する)
    const head = new THREE.Group();
    head.position.y = 0.42;
    head.add(mp(chamferBox(0.58, 0.34, 0.62, 0.04).clone(), m.armor, 0, 0.05, 0, true)); // 筐体(影)
    head.add(mp(new THREE.SphereGeometry(0.2, 14, 10), m.glow, 0, TURRET_HEAD_OFFSET - 0.42, 0, false)); // 頂部センサードーム(弱点)
    head.add(mp(new THREE.SphereGeometry(0.08, 10, 8), m.glow, 0, 0.05, -0.34, false)); // 索敵アイ
    // 側面の放熱スリット(no-shadow)
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        head.add(mp(boxGeo(0.02, 0.02, 0.3), m.gun, sx * 0.29, 0.05 - i * 0.08, 0, false));
      }
    }
    // 2連銃身(no-shadow)
    for (const sx of [-1, 1] as const) {
      head.add(mp(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), m.gun, sx * 0.1, 0.02, -0.5, false, Math.PI / 2, 0, 0));
    }
    // elite/boss: 回転レーダー皿(syncMeshのturret分岐でspin)
    if (elite) {
      const dish = new THREE.Group();
      dish.position.set(0, 0.28, 0.22);
      dish.add(mp(new THREE.CylinderGeometry(0.14, 0.02, 0.05, 12), m.dark, 0, 0, 0, false, Math.PI / 2, 0, 0)); // 皿
      dish.add(mp(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 6), m.gun, 0, 0, -0.09, false, Math.PI / 2, 0, 0)); // フィードホーン
      this.radarDish = dish;
      head.add(dish);
    }
    this.turretHead = head;
    this.rig.add(head);
    this.registerDissolve(m.armor, m.dark, m.gun);
    this.group.add(this.rig);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  headPosition(): THREE.Vector3 {
    const p = this.position;
    p.y += this.headOff;
    return p;
  }

  facing(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  /** 直近フレームの水平移動速度(m/s)。全kindで有効。足音システム等から参照する */
  get horizSpeedMps(): number {
    return this._horizSpeed;
  }

  update(dt: number, ctx: BotContext): void {
    if (!this.alive) {
      this._horizSpeed = 0;
      this.respawnIn -= dt;
      if (this.dyingTimer > 0) this.updateDying(dt);
      return;
    }

    // horizSpeedMps: 全kind共通の水平速度を毎フレーム更新(剛体位置差分。足音実装等が参照)
    {
      const _t = this.body.translation();
      const _hdx = _t.x - this._prevBodyPos.x;
      const _hdz = _t.z - this._prevBodyPos.z;
      this._horizSpeed = dt > 0 ? Math.hypot(_hdx, _hdz) / dt : 0;
      this._prevBodyPos.set(_t.x, _t.y, _t.z);
    }

    this.alert = Math.max(0, this.alert - dt);
    if (this.alert <= 0) this.alertPos = null;
    this.pain = Math.max(0, this.pain - dt);
    this.blind = Math.max(0, this.blind - dt);
    if (this.hitFlash > 0 && this.armorMat) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.armorMat.emissiveIntensity = this.tierGlowBase + (this.hitFlash / 0.12) * 0.7;
    }
    if (this.flinch > 0) this.flinch = Math.max(0, this.flinch - dt);
    const engaged = ctx.targetEye !== null;

    // ゾンビ: 銃を持たず近接のみ。'zombie' も !=='humanoid' なので、この直後の
    // not-humanoid分岐(updateTurret→updateShooting=砲台化して発砲)へ落ちる前に捌く
    if (this.kind === 'zombie') {
      this.anim += dt;
      this.updateZombie(dt, ctx);
      this.syncMesh();
      return;
    }

    // ── kind別ディスパッチ(humanoid以外は専用の移動体系を持つ)──
    if (this.kind !== 'humanoid') {
      if (this.kind === 'drone') this.updateDrone(dt, ctx);
      else if (this.kind === 'tank') this.updateTank(dt, ctx);
      else this.updateTurret(dt, ctx);
      this.updateShooting(dt, ctx, engaged);
      this.syncMesh();
      return;
    }

    // humanoidは呼吸/腕スウェイの位相にanimを使う(この経路では未加算だった)
    this.anim += dt;
    // 機械的エイム: 交戦中は毎フレーム aimDir を目標へ寄せる(reaction中も回すので
    // 反応が明けた頃には概ね収束=既存モードの初弾タイミングをほぼ維持しつつ、
    // 動く標的への追従は遅れて初弾がピクセルパーフェクトにならない)
    if (ctx.targetEye) this.slewAim(dt, ctx.targetEye, ctx.tuning.aimSlewRadS);

    let wishX = 0;
    let wishZ = 0;
    if (ctx.targetEye) {
      const toTarget = ctx.targetEye.clone().sub(this.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      toTarget.normalize();
      this.heading = Math.atan2(-toTarget.x, -toTarget.z);

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        this.strafeTimer = 1 + ctx.rand() * 2;
      }
      // アンスタック発動中は strafeOverride が strafe 方向を一時乗っ取る(combatのみ)
      const effectiveStrafeSign = this.unstuckStrafeOverride ?? this.strafeSign;
      const side = new THREE.Vector3(-toTarget.z, 0, toTarget.x).multiplyScalar(effectiveStrafeSign);
      // 9〜20mの交戦距離を保つ
      const approach = dist > 20 ? 1 : dist < 9 ? -1 : 0;
      wishX = (side.x * 0.8 + toTarget.x * approach) * this.moveSpeed;
      wishZ = (side.z * 0.8 + toTarget.z * approach) * this.moveSpeed;
    } else if (this.alert > 0 && this.alertPos && !ctx.objective) {
      // 警戒調査: 銃声などの音源方向へ振り向き、ゆっくり近づいて確かめる。
      // 千里眼にはならず「振り向いた結果、視野に入れば見つかる」自然な流れ。
      // 拠点(objective)持ちは調査で持ち場を放棄しない(ドミネーションの成立を守る)
      const toAlert = this.alertPos.clone().sub(this.position);
      toAlert.y = 0;
      const dist = toAlert.length();
      if (dist > 1e-3) this.heading = Math.atan2(-toAlert.x, -toAlert.z);
      if (dist > 4) {
        const f = this.facing();
        wishX = f.x * this.moveSpeed * 0.55;
        wishZ = f.z * this.moveSpeed * 0.55;
      } else {
        // 音源へ到着。何も見つからなければ調査を終える
        this.alertPos = null;
      }
    } else if (ctx.objective && this.position.distanceTo(ctx.objective) > 3) {
      // 拠点へ向かう。直進しすぎないよう周期的に揺らす
      // (headingが移動方向を兼ねるため、警戒中でも拠点行動を優先する)
      const toObjective = ctx.objective.clone().sub(this.position).setY(0).normalize();
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = Math.atan2(-toObjective.x, -toObjective.z) + (ctx.rand() - 0.5) * 0.7;
        this.headingTimer = 0.8 + ctx.rand() * 1.2;
      }
      const f = this.facing();
      wishX = f.x * this.moveSpeed * 0.85;
      wishZ = f.z * this.moveSpeed * 0.85;
    } else {
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = ctx.rand() * Math.PI * 2;
        this.headingTimer = 2 + ctx.rand() * 3;
      }
      const f = this.facing();
      wishX = f.x * this.moveSpeed * 0.7;
      wishZ = f.z * this.moveSpeed * 0.7;
    }

    this.velY = applyGravityStep(this.velY, 1, dt);
    const movement = { x: wishX * dt, y: this.velY * dt, z: wishZ * dt };
    this.controller.computeColliderMovement(this.bodyCollider, movement);
    const moved = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.velY < 0) this.velY = -0.5;

    // ── アンスタック: 進捗監視+側方ステア(戦闘=strafeOverride、非戦闘=heading転換)──
    // 直前の移動結果で「前進できているか」を評価し、0.8s 以上詰まっていたら発動する。
    // 戦闘中は heading が毎フレーム target へ向くため heading 書き換えは無効 → strafe 方向を
    // 乗っ取る。非戦闘は開いている側へ heading を向け直す(headingTimer でラッチ)。
    // ラッチ中は毎フレーム heading 再計算しないため、バウンドループが起きない。
    const wishLen = Math.hypot(movement.x, movement.z);
    const movedLen = Math.hypot(moved.x, moved.z);
    this.unstuckSteerS = Math.max(0, this.unstuckSteerS - dt);
    if (this.unstuckSteerS <= 0) this.unstuckStrafeOverride = null;
    if (this.unstuckSteerS <= 0) {
      if (wishLen > 0.001 && movedLen < wishLen * 0.25) {
        this.stuckTimer += dt;
        if (this.stuckTimer > HUMANOID_STUCK_TH) {
          const stuckP = this.position;
          const leftBlocked = this.probeDirection(stuckP, this.heading + Math.PI / 2);
          const rightBlocked = this.probeDirection(stuckP, this.heading - Math.PI / 2);
          if (ctx.targetEye) {
            // 戦闘中: strafeOverride で詰まっていない側へ誘導
            if (rightBlocked && !leftBlocked) this.unstuckStrafeOverride = -1;
            else if (leftBlocked && !rightBlocked) this.unstuckStrafeOverride = 1;
            else this.unstuckStrafeOverride = ctx.rand() < 0.5 ? 1 : -1;
          } else {
            // 非戦闘: 開いている側へ heading を向け直す
            if (!leftBlocked) this.heading += Math.PI / 2;
            else if (!rightBlocked) this.heading -= Math.PI / 2;
            else this.heading += Math.PI;
            this.headingTimer = HUMANOID_UNSTUCK_S;
          }
          this.unstuckSteerS = HUMANOID_UNSTUCK_S;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2); // 進捗あれば急速リセット
      }
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    });

    // 歩行アニメ: 実移動量から歩調(位相)と振幅を進める
    const step = Math.hypot(moved.x, moved.z);
    const targetAmp = Math.min(1, step / Math.max(1e-4, this.moveSpeed * dt));
    this.walkAmp += (targetAmp - this.walkAmp) * Math.min(1, dt * 8);
    this.walkPhase += step * 9;

    this.updateShooting(dt, ctx, engaged);
    this.syncMesh();
  }

  // 飛行ドローン: 重力もKCCも使わず、目標速度を積分して直接移動する。
  // 交戦中は12〜24mを保つ高速ストレイフ、警戒中は音源上空へ空中のまま接近、
  // それ以外は緩い旋回徘徊。壁は実移動方向へのレイ1本(自身除外)で回避する。
  private updateDrone(dt: number, ctx: BotContext): void {
    this.anim += dt;
    if (ctx.targetEye) this.slewAim(dt, ctx.targetEye, ctx.tuning.aimSlewRadS);
    const pos = this.position;
    let vx = 0;
    let vz = 0;
    if (ctx.targetEye) {
      const to = ctx.targetEye.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      if (dist > 1e-3) to.normalize();
      this.heading = Math.atan2(-to.x, -to.z);
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        this.strafeTimer = 0.8 + ctx.rand() * 1.4;
      }
      const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(this.strafeSign);
      const approach = dist > DRONE_ENGAGE_FAR ? 1 : dist < DRONE_ENGAGE_NEAR ? -1 : 0;
      vx = (side.x + to.x * approach * 0.9) * this.moveSpeed;
      vz = (side.z + to.z * approach * 0.9) * this.moveSpeed;
    } else if (this.alert > 0 && this.alertPos) {
      const to = this.alertPos.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      if (dist > 1e-3) this.heading = Math.atan2(-to.x, -to.z);
      if (dist > 5) {
        const f = this.facing();
        vx = f.x * this.moveSpeed * 0.6;
        vz = f.z * this.moveSpeed * 0.6;
      } else {
        // 音源上空へ到着。何も見つからなければ調査を終える
        this.alertPos = null;
      }
    } else if (ctx.objective && pos.distanceTo(ctx.objective) > 4) {
      const toObjective = ctx.objective.clone().sub(pos).setY(0).normalize();
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = Math.atan2(-toObjective.x, -toObjective.z) + (ctx.rand() - 0.5) * 0.5;
        this.headingTimer = 0.8 + ctx.rand() * 1.2;
      }
      const f = this.facing();
      vx = f.x * this.moveSpeed * 0.8;
      vz = f.z * this.moveSpeed * 0.8;
    } else {
      // 緩い旋回徘徊(人型のランダムスナップではなく連続旋回で飛行らしく)
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.wanderTurn = (ctx.rand() - 0.5) * 1.4;
        this.headingTimer = 1.5 + ctx.rand() * 2;
      }
      this.heading += this.wanderTurn * dt;
      const f = this.facing();
      vx = f.x * this.moveSpeed * 0.5;
      vz = f.z * this.moveSpeed * 0.5;
    }

    // 壁チェック: 実移動方向へレイ1本(facing方向ではない=横ストレイフの貫通防止)
    const speed = Math.hypot(vx, vz);
    if (speed > 0.05) {
      const ray = new RAPIER.Ray(
        { x: pos.x, y: pos.y, z: pos.z },
        { x: vx / speed, y: 0, z: vz / speed },
      );
      const hit = this.world.castRay(ray, 1.2, true, undefined, undefined, undefined, this.body);
      if (hit !== null) {
        this.heading += Math.PI;
        this.strafeSign *= -1;
        this.headingTimer = 1.2;
        vx = -vx;
        vz = -vz;
      }
    }

    // 高度: ホバー基準+正弦ボブへ上限速度で追従(スポーン直後は離陸になる)
    const targetY =
      this.hoverBaseY +
      Math.sin(this.anim * Math.PI * 2 * DRONE_BOB_HZ + this.bobPhase) * DRONE_BOB_AMP;
    const dy = THREE.MathUtils.clamp(targetY - pos.y, -DRONE_VERT_SPEED * dt, DRONE_VERT_SPEED * dt);
    this.body.setNextKinematicTranslation({ x: pos.x + vx * dt, y: pos.y + dy, z: pos.z + vz * dt });

    // 横速度に応じたロールバンク(飛んでいる説得力)
    const f = this.facing();
    const lateral = vx * -f.z + vz * f.x;
    const bankTarget = THREE.MathUtils.clamp(-lateral * 0.06, -0.35, 0.35);
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 5);
  }

  // 大型戦車: ストレイフ無しの前進/後退+上限付き旋回(にじり旋回)。KCC+重力は共有。
  // 車体コライダーと背面弱点球は setNextKinematicRotation で見た目の向きへ回す。
  private updateTank(dt: number, ctx: BotContext): void {
    this.anim += dt;
    const pos = this.position;
    let throttle = 0; // 前進+/後退-
    let desiredYaw = this.heading;
    let aimYaw: number | null = null;
    if (ctx.targetEye) {
      const to = ctx.targetEye.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      desiredYaw = Math.atan2(-to.x, -to.z);
      aimYaw = desiredYaw;
      throttle = dist > 26 ? 1 : dist < 12 ? -0.6 : 0;
    } else if (this.alert > 0 && this.alertPos) {
      const to = this.alertPos.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      if (dist > 1e-3) desiredYaw = Math.atan2(-to.x, -to.z);
      aimYaw = desiredYaw;
      if (dist > 6) throttle = 0.7;
      else this.alertPos = null;
    } else if (ctx.objective && pos.distanceTo(ctx.objective) > 5) {
      const toObjective = ctx.objective.clone().sub(pos).setY(0).normalize();
      desiredYaw = Math.atan2(-toObjective.x, -toObjective.z);
      throttle = 0.85;
    } else {
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.wanderYaw = ctx.rand() * Math.PI * 2;
        this.headingTimer = 3 + ctx.rand() * 3;
      }
      desiredYaw = this.wanderYaw;
      throttle = 0.6;
    }
    this.heading = stepAngle(this.heading, desiredYaw, TANK_TURN_RATE * dt);
    this.turretYaw = stepAngle(this.turretYaw, aimYaw ?? this.heading, TANK_TURRET_RATE * dt);
    // 大きく向きがずれている間は徐行し、その場旋回に近づける
    if (Math.abs(wrapAngle(desiredYaw - this.heading)) > 1.2) throttle *= 0.25;

    const f = this.facing();
    const wishX = f.x * throttle * this.moveSpeed;
    const wishZ = f.z * throttle * this.moveSpeed;
    this.velY = applyGravityStep(this.velY, 1, dt);
    const movement = { x: wishX * dt, y: this.velY * dt, z: wishZ * dt };
    this.controller.computeColliderMovement(this.bodyCollider, movement);
    const moved = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.velY < 0) this.velY = -0.5;

    // スタック検知: 徘徊先を引き直す(旋回上限があるので急スピンにはならない)
    const wishLen = Math.hypot(movement.x, movement.z);
    const movedLen = Math.hypot(moved.x, moved.z);
    if (wishLen > 0.001 && movedLen < wishLen * 0.25) {
      this.wanderYaw = ctx.rand() * Math.PI * 2;
      this.headingTimer = 2.5;
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    });
    // 車体cuboidと背面弱点球を見た目の向きへ回す(回転対称でないkindはtankだけ)
    const half = this.heading / 2;
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
  }

  // 固定タレット: 移動ゼロ。headingのみ上限付きでターゲットへ滑らかに追従し、
  // 非交戦時は設置向きを中心にスイープ索敵する。painの全周検知は既存のまま
  // 「背後から撃たれたら旋回して反撃する」という公平なカウンタープレイになる。
  private updateTurret(dt: number, ctx: BotContext): void {
    this.anim += dt;
    let desired: number;
    let rate = TURRET_TRACK_RATE;
    const pos = this.position;
    if (ctx.targetEye) {
      const to = ctx.targetEye.clone().sub(pos);
      desired = Math.atan2(-to.x, -to.z);
    } else if (this.alert > 0 && this.alertPos) {
      const to = this.alertPos.clone().sub(pos);
      desired = Math.atan2(-to.x, -to.z);
      rate = TURRET_TRACK_RATE * 0.8;
    } else {
      desired = this.sweepCenter + Math.sin(this.anim * 0.55) * 1.15;
      rate = TURRET_SWEEP_RATE;
    }
    this.heading = stepAngle(this.heading, desired, rate * dt);
  }

  // 機械的エイム: aimDirを目標方向へ最大 slewRadS*dt だけ回す(小ステップの
  // lerp+normalizeは1フレームの微小回転ではslerpの実用近似)。update/updateDroneが
  // 毎フレーム(reaction中も含め)呼ぶので、収束は反応時間と並走する。
  private slewAim(dt: number, targetEye: THREE.Vector3, slewRadS: number): void {
    const origin = this.headPosition();
    const want = targetEye.clone().sub(origin);
    if (want.lengthSq() < 1e-8) return;
    want.normalize();
    if (this.aimDir.lengthSq() < 1e-8) {
      this.aimDir.copy(want);
      return;
    }
    const cur = this.aimDir.clone().normalize();
    const dot = THREE.MathUtils.clamp(cur.dot(want), -1, 1);
    const angle = Math.acos(dot);
    if (angle < 1e-4) {
      this.aimDir.copy(want);
      return;
    }
    // R16修正: 一気にスナップさせず、1フレームで最大0.8までしか寄せない。これにより
    // 動く標的には持続的な追従遅れが残り、初弾がピクセルパーフェクトに当たりすぎない
    // (静止標的には幾何級数的に数フレームで収束)。fireゲート(aimDir方向で角度判定)が実効化する
    const maxStep = slewRadS * dt;
    const t = Math.min(0.8, maxStep / angle);
    this.aimDir.copy(cur).lerp(want, t).normalize();
  }

  // ゾンビ: 目標(=近接群れなのでプレイヤー位置を直接供給)へ前傾シャンブルで詰め、
  // 射程内で個体クールダウンが明けたら match へ近接ヒットを通知する。発砲経路には入らない。
  private updateZombie(dt: number, ctx: BotContext): void {
    const pos = this.position;
    let wishX = 0;
    let wishZ = 0;
    const target = ctx.targetEye;
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    if (target) {
      const to = target.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      if (dist > 1e-3) to.normalize();
      this.heading = Math.atan2(-to.x, -to.z);
      const spd = this.moveSpeed * this.zombieRunMul;
      wishX = to.x * spd;
      wishZ = to.z * spd;
      if (dist <= ZOMBIE_MELEE_RANGE) {
        wishX *= 0.15; // 密着で押し込みすぎない(重なり回避)
        wishZ *= 0.15;
        if (this.meleeTimer <= 0 && ctx.onMelee) {
          ctx.onMelee(this);
          this.meleeTimer = ZOMBIE_MELEE_CD;
        }
      }
    } else {
      // 通常はplayerを常に追うので稀。目標喪失時はゆっくり徘徊
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = ctx.rand() * Math.PI * 2;
        this.headingTimer = 1.5 + ctx.rand() * 2;
      }
      const f = this.facing();
      wishX = f.x * this.moveSpeed * 0.4;
      wishZ = f.z * this.moveSpeed * 0.4;
    }

    // ── 登坂アシスト: 前フレームに前進を阻まれ登坂点火済みで、まだ上限高さ未満なら、
    //    重力の代わりにゆっくり上向き速度を与えて障害物の上へ這い上がる。水平前進は
    //    弱めに継続して乗り上がる。上限到達 or 目標喪失なら重力へ戻る。────────────
    const wishLenH = Math.hypot(wishX, wishZ);
    const canRise = this.climbing && wishLenH > 0.01 && pos.y - this.climbBaseY < ZOMBIE_CLIMB_MAX_H;
    let vertV: number;
    if (canRise) {
      vertV = ZOMBIE_CLIMB_SPEED; // ゆっくり上昇。落下速度は打ち消して登坂へ切替
      this.velY = 0;
      wishX *= 0.55; // 水平前進は弱めに継続して障害物の上へ乗り上がる
      wishZ *= 0.55;
    } else {
      this.velY = applyGravityStep(this.velY, 1, dt);
      vertV = this.velY;
    }
    const movement = { x: wishX * dt, y: vertV * dt, z: wishZ * dt };
    this.controller.computeColliderMovement(this.bodyCollider, movement);
    const moved = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    if (grounded && this.velY < 0) this.velY = -0.5;
    // 接地して登坂していない間だけ登坂の基準足元Yを追従(上限高さ判定の起点=青天井防止)
    if (grounded && !canRise) this.climbBaseY = pos.y;
    // ── 登坂状態機械(R21フェーズ化で縁チャタリングを根治)──
    // 前進を阻まれたか(moved が wish よりかなり小さい)を評価する
    const wishLen = Math.hypot(movement.x, movement.z);
    const movedLen = Math.hypot(moved.x, moved.z);
    const blocked = wishLen > 0.001 && movedLen < wishLen * ZOMBIE_CLIMB_BLOCK;
    const underCap = pos.y - this.climbBaseY < ZOMBIE_CLIMB_MAX_H;
    this.climbCooldownS = Math.max(0, this.climbCooldownS - dt);
    this.climbMinS = Math.max(0, this.climbMinS - dt);

    if (this.climbing) {
      this.climbElapsedS += dt;
      // 強制終了: 上限高さを超えた or 最大継続時間を超過
      if (!underCap || this.climbElapsedS >= ZOMBIE_CLIMB_MAX_S) {
        if (!underCap) this.climbCooldownS = ZOMBIE_CLIMB_COOLDOWN; // 超高壁は再登坂を封じる
        else this.climbCooldownS = 0.3; // タイムアウト: 短いクールダウンで再試行可
        this.climbing = false;
        this.climbMinS = 0;
        this.climbElapsedS = 0;
        if (blocked) this.heading += (ctx.rand() - 0.5) * 1.6;
      } else if (this.climbMinS <= 0 && grounded && !blocked) {
        // 最小継続時間を過ぎ、接地でき、前進を妨げられていない → 乗り上げ完了
        this.climbing = false;
        this.climbElapsedS = 0;
      }
      // それ以外(最小時間内 / 空中 / まだ blocked): 登坂継続
    } else {
      this.climbElapsedS = 0;
      // 点火条件: クールダウン明け + 前進ブロック + 目標あり + 上限未満 + 前方に実体あり
      if (this.climbCooldownS <= 0 && blocked && target && underCap && this.obstacleAhead(pos)) {
        this.climbing = true;
        this.climbMinS = ZOMBIE_CLIMB_MIN_S; // 最小継続時間を設定(縁チャタリング防止)
      } else if (blocked) {
        // 登坂しない: クールダウン中/目標なし/上限超過/障害物なし → 横へ回り込む
        this.heading += (ctx.rand() - 0.5) * 1.6;
      }
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });
    const step = Math.hypot(moved.x, moved.z);
    const targetAmp = Math.min(1, step / Math.max(1e-4, this.moveSpeed * dt));
    this.walkAmp += (targetAmp - this.walkAmp) * Math.min(1, dt * 8);
    this.walkPhase += step * 8;
  }

  // アンスタック用: 指定角度の水平方向へ短いレイを撃ち、障害物があれば true を返す(humanoid専用)。
  // kinematic を含む全コライダーを対象とし、wallやpropへの引っかかり両方を検出する。
  private probeDirection(pos: THREE.Vector3, angle: number, dist = HUMANOID_PROBE_D): boolean {
    const dx = -Math.sin(angle);
    const dz = -Math.cos(angle);
    const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: dx, y: 0, z: dz });
    return this.world.castRay(ray, dist, true, undefined, undefined, undefined, this.body) !== null;
  }

  // 登坂アシスト用: 進行方向(=heading)前方に「静的地形/障害物」があるかを短いレイで確認する。
  // 膝〜胸の2高さで前方へ撃ち、どちらかが当たれば障害物ありとみなす。
  // V20修正: EXCLUDE_KINEMATIC で kinematic なプレイヤー/他ゾンビを除外し、fixed な床/障害物
  // (match側は RigidBodyDesc.fixed)だけを拾う。これによりゾンビがプレイヤーや仲間ゾンビを
  // よじ登って浮く/積み上がる不具合を根絶する(登坂は実在の静的障害物でのみ点火)。
  private obstacleAhead(pos: THREE.Vector3): boolean {
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    for (const oy of ZOMBIE_CLIMB_RAY_YS) {
      const ray = new RAPIER.Ray({ x: pos.x, y: pos.y + oy, z: pos.z }, { x: fx, y: 0, z: fz });
      const hit = this.world.castRay(
        ray,
        ZOMBIE_CLIMB_PROBE,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
        undefined,
        undefined,
        this.body,
      );
      if (hit !== null) return true;
    }
    return false;
  }

  private updateShooting(dt: number, ctx: BotContext, engaged: boolean): void {
    if (!engaged || !ctx.targetEye) {
      // 反応時間 = 難度reactionS × 個体差(0.7〜1.4) + 交戦開始オンセット(0〜0.35s)
      this.reaction = ctx.tuning.reactionS * this.reactionJitter + this.fireOnset;
      this.burstLeft = 0;
      return;
    }
    this.reaction -= dt;
    if (this.reaction > 0) return;

    const origin = this.headPosition();
    // 発砲方向: humanoid/droneは機械的slew aimDir、tank/turretは目標直行(旋回で律速)
    let fireDir: THREE.Vector3;
    if (this.kind === 'tank' || this.kind === 'turret') {
      // 砲身が目標へ向くまで発砲保留。旋回上限=「側面へ回り込めば撃たれない」攻略窓
      const to = ctx.targetEye.clone().sub(this.position);
      const wantYaw = Math.atan2(-to.x, -to.z);
      const aimYaw = this.kind === 'tank' ? this.turretYaw : this.heading;
      if (Math.abs(wrapAngle(wantYaw - aimYaw)) > AIM_GATE_RAD) return;
      fireDir = ctx.targetEye.clone().sub(origin).normalize();
    } else {
      // aimDirが目標へ十分寄るまで撃たない(初弾ピクセルパーフェクト回避)。
      // reaction中もupdate/updateDroneがslewしているので通常は既に収束済み
      const toTarget = ctx.targetEye.clone().sub(origin).normalize();
      if (this.aimDir.lengthSq() < 1e-8) this.aimDir.copy(toTarget);
      fireDir = this.aimDir.clone().normalize();
      if (fireDir.dot(toTarget) < AIM_FIRE_COS) return;
    }

    if (this.burstLeft <= 0) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.burstLeft = this.burstRounds(ctx.rand);
        this.shotTimer = 0;
      }
      return;
    }

    this.shotTimer -= dt;
    if (this.shotTimer > 0) return;
    this.shotTimer = this.shotInterval();
    this.burstLeft -= 1;
    if (this.burstLeft === 0) {
      this.pauseTimer =
        ctx.tuning.burstPauseMin +
        ctx.rand() * (ctx.tuning.burstPauseMax - ctx.tuning.burstPauseMin);
    }

    const dir = fireDir.clone();
    const spread = (ctx.tuning.spreadDeg * Math.PI) / 180;
    const r = spread * Math.sqrt(ctx.rand());
    const theta = ctx.rand() * Math.PI * 2;
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir
      .addScaledVector(right, Math.tan(Math.cos(theta) * r))
      .addScaledVector(up, Math.tan(Math.sin(theta) * r))
      .normalize();
    ctx.onShoot(origin, dir);
  }

  // kind別のバースト長。humanoidは従来の3〜5発を維持する
  private burstRounds(rand: Rand): number {
    if (this.kind === 'tank') return 1; // 主砲: 単発、長い装填(burstPauseで表現)
    if (this.kind === 'drone') return 3; // 3連バースト
    if (this.kind === 'turret') return 6 + Math.floor(rand() * 5); // 持続制圧
    return 3 + Math.floor(rand() * 3);
  }

  // kind別の発射間隔。humanoid/tank(単発)は従来の0.16sを維持する
  private shotInterval(): number {
    if (this.kind === 'drone') return 0.09;
    if (this.kind === 'turret') return 0.12;
    return 0.16;
  }

  // kind別の死亡演出。dyingTimerを使い切ったら非表示になる。
  // 機械はdissolveU(崩落ディゾルブ)を進め、humanoidは膝崩れ→前傾横倒しの2段。
  private updateDying(dt: number): void {
    this.dyingTimer -= dt;
    const t = 1 - Math.max(0, this.dyingTimer) / KIND_DEATH_S[this.kind];
    if (this.kind === 'drone') {
      // 横スピンしながら落下→着地後にディゾルブ(kinematicは放置では落ちない)
      this.dieVel += 9.81 * dt;
      const floor = this.dieFloorY ?? this.group.position.y;
      const nextY = Math.max(floor, this.group.position.y - this.dieVel * dt);
      const landed = nextY <= floor + 1e-3;
      this.group.position.y = nextY;
      this.group.rotation.z += dt * (landed ? 2 : 11);
      this.group.rotation.x += dt * (landed ? 0.5 : 4);
      this.dissolveU.value = landed
        ? THREE.MathUtils.clamp(this.dissolveU.value + dt * 2.6, 0, 1)
        : 0;
    } else if (this.kind === 'tank') {
      // 砲塔ブローオフ(上方へ弾け前傾)+砲身跳上げ、内部フラッシュ(t<0.15)→崩落ディゾルブ
      const blow = THREE.MathUtils.clamp(t / 0.3, 0, 1);
      if (this.turretGroup) {
        this.turretGroup.position.y = 0.95 + blow * 0.9;
        this.turretGroup.rotation.z = blow * 0.7 * (this.deathTilt >= 0 ? 1 : -1);
        this.turretGroup.rotation.x = -blow * 0.5;
      }
      if (this.tankBarrel) this.tankBarrel.rotation.x = blow * 0.6;
      this.group.position.y = this.dieBaseY - t * 0.25;
      // 内部フラッシュはブローオフ初期のみ(以降は明示的に0へ戻す)
      if (t < 0.15) {
        const f = 1 - t / 0.15;
        for (const g of this.glowMats) g.mat.emissiveIntensity = 0.9 + f * 3.5;
      } else {
        for (const g of this.glowMats) g.mat.emissiveIntensity = 0;
      }
      if (this.smoke) {
        this.smoke.visible = true;
        for (const puff of this.smokePuffs) {
          puff.mesh.position.y = puff.baseY + t * 1.6;
          puff.mesh.scale.setScalar(1 + t * 1.8);
        }
      }
      if (this.smokeMat) this.smokeMat.opacity = TANK_SMOKE_OPACITY * (1 - t * 0.55);
      this.dissolveU.value = THREE.MathUtils.clamp((t - 0.3) / 0.7, 0, 1);
    } else if (this.kind === 'turret') {
      // 支柱ごと横倒し+ヘッド前傾、三脚が開脚→崩落ディゾルブ
      this.group.rotation.z = -1.25 * t;
      if (this.turretHead) this.turretHead.rotation.x = t * 0.9;
      for (const leg of this.turretLegs) leg.rotation.x = -t * 0.4;
      this.dissolveU.value = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
    } else {
      // humanoid: 膝崩れ(前段)→前傾横倒し(後段)。deathTiltで左右リーンに個体差
      const buckle = THREE.MathUtils.clamp(t / 0.45, 0, 1);
      this.legL.rotation.x = buckle * 0.3;
      this.legR.rotation.x = buckle * 0.3;
      this.kneeL.rotation.x = buckle * 1.4;
      this.kneeR.rotation.x = buckle * 1.4;
      this.rig.position.y = -buckle * 0.22;
      const fall = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
      const ease = fall * fall * (3 - 2 * fall); // smoothstep
      this.group.rotation.x = ease * (Math.PI / 2) * 0.95;
      this.group.rotation.z = ease * this.deathTilt;
    }
    if (this.dyingTimer <= 0) this.group.visible = false;
  }

  syncMesh(): void {
    const t = this.body.translation();
    this.group.position.set(t.x, t.y, t.z);
    if (!this.alive) return;
    if (this.kind === 'turret') {
      // ベース(三脚)は設置向きのまま固定し、ヘッドだけがheadingへ旋回する
      this.group.rotation.y = 0;
      if (this.turretHead) this.turretHead.rotation.y = this.heading;
      if (this.radarDish) this.radarDish.rotation.y = this.anim * 1.6; // elite/boss索敵レーダー
      return;
    }
    this.group.rotation.y = this.heading;
    if (this.kind === 'drone') {
      // ローターを高速回転(隣接は逆回転)+横移動のロールバンク
      for (let i = 0; i < this.rotors.length; i += 1) {
        const rotor = this.rotors[i];
        if (rotor) rotor.rotation.y = this.anim * 30 * (i % 2 === 0 ? 1 : -1);
      }
      this.rig.rotation.z = this.bank;
      return;
    }
    if (this.kind === 'tank') {
      // 砲塔は車体と独立に目標方位へ滑らかに旋回する(車体ローカル角へ変換)
      if (this.turretGroup) this.turretGroup.rotation.y = wrapAngle(this.turretYaw - this.heading);
      return;
    }
    if (this.kind === 'zombie') {
      // シャンブル歩容: 前傾 + 左右のよろめき + 逆位相の脚スイング + 前へ垂らした腕の揺れ。
      // humanoidの歩行コードへ落とすと armRig をライフル把持ポーズで毎フレーム上書きしてしまう
      const zs = Math.sin(this.walkPhase);
      const zswing = zs * this.walkAmp * 0.65;
      this.legL.rotation.x = zswing;
      this.legR.rotation.x = -zswing;
      this.kneeL.rotation.x = Math.max(0, -zs) * this.walkAmp * 0.9;
      this.kneeR.rotation.x = Math.max(0, zs) * this.walkAmp * 0.9;
      this.rig.rotation.x = 0.26 + Math.sin(this.anim * 3.1) * 0.045; // 常時前傾+上下よろめき
      this.rig.rotation.z = Math.sin(this.anim * 1.7 + this.bobPhase) * 0.07; // 左右のよろめき
      this.rig.position.y = Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.03;
      if (this.armRig) {
        this.armRig.rotation.x = Math.sin(this.anim * 2.3) * 0.12; // 前へ突き出した腕を揺らす
        this.armRig.rotation.z = Math.sin(this.anim * 1.3 + this.bobPhase) * 0.05;
      }
      return;
    }
    // 歩行サイクル: 左右の脚を逆位相でスイングし、接地脚側の膝を曲げ、胴を上下させる
    const s = Math.sin(this.walkPhase);
    const swing = s * this.walkAmp * 0.8;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.kneeL.rotation.x = Math.max(0, -s) * this.walkAmp;
    this.kneeR.rotation.x = Math.max(0, s) * this.walkAmp;
    // 呼吸: 静止時ほど胴を上下させる(walkAmpが小さいほど呼吸が目立つ)
    const idle = 1 - Math.min(1, this.walkAmp);
    const breath = Math.sin(this.anim * 2.1) * 0.012 * idle;
    this.rig.position.y = Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.04 + breath;
    // 被弾時の一瞬ののけぞり(上体を後ろへ傾ける)
    this.rig.rotation.x = -(this.flinch / 0.14) * 0.18;
    // armRigの微スウェイ(把持ポーズを保ったまま±0.14rad内で揺らす)
    if (this.armRig) {
      this.armRig.rotation.x = Math.sin(this.anim * 1.5) * 0.05 * idle - swing * 0.12;
      this.armRig.rotation.z = Math.sin(this.anim * 0.9 + 1.1) * 0.03 * idle;
    }
  }

  // fromDir = 本体→射手の方向(match が射手原点から供給)。humanoidは pain 中この
  // ±120°扇形のみ検知して脅威方向へ振り向く(千里眼防止)。tank/turret/drone は painDir を
  // 見ず従来どおり全周(R8ボスが背面射撃へ反撃できる根拠=非回帰)。無指定は全周フォールバック。
  takeDamage(amount: number, fromDir?: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.alert = 5;
    // 撃たれた本人は短時間だけ扇形/全周検知(撃たれて振り向くのは自然な反応)
    this.pain = 2.0;
    if (fromDir && fromDir.lengthSq() > 1e-8) {
      this.painDir = fromDir.clone().setY(0).normalize();
      this.alertPos = this.position.clone().addScaledVector(this.painDir, 6);
    } else {
      this.painDir = null;
    }
    this.hitFlash = 0.12;
    this.flinch = 0.14;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      this.respawnIn = 3;
      this.dyingTimer = KIND_DEATH_S[this.kind];
      this.dieVel = 0;
      this.dieBaseY = this.group.position.y;
      if (this.kind === 'drone') {
        // 墜落の床位置をレイ1本で確定しておく(地面貫通の防止)
        const p = this.position;
        const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
        const hit = this.world.castRay(ray, 40, true, undefined, undefined, undefined, this.body) as unknown as {
          toi?: number;
          timeOfImpact?: number;
        } | null;
        this.dieFloorY = hit
          ? p.y - (hit.toi ?? hit.timeOfImpact ?? 0) + DRONE_BODY_RADIUS * 0.55
          : p.y - DRONE_HOVER_ALT;
      }
      // 死亡フレームでupdateの被弾発光減衰(alive早期returnの後)が止まるため、
      // ここで明示的に消す。さもないと倒れる演出中ずっと装甲が光ったままになる
      this.hitFlash = 0;
      this.flinch = 0;
      this.rig.rotation.x = 0;
      if (this.armorMat) this.armorMat.emissiveIntensity = 0;
      // グリル/センサー等の常時発光も消灯する(tankの「発光を消す」等)
      for (const g of this.glowMats) g.mat.emissiveIntensity = 0;
      // 機械は崩落ディゾルブを点火(defines一度だけ)+固い残影を止める。humanoidはno-op
      this.startDissolve();
      // 死体を見えない壁にしない。リスポーンまで弾と移動の判定から外す
      this.bodyCollider.setEnabled(false);
      this.headCollider.setEnabled(false);
      for (const c of this.extraColliders) c.setEnabled(false);
      return true;
    }
    return false;
  }

  respawnAt(spawn: THREE.Vector3): void {
    this.hp = this.maxHp;
    this.alive = true;
    this.velY = 0;
    this.alert = 0;
    this.alertPos = null;
    this.pain = 0;
    this.painDir = null;
    this.blind = 0;
    // 知覚FSM / 機械的エイム / 近接をリセット(VOID_Y救済やリスポーン再利用で持ち越さない)
    this.spotAwareness = 0;
    this.aiState = 'patrol';
    this.engageGrace = 0;
    this.lkp = null;
    this.lastTargetEye = null;
    this.lastCandidateUid = -1;
    this.lastRawVisible = false;
    this.aimDir.set(0, 0, 0);
    this.meleeTimer = 0;
    // 登坂状態をリセット(リスポーン再利用で持ち越さない)。基準足元Yはスポーン地点に置く
    this.climbing = false;
    this.climbBaseY = spawn.y + this.feetOffset;
    this.climbCooldownS = 0;
    this.climbMinS = 0;
    this.climbElapsedS = 0;
    // humanoidアンスタック状態もリセット
    this.stuckTimer = 0;
    this.unstuckSteerS = 0;
    this.unstuckStrafeOverride = null;
    // horizSpeedMps: スポーン地点を前フレーム位置として初期化(最初のフレームでスパイクしない)
    this._horizSpeed = 0;
    this._prevBodyPos.set(spawn.x, spawn.y + this.feetOffset, spawn.z);
    this.group.visible = true;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0; // drone墜落/turret転倒のリセット
    this.walkAmp = 0;
    this.rig.position.y = 0;
    this.rig.rotation.x = 0;
    this.rig.rotation.z = 0; // droneバンクのリセット
    this.bank = 0;
    this.hitFlash = 0;
    this.flinch = 0;
    if (this.armorMat) this.armorMat.emissiveIntensity = this.tierGlowBase;
    for (const g of this.glowMats) g.mat.emissiveIntensity = g.base;
    // tankの黒煙を巻き戻す
    if (this.smoke) {
      this.smoke.visible = false;
      for (const puff of this.smokePuffs) {
        puff.mesh.position.y = puff.baseY;
        puff.mesh.scale.setScalar(1);
      }
    }
    if (this.smokeMat) this.smokeMat.opacity = TANK_SMOKE_OPACITY;
    // 崩落ディゾルブを巻き戻し、死亡が触った全子トランスフォームを基準へ戻す。
    // (defines は点火したまま value=0 で無害。needsUpdate no-opは回避)
    this.dissolveU.value = 0;
    if (this.dissolveMats.length > 0) this.setMechShadows(true); // userData.noShadowを尊重して復元
    if (this.turretGroup) {
      this.turretGroup.position.set(0, 0.95, 0.1); // tank砲塔ブローオフの復帰
      this.turretGroup.rotation.set(0, 0, 0);
    }
    if (this.tankBarrel) this.tankBarrel.rotation.set(0, 0, 0); // tank砲身俯仰の復帰
    if (this.turretHead) this.turretHead.rotation.set(0, 0, 0); // turretヘッド前傾の復帰
    for (const leg of this.turretLegs) leg.rotation.x = 0; // turret三脚開脚の復帰
    // humanoidの膝崩れで曲げた脚(死亡分岐が触る)を戻す。syncMeshでも上書きされるが明示
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(0, 0, 0);
    this.kneeR.rotation.set(0, 0, 0);
    this.hoverBaseY = spawn.y + DRONE_HOVER_ALT; // drone以外では未使用
    this.dieFloorY = null;
    this.bodyCollider.setEnabled(true);
    this.headCollider.setEnabled(true);
    for (const c of this.extraColliders) c.setEnabled(true);
    this.body.setTranslation({ x: spawn.x, y: spawn.y + this.feetOffset, z: spawn.z }, true);
    this.syncMesh();
  }

  // 死んで死亡演出も終わった(=解放してよい)か。ゾンビの死体回収(cleanupDeadZombies)の判定。
  get corpseCleared(): boolean {
    return !this.alive && this.dyingTimer <= 0;
  }

  // 近接影LOD: 遠いゾンビの castShadow を止める(mapSize churnを避け周期トグルされる)。
  // 元々no-shadowだったディテール(userData.noShadow)は点け直さない。
  setCastShadow(on: boolean): void {
    this.rig.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = on && obj.userData.noShadow !== true;
    });
  }

  // 単体除去(ゾンビ死体の解放)。RigidBody除去で付随colliderも自動解放され、
  // group配下の(merge済み一意)geometry/materialを解放する。共有寸法キャッシュは
  // mergeByMaterialがcloneして焼くのでここには含まれず、破棄対象にならない。
  dispose(): void {
    // R16修正: KinematicCharacterController も解放(無限ゾンビモードでの青天井リーク防止)
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else mat.dispose();
      }
    });
  }
}
