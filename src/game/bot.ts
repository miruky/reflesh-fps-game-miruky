import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
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
const TANK_SMOKE_OPACITY = 0.85;

export type Difficulty = 'easy' | 'normal' | 'hard';
// 敵の階層。normal=通常兵、elite=精鋭(高HP/俊敏)、boss=章末の超強敵
export type BotTier = 'normal' | 'elite' | 'boss';
// 敵のアーキタイプ。humanoid=従来の人型、drone=飛行、tank=大型戦車、turret=固定砲台
export type BotKind = 'humanoid' | 'drone' | 'tank' | 'turret';

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
}

export const DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { spreadDeg: 5.5, reactionS: 0.6, damage: 8, burstPauseMin: 1.0, burstPauseMax: 1.6, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 55 },
  normal: { spreadDeg: 3.2, reactionS: 0.38, damage: 11, burstPauseMin: 0.7, burstPauseMax: 1.2, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 60 },
  hard: { spreadDeg: 1.9, reactionS: 0.22, damage: 14, burstPauseMin: 0.5, burstPauseMax: 0.9, maxHp: 100, moveSpeedMul: 1, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 68 },
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
  drone: { maxHp: 60, moveSpeedMul: 1.4, viewDistM: 70 },
  tank: {
    maxHp: 2200,
    damage: 26,
    moveSpeedMul: 0.45,
    viewDistM: 90,
    reactionS: 0.5,
    burstPauseMin: 1.6,
    burstPauseMax: 2.4,
  },
  turret: { maxHp: 160, moveSpeedMul: 0, viewDistM: 65 },
};

// アーキタイプごとの体格(コンストラクタ/respawnAtの単一の真実)
const KIND_FEET_OFFSET: Record<BotKind, number> = {
  humanoid: CENTER_TO_FEET,
  drone: 0, // 浮遊するので足元オフセットなし
  tank: TANK_HALF_H,
  turret: TURRET_BODY_HALF + TURRET_BODY_RADIUS,
};
// humanoid以外は頭(弱点)コライダーの高さを体格で固定する(tuningと乖離させない)
const KIND_HEAD_OFFSET: Record<BotKind, number> = {
  humanoid: HEAD_OFFSET,
  drone: DRONE_HEAD_OFFSET,
  tank: TANK_HEAD_Y,
  turret: TURRET_HEAD_OFFSET,
};
// 死亡演出の長さ(s)
const KIND_DEATH_S: Record<BotKind, number> = {
  humanoid: 0.4,
  drone: 1.1,
  tank: 1.4,
  turret: 0.5,
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
function meshPart(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
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
    emissiveIntensity: 0.9, // AgX+Bloom前提で白飛びを抑える(バイザーと同値)
    roughness: 0.3,
  });
  const gun = new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.5 });
  return { armor, dark, glow, gun, tierGlow };
}

