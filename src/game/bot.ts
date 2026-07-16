import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrapAngle } from './aimassist';
import type { Rand } from '../core/rng';
import { applyGravityStep } from './player';
// R53-W2契約: 特殊ゾンビ変種の識別子はzombie-economy.ts側が単一の真実として定義する
// (経済/報酬ロジックとの結び付きが強いため)。並行実装中は一時的にtscが赤くなり得る
// (report参照)。
import type { ZombieVariant } from './zombie-economy';
// R54-W1(B1) 密集ゾンビの物理ライト化: 対ゾンビKCC除外個体の重なり回避に使う空間ハッシュ。
import { ZombieSeparationGrid } from './spatial-hash';

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
// 蛍光グリーン化(視認性向上)。ボスは既存の識別色(赤エンブレム/赤い目)を維持し、通常/精鋭のみ
// 変更する。体色(albedo)側で鮮やかさを作り発光は控えめに留めるので、bloom閾値0.9は無関係
// (armorは非発光)。眼の発光(glow)だけがemissiveなので≤0.55に抑えて白飛びを防ぐ
const ZOMBIE_SKIN_NORMAL = 0x39d465;
const ZOMBIE_SKIN_ELITE = 0x5cffa8; // 精鋭は明るめの蛍光グリーンで通常との識別を維持
const ZOMBIE_EYE_COLOR = 0x39ff6a;
const ZOMBIE_EYE_INTENSITY = 0.5; // ≤0.55目安(bloom閾値0.9未満を大きく下回る)
// ゾンビボス体格(コライダー×1.8・視覚×2.3)
const ZOMBIE_BOSS_BODY_HALF = BODY_HALF * 1.8;    // 0.81
const ZOMBIE_BOSS_BODY_RADIUS = BODY_RADIUS * 1.8; // 0.63
const ZOMBIE_BOSS_HEAD_RADIUS = HEAD_RADIUS * 1.8; // 0.396
const ZOMBIE_BOSS_HEAD_OFFSET = HEAD_OFFSET * 1.8; // 1.584
const ZOMBIE_BOSS_CENTER_TO_FEET = ZOMBIE_BOSS_BODY_HALF + ZOMBIE_BOSS_BODY_RADIUS; // 1.44
const ZOMBIE_BOSS_MELEE_RANGE = 4.2; // 通常の約2倍の近接射程
// 達人 (master) 近接: 極近距離で刃を振る(射撃との複合攻撃)
const MASTER_MELEE_RANGE = 1.8;
const MASTER_MELEE_CD = 0.8;
// 巨躯 (giant) 体格: コライダー×1.8
const GIANT_BODY_HALF = BODY_HALF * 1.8;
const GIANT_BODY_RADIUS = BODY_RADIUS * 1.8;
const GIANT_HEAD_RADIUS = HEAD_RADIUS * 1.8;
const GIANT_HEAD_OFFSET = HEAD_OFFSET * 1.8;
const GIANT_CENTER_TO_FEET = GIANT_BODY_HALF + GIANT_BODY_RADIUS;
const GIANT_MELEE_RANGE = 4.0;
const GIANT_MELEE_CD = 1.5;
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

export interface HumanoidCombatMoveWeights {
  /** target方向。正=前進、負=後退。 */
  readonly longitudinal: number;
  /** target方向に直交する横移動量。 */
  readonly lateral: number;
}

/**
 * 人型BOTの交戦移動を前後主体へする純関数。
 * 旧挙動は適正距離9〜20mで longitudinal=0 / lateral=0.8 のため反復横跳びになっていた。
 */
export function humanoidCombatMoveWeights(
  distanceM: number,
  depthSign: -1 | 1,
  options: {
    readonly flee: boolean;
    readonly feared: boolean;
    readonly unstuck: boolean;
    readonly master: boolean;
  },
): HumanoidCombatMoveWeights {
  if (options.flee || options.feared) {
    return { longitudinal: -0.95, lateral: options.unstuck ? 0.7 : 0.12 };
  }
  const longitudinal =
    distanceM > 21 ? 0.95 :
      distanceM < 9.5 ? -0.88 :
        depthSign * (distanceM > 15 ? 0.58 : -0.48);
  const lateral = options.unstuck ? 0.78 : options.master ? 0.32 : 0.2;
  return { longitudinal, lateral };
}
// ── R55 ⑧ ゾンビ専用: 迂回の連続失敗エスカレーション ──────────────────────────
// 短周期(stuckTimer/unstuckSteerS)の迂回試行が同じ壁へ繰り返し戻ってしまう場合、
// 失敗の度にラッチ時間/横成分を強める(humanoidの同系フィールドは共用するが、この
// エスカレーション自体はゾンビ専用のstateで管理し、humanoidの挙動には触れない)。
const ZOMBIE_UNSTUCK_ESCALATE_S = 0.25; // 失敗を重ねるたびラッチへ加算する秒数
const ZOMBIE_UNSTUCK_MAX_ATTEMPTS = 4;  // エスカレーションの頭打ち回数
// ── R55 ⑧ ゾンビ専用: 迂回を尽くしても本当に動けない個体の最終安全弁 ─────────────
// stuckTimer/unstuckSteerSは「一時的なブロック」への短周期対応であり、その検知/対応
// ロジック自体に死角(完全に囲まれたポケット等)があっても、実位置のドリフトを長周期で
// 独立にサンプリングするこのタイマーだけは「本当に前進できているか」しか見ないため、
// zombie-director側のテレポート救済と組み合わせて「倒せずラウンドが永久に進まない」を
// 構造的に防ぐ最後の砦になる。
const ZOMBIE_HARD_STUCK_CHECK_S = 1.0;   // 位置ドリフトのサンプリング間隔(秒)
const ZOMBIE_HARD_STUCK_MOVE_M = 0.4;    // このサンプル間隔での移動距離がこれ未満なら「停滞」1票
const ZOMBIE_HARD_STUCK_RELOCATE_S = 5;  // 停滞の累積がこの秒数に達したら救済テレポート対象(視界外優先)
const ZOMBIE_HARD_STUCK_FORCE_S = 9;     // 視界外を待っても救済できない場合の強制テレポート閾値
// R57 ⑥修正1: 密着判定(下のreset gate)の垂直版。target=ctx.targetEye(プレイヤー"目"のY、
// 立位でfeet+約1.62m) / pos=ゾンビ体幹中心のY(feetからCENTER_TO_FEET≒0.8m上)なので、同一地面高
// (段差0)でも両者の差は eyeHeight-centerToFeet ≒ 0.8m前後になる。桟橋等プレイヤーが
// 2.4m超登れない高所にいるケース(差≒3m超)は明確にこれを超えるため、日常の高低差(足場の
// 段差程度)は免除を維持しつつ、真下で届かない偽近接だけをふるい分けられる値として1.6mを採る。
const ZOMBIE_MELEE_VERT_RANGE_M = 1.6;
// R55 W-C6: 登坂『成功終了』(climbMinS経過&&grounded&&!blocked。updateZombie内)の直後クールダウン。
// 旧実装はこの終了パスにだけクールダウンを設定しておらず(!underCap/timeout側の2経路のみ設定)、
// 越えられない縁でgrounded&&!blockedが一瞬だけ成立→即成功終了→次フレーム即再点火、という
// climbing on/off チャタリングを起こし得た。その1フレームの隙間(climbing=false)は
// ZOMBIE_HARD_STUCK_CHECK_S(1.0s)未満のため、下のhardStuckサンプリング窓が完走できず
// 最終安全弁(hardStuckS)が永久に発火しなかった。ZOMBIE_HARD_STUCK_CHECK_S超の値にすることで、
// 成功終了のたびに必ずCHECK_Sを上回るclimbing=false区間が生まれ、サンプリング窓を完走できる
// ことを保証する(ZOMBIE_HARD_STUCK_CHECK_S定義に追随して自動的に安全側へ保たれる)。
const ZOMBIE_CLIMB_SUCCESS_COOLDOWN = ZOMBIE_HARD_STUCK_CHECK_S + 0.1; // = 1.1s
const TANK_SMOKE_OPACITY = 0.85;

export type Difficulty = 'easy' | 'normal' | 'hard';
// 敵の階層。normal=通常兵、elite=精鋭(高HP/俊敏)、boss=章末の超強敵
export type BotTier = 'normal' | 'elite' | 'boss';
// 敵のアーキタイプ。humanoid=従来の人型、drone=飛行、tank=大型戦車、turret=固定砲台、
// zombie=BO2式ラウンド制の近接群れ(銃無し・前傾シャンブル)
export type BotKind = 'humanoid' | 'drone' | 'tank' | 'turret' | 'zombie' | 'master' | 'giant';

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

// viewDistM はエリア×3��大に合わせ humanoid ~1.4倍(easy 55→77 / normal 60→84 / hard 68→95)。
// ゾンビ(近接)は 120 維持(KIND_TUNING 参照)。
export const DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { spreadDeg: 5.5, reactionS: 0.6, damage: 8, burstPauseMin: 1.0, burstPauseMax: 1.6, maxHp: 100, moveSpeedMul: 2, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 77, spotTimeS: 1.8, aimSlewRadS: 2.6 },
  normal: { spreadDeg: 3.2, reactionS: 0.38, damage: 11, burstPauseMin: 0.7, burstPauseMax: 1.2, maxHp: 100, moveSpeedMul: 2, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 84, spotTimeS: 1.1, aimSlewRadS: 4.2 },
  hard: { spreadDeg: 1.9, reactionS: 0.22, damage: 14, burstPauseMin: 0.5, burstPauseMax: 0.9, maxHp: 100, moveSpeedMul: 2, scale: 1, headOffset: HEAD_OFFSET, viewDistM: 95, spotTimeS: 0.6, aimSlewRadS: 6.3 },
};

// 階層ごとの上書き差分。base(難度)へスプレッドして合成する。
// scale は hitreg(当たり判定とのズレ)回避のため拡大せず、威圧は色/発光で表現する。
export const ELITE_TUNING: Partial<BotTuning> = {
  maxHp: 180,
  moveSpeedMul: 2.3,
  reactionS: 0.2,
  spreadDeg: 1.8,
  damage: 15,
  viewDistM: 100, // エリア×3拡大対応: 75→100(×1.33)
  spotTimeS: 0.45,
  aimSlewRadS: 7.0,
};
export const BOSS_TUNING: Partial<BotTuning> = {
  maxHp: 900,
  moveSpeedMul: 1.84,
  reactionS: 0.16,
  spreadDeg: 1.5,
  damage: 18,
  scale: 1,
  viewDistM: 120, // エリア×3拡大対応: 90→120(×1.33)
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
// KIND_TUNING viewDistM: エリア×3拡大対応で humanoid 系 ~1.3-1.4倍。ゾンビは近接のため 120 維持。
export const KIND_TUNING: Record<BotKind, Partial<BotTuning>> = {
  humanoid: {},
  drone: { maxHp: 60, moveSpeedMul: 2.8, viewDistM: 95, spotTimeS: 0.4 }, // 70→95(×1.36)
  tank: {
    maxHp: 2200,
    damage: 26,
    moveSpeedMul: 0.9,
    viewDistM: 120, // 90→120(×1.33)
    reactionS: 0.5,
    burstPauseMin: 1.6,
    burstPauseMax: 2.4,
    spotTimeS: 0.4,
    aimSlewRadS: 1.4,
  },
  turret: { maxHp: 160, moveSpeedMul: 0, viewDistM: 90, spotTimeS: 0.4, aimSlewRadS: 1.2 }, // 65→90(×1.38)
  // ゾンビは銃を持たず近接のみ。HP/速度は spawnZombie が tuning に載せて渡す(致命バグ回避=
  // spawnBot merge で KIND_TUNING が後勝ちになるため maxHp/moveSpeedMul は絶対に入れない)。
  // damage=爪の一撃, reactionS/burstPause は発砲経路に入らないので実質未使用。
  // viewDistM: 近接追尾のため 120 維持(エリア拡大の影響なし)。
  zombie: { viewDistM: 120, reactionS: 0, damage: 22, burstPauseMin: 99, burstPauseMax: 99 },
  // R59②: 達人HPは一般兵(100)の2倍=200(旧600は硬すぎた)。章ボス個体は spawnBot の
  // boss床(Math.max(merged.maxHp, tuning.maxHp=900×hpMul))で決まるためこの変更の影響を受けない
  master: { maxHp: 200, moveSpeedMul: 2.5, reactionS: 0.10, spreadDeg: 0.8, damage: 22, viewDistM: 130, spotTimeS: 0.15, aimSlewRadS: 16.0, burstPauseMin: 0.3, burstPauseMax: 0.6, scale: 1.15 },
  giant:  { maxHp: 1500, moveSpeedMul: 1.6, damage: 45, viewDistM: 100, reactionS: 0.5, spotTimeS: 0.4, burstPauseMin: 99, burstPauseMax: 99 },
};

// アーキタイプごとの体格(コンストラクタ/respawnAtの単一の真実)
const KIND_FEET_OFFSET: Record<BotKind, number> = {
  humanoid: CENTER_TO_FEET,
  drone: 0, // 浮遊するので足元オフセットなし
  tank: TANK_HALF_H,
  turret: TURRET_BODY_HALF + TURRET_BODY_RADIUS,
  zombie: CENTER_TO_FEET, // 人型と同じカプセル体格
  master: CENTER_TO_FEET,
  giant:  GIANT_CENTER_TO_FEET,
};
// humanoid以外は頭(弱点)コライダーの高さを体格で固定する(tuningと乖離させない)
const KIND_HEAD_OFFSET: Record<BotKind, number> = {
  humanoid: HEAD_OFFSET,
  drone: DRONE_HEAD_OFFSET,
  tank: TANK_HEAD_Y,
  turret: TURRET_HEAD_OFFSET,
  zombie: HEAD_OFFSET,
  master: HEAD_OFFSET,
  giant:  GIANT_HEAD_OFFSET,
};
// 死亡演出の長さ(s)。humanoid/zombieは膝崩れ→前傾横倒しの2段演出のため 0.6 に延長
const KIND_DEATH_S: Record<BotKind, number> = {
  humanoid: 0.6,
  drone: 1.1,
  tank: 1.4,
  turret: 0.5,
  zombie: 0.6,
  master: 0.6,
  giant:  0.7,
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

// R53 黒雷帝の怯え: feared中のbot命中率係数(0.5=半減)。★V-D修正(コメント訂正):
// 実効spreadの拡散(spread / fearAccuracyMul = 2倍)は bot.ts 内の updateShooting
// (fearMul適用点)で行う — match側は applyEmperorFear で _fearS を設定するだけ。
export const fearAccuracyMul = 0.5;

// ★2 巨躯KCC距離LOD: プレイヤー30m超はuid%2バケットの担当フレームのみ
// computeColliderMovement(衝突解決)を実行する。60Hzで1フレーム分の並進差は
// 数cm=30m先では視認不能。30m以内は毎フレーム(近接戦闘の precision 非回帰)
export const GIANT_KCC_LOD_DIST_M = 30;
export function giantKccActive(uid: number, frame: number, distToPlayerM: number): boolean {
  if (distToPlayerM <= GIANT_KCC_LOD_DIST_M) return true;
  return (frame & 1) === (uid & 1);
}

// ★ ゾンビKCC距離LOD: updateZombieのcomputeColliderMovementを距離バケット化。
// ≤25m=毎フレーム、25-60m=uid%2(2フレームに1回)、60m超=uid%4(4フレームに1回)。
// 登坂中(climbing)またはmelee射程内は呼び出し側で常時フルを保証する。
// ★5 群衆ランクKCC LOD(R100高密度対策): ≤25m圏内でも hordeRank(match側が0.25s毎に
// 近い順で書き込む。0=最近接)が ZOMBIE_HORDE_THIN_RANK 以上(=先頭集団外)ならuid%2へ
// 間引く。先頭集団(hordeRank<24)・登坂中・melee交戦中は呼び出し側/この関数で常時フルを維持。
export const ZOMBIE_KCC_LOD_NEAR_M = 25;
export const ZOMBIE_KCC_LOD_MID_M = 60;
export const ZOMBIE_HORDE_THIN_RANK = 24;
export function zombieKccActive(
  uid: number,
  frame: number,
  distToPlayerM: number,
  hordeRank = 0,
): boolean {
  if (distToPlayerM <= ZOMBIE_KCC_LOD_NEAR_M) {
    if (hordeRank >= ZOMBIE_HORDE_THIN_RANK) return (frame & 1) === (uid & 1);
    return true;
  }
  if (distToPlayerM <= ZOMBIE_KCC_LOD_MID_M) return (frame & 1) === (uid & 1);
  return (frame & 3) === (uid & 3);
}

// ★1/★5 アンスタックのstuckTimer実時間補正用: zombieKccActiveと同じバケットから
// 「何フレームに1回フル解決されるか」を返す。閾値はzombieKccActiveと必ず同期させること
// (判定がズレるとLODスキップ分のdt補正が実時間からドリフトする)。
export function zombieKccSkipFactor(distToPlayerM: number, hordeRank = 0): number {
  if (distToPlayerM <= ZOMBIE_KCC_LOD_NEAR_M) return hordeRank >= ZOMBIE_HORDE_THIN_RANK ? 2 : 1;
  if (distToPlayerM <= ZOMBIE_KCC_LOD_MID_M) return 2;
  return 4;
}

// ── R54-W1(B1)/R100 密集ゾンビの物理ライト化 ────────────────────────────────
// hordeRank>=ZOMBIE_HORDE_THIN_RANK(群衆後方)の個体は、updateZombieのcomputeColliderMovement
// へfilterPredicateを渡し「他ゾンビのbodyCollider」だけを衝突解決の対象から除外する
// (被弾レイ/爆風/近接判定・obstacleAhead等の他クエリは一切変更しない=非干渉)。
//
// R100ではさらにゾンビ同士だけが通常physics.stepで接触ペアを生成しないinteraction groupを
// body/headへ設定する。これはKCCの明示shape queryとは独立で、前衛のKCC衝突は既存テストで
// 維持される。他オブジェクトは既定ALL groupなので地形・プレイヤー・弾レイとの相互作用は
// そのまま。後方だけをKCC queryから除外する役割は引き続きfilterPredicateが担う。
//
// 識別方法: Bot生成時にkind==='zombie'ならWorld単位のSet<collider.handle>へ登録し、
// dispose()で解除する(WeakMap<World, Set<number>>でWorldをまたぐhandle番号の再利用に
// よる誤判定を構造的に防ぐ。試合ごとdispose契約と整合し、Worldが破棄されればGC対象)。
const zombieHandlesByWorld = new WeakMap<RAPIER.World, Set<number>>();
function zombieHandleSet(world: RAPIER.World): Set<number> {
  let set = zombieHandlesByWorld.get(world);
  if (set === undefined) {
    set = new Set<number>();
    zombieHandlesByWorld.set(world, set);
  }
  return set;
}

// ── R54-W1(B1) 群衆分離の空間ハッシュ(申し送り) ────────────────────────────
// 対ゾンビKCCを除外された個体は互いにすり抜けて重なり得るため、代わりにこの軽量グリッドで
// 反発ベクトルを計算しwishへ加算する(spatial-hash.ts参照)。rebuild()は0.25s周期でhordeRank
// を再計算する側(zombie-director.ts)から全ゾンビの{uid,x,z}を渡して呼ぶのが自然だが、
// 本ラウンドはzombie-director.tsが並行編集中のため配線しない(申し送り事項。統合パスで
// 「0.25s毎にrebuild([...zAlive].map(b=>({uid:b.uid,x:b.position.x,z:b.position.z})))」を
// 追加すること)。rebuild()が一度も呼ばれない間は格子が空 → separation()は常に{x:0,z:0}を
// 返すため、配線が完了するまでこのグリッドは完全に無害(非回帰)。
export const zombieSeparationGrid = new ZombieSeparationGrid();
// updateZombie内でのみ使うアロケゼロ出力先(GIANT_POS_SCRATCH等と同じ流儀)
const ZOMBIE_SEP_SCRATCH = { x: 0, z: 0 };

// ★5 ホットパス用スクラッチ(updateGiantの毎フレームnew Vector3を根絶)
const GIANT_POS_SCRATCH = new THREE.Vector3();
const GIANT_TO_SCRATCH = new THREE.Vector3();
// R53-T5: humanoid/master(mainのupdate内インライン移動ロジック)とupdateZombieの
// 毎フレームnew Vector3(this.position getter + target/alertPos/objectiveへの.clone())を
// 同じ流儀で根絶する。update()は1体ずつ同期的に呼ばれるため(フレーム内で他個体の
// updateと競合しない)、モジュールレベル使い回しで安全(GIANT_*と同じ前提)。
const HUMANOID_POS_SCRATCH = new THREE.Vector3();
const HUMANOID_TO_SCRATCH = new THREE.Vector3();
const HUMANOID_SIDE_SCRATCH = new THREE.Vector3();
const ZOMBIE_POS_SCRATCH = new THREE.Vector3();
const ZOMBIE_TO_SCRATCH = new THREE.Vector3();

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

// ★7 軽量化: ゾンビの dark マテリアル(hitFlash等で個体別に変化しない=armor/glowと違い
// emissiveIntensityを操作しない)をtier×色で共有する。キーは実際に使う最終色(色相/tierから
// 一意に決まる)。dispose保護: userData.shared=true を立て、Bot#disposeは共有材をdisposeしない
// (viewmodel.tsの共有マテリアルと同じ userData.shared パターン)。プール再利用
// (resetForZombieReuse)は色を変えない前提のため、このキャッシュとも整合する。
const ZOMBIE_DARK_MAT_CACHE = new Map<number, THREE.MeshStandardMaterial>();
function getSharedZombieDarkMat(darkColor: THREE.Color): THREE.MeshStandardMaterial {
  const key = darkColor.getHex();
  let mat = ZOMBIE_DARK_MAT_CACHE.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: darkColor.clone(),
      roughness: 0.9,
      metalness: 0.02,
      vertexColors: true,
    });
    mat.userData.shared = true;
    ZOMBIE_DARK_MAT_CACHE.set(key, mat);
  }
  return mat;
}

