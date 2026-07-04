import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import { mulberry32, type Rand } from '../core/rng';
import { RADAR_RANGE_M, resolveGraphicsTier, type GraphicsQuality, type Settings } from '../core/settings';
import { Effects } from '../render/effects';
import { ViewModel } from '../render/viewmodel';
import {
  ACQUIRE_CONE_DEG,
  adsSensScale,
  aimAssistDelta,
  AIM_PARTS,
  DRONE_AIM_PARTS,
  TANK_AIM_PARTS,
  TURRET_AIM_PARTS,
  bulletBendFraction,
  BULLET_MAG_CONE_DEG,
  BULLET_MAG_MAX_DEG,
  BULLET_MAG_CONE_SCOPED_DEG,
  BULLET_MAG_MAX_SCOPED_DEG,
  CLASS_AA_MUL,
  distanceFactor,
  MOUSE_AA_SCALE,
  PART_PULL_SCALE,
  rankAimPoints,
  SLOWDOWN_CONE_DEG,
  slowdownFactor,
  snapPulse,
  wrapAngle,
  type AimPart,
} from './aimassist';
import { applyAttachments } from './attachments';
import { resolveOpticId, OPTIC_SPECS } from './optics';
import {
  coneOffset,
  damageAtDistance,
  partFromHitHeight,
  partMultiplier,
  penetrationFactor,
  type HitPart,
} from './ballistics';
import { breathStep, BREATH_MAX_S, lissajousSway, swayAmp, SWAY_AMP_DEG } from './scope';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import {
  Bot,
  BOT_NAMES,
  HIP_OFFSET_Y,
  KIND_TUNING,
  tuningFor,
  type BotKind,
  type BotTier,
  type BotTuning,
  type Difficulty,
} from './bot';
import type { EnemyWaveDef, MissionDef } from './campaign';
import { deriveSurfaceMaterials } from './materials';
import { closestApproach } from './whizz';
import { Atmosphere, resolveMood, resolveGrade } from '../render/atmosphere';
import { createGradePass } from '../render/grade';
import { PostFXPass } from '../render/postfx';
import type { MissionSummary } from './progression';
import {
  MedalTracker,
  medalRank,
  type KillCtx,
  type MedalEvent,
  type MedalTier,
} from './medals';
import {
  explosionDamage,
  flashIntensity,
  GRENADE_KINDS,
  GRENADE_SPECS,
  GrenadeProjectile,
  type GrenadeKind,
  type SurfaceRaycast,
  trajectoryPoints,
} from './grenades';
import {
  DominationState,
  ENEMY_TEAM,
  MODE_DEFS,
  PLAYER_TEAM,
  ScoreBoard,
  type GameMode,
  type ModeDef,
  type TeamId,
  type ZoneSnapshot,
} from './modes';
import { CAPSULE_RADIUS, Player } from './player';
import {
  ZOMBIE_MAX_ALIVE,
  zombieEliteRate,
  zombieHp,
  zombieRunRate,
  zombieSpawnGap,
  zombieTotal,
} from './zombie';
import type { MatchSummary } from './progression';
import { generateStage, type StageDef } from './stage';
import { teamPalette, type TeamPalette } from './teamcolors';
import { Weapon, WEAPON_DEFS, SECONDARY_IDS, type WeaponClass } from './weapons';

// Sky.js のシェーダ uniform。noUncheckedIndexedAccess を避けるための型付きビュー
interface SkyUniforms {
  turbidity: { value: number };
  rayleigh: { value: number };
  mieCoefficient: { value: number };
  mieDirectionalG: { value: number };
  sunPosition: { value: THREE.Vector3 };
}

const DEG = Math.PI / 180;
const LOOK_BASE = 0.0022;
// ゲームパッドのヒップファイア時アシストゲート(マウスはADS時のみ、パッドは常時BO3準拠)
const HIP_GATE = 0.4;
// -1..1へクランプ(移動入力のORブレンド用)
const clampUnit = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < -1 ? -1 : v > 1 ? 1 : v;
const PITCH_LIMIT = (89 * Math.PI) / 180;
const LEAN_ROLL = 0.2;
// ウォールラン時の視点ロール量(壁側へ傾ける)
const WALLRUN_VIEW_ROLL = 0.16;
// 高速移動でFOVを最大このぶん広げる(度)
const FOV_SPEED_KICK = 12;
// トラウマ式カメラシェイク。trauma^2 に比例して各軸を揺らす
const SHAKE_DECAY = 1.6;
const SHAKE_PITCH = 0.05;
const SHAKE_YAW = 0.05;
const SHAKE_ROLL = 0.07;
// アルティメット(オーバードライブ + グラビティスラム)。メーターは死亡しても消えない
const ULT_PASSIVE_PER_S = 1 / 110; // 何もしなくても約110秒で満タン
const ULT_ON_KILL = 0.12;
const ULT_ON_CAPTURE = 0.12;
const ULT_ON_DAMAGE_PER_HP = 0.0015; // 被弾で溜まる逆転要素
const OVERDRIVE_DURATION = 6;
const OVERDRIVE_SPEED_MUL = 1.35;
const OVERDRIVE_RESIST = 0.5;
const SLAM_RADIUS = 8;
const SLAM_DAMAGE = 220;
const PLAYER_FEET_OFFSET = 0.95; // カプセル中心から足元まで(CAPSULE_HALF+CAPSULE_RADIUS)
// 本体中心がこのYを下回ったら「床を抜けた」とみなし救済する。床下面は-2(厚化後)、
// 正規地形は Y>=0 のみ。-8 は足元≈-9mで誤検出余地ゼロ(無限落下の構造的封じ込め)
const VOID_Y = -8;
const MELEE_RANGE = 2.2;
const MELEE_DAMAGE = 75;
const MELEE_COOLDOWN = 0.8;
// ── クナイ(ニンジャ・ダガー)専用パラメータ(素手=id 'fists' 装備時のみ) ──
const DAGGER_MELEE_RANGE = 3.2; // 薙ぎ払いのリーチ(拳の 2.6 より広い)
const DAGGER_MELEE_CONE = 0.34; // 前方コーンの内積しきい値(約±70°=広い薙ぎ払い)
const BLINK_RANGE = 7; // ブリンク斬撃の瞬間移動距離(m)。壁の手前で停止
const BLINK_DAMAGE = 130; // ブリンク斬撃で経路上の敵を切り裂くダメージ
const BLINK_RADIUS = 1.8; // ブリンク経路(線分)の判定太さ(m)
const BLINK_COOLDOWN = 1.2; // ブリンク斬撃の再発動クールダウン(s)
const NINJA_ULT_RADIUS = 12; // 素手ウルトの衝撃波半径(接地でも即発動)
const NINJA_ULT_DAMAGE = 260; // 素手ウルト衝撃波の中心ダメージ
const BOT_VIEW_DISTANCE = 60;
const BOT_VIEW_CONE_COS = Math.cos((75 * Math.PI) / 180);
// 警戒中の拡張視野(半角95度)。全周検知は廃止し、警戒は「音源へ振り向く」調査行動で表現
const BOT_ALERT_CONE_COS = Math.cos((95 * Math.PI) / 180);
// スプリント/スライドの足音が聞こえる距離。しゃがみ/歩きは無音=背後忍び寄りが可能
const FOOTSTEP_HEAR_DIST = 8;
const BOT_FALLOFF = { start: 14, end: 40, minFactor: 0.6 };
const PLAYER_NAME = 'あなた';
const ZONE_RADIUS = 3.5;
const SPECTATE_RADIUS = 5.5;
const SPECTATE_HEIGHT = 3;
const KILLCAM_S = 2.4;
const CAM_UP = new THREE.Vector3(0, 1, 0); // lookAt行列のワールド上方向
const ALERT_RADIUS = 35;
const ALERT_RADIUS_SUPPRESSED = 9;
// クッキング限界の直前で強制投擲し、手元爆発はさせない
const COOK_SAFETY_S = 0.25;
const FIRE_TICK_S = 0.5;

// ── R16 spot-time 知覚FSM(matchが積分する。calcSpotRateはraycast無しで毎フレーム)──
const BOT_CENTRAL_COS = Math.cos((22 * Math.PI) / 180); // 中心視野(この内側でconeFactor=1)
const SPOTTED_TH = 0.9; // 発見メータがこの値でSPOTTED(=combat)
const LOST_TH = 0.15; // この値まで下がるとLOST(=patrol)
const SPOT_DECAY = 0.55; // 非可視時の発見メータ減衰(/s)
const ENGAGE_GRACE_S = 0.6; // 見失い直後に lkp へ撃ち/寄り続ける猶予
const PAIN_SECTOR_COS = Math.cos((120 * Math.PI) / 180); // humanoid被弾時の±120°扇形(=-0.5)
const PLAYER_UID = -2; // 発見候補のプレイヤー識別(-1はBot既定の「対象なし」と衝突させない)
const ALERT_SPOT_MUL = 3.5; // 銃声を聞いた(alert)時の発見加速。既存モードの初弾遅延を+0.3s以内に保つ
const PAIN_SPOT_MUL = 5; // 撃たれた(pain)時は基準×この係数で即発見に近づける

// ── R16 ゾンビモード ──
const ZOMBIE_MOVE_MUL = 0.72; // 基準速度に対するシャンブル倍率(走行個体は updateZombie で×1.6)
const ZOMBIE_MELEE_GLOBAL_GAP = 0.35; // 何体いても近接ダメージはこの間隔以上(同フレーム多段一撃回避)
const ZOMBIE_IFRAME = 0.5; // 近接被弾後のプレイヤー無敵時間
const ZOMBIE_ROUND_COOLDOWN = 4.5; // ラウンドクリア後、次ラウンドまでの小休止
const ZOMBIE_SPAWN_RING_MIN = 18; // 湧きリング内径(プレイヤーからの距離)
const ZOMBIE_SPAWN_RING_MAX = 32; // 湧きリング外径

// キルカメラの「KILLED BY」カードに出す、倒した相手の武器/機種ラベル
function killcamWeaponFor(killer: Bot): string {
  switch (killer.kind) {
    case 'humanoid': {
      const p = killer.tier === 'boss' ? '首魁・' : killer.tier === 'elite' ? '精鋭・' : '';
      return `${p}突撃銃`;
    }
    case 'drone':
      return 'ドローン機銃';
    case 'tank':
      return '戦車砲';
    case 'turret':
      return '固定砲台';
    case 'zombie':
      return 'ゾンビの爪';
    default: {
      const _exhaustive: never = killer.kind;
      return _exhaustive;
    }
  }
}

// R12軽量化: bloomを半解像で処理する。EffectComposer.addPass/setSize がフル実効サイズで
// pass.setSize を強制するため、サブクラスで毎回半分へ丸めて bright/blur を面積1/16(現状1/4)へ。
// 合成加算はフル解像 readBuffer を読むので出力はフル解像=見た目維持で bloom実質-40〜50%。
class HalfBloom extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.ceil(width * 0.5), Math.ceil(height * 0.5));
  }
}

export interface MatchConfig {
  stage: StageDef;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
  durationS: number;
  // ── R6 ストーリー/拡張(すべて任意。未指定なら従来の対戦として動く) ──
  mission?: MissionDef; // 注入するとストーリーモードとして目的/波/勝敗で進行する
  perks?: string[]; // パーク(将来拡張)
  wildcard?: 'gunfighter' | 'tactician' | null; // ワイルドカード
  secondaryId?: string; // 副武器の上書き
  scoreAttack?: boolean; // スコアアタック(自己ベスト記録)
}

export interface FeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
}

export interface DamageNumber {
  amount: number;
  world: THREE.Vector3;
  kind: 'body' | 'head' | 'kill' | 'limb'; // 色・大きさの段階分け
}

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
  // チーム戦でプレイヤー側ならtrue。FFAではプレイヤー本人のみtrue
  isAlly: boolean;
}

export interface ZoneView {
  id: string;
  owner: 'mine' | 'enemy' | null;
  progress: number;
  capturing: 'mine' | 'enemy' | null;
  contested: boolean;
}

export interface MatchResult {
  rows: ScoreRow[];
  won: boolean;
  accuracy: number;
  headshots: number;
  modeName: string;
  teamScores: { mine: number; enemy: number } | null;
  // 進行度(XP・チャレンジ)への入力
  summary: MatchSummary;
}

export interface MatchSnapshot {
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnIn: number;
  ammo: number;
  reserve: number;
  magSize: number; // 弾倉容量(HUDの弾ピップ正規化 ammo/magSize 用)
  weaponName: string;
  weaponSlot: string; // 'PRIMARY' / 'SECONDARY'
  fireMode: string;
  reloading: boolean;
  reloadRatio: number;
  spreadRad: number;
  adsProgress: number;
  kills: number;
  deaths: number;
  streak: number;
  timeLeft: number;
  yaw: number;
  fov: number;
  over: boolean;
  // 移動状態(HUDの速度計・状態チップ用)
  speed: number;
  sliding: boolean;
  wallRunning: boolean;
  airborne: boolean;
  reduceMotion: boolean;
  radarEnabled: boolean; // 簡易レーダーの表示設定
  ultCharge: number; // 0..1
  ultActive: boolean; // オーバードライブ発動中
  // スナイパースコープ/エイムアシスト関連
  scopedWeapon: boolean; // 現在の武器がスコープ持ちか(オーバーレイ表示の起点)
  opticId: string; // 現在の光学ID(optics.ts OPTIC_SPECS)。HUDレティクル/オーバーレイ駆動
  adsOpticActive: boolean; // 倍率光学をADS中(magnified && adsProgress>0.5)。def.scopeとは独立系統
  sightStyle: string; // = OpticSpec.reticleKind。HUDの data-reticle 駆動(全画面レティクルの種類)
  scope: { sway: { x: number; y: number }; steady: boolean; breath01: number }; // swayは度
  aimAssistEngaged: boolean; // 視認できる敵が吸着円錐内にいる
  rangeM: number; // スコープのレンジ表示(対象までの距離m、無ければ0)
  zoomX: number; // スコープ倍率(fov/adsFov)
  reticleStyle: string; // 設定のレティクル形状(腰だめクロスヘア用)
  reticleColor: string; // 設定のレティクル色
  weaponId: string; // 現在の武器ID
  grenadeName: string;
  grenadeCount: number;
  cookRatio: number; // 0=非クッキング、1=強制投擲直前
  whiteout: number; // フラッシュの白飛び 0..1
  modeName: string;
  teamBased: boolean;
  scoreMine: number;
  scoreEnemy: number; // FFAでは首位の敵スコア
  scoreTarget: number;
  zones: ZoneView[]; // ドミネーション以外は空
  announcements: string[];
  spectating: boolean;
  killcam: string | null; // キルカメラ中に映している相手の名前
  // ── R11 シネマティック・キルカメラ / ジュース(HUDは読むのみ) ──
  killcamRatio: number; // 0..1 = killcamTimer/KILLCAM_S(キルカメラ非該当時0)
  killcamWeapon: string | null; // キルした相手の武器/機種ラベル(非該当null)
  killcamDistM: number; // killer→player 水平距離(m, round)
  killcamFlash: number; // 0..1 キルカメラ突入の白フラッシュ(dt*5.5減衰)
  deathVeil: number; // 0..1 遷移黒幕(死亡/リスポーンの無条件減衰)
  killcamFinal: boolean; // 終盤(killcamTimer<0.7 && killer生存)の赤ビネット
  killcamCamActive: boolean; // カメラがシネマ姿勢を所有中(HUDシネマ枠の単一の真実)
  lowHp01: number; // 0..1 低HP(juiceのDOMフォールバック用)
  postfxActive: boolean; // medium/high=true(PostFXシェーダ所有), low=false
  feed: FeedEntry[];
  hits: Array<'hit' | 'head' | 'kill' | 'snipe' | 'limb'>;
  hitExpandRad: number; // ヒットマーカーの一時拡大量(連続ヒットで広がる)
  damageNumbers: DamageNumber[];
  // ── R6 ストーリー(非ストーリーでは undefined) ──
  missionId?: string;
  objectiveText?: string; // 現在の目的の文言
  objectiveProgress01?: number; // 目的の進捗 0..1
  waveIndex?: number; // 現在の波(1始まり)
  waveTotal?: number; // 総波数
  bossHp01?: number; // ボスの残りHP割合(0..1)。ボス不在なら undefined
  // ── R16 ゾンビ(mode!=='zombie'では undefined。HUD/menuはこれで round HUD を分岐)──
  zombieRound?: number; // 現在のラウンド(1始まり。0=開始前)
  zombieKills?: number; // 累計撃破数
  zombiePoints?: number; // 累計ポイント(命中10/キル60/HSキル100)
  playerDowns?: number; // プレイヤーがダウンした回数(ゲームオーバー確定)
  incoming: number[]; // 被弾方向(カメラ基準の角度rad)
  tookDamage: boolean;
  scoreboard: ScoreRow[];
  scoreEvents: Array<{ label: string; xp: number }>; // スコア獲得トースト(キル/HS/制圧)
  enemyBearings: Array<{ angle: number; dist: number }>; // レーダー用: 自機yaw基準の相対角と水平距離
  medals: MedalEvent[]; // この描画フレームで取得したメダル(初回=バッジ/以降=大文字)
}

interface RayHitLike {
  collider: RAPIER.Collider;
  toi?: number;
  timeOfImpact?: number;
}

interface RayNormalHitLike extends RayHitLike {
  normal?: { x: number; y: number; z: number };
}

function hitToi(hit: RayHitLike): number {
  return hit.toi ?? hit.timeOfImpact ?? 0;
}

type ColliderTag =
  | { kind: 'world' }
  | { kind: 'player' }
  | { kind: 'bot'; bot: Bot; part: HitPart };

interface SmokeZone {
  pos: THREE.Vector3;
  radius: number;
  until: number;
}

// spot-time知覚の発見候補(距離+コーンを通過した最も近い敵対エンティティ)
interface SpotCand {
  eye: THREE.Vector3; // 目/頭の位置(発見完了で targetEye として供給)
  dist: number;
  coneDot: number; // bot facing との内積(視野中心度)
  isPlayer: boolean;
  uid: number; // プレイヤーは PLAYER_UID(-2)
}

interface FirePatch {
  pos: THREE.Vector3;
  radius: number;
  until: number;
  tickIn: number;
  crackleIn: number;
}

interface ThrownGrenade {
  projectile: GrenadeProjectile;
  mesh: THREE.Mesh;
}

export class Match {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  over = false;
  timeLeft: number;

  private readonly physics: RAPIER.World;
  private readonly tags = new Map<number, ColliderTag>();
  private readonly player: Player;
  private readonly bots: Bot[] = [];
  private readonly weapons: [Weapon, Weapon];
  private activeIndex = 0;
  private readonly effects: Effects;
  private readonly viewModel: ViewModel;
  private readonly rand: Rand;
  private readonly playerSpawns: THREE.Vector3[];
  private readonly botSpawns: THREE.Vector3[];
  private meleeCooldown = 0;
  private adsLatch = false;
  private lastLookDX = 0;
  private lastLookDY = 0;
  private elapsed = 0;

  private readonly modeDef: ModeDef;
  private readonly scores: ScoreBoard;
  private readonly domination: DominationState | null;
  private readonly zoneCenters = new Map<string, THREE.Vector3>();
  private readonly zoneRings = new Map<string, THREE.Mesh>();
  private announcements: string[] = [];
  private deathPos: THREE.Vector3 | null = null;
  private orbitAngle = 0;
  private killer: Bot | null = null;
  private killcamTimer = 0;
  // ── R11 シネマティック・キルカメラ / ジュース の内部状態 ──
  private killcamWeaponLabel: string | null = null; // killした相手の武器/機種ラベル
  private killcamDistM = 0; // killer→player 水平距離(m)
  private killcamFlash = 0; // 突入白フラッシュ 0..1
  private deathVeil = 0; // 遷移黒幕 0..1(無条件減衰)
  private postfxActive = false; // PostFX(medium/high)有効
  private atmosphere: Atmosphere | null = null; // 映画的アトモスフィア(草/フォグ/粒子/遠景)
  private postfx: PostFXPass | null = null; // ジュース専用PostFX(被弾パルス・enable-gate)
  private baseDpr = 0; // 動的DPRの基準(初回setで確定=main.tsが設定した実効pixelRatio)
  private resScale = 1; // 現在の解像度スケール 0.6..1
  private hitFlashEnv = 0; // 被弾フラッシュのエンベロープ 0..1
  // キルカメラ補間: 死亡時に固定するアンカー + 現在の補間カメラ姿勢(exp damping)
  private readonly killcamAnchorHead = new THREE.Vector3(); // 死亡時のkiller頭位置(固定)
  private readonly killcamAnchorPos = new THREE.Vector3(); // 死亡時のkiller胴位置(固定)
  private killcamElapsedS = 0; // キルカメラ開始からの経過秒
  private killcamArc = 0; // 弧の累積方位(角度を積分=arcSpeed低下で真に減速・段差なし)
  private killcamCamActive = false; // このフレームでキルカメラがカメラを所有しているか
  private prevKillcamCamActive = false; // 前フレームのカメラ所有(bail検出用)
  private killcamSeeded = false; // 現在姿勢を一人称からシードしたか
  private readonly killcamCurPos = new THREE.Vector3();
  private readonly killcamCurQuat = new THREE.Quaternion();
  private killcamFov = 60;
  // scratch(GC回避)
  private readonly _kcTarget = new THREE.Vector3();
  private readonly _kcLook = new THREE.Vector3();
  private readonly _kcM4 = new THREE.Matrix4();
  private readonly _kcQuat = new THREE.Quaternion();
  private crouchLatch = false;
  private readonly colors: TeamPalette;
  private bestStreak = 0;
  private playerCaptures = 0;
  private readonly playerWeaponKills: Record<string, number> = {};

  // ── 素手(武器なし)の格闘状態 ──
  private punchStep = 0; // ラッシュコンボの段(0..3)
  private punchWindowS = 0; // コンボ継続の残り秒。切れたら1段目へ戻る
  private slamPending = false; // ダイブスラム降下中(着地で衝撃波)
  private slamStartY = 0; // 降下開始高さ(ダメージスケール用)
  private slamCooldownS = 0; // ダイブスラムの再発動クールダウン(連打支配の防止)
  private blinkCooldownS = 0; // ADSブリンク斬撃の再発動クールダウン