export class Bot {
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
  // 被弾直後の短い戦闘覚醒。この間だけ全周検知(撃たれたら振り向くのは自然)
  pain = 0;
  blind = 0; // フラッシュで目が眩んでいる残り秒数

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
    // KCCはhumanoid/tankのみ使用するが生成は共通(最小差分。World破棄で回収される)
    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.4, 0.3, true);
    this.controller.enableSnapToGround(0.4);

    if (kind === 'drone') this.buildDroneMesh(color, tier);
    else if (kind === 'tank') this.buildTankMesh(color, tier);
    else if (kind === 'turret') this.buildTurretMesh(color, tier);
    else this.buildMesh(color, tier);
    // 当たり判定は固定のまま、見た目だけ階層スケール(原則1.0なので無害)
    if (tuning.scale !== 1) this.group.scale.setScalar(tuning.scale);
  }

  // チーム色の装甲・暗い下地・発光バイザーで構成したヒューマノイド兵士。
  // 当たり判定(胴カプセル+頭球)は別管理なので見た目は自由に組める。
  private buildMesh(color: number, tier: BotTier): void {
    const c = new THREE.Color(color);
    // 強敵は常時わずかに発光する装甲で威圧する(scaleを使わずに格を表現)
    const tierGlow = tier === 'boss' ? 0.55 : tier === 'elite' ? 0.28 : 0;
    const armor = new THREE.MeshStandardMaterial({
      color: c,
      roughness: tier === 'normal' ? 0.55 : 0.42,
      metalness: tier === 'normal' ? 0.12 : 0.32,
      emissive: c.clone(),
      emissiveIntensity: tierGlow,
    });
    this.armorMat = armor;
    this.tierGlowBase = tierGlow;
    const dark = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.42),
      roughness: 0.6,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0d0f13,
      emissive: c.clone(),
      emissiveIntensity: 0.9, // AgX+Bloom前提で白飛びを抑える(バイザー)
      roughness: 0.3,
    });
    const gun = new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.5 });
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // 胴・腰・胸・背・肩・首・頭・ヘルメット・発光バイザーと胸の発光帯
    this.rig.add(
      part(box(0.4, 0.26, 0.28), dark, 0, -0.2, 0), // 腰
      part(box(0.38, 0.3, 0.28), armor, 0, 0.02, 0), // 腹
      part(box(0.52, 0.38, 0.32), armor, 0, 0.34, 0), // 胸
      part(box(0.54, 0.06, 0.02), glow, 0, 0.36, -0.17), // 胸の発光帯
      part(box(0.3, 0.34, 0.16), dark, 0, 0.3, 0.2), // バックパック
      part(box(0.18, 0.16, 0.22), dark, -0.32, 0.5, 0), // 左肩
      part(box(0.18, 0.16, 0.22), dark, 0.32, 0.5, 0), // 右肩
      part(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), dark, 0, 0.6, 0), // 首
      part(new THREE.SphereGeometry(0.19, 16, 12), dark, 0, HEAD_OFFSET, 0), // 頭
      part(box(0.3, 0.17, 0.32), armor, 0, HEAD_OFFSET + 0.08, 0.02), // ヘルメット
      part(box(0.27, 0.09, 0.06), glow, 0, HEAD_OFFSET - 0.01, -0.16), // 発光バイザー
    );

    // 腕(ライフルを前方に構える静的ポーズ)
    const arm = (sx: number) => {
      const g = new THREE.Group();
      g.position.set(sx, 0.48, 0);
      g.rotation.x = -1.15;
      g.rotation.z = -sx * 0.4;
      g.add(part(box(0.12, 0.3, 0.12), armor, 0, -0.13, 0)); // 上腕
      g.add(part(box(0.1, 0.28, 0.1), dark, 0, -0.34, 0.02)); // 前腕
      return g;
    };
    this.rig.add(arm(-0.34), arm(0.34));

    // 構えるライフル
    const rifle = new THREE.Group();
    rifle.position.set(0.02, 0.34, -0.36);
    rifle.add(part(box(0.08, 0.1, 0.42), gun, 0, 0, 0));
    rifle.add(part(box(0.04, 0.04, 0.3), gun, 0, 0.01, -0.32));
    rifle.add(part(box(0.05, 0.16, 0.08), gun, 0, -0.12, 0.04));
    this.rig.add(rifle);

    // 脚(股関節ピボット + 膝ピボット)。歩行で前後にスイングする
    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number) => {
      pivot.position.set(sx, -0.18, 0);
      pivot.add(part(box(0.15, 0.32, 0.16), armor, 0, -0.16, 0)); // 腿
      knee.position.set(0, -0.32, 0);
      knee.add(part(box(0.13, 0.3, 0.14), dark, 0, -0.15, 0)); // 脛
      knee.add(part(box(0.14, 0.08, 0.26), dark, 0, -0.3, -0.05)); // 足
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -0.12);
    buildLeg(this.legR, this.kneeR, 0.12);

    this.group.add(this.rig);
  }

  // 飛行ドローン: 中央コア球+十字アーム4本+先端ローター+下向き発光アイ。
  // 頂部の発光ドームが弱点コライダー(ball 0.2 @+0.45)の視覚ヒントと一致する
  private buildDroneMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    this.rig.add(
      meshPart(new THREE.SphereGeometry(0.32, 16, 12), m.armor), // 中央コア
      meshPart(new THREE.CylinderGeometry(0.1, 0.14, 0.16, 10), m.dark, 0, 0.3, 0), // 首
      meshPart(new THREE.SphereGeometry(DRONE_HEAD_RADIUS - 0.02, 14, 10), m.glow, 0, DRONE_HEAD_OFFSET, 0), // 頂部センサードーム(弱点)
      meshPart(new THREE.SphereGeometry(0.09, 10, 8), m.glow, 0, -0.24, -0.16), // 下向き発光アイ
      meshPart(new THREE.CylinderGeometry(0.06, 0.09, 0.18, 8), m.gun, 0, -0.32, 0), // 腹部ガンポッド
    );
    // 十字アーム4本+各先端に回転ローター(細い円柱ブレード2枚)
    for (let i = 0; i < 4; i += 1) {
      const arm = new THREE.Group();
      arm.rotation.y = Math.PI / 4 + (Math.PI / 2) * i;
      arm.add(meshPart(boxGeo(0.09, 0.05, 0.58), m.dark, 0, 0.1, -0.42));
      const rotor = new THREE.Group();
      rotor.position.set(0, 0.16, -0.66);
      rotor.add(meshPart(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8), m.gun)); // シャフト
      const blade1 = meshPart(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 6), m.dark, 0, 0.05, 0);
      blade1.rotation.z = Math.PI / 2;
      const blade2 = meshPart(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 6), m.dark, 0, 0.05, 0);
      blade2.rotation.x = Math.PI / 2;
      rotor.add(blade1, blade2);
      this.rotors.push(rotor);
      arm.add(rotor);
      this.rig.add(arm);
    }
    this.group.add(this.rig);
  }

  // 大型戦車: 車体+履帯+旋回砲塔+長砲身。背面のエンジングリル発光が
  // 弱点コライダー(ball 0.35 @ y+1.0, z+0.9)の視覚ヒント
  private buildTankMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    const track = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 });
    // 車体(コライダー cuboid(1.6, 0.7, 2.2) の内側に収める)
    this.rig.add(
      meshPart(boxGeo(2.5, 0.8, 4.3), m.armor, 0, 0.15, 0), // 上部車体
      meshPart(boxGeo(2.3, 0.6, 3.4), m.dark, 0, -0.35, 0), // 下部シャシー
      meshPart(boxGeo(2.3, 0.24, 0.7), m.dark, 0, 0.42, -1.9), // 前面グレイシス
      meshPart(boxGeo(1.7, 0.1, 0.03), m.glow, 0, 0.56, -2.16), // 前照灯バー
    );
    // 履帯(暗色の長箱)+転輪の円柱
    for (const sx of [-1, 1]) {
      this.rig.add(meshPart(boxGeo(0.6, 0.8, 4.4), track, sx * 1.28, -0.3, 0));
      for (let k = 0; k < 5; k += 1) {
        const wheel = meshPart(
          new THREE.CylinderGeometry(0.26, 0.26, 0.64, 12),
          m.gun,
          sx * 1.28,
          -0.44,
          -1.6 + k * 0.8,
        );
        wheel.rotation.z = Math.PI / 2;
        this.rig.add(wheel);
      }
    }
    // 旋回砲塔+長い砲身
    const turret = new THREE.Group();
    turret.position.set(0, 0.95, 0.1);
    turret.add(meshPart(boxGeo(1.6, 0.6, 1.7), m.armor, 0, 0, 0));
    turret.add(meshPart(boxGeo(1.0, 0.28, 0.9), m.dark, 0, 0.42, 0.15)); // キューポラ
    const barrel = meshPart(new THREE.CylinderGeometry(0.08, 0.11, 2.6, 10), m.gun, 0, 0.05, -2.1);
    barrel.rotation.x = Math.PI / 2;
    turret.add(barrel);
    const muzzle = meshPart(new THREE.CylinderGeometry(0.13, 0.13, 0.32, 10), m.gun, 0, 0.05, -3.25);
    muzzle.rotation.x = Math.PI / 2;
    turret.add(muzzle);
    this.turretGroup = turret;
    this.rig.add(turret);
    // 背面エンジングリル(発光=弱点コライダー位置の視覚ヒント)。
    // 弱点コライダーは車体固定なので、砲塔ではなく車体側へ付けて常に一致させる
    this.rig.add(
      meshPart(boxGeo(0.9, 0.44, 0.16), m.glow, 0, 1.0, 0.92),
      meshPart(boxGeo(0.98, 0.08, 0.2), m.dark, 0, 1.11, 0.9),
      meshPart(boxGeo(0.98, 0.08, 0.2), m.dark, 0, 0.87, 0.9),
    );
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
    this.group.add(this.rig);
  }

  // 固定タレット: 三脚ベース+旋回ヘッド+短い2連銃身+索敵アイ。
  // 頂部の発光ドームが弱点コライダー(ball 0.25 @+0.7)の視覚ヒント
  private buildTurretMesh(color: number, tier: BotTier): void {
    const m = makeKindMats(color, tier);
    this.armorMat = m.armor;
    this.tierGlowBase = m.tierGlow;
    this.glowMats.push({ mat: m.glow, base: 0.9 });
    // 三脚ベース(接地アンカー。剛体中心は足元から0.9m)
    for (let i = 0; i < 3; i += 1) {
      const leg = new THREE.Group();
      leg.rotation.y = (Math.PI * 2 * i) / 3;
      const thigh = meshPart(boxGeo(0.14, 0.85, 0.2), m.dark, 0, -0.55, -0.3);
      thigh.rotation.x = 0.45;
      leg.add(thigh);
      leg.add(meshPart(boxGeo(0.2, 0.08, 0.34), m.dark, 0, -0.88, -0.52)); // 接地パッド
      this.rig.add(leg);
    }
    // 支柱+ヨーク(カプセルコライダー(0.5/0.4)に合わせた太さ)
    this.rig.add(
      meshPart(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 10), m.dark, 0, -0.35, 0),
      meshPart(boxGeo(0.62, 0.3, 0.62), m.armor, 0, 0.2, 0),
    );
    // 旋回ヘッド(ベースは固定のままheadingへ追従する)
    const head = new THREE.Group();
    head.position.y = 0.42;
    head.add(meshPart(boxGeo(0.58, 0.34, 0.62), m.armor, 0, 0.05, 0)); // 筐体
    head.add(
      meshPart(new THREE.SphereGeometry(0.2, 14, 10), m.glow, 0, TURRET_HEAD_OFFSET - 0.42, 0), // 頂部センサードーム(弱点)
    );
    head.add(meshPart(new THREE.SphereGeometry(0.08, 10, 8), m.glow, 0, 0.05, -0.34)); // 索敵アイ
    for (const sx of [-1, 1]) {
      const gunBarrel = meshPart(
        new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8),
        m.gun,
        sx * 0.1,
        0.02,
        -0.5,
      );
      gunBarrel.rotation.x = Math.PI / 2;
      head.add(gunBarrel);
    }
    this.turretHead = head;
    this.rig.add(head);
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

  update(dt: number, ctx: BotContext): void {
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.dyingTimer > 0) this.updateDying(dt);
      return;
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

    // ── kind別ディスパッチ(humanoid以外は専用の移動体系を持つ)──
    if (this.kind !== 'humanoid') {
      if (this.kind === 'drone') this.updateDrone(dt, ctx);
      else if (this.kind === 'tank') this.updateTank(dt, ctx);
      else this.updateTurret(dt, ctx);
      this.updateShooting(dt, ctx, engaged);
      this.syncMesh();
      return;
    }

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
      const side = new THREE.Vector3(-toTarget.z, 0, toTarget.x).multiplyScalar(this.strafeSign);
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

    // 壁に引っかかったら進路を変える
    const wishLen = Math.hypot(movement.x, movement.z);
    const movedLen = Math.hypot(moved.x, moved.z);
    if (wishLen > 0.001 && movedLen < wishLen * 0.25) {
      this.heading = ctx.rand() * Math.PI * 2;
      this.headingTimer = 1.5;
      this.strafeSign *= -1;
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

  private updateShooting(dt: number, ctx: BotContext, engaged: boolean): void {
    if (!engaged || !ctx.targetEye) {
      this.reaction = ctx.tuning.reactionS;
      this.burstLeft = 0;
      return;
    }
    this.reaction -= dt;
    if (this.reaction > 0) return;

    // tank/turretは砲身が目標へ向くまで発砲を保留する。
    // 旋回上限が「側面へ回り込めば撃たれない」という実際の攻略窓になる
    if (this.kind === 'tank' || this.kind === 'turret') {
      const to = ctx.targetEye.clone().sub(this.position);
      const wantYaw = Math.atan2(-to.x, -to.z);
      const aimYaw = this.kind === 'tank' ? this.turretYaw : this.heading;
      if (Math.abs(wrapAngle(wantYaw - aimYaw)) > AIM_GATE_RAD) return;
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

    const origin = this.headPosition();
    const dir = ctx.targetEye.clone().sub(origin).normalize();
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

  // kind別の死亡演出。dyingTimerを使い切ったら非表示になる
  private updateDying(dt: number): void {
    this.dyingTimer -= dt;
    const t = 1 - Math.max(0, this.dyingTimer) / KIND_DEATH_S[this.kind];
    if (this.kind === 'drone') {
      // 回転しつつ落下する(kinematicは放置では落ちないので自前積分)
      this.dieVel += 9.81 * dt;
      const floor = this.dieFloorY ?? this.group.position.y;
      this.group.position.y = Math.max(floor, this.group.position.y - this.dieVel * dt);
      this.group.rotation.z += dt * 9;
    } else if (this.kind === 'tank') {
      // 車体が沈み、機関部から黒煙が立ち上る(発光はtakeDamageで消灯済み)
      this.group.position.y = this.dieBaseY - t * 0.5;
      if (this.smoke) {
        this.smoke.visible = true;
        for (const puff of this.smokePuffs) {
          puff.mesh.position.y = puff.baseY + t * 1.6;
          puff.mesh.scale.setScalar(1 + t * 1.8);
        }
      }
      if (this.smokeMat) this.smokeMat.opacity = TANK_SMOKE_OPACITY * (1 - t * 0.55);
    } else if (this.kind === 'turret') {
      this.group.rotation.z = -1.25 * t; // 支柱ごと横へ倒れる
    } else {
      // 倒れる演出。残り時間で寝かせていく(humanoid現行維持)
      this.group.rotation.x = (-Math.PI / 2) * t;
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
    // 歩行サイクル: 左右の脚を逆位相でスイングし、接地脚側の膝を曲げ、胴を上下させる
    const s = Math.sin(this.walkPhase);
    const swing = s * this.walkAmp * 0.8;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.kneeL.rotation.x = Math.max(0, -s) * this.walkAmp;
    this.kneeR.rotation.x = Math.max(0, s) * this.walkAmp;
    this.rig.position.y = Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.04;
    // 被弾時の一瞬ののけぞり(上体を後ろへ傾ける)
    this.rig.rotation.x = -(this.flinch / 0.14) * 0.18;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.alert = 5;
    // 撃たれた本人は短時間だけ全周検知(撃たれて振り向くのは自然な反応)
    this.pain = 2.0;
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
    this.blind = 0;
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
    this.hoverBaseY = spawn.y + DRONE_HOVER_ALT; // drone以外では未使用
    this.dieFloorY = null;
    this.bodyCollider.setEnabled(true);
    this.headCollider.setEnabled(true);
    for (const c of this.extraColliders) c.setEnabled(true);
    this.body.setTranslation({ x: spawn.x, y: spawn.y + this.feetOffset, z: spawn.z }, true);
    this.syncMesh();
  }
}