// ── R53-W2 特殊ゾンビ変種の共有マテリアル(R51 dark共有キャッシュと同じ流儀)──
// variant追加パーツの見た目はtierGlow等の個体差を持たないため、キー(変種+役割)で
// 1体につき1マテリアルを使い回す。dispose保護は ZOMBIE_DARK_MAT_CACHE と同じく
// userData.shared=true。ジオメトリは各Botインスタンスがprivate variantMeshesに
// 追加した個体別プリミティブ(安価なSphere/Box)なので、そちらは通常どおり
// dispose/除去してよい(共有はマテリアルのみ・個体クローン禁止の対象は色/発光設定)。
const ZOMBIE_VARIANT_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function getSharedVariantMat(
  key: string,
  factory: () => THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  let mat = ZOMBIE_VARIANT_MAT_CACHE.get(key);
  if (!mat) {
    mat = factory();
    mat.userData.shared = true;
    ZOMBIE_VARIANT_MAT_CACHE.set(key, mat);
  }
  return mat;
}
// blast: 腹部の発光パスチュール(橙赤、emissive 0.5 ≤ 0.55 上限/bloom閾値0.9未満)
const BLAST_PUSTULE_SPECS: readonly [number, number, number, number][] = [
  [-0.06, 0.1, -0.12, 0.07],
  [0.05, 0.05, -0.13, 0.06],
  [0.0, 0.18, -0.11, 0.05],
];

// ═══ R53-W3: ゾンビ群InstancedMesh化(src/render/zombie-crowd.ts)との共有定義 ═══
// 部位ルート(body/arm/thigh/shin)のパーツ構成は、個体Object3D経路(buildZombieMesh)と
// 群レンダラの正準ジオメトリ(buildZombieCrowdGeometries)の両方が下の zombie*Root を
// 通る=単一定義。両経路の見た目乖離は構造的に起きない(行列レベルの等価性は
// zombie-crowd.test.ts が固定する)。boss専用装飾(裂け目/rig.scale2.3)と variant装飾は
// buildZombieMesh 側にのみ存在し、群レンダラの対象外(boss/variantは常にObject3D経路)。

// 変形ノードの静止オフセット(buildZombieMeshと群レンダラの行列合成が共有する唯一の値)
export const ZOMBIE_NODE_REST = {
  armRigY: 0.4,
  legX: 0.11,
  legY: -0.16,
  kneeY: -0.3,
} as const;

// 群レンダラの正準マテリアル生成に必要なスタイル値(buildZombieMeshの実値の鏡写し。
// instanceColor は diffuse にのみ乗るため、armor/dark は白ベース+instanceColor=スキン色、
// glow(眼)は固定emissiveで全個体共通)
export const ZOMBIE_CROWD_STYLE = {
  skinNormal: ZOMBIE_SKIN_NORMAL,
  skinElite: ZOMBIE_SKIN_ELITE,
  darkMul: 0.4, // dark系の色 = スキン色×0.4(getSharedZombieDarkMatへの引数と同じ)
  armorRoughness: 0.85,
  armorMetalness: 0.05,
  darkRoughness: 0.9,
  darkMetalness: 0.02,
  glowColor: 0x0a0d07,
  eyeColor: ZOMBIE_EYE_COLOR,
  eyeIntensity: ZOMBIE_EYE_INTENSITY,
  glowRoughness: 0.4,
} as const;

interface ZombiePartMats {
  armor: THREE.Material;
  dark: THREE.Material;
  glow: THREE.Material;
}

// buildZombieMesh 旧ローカルP()の module 版(構成の単一定義点として共有)
function zPart(
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
): void {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx !== 0 || ry !== 0 || rz !== 0) m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  root.add(m);
}

// ── 胴・頭(影を落とすシルエット + no-shadowディテール)──
function zombieBodyRoot(m: ZombiePartMats): THREE.Group {
  const root = new THREE.Group();
  zPart(root, taperPrism(0.24, 0.2, 0.58, 7, 0.66), m.armor, 0, 0.16, 0, true); // やせ細った胴
  zPart(root, chamferBox(0.34, 0.24, 0.13, 0.03), m.armor, 0, 0.31, -0.05, true); // 露出した肋骨帯
  zPart(root, taperPrism(0.2, 0.16, 0.18, 7, 0.7), m.dark, 0, -0.2, 0, false); // 腰
  zPart(root, new THREE.CylinderGeometry(0.055, 0.07, 0.14, 8), m.dark, 0.02, 0.56, -0.02, false, -0.18, 0, 0.12); // 傾いた首(前方=-Zへうなだれる)
  zPart(root, new THREE.SphereGeometry(0.16, 12, 10), m.dark, 0.03, 0.72, -0.05, false); // うなだれた頭
  zPart(root, chamferBox(0.16, 0.05, 0.05, 0.02), m.dark, 0.03, 0.7, -0.18, false); // 顎
  // 落ちくぼんだ眼光(左右)
  zPart(root, new THREE.SphereGeometry(0.026, 8, 6), m.glow, -0.05, 0.74, -0.17, false);
  zPart(root, new THREE.SphereGeometry(0.026, 8, 6), m.glow, 0.1, 0.74, -0.17, false);
  zPart(root, new THREE.BoxGeometry(0.16, 0.03, 0.02), m.glow, 0.02, 0.22, -0.16, false); // 胸の腐敗発光帯
  return root;
}

// ── 前へ垂らした両腕(armRigローカル。銃は持たない。左右非対称の伸ばし)──
function zombieArmRoot(m: ZombiePartMats): THREE.Group {
  const root = new THREE.Group();
  const buildArm = (sx: number, reach: number): void => {
    const g = new THREE.Group();
    g.position.set(sx * 0.26, 0.05, -0.02);
    // ★HF(R54): 前方は -Z(顔/移動方向)。Rx(+θ)が腕(-Y伸長)を -Z へ振る。
    // 旧値 -1.35 は +Z=背後へ突き出しており「腕が後ろ向き」の根本原因だった
    g.rotation.x = 1.35 + reach; // ほぼ水平に前(-Z)へ突き出す
    g.rotation.z = -sx * 0.12;
    zPart(g, chamferBox(0.09, 0.27, 0.09, 0.02), m.armor, 0, -0.13, 0, false); // 上腕
    zPart(g, chamferBox(0.075, 0.27, 0.075, 0.02), m.dark, 0, -0.36, 0.01, false); // 前腕
    zPart(g, chamferBox(0.07, 0.06, 0.11, 0.02), m.dark, 0, -0.5, 0.03, false); // 手
    root.add(g);
  };
  buildArm(-1, 0.18);
  buildArm(1, 0.05);
  return root;
}

// ── 腿(股関節ピボットローカル。影シルエット)──
function zombieThighRoot(m: ZombiePartMats): THREE.Group {
  const root = new THREE.Group();
  zPart(root, chamferBox(0.13, 0.32, 0.14, 0.03), m.armor, 0, -0.15, 0, true); // 腿(影)
  return root;
}

// ── 脛+足(膝ピボットローカル)──
function zombieShinRoot(m: ZombiePartMats): THREE.Group {
  const root = new THREE.Group();
  zPart(root, chamferBox(0.11, 0.3, 0.12, 0.03), m.dark, 0, -0.15, 0, false); // 脛
  zPart(root, chamferBox(0.13, 0.08, 0.24, 0.03), m.dark, 0, -0.3, -0.04, false); // 足(底≈-0.80)
  return root;
}

// 群レンダラ(InstancedMesh 7本)の正準ジオメトリ。ノードローカル空間で
// buildZombieMesh と同一のパイプ(mergeByMaterial→applyAO)を通した結果を返す。
// モジュール1回だけ呼び全個体で共有する想定(zombie-crowd.tsがキャッシュする)。
export interface ZombieCrowdGeometries {
  bodyArmor: THREE.BufferGeometry;
  bodyDark: THREE.BufferGeometry;
  bodyGlow: THREE.BufferGeometry;
  armArmor: THREE.BufferGeometry;
  armDark: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
}

let sharedZombieCrowdGeometries: ZombieCrowdGeometries | null = null;
let sharedZombieCrowdLodGeometries: ZombieCrowdGeometries | null = null;

export function buildZombieCrowdGeometries(): ZombieCrowdGeometries {
  // R100: 以前はBot生成のたびに同じ9部位をプリミティブからmerge+AO焼込みしていた。
  // 形状はtier/個体で不変なのでモジュール寿命で1組だけ生成し、個体Object3D経路と
  // InstancedMesh経路の双方で共有する。108体初回湧きの巨大な同期スパイクを除去する。
  if (sharedZombieCrowdGeometries) return sharedZombieCrowdGeometries;
  // マーカー材(家族识别のためだけの使い捨て。ジオメトリ確定後にdispose)
  const armor = new THREE.MeshBasicMaterial();
  const dark = new THREE.MeshBasicMaterial();
  const glow = new THREE.MeshBasicMaterial();
  const mats: ZombiePartMats = { armor, dark, glow };
  // buildZombieMesh の finalize と同一のAO引数(restY = 各ノードの静止オフセット)
  const pick = (root: THREE.Group, restY: number): Map<THREE.Material, THREE.BufferGeometry> => {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    for (const mesh of mergeByMaterial(root)) {
      applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.55);
      out.set(mesh.material as THREE.Material, mesh.geometry);
    }
    return out;
  };
  const body = pick(zombieBodyRoot(mats), 0);
  const arm = pick(zombieArmRoot(mats), ZOMBIE_NODE_REST.armRigY);
  const thigh = pick(zombieThighRoot(mats), ZOMBIE_NODE_REST.legY);
  const shin = pick(zombieShinRoot(mats), ZOMBIE_NODE_REST.legY + ZOMBIE_NODE_REST.kneeY);
  armor.dispose();
  dark.dispose();
  glow.dispose();
  const need = (
    map: Map<THREE.Material, THREE.BufferGeometry>,
    mat: THREE.Material,
    label: string,
  ): THREE.BufferGeometry => {
    const g = map.get(mat);
    if (!g) throw new Error(`buildZombieCrowdGeometries: ${label} 家族が空`);
    return g;
  };
  const result: ZombieCrowdGeometries = {
    bodyArmor: need(body, armor, 'bodyArmor'),
    bodyDark: need(body, dark, 'bodyDark'),
    bodyGlow: need(body, glow, 'bodyGlow'),
    armArmor: need(arm, armor, 'armArmor'),
    armDark: need(arm, dark, 'armDark'),
    thigh: need(thigh, armor, 'thigh'),
    shin: need(shin, dark, 'shin'),
  };
  // Bot#disposeで個体と一緒に破棄しないための共有資産契約。
  for (const geo of Object.values(result)) geo.userData.shared = true;
  sharedZombieCrowdGeometries = result;
  return result;
}