  private grenadeKind: GrenadeKind;
  private readonly grenadeCounts: Record<GrenadeKind, number>;
  private cooking = false;
  private cookTimer = 0;
  private thrown: ThrownGrenade[] = [];
  private smokeZones: SmokeZone[] = [];
  private firePatches: FirePatch[] = [];
  private whiteout = 0;
  private readonly grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);

  private feed: FeedEntry[] = [];
  private hits: Array<'hit' | 'head' | 'kill' | 'snipe' | 'limb'> = [];
  private hitExpand = 0; // ヒットマーカー拡大の減衰値
  private damageNumbers: DamageNumber[] = [];

  // ── R6 ストーリーモード状態(mission が無ければ未使用) ──
  private readonly mission: MissionDef | null;
  private missionOutcome: 'pending' | 'won' | 'lost' = 'pending';
  private missionTimeS = 0; // ミッション経過秒(クリアタイム算定用)
  private readonly modifierSet: ReadonlySet<string>;
  private pendingWaves: EnemyWaveDef[] = [];
  private waveIndex = 0; // 出現済みの波数
  private missionKills = 0; // 敵撃破数(eliminate-count用)
  private waveSpawnCursor = 0; // 波スポーン地点の巡回カーソル
  private readonly exfilPos = new THREE.Vector3(); // extract目的の脱出地点
  private exfilTimer = 0; // 脱出地点滞在秒
  private incoming: number[] = [];
  private tookDamage = false;
  private shakeTrauma = 0; // 0..1 カメラシェイクの蓄積
  private ultCharge = 0; // 0..1 アルティメットの充填量(死亡で消えない)
  private ultActive = 0; // オーバードライブの残り秒数
  private ultReadyNotified = false; // 準備完了音を鳴らし終えたか(立ち上がり検出用)
  // エイムアシスト/スコープの状態
  private readonly _aimScratch = new THREE.Vector3(); // 可視判定の候補点に使い回す(GC節約)
  private aimAssistEngaged = false;
  private aimAssistTargetDir: THREE.Vector3 | null = null; // 弾道補正用の対象方向(無ければnull)
  private aimAssistTargetAngle = 0; // 照準と対象のなす角(rad)
  private aimAssistTargetDist = 0; // 対象までの距離(m)
  private scopeSway = { x: 0, y: 0 }; // レティクル視差用の揺れ(度、100%)
  private breathMeter = BREATH_MAX_S; // 息止めの残量(秒)
  private breathSteady = false; // 息止めが効いている
  private prevScopeProgress = 0; // scope-in立ち上がり検出用
  private heartbeatTimer = 0; // 瀕死の心音の次の拍までの残り秒数
  private scopeRangeM = 0; // スコープのレンジファインダー(照準中心までの距離m)
  private adsEntryElapsed = 0; // ADS開始からの経過秒(クイックスコープ無揺れ窓の判定)
  private snapPulseDone = false; // 覗き込み時のスナップ補正を撃ったか(1回限り制御)
  private hitFreezeS = 0; // ヒットストップの残り秒(ビューモデル/FXのみ凍結)
  private scoreEvents: Array<{ label: string; xp: number }> = []; // スコア獲得トースト(消費型)
  private readonly tracker: MedalTracker; // メダル検出(純ロジック)
  private medals: MedalEvent[] = []; // メダル取得イベント(消費型)
  private medalXpTotal = 0; // 試合中のメダルXP累計(リザルトで1回だけ計上)
  private lastAdsStartMs = 0; // ADS開始時刻(クイックスコープ判定)
  private lastAlive = true; // プレイヤー生存の前フレーム値(死亡の立ち下がり検出)
  // ── リアル化(描画) ──
  private composer: EffectComposer | null = null; // medium/high のみ(low は素のレンダラ)
  private envRT: THREE.WebGLRenderTarget | null = null; // 空から焼いたIBL(per-Matchで解放)
  private readonly sunDir = new THREE.Vector3(); // 太陽方向の単一の真実(空/日光/影を駆動)

  // ── R16 spot-time知覚: setup時にpaletteから保持(Matchはpalette非保持=fog/ambientが必要)──
  private stageFogDensity = 0;
  private stageAmbient = 1;
  private botFrameIdx = 0; // uid%3 のLOSバケット(観測者を間引いてO(N^2)castRayを~1/3に)
  // ── R16 ゾンビディレクタ(mode==='zombie'のみ稼働。matchが唯一の状態保持者)──
  private zombieRound = 0;
  private zombieKills = 0;
  private zombiePoints = 0;
  private zombieQueue = 0; // このラウンドの残り湧き数
  private zombieSpawnTimer = 0; // 次のドリップ湧きまでの残り秒
  private zombieRoundCooldown = 0; // ラウンド間の小休止
  private zombieTierCap = ZOMBIE_MAX_ALIVE.medium; // 同時生存上限(tier連動)
  private zombieMeleeGlobal = 0; // 近接ダメージのグローバル次回許可時刻(elapsed基準)
  private zombieMeleeIframe = 0; // プレイヤーi-frameの終了時刻(elapsed基準)
  private zombieShadowTimer = 0; // 近接影LODの周期トグル
  private zombieSpawnColor = 0x4c5a30; // ゾンビ本体の腐敗色(setupで確定)
  private playerDowns = 0;

  constructor(
    readonly config: MatchConfig,
    private readonly settings: Settings,
    private readonly input: Input,
    private readonly sounds: SoundKit,
    aspect: number,
    private readonly renderer: THREE.WebGLRenderer,
    knownMedals: Set<string>,
  ) {
    this.tracker = new MedalTracker(knownMedals);
    this.timeLeft = config.durationS;
    this.mission = config.mission ?? null;
    this.modifierSet = new Set(config.mission?.modifiers ?? []);
    this.colors = teamPalette(settings.teamPaletteId);
    this.rand = mulberry32(Date.now() % 0xffffffff);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    const layout = generateStage(config.stage);
    this.playerSpawns = layout.playerSpawns.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.botSpawns = layout.botSpawns.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.buildStageScene(layout.boxes);

    const spawn = this.playerSpawns[0] ?? new THREE.Vector3();
    // モディファイアをプレイヤーの個体設定へ反映(低重力/HP自然回復なし)
    const playerOpts: { regenPerS?: number; gravityScale?: number; maxHp?: number } = {};
    if (this.modifierSet.has('no-regen')) playerOpts.regenPerS = 0;
    if (this.modifierSet.has('low-gravity')) playerOpts.gravityScale = 0.55;
    // クナイ(ニンジャ)装備は接近戦で撃たれ弱い分、体力を 300 へ引き上げてインファイトを成立させる。
    // HUD/スナップショットの maxHp は player.maxHp を参照するため自動追従する。
    if (config.primaryId === 'fists') playerOpts.maxHp = 300;
    this.player = new Player(this.physics, spawn, playerOpts);
    this.tags.set(this.player.collider.handle, { kind: 'player' });

    const primaryBase = WEAPON_DEFS[config.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    const primaryDef = applyAttachments(primaryBase, config.attachments);
    // 副武器: 指定があり SECONDARY_IDS に含まれていればそれを、無ければ拳銃スズメ
    const secDef =
      (config.secondaryId && SECONDARY_IDS.includes(config.secondaryId)
        ? WEAPON_DEFS[config.secondaryId]
        : undefined) ?? WEAPON_DEFS['suzume']!;
    this.weapons = [new Weapon(primaryDef), new Weapon(secDef)];

    this.grenadeKind = config.grenade;
    this.grenadeCounts = {
      frag: GRENADE_SPECS.frag.carry,
      smoke: GRENADE_SPECS.smoke.carry,
      flash: GRENADE_SPECS.flash.carry,
      incendiary: GRENADE_SPECS.incendiary.carry,
    };

    this.modeDef = MODE_DEFS[config.mode];
    this.scores = new ScoreBoard(this.modeDef.scoreTarget);

    if (this.mission) {
      this.setupMission(this.mission);
    } else if (config.mode === 'zombie') {
      // ゾンビ: 通常のBOTは湧かせず、ディレクタが初回updateでラウンド1を開始する
      this.setupZombie();
    } else {
      // 通常対戦: チーム戦は人数の少ない側にプレイヤーが入る
      const botCount = config.stage.botCount;
      const allyCount = this.modeDef.teamBased ? Math.floor((botCount - 1) / 2) : 0;
      for (let i = 0; i < botCount; i += 1) {
        const name = BOT_NAMES[i % BOT_NAMES.length] ?? `BOT-${i}`;
        const team = this.modeDef.teamBased ? (i < allyCount ? PLAYER_TEAM : ENEMY_TEAM) : i + 1;
        const isAlly = team === PLAYER_TEAM;
        const spawnList = isAlly ? this.playerSpawns : this.botSpawns;
        const botSpawn = spawnList[(i + (isAlly ? 1 : 0)) % spawnList.length] ?? new THREE.Vector3();
        this.spawnBot(
          name,
          botSpawn,
          isAlly ? this.colors.ally : this.colors.enemy,
          team,
          tuningFor('normal', config.difficulty),
          'normal',
        );
      }
    }

    this.domination = config.mode === 'dom' ? new DominationState(['A', 'B', 'C']) : null;
    if (this.domination) this.buildZones();

    this.effects = new Effects(this.scene);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.setWeapon(this.activeWeapon.def);
    this.activeWeapon.raise();

    this.buildComposer(resolveGraphicsTier(settings.graphicsQuality, renderer.capabilities.isWebGL2));
    // シェーダ事前コンパイル(初フレーム/初撃破のスタッター防止)。ディゾルブ変種(dissolve1)は
    // defineを一時点火してcompile→消灯の順で両プログラムをキャッシュへ載せる
    for (const bot of this.bots) bot.prewarmDissolve(true);
    this.renderer.compile(this.scene, this.camera);
    for (const bot of this.bots) bot.prewarmDissolve(false);
  }

  // ポストプロセス: medium/high のみ Render→Bloom→SMAA→Output の最小4パス。
  // low(WebGL1含む)は composer を作らず render() が素のレンダラへフォールバックする。
  private buildComposer(tier: GraphicsQuality): void {
    if (tier === 'low') {
      this.postfxActive = false; // low: シェーダPostFX無し(CSSフォールバックのみ)
      return;
    }
    this.postfxActive = true;
    const p = this.config.stage.palette;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new HalfBloom(
      new THREE.Vector2(size.x, size.y),
      p.bloomStrength ?? 0.5, // strength: 真の発光体だけ拾う控えめな値
      0.4, // radius
      // threshold: 0.85 では昼の明部(明るい床/壁/箱の天面)まで滲んで白いグレアになり
      // 「眩しくて見にくい」主因になっていた。0.9 へ上げて真に高輝度なものだけ滲ませる。
      // ネオン/信号灯など発光演出は各パレットが明示 threshold(yoichi0.7/haieki0.8/neon0.85)を持つ。
      p.bloomThreshold ?? 0.9, // threshold
    );
    composer.addPass(bloom);
    // アトモスフィアの映画的カラーグレード(ムード別・HDR空間=bloom後/SMAA前)
    composer.addPass(
      createGradePass(resolveGrade(resolveMood(p), p), {
        reduceMotion: this.settings.reduceMotion,
        width: size.x,
        height: size.y,
      }),
    );
    composer.addPass(new SMAAPass(size.x, size.y));
    composer.addPass(new OutputPass()); // Neutral+exposure+sRGB を renderer から自動適用
    // ジュース専用PostFX(被弾パルスの赤tint+収差)。表示空間(Neutral後)・被弾時のみenable
    const postfx = new PostFXPass();
    postfx.setParams({
      vigInner: 0.95, // 静的グレードはgradePassが持つ=ここは実質パススルー
      vigOuter: 1.0,
      grain: 0,
      aberration: 0,
      desat: 0,
      hitPulse: 0,
      hitTint: [1, 0.32, 0.28],
      enabled: false, // hitPulse>0 のフレームだけ有効化(idleコストゼロ)
    });
    composer.addPass(postfx);
    this.postfx = postfx;
    this.composer = composer;
  }

  // R12軽量化(適応): スパイク時に実解像度を段階的に下げてfps床を維持する。
  // main.ts のフレーム時間EMAが呼ぶ。base=main.tsが設定した実効pixelRatio、s∈[0.6,1]。
  // renderer/composer の setPixelRatio がCSSサイズから内部RTを再確保する(自前setSize禁止)
  setResolutionScale(s: number): void {
    if (this.baseDpr === 0) this.baseDpr = this.renderer.getPixelRatio();
    const clamped = Math.max(0.6, Math.min(1, s));
    if (Math.abs(clamped - this.resScale) < 0.02) return;
    this.resScale = clamped;
    const pr = this.baseDpr * clamped;
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
  }

  get activeWeapon(): Weapon {
    return this.weapons[this.activeIndex] ?? this.weapons[0]!;
  }

  // クナイ(ニンジャ・ダガー)ロードアウトか。HP300・素手ウルト衝撃波の分岐に使う
  // (装備の切替に依らずロードアウト単位で成立させたいので primaryId で判定する)。
  private get isNinja(): boolean {
    return this.config.primaryId === 'fists';
  }

  private buildStageScene(boxes: ReturnType<typeof generateStage>['boxes']): void {
    // R12軽量化: 画質ティアを1回だけ算出して影/フォグ/草へ配線(hoist)
    const tier = resolveGraphicsTier(
      this.settings.graphicsQuality,
      this.renderer.capabilities.isWebGL2,
    );
    const palette = this.config.stage.palette;
    const size = this.config.stage.size;
    // Sky.js を可視背景にするため background は使わない
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(palette.fog, palette.fogDensity);
    // R16: calcSpotRate(霧/暗所ほど発見が遅い)用にpaletteの霧密度・環境光を保持する
    // (Matchはpaletteを持たずthis.colorsのみ格納し、fog/ambientは適用後に破棄するため)
    this.stageFogDensity = palette.fogDensity;
    this.stageAmbient = palette.ambientIntensity;

    // 太陽方向の単一の真実(空・日光・影カメラ・フォグの暖寒を1本のベクトルが駆動)
    const elevation = palette.elevation ?? 35;
    const azimuth = palette.azimuth ?? 170;
    this.sunDir.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - elevation),
      THREE.MathUtils.degToRad(azimuth),
    );

    // IBL(scene.environment)と二重になるため Hemi は控えめに。
    // 「天井(空)から差す環境光」が上面/明部を洗い流して眩しくする主因の一つなので
    // 係数を 0.55→0.5 に下げて上方フィルを間引く(直射=sun/影は不変。むしろ日陰が締まる)。
    const hemi = new THREE.HemisphereLight(
      palette.sky,
      palette.floor,
      palette.ambientIntensity * 0.5,
    );
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(palette.lightColor, palette.lightIntensity);
    sun.position.copy(this.sunDir).multiplyScalar(size); // 見える太陽と影方向を一致させる
    sun.castShadow = true;
    // R12軽量化: mediumは1024²で影フラグメント1/4・VRAM 12MB→3MB(highは2048²維持)
    sun.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
    sun.shadow.bias = -0.0005; // シャドウアクネ除去
    sun.shadow.normalBias = 0.02; // ピーターパン(浮き影)防止
    sun.shadow.radius = 2; // PCFカーネル拡大(ほぼ0コストで柔らかく)
    const half = size / 2 + 4;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.far = size * 1.5;
    this.scene.add(sun);

    // 逆光フィル(影を落とさない=追加コストほぼ0。シルエットの締まりを出す)
    const fill = new THREE.DirectionalLight(
      new THREE.Color(palette.floor),
      palette.lightIntensity * 0.12,
    );
    fill.position
      .copy(this.sunDir)
      .multiplyScalar(-size)
      .setY(size * 0.3);
    this.scene.add(fill);

    const floorBody = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // 当たり判定の上面は Y=0 のまま、下面を -2 へ倍化して高速落下のトンネリングを物理的に封じる
    const floorCollider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2 + 1, 1.0, size / 2 + 1).setTranslation(0, -1, 0),
      floorBody,
    );
    this.tags.set(floorCollider.handle, { kind: 'world' });
    const floorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size + 2, 1, size + 2),
      new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.95 }),
    );
    floorMesh.position.y = -0.5;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    // 体積AO(Tier0): 天面を明るく底面を暗くする乗算頂点カラーを一度だけ焼く。
    // 共有unitBoxに焼くので全障害物が無コストで「平面の豆腐」を脱する
    this.bakeVolumetricAO(unitBox);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    for (const spec of boxes) {
      const key = `${spec.color}:${spec.emissive}`;
      let material = materials.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.72, // IBL投入で空の照り返しを拾えるよう少し滑らかに
          metalness: 0.0,
          vertexColors: true,
        });
        if (spec.emissive) {
          material.emissive = new THREE.Color(spec.color);
          // 0.7 は工廠/廃駅など発光ステージで箱が白飛び・過剰グレアの主因だった。
          // 0.45 まで下げると暗い夜/ネオンでは依然「暗闇で自発光するアクセント」として
          // はっきり読め、明るい発光ステージでの眩しさだけが消える(bloomは自発光を拾わない)。
          material.emissiveIntensity = 0.45;
          material.envMapIntensity = 0.35; // 自発光体はIBLに打ち消されないよう抑制
        }
        materials.set(key, material);
      }
      const mesh = new THREE.Mesh(unitBox, material);
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.scale.set(spec.w, spec.h, spec.d);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(spec.x, spec.y, spec.z),
      );
      const collider = this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.w / 2, spec.h / 2, spec.d / 2),
        body,
      );
      this.tags.set(collider.handle, { kind: 'world' });
    }

    // 障害物のビジュアル装飾(当たり判定には一切触れない・純粋に飾り)
    this.buildPropDecor(boxes, palette);
    this.buildAtmosphere(this.config.stage.palette, this.config.stage.size);
    // ステージパレットから床/遮蔽物の材質を推定し、足音・着弾音のテクスチャを決める
    this.sounds.setSurfaceMaterial(deriveSurfaceMaterials(this.config.stage.palette));
    // 映画的アトモスフィア(ムード照明/奥行きフォグ/草/環境パーティクル/遠景シルエット)。
    // physics/tags非受領=当たり判定ゼロ・装飾のみ。tier(hoist済)で低スペックは自動ゲート
    this.atmosphere = new Atmosphere(
      this.scene,
      this.renderer,
      palette,
      resolveMood(palette),
      tier,
      this.settings.reduceMotion,
      size,
      boxes,
      this.sunDir,
      mulberry32(this.config.stage.seed ^ 0x0a7),
    );
  }

  // 共有unitBoxへ体積AOの頂点カラーを焼く。天面=明・側面=高さで階調・底面=暗。
  // 乗算なので元の色とフォグに自動で馴染む。形状・当たり判定は不変。
  private bakeVolumetricAO(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const y = pos.getY(i); // -0.5..0.5
      const ny = nor ? nor.getY(i) : 0;
      let b: number;
      if (ny > 0.5) b = 1.0; // 天面
      else if (ny < -0.5) b = 0.6; // 底面
      else b = 0.72 + (y + 0.5) * (0.95 - 0.72); // 側面は高さで階調
      colors[i * 3] = b;
      colors[i * 3 + 1] = b;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // 寸法比と座標シードだけから各障害物のプロップ種別を推論する(決定論・RNG不使用)。
  // 原点対称ミラー(-x,-z)が同種別になり競技対称を保つ。
  private classifyArchetype(
    spec: { x: number; z: number; w: number; h: number; d: number; color: string; emissive: boolean },
    palette: StageDef['palette'],
  ): 'wall' | 'container' | 'blastBarrier' | 'ammoCrate' | 'drum' | 'sandbag' {
    const foot = Math.min(spec.w, spec.d);
    const aspect = Math.max(spec.w, spec.d) / Math.max(0.001, foot);
    const area = spec.w * spec.d;
    // 周壁ガード: generateStageが先に積む4枚の周壁(壁色・薄い・高い)を巨大バリア化させない
    if (spec.color === palette.wall && foot <= 1.5) return 'wall';
    if (spec.h >= 1.3) {
      if (foot <= 2.5 && aspect >= 2) return 'blastBarrier';
      return 'container';
    }
    if (aspect >= 2.2) return 'sandbag';
    if (area <= 9) return 'ammoCrate';
    return 'drum';
  }

  // 障害物(BoxSpec)に手続き的な装飾を被せる。当たり判定・mesh.scaleには一切触れず、
  // ビジュアルだけを足す。マテリアル系統ごとにmergeGeometriesで1メッシュに畳み、
  // 障害物数に依存せず draw call を約7本に抑える。アセットレス・決定論。
  private buildPropDecor(
    boxes: ReturnType<typeof generateStage>['boxes'],
    palette: StageDef['palette'],
  ): void {
    const clampN = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
    const derive = (hex: string, dL: number, dS = 0): THREE.Color => {
      const c = new THREE.Color(hex);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, clampN(hsl.s + dS, 0, 1), clampN(hsl.l + dL, 0, 1));
      return c;
    };

    // 系統別パーツ配列(ワールド座標に焼き込んだジオメトリ片)
    const reliefParts: THREE.BufferGeometry[] = [];
    const metalParts: THREE.BufferGeometry[] = [];
    const accentParts: THREE.BufferGeometry[] = [];
    const shadowParts: THREE.BufferGeometry[] = [];
    const edgeParts: THREE.BufferGeometry[] = [];
    const castingMatrices: THREE.Matrix4[] = [];
    const temps: THREE.BufferGeometry[] = [];

    // テンプレ(ループ外で1回)。最後にまとめて破棄する
    const slabTpl = new THREE.BoxGeometry(1, 1, 1);
    const capsuleTpl = new THREE.CapsuleGeometry(0.16, 0.34, 3, 6);
    const planeTpl = new THREE.PlaneGeometry(1, 1);
    const boxForEdges = new THREE.BoxGeometry(1, 1, 1);
    const edgesTpl = new THREE.EdgesGeometry(boxForEdges, 30);

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const vPos = new THREE.Vector3();
    const vScale = new THREE.Vector3();

    const setColor = (g: THREE.BufferGeometry, color: THREE.Color): void => {
      const n = (g.attributes.position as THREE.BufferAttribute).count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        arr[i * 3] = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    };
    // family へ tpl を 位置・スケール・回転で焼いて push(頂点カラー付き)
    const part = (
      family: THREE.BufferGeometry[],
      tpl: THREE.BufferGeometry,
      color: THREE.Color,
      px: number,
      py: number,
      pz: number,
      sx: number,
      sy: number,
      sz: number,
      rx = 0,
      ry = 0,
      rz = 0,
    ): void => {
      eul.set(rx, ry, rz);
      q.setFromEuler(eul);
      vPos.set(px, py, pz);
      vScale.set(sx, sy, sz);
      m4.compose(vPos, q, vScale);
      const g = tpl.clone();
      g.applyMatrix4(m4);
      setColor(g, color);
      family.push(g);
      temps.push(g);
    };

    for (const spec of boxes) {
      const cx = spec.x;
      const cz = spec.z;
      const top = spec.y + spec.h / 2;
      const bottom = spec.y - spec.h / 2;
      const halfW = spec.w / 2;
      const halfD = spec.d / 2;
      const longX = spec.w >= spec.d; // 長手がX方向か
      const longLen = Math.max(spec.w, spec.d);
      const arche = this.classifyArchetype(spec, palette);

      // 輪郭線(AABB稜線にほぼ一致)。線プリミティブにはpolygonOffsetが効かないため、
      // ごく僅か(約1cm)外側へ広げて面とのZファイト/ちらつきを避ける
      {
        eul.set(0, 0, 0);
        q.setFromEuler(eul);
        vPos.set(cx, spec.y, cz);
        vScale.set(spec.w + 0.02, spec.h + 0.02, spec.d + 0.02);
        m4.compose(vPos, q, vScale);
        const g = edgesTpl.clone();
        g.applyMatrix4(m4);
        edgeParts.push(g);
        temps.push(g);
      }

      // 床コンタクトシャドウ(周壁以外)
      if (arche !== 'wall') {
        part(
          shadowParts,
          planeTpl,
          new THREE.Color(0x000000),
          cx,
          0.03,
          cz,
          spec.w + 0.5,
          spec.d + 0.5,
          1,
          -Math.PI / 2,
          0,
          0,
        );
      }

      const rimColor = derive(palette.lightColor, 0);
      const rib = derive(palette.obstacle, 0.1);
      const groove = derive(palette.obstacle, -0.15);
      const hardware = derive(palette.wall, -0.1, -0.2);
      const accentCol = derive(palette.accent, palette.emissiveAccent ? 0 : -0.05);

      if (arche === 'container') {
        // 長手2面に縦の波板リブ
        const ribCount = clampN(Math.floor(longLen / 0.7), 3, 10);
        for (let i = 0; i < ribCount; i += 1) {
          const t = ribCount === 1 ? 0.5 : i / (ribCount - 1);
          const along = (t - 0.5) * longLen * 0.92;
          for (const side of [-1, 1] as const) {
            if (longX) {
              part(reliefParts, slabTpl, rib, cx + along, spec.y, cz + side * (halfD + 0.02), 0.07, spec.h * 0.9, 0.05);
            } else {
              part(reliefParts, slabTpl, rib, cx + side * (halfW + 0.02), spec.y, cz + along, 0.05, spec.h * 0.9, 0.07);
            }
          }
        }
        // 天面リムキャッチライト(金属)
        part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.04, 0.018, spec.d + 0.04);
        // 妻面のドア(片側のみ・暗色)+ ロックバー(金属)。原点対称ミラー(-x,-z)とは
        // 逆面に付くよう符号へ point-symmetry 係数を織り込み、装飾レベルでも対称を保つ
        const doorBase = (Math.abs(Math.round(spec.x * 31 + spec.z * 17)) % 2) * 2 - 1;
        const doorSign = doorBase * (cx + cz >= 0 ? 1 : -1);
        if (longX) {
          part(reliefParts, slabTpl, groove, cx + doorSign * (halfW + 0.012), spec.y, cz, 0.02, spec.h * 0.82, spec.d * 0.82);
          part(metalParts, slabTpl, hardware, cx + doorSign * (halfW + 0.03), spec.y, cz, 0.04, 0.05, spec.d * 0.5);
        } else {
          part(reliefParts, slabTpl, groove, cx, spec.y, cz + doorSign * (halfD + 0.012), spec.w * 0.82, spec.h * 0.82, 0.02);
          part(metalParts, slabTpl, hardware, cx, spec.y, cz + doorSign * (halfD + 0.03), spec.w * 0.5, 0.05, 0.04);
        }
        // ISOコーナーキャスティング(8隅・InstancedMesh行列)
        for (const sx of [-1, 1] as const) {
          for (const sy of [-1, 1] as const) {
            for (const sz of [-1, 1] as const) {
              eul.set(0, 0, 0);
              q.setFromEuler(eul);
              vPos.set(cx + sx * (halfW - 0.05), spec.y + sy * (spec.h / 2 - 0.06), cz + sz * (halfD - 0.05));
              vScale.set(0.16, 0.18, 0.16);
              castingMatrices.push(new THREE.Matrix4().compose(vPos.clone(), q.clone(), vScale.clone()));
            }
          }
        }
        // 発光箱はアクセントの帯を1本
        if (spec.emissive) {
          part(accentParts, slabTpl, accentCol, cx, top - spec.h * 0.28, cz, spec.w + 0.02, 0.06, spec.d + 0.02);
        }
      } else if (arche === 'blastBarrier') {
        const ribCount = clampN(Math.floor(longLen / 1.1), 2, 6);
        for (let i = 0; i < ribCount; i += 1) {
          const t = ribCount === 1 ? 0.5 : i / (ribCount - 1);
          const along = (t - 0.5) * longLen * 0.85;
          if (longX) {
            part(reliefParts, slabTpl, rib, cx + along, spec.y, cz, 0.08, spec.h * 0.92, spec.d + 0.04);
          } else {
            part(reliefParts, slabTpl, rib, cx, spec.y, cz + along, spec.w + 0.04, spec.h * 0.92, 0.08);
          }
        }
        // 中央のハザード帯(アクセント)+ 天端リム
        if (longX) {
          part(accentParts, slabTpl, accentCol, cx, spec.y + spec.h * 0.1, cz, spec.w + 0.03, 0.12, spec.d + 0.03);
        } else {
          part(accentParts, slabTpl, accentCol, cx, spec.y + spec.h * 0.1, cz, spec.w + 0.03, 0.12, spec.d + 0.03);
        }
        part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.05, 0.02, spec.d + 0.05);
      } else if (arche === 'ammoCrate') {
        // 天面寄りのフタ縁(溝)+ 四隅ストラップ(金属)+ ピーク端アクセント
        part(reliefParts, slabTpl, groove, cx, top - 0.04, cz, spec.w * 0.96, 0.05, spec.d * 0.96);
        for (const sx of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            part(metalParts, slabTpl, hardware, cx + sx * halfW * 0.8, spec.y, cz + sz * halfD * 0.8, 0.05, spec.h * 0.9, 0.05);
          }
        }
        part(accentParts, slabTpl, accentCol, cx, top + 0.012, cz, spec.w * 0.5, 0.02, spec.d * 0.5);
      } else if (arche === 'drum') {
        // 補強リング溝2本(横方向に張り出す薄スラブ)+ 天面リム
        for (const ry of [0.34, 0.66] as const) {
          part(reliefParts, slabTpl, groove, cx, bottom + spec.h * ry, cz, spec.w + 0.02, 0.05, spec.d + 0.02);
        }
        part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.02, 0.02, spec.d + 0.02);
      } else if (arche === 'sandbag') {
        // 上辺に横倒しのカプセルを並べる(土嚢の俵)
        const bagR = 0.16;
        const along = longLen - bagR;
        const bags = clampN(Math.floor(along / (bagR * 2)), 2, 8);
        for (let i = 0; i < bags; i += 1) {
          const t = bags === 1 ? 0.5 : i / (bags - 1);
          const off = (t - 0.5) * along;
          if (longX) {
            // 長手X: カプセル軸をX(Y軸→Z回転90°)
            part(reliefParts, capsuleTpl, rib, cx + off, top - 0.02, cz, 1, Math.min(1, spec.d / 0.66), 1, 0, 0, Math.PI / 2);
          } else {
            // 長手Z: カプセル軸をZ(Y軸→X回転90°)
            part(reliefParts, capsuleTpl, rib, cx, top - 0.02, cz + off, Math.min(1, spec.w / 0.66), 1, 1, Math.PI / 2, 0, 0);
          }
        }
      } else {
        // wall: 縦のパネル分割シーム(疎)+ 天端リムのみ
        const seamCount = clampN(Math.floor(longLen / 6), 2, 12);
        for (let i = 1; i < seamCount; i += 1) {
          const along = (i / seamCount - 0.5) * longLen;
          if (longX) {
            part(reliefParts, slabTpl, groove, cx + along, spec.y, cz, 0.06, spec.h * 0.96, spec.d + 0.02);
          } else {
            part(reliefParts, slabTpl, groove, cx, spec.y, cz + along, spec.w + 0.02, spec.h * 0.96, 0.06);
          }
        }
        part(metalParts, slabTpl, rimColor, cx, top - 0.02, cz, spec.w + 0.02, 0.03, spec.d + 0.02);
      }
    }

    // 系統別に1メッシュへ畳んでシーンへ追加
    const addMerged = (
      parts: THREE.BufferGeometry[],
      material: THREE.Material,
    ): void => {
      if (parts.length === 0) {
        material.dispose();
        return;
      }
      const merged = mergeGeometries(parts, false);
      if (!merged) {
        material.dispose();
        return;
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
    };

    addMerged(
      reliefParts,
      new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    );
    addMerged(
      metalParts,
      // metalness 0.8 だと頂点カラー(アルベド)で金属diffuseが黒く沈むため 0.6 に。IBLで空を映す
      new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.3, vertexColors: true }),
    );
    if (accentParts.length > 0) {
      const accentMat = new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true });
      if (palette.emissiveAccent) {
        accentMat.emissive = new THREE.Color(palette.accent);
        accentMat.emissiveIntensity = 0.9; // Neutral+Bloom前提
        accentMat.envMapIntensity = 0.35;
      }
      addMerged(accentParts, accentMat);
    }

    // ISOコーナーキャスティング(InstancedMesh・1ドローコール)
    if (castingMatrices.length > 0) {
      const castGeo = new THREE.BoxGeometry(1, 1, 1);
      const castMat = new THREE.MeshStandardMaterial({
        color: derive(palette.wall, -0.05, -0.25),
        metalness: 0.7,
        roughness: 0.4,
      });
      const inst = new THREE.InstancedMesh(castGeo, castMat, castingMatrices.length);
      for (let i = 0; i < castingMatrices.length; i += 1) inst.setMatrixAt(i, castingMatrices[i]!);
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }

    // 輪郭線(全箱を1本のLineSegmentsへ)
    if (edgeParts.length > 0) {
      const mergedEdges = mergeGeometries(edgeParts, false);
      if (mergedEdges) {
        const lineMat = new THREE.LineBasicMaterial({
          color: derive(palette.wall, 0.18),
          transparent: true,
          opacity: palette.emissiveAccent ? 0.5 : 0.35,
        });
        this.scene.add(new THREE.LineSegments(mergedEdges, lineMat));
      }
    }

    // 床コンタクトシャドウ(全箱を1メッシュへ)
    if (shadowParts.length > 0) {
      const mergedShadow = mergeGeometries(shadowParts, false);
      if (mergedShadow) {
        const shadowMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          fog: false,
        });
        shadowMat.polygonOffset = true;
        shadowMat.polygonOffsetFactor = -1;
        shadowMat.polygonOffsetUnits = -1;
        this.scene.add(new THREE.Mesh(mergedShadow, shadowMat));
      }
    }

    // 焼き込みに使った一時ジオメトリとテンプレを破棄(merge後は不要・シーンに残らない)
    for (const g of temps) g.dispose();
    slabTpl.dispose();
    capsuleTpl.dispose();
    planeTpl.dispose();
    boxForEdges.dispose();
    edgesTpl.dispose();
  }

  // 当たり判定を持たない装飾。グラデ天球・床グリッド・外周ライトバー・
  // 四隅ビーコンでアリーナに空気感を足す。フェアネスには影響しない。
  private buildAtmosphere(palette: StageDef['palette'], size: number): void {
    const elevation = palette.elevation ?? 35;
    const turbidity = palette.turbidity ?? 6;
    const rayleigh = palette.rayleigh ?? 2;
    const mieCoefficient = palette.mieCoefficient ?? 0.005;
    const mieDirectionalG = palette.mieDirectionalG ?? 0.8;
    const applySky = (sky: Sky): void => {
      const u = sky.material.uniforms as unknown as SkyUniforms;
      u.turbidity.value = turbidity;
      u.rayleigh.value = rayleigh;
      u.mieCoefficient.value = mieCoefficient;
      u.mieDirectionalG.value = mieDirectionalG;
      u.sunPosition.value.copy(this.sunDir);
      // R18修正: Sky.js の太陽ディスクは vSunE*19000 で桁外れに明るく(HDR~5万)、露出~1.0だと
      // トーンマップ後も巨大な白い塊に飛ぶ(=「太陽が異常に白くなる」バグ)。空の出力HDRを上限
      // クランプ(2.6)し、太陽を「明るいが白飛びしない」円盤+柔らかな発光に抑える。空の階調は保持。
      sky.material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          'gl_FragColor = vec4( retColor, 1.0 );',
          'gl_FragColor = vec4( min( retColor, vec3( 2.6 ) ), 1.0 );',
        );
      };
      sky.material.needsUpdate = true;
    };

    // ── プロシージャル大気(Sky.js, 大気散乱)を可視背景にする ──
    const sky = new Sky();
    sky.scale.setScalar(Math.max(10000, size * 40));
    applySky(sky);
    this.scene.add(sky);

    // ステージ別の露出(明暗の演出)
    this.renderer.toneMappingExposure = palette.exposure ?? 1.0;

    // ── 空から環境マップ(IBL)を1回だけ焼く=金属が空を映り込み、最大の質感UPになる ──
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(10000);
    applySky(envSky);
    envScene.add(envSky);
    this.envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    // 天球IBL(空の映り込み)の強さ=まさに「天井の光源」。値が高いと上面/明部が
    // 空色で白飛びし全域が眩しくなる。0.72 を上限にクランプして眩しさを断つ。
    // IBLは影を落とさないので sun.castShadow/影の落ち方には一切影響しない。
    const envIntensity = palette.environmentIntensity ?? (elevation < 6 ? 0.4 : 0.85);
    // R15: 白飛び完全解消のため天球IBLの上限を更に下げる(明るい空が金属/明部を洗い流すのを抑制)
    this.scene.environmentIntensity = Math.min(envIntensity, 0.72);
    envSky.geometry.dispose();
    (envSky.material as THREE.Material).dispose();
    pmrem.dispose();

    // フォグ色を空の地平側へ寄せ、空とフォグの境目を目立たなくする。
    // R13: snow/overcast は空へ寄せすぎると白飛びして「バグっぽい霧」になるため寄せを弱め、
    // フォグ固有の色相(銀青/霞)を保って意図的な大気に見せる
    if (this.scene.fog) {
      const fogMood = resolveMood(palette);
      const skyLerp = fogMood === 'snow' || fogMood === 'overcast' ? 0.2 : 0.35;
      (this.scene.fog as THREE.FogExp2).color.lerp(new THREE.Color(palette.sky), skyLerp);
    }

    // 床のグリッド(アクセント色の薄い線)で平坦さを解消する
    const grid = new THREE.GridHelper(
      size,
      Math.max(8, Math.round(size / 4)),
      new THREE.Color(palette.accent),
      new THREE.Color(palette.wall),
    );
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.22;
    // 床に薄く重ねる線なので深度書き込みを切り、ポリゴンオフセットで遠距離の
    // Zファイト(線のちらつき・欠落)を防ぐ。微小なY浮かせだけでは破綻する
    gridMat.depthWrite = false;
    gridMat.polygonOffset = true;
    gridMat.polygonOffsetFactor = -1;
    gridMat.polygonOffsetUnits = -1;
    grid.position.y = 0.02;
    this.scene.add(grid);

    // 外周ライトバーと四隅ビーコン(発光マテリアルで光って見せる)
    const accentGlow = new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: new THREE.Color(palette.accent),
      emissiveIntensity: 0.9, // Neutral+Bloom前提
      roughness: 0.4,
      envMapIntensity: 0.35,
    });
    const half = size / 2;
    const barTop = Math.max(5, this.config.stage.maxHeight + 2.5) - 0.4;
    const barGeo = new THREE.BoxGeometry(size, 0.16, 0.16);
    const bars: Array<[number, number, number]> = [
      [0, -half, 0],
      [0, half, 0],
      [-half, 0, Math.PI / 2],
      [half, 0, Math.PI / 2],
    ];
    for (const [x, z, ry] of bars) {
      const bar = new THREE.Mesh(barGeo, accentGlow);
      bar.position.set(x, barTop, z);
      bar.rotation.y = ry;
      this.scene.add(bar);
    }
    const beaconGeo = new THREE.CylinderGeometry(0.1, 0.13, 5, 8);
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const beacon = new THREE.Mesh(beaconGeo, accentGlow);
        beacon.position.set(sx * (half - 1.2), 2.5, sz * (half - 1.2));
        this.scene.add(beacon);
      }
    }
  }

  // ドミネーションの拠点を点対称に配置する。リングは所有チームの色に追従する
  private buildZones(): void {
    const size = this.config.stage.size;
    const positions: Array<[string, number, number]> = [
      ['A', -size * 0.3, size * 0.12],
      ['B', 0, 0],
      ['C', size * 0.3, -size * 0.12],
    ];
    for (const [id, x, z] of positions) {
      const center = new THREE.Vector3(x, 0, z);
      this.zoneCenters.set(id, center);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(ZONE_RADIUS - 0.35, ZONE_RADIUS, 36),
        new THREE.MeshBasicMaterial({
          color: 0xb9c2cc,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.06, z);
      this.scene.add(ring);
      this.zoneRings.set(id, ring);

      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(ZONE_RADIUS * 0.97, ZONE_RADIUS * 0.97, 7, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xb9c2cc,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      pillar.position.set(x, 3.5, z);
      pillar.userData.zoneId = id;
      this.scene.add(pillar);
    }
  }

  private zoneColor(owner: TeamId | null): number {
    if (owner === null) return 0xb9c2cc;
    return owner === PLAYER_TEAM ? this.colors.ally : this.colors.enemy;
  }

  private updateZones(dt: number): void {
    if (!this.domination) return;
    const presence = new Map<string, Map<TeamId, number>>();
    for (const zone of this.domination.zones) {
      const center = this.zoneCenters.get(zone.id);
      if (!center) continue;
      const counts = new Map<TeamId, number>();
      const countEntity = (pos: THREE.Vector3, team: TeamId) => {
        const dx = pos.x - center.x;
        const dz = pos.z - center.z;
        if (Math.hypot(dx, dz) < ZONE_RADIUS && pos.y < center.y + 3) {
          counts.set(team, (counts.get(team) ?? 0) + 1);
        }
      };
      if (this.player.alive) countEntity(this.player.position, PLAYER_TEAM);
      for (const bot of this.bots) {
        if (bot.alive) countEntity(bot.position, bot.team);
      }
      presence.set(zone.id, counts);
    }

    const points = this.domination.update(dt, presence, (zone, event) => {
      if (event === 'captured') {
        const mine = zone.owner === PLAYER_TEAM;
        this.announcements.push(mine ? `${zone.id}拠点を制圧した` : `${zone.id}拠点を奪われた`);
        if (mine) {
          this.sounds.capture();
          this.addUltCharge(ULT_ON_CAPTURE);
          // プレイヤー自身が圏内にいた制圧だけを個人成績に数える
          const center = this.zoneCenters.get(zone.id);
          if (
            center &&
            this.player.alive &&
            Math.hypot(this.player.position.x - center.x, this.player.position.z - center.z) <
              ZONE_RADIUS
          ) {
            this.playerCaptures += 1;
            this.scoreEvents.push({ label: '制圧', xp: 150 });
          }
        } else this.sounds.zoneLost();
      } else {
        this.announcements.push(`${zone.id}拠点が中立化された`);
        this.sounds.zoneLost();
      }
    });
    for (const [team, n] of points) this.scores.add(team, n);

    // リングの見た目を所有状態に同期する
    for (const zone of this.domination.zones) {
      const ring = this.zoneRings.get(zone.id);
      if (!ring) continue;
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.setHex(this.zoneColor(zone.owner));
      material.opacity = zone.contested || zone.capturingTeam !== null ? 0.95 : 0.65;
    }
  }

  // 固定60Hzで呼ばれるゲームロジック本体
  update(dt: number): void {
    if (this.over) return;
    this.elapsed += dt;
    this.tracker.tick(dt);
    // ゾンビは「ダウンするまで無限ウェーブ」。共通試合タイマーで強制終了させない(致命バグ回避)。
    // over は zombieMelee のプレイヤー死亡でのみ立てる(handleRespawns)。timeLeftはHUD非表示。
    if (this.config.mode !== 'zombie') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        // R14: 時間到達と同フレームに目的が達成される場合(extract/eliminate等)を敗北にしないよう、
        // 失敗確定の前にミッションを一度評価して勝利を拾う(updateMission自身が pending 以外で早期return)
        if (this.mission && this.missionOutcome === 'pending') this.updateMission(dt);
        // ミッションは時間到達で勝敗確定: survive/defend は勝利、その他の目的は時間切れ=失敗
        if (this.mission && this.missionOutcome === 'pending') {
          const k = this.mission.objective.kind;
          this.missionOutcome = k === 'survive' || k === 'defend' ? 'won' : 'lost';
        }
        this.over = true;
        return;
      }
    }

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.whiteout = Math.max(0, this.whiteout - dt / 3.2);

    // 瀕死(HP25%未満)で心音が鳴り、HPが低いほど速くなる
    const hpRatio = this.player.hp / this.player.maxHp;
    if (this.player.alive && hpRatio > 0 && hpRatio < 0.25) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.sounds.heartbeat();
        this.heartbeatTimer = 0.48 + (hpRatio / 0.25) * (0.9 - 0.48);
      }
    } else {
      this.heartbeatTimer = 0;
    }

    this.updateUltimate(dt);
    const weapon = this.activeWeapon;

    // ADS: ホールドまたはトグル(アクセシビリティ設定)
    if (this.settings.adsToggle && this.input.adsPressed()) {
      this.adsLatch = !this.adsLatch;
    }
    const wantAds = this.settings.adsToggle ? this.adsLatch : this.input.adsDown();

    // しゃがみ: ホールドまたはトグル(アクセシビリティ設定)。
    // wasPressedは消費型なので1回だけ読む
    const crouchPressed = this.input.wasPressed('crouch');
    // 素手で空中の「しゃがみ」はダイブスラム入力なので、しゃがみトグルを反転させない
    // (着地後に意図せずしゃがみ固定になる干渉を防ぐ)
    const slamIntent = weapon.def.id === 'fists' && !this.player.grounded;
    if (this.settings.crouchToggle && crouchPressed && !slamIntent) {
      this.crouchLatch = !this.crouchLatch;
    }
    // キーのデジタル±1とゲームパッドのアナログ量をORブレンド(-1..1へクランプ)
    const moveInput = {
      x: clampUnit(
        this.input.gpMoveX + (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0),
      ),
      z: clampUnit(
        this.input.gpMoveZ + (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0),
      ),
      jumpPressed: this.input.wasPressed('jump'),
      crouch: this.settings.crouchToggle ? this.crouchLatch : this.input.isDown('crouch'),
      crouchPressed,
      sprint: this.input.isDown('sprint'),
      lean: (this.input.isDown('leanright') ? 1 : 0) - (this.input.isDown('leanleft') ? 1 : 0),
    };
    this.player.update(dt, moveInput, weapon.adsProgress, this.sounds);
    // 移動由来のカメラシェイク(着地・ブースト)+ビューモデルの着地インパルス
    if (this.player.landImpact > 6) {
      this.addShake(Math.min(0.5, this.player.landImpact * 0.03));
      this.viewModel.applyLandBob(Math.min(1, this.player.landImpact / 18));
    }
    if (this.player.justBoosted) this.addShake(0.12);

    this.handleWeaponSwitch();
    this.handleMelee();
    this.handleGrenadeInput(dt);

    // ── 素手(武器なし)の技: コンボ窓の減衰と、空中しゃがみ→ダイブスラム ──
    this.punchWindowS = Math.max(0, this.punchWindowS - dt);
    this.slamCooldownS = Math.max(0, this.slamCooldownS - dt);
    this.blinkCooldownS = Math.max(0, this.blinkCooldownS - dt);
    const fists = weapon.def.id === 'fists';
    if (
      fists &&
      crouchPressed &&
      !this.player.grounded &&
      !this.slamPending &&
      this.slamCooldownS <= 0 &&
      this.player.alive &&
      this.player.forceDive() // 実際に降下を開始できた時だけ装填
    ) {
      this.slamPending = true;
      this.slamStartY = this.player.position.y;
      this.sounds.punchWhoosh(); // 降下開始の風切り
    }
    // 着地はplayer側のdiveLandedを1回だけ消費。ジャンプでキャンセルした降下・
    // 奈落リスポーン・死亡では発火しない(接地/死亡で装填だけ静かに解除)
    const dived = this.player.consumeDiveLanded();
    if (this.slamPending && (dived || this.player.grounded || !this.player.alive)) {
      if (dived && this.player.alive && this.activeWeapon.def.id === 'fists') {
        this.doDiveSlam();
        this.slamCooldownS = 2.5;
      }
      this.slamPending = false;
    }

    const sprintBlocksFire = this.player.sprinting;
    const events = weapon.update(
      dt * 1000,
      {
        trigger: this.input.fireDown() && this.player.alive && !sprintBlocksFire && !this.cooking,
        ads: wantAds && this.player.alive && !this.cooking,
        reloadPressed: this.input.wasPressed('reload'),
      },
      {
        moveFactor: this.player.moveFactor,
        airborne: !this.player.grounded,
        crouched: this.player.crouching,
        sliding: this.player.sliding,
        wallRunning: this.player.wallRunning,
      },
    );
    for (const event of events) {
      if (event.type === 'fired') {
        // 素手(クナイ): 弾を出さず斬撃へ差し替える。
        // ADS(右クリック)構え中の左クリック=ブリンク斬撃(短距離テレポート斬り)。
        // それ以外は薙ぎ払いコンボ(空中しゃがみ=ダイブスラム / スライド中=スライドキック)。
        if (weapon.def.id === 'fists') {
          if (weapon.adsProgress > 0.5 && this.blinkCooldownS <= 0) {
            this.doBlinkStrike();
          } else {
            this.doPunch();
          }
          continue;
        }
        // RecoilStepの規約はyaw正=右。rotation.yは正で左回りなので符号を反転する
        this.player.yaw -= event.recoil.yaw;
        this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
        this.fireShot(event.spreadRad);
        this.viewModel.fire(weapon.def.scope === true);
        // スナイパーは覗き込み中でもしっかり蹴る重い一撃(screenShake設定で自動減衰)
        this.addShake(
          weapon.def.scope === true ? 0.12 : 0.035 * (1 - 0.85 * weapon.adsProgress),
        );
        if (weapon.def.suppressed) this.sounds.shotSuppressed();
        else this.sounds.shot(weapon.def.soundProfile);
        if (weapon.def.scope === true) this.sounds.bolt(); // ボルト操作の2段音
        this.alertBots(weapon.def.suppressed ? ALERT_RADIUS_SUPPRESSED : ALERT_RADIUS);
      } else if (event.type === 'reload-start') {
        this.sounds.reload(event.durationMs);
      } else if (event.type === 'dryfire') {
        this.sounds.dryfire();
      }
    }
    const recovered = weapon.recoil.recover(dt);
    this.player.yaw += recovered.yaw;
    this.player.pitch -= recovered.pitch;

    // スコープの揺れ(視覚のみ・弾道は汚さない)と息止めメーター。
    // 揺れはオーバーレイのフレーム視差に使い、ピン留めの照準点は常に真。
    const scopedNow = weapon.def.scope === true && weapon.adsProgress > 0.5 && this.player.alive;
    // ADS開始からの経過(クイックスコープの無揺れ/スナップ窓に使う)。非スコープでリセット
    if (scopedNow) {
      this.adsEntryElapsed += dt;
    } else {
      this.adsEntryElapsed = 0;
      this.snapPulseDone = false;
    }
    const holding = scopedNow && this.input.isDown('holdBreath');
    const breath = breathStep(this.breathMeter, dt, holding);
    this.breathMeter = breath.meter;
    const wasSteady = this.breathSteady;
    this.breathSteady = breath.steady;
    // 覗き込み直後の約0.37sは揺れ0(クイックスコープの特権)。息止め中も0。それ以外は
    // 通常揺れで、息切れ(meter===0)では倍化して「止めすぎの罰」を見せる(全て視覚専用)
    const base = scopedNow && !this.settings.reduceMotion && !this.breathSteady ? SWAY_AMP_DEG : 0;
    const amp = this.adsEntryElapsed < 0.37 ? 0 : swayAmp(this.breathMeter, base);
    this.scopeSway = lissajousSway(this.elapsed, amp);
    if (this.breathSteady && !wasSteady) this.sounds.holdBreath();
    // scope-inの2段オーディオ: 50%で構え上げ、85%でレンズを目へ押し当てるスナップ音
    const scopeProg = weapon.def.scope ? weapon.adsProgress : 0;
    if (this.prevScopeProgress < 0.5 && scopeProg >= 0.5) this.sounds.scopeIn();
    if (this.prevScopeProgress < 0.85 && scopeProg >= 0.85) this.sounds.lensSnap();
    // 覗き込み開始時刻を記録(クイックスコープ=覗いてすぐ撃つ、の判定に使う)
    if (this.prevScopeProgress <= 0.02 && scopeProg > 0.02) this.lastAdsStartMs = performance.now();
    this.prevScopeProgress = scopeProg;

    this.updateGrenades(dt);
    this.updateFirePatches(dt);
    this.smokeZones = this.smokeZones.filter((zone) => zone.until > this.elapsed);
    this.updateZones(dt);

    if (!this.player.alive && this.killcamTimer > 0) this.killcamTimer -= dt;
    // 遷移黒幕/突入フラッシュは死亡ゲート外で無条件減衰(リスポーン後の黒画面固着を防ぐ)
    this.deathVeil = Math.max(0, this.deathVeil - dt * 4);
    this.killcamFlash = Math.max(0, this.killcamFlash - dt * 5.5);
    // キルカメラのカメラ姿勢を固定dtで前進(時間前進はここ1箇所に集約=冪等)
    this.advanceKillcam(dt);

    this.updateBots(dt);
    this.physics.step();
    this.syncCamera();
    this.handleRespawns();
    if (this.config.mode === 'zombie') this.updateZombieDirector(dt);

    // プレイヤー死亡の立ち下がりでメダル連続系をリセット(復讐対象=直近のkiller)
    if (this.lastAlive && !this.player.alive) {
      this.tracker.onPlayerDeath(this.killer?.uid ?? null);
    }
    this.lastAlive = this.player.alive;

    if (this.mission) {
      // ミッションは目的達成/失敗で終了(先取スコアは無効)
      this.updateMission(dt);
      if (this.missionOutcome !== 'pending') this.over = true;
    } else if (this.scores.winner() !== null) {
      // 先取スコア到達で試合終了
      this.over = true;
    }

    // 動的BGMの交戦度: 視認交戦+被弾トラウマ+低HPで高まる
    let heat = this.aimAssistEngaged ? 0.4 : 0;
    heat += Math.min(1, this.shakeTrauma) * 0.3;
    heat += Math.min(1, 1 - this.player.hp / this.player.maxHp) * 0.3;
    // ゾンビ: ラウンドが進むほど恐怖から高揚へ。最低でも 0.2+round/12 の底上げで常時緊張感を出す
    if (this.config.mode === 'zombie') heat = Math.max(heat, 0.2 + this.zombieRound / 12);
    this.sounds.setCombatHeat(Math.min(1, heat));
    // 瀕死の聴覚こもり(差分ガードはSoundKit側。死亡中は解除して観戦を明瞭に)
    this.sounds.setHealthState(this.player.alive ? this.player.hp / this.player.maxHp : 1);
  }

  // 描画フレームごとの処理。視点操作はフレームレートに追従させる
  frame(dt: number, playing: boolean): void {
    if (playing && !this.over) {
      const weapon = this.activeWeapon;
      // ADS感度はズーム倍率に追従(焦点距離パリティ)+ユーザー倍率。高倍率スコープが速すぎない
      const adsScale = adsSensScale(
        this.settings.fov,
        weapon.def.adsFovScale,
        this.settings.adsSensMul,
        weapon.adsProgress,
      );
      let k = LOOK_BASE * this.settings.sensitivity * adsScale;
      // 既定はマウスを上へ動かすと上を向く。invertYで上下を入れ替える
      const pitchDir = this.settings.invertY ? 1 : -1;

      // エイムアシスト(R8: BO2準拠)。全武器適用・スローダウン主体・吸着は微量。
      // 「先にブレーキ(広円錐10°)、中心で微引き(狭円錐5°)」の2段構え。RAAは廃止。
      this.aimAssistEngaged = false;
      this.aimAssistTargetDir = null;
      const gp = this.input.lastDevice === 'gamepad';
      const assistActive =
        this.settings.aimAssist && this.player.alive && (weapon.adsProgress > 0.5 || gp);
      const target = assistActive ? this.aimAssistTarget(weapon.def.range) : null;
      // スローダウンと吸着の両方を同じgateで滑らかに立ち上げる(0.5境界での段差防止)
      const adsGate = THREE.MathUtils.smoothstep(weapon.adsProgress, 0.5, 1);
      const gate = Math.max(adsGate, gp ? HIP_GATE : 0);
      // クラス別倍率(拡散武器ほど弱い)とデバイス倍率(マウスは弱い摩擦だけ)
      const classMul = CLASS_AA_MUL[weapon.def.class];
      const deviceMul = gp ? 1 : MOUSE_AA_SCALE;
      let slow = 1;
      if (target) {
        // ヒップ(パッド非ADS)は控えめ、ADSでしっかり粘る(BO2の当て感)。
        // ヒップにはclassMulを重ねない(乗算3段で体感ゼロ化していたのを是正)
        const hip = gp && weapon.adsProgress < 0.3;
        const maxSlow = hip
          ? 0.45 * this.settings.aimAssistStrength * gate * deviceMul
          : 0.6 * this.settings.aimAssistStrength * gate * classMul * deviceMul;
        slow = slowdownFactor(target.angle, SLOWDOWN_CONE_DEG * DEG, maxSlow);
      }
      k *= slow;

      // マウス
      this.player.yaw -= this.input.mouseDX * k;
      // ピッチはアシスト適用後に一度だけクランプする
      let pitch = this.player.pitch + pitchDir * this.input.mouseDY * k;
      // ゲームパッド(感度は独立。ADS減速slowとadsScaleのみ共有)
      const gpK = adsScale * slow;
      const gpPitchDir = this.settings.gamepadInvertY ? 1 : -1;
      this.player.yaw -= this.input.gpYawBase * gpK;
      pitch += gpPitchDir * this.input.gpPitchBase * gpK;

      // 微プルは狭円錐(5°)内のみ。フリック中(強い入力)はアシスト完全カット(break-free)
      if (target && target.angle < ACQUIRE_CONE_DEG * DEG) {
        const inputMag =
          Math.hypot(this.input.mouseDX, this.input.mouseDY) + this.input.gpLookMag * 40;
        const inputDamp = THREE.MathUtils.clamp(1 - inputMag / 40, 0, 1);
        // 部位別プル係数: 頭/脚への引き込みは弱め(head0.9/chest1.0/waist0.8/limb0.6)
        const strength =
          this.settings.aimAssistStrength *
          gate *
          inputDamp *
          PART_PULL_SCALE[target.part] *
          classMul *
          deviceMul;
        const delta = aimAssistDelta({
          curYaw: this.player.yaw,
          curPitch: pitch,
          tgtYaw: target.yaw,
          tgtPitch: target.pitch,
          angleRad: target.angle,
          distanceM: target.dist,
          dtS: dt,
          strength,
          maxRangeM: weapon.def.range,
        });
        this.player.yaw += delta.dYaw;
        pitch += delta.dPitch;
        this.aimAssistEngaged = true;
        // 弾道補正/スナップは頭ではなく胸(中心質量)に固定する。磁力による自動
        // ヘッドショット化を防ぎ、頭はあくまで“狙えば寄る”ソフトプルの範疇に留める
        const eyeNow = this.player.eyePosition;
        const bp = target.bot.position;
        const chest = this._aimScratch.set(
          bp.x - eyeNow.x,
          bp.y + 0.15 - eyeNow.y,
          bp.z - eyeNow.z,
        );
        const chestDist = chest.length();
        const chestDir =
          chestDist > 1e-4 ? chest.clone().multiplyScalar(1 / chestDist) : target.dir.clone();
        this.aimAssistTargetDir = chestDir;
        this.aimAssistTargetAngle = Math.acos(
          THREE.MathUtils.clamp(this.cameraForward().dot(chestDir), -1, 1),
        );
        this.aimAssistTargetDist = chestDist;
        // スコープ覗き込み直後の窓(0.4s以内)で対象が索敵円錐内なら、1回だけスナップ補正(胸へ)。
        // スコープADS時に限定することで、非スコープ武器/ゲームパッドの腰だめで毎フレーム
        // 発火して胴ロック化する不具合を防ぐ(クイックスコープ専用)。
        if (
          weapon.def.scope === true &&
          weapon.adsProgress > 0.5 &&
          !this.snapPulseDone &&
          this.adsEntryElapsed < 0.4 &&
          target.angle < ACQUIRE_CONE_DEG * DEG
        ) {
          const chestYaw = Math.atan2(-chestDir.x, -chestDir.z);
          const chestPitch = Math.asin(THREE.MathUtils.clamp(chestDir.y, -1, 1));
          const dYaw = wrapAngle(chestYaw - this.player.yaw);
          const dPitch = chestPitch - pitch;
          const err = Math.hypot(dYaw, dPitch);
          if (err > 1e-6) {
            const f = snapPulse(err, this.settings.aimAssistStrength) / err;
            this.player.yaw += dYaw * f;
            pitch += dPitch * f;
          }
          this.snapPulseDone = true;
        }
      }
      this.player.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      this.lastLookDX = this.input.mouseDX;
      this.lastLookDY = this.input.mouseDY;
    } else {
      this.lastLookDX = 0;
      this.lastLookDY = 0;
    }

    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * SHAKE_DECAY);
    this.syncCamera();

    const weapon = this.activeWeapon;
    // 速度に応じてFOVを広げ、スピード感を出す。ADSは従来どおり絞る。
    // 画面揺れ軽減(アクセシビリティ)時は速度由来のFOV変化を無効化する
    // ADS中はキックを打ち消し、覗き込み倍率を速度に依らず一定に保つ
    const speedFov =
      this.player.alive && !this.settings.reduceMotion
        ? this.player.fovSpeedKick01 * FOV_SPEED_KICK * (1 - weapon.adsProgress)
        : 0;
    // 息止め中はスコープをさらに約1割ズームインし、精密射撃の実利を与える
    const breathZoom = weapon.def.scope === true && this.breathSteady ? 0.9 : 1;
    const targetFov =
      (this.settings.fov + speedFov) *
      (1 - (1 - weapon.def.adsFovScale) * weapon.adsProgress) *
      breathZoom;
    // キルカメラ中は advanceKillcam が FOV を唯一所有する(望遠パンチと競合させない)
    if (!this.killcamCamActive && Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }

    // クッキング中は投擲軌道をプレビューする
    if (this.cooking && this.player.alive) {
      const spec = GRENADE_SPECS[this.grenadeKind];
      const origin = this.grenadeOrigin();
      const velocity = this.cameraForward().multiplyScalar(spec.throwSpeed);
      this.effects.showTrajectory(trajectoryPoints(spec, origin, velocity, this.grenadeRaycast));
    } else {
      this.effects.hideTrajectory();
    }

    // 観戦カメラをゆっくり回す。銃の表示はviewModel側でscopeReveal/aliveから決める
    this.orbitAngle += dt * 0.5;
    // 銃を長く見せてから鋭くスコープへ切り替える(BO2: レンズが迫ってからブラックアウト)
    const scopeReveal = weapon.def.scope
      ? THREE.MathUtils.smoothstep(weapon.adsProgress, 0.7, 0.9)
      : 0;

    // レンジファインダー: 照準中心レイで、見ている地点までの距離を測る
    // R14: ネイティブ狙撃に加え、後付け倍率光学(adsOpticActiveと同条件)でもレンジファインダーを動かす
    // (旧: def.scope限定で、ACOG/可変/サーマル/DMRのオーバーレイは常に -- M 表示だった)
    const opticMagnified = OPTIC_SPECS[resolveOpticId(weapon.def)]?.magnified === true;
    if (
      (weapon.def.scope === true || opticMagnified) &&
      weapon.adsProgress > 0.5 &&
      this.player.alive
    ) {
      const hit = this.castRay(
        this.player.eyePosition,
        this.cameraForward(),
        weapon.def.range,
        this.player.body,
      );
      this.scopeRangeM = hit ? hitToi(hit) : 0;
    } else {
      this.scopeRangeM = 0;
    }

    // ヒットストップ: 命中の瞬間だけビューモデルとFXを凍結し、当たりの視認時間を稼ぐ。
    // 物理・カメラ・移動・音は止めない(update()側でdtのまま進む)
    const vmDt = this.hitFreezeS > 0 ? 0 : dt;
    this.hitFreezeS = Math.max(0, this.hitFreezeS - dt);

    this.viewModel.update(vmDt, {
      adsProgress: weapon.adsProgress,
      mouseDX: this.lastLookDX,
      mouseDY: this.lastLookDY,
      moveFactor: this.player.moveFactor,
      grounded: this.player.grounded,
      reloadRatio: weapon.reloading ? weapon.reloadRatio : null,
      raiseRatio: Math.max(weapon.raiseRatio, this.cooking ? 0.65 : 0),
      motionScale: this.settings.reduceMotion ? 0.25 : 1,
      alive: this.player.alive,
      scopeReveal01: scopeReveal,
      sprinting: this.player.sprinting && this.player.grounded,
      scopeWeapon: weapon.def.scope === true,
    });
    this.effects.update(vmDt);
    // 映画的アトモスフィア(草の風/環境パーティクル/グラウンドフォグ/グレインの時間前進)
    this.atmosphere?.update(vmDt, this.camera.position);
    // ジュース: 被弾フラッシュのエンベロープ→PostFX(被弾時のみ有効化=idleコストゼロ)
    if (this.tookDamage) this.hitFlashEnv = 1;
    this.hitFlashEnv = Math.max(0, this.hitFlashEnv - dt * 3.5);
    if (this.postfx) {
      const pulse = this.settings.reduceMotion ? 0 : this.hitFlashEnv * 0.75;
      this.postfx.enabled = pulse > 0.002;
      this.postfx.setHitPulse(pulse);
      this.postfx.setTime(this.elapsed);
    }
  }

  // キルカメラのカメラ姿勢を固定dtで前進する(update()から呼ぶ)。
  // 被写体は「倒した相手(killer)」。一人称からOTS三人称へexp dampingで滑らかに引き、
  // killerの正面を三分割で捉える。killerが4m以上動く/倒れると観戦へbail(冪等)。
  private advanceKillcam(dt: number): void {
    const killer = this.killer;
    const active =
      !this.player.alive &&
      this.killcamTimer > 0 &&
      this.deathPos !== null &&
      killer !== null &&
      killer.alive &&
      killer.position.distanceTo(this.killcamAnchorPos) <= 4;
    this.killcamCamActive = active;
    // bail検出(killerが4m超離脱): キルカメラ→観戦のハードカットが起きるフレームを
    // 黒幕で一瞬隠す。以降シネマHUDも killcamCamActive で連動して消える(乖離解消)
    if (this.prevKillcamCamActive && !active && !this.player.alive && this.killcamTimer > 0) {
      this.deathVeil = Math.max(this.deathVeil, 0.6);
    }
    this.prevKillcamCamActive = active;
    if (!active || !killer || !this.deathPos) return;
    this.killcamElapsedS += dt;
    const rm = this.settings.reduceMotion;
    const head = killer.headPosition();
    // victim(死亡地点)側から killer 正面を捉える方向
    this._kcLook.set(this.deathPos.x - killer.position.x, 0, this.deathPos.z - killer.position.z);
    if (this._kcLook.lengthSq() < 0.01) this._kcLook.set(0, 0, 1);
    this._kcLook.normalize();
    // 緩やかな弧(終盤slow)。角度は積分するのでarcSpeed低下=真の減速(方位に段差なし)。
    // reduceMotionは弧なしの静止ショット
    const arcSpeed = rm ? 0 : this.killcamTimer < 0.7 ? 0.12 : 0.4;
    this.killcamArc += arcSpeed * dt;
    const arc = this.killcamArc;
    const dist = 3.2;
    const dirX = this._kcLook.x * Math.cos(arc) - this._kcLook.z * Math.sin(arc);
    const dirZ = this._kcLook.x * Math.sin(arc) + this._kcLook.z * Math.cos(arc);
    this._kcTarget.set(head.x + dirX * dist, head.y + 1.05, head.z + dirZ * dist);
    // 壁抜け防止: killer頭→カメラ目標へレイ、world遮蔽なら手前へ寄せる
    const dcx = this._kcTarget.x - head.x;
    const dcy = this._kcTarget.y - head.y;
    const dcz = this._kcTarget.z - head.z;
    const camDist = Math.hypot(dcx, dcy, dcz);
    if (camDist > 0.1) {
      const inv = 1 / camDist;
      this._kcLook.set(dcx * inv, dcy * inv, dcz * inv);
      const hit = this.castRay(head, this._kcLook, camDist, this.player.body);
      if (hit) {
        const t = this.tags.get(hit.collider.handle);
        if (t === undefined || t.kind === 'world') {
          const safe = Math.max(0.6, hitToi(hit) - 0.15);
          this._kcTarget.set(head.x + this._kcLook.x * safe, head.y + this._kcLook.y * safe, head.z + this._kcLook.z * safe);
        }
      }
    }
    this._kcM4.lookAt(this._kcTarget, head, CAM_UP);
    this._kcQuat.setFromRotationMatrix(this._kcM4);
    if (!this.killcamSeeded) {
      // 一人称からシード(引く演出の起点)
      this.killcamSeeded = true;
      const eye = this.player.eyePosition;
      const fwd = this.cameraForward();
      this.killcamCurPos.copy(eye);
      this._kcM4.lookAt(eye, this._kcTarget.clone().set(eye.x + fwd.x, eye.y + fwd.y, eye.z + fwd.z), CAM_UP);
      this.killcamCurQuat.setFromRotationMatrix(this._kcM4);
      this.killcamFov = this.camera.fov;
      // シード後に本来の目標を再設定(上でtargetを一時流用したため)
      this._kcTarget.set(head.x + dirX * dist, head.y + 1.05, head.z + dirZ * dist);
    }
    const k = rm ? 1 : 1 - Math.exp(-3.2 * dt);
    this.killcamCurPos.lerp(this._kcTarget, k);
    this.killcamCurQuat.slerp(this._kcQuat, k);
    this.killcamFov += (46 - this.killcamFov) * (rm ? 1 : Math.min(1, dt * 3));
  }

  private syncCamera(): void {
    // キルカメラ: advanceKillcam(固定dt)が算出した姿勢をコピー+決定論的手ブレのみ
    if (this.killcamCamActive) {
      this.camera.position.copy(this.killcamCurPos);
      this.camera.quaternion.copy(this.killcamCurQuat);
      if (!this.settings.reduceMotion) {
        // 微細な手持ちカメラ風の揺れ(elapsed駆動=決定論的)
        this.camera.rotation.z += Math.sin(this.elapsed * 1.7) * 0.006;
        this.camera.rotation.x += Math.sin(this.elapsed * 2.3 + 1.1) * 0.004;
      }
      if (Math.abs(this.camera.fov - this.killcamFov) > 0.01) {
        this.camera.fov = this.killcamFov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
    // 死亡だがキルカメラ非該当(自爆/落下/killer不在/bail): 観戦オービット
    if (!this.player.alive && this.deathPos) {
      const focus = this.deathPos.clone().setY(this.deathPos.y + 1);
      this.camera.position.set(
        this.deathPos.x + Math.cos(this.orbitAngle) * SPECTATE_RADIUS,
        this.deathPos.y + SPECTATE_HEIGHT,
        this.deathPos.z + Math.sin(this.orbitAngle) * SPECTATE_RADIUS,
      );
      this.camera.lookAt(focus);
      return;
    }
    const eye = this.player.eyePosition;
    this.camera.position.copy(eye);
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
    this.camera.rotation.z =
      -this.player.lean * LEAN_ROLL +
      (this.settings.reduceMotion ? 0 : this.player.wallRunTilt * WALLRUN_VIEW_ROLL);
    // トラウマ式カメラシェイク。揺れ軽減設定では無効、設定倍率で強さを調整。
    // 乱数ではなく滑らかな多重正弦にして、ガクつかない自然な揺れにする
    const shakeScale = this.settings.reduceMotion ? 0 : this.settings.screenShake;
    if (this.shakeTrauma > 0 && shakeScale > 0) {
      const t = this.shakeTrauma * this.shakeTrauma * shakeScale;
      const n = (seed: number): number =>
        (Math.sin(this.elapsed * 37 + seed) + 0.6 * Math.sin(this.elapsed * 61 + seed * 1.7)) * 0.62;
      this.camera.rotation.x += n(1) * t * SHAKE_PITCH;
      this.camera.rotation.y += n(13) * t * SHAKE_YAW;
      this.camera.rotation.z += n(27) * t * SHAKE_ROLL;
    }
  }

  private handleWeaponSwitch(): void {
    if (this.cooking) return;
    let target: number | null = null;
    if (this.input.wasPressed('weapon1')) target = 0;
    if (this.input.wasPressed('weapon2')) target = 1;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) target = (this.activeIndex + 1) % 2;
    if (target !== null && target !== this.activeIndex) {
      this.activeIndex = target;
      this.activeWeapon.raise();
      this.viewModel.setWeapon(this.activeWeapon.def);
      this.adsLatch = false;
    }
  }

  private handleMelee(): void {
    if (!this.input.wasPressed('melee') || this.meleeCooldown > 0 || !this.player.alive) return;
    if (this.cooking) return;
    this.meleeCooldown = MELEE_COOLDOWN;
    this.viewModel.fire();
    this.sounds.melee();

    const origin = this.player.eyePosition;
    const dir = this.cameraForward();
    const hit = this.castRay(origin, dir, MELEE_RANGE, this.player.body);
    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    if (tag?.kind === 'bot' && tag.bot.alive && tag.bot.team !== PLAYER_TEAM) {
      const point = origin.clone().addScaledVector(dir, hitToi(hit));
      this.applyBotDamage(tag.bot, MELEE_DAMAGE, point, false, '近接');
    }
  }

  private handleGrenadeInput(dt: number): void {
    // 投擲物の切替。クッキング中は不可
    if (!this.cooking && this.input.wasPressed('grenadeswitch')) {
      const index = GRENADE_KINDS.indexOf(this.grenadeKind);
      this.grenadeKind = GRENADE_KINDS[(index + 1) % GRENADE_KINDS.length]!;
      this.sounds.uiClick();
    }

    if (
      !this.cooking &&
      this.input.wasPressed('grenade') &&
      this.player.alive &&
      this.grenadeCounts[this.grenadeKind] > 0
    ) {
      this.cooking = true;
      this.cookTimer = 0;
      // 強制投擲後にキーを離した分の古いリリースを持ち越さない。
      // キーが押されている今、残っているリリースは必ず過去のもの
      if (this.input.isDown('grenade')) this.input.wasReleased('grenade');
      this.sounds.pinPull();
    }

    if (!this.cooking) return;

    // 構え中に倒されたら、その場に落とす
    if (!this.player.alive) {
      this.releaseGrenade(2);
      return;
    }

    this.cookTimer += dt;
    const spec = GRENADE_SPECS[this.grenadeKind];
    const forced = spec.cookable && this.cookTimer >= spec.fuseS - COOK_SAFETY_S;
    if (forced || this.input.wasReleased('grenade')) {
      this.releaseGrenade(spec.throwSpeed);
    }
  }

  private grenadeOrigin(): THREE.Vector3 {
    const origin = this.player.eyePosition;
    origin.addScaledVector(this.cameraForward(), 0.35);
    origin.y -= 0.1;
    return origin;
  }

  private releaseGrenade(speed: number): void {
    const spec = GRENADE_SPECS[this.grenadeKind];
    const cooked = spec.cookable ? this.cookTimer : 0;
    const velocity = this.cameraForward().multiplyScalar(speed);
    const projectile = new GrenadeProjectile(spec, this.grenadeOrigin(), velocity, cooked);
    const mesh = new THREE.Mesh(
      this.grenadeGeometry,
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.55 }),
    );
    mesh.castShadow = true;
    mesh.position.copy(projectile.position);
    this.scene.add(mesh);
    this.thrown.push({ projectile, mesh });
    this.grenadeCounts[this.grenadeKind] -= 1;
    this.cooking = false;
    this.cookTimer = 0;
    this.sounds.throwWhoosh();
    this.viewModel.fire();
  }

  private readonly grenadeRaycast: SurfaceRaycast = (origin, dir, maxDist) => {
    const hit = this.castRayWithNormal(origin, dir, maxDist, this.player.body);
    if (!hit || !hit.normal) return null;
    return { distance: hitToi(hit), normal: hit.normal };
  };

  private updateGrenades(dt: number): void {
    const kept: ThrownGrenade[] = [];
    for (const item of this.thrown) {
      const exploded = item.projectile.update(dt, this.grenadeRaycast);
      item.mesh.position.copy(item.projectile.position);
      if (item.projectile.bounced) {
        const { pan, distance } = this.panAndDistance(item.projectile.position);
        this.sounds.bounce(pan, distance);
      }
      if (!exploded) {
        kept.push(item);
        continue;
      }
      this.scene.remove(item.mesh);
      (item.mesh.material as THREE.Material).dispose();
      this.detonate(item.projectile);
    }
    this.thrown = kept;
  }

  private detonate(projectile: GrenadeProjectile): void {
    const spec = projectile.spec;
    const point = projectile.position.clone();
    const { pan, distance } = this.panAndDistance(point);

    if (spec.kind === 'frag') {
      this.effects.explosion(point, spec.radius * 0.55);
      this.sounds.explosion(pan, distance);
      this.applyExplosionDamage(spec, point);
    } else if (spec.kind === 'smoke') {
      this.effects.smokeCloud(point, spec.radius, spec.effectDurationS);
      this.sounds.smokePop(pan, distance);
      this.smokeZones.push({
        pos: point,
        radius: spec.radius,
        until: this.elapsed + spec.effectDurationS,
      });
    } else if (spec.kind === 'flash') {
      this.effects.explosion(point, 1.6);
      this.sounds.explosion(pan, distance + 25);
      this.applyFlash(spec, point);
    } else {
      // 焼夷: 接地点に火災を残す
      const down = this.castRayWithNormal(point, new THREE.Vector3(0, -1, 0), 6, this.player.body);
      const groundY = down ? point.y - hitToi(down) : point.y;
      const ground = new THREE.Vector3(point.x, groundY + 0.02, point.z);
      this.effects.explosion(point, 1.4);
      this.effects.firePatch(ground, spec.radius, spec.effectDurationS);
      this.sounds.explosion(pan, distance + 15);
      this.firePatches.push({
        pos: ground,
        radius: spec.radius,
        until: this.elapsed + spec.effectDurationS,
        tickIn: 0,
        crackleIn: 0,
      });
    }
  }

  // 爆心からの視線が通っているかを判定する。遮蔽物に隠れていれば爆風は届かない
  private explosionReaches(point: THREE.Vector3, target: THREE.Vector3): boolean {
    const dir = target.clone().sub(point);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    const hit = this.castRay(point, dir, dist - 0.15, null);
    if (!hit) return true;
    const tag = this.tags.get(hit.collider.handle);
    return tag?.kind !== 'world';
  }

  private applyExplosionDamage(spec: (typeof GRENADE_SPECS)['frag'], point: THREE.Vector3): void {
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const center = bot.position;
      const dist = Math.min(center.distanceTo(point), bot.headPosition().distanceTo(point));
      const damage = explosionDamage(spec, dist);
      if (damage <= 0 || !this.explosionReaches(point, center)) continue;
      this.applyBotDamage(bot, damage, center, false, spec.name);
    }

    if (this.player.alive) {
      const dist = this.player.position.distanceTo(point);
      const damage = explosionDamage(spec, dist);
      if (damage > 0 && this.explosionReaches(point, this.player.position)) {
        const died = this.player.takeDamage(damage);
        // 至近爆発は耳鳴り(世界の音が一瞬遠のく)
        if (dist < 6) this.sounds.tinnitus((6 - dist) / 6);
        this.tookDamage = true;
        this.haptic(110, 0.5, 0.55);
        this.addShake(Math.min(0.7, damage * 0.01));
        this.addUltCharge(damage * ULT_ON_DAMAGE_PER_HP);
        this.incoming.push(this.incomingAngle(point));
        this.sounds.hurt();
        if (died) {
          this.feed.push({
            killer: PLAYER_NAME,
            victim: PLAYER_NAME,
            weapon: spec.name,
            headshot: false,
          });
          this.sounds.death();
          this.notePlayerDeath();
        }
      }
    }
  }

  private applyFlash(spec: (typeof GRENADE_SPECS)['flash'], point: THREE.Vector3): void {
    if (this.player.alive) {
      const eye = this.player.eyePosition;
      const toFlash = point.clone().sub(eye);
      const dist = toFlash.length();
      const viewDot = this.cameraForward().dot(toFlash.normalize());
      const occluded = !this.explosionReaches(point, eye);
      const intensity = flashIntensity(dist, spec.radius, viewDot, occluded);
      if (intensity > 0) {
        this.whiteout = Math.max(this.whiteout, intensity);
        this.sounds.flashRing(intensity);
      }
    }
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const head = bot.headPosition();
      const dist = head.distanceTo(point);
      if (dist >= spec.radius || !this.explosionReaches(point, head)) continue;
      // BOTは常に爆心の方を向いていたとみなして全力で食らわせる
      const intensity = flashIntensity(dist, spec.radius, 1, false);
      bot.blind = Math.max(bot.blind, spec.effectDurationS * intensity);
    }
  }

  private updateFirePatches(dt: number): void {
    const kept: FirePatch[] = [];
    for (const patch of this.firePatches) {
      if (patch.until <= this.elapsed) continue;
      patch.crackleIn -= dt;
      if (patch.crackleIn <= 0) {
        const { pan, distance } = this.panAndDistance(patch.pos);
        this.sounds.fireCrackle(pan, distance);
        patch.crackleIn = 0.12 + this.rand() * 0.2;
      }

      patch.tickIn -= dt;
      if (patch.tickIn <= 0) {
        patch.tickIn = FIRE_TICK_S;
        const spec = GRENADE_SPECS.incendiary;
        const tickDamage = spec.maxDamage * FIRE_TICK_S;
        for (const bot of this.bots) {
          if (bot.alive && bot.team !== PLAYER_TEAM && this.insidePatch(patch, bot.position)) {
            this.applyBotDamage(bot, tickDamage, bot.position, false, spec.name);
          }
        }
        if (this.player.alive && this.insidePatch(patch, this.player.position)) {
          const died = this.player.takeDamage(tickDamage);
          this.tookDamage = true;
          this.haptic(70, 0.35, 0.3); // 燃焼ダメージは弱く連続的に
          this.addShake(0.06);
          this.addUltCharge(tickDamage * ULT_ON_DAMAGE_PER_HP);
          this.incoming.push(this.incomingAngle(patch.pos));
          this.sounds.hurt();
          if (died) {
            this.feed.push({
              killer: PLAYER_NAME,
              victim: PLAYER_NAME,
              weapon: spec.name,
              headshot: false,
            });
            this.sounds.death();
            this.notePlayerDeath();
          }
        }
      }
      kept.push(patch);
    }
    this.firePatches = kept;
  }

  private insidePatch(patch: FirePatch, position: THREE.Vector3): boolean {
    const dx = position.x - patch.pos.x;
    const dz = position.z - patch.pos.z;
    const dy = position.y - patch.pos.y;
    return Math.hypot(dx, dz) < patch.radius + 0.4 && dy > -1 && dy < 2.2;
  }

  private panAndDistance(source: THREE.Vector3): { pan: number; distance: number } {
    const eye = this.player.eyePosition;
    const toSource = source.clone().sub(eye);
    const distance = toSource.length();
    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = THREE.MathUtils.clamp(toSource.normalize().dot(rightDir), -1, 1);
    return { pan, distance };
  }

  private incomingAngle(source: THREE.Vector3): number {
    const eye = this.player.eyePosition;
    const flat = source.clone().sub(eye).setY(0).normalize();
    const forwardFlat = this.cameraForward().setY(0).normalize();
    const cross = forwardFlat.x * flat.z - forwardFlat.z * flat.x;
    return Math.atan2(cross, forwardFlat.dot(flat));
  }

  // 射線は yaw/pitch から直接導出する。カメラ姿勢(シェイクやリーンのロール)に
  // 依存させないことで、カメラシェイク中でも弾はクロスヘアどおりに飛ぶ
  private cameraForward(): THREE.Vector3 {
    const cp = Math.cos(this.player.pitch);
    return new THREE.Vector3(
      -Math.sin(this.player.yaw) * cp,
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * cp,
    );
  }

  // ゲームパッド使用時のみ触覚フィードバック。input.vibrate は設定offで自動的に無音
  private haptic(durationMs: number, weak: number, strong: number): void {
    if (this.input.lastDevice === 'gamepad') this.input.vibrate(durationMs, weak, strong);
  }

  private fireShot(spreadRad: number): void {
    if (!this.player.alive) return;
    this.player.shotsFired += 1;
    this.haptic(55, 0.15, 0.4); // 発砲のリコイル振動(トリガー1引きにつき1回)
    const weapon = this.activeWeapon;
    const origin = this.player.eyePosition;
    // スコープ覗き込み中は銃が引っ込んで隠れるため、トレーサーは視線基点から出す
    const scopedShot = weapon.def.scope === true && weapon.adsProgress > 0.85;
    const muzzle = scopedShot
      ? origin.clone().addScaledVector(this.cameraForward(), 0.4)
      : this.viewModel.muzzleWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const pelletSpreadRad = weapon.def.pelletSpreadDeg * DEG;

    // ペレット武器は1発の命中・部位を集約して扱う
    const results = new Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>();

    // 基準方向を1回だけ算出。バレットマグネティズムで対象が極近ならわずかに寄せる。
    // 曲げ角は強度に加えて距離でも減衰させ、遠距離での過剰な自動命中を防ぐ。
    // スコープ覗き込み中(クイックスコープ成立後)はやや広く強く吸い込む(BO2の当て感)
    const magConeDeg = scopedShot ? BULLET_MAG_CONE_SCOPED_DEG : BULLET_MAG_CONE_DEG;
    const magMaxDeg = scopedShot ? BULLET_MAG_MAX_SCOPED_DEG : BULLET_MAG_MAX_DEG;
    let base = this.cameraForward();
    if (this.aimAssistTargetDir && this.aimAssistTargetAngle <= magConeDeg * DEG) {
      const maxBend =
        magMaxDeg *
        DEG *
        this.settings.aimAssistStrength *
        distanceFactor(this.aimAssistTargetDist, weapon.def.range);
      const frac = bulletBendFraction(this.aimAssistTargetAngle, maxBend);
      if (frac > 0) base = base.lerp(this.aimAssistTargetDir, frac).normalize();
    }

    for (let i = 0; i < weapon.def.pellets; i += 1) {
      const offset = coneOffset(spreadRad + pelletSpreadRad, Math.random);
      const dir = base
        .clone()
        .addScaledVector(right, Math.tan(offset.yaw))
        .addScaledVector(up, Math.tan(offset.pitch))
        .normalize();
      this.tracePellet(origin, dir, muzzle, results);
    }

    let kills = 0;
    for (const [bot, result] of results) {
      this.player.shotsHit += 1;
      if (result.headshot) this.player.headshots += 1;
      if (
        this.applyBotDamage(
          bot,
          result.damage,
          result.point,
          result.headshot,
          weapon.def.name,
          true,
          weapon.def.scope === true,
          weapon.def.class,
        )
      ) {
        kills += 1;
      }
    }
    // 1トリガーで2体以上 = コラテラル(ショットガンのペレット拡散でのみ成立)
    if (kills >= 2) {
      const out: MedalEvent[] = [];
      this.tracker.onCollateral(kills, out);
      this.emitMedals(out);
    }
  }

  // 1本の弾道を追う。世界ジオメトリに当たった場合は貫通力の範囲で1枚だけ抜ける
  private tracePellet(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    muzzle: THREE.Vector3,
    results: Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>,
  ): void {
    const weapon = this.activeWeapon;
    let from = origin.clone();
    let tracerFrom = muzzle;
    let remainingRange = weapon.def.range;
    let traveled = 0;
    let damageFactor = 1;

    for (let leg = 0; leg < 2; leg += 1) {
      const hit = this.castRayWithNormal(from, dir, remainingRange, this.player.body);
      const end = hit
        ? from.clone().addScaledVector(dir, hitToi(hit))
        : from.clone().addScaledVector(dir, remainingRange);
      this.effects.tracer(tracerFrom, end, weapon.def.tracerColor);
      if (!hit) return;

      const tag = this.tags.get(hit.collider.handle);
      if (tag?.kind === 'bot' && tag.bot.alive) {
        // 味方への誤射はダメージなしで弾が止まる
        if (tag.bot.team === PLAYER_TEAM) return;
        const distance = traveled + hitToi(hit);
        let part: HitPart = tag.part;
        // 高さによる部位再分類は人型のみ。戦車/ドローン等は車体下部が「脚」扱いで
        // 減衰しないようbody満額を維持する(弱点=headコライダーは別枠で成立)
        if (part === 'body' && tag.bot.kind === 'humanoid') {
          part = partFromHitHeight(end.y - tag.bot.position.y, HIP_OFFSET_Y);
        }
        const base = damageAtDistance(weapon.def.damage, distance, weapon.def.falloff);
        const damage = base * partMultiplier(part, weapon.def.headshotMultiplier) * damageFactor;
        const entry = results.get(tag.bot) ?? {
          damage: 0,
          headshot: false,
          point: end,
        };
        entry.damage += damage;
        entry.headshot = entry.headshot || part === 'head';
        entry.point = end;
        results.set(tag.bot, entry);
        return;
      }

      if (tag?.kind !== 'world' || !hit.normal) return;
      this.effects.impact(end, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z));
      // 着弾の材質音: 法線が上向きなら床、それ以外は壁(遮蔽物)の材質で鳴らす
      const ip = this.panAndDistance(end);
      this.sounds.impactSurface(hit.normal.y > 0.65 ? 'floor' : 'wall', ip.pan, ip.distance);

      if (leg > 0 || weapon.def.penetrationM <= 0) return;

      // 壁の厚みを反対側から測る。貫通力以下なら減衰した弾が抜ける
      const maxDepth = weapon.def.penetrationM;
      const probe = end.clone().addScaledVector(dir, maxDepth);
      const back = this.castRayWithNormal(
        probe,
        dir.clone().negate(),
        maxDepth - 0.005,
        this.player.body,
      );
      if (!back || !back.normal) return;
      const thickness = maxDepth - hitToi(back);
      const factor = penetrationFactor(thickness, maxDepth);
      if (factor <= 0) return;

      const exit = probe.clone().addScaledVector(dir, -hitToi(back));
      this.effects.impact(exit, new THREE.Vector3(back.normal.x, back.normal.y, back.normal.z));
      damageFactor *= factor;
      traveled += hitToi(hit) + thickness;
      remainingRange = Math.max(0, remainingRange - hitToi(hit) - thickness);
      from = exit.clone().addScaledVector(dir, 0.01);
      tracerFrom = from.clone();
    }
  }

  // 戻り値: このダメージでBOTが倒れたか(コラテラル集計に使う)
  private applyBotDamage(
    bot: Bot,
    damage: number,
    point: THREE.Vector3,
    headshot: boolean,
    weaponName: string,
    grantUlt = true,
    scopeKill = false,
    srcClass: WeaponClass | null = null,
  ): boolean {
    // takeDamage前の満タン判定(one-shotメダル用)
    const fullHp = bot.hp >= bot.maxHp;
    // painDir: humanoidが被弾方向へ振り向く材料(bot→射手=プレイヤー)。tank/turret/droneは
    // 全周維持なので影響なし、方向不明経路も takeDamage 側で全周フォールバック
    const died = bot.takeDamage(damage, this.player.eyePosition.clone().sub(bot.position));
    // ゾンビ経済(最小): 命中10 / キル60 / ヘッドショットキル100。HUDの zombiePoints へ
    if (bot.kind === 'zombie') {
      if (died) {
        this.zombieKills += 1;
        this.zombiePoints += headshot ? 100 : 60;
      } else {
        this.zombiePoints += 10;
      }
    }
    this.effects.hitPuff(point);
    // ヘッドショットは専用の金色フレアと微カメラキックで差別化
    if (headshot) {
      this.effects.headshotFlare(point);
      this.addShake(0.05);
      this.scoreEvents.push({ label: 'ヘッドショット', xp: 25 });
    }
    // ヒットストップ(命中の手応え)。連射で延長せず上限固定・省モーション時は半減
    const freeze = this.settings.reduceMotion ? (died ? 0.03 : 0.02) : died ? 0.06 : 0.04;
    this.hitFreezeS = Math.max(this.hitFreezeS, freeze);
    this.damageNumbers.push({
      amount: Math.round(damage),
      world: point.clone(),
      kind: died ? 'kill' : headshot ? 'head' : 'body',
    });
    if (died) {
      this.haptic(150, 0.5, 0.75); // キル確定の手応え
      this.player.kills += 1;
      this.player.streak += 1;
      if (this.mission && bot.team === ENEMY_TEAM) this.missionKills += 1;
      this.bestStreak = Math.max(this.bestStreak, this.player.streak);
      this.playerWeaponKills[weaponName] = (this.playerWeaponKills[weaponName] ?? 0) + 1;
      this.addKillScore(PLAYER_TEAM);
      this.hits.push(scopeKill ? 'snipe' : 'kill');
      this.feed.push({ killer: PLAYER_NAME, victim: bot.name, weapon: weaponName, headshot });
      this.scoreEvents.push({ label: 'キル', xp: 100 });
      if (scopeKill) this.sounds.snipeKill();
      else this.sounds.kill(1 + Math.min(this.player.streak, 5) * 0.06);
      // 連続キルのアナウンサー(マイルストーンのみ。HUDのバナーと閾値を揃える)
      const callouts: Record<number, string> = {
        3: 'TRIPLE KILL',
        4: 'MULTI KILL',
        5: 'RAMPAGE',
        7: 'UNSTOPPABLE',
        10: 'GODLIKE',
      };
      const callout = callouts[this.player.streak];
      if (callout) this.sounds.announceStreak(callout, this.settings.announcerVolume);
      this.botDeathFx(bot);
      if (grantUlt) this.addUltCharge(ULT_ON_KILL);

      // ── メダル検出(銃キルのみ scope/距離系を有効化。grenade/melee/slam は srcClass=null)──
      const isGun = srcClass !== null;
      const toBot = this.player.position.clone().sub(bot.position).setY(0);
      const fromBehind = toBot.dot(bot.facing()) < -0.3;
      const ctx: KillCtx = {
        victimName: bot.name,
        victimId: bot.uid,
        headshot,
        weaponName,
        weaponClass: srcClass ?? 'shotgun', // 非銃キルは shotgun 扱い=LONGSHOT無効
        scopeWeapon: isGun && this.activeWeapon.def.scope === true,
        adsProgress: isGun ? this.activeWeapon.adsProgress : 0,
        adsAgeMs: performance.now() - this.lastAdsStartMs,
        distM: this.player.eyePosition.distanceTo(bot.position),
        victimFullHp: fullHp,
        bulletsThisShot: this.activeWeapon.def.pellets,
        fromBehind,
        grounded: this.player.grounded,
        sliding: this.player.sliding,
        wallRunning: this.player.wallRunning,
        ultActive: this.ultActive > 0,
        streak: this.player.streak,
      };
      const out: MedalEvent[] = [];
      this.tracker.onKill(ctx, out);
      this.emitMedals(out);
    } else {
      this.hits.push(headshot ? 'head' : 'hit');
      const scoped = this.activeWeapon.def.scope === true && this.activeWeapon.adsProgress > 0.5;
      if (headshot) this.sounds.headshot();
      else if (scoped) this.sounds.scopeBodyHit();
      else this.sounds.hit(1 + THREE.MathUtils.clamp((damage - 12) / 90, 0, 0.45));
    }
    return died;
  }

  // メダルイベントを消費: HUD用に積み、XP累計・スコアトースト・アナウンサーを処理する
  private emitMedals(events: MedalEvent[]): void {
    if (events.length === 0) return;
    const tierLevel: Record<MedalTier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
    let top: MedalEvent | null = null;
    for (const m of events) {
      this.medals.push(m);
      // ヘッドショットはフィードのアイコン専用。XP(headshots×25で別計上)もトーストも
      // アナウンスも対象外にする(headshotはここでは積まない=二重計上を避ける)
      if (m.id === 'headshot') continue;
      this.medalXpTotal += m.xp;
      this.scoreEvents.push({ label: m.name, xp: m.xp });
      if (!top || medalRank(m.id) > medalRank(top.id)) top = m;
    }
    if (top) {
      const vol = this.settings.announcerVolume;
      // 初解放はファンファーレ+読み上げ、以降はWebAudioスティングのみ(announceStreakと非衝突)
      if (top.firstUnlock) this.sounds.announceUnlock(top.name, vol);
      else this.sounds.announceMedal(tierLevel[top.tier], vol);
    }
  }

  // 視線の途中にスモークがあれば互いに見えない
  private smokeBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const zone of this.smokeZones) {
      if (segmentDistance(a, b, zone.pos) < zone.radius * 0.75) return true;
    }
    return false;
  }

  private updateBots(dt: number): void {
    // 足音: スプリント/スライド中のプレイヤーが至近にいると敵が振り向く。
    // 歩き/しゃがみは無音なので、静かに近づけば背後を取れる
    const noisy = this.player.alive && (this.player.sprinting || this.player.sliding);
    const playerPos = this.player.position;
    this.botFrameIdx = (this.botFrameIdx + 1) % 3; // 今フレームにLOSを走らせる観測者バケット
    for (const bot of this.bots) {
      if (
        noisy &&
        bot.alive &&
        bot.team !== PLAYER_TEAM &&
        bot.position.distanceTo(playerPos) < FOOTSTEP_HEAR_DIST
      ) {
        bot.alert = Math.max(bot.alert, 1.5);
        bot.alertPos = playerPos.clone();
      }
      let targetEye: THREE.Vector3 | null = null;
      if (bot.alive) {
        if (bot.kind === 'zombie') {
          // 近接群れ: LOSレイを一切撃たず、生存プレイヤーを直接ターゲット(0 rays / spot-time無し)
          targetEye = this.player.alive ? this.player.eyePosition : null;
        } else if (bot.blind <= 0) {
          targetEye = this.perceive(bot, dt); // spot-time知覚FSMで積分してから供給
        }
      }
      bot.update(dt, {
        targetEye,
        objective: bot.alive ? this.objectiveFor(bot) : null,
        tuning: bot.tuning,
        rand: this.rand,
        onShoot: (origin, dir) => this.botShoot(bot, origin, dir),
        onMelee: (b) => this.zombieMelee(b),
      });
    }
  }

  // spot-time 知覚FSM。生の可視性(距離+コーン+LOS)をゲートに calcSpotRate(raycast無し)で
  // 発見メータを毎フレーム積分し、0.9でSPOTTED(=combat)して初めて targetEye を供給する。
  // これにより「高速で視界の端を横切っただけでは即バレしない」を保証する(下の数値参照)。
  private perceive(bot: Bot, dt: number): THREE.Vector3 | null {
    const cands = this.nearestConeCandidates(bot); // 安価な距離+コーン前段ゲート(ray無し)
    let cand: SpotCand | null = null;
    let rawVisible = false;
    if (cands.length > 0) {
      // 前回の対象がまだコーン内なら継続、無ければ最至近。LOSは uid%3 バケットで間引く
      const cached = cands.find((c) => c.uid === bot.lastCandidateUid) ?? null;
      const runLos = bot.uid % 3 === this.botFrameIdx || cached === null;
      if (runLos) {
        // 近い順にLOSを試し、最初に通った候補を採用(遮蔽された最至近に固着しない)
        for (const c of cands) {
          if (this.hasLineOfSight(bot, c)) {
            cand = c;
            rawVisible = true;
            break;
          }
        }
        if (cand === null) cand = cached ?? cands[0]!; // 全て遮蔽=対象保持(rawVisible=false)
        bot.lastRawVisible = rawVisible;
        if (rawVisible) bot.lastTargetEye = cand.eye.clone();
      } else {
        cand = cached; // 非担当フレームは前回可視候補を再利用
        rawVisible = bot.lastRawVisible;
      }
      if (cand && bot.lastCandidateUid !== cand.uid) {
        bot.spotAwareness *= 0.4; // 対象切替で覚醒を移譲しない(FFA/TDMの千里眼防止)
        bot.lastCandidateUid = cand.uid;
      }
    } else {
      bot.lastRawVisible = false;
    }

    if (rawVisible && cand) {
      bot.spotAwareness = Math.min(1.3, bot.spotAwareness + this.calcSpotRate(bot, cand) * dt);
      bot.lkp = cand.eye.clone();
      bot.engageGrace = ENGAGE_GRACE_S;
      // 発見途中(SPOTTED未満)は脅威方向へ振り向かせて自然に気づかせる(視線が外れて発見が止まらない)
      if (bot.spotAwareness < SPOTTED_TH && bot.alert <= 0) {
        bot.alert = 1.0;
        bot.alertPos = cand.eye.clone();
      }
    } else {
      bot.spotAwareness = Math.max(0, bot.spotAwareness - SPOT_DECAY * dt);
      bot.engageGrace = Math.max(0, bot.engageGrace - dt);
    }

    // FSM遷移
    if (bot.spotAwareness >= SPOTTED_TH) bot.aiState = 'combat';
    else if (bot.spotAwareness <= LOST_TH) bot.aiState = 'patrol';
    else if (bot.aiState === 'combat') bot.aiState = 'search';

    // targetEye供給: combat かつ 生可視 → 実位置(壁ハック防止)。
    // 見失い直後は engageGrace の間だけ lkp へ撃ち/寄り続ける(自然な追撃、千里眼にはしない)
    if (bot.aiState === 'combat' && rawVisible && cand) return cand.eye;
    if (bot.aiState !== 'patrol' && bot.engageGrace > 0 && bot.lkp) return bot.lkp;
    return null;
  }

  // 距離+コーンだけで最も近い敵対候補を選ぶ(ray無し)。painDir扇形はhumanoid限定、
  // tank/turret/droneは従来どおりpain全周(R8ボスが背面射撃へ反撃できる非回帰保証)。
  private nearestConeCandidates(bot: Bot): SpotCand[] {
    const head = bot.headPosition();
    const facing = bot.facing();
    const viewDist = bot.tuning.viewDistM;
    const cands: SpotCand[] = [];
    const consider = (eye: THREE.Vector3, isPlayer: boolean, uid: number): void => {
      const dx = eye.x - head.x;
      const dy = eye.y - head.y;
      const dz = eye.z - head.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= viewDist || dist < 1e-3) return;
      const inv = 1 / dist;
      const dot = facing.x * dx * inv + facing.y * dy * inv + facing.z * dz * inv;
      let ok: boolean;
      if (bot.pain > 0) {
        ok =
          bot.kind === 'humanoid' && bot.painDir
            ? bot.painDir.x * dx * inv + bot.painDir.y * dy * inv + bot.painDir.z * dz * inv >
              PAIN_SECTOR_COS
            : true; // tank/turret/drone or 方向不明 = 全周(無反応化を絶対に避ける)
      } else {
        ok = dot > (bot.alert > 0 ? BOT_ALERT_CONE_COS : BOT_VIEW_CONE_COS);
      }
      if (!ok) return;
      cands.push({ eye, dist, coneDot: dot, isPlayer, uid });
    };
    if (this.player.alive && bot.team !== PLAYER_TEAM) {
      consider(this.player.eyePosition, true, PLAYER_UID);
    }
    for (const other of this.bots) {
      if (other === bot || !other.alive || other.team === bot.team || other.kind === 'zombie') continue;
      consider(other.headPosition(), false, other.uid);
    }
    // R16修正: 最至近だけにLOSを引くと遮蔽物越しの最至近に固着し露出した遠方敵を無視する。
    // 近い順の上位3候補を返し、perceive が近い順にLOSを試して最初に通った候補を採る
    cands.sort((a, b) => a.dist - b.dist);
    return cands.slice(0, 3);
  }

  // 候補への遮蔽レイ1本(距離/コーンは呼び出し側で通過済み)。スモークも遮る。
  private hasLineOfSight(bot: Bot, cand: SpotCand): boolean {
    const head = bot.headPosition();
    if (this.smokeBlocks(head, cand.eye)) return false;
    const to = cand.eye.clone().sub(head);
    const dist = to.length();
    if (dist < 1e-3) return true;
    const dir = to.multiplyScalar(1 / dist);
    const hit = this.castRay(head, dir, dist - 0.2, bot.body);
    if (hit === null) return true;
    const tag = this.tags.get(hit.collider.handle);
    if (cand.isPlayer) return tag?.kind === 'player';
    return tag?.kind === 'bot' && tag.bot.uid === cand.uid;
  }

  // 発見速度(/s)。raycast無し=毎フレーム安価に呼べる。base=1/spotTimeSを、距離・視野中心度・
  // プレイヤー移動速度・霧/暗所で減衰し、銃声(alert)/被弾(pain)で加速する。
  private calcSpotRate(bot: Bot, cand: SpotCand): number {
    const base = 1 / Math.max(0.2, bot.tuning.spotTimeS);
    const distFactor = THREE.MathUtils.clamp(1 - cand.dist / Math.max(1, bot.tuning.viewDistM), 0.1, 1);
    // 視野中心度: 中心(cos22°)で1、周辺(cos75°)で0.25へlerp、外は0(alert/pain中のみ0.35拾う)
    let coneFactor: number;
    if (cand.coneDot >= BOT_CENTRAL_COS) coneFactor = 1;
    else if (cand.coneDot > BOT_VIEW_CONE_COS)
      coneFactor = THREE.MathUtils.mapLinear(cand.coneDot, BOT_VIEW_CONE_COS, BOT_CENTRAL_COS, 0.25, 1);
    else coneFactor = bot.alert > 0 || bot.pain > 0 ? 0.35 : 0;
    const moveFactor = cand.isPlayer ? this.playerSpotMoveFactor() : 1;
    // R16修正: 係数40は過大で中距離でも敵が実質盲目化(撃たれるまで撃ち返さない)する重大回帰だった。
    // 距離減衰は distFactor が担うので fogFactor は霧/暗所の緩やかな追加減衰に留め、下限0.35で
    // 中距離(10〜25m)を数秒で発見できるようにする(視覚フォグとの1000倍乖離を解消)
    const fogFactor =
      Math.max(0.35, Math.exp(-cand.dist * this.stageFogDensity * 2.5)) * Math.max(0.5, this.stageAmbient);
    let rate = base * distFactor * coneFactor * moveFactor * fogFactor;
    if (bot.alert > 0) rate *= ALERT_SPOT_MUL; // 銃声を聞いた=戦闘文脈では素早く発見
    if (bot.pain > 0) rate = Math.max(rate, base * PAIN_SPOT_MUL); // 撃たれた=即発見に近づく
    return rate;
  }

  // プレイヤーの移動状態で発見速度が変わる。高速移動ほど速く見つかるが「即」ではない
  // (積分が数フレーム要るため)。静止/しゃがみは遅く=背後の忍び寄りが成立する。
  private playerSpotMoveFactor(): number {
    if (!this.player.alive) return 1;
    if (this.player.sliding) return 2.0;
    if (this.player.wallRunning) return 1.5;
    if (this.player.sprinting) return 1.6;
    const moving = this.player.speed > 0.5;
    if (this.player.crouching) return moving ? 0.4 : 0.12;
    return moving ? 1.0 : 0.18;
  }

  // エイムアシスト対象: 視認できる敵のうち、照準に最も近い(なす角が最小の)1体。
  // 索敵円錐・射程・スモーク・遮蔽をすべて満たすものだけを返す
  // 敵ごとに頭/胸/腰/脚の複数候補点を生成し、照準に角度的に最も近い「可視」部位へ吸着する。
  // 胴中心固定の旧方式を廃し、狙った部位(頭含む)に寄るのでヘッドショットが取りやすい。
  private aimAssistTarget(
    maxRange: number,
  ): {
    dir: THREE.Vector3;
    yaw: number;
    pitch: number;
    angle: number;
    dist: number;
    bot: Bot;
    part: AimPart;
  } | null {
    const eye = this.player.eyePosition;
    const forward = this.cameraForward();
    let best: {
      dir: THREE.Vector3;
      yaw: number;
      pitch: number;
      angle: number;
      dist: number;
      bot: Bot;
      part: AimPart;
    } | null = null;
    // 索敵はスローダウン用の広円錐(10°)まで。微プルは呼び出し側が5°で別途ゲートする
    let bestAngle = SLOWDOWN_CONE_DEG * DEG;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const base = bot.position; // カプセル中心(新規ベクトル)
      // 機体種に合った部位候補で、角度の近い順に可視が取れるまで走査=最近接の可視部位
      const parts =
        bot.kind === 'drone'
          ? DRONE_AIM_PARTS
          : bot.kind === 'tank'
            ? TANK_AIM_PARTS
            : bot.kind === 'turret'
              ? TURRET_AIM_PARTS
              : AIM_PARTS;
      const ranked = rankAimPoints(eye, forward, base, parts, maxRange);
      for (const cand of ranked) {
        // rankedはeff(角度-頭バイアス)順なのでangleは単調でない。より近い部位を
        // 取り逃さないよう、円錐外の候補はbreakせずcontinueでスキップする
        if (cand.angle >= bestAngle) continue;
        const pt = this._aimScratch.set(cand.point.x, cand.point.y, cand.point.z);
        if (this.smokeBlocks(eye, pt)) continue;
        if (!this.playerCanSee(eye, pt, bot)) continue;
        bestAngle = cand.angle;
        best = {
          dir: new THREE.Vector3(cand.dir.x, cand.dir.y, cand.dir.z),
          yaw: Math.atan2(-cand.dir.x, -cand.dir.z),
          pitch: Math.asin(THREE.MathUtils.clamp(cand.dir.y, -1, 1)),
          angle: cand.angle,
          dist: cand.dist,
          bot,
          part: cand.part,
        };
        break; // このbotの最近接“可視”部位が確定
      }
    }
    return best;
  }

  // プレイヤー視点からpointが見えるか(botCanSeeのプレイヤー版)。
  // 自分のコライダーは除外し、最初に当たったのが対象botなら可視
  private playerCanSee(eye: THREE.Vector3, point: THREE.Vector3, bot: Bot): boolean {
    const to = point.clone().sub(eye);
    const dist = to.length();
    if (dist < 0.2) return true;
    const dir = to.multiplyScalar(1 / dist);
    const hit = this.castRay(eye, dir, dist - 0.2, this.player.body);
    if (hit === null) return true;
    const tag = this.tags.get(hit.collider.handle);
    return tag?.kind === 'bot' && tag.bot === bot;
  }

  // ドミネーションでは自チームが持っていない最寄り拠点へ、
  // TDMの味方BOTはプレイヤーの近くへ向かわせる
  private objectiveFor(bot: Bot): THREE.Vector3 | null {
    if (this.domination) {
      let best: THREE.Vector3 | null = null;
      let bestDist = Infinity;
      for (const zone of this.domination.zones) {
        if (zone.owner === bot.team && !zone.contested) continue;
        const center = this.zoneCenters.get(zone.id);
        if (!center) continue;
        const dist = bot.position.distanceTo(center);
        if (dist < bestDist) {
          bestDist = dist;
          best = center;
        }
      }
      return best;
    }
    if (this.config.mode === 'tdm' && bot.team === PLAYER_TEAM && this.player.alive) {
      return this.player.position;
    }
    return null;
  }

  private botShoot(bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const tuning = bot.tuning;
    // 射程は索敵距離に合わせる(elite/bossが遠距離で見えても弾が届かない不整合を解消)
    const range = Math.max(BOT_VIEW_DISTANCE, tuning.viewDistM);
    const hit = this.castRay(origin, dir, range, bot.body);
    const end = hit
      ? origin.clone().addScaledVector(dir, hitToi(hit))
      : origin.clone().addScaledVector(dir, range);
    this.effects.tracer(
      origin,
      end,
      bot.team === PLAYER_TEAM ? this.colors.allyTracer : this.colors.enemyTracer,
    );

    // 発砲音は方向と距離をつけて鳴らす。敵弾のみ遮蔽レイ1本で「壁越しのこもり」を判定
    const { pan, distance } = this.panAndDistance(origin);
    let occluded = false;
    if (bot.team !== PLAYER_TEAM && this.player.alive) {
      const eye = this.player.eyePosition;
      const toEar = eye.clone().sub(origin);
      const earDist = toEar.length();
      if (earDist > 1) {
        const block = this.castRay(origin, toEar.normalize(), earDist - 0.4, bot.body);
        // 世界ジオメトリ(壁/障害物)に遮られている時だけこもらせる
        if (block) {
          const bt = this.tags.get(block.collider.handle);
          occluded = bt === undefined || bt.kind === 'world';
        }
      }
      // 弾のwhizz: 頭部至近(2.5m)を通過した弾のかすめ音(超近接2m以内の発砲は除外)。
      // プレイヤーに命中した弾は被弾音が鳴るのでニアミス音は重ねない
      const hitPlayer = hit ? this.tags.get(hit.collider.handle)?.kind === 'player' : false;
      const segLen = end.distanceTo(origin);
      const ca = closestApproach(origin, dir, segLen, eye);
      if (!hitPlayer && ca.dist < 2.5 && ca.along > 2) {
        const at = origin.clone().addScaledVector(dir, ca.along);
        const wp = this.panAndDistance(at);
        this.sounds.bulletWhizz(wp.pan, 1 - ca.dist / 2.5);
      }
    }
    this.sounds.enemyShot(pan, distance, occluded);

    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    const damage = damageAtDistance(tuning.damage, hitToi(hit), BOT_FALLOFF);

    // 戦車の主砲: 着弾点で炸裂し、直撃しなくても至近のプレイヤーへスプラッシュが入る
    if (bot.kind === 'tank' && bot.team !== PLAYER_TEAM) {
      this.effects.explosion(end, 1.5);
      const boom = this.panAndDistance(end);
      this.sounds.explosion(boom.pan, boom.distance);
      const splashD = this.player.alive ? this.player.position.distanceTo(end) : Infinity;
      if (splashD < 3.2 && tag?.kind !== 'player') {
        const died = this.player.takeDamage(14);
        this.tookDamage = true;
        this.addShake(0.25);
        this.addUltCharge(14 * ULT_ON_DAMAGE_PER_HP);
        this.incoming.push(this.incomingAngle(end));
        this.sounds.hurt();
        // スプラッシュ死も直撃と同じ死亡処理(キルカメラ/死亡音/フィード/キル加算)
        if (died) {
          bot.kills += 1;
          this.addKillScore(bot.team);
          this.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: '戦車砲', headshot: false });
          this.sounds.death();
          this.notePlayerDeath(bot);
        }
      }
    }

    if (tag?.kind === 'player' && this.player.alive) {
      // 味方の流れ弾はダメージにしない
      if (bot.team === PLAYER_TEAM) return;
      const died = this.player.takeDamage(damage);
      this.tookDamage = true;
      this.haptic(110, 0.5, 0.55);
      this.addShake(0.16);
      this.addUltCharge(damage * ULT_ON_DAMAGE_PER_HP);
      this.sounds.hurt();
      this.incoming.push(this.incomingAngle(origin));
      if (died) {
        bot.kills += 1;
        this.addKillScore(bot.team);
        this.feed.push({
          killer: bot.name,
          victim: PLAYER_NAME,
          weapon: 'ボットAR',
          headshot: false,
        });
        this.sounds.death();
        this.notePlayerDeath(bot);
      }
      return;
    }

    if (tag?.kind === 'bot' && tag.bot.alive && tag.bot.team !== bot.team) {
      // painDir: 被弾したbotが射手(bot)方向へ振り向く材料(victim→attacker)
      const died = tag.bot.takeDamage(damage, bot.position.clone().sub(tag.bot.position));
      if (died) {
        bot.kills += 1;
        this.addKillScore(bot.team);
        this.feed.push({
          killer: bot.name,
          victim: tag.bot.name,
          weapon: 'ボットAR',
          headshot: false,
        });
        this.tracker.onFeed(false); // 他者のキルは自分の連続フィード(QuadFeed)を分断する
        this.botDeathFx(tag.bot);
      }
    }
  }

  // キルを取ったチームのスコアを進める。ドミネーションは拠点ポイントのみ
  private addKillScore(team: TeamId): void {
    if (this.config.mode !== 'dom') this.scores.add(team, 1);
  }

  // killerは敵BOTに倒された場合のみ。自爆や火災ではキルカメラを出さない
  private notePlayerDeath(killer: Bot | null = null): void {
    this.deathPos = this.player.position;
    this.orbitAngle = this.player.yaw + Math.PI / 2;
    this.killer = killer;
    this.killcamTimer = killer ? KILLCAM_S : 0;
    // 死亡→キルカメラの遷移黒幕(短い暗転で一人称からの繋ぎを滑らかに)
    this.deathVeil = 0.85;
    if (killer) {
      // アンカーを固定(killerが動いても構図が破綻しないよう死亡時の姿勢を凍結)
      this.killcamAnchorHead.copy(killer.headPosition());
      this.killcamAnchorPos.copy(killer.position);
      this.killcamWeaponLabel = killcamWeaponFor(killer);
      const dx = killer.position.x - this.player.position.x;
      const dz = killer.position.z - this.player.position.z;
      this.killcamDistM = Math.round(Math.hypot(dx, dz));
      this.killcamFlash = this.settings.reduceMotion ? 0 : 1;
      this.killcamElapsedS = 0;
      this.killcamArc = 0;
      this.prevKillcamCamActive = false;
      this.killcamSeeded = false; // 現在のカメラ姿勢を一人称からシードし直す
    } else {
      this.killcamWeaponLabel = null;
    }
  }

  // 銃声を「聞かせる」。全周検知にはせず、音源方向への警戒(調査行動)を与える
  private alertBots(radius: number): void {
    const pos = this.player.position;
    for (const bot of this.bots) {
      if (bot.alive && bot.team !== PLAYER_TEAM && bot.position.distanceTo(pos) < radius) {
        bot.alert = 4;
        bot.alertPos = pos.clone();
      }
    }
  }

  // カメラシェイクのトラウマを加算する(0..1で頭打ち)
  private addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  // 撃破時のチーム色バースト演出
  private botDeathFx(bot: Bot): void {
    const color = bot.team === PLAYER_TEAM ? this.colors.ally : this.colors.enemy;
    const point = bot.position;
    point.y += 0.4;
    this.effects.deathBurst(point, color);
  }

  private addUltCharge(amount: number): void {
    this.ultCharge = Math.min(1, this.ultCharge + amount);
  }

  // アルティメットの充填・発動・オーバードライブ持続。player.update前に呼ぶ
  private updateUltimate(dt: number): void {
    // 死亡中はオーバードライブを終了し、バフを残さない(ゲージ自体は維持)。
    // 落下死などnotePlayerDeathを通らない経路も含めて確実に解除する
    if (!this.player.alive) {
      this.ultActive = 0;
      this.player.speedMul = 1;
      this.player.damageResist = 0;
      return;
    }

    this.ultCharge = Math.min(1, this.ultCharge + dt * ULT_PASSIVE_PER_S);

    if (
      this.input.wasPressed('ultimate') &&
      this.ultCharge >= 1 &&
      this.ultActive <= 0 &&
      !this.cooking
    ) {
      this.activateUltimate();
    }

    if (this.ultActive > 0) {
      this.ultActive = Math.max(0, this.ultActive - dt);
      this.player.speedMul = OVERDRIVE_SPEED_MUL;
      this.player.damageResist = OVERDRIVE_RESIST;
    } else {
      this.player.speedMul = 1;
      this.player.damageResist = 0;
    }

    // 準備完了音は永続フラグで立ち上がりを検出する。戦闘(キル/制圧/被弾)で
    // 充填されるのはupdateUltimateより後なので、ローカル変数では取りこぼす。
    // 発動でフラグを倒し、オーバードライブ中・死亡中は鳴らさない
    if (!this.ultReadyNotified && this.ultCharge >= 1 && this.ultActive <= 0) {
      this.sounds.ultReady();
      this.ultReadyNotified = true;
    }
  }

  // ── クナイ(ニンジャ・ダガー)の技 ──────────────────────────────
  // 薙ぎ払いコンボ: 45→63→90(3段目は重い)。スライド中は一撃90のスライドキック。
  // 拳より広いリーチ(DAGGER_MELEE_RANGE)+前方扇状で、コーン内の敵を複数まとめて斬る。
  private doPunch(): void {
    if (!this.player.alive) return;
    // コンボ進行(0.55s窓)。スライドキックは常に最終段扱い
    this.punchStep = this.player.sliding ? 3 : this.punchWindowS > 0 ? Math.min(this.punchStep + 1, 3) : 1;
    this.punchWindowS = 0.55;
    const dmg = this.punchStep >= 3 ? 90 : this.punchStep === 2 ? 63 : 45;

    this.sounds.punchWhoosh();
    this.viewModel.fire(false, false); // 斬りの振り抜きアニメ(マズルフラッシュは出さない)
    this.addShake(this.punchStep >= 3 ? 0.08 : 0.03);
    // 静かな攻撃: 銃声アラートは出さず、至近の敵だけが気づく
    this.alertBots(5);

    // 前方の広いコーン内の敵を「複数まとめて」斬る(薙ぎ払い)。リーチは機体の大きさで補正
    // (戦車は車体が巨大なので中心距離では密着しても届かないため)。
    const eye = this.player.eyePosition;
    const fwd = this.cameraForward();
    let hitAny = false;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const reach = DAGGER_MELEE_RANGE + (bot.kind === 'tank' ? 2.2 : bot.kind === 'turret' ? 0.5 : 0);
      const to = bot.position.sub(eye);
      const dist = to.length();
      if (dist > reach) continue;
      to.normalize();
      if (fwd.dot(to) < DAGGER_MELEE_CONE) continue;
      // 遮蔽判定: 薄い壁・コンテナ越しに斬れないようにする(handleMeleeと同じ流儀)
      const hit = this.castRay(eye, to, dist - 0.1, this.player.body);
      if (hit) {
        const tag = this.tags.get(hit.collider.handle);
        if (!(tag?.kind === 'bot' && tag.bot === bot)) continue;
      }
      const point = bot.position;
      point.y += 0.3;
      // weaponName '近接' で既存の近接メダル/チャレンジ経路に乗る
      this.applyBotDamage(bot, dmg, point, false, '近接');
      hitAny = true;
    }
    if (hitAny) {
      this.sounds.punchHit(this.punchStep);
      this.haptic(70, 0.4, 0.5);
    }
  }

  // ── ブリンク斬撃(ADS+左クリック) ──────────────────────────────
  // 前方(水平)へ短距離テレポートし、経路上の敵を切り裂く。壁は castRay で手前停止、
  // テレポートは水平のみ=床/天井抜け・OOBを構造的に回避する。クールダウン付き。
  private doBlinkStrike(): void {
    if (!this.player.alive) return;
    this.blinkCooldownS = BLINK_COOLDOWN;
    this.punchStep = 0; // ブリンク後は薙ぎ払いコンボをリセット
    this.punchWindowS = 0;

    // 進行方向は視線の水平成分。真上/真下を向いていても水平の一貫した方向を確保する
    const dir = this.cameraForward().setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    dir.normalize();

    const start = this.player.position; // body中心(fresh vector)
    // 壁の手前で停止(壁抜け防止)。V18修正: 敵が壁の手前に立つと最近接ヒットが敵になり壁を
    // 見逃して7m貫通・場外テレポートしていた。filterPredicateでワールドgeometryのみを対象に
    // レイキャストし、敵の背後にある壁でも確実に手前停止させる。
    const hit = this.castRay(
      start,
      dir,
      BLINK_RANGE + CAPSULE_RADIUS,
      this.player.body,
      (c) => this.tags.get(c.handle)?.kind === 'world',
    );
    let dist = BLINK_RANGE;
    if (hit) dist = Math.max(0, hitToi(hit) - CAPSULE_RADIUS - 0.05);
    const end = start.clone().addScaledVector(dir, dist);

    // 斬撃の残像(目線高さで始点→終点の光跡)+ 抜刀音
    const eyeY = this.player.eyePosition.y;
    this.effects.tracer(
      new THREE.Vector3(start.x, eyeY - 0.1, start.z),
      new THREE.Vector3(end.x, eyeY - 0.1, end.z),
      this.activeWeapon.def.tracerColor,
    );
    this.sounds.punchWhoosh();
    this.sounds.melee();
    this.addShake(0.12);
    this.haptic(90, 0.5, 0.6);
    this.alertBots(6);
    this.viewModel.fire(false, false);

    // 経路(始点→終点の線分)から BLINK_RADIUS 以内の敵を切り裂く
    const segLen = Math.max(1e-4, dist);
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const bp = bot.position;
      const t = THREE.MathUtils.clamp(bp.clone().sub(start).dot(dir), 0, segLen);
      const cx = start.x + dir.x * t;
      const cz = start.z + dir.z * t;
      const dx = bp.x - cx;
      const dz = bp.z - cz;
      if (dx * dx + dz * dz > BLINK_RADIUS * BLINK_RADIUS) continue;
      if (Math.abs(bp.y - start.y) > 2.0) continue; // 高さ方向は緩く許容
      const point = new THREE.Vector3(bp.x, bp.y + 0.3, bp.z);
      this.applyBotDamage(bot, BLINK_DAMAGE, point, false, '近接');
    }

    // テレポート(水平のみ)。player.update が設定済みの次kinematic変位を上書きする
    // (物理ステップ前なので最後の値が採用される=このフレームで end へ移動する)。
    this.player.body.setNextKinematicTranslation({ x: end.x, y: start.y, z: end.z });
  }

  // ダイブスラム: 空中でしゃがみ→終端速度で急降下し、着地の衝撃波で周囲にダメージ
  private doDiveSlam(): void {
    const center = this.player.position;
    const fallH = Math.max(0, this.slamStartY - center.y);
    // その場ホップの即死化を防ぐ: 低空(1.5m未満)は威力35%に減衰。高く飛ぶほど痛い
    const heightMul = fallH < 1.5 ? 0.35 : 1;
    const dmg = Math.min(300, (110 + fallH * 25) * heightMul);
    const radius = 9; // ドロップ(ダイブスラム)の衝撃波範囲を拡大(旧6→9)
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    this.effects.explosion(ground, radius * 0.55);
    this.sounds.groundPound();
    this.addShake(0.65);
    this.haptic(220, 0.8, 1.0);
    // 轟音: 銃声同等に周囲へ響く(無音のAoEにしない)
    this.alertBots(18);
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const dist = bot.position.distanceTo(center);
      if (dist > radius) continue;
      // グレネード/アルトと同じ遮蔽規約: 壁越しには効かない
      if (!this.explosionReaches(center, bot.position)) continue;
      const scaled = dmg * (1 - (dist / radius) * 0.5); // 中心ほど痛い
      // アルティメット同様、スラムキルでのアルト自己充填はしない
      this.applyBotDamage(bot, scaled, bot.position, false, 'ダイブスラム', false);
    }
  }

  // グラビティスラムで周囲の敵を吹き飛ばし、オーバードライブを起動する
  private activateUltimate(): void {
    // クナイ(ニンジャ): オーバードライブではなく、接地でも即発動する大衝撃波(ジャンプ不要)
    if (this.isNinja) {
      this.activateNinjaShockwave();
      return;
    }
    this.ultCharge = 0;
    this.ultActive = OVERDRIVE_DURATION;
    this.ultReadyNotified = false;
    const center = this.player.position;
    // 演出はカメラの内側で生成すると裏面カリングで消えるため、足元の地面で炸裂
    // させて衝撃波・土煙が周囲に広がって見えるようにする。画面側の閃光はHUDが
    // ultActiveの立ち上がりから出す(reduceMotion尊重)。判定は胴中心のまま
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    this.effects.explosion(ground, SLAM_RADIUS * 0.6);
    this.effects.deathBurst(ground, this.colors.ally);
    const { pan, distance } = this.panAndDistance(center);
    this.sounds.explosion(pan, distance);
    this.sounds.ultActivate();
    this.addShake(0.6);
    this.announcements.push('オーバードライブ発動');
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (bot.position.distanceTo(center) < SLAM_RADIUS && this.explosionReaches(center, bot.position)) {
        // スラムのキルでアルトを再充填しない(自己還元の連鎖を防ぐ)
        this.applyBotDamage(bot, SLAM_DAMAGE, bot.position, false, 'グラビティスラム', false);
      }
    }
  }

  // 素手ウルト: オーバードライブを起動せず、接地状態からでも即座に周囲へ大衝撃波を放つ。
  // ダイブスラムより広い半径・高ダメージ。ジャンプは不要(その場で発動)。
  private activateNinjaShockwave(): void {
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    const center = this.player.position;
    // 演出はカメラ内側だと裏面カリングで消えるため、足元の地面で炸裂させて衝撃波を広げる
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    this.effects.explosion(ground, NINJA_ULT_RADIUS * 0.6);
    this.effects.deathBurst(ground, this.colors.ally);
    const { pan, distance } = this.panAndDistance(center);
    this.sounds.explosion(pan, distance);
    this.sounds.groundPound();
    this.sounds.ultActivate();
    this.addShake(0.75);
    this.haptic(240, 0.85, 1.0);
    this.announcements.push('残刃・大破斬');
    // 轟音は銃声同等に響かせる(無音のAoEにしない)
    this.alertBots(26);
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const dist = bot.position.distanceTo(center);
      if (dist > NINJA_ULT_RADIUS) continue;
      // グレネード/スラムと同じ遮蔽規約: 壁越しには効かない
      if (!this.explosionReaches(center, bot.position)) continue;
      const scaled = NINJA_ULT_DAMAGE * (1 - (dist / NINJA_ULT_RADIUS) * 0.4); // 中心ほど痛い
      // ウルト同様、衝撃波キルでのアルト自己充填はしない(自己還元の連鎖を防ぐ)
      this.applyBotDamage(bot, scaled, bot.position, false, 'グラビティスラム', false);
    }
  }

  private refillGrenades(): void {
    this.grenadeCounts.frag = GRENADE_SPECS.frag.carry;
    this.grenadeCounts.smoke = GRENADE_SPECS.smoke.carry;
    this.grenadeCounts.flash = GRENADE_SPECS.flash.carry;
    this.grenadeCounts.incendiary = GRENADE_SPECS.incendiary.carry;
  }

  private handleRespawns(): void {
    // ── 奈落セーフティネット(無限落下の構造的封じ込め)──
    // 床抜けはレベル設計でなくエンジン由来のアーティファクトなので、K/D・ストリークを
    // 罰さず非致死で安全スポーンへ再配置する。物理ステップ後の最新座標で判定する。
    if (this.player.alive && this.player.position.y < VOID_Y) {
      this.player.respawnAt(this.pickSpawn(this.playerSpawns, this.hostilesOf(PLAYER_TEAM)));
      for (const weapon of this.weapons) weapon.resupply();
      this.refillGrenades();
    }
    for (const bot of this.bots) {
      if (bot.alive && bot.position.y < VOID_Y) {
        const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
        bot.respawnAt(this.pickSpawn(spawns, this.hostilesOf(bot.team)));
      }
    }

    if (!this.player.alive && this.player.respawnIn <= 0) {
      if (this.config.mode === 'zombie') {
        // ゾンビはダウン=無限ウェーブ終了(復活しない)。over は zombie の唯一の終了条件
        this.playerDowns += 1;
        this.over = true;
      } else {
        this.player.respawnAt(this.pickSpawn(this.playerSpawns, this.hostilesOf(PLAYER_TEAM)));
        // リスポーンでは両武器の弾倉を満タンに補給し、投擲物も初期装備へ戻す
        for (const weapon of this.weapons) weapon.resupply();
        this.activeWeapon.raise();
        this.refillGrenades();
        this.shakeTrauma = 0;
        this.deathPos = null;
        this.killer = null;
        this.killcamTimer = 0;
      }
    }
    // ストーリー/ゾンビでは敵を復活させない(撃破で波/ラウンドが確実に減る。ゾンビはディレクタが管理)
    if (!this.mission) {
      for (const bot of this.bots) {
        if (!bot.alive && bot.respawnIn <= 0 && bot.kind !== 'zombie') {
          const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
          bot.respawnAt(this.pickSpawn(spawns, this.hostilesOf(bot.team)));
        }
      }
    }
  }

  // ── R6 キャンペーン: 敵生成・波・目的進行 ───────────────────────
  // Bot生成の3点セット(コライダーtag登録+scene追加+配列push)を共有する
  private spawnBot(
    name: string,
    spawn: THREE.Vector3,
    color: number,
    team: number,
    tuning: BotTuning,
    tier: BotTier,
    kind: BotKind = 'humanoid',
  ): Bot {
    // 機体種の個体差(HP/速度/索敵)を合成。tankボス=2200HP等はここで乗る
    const merged: BotTuning = { ...tuning, ...KIND_TUNING[kind] };
    if (tier === 'boss') {
      // ボスは階層HPを下回らない(ドローンボスが60HP化するのを防ぐ)。
      // 戦車ボスはeasyでは手加減する(初章の理不尽化を防ぐ)
      merged.maxHp = Math.max(merged.maxHp, tuning.maxHp);
      if (kind === 'tank' && this.config.difficulty === 'easy') merged.maxHp = 1400;
    }
    const bot = new Bot(this.physics, name, spawn, color, merged, team, tier, kind);
    this.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
    this.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
    // 追加コライダー(tankの砲塔など)もbody部位として登録する
    for (const c of bot.extraColliders) this.tags.set(c.handle, { kind: 'bot', bot, part: 'body' });
    this.scene.add(bot.group);
    this.bots.push(bot);
    return bot;
  }

  // 波進行(wave-clear)の生存カウント。常設タレットは「設置物」であり波の構成員では
  // ないため除外する(遠くの砲台を掃除しないと次波が湧かない詰まりを防ぐ)
  private aliveEnemyCount(): number {
    let n = 0;
    for (const b of this.bots) {
      if (b.alive && b.team === ENEMY_TEAM && b.kind !== 'turret') n += 1;
    }
    return n;
  }

  // ── R16 BO2式ラウンド制ゾンビディレクタ ─────────────────────────
  // 同時生存上限をtierへ連動させる(多数描画/物理予算を守る主レバー)
  private setupZombie(): void {
    const tier = resolveGraphicsTier(
      this.settings.graphicsQuality,
      this.renderer.capabilities.isWebGL2,
    );
    this.zombieTierCap =
      tier === 'high'
        ? ZOMBIE_MAX_ALIVE.high
        : tier === 'medium'
          ? ZOMBIE_MAX_ALIVE.medium
          : ZOMBIE_MAX_ALIVE.low;
  }

  private aliveZombieCount(): number {
    let n = 0;
    for (const b of this.bots) if (b.kind === 'zombie' && b.alive) n += 1;
    return n;
  }

  private startZombieRound(r: number): void {
    this.zombieRound = r;
    this.zombieQueue = zombieTotal(r);
    this.zombieSpawnTimer = 0;
    this.announcements.push(`ラウンド ${r}`);
  }

  // 毎フレーム(handleRespawns後): 死体解放→影LOD→ラウンド進行(ドリップ湧き/クリア判定)
  private updateZombieDirector(dt: number): void {
    // 死体解放を最初に(Rapier handle再利用でnewゾンビが無敵化するのを防ぐ)
    this.cleanupDeadZombies();
    // 近接影LOD: nearest≤8のみ castShadow。mapSize churnを避けるため周期(0.25s)トグル
    this.zombieShadowTimer -= dt;
    if (this.zombieShadowTimer <= 0) {
      this.updateZombieShadowLOD();
      this.zombieShadowTimer = 0.25;
    }
    if (this.over) return;

    if (this.zombieRoundCooldown > 0) {
      this.zombieRoundCooldown -= dt;
      if (this.zombieRoundCooldown <= 0) this.startZombieRound(this.zombieRound + 1);
      return;
    }
    if (this.zombieRound === 0) {
      this.startZombieRound(1);
      return;
    }
    const aliveZ = this.aliveZombieCount();
    // ドリップ湧き(同時生存上限まで)
    if (this.zombieQueue > 0 && aliveZ < this.zombieTierCap) {
      this.zombieSpawnTimer -= dt;
      if (this.zombieSpawnTimer <= 0) {
        if (this.spawnOneZombie()) this.zombieQueue -= 1;
        this.zombieSpawnTimer = zombieSpawnGap(this.zombieRound);
      }
    }
    // ラウンドクリア: 湧き残0 && 生存0 → 小休止して次ラウンドへ
    if (this.zombieQueue === 0 && aliveZ === 0) {
      this.zombieRoundCooldown = ZOMBIE_ROUND_COOLDOWN;
    }
  }

  // 湧きリング(プレイヤーの18〜32m外周・フラスタム外)へ1体。HP/速度は tuning に載せて渡す
  // (KIND_TUNING.zombieに maxHp/moveSpeedMul を入れると spawnBot merge で後勝ち上書きされる致命バグ回避)
  private spawnOneZombie(): boolean {
    const spawn = this.zombieSpawnPoint();
    if (!spawn) return false; // 有効な湧き点が無ければ次フレーム再試行(queueは減らさない)
    const r = this.zombieRound;
    const elite = this.rand() < zombieEliteRate(r);
    const run = this.rand() < zombieRunRate(r);
    const base = tuningFor('normal', this.config.difficulty);
    const tuning: BotTuning = {
      ...base,
      maxHp: zombieHp(r) * (elite ? 1.6 : 1),
      moveSpeedMul: ZOMBIE_MOVE_MUL * (elite ? 1.15 : 1),
    };
    const color = elite ? 0x6d7d3a : this.zombieSpawnColor;
    const name = BOT_NAMES[Math.floor(this.rand() * BOT_NAMES.length)] ?? 'ゾンビ';
    const bot = this.spawnBot(name, spawn, color, ENEMY_TEAM, tuning, 'normal', 'zombie');
    bot.zombieRunMul = run ? 1.6 : 1; // 走行個体はローカル倍率で加速(moveSpeedはreadonly)
    return true;
  }

  // 地面Yを下向きレイで確定し、フラスタム外の湧き点を返す(目前でのポップインを避ける)
  private zombieSpawnPoint(): THREE.Vector3 | null {
    const size = this.config.stage.size;
    const bound = size / 2 - 2;
    const around = this.player.alive ? this.player.position : new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ang = this.rand() * Math.PI * 2;
      const rad =
        ZOMBIE_SPAWN_RING_MIN + this.rand() * (ZOMBIE_SPAWN_RING_MAX - ZOMBIE_SPAWN_RING_MIN);
      const x = THREE.MathUtils.clamp(around.x + Math.cos(ang) * rad, -bound, bound);
      const z = THREE.MathUtils.clamp(around.z + Math.sin(ang) * rad, -bound, bound);
      const hit = this.castRay(new THREE.Vector3(x, 8, z), down, 20, null);
      const groundY = hit ? 8 - hitToi(hit) : 0;
      const p = new THREE.Vector3(x, groundY + 0.05, z);
      // フラスタム内(=プレイヤーの目前)はポップインになるので避ける。最終試行は妥協して返す
      if (attempt < 10 && this.isInView(p)) continue;
      return p;
    }
    return null;
  }

  private isInView(pos: THREE.Vector3): boolean {
    const m = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    return new THREE.Frustum().setFromProjectionMatrix(m).containsPoint(pos);
  }

  // ゾンビ近接: 何体密着していても、グローバル間隔 + プレイヤーi-frameで律速し、
  // 同フレームに5体×22=110で即死させない(BO2の複数被弾でも一撃死しない設計)
  private zombieMelee(bot: Bot): void {
    if (bot.kind !== 'zombie' || !this.player.alive) return;
    const now = this.elapsed;
    if (now < this.zombieMeleeIframe || now < this.zombieMeleeGlobal) return;
    const dmg = bot.tuning.damage;
    const died = this.player.takeDamage(dmg);
    this.tookDamage = true;
    this.haptic(90, 0.5, 0.6);
    this.addShake(0.18);
    this.addUltCharge(dmg * ULT_ON_DAMAGE_PER_HP);
    this.incoming.push(this.incomingAngle(bot.position));
    this.sounds.hurt();
    this.zombieMeleeGlobal = now + ZOMBIE_MELEE_GLOBAL_GAP;
    this.zombieMeleeIframe = now + ZOMBIE_IFRAME;
    if (died) {
      this.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: 'ゾンビの爪', headshot: false });
      this.sounds.death();
      this.notePlayerDeath(bot);
    }
  }

  // 死んで演出も終わったゾンビを解放する。厳密順序: tags削除 → dispose(body/collider/geom/mat解放)
  // → scene除去 → splice(逆順ループで添字ズレ回避)。tagsを先に消さないと解放済みhandleの
  // 再利用で旧タグが新ゾンビのcolliderを死亡済み旧Botへ解決し、新ゾンビが実質無敵化する
  private cleanupDeadZombies(): void {
    for (let i = this.bots.length - 1; i >= 0; i -= 1) {
      const b = this.bots[i]!;
      if (b.kind !== 'zombie' || !b.corpseCleared) continue;
      this.tags.delete(b.bodyCollider.handle);
      this.tags.delete(b.headCollider.handle);
      for (const c of b.extraColliders) this.tags.delete(c.handle);
      b.dispose();
      this.scene.remove(b.group);
      this.bots.splice(i, 1);
    }
  }

  // 近接≤8体のみ影を落とす(多数の影パス/mapSize churnを抑える距離LOD)
  private updateZombieShadowLOD(): void {
    const zs: Bot[] = [];
    for (const b of this.bots) if (b.kind === 'zombie' && b.alive) zs.push(b);
    if (zs.length <= 8) {
      for (const z of zs) z.setCastShadow(true);
      return;
    }
    const cam = this.camera.position;
    zs.sort((a, b) => a.position.distanceToSquared(cam) - b.position.distanceToSquared(cam));
    for (let i = 0; i < zs.length; i += 1) zs[i]!.setCastShadow(i < 8);
  }

  // ミッション開始時の準備: 濃霧・脱出地点・第1波
  private setupMission(mission: MissionDef): void {
    if (this.modifierSet.has('dense-fog') && this.scene.fog instanceof THREE.FogExp2) {
      // R13: 濃霧modifierも「意図的な霧」に留める。係数2.6/上限0.12は白飛びしすぎるため緩和
      this.scene.fog.density = Math.min(0.07, this.scene.fog.density * 1.6 + 0.01);
    }
    // 脱出地点(extract用): プレイヤー初期位置から最も遠い隅
    const start = this.playerSpawns[0] ?? new THREE.Vector3();
    let far = start;
    let farD = -Infinity;
    for (const c of [...this.playerSpawns, ...this.botSpawns]) {
      const d = c.distanceTo(start);
      if (d > farD) {
        farD = d;
        far = c;
      }
    }
    this.exfilPos.copy(far);
    // 脱出ミッションは到達地点を発光ビーコンで可視化する(目的地が分からない問題の解消)
    if (mission.objective.kind === 'extract') {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 14, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x35ffa0,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.position.set(this.exfilPos.x, 7, this.exfilPos.z);
      this.scene.add(beacon);
    }
    // 防衛/生存ミッションは固定タレット2基を敵陣側へ据え「守りを崩す」画を作る。
    // 座標は障害物クリアランス済みのbotSpawnsから選ぶ(箱に埋まって撃破不能を防ぐ)
    if (mission.objective.kind === 'defend' || mission.objective.kind === 'survive') {
      const spots = [this.botSpawns[0], this.botSpawns[2]];
      for (const p of spots) {
        if (!p) continue;
        this.spawnBot(
          'ヤグラ砲台',
          p,
          this.colors.enemy,
          ENEMY_TEAM,
          tuningFor('elite', mission.difficulty),
          'elite',
          'turret',
        );
      }
    }
    this.pendingWaves = mission.waves.slice();
    this.advanceWaves();
  }

  // trigger を解釈して出せる波を出す。start=即時 / timer=delayS到達 / wave-clear=敵全滅。
  // start波は連続して全部出し、時限/殲滅波は1tickにつき1波だけ出す。
  private advanceWaves(): void {
    while (this.pendingWaves.length > 0) {
      const wave = this.pendingWaves[0]!;
      let ready: boolean;
      if (wave.trigger === 'start') ready = true;
      else if (wave.trigger === 'timer') ready = this.missionTimeS >= (wave.delayS ?? 0);
      else ready = this.aliveEnemyCount() === 0; // 'wave-clear'
      if (!ready) break;
      this.pendingWaves.shift();
      this.spawnWave(wave);
      this.waveIndex += 1;
      if (wave.announce) this.announcements.push(wave.announce);
      if (wave.trigger !== 'start') break;
    }
  }

  private spawnWave(wave: EnemyWaveDef): void {
    const swarm = this.modifierSet.has('elite-swarm');
    let n = 0;
    for (const group of wave.enemies) {
      // elite-swarm: 通常兵を精鋭に格上げして圧を上げる
      const tier: BotTier = swarm && group.tier === 'normal' ? 'elite' : group.tier;
      for (let i = 0; i < group.count; i += 1) {
        const cursor = this.waveSpawnCursor;
        const baseSpawn = this.botSpawns[cursor % this.botSpawns.length] ?? new THREE.Vector3();
        // スポーン点数を超えたら同座標重なりを避けてリング状にずらす
        const wrap = Math.floor(cursor / this.botSpawns.length);
        const spawn =
          wrap > 0
            ? new THREE.Vector3(
                baseSpawn.x + Math.cos(cursor * 1.7) * 2.5 * wrap,
                baseSpawn.y,
                baseSpawn.z + Math.sin(cursor * 1.7) * 2.5 * wrap,
              )
            : baseSpawn;
        this.waveSpawnCursor += 1;
        // 機体種: データ指定を優先。ボスの既定は章の物語に合わせる
        // (機械系の章=戦車、人型の教官/亡霊/砲主=人型、終章CINDERコア=大型ドローン)。
        // 「第2章以降の通常兵は3体に1体が偵察ドローン」で戦場の画を多様化する
        let kind: BotKind = group.kind ?? 'humanoid';
        if (!group.kind) {
          if (tier === 'boss') {
            const ch = this.mission?.chapterId ?? '';
            kind = ch === 'ch8' ? 'drone' : ch === 'ch1' || ch === 'ch3' || ch === 'ch4' ? 'humanoid' : 'tank';
          } else if (
            tier === 'normal' &&
            (this.mission?.chapterId ?? 'ch1') !== 'ch1' &&
            i % 3 === 2
          ) {
            kind = 'drone';
          }
        }
        const name =
          tier === 'boss'
            ? (this.mission?.objective.bossName ?? 'BOSS')
            : kind === 'drone'
              ? `ドローン-${n + 1}`
              : (BOT_NAMES[n % BOT_NAMES.length] ?? `EN-${n}`);
        this.spawnBot(
          name,
          spawn,
          this.colors.enemy,
          ENEMY_TEAM,
          tuningFor(tier, group.difficulty),
          tier,
          kind,
        );
        n += 1;
      }
    }
  }

  // 目的の進行・勝敗判定(update の先取スコア判定の代わりに呼ぶ)
  private updateMission(dt: number): void {
    const m = this.mission;
    if (!m || this.missionOutcome !== 'pending') return;
    this.missionTimeS += dt;
    if (this.modifierSet.has('one-life') && !this.player.alive) {
      this.missionOutcome = 'lost';
      return;
    }
    this.advanceWaves();
    const obj = m.objective;
    const allClear = this.aliveEnemyCount() === 0 && this.pendingWaves.length === 0;
    switch (obj.kind) {
      case 'eliminate-all':
        if (allClear) this.missionOutcome = 'won';
        break;
      case 'eliminate-count':
        if (this.missionKills >= (obj.count ?? 1)) this.missionOutcome = 'won';
        break;
      case 'assassinate':
        if (this.pendingWaves.length === 0 && !this.bots.some((b) => b.alive && b.tier === 'boss')) {
          this.missionOutcome = 'won';
        }
        break;
      case 'survive':
      case 'defend':
        if (this.missionTimeS >= (obj.surviveS ?? m.durationS)) this.missionOutcome = 'won';
        break;
      case 'extract': {
        const near = this.player.alive && this.player.position.distanceTo(this.exfilPos) < 4;
        this.exfilTimer = near ? this.exfilTimer + dt : 0;
        if (this.exfilTimer >= 3) this.missionOutcome = 'won';
        break;
      }
    }
  }

  // 目的の表示文言と進捗(HUD用)
  private objectiveText(): string {
    const m = this.mission;
    if (!m) return '';
    const obj = m.objective;
    if (obj.kind === 'eliminate-count') return `${obj.label} (${this.missionKills}/${obj.count ?? 0})`;
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      const left = Math.max(0, Math.ceil((obj.surviveS ?? m.durationS) - this.missionTimeS));
      return `${obj.label} (残り${left}s)`;
    }
    if (obj.kind === 'extract' && this.exfilTimer > 0) return `${obj.label} (確保 ${this.exfilTimer.toFixed(1)}s/3s)`;
    return obj.label;
  }

  private objectiveProgress01(): number {
    const m = this.mission;
    if (!m) return 0;
    const obj = m.objective;
    if (obj.kind === 'eliminate-count' && obj.count) return Math.min(1, this.missionKills / obj.count);
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      return Math.min(1, this.missionTimeS / (obj.surviveS ?? m.durationS));
    }
    if (obj.kind === 'extract') return Math.min(1, this.exfilTimer / 3);
    if (obj.kind === 'assassinate') {
      const boss = this.bots.find((b) => b.tier === 'boss');
      return boss ? 1 - boss.hp / boss.maxHp : this.missionOutcome === 'won' ? 1 : 0;
    }
    // eliminate-all: 倒した割合(おおまかな指標)
    const totalSpawned = this.bots.length;
    const dead = this.bots.filter((b) => !b.alive).length;
    return totalSpawned > 0 ? dead / totalSpawned : 0;
  }

  private bossHp01(): number | undefined {
    const boss = this.bots.find((b) => b.tier === 'boss' && b.alive);
    return boss ? boss.hp / boss.maxHp : undefined;
  }

  // 指定チームから見た敵対エンティティの現在位置一覧
  private hostilesOf(team: TeamId): THREE.Vector3[] {
    const positions = this.bots.filter((b) => b.alive && b.team !== team).map((b) => b.position);
    if (team !== PLAYER_TEAM && this.player.alive) positions.push(this.player.position);
    return positions;
  }

  // 敵から最も離れた地点に湧く
  private pickSpawn(candidates: THREE.Vector3[], enemies: THREE.Vector3[]): THREE.Vector3 {
    let best = candidates[0] ?? new THREE.Vector3();
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = enemies.length ? Math.min(...enemies.map((e) => e.distanceTo(candidate))) : 1;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private castRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
    exclude: RAPIER.RigidBody | null,
    predicate?: (collider: RAPIER.Collider) => boolean,
  ): RayHitLike | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    return this.physics.castRay(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      exclude ?? undefined,
      predicate,
    ) as unknown as RayHitLike | null;
  }

  private castRayWithNormal(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
    exclude: RAPIER.RigidBody | null,
  ): RayNormalHitLike | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    return this.physics.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      exclude ?? undefined,
    ) as unknown as RayNormalHitLike | null;
  }

  snapshot(): MatchSnapshot {
    const weapon = this.activeWeapon;
    // R13: 光学ID→OpticSpecを解決(HUDレティクル種別/倍率オーバーレイ判定)。
    // adsOpticActiveはdef.scope(ネイティブ狙撃)とは独立で、後付け倍率光学のADS時に立つ
    const opticId = resolveOpticId(weapon.def);
    const optic = OPTIC_SPECS[opticId];
    const spec = GRENADE_SPECS[this.grenadeKind];
    const cookWindow = spec.fuseS - COOK_SAFETY_S;
    const snapshot: MatchSnapshot = {
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      alive: this.player.alive,
      respawnIn: Math.max(0, this.player.respawnIn),
      ammo: weapon.magazine.rounds,
      reserve: weapon.magazine.reserve,
      magSize: weapon.magazine.capacity,
      weaponName: weapon.def.name,
      weaponSlot: this.activeIndex === 0 ? 'PRIMARY' : 'SECONDARY',
      fireMode:
        weapon.def.mode === 'auto'
          ? 'フルオート'
          : weapon.def.mode === 'semi'
            ? '単発'
            : 'バースト',
      reloading: weapon.reloading,
      reloadRatio: weapon.reloadRatio,
      spreadRad: weapon.currentSpreadRad({
        moveFactor: this.player.moveFactor,
        airborne: !this.player.grounded,
        crouched: this.player.crouching,
        sliding: this.player.sliding,
        wallRunning: this.player.wallRunning,
      }),
      adsProgress: weapon.adsProgress,
      kills: this.player.kills,
      deaths: this.player.deaths,
      streak: this.player.streak,
      timeLeft: this.timeLeft,
      yaw: this.player.yaw,
      fov: this.camera.fov,
      over: this.over,
      speed: this.player.speed,
      sliding: this.player.sliding,
      wallRunning: this.player.wallRunning,
      airborne: !this.player.grounded && this.player.alive,
      reduceMotion: this.settings.reduceMotion,
      radarEnabled: this.settings.radarEnabled,
      ultCharge: this.ultCharge,
      ultActive: this.ultActive > 0,
      scopedWeapon: weapon.def.scope === true,
      opticId,
      adsOpticActive: !!optic?.magnified && weapon.adsProgress > 0.5,
      sightStyle: optic?.reticleKind ?? 'dot',
      scope: {
        sway: this.settings.reduceMotion ? { x: 0, y: 0 } : this.scopeSway,
        steady: this.breathSteady,
        breath01: this.breathMeter / BREATH_MAX_S,
      },
      aimAssistEngaged: this.aimAssistEngaged,
      rangeM: this.scopeRangeM,
      zoomX: Math.round((1 / weapon.def.adsFovScale) * 10) / 10,
      reticleStyle: this.settings.reticleStyle,
      reticleColor: this.settings.reticleColor,
      weaponId: weapon.def.id,
      grenadeName: spec.name,
      grenadeCount: this.grenadeCounts[this.grenadeKind],
      cookRatio: this.cooking && spec.cookable ? Math.min(1, this.cookTimer / cookWindow) : 0,
      whiteout: this.whiteout,
      modeName: this.modeDef.name,
      teamBased: this.modeDef.teamBased,
      scoreMine: this.scores.get(PLAYER_TEAM),
      scoreEnemy: this.enemyTopScore(),
      scoreTarget: this.modeDef.scoreTarget,
      zones: this.zoneViews(),
      announcements: this.announcements,
      spectating: !this.player.alive && this.deathPos !== null,
      killcam:
        !this.player.alive && this.killcamTimer > 0 && this.killer?.alive ? this.killer.name : null,
      killcamRatio:
        !this.player.alive && this.killcamTimer > 0 ? this.killcamTimer / KILLCAM_S : 0,
      killcamWeapon:
        !this.player.alive && this.killcamTimer > 0 && this.killer?.alive
          ? this.killcamWeaponLabel
          : null,
      killcamDistM: this.killcamDistM,
      killcamFlash: this.killcamFlash,
      deathVeil: this.deathVeil,
      killcamFinal: this.killcamCamActive && this.killcamTimer < 0.7,
      killcamCamActive: this.killcamCamActive,
      lowHp01: this.player.alive
        ? Math.max(0, Math.min(1, (0.3 - this.player.hp / this.player.maxHp) / 0.3))
        : 0,
      postfxActive: this.postfxActive,
      feed: this.feed,
      hits: this.hits,
      hitExpandRad: this.hitExpand,
      damageNumbers: this.damageNumbers,
      incoming: this.incoming,
      tookDamage: this.tookDamage,
      scoreboard: this.scoreboard(),
      scoreEvents: this.scoreEvents,
      // レーダー無効時はLoSレイキャストを省く(HUDも空配列で参照しない)
      enemyBearings: this.settings.radarEnabled ? this.computeEnemyBearings() : [],
      medals: this.medals,
      // ── R6 ストーリー(非ストーリーでは undefined) ──
      missionId: this.mission?.id,
      objectiveText: this.mission ? this.objectiveText() : undefined,
      objectiveProgress01: this.mission ? this.objectiveProgress01() : undefined,
      waveIndex: this.mission ? this.waveIndex : undefined,
      waveTotal: this.mission ? this.mission.waves.length : undefined,
      bossHp01: this.mission ? this.bossHp01() : undefined,
      // ── R16 ゾンビ(mode!=='zombie'では undefined)──
      zombieRound: this.config.mode === 'zombie' ? this.zombieRound : undefined,
      zombieKills: this.config.mode === 'zombie' ? this.zombieKills : undefined,
      zombiePoints: this.config.mode === 'zombie' ? this.zombiePoints : undefined,
      playerDowns: this.config.mode === 'zombie' ? this.playerDowns : undefined,
    };
    this.feed = [];
    this.hits = [];
    this.damageNumbers = [];
    this.incoming = [];
    this.tookDamage = false;
    this.announcements = [];
    this.scoreEvents = [];
    this.medals = [];
    return snapshot;
  }

  // レーダー用: 視認できている敵(LoS・煙で遮られていない)の、自機の向きを基準にした
  // 相対方位(rad, 0=正面・右が正)と水平距離。透視にならないよう必ず視認判定を通す。
  // HUD側は cx=sin(angle), cy=-cos(angle) で描くため、右が正になるよう forwardAngle - 方位 とする
  private computeEnemyBearings(): Array<{ angle: number; dist: number }> {
    const out: Array<{ angle: number; dist: number }> = [];
    if (!this.player.alive) return out;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const eye = this.player.eyePosition;
    const forwardAngle = Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const dx = bot.position.x - px;
      const dz = bot.position.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > RADAR_RANGE_M) continue;
      const aim = bot.position;
      aim.y += 0.15;
      if (this.smokeBlocks(eye, aim)) continue;
      if (!this.playerCanSee(eye, aim, bot)) continue;
      out.push({ angle: wrapAngle(forwardAngle - Math.atan2(dx, dz)), dist });
    }
    return out;
  }

  // FFAでは首位の敵スコア、チーム戦では敵チームスコア
  private enemyTopScore(): number {
    if (this.modeDef.teamBased) return this.scores.get(ENEMY_TEAM);
    let best = 0;
    for (const bot of this.bots) best = Math.max(best, this.scores.get(bot.team));
    return best;
  }

  private zoneViews(): ZoneView[] {
    if (!this.domination) return [];
    const side = (team: TeamId | null): 'mine' | 'enemy' | null =>
      team === null ? null : team === PLAYER_TEAM ? 'mine' : 'enemy';
    return this.domination.zones.map((zone): ZoneView => {
      const snap: ZoneSnapshot = zone.snapshot();
      return {
        id: snap.id,
        owner: side(snap.owner),
        progress: snap.progress,
        capturing: side(snap.capturingTeam),
        contested: snap.contested,
      };
    });
  }

  scoreboard(): ScoreRow[] {
    const rows: ScoreRow[] = [
      {
        name: PLAYER_NAME,
        kills: this.player.kills,
        deaths: this.player.deaths,
        isPlayer: true,
        isAlly: true,
      },
      ...this.bots.map((bot) => ({
        name: bot.name,
        kills: bot.kills,
        deaths: bot.deaths,
        isPlayer: false,
        isAlly: bot.team === PLAYER_TEAM,
      })),
    ];
    return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  // 描画。composer(medium/high)があればそれ、無ければ素のレンダラ。
  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // リサイズ。アスペクト更新は必須。composerがあればパスの解像度も合わせる
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
  }

  get missionWon(): boolean {
    return this.missionOutcome === 'won';
  }

  // ストーリー時のミッション要約(applyCampaignMission へ渡す)。非ストーリーは null。
  missionSummary(): MissionSummary | null {
    if (!this.mission) return null;
    const base = this.result().summary;
    const won = this.missionOutcome === 'won';
    return {
      ...base,
      rated: false,
      won,
      missionId: this.mission.id,
      chapterId: this.mission.chapterId,
      missionWon: won,
      timeS: this.missionTimeS,
      objectiveMet: won,
      modifiers: this.mission.modifiers,
    };
  }

  result(): MatchResult {
    const rows = this.scoreboard();
    const won = this.mission
      ? this.missionOutcome === 'won'
      : this.modeDef.teamBased
        ? this.scores.get(PLAYER_TEAM) > this.scores.get(ENEMY_TEAM)
        : (rows[0]?.isPlayer ?? false);
    return {
      rows,
      won,
      accuracy: this.player.shotsFired > 0 ? this.player.shotsHit / this.player.shotsFired : 0,
      headshots: this.player.headshots,
      modeName: this.modeDef.name,
      teamScores: this.modeDef.teamBased
        ? { mine: this.scores.get(PLAYER_TEAM), enemy: this.scores.get(ENEMY_TEAM) }
        : null,
      summary: {
        won,
        rated: this.over,
        kills: this.player.kills,
        deaths: this.player.deaths,
        headshots: this.player.headshots,
        shotsFired: this.player.shotsFired,
        shotsHit: this.player.shotsHit,
        captures: this.playerCaptures,
        bestStreak: this.bestStreak,
        weaponKills: { ...this.playerWeaponKills },
        unlockedMedals: [...this.tracker.newlyUnlocked],
        medalCounts: { ...this.tracker.counts },
        medalXp: this.medalXpTotal,
      },
    };
  }

  projectToScreen(
    world: THREE.Vector3,
    width: number,
    height: number,
  ): { x: number; y: number; behind: boolean } {
    const projected = world.clone().project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
      behind: projected.z > 1,
    };
  }

  dispose(): void {
    this.atmosphere?.dispose(); // 草/フォグ/粒子/遠景/リムライトを解放(scene.traverse前)
    this.atmosphere = null;
    this.effects.dispose();
    this.viewModel.dispose();
    for (const item of this.thrown) {
      this.scene.remove(item.mesh);
      (item.mesh.material as THREE.Material).dispose();
    }
    this.thrown = [];
    this.grenadeGeometry.dispose();
    // ポストプロセスとIBLを解放(scene.traverseの前。怠ると再戦ごとにVRAMリーク)
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose?.();
      this.composer.dispose();
      this.composer = null;
    }
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    this.scene.environment = null;
    // 再戦のたびにGPUメモリが積み上がらないよう、シーン内の
    // ジオメトリとマテリアルを明示的に解放する(共有分の二重disposeは無害)
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          for (const m of material) m.dispose();
        } else {
          material.dispose();
        }
        // InstancedMeshのinstanceMatrixはgeometry.dispose()では解放されないため明示的に
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      } else if (obj instanceof THREE.Light) {
        // DirectionalLightの影マップ(2048²のRT)はLightShadow.dispose()でのみ解放される
        const light = obj as THREE.Light & { shadow?: { dispose?: () => void } };
        light.shadow?.dispose?.();
      }
    });
    this.physics.free();
  }
}

// 線分abと点pの最短距離
function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < 1e-9) return a.distanceTo(p);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lengthSq, 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