/**
 * 群後方用の遠距離形状。骨格ノード、寸法、眼光、歩行行列は完全版と同一で、
 * 曲面分割と面取りだけを省く。最接近36体には使わないため近接品質は不変。
 */
export function buildZombieCrowdLodGeometries(): ZombieCrowdGeometries {
  if (sharedZombieCrowdLodGeometries) return sharedZombieCrowdLodGeometries;
  const armor = new THREE.MeshBasicMaterial();
  const dark = new THREE.MeshBasicMaterial();
  const glow = new THREE.MeshBasicMaterial();
  const mats: ZombiePartMats = { armor, dark, glow };

  const bodyRoot = (): THREE.Group => {
    const root = new THREE.Group();
    zPart(root, new THREE.BoxGeometry(0.4, 0.58, 0.28), mats.armor, 0, 0.16, 0, true);
    zPart(root, new THREE.BoxGeometry(0.34, 0.24, 0.13), mats.armor, 0, 0.31, -0.05, true);
    zPart(root, new THREE.BoxGeometry(0.32, 0.18, 0.24), mats.dark, 0, -0.2, 0, false);
    zPart(
      root,
      new THREE.CylinderGeometry(0.055, 0.07, 0.14, 6),
      mats.dark,
      0.02,
      0.56,
      -0.02,
      false,
      -0.18,
      0,
      0.12,
    );
    zPart(root, new THREE.SphereGeometry(0.16, 8, 6), mats.dark, 0.03, 0.72, -0.05, false);
    zPart(root, new THREE.BoxGeometry(0.16, 0.05, 0.05), mats.dark, 0.03, 0.7, -0.18, false);
    zPart(root, new THREE.BoxGeometry(0.052, 0.052, 0.026), mats.glow, -0.05, 0.74, -0.17, false);
    zPart(root, new THREE.BoxGeometry(0.052, 0.052, 0.026), mats.glow, 0.1, 0.74, -0.17, false);
    zPart(root, new THREE.BoxGeometry(0.16, 0.03, 0.02), mats.glow, 0.02, 0.22, -0.16, false);
    return root;
  };
  const armRoot = (): THREE.Group => {
    const root = new THREE.Group();
    const buildArm = (sx: number, reach: number): void => {
      const g = new THREE.Group();
      g.position.set(sx * 0.26, 0.05, -0.02);
      g.rotation.x = 1.35 + reach;
      g.rotation.z = -sx * 0.12;
      zPart(g, new THREE.BoxGeometry(0.09, 0.27, 0.09), mats.armor, 0, -0.13, 0, false);
      zPart(g, new THREE.BoxGeometry(0.075, 0.27, 0.075), mats.dark, 0, -0.36, 0.01, false);
      zPart(g, new THREE.BoxGeometry(0.07, 0.06, 0.11), mats.dark, 0, -0.5, 0.03, false);
      root.add(g);
    };
    buildArm(-1, 0.18);
    buildArm(1, 0.05);
    return root;
  };
  const thighRoot = (): THREE.Group => {
    const root = new THREE.Group();
    zPart(root, new THREE.BoxGeometry(0.13, 0.32, 0.14), mats.armor, 0, -0.15, 0, true);
    return root;
  };
  const shinRoot = (): THREE.Group => {
    const root = new THREE.Group();
    zPart(root, new THREE.BoxGeometry(0.11, 0.3, 0.12), mats.dark, 0, -0.15, 0, false);
    zPart(root, new THREE.BoxGeometry(0.13, 0.08, 0.24), mats.dark, 0, -0.3, -0.04, false);
    return root;
  };
  const pick = (root: THREE.Group, restY: number): Map<THREE.Material, THREE.BufferGeometry> => {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    for (const mesh of mergeByMaterial(root)) {
      applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.55);
      out.set(mesh.material as THREE.Material, mesh.geometry);
    }
    return out;
  };
  const body = pick(bodyRoot(), 0);
  const arm = pick(armRoot(), ZOMBIE_NODE_REST.armRigY);
  const thigh = pick(thighRoot(), ZOMBIE_NODE_REST.legY);
  const shin = pick(shinRoot(), ZOMBIE_NODE_REST.legY + ZOMBIE_NODE_REST.kneeY);
  const need = (
    map: Map<THREE.Material, THREE.BufferGeometry>,
    mat: THREE.Material,
    label: string,
  ): THREE.BufferGeometry => {
    const geometry = map.get(mat);
    if (!geometry) throw new Error(`buildZombieCrowdLodGeometries: ${label} 家族が空`);
    return geometry;
  };
  const result: ZombieCrowdGeometries = {
    bodyArmor: need(body, armor, 'bodyArmor'),
    bodyDark: need(body, dark, 'bodyDark'),
    bodyGlow: need(body, glow, 'bodyGlow'),
    armArmor: need(arm, armor, 'armArmor'),
    armDark: need(arm, dark, 'armDark'),
    thigh: need(thigh, armor, 'thigh'),
    shin: need(shin, dark, 'shin'),
  };
  armor.dispose();
  dark.dispose();
  glow.dispose();
  for (const geo of Object.values(result)) geo.userData.shared = true;
  sharedZombieCrowdLodGeometries = result;
  return result;
}

// 群レンダラへ毎フレーム渡す姿勢パラメタ(Bot.getCrowdPoseが埋める)。
// syncMesh/updateDyingの式の入力そのもの — 合成式はzombie-crowd.tsのcompose側が持つ。
export interface ZombieCrowdPose {
  x: number;
  y: number;
  z: number;
  visualLift: number;
  rigLiftY: number;
  scale: number;
  heading: number;
  walkPhase: number;
  walkAmp: number;
  anim: number;
  bobPhase: number;
  dying01: number; // 0=生存。(0,1]=updateDyingの進行t(死亡演出)
  deathTilt: number;
  visible: boolean; // false=死亡演出終了(スケール0行列で非表示)
  elite: boolean;
}

// ═══ R54-W1(F4): humanoid群InstancedMesh化 — 単一定義部位 ═══════════════════
// buildMesh(個体Object3D経路)と buildHumanoidCrowdGeometries(群レンダラの正準
// ジオメトリ)の両方が下の humanoid*Root を通る=単一定義。boss専用の肥大化
// (chestW/pauldron/クレスト)は boss 引数で表現し、群レンダラは boss=false のみ使う
// (boss/master/giant/機械系は常にObject3D経路 — dissolve/黒赤override/専用装飾のため)。

// 変形ノードの静止オフセット(buildMeshと群レンダラの行列合成が共有する唯一の値)
export const HUMANOID_NODE_REST = {
  armRigY: 0.42,
  legX: 0.12,
  legY: -0.16,
  kneeY: -0.3,
} as const;

// 群レンダラの正準マテリアル生成に必要なスタイル値(buildMeshの実値の鏡写し)。
// armor系は tier で roughness/metalness/常時発光が変わるため tier 別に分割する。
// emissive はチーム色×係数のため、シェーダ側で instanceColor×aGlow を加算する
// (humanoid-crowd.ts の onBeforeCompile パッチ)。
export const HUMANOID_CROWD_STYLE = {
  armorRoughnessNormal: 0.55,
  armorMetalnessNormal: 0.14,
  armorRoughnessElite: 0.42,
  armorMetalnessElite: 0.34,
  tierGlowNormal: 0,
  tierGlowElite: 0.28,
  darkMul: 0.34, // dark系の色 = チーム色×0.34(buildMeshの実値)
  darkRoughness: 0.62,
  darkMetalness: 0.2,
  gunColor: 0x202227,
  gunRoughness: 0.5,
  gunMetalness: 0.45,
  glowColor: 0x0d0f13,
  glowRoughness: 0.3,
  visorGlow: 0.9, // バイザー/胸帯の emissiveIntensity(個体経路の実値)
  hitFlashDur: 0.12,
  hitFlashAmp: 0.7,
} as const;

interface HumanoidPartMats {
  armor: THREE.Material;
  dark: THREE.Material;
  gun: THREE.Material;
  glow: THREE.Material;
}

// ── 胴・頭(armor=影を落とすシルエット / dark・glow=no-shadowディテール)──
function humanoidBodyRoot(m: HumanoidPartMats, boss: boolean): THREE.Group {
  const root = new THREE.Group();
  const chestW = boss ? 0.5 : 0.42;
  const pauldX = boss ? 0.33 : 0.3;
  const pauldW = boss ? 0.24 : 0.2;
  zPart(root, taperPrism(0.3, 0.22, 0.6, 8, 0.62), m.armor, 0, 0.15, 0, true); // 八角胴
  zPart(root, taperPrism(0.2, 0.31, 0.14, 8, 0.7), m.armor, 0, 0.44, 0, true); // 肩ヨーク(上広がり)
  zPart(root, chamferBox(chestW, 0.3, 0.14, 0.04), m.armor, 0, 0.28, -0.09, true); // 胸甲
  zPart(root, chamferBox(0.28, 0.09, 0.24, 0.03), m.armor, 0, 0.5, 0, true); // ゴルゲット
  zPart(root, chamferBox(pauldW, 0.15, 0.24, 0.04), m.armor, -pauldX, 0.45, 0, true); // 左パウルドロン
  zPart(root, chamferBox(pauldW, 0.15, 0.24, 0.04), m.armor, pauldX, 0.45, 0, true); // 右パウルドロン
  zPart(root, new THREE.SphereGeometry(0.2, 16, 12), m.armor, 0, 0.9, 0.01, true); // ヘルメットドーム
  zPart(root, chamferBox(0.3, 0.1, 0.3, 0.03), m.armor, 0, 0.97, 0.0, true); // ヘルメット冠
  if (boss) zPart(root, chamferBox(0.05, 0.15, 0.26, 0.02), m.armor, 0, 1.03, 0.02, true); // クレスト
  zPart(root, taperPrism(0.24, 0.18, 0.2, 8, 0.66), m.dark, 0, -0.22, 0, false); // 腰
  zPart(root, new THREE.CylinderGeometry(0.07, 0.09, 0.12, 10), m.dark, 0, 0.6, 0, false); // 首
  zPart(root, new THREE.SphereGeometry(0.17, 16, 12), m.dark, 0, 0.86, 0, false); // 頭
  zPart(root, chamferBox(0.3, 0.34, 0.14, 0.03), m.dark, 0, 0.28, 0.19, false); // バックパック
  zPart(root, chamferBox(0.36, 0.07, 0.3, 0.02), m.dark, 0, -0.03, 0, false); // ベルト
  zPart(root, chamferBox(0.12, 0.13, 0.09, 0.02), m.dark, -0.17, -0.1, -0.13, false); // 左ポーチ(大)
  zPart(root, chamferBox(0.09, 0.1, 0.08, 0.02), m.dark, 0.19, -0.05, -0.12, false); // 右ポーチ(小)
  zPart(root, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), m.dark, 0.13, 0.66, 0.15, false, 0.25, 0, 0.15); // アンテナ
  zPart(root, chamferBox(0.24, 0.06, 0.05, 0.02), m.glow, 0, 0.85, -0.155, false); // 発光バイザー
  zPart(root, new THREE.BoxGeometry(0.3, 0.045, 0.02), m.glow, 0, 0.2, -0.175, false); // 胸の発光帯
  return root;
}

// ── 両腕+構えたライフル(armRigローカル)──
function humanoidArmRoot(m: HumanoidPartMats): THREE.Group {
  const root = new THREE.Group();
  const buildArm = (sx: number): void => {
    const g = new THREE.Group();
    g.position.set(sx * 0.28, 0.06, 0.0);
    g.rotation.x = -1.15;
    g.rotation.z = -sx * 0.35;
    zPart(g, chamferBox(0.11, 0.28, 0.11, 0.03), m.armor, 0, -0.13, 0, false); // 上腕(armor)
    zPart(g, chamferBox(0.095, 0.26, 0.095, 0.03), m.armor, 0, -0.34, 0.02, false); // 前腕(armor)
    zPart(g, chamferBox(0.08, 0.09, 0.11, 0.02), m.dark, 0, -0.47, 0.03, false); // グローブ(dark)
    root.add(g);
  };
  buildArm(-1);
  buildArm(1);
  const rifle = new THREE.Group();
  rifle.position.set(0.02, -0.08, -0.36);
  zPart(rifle, chamferBox(0.07, 0.09, 0.42, 0.02), m.gun, 0, 0, 0, false); // レシーバ
  zPart(rifle, new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), m.gun, 0, 0.01, -0.34, false, Math.PI / 2, 0, 0); // 銃身
  zPart(rifle, chamferBox(0.05, 0.16, 0.08, 0.02), m.gun, 0, -0.12, 0.04, false); // マガジン
  zPart(rifle, chamferBox(0.05, 0.08, 0.14, 0.02), m.gun, 0, -0.02, 0.26, false); // ストック
  zPart(rifle, new THREE.BoxGeometry(0.03, 0.05, 0.06), m.gun, 0, 0.08, -0.04, false); // サイト
  root.add(rifle);
  return root;
}

// ── 腿(股関節ピボットローカル。影シルエット)──
function humanoidThighRoot(m: HumanoidPartMats): THREE.Group {
  const root = new THREE.Group();
  zPart(root, chamferBox(0.15, 0.32, 0.16, 0.03), m.armor, 0, -0.15, 0, true); // 腿(影)
  return root;
}

// ── 膝ガード+脛+ブーツ(膝ピボットローカル)──
function humanoidShinRoot(m: HumanoidPartMats): THREE.Group {
  const root = new THREE.Group();
  zPart(root, chamferBox(0.13, 0.1, 0.15, 0.03), m.dark, 0, 0.0, 0.01, false); // 膝ガード
  zPart(root, chamferBox(0.12, 0.3, 0.13, 0.03), m.dark, 0, -0.15, 0, false); // 脛
  zPart(root, chamferBox(0.14, 0.09, 0.27, 0.03), m.dark, 0, -0.3, -0.045, false); // ブーツ(底≈-0.80)
  return root;
}

// 群レンダラ(InstancedMesh 11本)の正準ジオメトリ(8家族。armor系はtier別マテリアルで
// 同一ジオメトリを使い回す)。モジュール1回だけ呼び全個体で共有(humanoid-crowd.tsがキャッシュ)。
export interface HumanoidCrowdGeometries {
  bodyArmor: THREE.BufferGeometry;
  bodyDark: THREE.BufferGeometry;
  bodyGlow: THREE.BufferGeometry;
  armArmor: THREE.BufferGeometry;
  armDark: THREE.BufferGeometry;
  armGun: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
}

export function buildHumanoidCrowdGeometries(): HumanoidCrowdGeometries {
  const armor = new THREE.MeshBasicMaterial();
  const dark = new THREE.MeshBasicMaterial();
  const gun = new THREE.MeshBasicMaterial();
  const glow = new THREE.MeshBasicMaterial();
  const mats: HumanoidPartMats = { armor, dark, gun, glow };
  // buildMesh の finalize と同一のAO引数(humanoidはAO強度0.6 — zombieの0.55と異なる)
  const pick = (root: THREE.Group, restY: number): Map<THREE.Material, THREE.BufferGeometry> => {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    for (const mesh of mergeByMaterial(root)) {
      applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.6);
      out.set(mesh.material as THREE.Material, mesh.geometry);
    }
    return out;
  };
  const body = pick(humanoidBodyRoot(mats, false), 0);
  const arm = pick(humanoidArmRoot(mats), HUMANOID_NODE_REST.armRigY);
  const thigh = pick(humanoidThighRoot(mats), HUMANOID_NODE_REST.legY);
  const shin = pick(humanoidShinRoot(mats), HUMANOID_NODE_REST.legY + HUMANOID_NODE_REST.kneeY);
  armor.dispose();
  dark.dispose();
  gun.dispose();
  glow.dispose();
  const need = (
    map: Map<THREE.Material, THREE.BufferGeometry>,
    mat: THREE.Material,
    label: string,
  ): THREE.BufferGeometry => {
    const g = map.get(mat);
    if (!g) throw new Error(`buildHumanoidCrowdGeometries: ${label} 家族が空`);
    return g;
  };
  return {
    bodyArmor: need(body, armor, 'bodyArmor'),
    bodyDark: need(body, dark, 'bodyDark'),
    bodyGlow: need(body, glow, 'bodyGlow'),
    armArmor: need(arm, armor, 'armArmor'),
    armDark: need(arm, dark, 'armDark'),
    armGun: need(arm, gun, 'armGun'),
    thigh: need(thigh, armor, 'thigh'),
    shin: need(shin, dark, 'shin'),
  };
}

// 群レンダラへ毎フレーム渡す姿勢パラメタ(Bot.getHumanoidCrowdPoseが埋める)。
// syncMesh(humanoid生存分岐)の式の入力そのもの — 合成式は humanoid-crowd.ts 側。
// 死亡はslot解放→Object3D経路へスワップバックするため dying 系は持たない。
export interface HumanoidCrowdPose {
  x: number;
  y: number;
  z: number;
  rigLiftY: number;
  heading: number;
  walkPhase: number;
  walkAmp: number;
  anim: number;
  flinch: number; // 被弾のけぞりの残り秒(0.14基準。式は compose 側)
  glow: number; // armor発光係数 = tierGlowBase + (hitFlash/0.12)*0.7(個体経路と同式)
  elite: boolean;
  colorHex: number; // チーム色(instanceColor/emissiveの源)
  visible: boolean;
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
  maxHp: number;
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
  // ★8 遠距離(>50m)アニメLOD: syncMeshのsway/呼吸sin群をスキップ(matchが毎フレーム設定)
  animLod = false;
  // ★ ゾンビアニメ半減LOD: 25-50mで更新を2フレームに1回へ間引く(matchが毎フレーム設定)
  animHalfLod = false;

  // ── R16 機械的エイム: aimDirを目標へ aimSlewRadS で寄せ、updateShootingはこの方向へ撃つ ──
  readonly aimDir = new THREE.Vector3();

  // ── R16 ゾンビ ──
  zombieRunMul = 1; // 走行個体のローカル速度倍率(moveSpeedは readonly のため別持ち)
  // ★5 群衆ランクKCC LOD契約: matchが0.25s毎に近い順ランクを書き込む(0=最近接)。
  // 既定99=未算出/非上位(zombieKccActive/zombieKccSkipFactorが参照する契約フィールド)
  hordeRank = 99;
  // R54-W1(B1): kind==='zombie'のみコンストラクタで生成する、computeColliderMovement用
  // filterPredicate(他ゾンビのbodyColliderのみ除外)。他kindはnull(未使用=非回帰)。
  private readonly zombieCrowdFilterPredicate: ((c: RAPIER.Collider) => boolean) | null = null;
  // ── R53-W3 ゾンビ群InstancedMesh化 ──
  // 群スロット(-1=非インスタンス=従来のObject3D描画)。割当/解放は match 側
  // (ZombieCrowdRenderer.acquire/release → setCrowdSlot)が行う。対象は
  // kind==='zombie' && tier!=='boss' && zombieVariant===null のみ(ハイブリッド協定)。
  crowdSlot = -1;
  // R54-W1(F4): humanoid群レンダラ用 — チーム色(instanceColor/emissiveの源)
  humanoidColorHex = 0xffffff;
  // 影LOD(最近接8体)の現在状態。true=castShadow中 → humanoid群の対象外
  // (群メッシュはcastShadow=falseのため、実articulated影は個体経路が担う)
  shadowCasting = false;
  // ── R53-W2 特殊ゾンビ変種(zombie-economy.ts ZombieVariant契約) ──
  // spawn/プール再利用時にmatchが設定する。挙動(前面軽減/死亡時効果)はmatch側が
  // facingDot()/この値を見て発火するため、Bot自身は保持と見た目適用のみ担う。
  zombieVariant: ZombieVariant | null = null;
  // applyZombieVariantVisualが追加した装飾メッシュ(共有マテリアル+個体別ジオメトリ)。
  // resetForZombieReuse(プール再利用)で必ず除去+空配列化し、旧variantの残留を防ぐ
  // (R51の合成漏斗罠と同型の再発防止対象)。
  private readonly variantMeshes: THREE.Mesh[] = [];
  // V51: 中心基準の視覚スケール(全巨躯ゾンビ等)で足が沈むのを防ぐ持ち上げ量(見た目のみ)
  private visualLift = 0;
  // R53-T1: rig(剛体中心基準の等比拡大)自身の足沈み補正。visualLiftとは別経路(groupではなく
  // rig.position.yへ加える)。boss zombieのみ非0。syncMesh/updateDying/fkResetPose/
  // fkApplyDeathPoseが毎フレーム rig.position.y を代入し直すため、コンストラクタで
  // rig.position.yへ直接足すだけでは次フレームに上書きされて消える → base値として
  // 各所の式に組み込む(他kind/tierは0のまま無害)。
  private rigLiftY = 0;
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
  // R55 ⑧ ゾンビ専用: 迂回の連続失敗回数(失敗の度にラッチ/横成分を強める。真に前進
  // できたフレームで即0へ戻す)。humanoidの同系ロジックとは独立に管理する。
  private zombieUnstuckAttempts = 0;
  // R55 ⑧ ゾンビ専用: 最終安全弁(hardStuckCheckS間隔で位置ドリフトをサンプリングし、
  // 停滞なら hardStuckS を積算する)。zombieHardStuck/zombieHardStuckForce ゲッター経由で
  // zombie-director側のテレポート救済がこれを読む。
  private hardStuckS = 0;
  private hardStuckCheckS = ZOMBIE_HARD_STUCK_CHECK_S;
  private hardStuckAnchorX = 0;
  private hardStuckAnchorZ = 0;
  // R55 W-C6: climbing中もサンプリング窓を止めず高度側の進捗判定に使うYアンカー
  // (XZアンカーと同じ箇所で同時に据え直す。詳細はupdateZombie本体のコメント参照)。
  private hardStuckAnchorY = 0;
  // R55 W-C3: 前フレームの blocked(前進を実際に阻まれたか)。meleeRange以内かの判定は
  // 直線距離だけでは「壁越しの偽近接」(壁の向こうにプレイヤーがいて距離だけは近い)を
  // 見分けられないため、「近接射程内 かつ 前フレーム時点で前進ブロックされていない」
  // (=本当に密着できている)場合にのみ意図的低速ガードを適用する。blockedはKCC計算後に
  // 確定するため1フレーム遅延で保持する(updateZombie末尾で毎フレーム更新)。
  private prevZombieBlocked = false;

  // ── R53-W2 ストーリー(campaign.ts BossPhase契約/追跡・護衛ミッション) ──
  // true の間、humanoid の非戦闘移動 wish を「target から離れる」方向へ固定する
  // (追跡ミッションで敵が逃走するボス/NPCの演出)。戦闘AI(狙い/heading)自体は変えず、
  // update() の wish計算(approach項)だけに分岐する。既定false=非回帰。
  fleeMode = false;
  // R53 黒雷帝の怯え(帝威): applyFear(durationS) で設定される残り秒数(update内で減衰)。
  // M3配線: 黒雷帝の降臨時+25m以内での黒雷キル時に、周辺humanoid系へ applyFear(1.2〜2.0)、
  // zombieへ applyFear(0.4)(よろめき)。humanoid系=後退(approach反転)+命中率低下、
  // zombie=移動×0.2の硬直。★V-D修正(コメント訂正): 命中率低下は bot.ts 内の
  // updateShooting(fearMul適用点)で実効spreadを 1/fearAccuracyMul 倍(=2倍)へ広げる。
  private _fearS = 0;
  applyFear(durationS: number): void {
    this._fearS = Math.max(this._fearS, durationS);
  }
  get feared(): boolean {
    return this._fearS > 0;
  }
  // 味方(team=player想定)が歩く経由点リスト。設定中はctx.objectiveより優先して
  // 先頭の未到達waypointへ向かい、到達半径3m(既存objective-seekと同じ閾値)で
  // 次のwaypointへ進む。配列を再代入すると内部進捗(escortIdx)を自動で0へ戻す。
  // 末尾到達後(escortIdx>=length)は通常のobjective-seek/徘徊へフォールバックする
  // (最小実装。ループ待機等が要る場合はmatch側でwaypoints自体を再設定すること)。
  private _escortWaypoints: THREE.Vector3[] | null = null;
  private escortIdx = 0;
  get escortWaypoints(): THREE.Vector3[] | null {
    return this._escortWaypoints;
  }
  set escortWaypoints(wps: THREE.Vector3[] | null) {
    this._escortWaypoints = wps;
    this.escortIdx = 0;
  }
  // ストーリーボスの現在フェーズが許可する演出フラグ(黒斬撃/ブリンク/柱)。発火自体は
  // match側(effects流用)が行い、Botはcampaign.ts BossPhase遷移時にsetBossPhaseFlags()
  // 経由で書き込まれた現在値を保持するだけ(読み取りは公開readonlyフィールド)。
  readonly bossPhaseFlags: { blackSlash: boolean; blink: boolean; pillars: boolean } = {
    blackSlash: false,
    blink: false,
    pillars: false,
  };
  // horizSpeedMps 用
  private _prevBodyPos = new THREE.Vector3(); // 前フレームの剛体位置
  private _horizSpeed = 0;        // 直近フレームの水平速度(m/s)
  private reactionJitter = 1; // 反応時間の個体差倍率(constructorで名前ハッシュから確定)
  private fireOnset = 0; // 交戦開始時の追加発砲遅延(s)

  private airJumpsLeft = 0;
  private sinceGrounded = 99;
  private doubleJumpCooldown = 0;

  private readonly controller: RAPIER.KinematicCharacterController;
  private heading = 0;
  private headingTimer = 0;
  private strafeSign = 1;
  private strafeTimer = 0;
  private combatDepthSign: -1 | 1 = 1;
  private combatDepthTimer = 0;
  private velY = 0;
  private reaction = 0;
  private burstLeft = 0;
  private shotTimer = 0;
  private pauseTimer = 0;
  private dyingTimer = 0;
  // ★2 巨躯KCC距離LOD: フレームパリティと、非担当フレームで再利用する前回moved
  private kccFrame = 0;
  private readonly prevGiantMoved = { x: 0, y: 0, z: 0 };
  private readonly prevZombieMoved = { x: 0, y: 0, z: 0 };
  private readonly zombieMovement = { x: 0, y: 0, z: 0 };
  private prevZombieGrounded = false;

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
  private moveSpeed: number;
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
    // ボスゾン��は体格1.8×スケールのコライダー・フィート/頭オフセットを使う
    const isBossZombie = kind === 'zombie' && tier === 'boss';
    // humanoidは難度/階層tuningの頭高、他kindは体格から固定(コライダーと常に一致)。
    // R53-T2: allGiantMode の tuning.scale(現状zombieのみ非1、既定1.35)は視覚を
    // group.scale等比拡大するため、頭コライダーのローカルY offsetも同じ倍率で
    // 生成時(コンストラクタ)に決定し、視覚頭部とのズレ(=ヘッドショット判定外れ)を
    // 解消する。boss zombieは専用体格(ZOMBIE_BOSS_*)を使い tuning.scale は常に1
    // (BOSS_TUNING.scale=1)なのでこの分岐と衝突しない。胴カプセルは非対象(T2指示)。
    this.headOff = (kind === 'humanoid' || kind === 'master') ? tuning.headOffset
      : isBossZombie ? ZOMBIE_BOSS_HEAD_OFFSET
      : kind === 'giant' ? GIANT_HEAD_OFFSET
      : kind === 'zombie' ? KIND_HEAD_OFFSET.zombie * tuning.scale
      : KIND_HEAD_OFFSET[kind];
    this.feetOffset = isBossZombie ? ZOMBIE_BOSS_CENTER_TO_FEET : KIND_FEET_OFFSET[kind];
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
    } else if (isBossZombie) {
      // ゾンビボス: 1.8倍スケールの巨体コライダー
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(ZOMBIE_BOSS_BODY_HALF, ZOMBIE_BOSS_BODY_RADIUS),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(ZOMBIE_BOSS_HEAD_RADIUS).setTranslation(0, ZOMBIE_BOSS_HEAD_OFFSET, 0),
        this.body,
      );
    } else if (kind === 'giant') {
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(GIANT_BODY_HALF, GIANT_BODY_RADIUS),
        this.body,
      );
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(GIANT_HEAD_RADIUS).setTranslation(0, GIANT_HEAD_OFFSET, 0),
        this.body,
      );
    } else {
      // humanoid, master, zombie(normal/elite) - standard capsule
      this.bodyCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(BODY_HALF, BODY_RADIUS),
        this.body,
      );
      // R53-T2: allGiantMode の zombie(tuning.scale!=1)は頭球だけ同倍率で拡大生成する
      // (this.headOff は上ですでにscale済み)。胴カプセルは移動/ドア通過に影響するため
      // 据え置き(master(1.15)はR51方針どおり対象外=group.scaleの視覚拡大のみ)。
      const headR = (kind === 'zombie' && tuning.scale !== 1) ? HEAD_RADIUS * tuning.scale : HEAD_RADIUS;
      this.headCollider = world.createCollider(
        RAPIER.ColliderDesc.ball(headR).setTranslation(0, this.headOff, 0),
        this.body,
      );
    }
    if (kind === 'zombie') {
      // R100密集物理: Rapierの通常physics.stepではゾンビ同士の接触ペアを生成しない。
      // KCCの前衛24体はcomputeColliderMovementの形状クエリで従来どおり仲間を障害物として
      // 扱い、後方群は既存の空間ハッシュ分離を使う。filterGroups未指定の被弾レイ/
      // 爆風/頭判定には影響せず、密集時だけ増えるN²接触候補を除去できる。
      const zombieNoSelfCollision = (0x0002 << 16) | 0xfffd;
      this.bodyCollider.setCollisionGroups(zombieNoSelfCollision);
      this.headCollider.setCollisionGroups(zombieNoSelfCollision);
    }
    // R54-W1(B1): kind==='zombie'のbodyCollider/headCollider handleをWorld単位のSetへ登録し、
    // 「他ゾンビのコライダーか」をO(1)判定するfilterPredicateを1回だけ生成して保持する
    // (毎フレームのクロージャ再生成を避ける)。上のinteraction groupとは役割が異なる。
    // headColliderも必ず含める: bodyColliderだけ除外してもheadColliderの頭球(y≈0.88、
    // 半径0.22)がbodyカプセルの上端(y≈0.8)と垂直に重なるため、除外漏れがあると
    // すり抜けが成立しない(実測で発覚。単体テストで再発防止済み)。
    if (kind === 'zombie') {
      const handles = zombieHandleSet(world);
      handles.add(this.bodyCollider.handle);
      handles.add(this.headCollider.handle);
      this.zombieCrowdFilterPredicate = (c: RAPIER.Collider): boolean => !handles.has(c.handle);
    }
    // KCCはhumanoid/tank/zombieが使用するが生成は共通(最小差分。World破棄で回収される)
    this.controller = world.createCharacterController(0.05);
    // R18: ゾンビは小さい段差(バリケード/瓦礫/縁石)を乗り越えて詰めてくる。autostep高さを
    // 0.4→0.75へ上げ、最小幅も緩めて群れが地形に引っかからず押し寄せるように
    if (kind === 'zombie' || kind === 'giant') {
      this.controller.enableAutostep(0.75, 0.2, true);
    } else {
      this.controller.enableAutostep(0.4, 0.3, true);
    }
    this.controller.enableSnapToGround(0.4);

    if (kind === 'drone') this.buildDroneMesh(color, tier);
    else if (kind === 'tank') this.buildTankMesh(color, tier);
    else if (kind === 'turret') this.buildTurretMesh(color, tier);
    else if (kind === 'zombie') this.buildZombieMesh(color, tier);
    else if (kind === 'master') this.buildMasterMesh(color, tier);
    else if (kind === 'giant') this.buildGiantMesh(color, tier);
    else this.buildMesh(color, tier);
    // 名前ハッシュ由来の決定論的な反応個体差(0.7〜1.4)と初弾オンセット(0〜0.35s)。
    // 分隊の同時発砲を desync し、機械的な一斉射撃を自然に散らす(spot-timeとは別系統)
    this.reactionJitter = 0.7 + ((phase * 13) % 71) / 71 * 0.7;
    this.fireOnset = ((phase * 7) % 53) / 53 * 0.35;
    // 当たり判定は固定のまま、見た目だけ階層スケール(原則1.0なので無害)
    if (tuning.scale !== 1) {
      this.group.scale.setScalar(tuning.scale);
      // V51レビュー: 中心基準スケールは足が (scale-1)*CENTER_TO_FEET 沈む(R11ボスの教訓)。
      // 通常体格コライダーのまま拡大する全巨躯ゾンビは接地位置へ持ち上げる(見た目のみ・
      // コライダー不変)。boss ゾンビは rig 側スケール+専用拡大コライダーの別経路、
      // master(1.15)は出荷済みの既存見た目を維持するため対象外
      if (kind === 'zombie') this.visualLift = (tuning.scale - 1) * CENTER_TO_FEET;
    }
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

    // ルートを畳んで対象へ追加し、pivot静止Yを織り込んだ縦AOを焼く
    const finalize = (root: THREE.Object3D, target: THREE.Object3D, restY: number): void => {
      const meshes = mergeByMaterial(root);
      for (const mesh of meshes) applyAO(mesh.geometry, -0.85 - restY, 1.1 - restY, 0.6);
      for (const mesh of meshes) target.add(mesh);
    };

    // R54-W1(F4): 部位構成はモジュールの humanoid*Root(単一定義)へ抽出済み。
    // 個体経路(ここ)と群レンダラの正準ジオメトリ(buildHumanoidCrowdGeometries)が
    // 同じ定義を通るため、両経路の見た目乖離は構造的に起きない。
    const partMats: HumanoidPartMats = { armor, dark, gun, glow };
    this.humanoidColorHex = color;
    finalize(humanoidBodyRoot(partMats, boss), this.rig, 0);

    const armRig = new THREE.Group();
    armRig.position.set(0, HUMANOID_NODE_REST.armRigY, 0);
    this.armRig = armRig;
    finalize(humanoidArmRoot(partMats), armRig, armRig.position.y);
    this.rig.add(armRig);

    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number): void => {
      pivot.position.set(sx, HUMANOID_NODE_REST.legY, 0);
      knee.position.set(0, HUMANOID_NODE_REST.kneeY, 0);
      finalize(humanoidThighRoot(partMats), pivot, pivot.position.y);
      finalize(humanoidShinRoot(partMats), knee, pivot.position.y + knee.position.y);
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -HUMANOID_NODE_REST.legX);
    buildLeg(this.legR, this.kneeR, HUMANOID_NODE_REST.legX);

    if (boss) {
      // 視覚のみ拡大(コライダー不変)。rig原点(=剛体中心)基準の等比拡大だと
      // ブーツ底(rigローカル≈-0.80)が0.80*(1.12-1)≈0.096沈むので同量持ち上げて接地を戻す。
      // R54-W1 Q7: 旧実装は position.y += の一度きり補正だったが、syncMesh/updateDying/
      // fkResetPose等が毎フレームposition.yを式で上書きするため実質無効化されていた。
      // zombie boss(R53-T1)で実証済みのrigLiftY(永続フィールド。各所の式へ織り込み済み)方式へ
      // 横展開する(buildMasterMeshはこのbuildMeshへ委譲するためmaster bossにも自動で効く)。
      this.rig.scale.setScalar(1.12);
      this.rigLiftY = 0.8 * 0.12;
    }
    this.group.add(this.rig);
  }

  // 腐敗色の低ポリ人型ゾンビ。銃/armRigのライフルは持たず、前へ垂らした両腕と
  // シャンブル脚(legL/legR/kneeL/kneeR)を持つ。多数描画のため部位は最小限に絞り、
  // mergeByMaterialで (armor/dark/glow)×(cast/no-cast) へ畳む(1体≈3〜4ドローコール)。
  // 影を落とすシルエットは胴と腿のみ。no-cast片は userData.noShadow=true を焼き、
  // 距離LOD/近接影トグル(setCastShadow)が誤って影を点けないようにする。
  // R53-T4: color引数は private メソッドなので呼び出し元は本コンストラクタ内(760行台)の
  // 1箇所のみ(外部から直接呼ばれることはない)。ただしBotコンストラクタ自体は match.ts が
  // 公開APIとして呼ぶため、そちらの色引数(zombieSpawnColor/精鋭色0x6d7d3a等)は今も
  // 生きている前提で渡ってくる。R51蛍光グリーン化以降、この引数は tier==='boss' の
  // ときだけ使われ、normal/elite では下の isElite 三項演算子が固定の蛍光グリーン定数を
  // 選ぶため無視される(死に値)。Bot公開コンストラクタのシグネチャは他kind(humanoid等)
  // でも共有するため変更しない=呼び出し元(match.ts)には現状の引数を渡し続けてよい。
  private buildZombieMesh(color: number, tier: BotTier = 'normal'): void {
    const isBoss = tier === 'boss';
    const isElite = tier === 'elite';
    // 蛍光グリーン化: ボスは既存の識別色(赤エンブレム/赤い目、colorから引き継ぐ)を維持し、
    // 通常/精鋭は固定の蛍光グリーンへ寄せる(精鋭は明るめの色でtier識別を維持。
    // = color引数は isBoss 分岐でのみ消費。上のコメント参照)
    const c = isBoss
      ? new THREE.Color(color).multiplyScalar(0.7)
      : new THREE.Color(isElite ? ZOMBIE_SKIN_ELITE : ZOMBIE_SKIN_NORMAL);
    const armor = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.85,
      metalness: isBoss ? 0.1 : 0.05,
      vertexColors: true,
      emissiveIntensity: isBoss ? 0.25 : 0,
      ...(isBoss ? { emissive: new THREE.Color(0x330800) } : {}),
    });
    this.armorMat = armor;
    this.tierGlowBase = isBoss ? 0.25 : 0;
    // ★7 軽量化: hitFlash等で個体別に変化しないdarkマテリアルはtier×色で共有する
    // (armor/glowはemissiveIntensityを個体ごとに操作するため非共有のまま)
    const dark = getSharedZombieDarkMat(c.clone().multiplyScalar(0.4));
    // 腐った眼光。ボスは赤い目(0xff2200)。bloomThresholdでおもちゃ化しないよう強度を抑える
    const eyeColor = isBoss ? 0xff2200 : ZOMBIE_EYE_COLOR;
    const eyeIntensity = isBoss ? 0.9 : ZOMBIE_EYE_INTENSITY;
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0a0d07,
      emissive: new THREE.Color(eyeColor),
      emissiveIntensity: eyeIntensity,
      roughness: 0.4,
    });
    this.glowMats.push({ mat: glow, base: eyeIntensity });

    // R100: 形状はbuildZombieCrowdGeometriesで1回だけmerge+AO済み。
    // Mesh/骨ピボットと個体別マテリアルだけを作り、従来と同じ9メッシュ構造へ接続する。
    const geos = buildZombieCrowdGeometries();
    const addShared = (
      target: THREE.Object3D,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      castShadow: boolean,
    ): void => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = castShadow;
      if (!castShadow) mesh.userData.noShadow = true;
      target.add(mesh);
    };
    addShared(this.rig, geos.bodyArmor, armor, true);
    addShared(this.rig, geos.bodyDark, dark, false);
    addShared(this.rig, geos.bodyGlow, glow, false);

    // ── 前へ垂らした両腕(armRig。銃は持たない)──
    const armRig = new THREE.Group();
    armRig.position.set(0, ZOMBIE_NODE_REST.armRigY, 0);
    this.armRig = armRig;
    addShared(armRig, geos.armArmor, armor, false);
    addShared(armRig, geos.armDark, dark, false);
    this.rig.add(armRig);

    // ── 脚(股関節ピボット + 膝ピボット)。humanoidと同じ骨格でシャンブル歩容 ──
    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number): void => {
      pivot.position.set(sx, ZOMBIE_NODE_REST.legY, 0);
      knee.position.set(0, ZOMBIE_NODE_REST.kneeY, 0);
      addShared(pivot, geos.thigh, armor, true);
      addShared(knee, geos.shin, dark, false);
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -ZOMBIE_NODE_REST.legX);
    buildLeg(this.legR, this.kneeR, ZOMBIE_NODE_REST.legX);

    // ── ボス専用: 視覚スケール2.3× + 体表の発光裂け目 ──
    if (isBoss) {
      const crackMat = new THREE.MeshStandardMaterial({
        color: 0x0a0502,
        emissive: new THREE.Color(0xff3300),
        emissiveIntensity: 1.2,
        roughness: 0.3,
      });
      for (let i = 0; i < 3; i += 1) {
        const cr = new THREE.Mesh(
          new THREE.BoxGeometry(0.28 - i * 0.06, 0.025, 0.015),
          crackMat,
        );
        cr.position.set((i - 1) * 0.04, 0.3 - i * 0.12, -0.17);
        cr.rotation.z = (i - 1) * 0.3;
        this.rig.add(cr);
      }
      this.glowMats.push({ mat: crackMat, base: 1.2 });
      this.rig.scale.setScalar(2.3);
      // R53-T1修正: rig原点(=剛体中心)基準の等比拡大だとブーツ底(rigローカル≈-0.80。
      // buildLegのコメント参照)が 2.3*0.80m 沈むが、ボスゾンビの実コライダー足元は
      // ZOMBIE_BOSS_CENTER_TO_FEET(=1.44)。差分だけ持ち上げて接地を一致させる
      // (従来は無補正で0.40m沈んでいた)。rigLiftYはsyncMesh/updateDying/killcamの
      // fkResetPose/fkApplyDeathPoseの毎フレーム式にも反映する(他kind/tierは0のまま無害)。
      this.rigLiftY = 2.3 * 0.8 - ZOMBIE_BOSS_CENTER_TO_FEET; // = +0.40
    }

    this.group.add(this.rig);
  }

  // ── R53-W2 特殊ゾンビ変種の見た目適用 ──────────────────────────────────────
  // buildZombieMesh() 完了後にmatchが呼ぶ(spawn直後 or プール再利用でのreapply)。
  // 追加パーツは this.rig 配下へぶら下げるので、通常のsyncMesh(rig基準の位置/向き)や
  // dispose()のgroup.traverseへ自然に乗る。マテリアルはgetSharedVariantMatで
  // 変種×役割ごとに1つを使い回し(個体クローン禁止)、ジオメトリのみ個体別(安価な
  // Sphere/Boxなのでmerge対象にせず直接disposeしてよい)。呼び出し前に必ず
  // 旧variantの装飾を除去する(多重適用/reapplyでの残留・二重描画を防ぐ)。
  applyZombieVariantVisual(variant: ZombieVariant): void {
    this.clearZombieVariantVisual();
    this.zombieVariant = variant;
    const add = (mesh: THREE.Mesh, cast: boolean): void => {
      mesh.castShadow = cast;
      mesh.userData.noShadow = !cast;
      this.rig.add(mesh);
      this.variantMeshes.push(mesh);
    };
    if (variant === 'blast') {
      // 腹部の発光パスチュール(橙赤、球2-3個)
      const mat = getSharedVariantMat('blast-pustule', () => new THREE.MeshStandardMaterial({
        color: 0x2a0800,
        roughness: 0.55,
        metalness: 0.05,
        emissive: new THREE.Color(0xff5522),
        emissiveIntensity: 0.5, // ≤0.55上限・bloom閾値0.9未満
      }));
      for (const [x, y, z, r] of BLAST_PUSTULE_SPECS) {
        add(new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6).translate(x, y, z), mat), false);
      }
    } else if (variant === 'miasma') {
      // 緑の半透明オーラシェル(胴を包む)+頭部の緑発光ハロー
      const shellMat = getSharedVariantMat('miasma-shell', () => new THREE.MeshStandardMaterial({
        color: 0x1c5c33,
        roughness: 0.4,
        metalness: 0,
        emissive: new THREE.Color(0x2ee06a),
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8).translate(0, 0.16, 0), shellMat), false);
      const headGlowMat = getSharedVariantMat('miasma-head-glow', () => new THREE.MeshStandardMaterial({
        color: 0x123018,
        roughness: 0.4,
        emissive: new THREE.Color(0x39ff7a),
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8).translate(0.03, 0.72, -0.05), headGlowMat), false);
    } else if (variant === 'shell') {
      // 前面の骨甲板(胸+顔)。発光なしの灰白マテリアル
      const plateMat = getSharedVariantMat('shell-plate', () => new THREE.MeshStandardMaterial({
        color: 0xcdc7b6,
        roughness: 0.8,
        metalness: 0.04,
      }));
      add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06).translate(0, 0.3, -0.12), plateMat), true);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.04).translate(0.03, 0.74, -0.19), plateMat), false);
    }
  }

  // プール再利用時に旧variantの装飾メッシュを除去する(R51合成漏斗罠の再発防止)。
  // マテリアルは共有(userData.shared)なのでdisposeしない。ジオメトリは個体別のため
  // 通常どおりdisposeしてよい(最終dispose()でも二重disposeは安全なno-op)。
  private clearZombieVariantVisual(): void {
    for (const mesh of this.variantMeshes) {
      this.rig.remove(mesh);
      mesh.geometry.dispose();
    }
    this.variantMeshes.length = 0;
    this.zombieVariant = null;
  }

  // 前面被弾判定: heading(向き)と被弾方向の内積を返す(-1..1)。shotDir は
  // takeDamage(fromDir) と同じ「本体→射手」方向の慣例(未正規化/Y成分ありでも可、
  // 内部でY0化+正規化する)。+1に近いほど射手が正面(=前面からの被弾)、-1で背面。
  // shell変種の前面ダメージ軽減判定にmatch側(applyBotDamage)が使う想定。
  facingDot(shotDir: THREE.Vector3): number {
    if (shotDir.lengthSq() < 1e-8) return 0;
    const d = shotDir.clone();
    d.y = 0;
    if (d.lengthSq() < 1e-8) return 0;
    d.normalize();
    return this.facing().dot(d);
  }

  // ── R53-W2 ストーリー用ボスフェーズ/演出API(campaign.ts BossPhase契約) ──
  // フェーズは hp01 の単調減少に沿って一方向へ進行し後戻りしないため、基礎値からの
  // 再計算ではなく「現在の実効値へ乗算」でよい(前フェーズの効果に重ねがけしてよい)。
  // speedMul: tuning.moveSpeedMul と実効moveSpeed(construction時にtuningから一度だけ
  // 焼かれるprivateフィールド。以後のtuning変更だけでは移動に反映されない)の両方へ
  // 同じ倍率をかけ、両者の対応関係(moveSpeed = MOVE_SPEED * tuning.moveSpeedMul)を保つ。
  // damageMul: tuning.damage へ乗算(match側の全ダメージ経路がbot.tuning.damageを直接
  // 参照する既存の流儀。例: hellMode倍率 `bot.tuning.damage = ...` / damageAtDistance
  // (tuning.damage, ...) 呼び出し)。
  applyBossPhase(speedMul?: number, damageMul?: number): void {
    if (speedMul !== undefined && speedMul !== 1) {
      this.tuning.moveSpeedMul *= speedMul;
      this.moveSpeed *= speedMul;
    }
    if (damageMul !== undefined && damageMul !== 1) {
      this.tuning.damage *= damageMul;
    }
  }

  // ボス演出: 指定座標(respawnAtのspawnと同じ「足元/地面基準」のY)へ即時転移する。
  // R55 W-C確証finding修正(CRITICAL): setNextKinematicTranslationは「次のworld.step()で
  // 消費されるキュー」に過ぎず、body.translation()はここでは即時更新されない。本メソッドは
  // physics.step()「後」のupdateZombieDirectorから呼ばれるため、旧実装のままだと次フレームの
  // updateZombie(先頭で `const t = this.body.translation()` を読み、そこへ歩行移動を足して
  // 改めてsetNextKinematicTranslationする)がキュー済みのテレポート先を「まだ反映されていない
  // stale位置+微小移動」で上書きしてしまい、テレポートが物理的に一切着地しない
  // (=詰まったゾンビが永久に動けずラウンドが進行しない)。respawnAt(直下のresetForZombieReuse
  // 経由)と同じ setTranslation(..., true) で即時反映することで、直後のupdateZombieが必ず
  // テレポート後の位置をtranslation()で読めるようにする。KCC(KinematicCharacterController)の
  // 速度推定/次stepの参照用に、直後で同座標をsetNextKinematicTranslationにも積んでおく(delta=0)。
  // ★2/★5 KCC距離LODのprevZombieMoved/prevGiantMoved(前回movedキャッシュ)や
  // climbing/stuckTimer等「前フレームからの連続移動」を前提にした内部状態は、瞬間移動で
  // 物理的に無関係な値になる(古い小さな移動量の再利用/詰まり誤検知)ため、
  // respawnAt/resetForZombieReuseと同じ一連のリセットをここでも行う。
  blinkTo(x: number, y: number, z: number): void {
    const by = y + this.feetOffset;
    this.body.setTranslation({ x, y: by, z }, true);
    this.body.setNextKinematicTranslation({ x, y: by, z });
    this._prevBodyPos.set(x, by, z);
    this._horizSpeed = 0;
    this.prevZombieMoved.x = 0;
    this.prevZombieMoved.y = 0;
    this.prevZombieMoved.z = 0;
    this.prevZombieGrounded = false;
    this.prevGiantMoved.x = 0;
    this.prevGiantMoved.y = 0;
    this.prevGiantMoved.z = 0;
    this.climbing = false;
    this.climbBaseY = by;
    this.climbCooldownS = 0;
    this.climbMinS = 0;
    this.climbElapsedS = 0;
    this.stuckTimer = 0;
    this.unstuckSteerS = 0;
    this.unstuckStrafeOverride = null;
    this.strafeTimer = 0;
    this.combatDepthTimer = 0;
    this.combatDepthSign = 1;
    // R55 ⑧: 最終安全弁もここでリセットする(zombie-director側の救済テレポート自体が
    // blinkToで実装されるため、必ずここを通る。リセットしないと再配置直後に
    // zombieHardStuckが立ったままになり、無限再テレポートループを招き得る)。
    this.zombieUnstuckAttempts = 0;
    this.hardStuckS = 0;
    this.hardStuckCheckS = ZOMBIE_HARD_STUCK_CHECK_S;
    this.hardStuckAnchorX = x;
    this.hardStuckAnchorZ = z;
    this.hardStuckAnchorY = by;
    this.prevZombieBlocked = false; // R55 W-C3: 前個体/転移前の壁越しblocked状態を持ち越さない
  }

  // ボスフェーズ遷移時にmatchが呼ぶ。省略したキーは現状維持(部分更新)。
  setBossPhaseFlags(flags: { blackSlash?: boolean; blink?: boolean; pillars?: boolean }): void {
    if (flags.blackSlash !== undefined) this.bossPhaseFlags.blackSlash = flags.blackSlash;
    if (flags.blink !== undefined) this.bossPhaseFlags.blink = flags.blink;
    if (flags.pillars !== undefined) this.bossPhaseFlags.pillars = flags.pillars;
  }

  private buildMasterMesh(color: number, tier: BotTier): void {
    void color; // master always uses black+red scheme
    this.buildMesh(0x0d0d0f, tier);
    // Override glow visor/stripe emissive to red
    this.rig.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshStandardMaterial;
        if (m.emissiveIntensity >= 0.85 && m.roughness <= 0.35 && !m.vertexColors) {
          m.emissive.set(0xcc0a1a);
        }
      }
    });
  }

  private buildGiantMesh(color: number, tier: BotTier): void {
    this.buildMesh(color, tier);
    this.rig.scale.setScalar(1.8);
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

  // ★5 割り当てゼロ版position。ホットパス(footstep距離/bearings/minimap/fk記録)は
  // 毎フレーム bot.position(new Vector3)を呼ばず、こちらへスクラッチを渡して再利用する
  getPositionInto(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** 足元中心→頭のYオフセット。headPosition()の割り当てを避けたい経路(fk記録)用 */
  get headOffsetY(): number {
    return this.headOff;
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
      if (this.dyingTimer > 0) {
        if (this.kind === 'zombie' && this.crowdSlot >= 0) {
          // 群描画中の死亡姿勢はZombieCrowdRendererが同じ式で合成する。
          // 非表示のObject3D骨を毎フレーム動かさず、タイマー/可視状態だけ進める。
          this.dyingTimer -= dt;
          if (this.dyingTimer <= 0) this.group.visible = false;
        } else {
          this.updateDying(dt);
        }
      }
      return;
    }
    // R53 怯えの減衰(全kind共通。movement分岐が _fearS>0 を参照する)
    if (this._fearS > 0) this._fearS = Math.max(0, this._fearS - dt);

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
      // InstancedMesh対象はgetCrowdPoseが描画同期を担う。非表示rigへの9部位更新を止める。
      if (this.crowdSlot < 0) this.syncMesh();
      return;
    }

    if (this.kind === 'giant') {
      this.anim += dt;
      this.updateGiant(dt, ctx);
      this.syncMesh();
      return;
    }

    // ── kind別ディスパッチ(humanoid以外は専用の移動体系を持つ)──
    if (this.kind !== 'humanoid' && this.kind !== 'master') {
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

    // R53-T5: 剛体位置は本関数内で(まだ)変化しない(setNextKinematicTranslationは次の
    // world.step()まで反映されない)ため、1回だけ取得して以降すべての位置参照に使い回す
    // (旧: this.position を分岐ごとに複数回呼び、その都度new Vector3していた)
    const pos = this.getPositionInto(HUMANOID_POS_SCRATCH);

    let wishX = 0;
    let wishZ = 0;
    if (ctx.targetEye) {
      const toTarget = HUMANOID_TO_SCRATCH.copy(ctx.targetEye).sub(pos);
      toTarget.y = 0;
      const dist = toTarget.length();
      toTarget.normalize();
      this.heading = Math.atan2(-toTarget.x, -toTarget.z);

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        // 横方向の切替を遅くし、小刻みな左右往復を抑える。
        this.strafeTimer = 2.4 + ctx.rand() * 3.2;
      }
      this.combatDepthTimer -= dt;
      if (this.combatDepthTimer <= 0) {
        this.combatDepthSign = this.combatDepthSign === 1 ? -1 : 1;
        // 前後の間合い調整を主役にする。一定時間ごとに寄る／引くを切り替える。
        this.combatDepthTimer = 1.5 + ctx.rand() * 2.2;
      }
      // アンスタック発動中は strafeOverride が strafe 方向を一時乗っ取る(combatのみ)
      const effectiveStrafeSign = this.unstuckStrafeOverride ?? this.strafeSign;
      const side = HUMANOID_SIDE_SCRATCH
        .set(-toTarget.z, 0, toTarget.x)
        .multiplyScalar(effectiveStrafeSign);
      const weights = humanoidCombatMoveWeights(dist, this.combatDepthSign, {
        flee: this.fleeMode,
        feared: this._fearS > 0,
        unstuck: this.unstuckStrafeOverride !== null,
        master: this.kind === 'master',
      });
      wishX = (side.x * weights.lateral + toTarget.x * weights.longitudinal) * this.moveSpeed;
      wishZ = (side.z * weights.lateral + toTarget.z * weights.longitudinal) * this.moveSpeed;
    } else if (this.alert > 0 && this.alertPos && !ctx.objective) {
      // 警戒調査: 銃声などの音源方向へ振り向き、ゆっくり近づいて確かめる。
      // 千里眼にはならず「振り向いた結果、視野に入れば見つかる」自然な流れ。
      // 拠点(objective)持ちは調査で持ち場を放棄しない(ドミネーションの成立を守る)
      const toAlert = HUMANOID_TO_SCRATCH.copy(this.alertPos).sub(pos);
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
    } else if (this._escortWaypoints && this.escortIdx < this._escortWaypoints.length) {
      // R53-W2 護衛追従: 既存のobjective-seek(拠点目標)と同じ「近づく→heading更新→歩く」
      // 形を経由点リストへ適用した最小実装。到達したら次のwaypointへ進む(bot.ts内で完結)。
      const wp = this._escortWaypoints[this.escortIdx];
      if (wp) {
        const toWp = HUMANOID_TO_SCRATCH.copy(wp).sub(pos);
        toWp.y = 0;
        const dist = toWp.length();
        if (dist <= 3) {
          this.escortIdx += 1; // 到達→次のwaypointへ(末尾到達後は下のobjective/徘徊へ委譲)
        } else {
          toWp.normalize();
          this.heading = Math.atan2(-toWp.x, -toWp.z);
          const f = this.facing();
          wishX = f.x * this.moveSpeed * 0.85;
          wishZ = f.z * this.moveSpeed * 0.85;
        }
      }
    } else if (ctx.objective && pos.distanceTo(ctx.objective) > 3) {
      // 拠点へ向かう。直進しすぎないよう周期的に揺らす
      // (headingが移動方向を兼ねるため、警戒中でも拠点行動を優先する)
      const toObjective = HUMANOID_TO_SCRATCH.copy(ctx.objective).sub(pos).setY(0).normalize();
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
        this.headingTimer = 1 + ctx.rand() * 1.5; // 直線暴走の抑制(旧: 2+rand*3)
      }
      const f = this.facing();
      wishX = f.x * this.moveSpeed * 0.7;
      wishZ = f.z * this.moveSpeed * 0.7;
    }

    // ── ダブルジャンプ(humanoid/master 専用) ──
    this.doubleJumpCooldown = Math.max(0, this.doubleJumpCooldown - dt);
    {
      const _grnd = this.controller.computedGrounded();
      if (_grnd && this.velY <= 0) {
        this.airJumpsLeft = 1;
        this.sinceGrounded = 0;
      } else {
        this.sinceGrounded += dt;
      }
    }
    if (
      this.airJumpsLeft > 0 &&
      this.sinceGrounded > 0.3 &&
      this.velY < 0 &&
      this.doubleJumpCooldown <= 0 &&
      ctx.targetEye !== null &&
      ctx.rand() < (this.kind === 'master' ? 0.012 : 0.004)
    ) {
      this.velY = 5.5;
      this.airJumpsLeft -= 1;
      this.doubleJumpCooldown = (this.kind === 'master' ? 1.8 : 3.5) + ctx.rand() * 1.5;
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
          // R53-T5: 剛体はまだ動いていないので上で取得済みの pos をそのまま再利用できる
          const leftBlocked = this.probeDirection(pos, this.heading + Math.PI / 2);
          const rightBlocked = this.probeDirection(pos, this.heading - Math.PI / 2);
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

    // master 近接: 極近距離で刃を振る(射撃との複合攻撃)
    if (this.kind === 'master' && ctx.targetEye) {
      this.meleeTimer = Math.max(0, this.meleeTimer - dt);
      const dist = ctx.targetEye.distanceTo(pos); // R53-T5: 上で取得済みのposを再利用
      if (dist <= MASTER_MELEE_RANGE && this.meleeTimer <= 0 && ctx.onMelee) {
        ctx.onMelee(this);
        this.meleeTimer = MASTER_MELEE_CD;
      }
    }
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
  // ★ KCC距離LOD: 25m超の computeColliderMovement をバケット化(50%〜75%削減)。
  // 登坂中 or melee射程内は常時フル解決で品質を維持する。
  // ★ アンスタック(humanoidから移植): heading は毎フレーム target 方向へ再計算されて
  // 上書きされるため、詰まり検知時の是正は heading ではなく wish ベクトルへの横バイアス
  // 注入(unstuckStrafeOverride)で行う。詳細は wish 計算直後とKCC LODブロック内を参照。
  private updateZombie(dt: number, ctx: BotContext): void {
    // R53-T5: ★5と同じスクラッチ流儀(updateGiant参照)。this.position/.clone()の
    // 毎フレームnew Vector3を根絶する(群れ数×毎フレームでGC圧が大きい経路)
    const pos = this.getPositionInto(ZOMBIE_POS_SCRATCH);
    let wishX = 0;
    let wishZ = 0;
    const target = ctx.targetEye;
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    const meleeRange = this.tier === 'boss' ? ZOMBIE_BOSS_MELEE_RANGE : ZOMBIE_MELEE_RANGE;

    // KCC LOD 用: プレイヤーまでの距離(target=プレイヤー目線)
    let distToPlayer = Infinity;
    if (target) {
      const to = ZOMBIE_TO_SCRATCH.copy(target).sub(pos);
      to.y = 0;
      const dist = to.length();
      distToPlayer = dist;
      if (dist > 1e-3) to.normalize();
      this.heading = Math.atan2(-to.x, -to.z);
      // R53 怯え: ゾンビは0.4sのよろめき(移動×0.2)。姿勢式(getCrowdPose)は速度非依存の
      // walkPhase/anim駆動のためInstancedMesh群経路とも自然に整合する(遅く歩くだけ)
      const fearMul = this._fearS > 0 ? 0.2 : 1;
      const spd = this.moveSpeed * this.zombieRunMul * fearMul;
      wishX = to.x * spd;
      wishZ = to.z * spd;
      // ── アンスタック: ラッチ中は横バイアスをwishへ直接注入する(humanoidのunstuckStrafeOverride
      // をゾンビへ移植)。headingは直後に再びtarget方向へ上書きされるため、heading操作ではwish
      // に影響を残せない。dist>meleeRangeガード必須: 密着時の意図的低速(*0.15)を詰まりと
      // 誤判定させないため、近接射程内ではバイアスを注入しない。ただし直線距離だけの
      // dist<=meleeRangeは「壁越しの偽近接」(壁の向こうにプレイヤーがいて距離だけ近い)を
      // 見分けられない。R55 W-C3: 前フレームで実際に前進ブロックされていた(prevZombieBlocked)
      // なら、近接射程内でも偽近接とみなしバイアス注入を有効にする。
      if (this.unstuckStrafeOverride !== null && (dist > meleeRange || this.prevZombieBlocked)) {
        // R55: 迂回の連続失敗回数に応じて横成分を強める(浅い迂回で同じ壁へ押し戻される
        // のを防ぐ)。0.8倍(初回)〜最大1.6倍(ZOMBIE_UNSTUCK_MAX_ATTEMPTS到達)で頭打ち。
        const strafeMul = Math.min(1.6, 0.8 + this.zombieUnstuckAttempts * 0.2);
        wishX += -to.z * this.unstuckStrafeOverride * this.moveSpeed * strafeMul;
        wishZ += to.x * this.unstuckStrafeOverride * this.moveSpeed * strafeMul;
      }
      if (dist <= meleeRange) {
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

    // ── R55 ⑧最終安全弁: 迂回ロジックの成否に関わらず「本当に前進できているか」を
    // 1s間隔で独立にサンプリングする。stuckTimer(短周期の検知→ラッチ試行)とは別の
    // 絶対タイマーとして働くため、迂回ロジック自体に死角(完全に囲まれたポケット等)が
    // あっても、zombie-director側のテレポート救済(zombieHardStuck/zombieHardStuckForce)
    // が最終的にラウンド進行を保証できる。近接交戦中(意図的低速)/目標喪失中は
    // 誤検知するため測定を一時停止し、その間はアンカーだけ現在地に据え直す。
    // R55 W-C3: 「近接交戦中」の判定は直線距離(distToPlayer<=meleeRange)だけでは
    // 「壁越しの偽近接」(壁の向こうにプレイヤーがいて距離だけ近い=実際は前進ブロックされ
    // 詰まっている)を意図的低速と誤判定してしまい、最終安全弁ごと無効化されてしまう。
    // 前フレームで実際に前進ブロックされていた(prevZombieBlocked)場合は「本当に密着」
    // とはみなさず、サンプリングを止めない(壁越し偽近接でもhardStuckSが積算される)。
    //
    // R55 W-C6: 旧実装は「登坂中(this.climbing)はまるごと測定停止」だったため、越えられない
    // 縁/段差での登坂チャタリング(climbMinS経過直後にgrounded&&!blockedが一瞬だけ成立→
    // 即座に登坂終了→次フレーム即再点火、を繰り返す)が起きると、climbing=falseの区間が
    // 常にZOMBIE_HARD_STUCK_CHECK_S(1.0s)未満しか続かず、hardStuckCheckSが1.0sへ戻り続けて
    // 一度もサンプル評価まで到達できず、hardStuckSが永久に0のまま=最終安全弁が発火しなかった
    // (ZOMBIE_CLIMB_SUCCESS_COOLDOWN側の点火間隔対策と合わせ、こちらは検知ロジック自体の
    // 根治: climbing中でも計測は止めない)。climbing中は「XZが進んでいなくても高度
    // (climbBaseYを起点に実際に登れているか)が進んでいれば停滞ではない」とみなし、
    // 良性の登坂(本当に高さを稼げている最中)を停滞と誤検知しないようにする。
    //
    // R57 ⑥修正1: distToPlayer は水平距離のみ(to.y=0で算出、上記コメント参照)のため、
    // プレイヤーが登れない高所(桟橋等、>2.4m上)にいると、真下のゾンビは水平では
    // meleeRange以内かつKCC非ブロック(真下は開けている→wish≈0でblocked=false)となり、
    // 上の「近接交戦中とみなして免除」に恒久的に該当し続ける(hardStuckSが毎フレーム0に
    // リセットされ続け、最終安全弁が永久に発火しない=そのゾンビが最後の1体だとラウンドが
    // 進まなくなる致命バグだった)。zombieMelee(zombie-director.ts)も垂直ガードで実際には
    // 攻撃が届かないため、この個体は「本当に密着」ではなく「垂直に届かない偽近接」。
    // 免除は水平近接に加えて垂直差もZOMBIE_MELEE_VERT_RANGE_M以内(=実際に攻撃が届き得る
    // 高さ関係)の場合のみに限定し、垂直に届かない個体はサンプリングを止めない
    // (hardStuckSが積算され、5s/9sでdirectorが再配置してラウンドを進行させる)。
    if (
      !target ||
      (distToPlayer <= meleeRange &&
        !this.prevZombieBlocked &&
        Math.abs(target.y - pos.y) <= ZOMBIE_MELEE_VERT_RANGE_M)
    ) {
      this.hardStuckCheckS = ZOMBIE_HARD_STUCK_CHECK_S;
      this.hardStuckAnchorX = pos.x;
      this.hardStuckAnchorZ = pos.z;
      this.hardStuckAnchorY = pos.y;
    } else {
      this.hardStuckCheckS -= dt;
      if (this.hardStuckCheckS <= 0) {
        this.hardStuckCheckS = ZOMBIE_HARD_STUCK_CHECK_S;
        const hdx = pos.x - this.hardStuckAnchorX;
        const hdz = pos.z - this.hardStuckAnchorZ;
        const noXZProgress = hdx * hdx + hdz * hdz < ZOMBIE_HARD_STUCK_MOVE_M * ZOMBIE_HARD_STUCK_MOVE_M;
        if (noXZProgress) {
          // climbing中のみ高度側も見る(非climbing中は!this.climbingでtrue固定=従来どおりXZのみ)。
          // 高度が実際に稼げていれば(noYProgress=false)「まだ停滞と断定しない」が、水平に
          // 逃げ切れた確証もないため0クリアはしない(据え置き)。真に逃げ切れば次回サンプルで
          // noXZProgress=falseとなり下のelse枝で確実にクリアされる。
          const noYProgress =
            !this.climbing || Math.abs(pos.y - this.hardStuckAnchorY) < ZOMBIE_HARD_STUCK_MOVE_M;
          if (noYProgress) this.hardStuckS += ZOMBIE_HARD_STUCK_CHECK_S;
        } else {
          this.hardStuckS = 0;
        }
        this.hardStuckAnchorX = pos.x;
        this.hardStuckAnchorZ = pos.z;
        this.hardStuckAnchorY = pos.y;
      }
    }

    // ── R54-W1(B1) 群衆分離: 対ゾンビKCCを除外される個体(hordeRank>=THIN_RANK。下の
    // KCCブロック参照)は互いにすり抜けて重なり得るため、空間ハッシュの反発ベクトルを
    // wishへ加算して見た目の重なりを緩和する。rebuild()の配線が完了するまでは格子が空
    // (=separation()は常に{x:0,z:0})なので、この加算は現時点で完全に無効(非回帰)。
    if (this.hordeRank >= ZOMBIE_HORDE_THIN_RANK) {
      zombieSeparationGrid.separation(this.uid, pos.x, pos.z, ZOMBIE_SEP_SCRATCH);
      wishX += ZOMBIE_SEP_SCRATCH.x;
      wishZ += ZOMBIE_SEP_SCRATCH.z;
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

    // ── KCC距離LOD: 毎フレームの衝突解決をバケット化して高体数時の負荷を削減 ──
    // 登坂中と先頭24体のmelee射程内は常時フル解決。後方群は密集しても既存uid%2
    // カデンスを維持する(近接通知自体は毎フレーム行われ、グローバルi-frameも不変)。
    this.kccFrame += 1;
    const forcedFull =
      this.climbing ||
      (distToPlayer <= meleeRange && this.hordeRank < ZOMBIE_HORDE_THIN_RANK);
    const kccFull =
      forcedFull || zombieKccActive(this.uid, this.kccFrame, distToPlayer, this.hordeRank);

    const movement = this.zombieMovement;
    movement.x = wishX * dt;
    movement.y = vertV * dt;
    movement.z = wishZ * dt;
    let mvX: number;
    let mvY: number;
    let mvZ: number;
    let grounded: boolean;
    let blocked = false; // LODフレームではblocked評価をスキップ(遠距離の登坂点火を抑制)

    if (kccFull) {
      // R54-W1(B1): hordeRank>=THIN_RANK(群衆後方)は他ゾンビのbodyColliderをこの
      // 呼び出しに限り衝突解決の対象から除外する(filterPredicate。collider自体の状態は
      // 不変=被弾レイ/爆風/近接判定/obstacleAhead等の他クエリに一切影響しない)。
      // forcedFull(climbing/melee)経由でここに来た場合も同じ条件で適用してよい
      // (kccFullの「毎フレーム計算するか」というLODカデンスとは独立した判断のため)。
      if (this.hordeRank >= ZOMBIE_HORDE_THIN_RANK && this.zombieCrowdFilterPredicate) {
        this.controller.computeColliderMovement(
          this.bodyCollider,
          movement,
          undefined,
          undefined,
          this.zombieCrowdFilterPredicate,
        );
      } else {
        this.controller.computeColliderMovement(this.bodyCollider, movement);
      }
      const moved = this.controller.computedMovement();
      grounded = this.controller.computedGrounded();
      if (grounded && this.velY < 0) this.velY = -0.5;
      mvX = moved.x;
      mvY = moved.y;
      mvZ = moved.z;
      this.prevZombieMoved.x = mvX;
      this.prevZombieMoved.y = mvY;
      this.prevZombieMoved.z = mvZ;
      this.prevZombieGrounded = grounded;
      // blocked: 前進を阻まれているか(登坂状態機械の入力)
      const wishLen = Math.hypot(movement.x, movement.z);
      const movedLen = Math.hypot(moved.x, moved.z);
      blocked = wishLen > 0.001 && movedLen < wishLen * ZOMBIE_CLIMB_BLOCK;

      // ── アンスタック進捗監視(humanoidから移植): kccFullフレームでのみ評価する。
      // LODで間引かれる分は経過dtをスキップ係数倍し、検知が実時間0.8s前後になるよう補正する
      // (★3整合)。forcedFull(climbing/melee)は毎フレーム評価済みなので係数1のまま。
      const skipFactor = forcedFull ? 1 : zombieKccSkipFactor(distToPlayer, this.hordeRank);
      const effDt = dt * skipFactor;
      this.unstuckSteerS = Math.max(0, this.unstuckSteerS - effDt);
      if (this.unstuckSteerS <= 0) this.unstuckStrafeOverride = null;
      if (this.unstuckSteerS <= 0) {
        if (blocked) {
          this.stuckTimer += effDt;
          if (this.stuckTimer > HUMANOID_STUCK_TH) {
            const leftBlocked = this.probeDirection(pos, this.heading + Math.PI / 2);
            const rightBlocked = this.probeDirection(pos, this.heading - Math.PI / 2);
            let sign: number;
            if (rightBlocked && !leftBlocked) sign = -1;
            else if (leftBlocked && !rightBlocked) sign = 1;
            else if (!leftBlocked && !rightBlocked) sign = ctx.rand() < 0.5 ? 1 : -1;
            else {
              // R55: 左右(±90°)とも塞がれている=コーナー/ポケットの可能性が高い。
              // 斜め135°まで探索を広げ、開いている側があればそちらへ迂回する
              // (両方とも塞がっていれば従来どおり五分五分。最終的にはhardStuckSの
              // 安全弁が担保するため、ここで完全解を求める必要はない)。
              const diagL = !this.probeDirection(pos, this.heading + (Math.PI * 3) / 4);
              const diagR = !this.probeDirection(pos, this.heading - (Math.PI * 3) / 4);
              if (diagR && !diagL) sign = 1;
              else if (diagL && !diagR) sign = -1;
              else sign = ctx.rand() < 0.5 ? 1 : -1;
            }
            this.unstuckStrafeOverride = sign;
            // R55: 失敗を重ねるほどラッチを延長する(浅い迂回で同じ壁へ押し戻されるのを
            // 防ぐ)。頭打ちはZOMBIE_UNSTUCK_MAX_ATTEMPTS。前進できたら下のelse枝で即0へ
            this.zombieUnstuckAttempts = Math.min(
              ZOMBIE_UNSTUCK_MAX_ATTEMPTS,
              this.zombieUnstuckAttempts + 1,
            );
            this.unstuckSteerS =
              HUMANOID_UNSTUCK_S + this.zombieUnstuckAttempts * ZOMBIE_UNSTUCK_ESCALATE_S;
            this.stuckTimer = 0;
          }
        } else {
          this.stuckTimer = Math.max(0, this.stuckTimer - effDt * 2); // 進捗あれば急速リセット
          this.zombieUnstuckAttempts = 0; // 前進できた=迂回成功。エスカレーションをリセット
        }
      }
    } else {
      // LODフレーム: 前回movedを再利用(1〜3フレーム分の数cm誤差=25m超では視認不能)
      mvX = this.prevZombieMoved.x;
      mvY = this.prevZombieMoved.y;
      mvZ = this.prevZombieMoved.z;
      grounded = this.prevZombieGrounded;
      if (grounded && this.velY < 0) this.velY = -0.5;
    }

    // 接地して登坂していない間だけ登坂の基準足元Yを追従(上限高さ判定の起点=青天井防止)
    if (grounded && !canRise) this.climbBaseY = pos.y;
    // ── 登坂状態機械(R21フェーズ化で縁チャタリングを根治)──
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
        // R55 W-C6: ここにクールダウンを設定していなかったため、越えられない縁で
        // grounded&&!blockedが一瞬だけ成立→即終了→次フレーム即再点火のチャタリングを
        // 起こし得た(hardStuckサンプリング窓を完走させる区間が作れない)。
        // ZOMBIE_HARD_STUCK_CHECK_S超のクールダウンを必ず挟む。
        this.climbing = false;
        this.climbCooldownS = ZOMBIE_CLIMB_SUCCESS_COOLDOWN;
        this.climbElapsedS = 0;
      }
      // それ以外(最小時間内 / 空中 / まだ blocked): 登坂継続
    } else {
      this.climbElapsedS = 0;
      // 点火条件: クールダウン明け + 前進ブロック + 目標あり + 上限未満 + 前方に実体あり
      // LODフレームはblocked=falseなので遠距離での誤点火なし
      if (this.climbCooldownS <= 0 && blocked && target && underCap && this.obstacleAhead(pos)) {
        this.climbing = true;
        this.climbMinS = ZOMBIE_CLIMB_MIN_S; // 最小継続時間を設定(縁チャタリング防止)
      } else if (blocked) {
        // 登坂しない: クールダウン中/目標なし/上限超過/障害物なし → 横へ回り込む
        this.heading += (ctx.rand() - 0.5) * 1.6;
      }
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mvX, y: t.y + mvY, z: t.z + mvZ });
    const step = Math.hypot(mvX, mvZ);
    const targetAmp = Math.min(1, step / Math.max(1e-4, this.moveSpeed * dt));
    this.walkAmp += (targetAmp - this.walkAmp) * Math.min(1, dt * 8);
    this.walkPhase += step * 8;
    // R55 W-C3: 次フレームの「近接射程内ガード」判定用に今フレームのblockedを保持する
    // (blockedはKCC計算後にしか確定しないため1フレーム遅延。distToPlayer<=meleeRangeでは
    // forcedFull=trueで毎フレームblockedがフル計算されるため、ガードが参照する局面では
    // 常に最新の実測値になる)。
    this.prevZombieBlocked = blocked;
  }

  // アンスタック用: 指定角度の水平方向へ短いレイを撃ち、障害物があれば true を返す
  // (humanoid/zombie共用)。kinematic を含む全コライダーを対象とし、wallやpropへの
  // 引っかかり両方を検出する。
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

  private updateGiant(dt: number, ctx: BotContext): void {
    const pos = this.getPositionInto(GIANT_POS_SCRATCH); // ★5 スクラッチ再利用
    let wishX = 0;
    let wishZ = 0;
    const target = ctx.targetEye;
    // ★2 KCC LOD判定用距離。target無し(プレイヤー死亡中など)は遠距離扱いで間引く
    let distToPlayer = Infinity;
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    if (target) {
      const to = GIANT_TO_SCRATCH.copy(target).sub(pos);
      to.y = 0;
      const dist = to.length();
      distToPlayer = dist;
      if (dist > 1e-3) to.normalize();
      this.heading = Math.atan2(-to.x, -to.z);
      wishX = to.x * this.moveSpeed;
      wishZ = to.z * this.moveSpeed;
      if (dist <= GIANT_MELEE_RANGE) {
        wishX *= 0.15;
        wishZ *= 0.15;
        if (this.meleeTimer <= 0 && ctx.onMelee) {
          ctx.onMelee(this);
          this.meleeTimer = GIANT_MELEE_CD;
        }
      }
    } else {
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = ctx.rand() * Math.PI * 2;
        this.headingTimer = 1.5 + ctx.rand() * 2;
      }
      const f = this.facing();
      wishX = f.x * this.moveSpeed * 0.4;
      wishZ = f.z * this.moveSpeed * 0.4;
    }
    this.velY = applyGravityStep(this.velY, 1, dt);
    // ★2 30m超はuid%2で2フレームに1回だけ衝突解決。非担当フレームは前回movedを再利用
    // (全巨躯54体のcomputeColliderMovementを遠距離で半減。近距離は毎フレーム=非回帰)
    this.kccFrame += 1;
    let mvX: number;
    let mvY: number;
    let mvZ: number;
    if (giantKccActive(this.uid, this.kccFrame, distToPlayer)) {
      const movement = { x: wishX * dt, y: this.velY * dt, z: wishZ * dt };
      this.controller.computeColliderMovement(this.bodyCollider, movement);
      const moved = this.controller.computedMovement();
      if (this.controller.computedGrounded() && this.velY < 0) this.velY = -0.5;
      mvX = moved.x;
      mvY = moved.y;
      mvZ = moved.z;
      this.prevGiantMoved.x = mvX;
      this.prevGiantMoved.y = mvY;
      this.prevGiantMoved.z = mvZ;
    } else {
      mvX = this.prevGiantMoved.x;
      mvY = this.prevGiantMoved.y;
      mvZ = this.prevGiantMoved.z;
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mvX, y: t.y + mvY, z: t.z + mvZ });
    const step = Math.hypot(mvX, mvZ);
    const targetAmp = Math.min(1, step / Math.max(1e-4, this.moveSpeed * dt));
    this.walkAmp += (targetAmp - this.walkAmp) * Math.min(1, dt * 8);
    this.walkPhase += step * 8;
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
    // R53-W3 M3: 怯え(帝威)中は実効spreadを 1/fearAccuracyMul(=2倍拡散)へ広げる。
    // bot は状態(feared)のみ保持し、実効化はこの発砲spread1点で行う(825行の契約コメント)
    const fearMul = this.feared ? 1 / fearAccuracyMul : 1;
    const spread = (ctx.tuning.spreadDeg * fearMul * Math.PI) / 180;
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
    if (this.kind === 'master') return 4 + Math.floor(rand() * 3);
    return 3 + Math.floor(rand() * 3);
  }

  // kind別の発射間隔。humanoid/tank(単発)は従来の0.16sを維持する
  private shotInterval(): number {
    if (this.kind === 'drone') return 0.09;
    if (this.kind === 'turret') return 0.12;
    if (this.kind === 'master') return 0.10;
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
      // R53-T1: rigLiftY基準(通常0。boss zombieのみ足沈み補正)から膝崩れ分を沈める
      this.rig.position.y = this.rigLiftY - buckle * 0.22;
      const fall = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
      const ease = fall * fall * (3 - 2 * fall); // smoothstep
      this.group.rotation.x = ease * (Math.PI / 2) * 0.95;
      this.group.rotation.z = ease * this.deathTilt;
    }
    if (this.dyingTimer <= 0) this.group.visible = false;
  }

  syncMesh(): void {
    const t = this.body.translation();
    this.group.position.set(t.x, t.y + this.visualLift, t.z);
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
      // ★8 遠距離(>50m)はシャンブルsin群をスキップ(位置/向きは上で同期済み=視認不能)
      if (this.animLod) return;
      // ★ 半減LOD(25-50m): uid%2バケットの非担当フレームはスキップ(視認差ほぼゼロ)
      if (this.animHalfLod && (this.kccFrame & 1) !== (this.uid & 1)) return;
      // シャンブル歩容: 前傾 + 左右のよろめき + 逆位相の脚スイング + 前へ垂らした腕の揺れ。
      // humanoidの歩行コードへ落とすと armRig をライフル把持ポーズで毎フレーム上書きしてしまう
      const zs = Math.sin(this.walkPhase);
      const zswing = zs * this.walkAmp * 0.65;
      this.legL.rotation.x = zswing;
      this.legR.rotation.x = -zswing;
      this.kneeL.rotation.x = Math.max(0, -zs) * this.walkAmp * 0.9;
      this.kneeR.rotation.x = Math.max(0, zs) * this.walkAmp * 0.9;
      this.rig.rotation.x = -(0.26 + Math.sin(this.anim * 3.1) * 0.045); // 常時前傾(-Z)+上下よろめき ★HF: 符号反転で真の前傾に
      this.rig.rotation.z = Math.sin(this.anim * 1.7 + this.bobPhase) * 0.07; // 左右のよろめき
      // R53-T1: rigLiftY(通常0。boss zombieのみ足沈み補正)を基準にボブを重ねる
      this.rig.position.y = this.rigLiftY + Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.03;
      if (this.armRig) {
        this.armRig.rotation.x = Math.sin(this.anim * 2.3) * 0.12; // 前へ突き出した腕を揺らす
        this.armRig.rotation.z = Math.sin(this.anim * 1.3 + this.bobPhase) * 0.05;
      }
      return;
    }
    // ★8 遠距離(>50m)は歩行スイング/呼吸/スウェイのsin群をスキップ(位置/向きのみ同期)
    if (this.animLod) return;
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
    // R54-W1 Q7: rigLiftY(通常0。boss humanoid/masterのみ足沈み補正)を基準にボブを重ねる
    // (zombie boss経路の既存式=2699/2648/2791/2839/2947行と同じ流儀に揃える)
    this.rig.position.y = this.rigLiftY + Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.04 + breath;
    // 被弾時の一瞬ののけぞり(上体を後ろへ傾ける)
    this.rig.rotation.x = -(this.flinch / 0.14) * 0.18;
    // armRigの微スウェイ(把持ポーズを保ったまま±0.14rad内で揺らす)
    if (this.armRig) {
      this.armRig.rotation.x = Math.sin(this.anim * 1.5) * 0.05 * idle - swing * 0.12;
      this.armRig.rotation.z = Math.sin(this.anim * 0.9 + 1.1) * 0.03 * idle;
    }
  }

  // ── R53-W3 ゾンビ群InstancedMesh化: 描画経路の切替と姿勢の書き出し ─────────
  // setCrowdSlot(slot>=0)で自前のrig(Object3D)を非表示にし、以後の見た目は
  // ZombieCrowdRenderer(src/render/zombie-crowd.ts)のInstancedMeshが担う。
  // ロジック(group.position/コライダー/AI)は完全に従来どおり。slot=-1で即座に
  // 従来描画へ戻る(キルスイッチ/最近接高忠実度/variant化のフォールバック)。
  setCrowdSlot(slot: number): void {
    this.crowdSlot = slot;
    if (slot < 0) {
      // 群経路中はsyncMeshを止めているため、Object3Dへ戻す瞬間に最新剛体姿勢を反映する。
      this.syncMesh();
      this.rig.visible = true;
    } else {
      this.rig.visible = false;
    }
  }

  // 群レンダラへの姿勢書き出し(アロケゼロ。syncMesh/updateDyingの式の「入力」を
  // そのまま渡す — 合成式はzombie-crowd.tsのcomposeZombieCrowdMatricesが持ち、
  // その等価性はzombie-crowd.test.tsが行列レベルで固定している)。
  // 注意: crowdSlot>=0 の間、matchはsyncMesh()の代わりにこれを毎フレーム呼ぶ
  // (rigは非表示なのでsyncMeshのsin群は無駄仕事になるだけで害はないが、二重コスト回避)。
  getCrowdPose(out: ZombieCrowdPose): void {
    const t = this.body.translation();
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    out.visualLift = this.visualLift;
    out.rigLiftY = this.rigLiftY;
    out.scale = this.tuning.scale;
    out.heading = this.heading;
    out.walkPhase = this.walkPhase;
    out.walkAmp = this.walkAmp;
    out.anim = this.anim;
    out.bobPhase = this.bobPhase;
    out.deathTilt = this.deathTilt;
    out.dying01 = this.alive ? 0 : 1 - Math.max(0, this.dyingTimer) / KIND_DEATH_S[this.kind];
    out.visible = this.group.visible;
    out.elite = this.tier === 'elite';
  }

  // R54-W1(F4): humanoid群レンダラへの姿勢書き出し(アロケゼロ)。
  // syncMesh(humanoid生存分岐)の式の入力をそのまま渡す — 合成式は
  // humanoid-crowd.ts の composeHumanoidCrowdMatrices が持ち、等価性は
  // humanoid-crowd.test.ts が実Botとの行列比較で固定する。
  // 死亡時はmatch側がslotを解放してObject3D経路へ戻す(dissolve/updateDyingは従来のまま)。
  getHumanoidCrowdPose(out: HumanoidCrowdPose): void {
    const t = this.body.translation();
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    out.rigLiftY = this.rigLiftY;
    out.heading = this.heading;
    out.walkPhase = this.walkPhase;
    out.walkAmp = this.walkAmp;
    out.anim = this.anim;
    out.flinch = this.flinch;
    out.glow = this.tierGlowBase + (this.hitFlash / 0.12) * 0.7; // update()の実式と同じ
    out.elite = this.tier === 'elite';
    out.colorHex = this.humanoidColorHex;
    out.visible = this.alive && this.group.visible;
  }

  // ── R53-T3: ファイナルキルカム公開API(契約凍結) ──────────────────────────
  // match.ts はこれまで FkBotRig という duck-typing 構造型で bot 内部の private
  // フィールド(rig/legL/legR/kneeL/kneeR/turretGroup/tankBarrel/turretHead/turretLegs/
  // dissolveU/deathTilt)へ無警告で直接アクセスしていた。以下の3メソッドへ置き換え、
  // bot側の内部表現を隠蔽する。式は旧 match.ts の fkResetAlivePose / fkApplyDeathPose と
  // 完全に等価(キルカムの見た目を1px単位で非回帰にする最重要条件)。

  /**
   * キルカム: 記録済みフレームのワールド座標/向きへ生存姿勢を適用する
   * (旧 match.ts fkApplyFrame のうち bot 側の処理: 位置/向き/可視化+死亡演出の巻き戻し)。
   * 呼び出し側は非alive表示(バッファのaliveフラグ=false)の場合はこれを呼ばず、
   * bot.group.position/rotation.y の設定と bot.group.visible=false のみ行うこと
   * (group は既存どおり公開フィールドなので直接操作できる)。
   */
  fkApplyLivePose(x: number, y: number, z: number, rotY: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = rotY;
    this.group.visible = true;
    this.fkResetPose();
  }

  /**
   * キルカム: 死亡演出で変形したトランスフォームを生存姿勢へ巻き戻す
   * (旧 match.ts fkResetAlivePose と同一。bot.ts respawnAt の視覚リセット部分とも同じ式)。
   * fkApplyLivePose が内部で呼ぶほか、match が単独で呼んでもよい。
   */
  fkResetPose(): void {
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.rig.position.y = this.rigLiftY; // R53-T1: boss zombieの足沈み補正を保持(他は0)
    this.rig.rotation.x = 0;
    this.rig.rotation.z = 0;
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(0, 0, 0);
    this.kneeR.rotation.set(0, 0, 0);
    this.dissolveU.value = 0;
    if (this.turretGroup) {
      this.turretGroup.position.set(0, 0.95, 0.1);
      this.turretGroup.rotation.set(0, 0, 0);
    }
    if (this.tankBarrel) this.tankBarrel.rotation.set(0, 0, 0);
    if (this.turretHead) this.turretHead.rotation.set(0, 0, 0);
    for (const leg of this.turretLegs) leg.rotation.x = 0;
  }

  /**
   * キルカム: キル時刻からの経過秒を正規化した t01(0..1, 呼び出し側が
   * kind別の全長で割ってクランプ済みのもの)で死亡演出ポーズを手続き再現する
   * (旧 match.ts fkApplyDeathPose と同一式。bot.ts updateDying の式そのもの、ただし
   * カウントダウンではなく経過側)。fkResetPose 済みの姿勢に対して適用する前提。
   */
  fkApplyDeathPose(t01: number): void {
    const t = THREE.MathUtils.clamp(t01, 0, 1);
    if (this.kind === 'drone') {
      // 墜落スピンの簡易再現(物理Y降下は再現せず回転のみ)
      this.group.rotation.x = t * (Math.PI / 2) * 0.8;
      this.group.rotation.z = t * Math.PI * 1.5;
    } else if (this.kind === 'turret') {
      this.group.rotation.z = -1.25 * t;
      if (this.turretHead) this.turretHead.rotation.x = t * 0.9;
      for (const leg of this.turretLegs) leg.rotation.x = -t * 0.4;
    } else if (this.kind === 'tank') {
      const blow = THREE.MathUtils.clamp(t / 0.3, 0, 1);
      if (this.turretGroup) {
        this.turretGroup.position.y = 0.95 + blow * 0.9;
        this.turretGroup.rotation.z = blow * 0.7 * (this.deathTilt >= 0 ? 1 : -1);
        this.turretGroup.rotation.x = -blow * 0.5;
      }
      if (this.tankBarrel) this.tankBarrel.rotation.x = blow * 0.6;
    } else {
      // humanoid / zombie / master / giant: 膝崩れ(前段)→前傾横倒し(後段)
      const buckle = THREE.MathUtils.clamp(t / 0.45, 0, 1);
      this.legL.rotation.x = buckle * 0.3;
      this.legR.rotation.x = buckle * 0.3;
      this.kneeL.rotation.x = buckle * 1.4;
      this.kneeR.rotation.x = buckle * 1.4;
      this.rig.position.y = this.rigLiftY - buckle * 0.22;
      const fall = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
      const ease = fall * fall * (3 - 2 * fall); // smoothstep
      this.group.rotation.x = ease * (Math.PI / 2) * 0.95;
      this.group.rotation.z = ease * this.deathTilt;
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
    // ボスゾンビはスーパーアーマー: 被弾エフェクトを弱めて怯まず迫る
    const isBossZombieHit = this.kind === 'zombie' && this.tier === 'boss';
    this.hitFlash = isBossZombieHit ? 0.04 : 0.12;
    this.flinch = isBossZombieHit ? 0.02 : 0.14;
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
    // humanoid/zombie共用アンスタック状態もリセット
    this.stuckTimer = 0;
    this.unstuckSteerS = 0;
    this.unstuckStrafeOverride = null;
    this.strafeTimer = 0;
    this.combatDepthTimer = 0;
    this.combatDepthSign = 1;
    // R55 ⑧: ゾンビ専用アンスタック/最終安全弁もリセット(リスポーン/プール再利用で
    // 前個体の停滞タイマーを持ち越さない)
    this.zombieUnstuckAttempts = 0;
    this.hardStuckS = 0;
    this.hardStuckCheckS = ZOMBIE_HARD_STUCK_CHECK_S;
    this.hardStuckAnchorX = spawn.x;
    this.hardStuckAnchorZ = spawn.z;
    this.hardStuckAnchorY = spawn.y + this.feetOffset;
    this.prevZombieBlocked = false; // R55 W-C3: 前個体の壁越しblocked状態を持ち越さない
    // ゾンビKCC距離LODの前回movedキャッシュもリセット(プール再利用の取りこぼし防止。
    // 新スポーンの初フレームがLODスキップ側に回っても前個体の移動量を引き継がない)
    this.prevZombieMoved.x = 0;
    this.prevZombieMoved.y = 0;
    this.prevZombieMoved.z = 0;
    this.prevZombieGrounded = false;
    // horizSpeedMps: スポーン地点を前フレーム位置として初期化(最初のフレームでスパイクしない)
    this._horizSpeed = 0;
    this._prevBodyPos.set(spawn.x, spawn.y + this.feetOffset, spawn.z);
    this.group.visible = true;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0; // drone墜落/turret転倒のリセット
    this.walkAmp = 0;
    this.rig.position.y = this.rigLiftY; // R53-T1: boss zombieの足沈み補正を保持(他は0)
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

  // ★ ゾンビメッシュプール: 死んだゾンビのBotインスタンスをプールへ戻す前に新調ゾンビとして再利用。
  // buildZombieMesh()のGPUリソース生成コストをラウンド2以降で完全にゼロにする。
  // eliteやbossは色が異なるため通常ゾンビ専用(match側でtierをチェックして振り分け)。
  resetForZombieReuse(newTuning: BotTuning, spawn: THREE.Vector3): void {
    this.maxHp = newTuning.maxHp;
    this.moveSpeed = MOVE_SPEED * newTuning.moveSpeedMul;
    this.tuning.maxHp = newTuning.maxHp;
    this.tuning.moveSpeedMul = newTuning.moveSpeedMul;
    this.tuning.damage = newTuning.damage;
    this.animLod = false;
    this.animHalfLod = false;
    // R53-W2: 旧variantの装飾メッシュを必ず除去+null化する(新調ゾンビが無変種でも
    // 前個体の変種見た目/フラグを持ち越さない。R51合成漏斗罠の再発防止テスト対象)。
    // 新しい変種はこの後match側がapplyZombieVariantVisual()を呼んで付与する。
    this.clearZombieVariantVisual();
    // ★V-A修正: 怯え/ストーリー系の残留状態もプール再利用でリセット(怯え中に死亡→即再利用
    // された個体が「生まれつき硬直」する真のリークを塞ぐ。fleeMode等は通常ゾンビに設定され
    // ないが防御的に初期化)
    this._fearS = 0;
    this.fleeMode = false;
    this.escortWaypoints = null;
    this.setBossPhaseFlags({ blackSlash: false, blink: false, pillars: false });
    this.respawnAt(spawn);
  }

  // 死んで死亡演出も終わった(=解放してよい)か。ゾンビの死体回収(cleanupDeadZombies)の判定。
  get corpseCleared(): boolean {
    return !this.alive && this.dyingTimer <= 0;
  }

  // R55 ⑧: 5秒以上「本当に前進できていない」個体(updateZombieのhardStuckS参照)。
  // zombie-director側はこれが立った個体をプレイヤー視界外へテレポート救済する対象とし、
  // 「プロップに挟まって倒せずラウンドが永久に進まない」を構造的に防ぐ最後の砦とする。
  get zombieHardStuck(): boolean {
    return this.hardStuckS >= ZOMBIE_HARD_STUCK_RELOCATE_S;
  }

  // R55 ⑧: 視界外を待っても救済できない(プレイヤーが見続けている等)場合の強制テレポート
  // 閾値。ラウンド進行の絶対保証のため、視界内チェックをバイパスしてでも再配置してよい。
  get zombieHardStuckForce(): boolean {
    return this.hardStuckS >= ZOMBIE_HARD_STUCK_FORCE_S;
  }

  // 近接影LOD: 遠いゾンビの castShadow を止める(mapSize churnを避け周期トグルされる)。
  // 元々no-shadowだったディテール(userData.noShadow)は点け直さない。
  setCastShadow(on: boolean): void {
    this.shadowCasting = on; // R54-W1(F4): humanoid群の対象判定(feedHumanoidCrowd)が読む
    this.rig.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = on && obj.userData.noShadow !== true;
    });
  }

  // 単体除去(ゾンビ死体の解放)。RigidBody除去で付随colliderも自動解放され、
  // group配下の(merge済み一意)geometry/materialを解放する。共有寸法キャッシュは
  // mergeByMaterialがcloneして焼くのでここには含まれず、破棄対象にならない。
  // ★7 userData.shared=true(getSharedZombieDarkMat等の共有材)はここでdisposeしない
  // (viewmodel.tsの共有マテリアルと同じ保護パターン。他個体がまだ参照している)。
  dispose(): void {
    // R54-W1(B1): World単位のゾンビcollider handle集合からも解除する(removeRigidBodyで
    // handleが無効化される前に行う。WeakMap<World,Set>自体はWorld破棄でGC対象)
    if (this.kind === 'zombie') {
      const handles = zombieHandleSet(this.world);
      handles.delete(this.bodyCollider.handle);
      handles.delete(this.headCollider.handle);
    }
    // R16修正: KinematicCharacterController も解放(無限ゾンビモードでの青天井リーク防止)
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry.userData.shared !== true) obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) {
          for (const m of mat) if (m.userData.shared !== true) m.dispose();
        } else if (mat.userData.shared !== true) {
          mat.dispose();
        }
      }
    });
  }
}
