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
  bulletBendFraction,
  BULLET_MAG_CONE_DEG,
  BULLET_MAG_MAX_DEG,
  BULLET_MAG_CONE_SCOPED_DEG,
  BULLET_MAG_MAX_SCOPED_DEG,
  distanceFactor,
  PART_PULL_SCALE,
  rankAimPoints,
  rotationalAssist,
  slowdownFactor,
  snapPulse,
  wrapAngle,
  type AimPart,
} from './aimassist';
import { applyAttachments } from './attachments';
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
  tuningFor,
  type BotTier,
  type BotTuning,
  type Difficulty,
} from './bot';
import type { EnemyWaveDef, MissionDef } from './campaign';
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
import { Player } from './player';
import type { MatchSummary } from './progression';
import { generateStage, type StageDef } from './stage';
import { teamPalette, type TeamPalette } from './teamcolors';
import { Weapon, WEAPON_DEFS, type WeaponClass } from './weapons';

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
const HIP_GATE = 0.5;
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
const BOT_VIEW_DISTANCE = 60;
const BOT_VIEW_CONE_COS = Math.cos((75 * Math.PI) / 180);
const BOT_FALLOFF = { start: 14, end: 40, minFactor: 0.6 };
const PLAYER_NAME = 'あなた';
const ZONE_RADIUS = 3.5;
const SPECTATE_RADIUS = 5.5;
const SPECTATE_HEIGHT = 3;
const KILLCAM_S = 2.4;
const ALERT_RADIUS = 35;
const ALERT_RADIUS_SUPPRESSED = 9;
// クッキング限界の直前で強制投擲し、手元爆発はさせない
const COOK_SAFETY_S = 0.25;
const FIRE_TICK_S = 0.5;

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
  private crouchLatch = false;
  private readonly colors: TeamPalette;
  private bestStreak = 0;
  private playerCaptures = 0;
  private readonly playerWeaponKills: Record<string, number> = {};

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
  private raaPrevTarget: Bot | null = null; // 回転エイムアシストの前フレーム対象
  private raaPrevBearing = 0; // 同・前フレームの対象方位(yaw)
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
    const playerOpts: { regenPerS?: number; gravityScale?: number } = {};
    if (this.modifierSet.has('no-regen')) playerOpts.regenPerS = 0;
    if (this.modifierSet.has('low-gravity')) playerOpts.gravityScale = 0.55;
    this.player = new Player(this.physics, spawn, playerOpts);
    this.tags.set(this.player.collider.handle, { kind: 'player' });

    const primaryBase = WEAPON_DEFS[config.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    const primaryDef = applyAttachments(primaryBase, config.attachments);
    this.weapons = [new Weapon(primaryDef), new Weapon(WEAPON_DEFS['suzume']!)];

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
  }

  // ポストプロセス: medium/high のみ Render→Bloom→SMAA→Output の最小4パス。
  // low(WebGL1含む)は composer を作らず render() が素のレンダラへフォールバックする。
  private buildComposer(tier: GraphicsQuality): void {
    if (tier === 'low') return;
    const p = this.config.stage.palette;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      p.bloomStrength ?? 0.5, // strength: 真の発光体だけ拾う控えめな値
      0.4, // radius
      p.bloomThreshold ?? 0.85, // threshold
    );
    composer.addPass(bloom);
    composer.addPass(new SMAAPass(size.x, size.y));
    composer.addPass(new OutputPass()); // AgX+exposure+sRGB を renderer から自動適用
    this.composer = composer;
  }

  get activeWeapon(): Weapon {
    return this.weapons[this.activeIndex] ?? this.weapons[0]!;
  }

  private buildStageScene(boxes: ReturnType<typeof generateStage>['boxes']): void {
    const palette = this.config.stage.palette;
    const size = this.config.stage.size;
    // Sky.js を可視背景にするため background は使わない
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(palette.fog, palette.fogDensity);

    // 太陽方向の単一の真実(空・日光・影カメラ・フォグの暖寒を1本のベクトルが駆動)
    const elevation = palette.elevation ?? 35;
    const azimuth = palette.azimuth ?? 170;
    this.sunDir.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - elevation),
      THREE.MathUtils.degToRad(azimuth),
    );

    // IBL(scene.environment)と二重になるため Hemi は控えめに
    const hemi = new THREE.HemisphereLight(
      palette.sky,
      palette.floor,
      palette.ambientIntensity * 0.55,
    );
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(palette.lightColor, palette.lightIntensity);
    sun.position.copy(this.sunDir).multiplyScalar(size); // 見える太陽と影方向を一致させる
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
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
          material.emissiveIntensity = 0.7; // AgX+Bloom前提で白飛びを抑える
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
        accentMat.emissiveIntensity = 0.9; // AgX+Bloom前提
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
    this.scene.environmentIntensity = palette.environmentIntensity ?? (elevation < 6 ? 0.4 : 0.85);
    envSky.geometry.dispose();
    (envSky.material as THREE.Material).dispose();
    pmrem.dispose();

    // フォグ色を空の地平側へ寄せ、空とフォグの境目を目立たなくする
    if (this.scene.fog) (this.scene.fog as THREE.FogExp2).color.lerp(new THREE.Color(palette.sky), 0.35);

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
      emissiveIntensity: 0.9, // AgX+Bloom前提
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
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      // ミッションは時間到達で勝敗確定: survive/defend は勝利、その他の目的は時間切れ=失敗
      if (this.mission && this.missionOutcome === 'pending') {
        const k = this.mission.objective.kind;
        this.missionOutcome = k === 'survive' || k === 'defend' ? 'won' : 'lost';
      }
      this.over = true;
      return;
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
    if (this.settings.crouchToggle && crouchPressed) this.crouchLatch = !this.crouchLatch;
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
    // scope-inの立ち上がりでレンズ音
    const scopeProg = weapon.def.scope ? weapon.adsProgress : 0;
    if (this.prevScopeProgress < 0.5 && scopeProg >= 0.5) this.sounds.scopeIn();
    // 覗き込み開始時刻を記録(クイックスコープ=覗いてすぐ撃つ、の判定に使う)
    if (this.prevScopeProgress <= 0.02 && scopeProg > 0.02) this.lastAdsStartMs = performance.now();
    this.prevScopeProgress = scopeProg;

    this.updateGrenades(dt);
    this.updateFirePatches(dt);
    this.smokeZones = this.smokeZones.filter((zone) => zone.until > this.elapsed);
    this.updateZones(dt);

    if (!this.player.alive && this.killcamTimer > 0) this.killcamTimer -= dt;

    this.updateBots(dt);
    this.physics.step();
    this.syncCamera();
    this.handleRespawns();

    // プレイヤー死亡の立ち下がりでメダル連続系をリセット(復讐対象=直近のkiller)
    if (this.lastAlive && !this.player.alive) {
      this.tracker.onPlayerDeath(this.killer?.name ?? null);
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
    this.sounds.setCombatHeat(Math.min(1, heat));
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

      // エイムアシスト: スコープ覗き込み中、視認できる最寄りの敵へ微吸着する。
      // 強い入力(フリック/対象切替)中は弱め、決してハードロックしない
      this.aimAssistEngaged = false;
      this.aimAssistTargetDir = null;
      // ゲームパッド時は全武器・ヒップでもアシスト(BO3準拠)。マウスはスコープ武器のADS時のみ
      const gp = this.input.lastDevice === 'gamepad';
      const assistActive =
        this.settings.aimAssist &&
        this.player.alive &&
        ((weapon.def.aimAssist === true && weapon.adsProgress > 0.5) || gp);
      const target = assistActive ? this.aimAssistTarget(weapon.def.range) : null;
      // スローダウンと吸着の両方を同じgateで滑らかに立ち上げる(0.5境界での段差防止)
      const adsGate = THREE.MathUtils.smoothstep(weapon.adsProgress, 0.5, 1);
      const gate = Math.max(adsGate, gp ? HIP_GATE : 0);
      let slow = 1;
      if (target) {
        slow = slowdownFactor(
          target.angle,
          ACQUIRE_CONE_DEG * DEG,
          0.5 * this.settings.aimAssistStrength * gate,
        );
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

      // 回転エイムアシスト用: 対象の方位変化(角速度)を算出
      let targetYawRate = 0;
      if (target) {
        if (this.raaPrevTarget === target.bot) {
          targetYawRate = wrapAngle(target.yaw - this.raaPrevBearing) / Math.max(dt, 1e-4);
        }
        this.raaPrevTarget = target.bot;
        this.raaPrevBearing = target.yaw;
      } else {
        this.raaPrevTarget = null;
      }

      if (target) {
        const inputMag =
          Math.hypot(this.input.mouseDX, this.input.mouseDY) + this.input.gpLookMag * 40;
        const inputDamp = THREE.MathUtils.clamp(1 - inputMag / 40, 0.15, 1);
        // 部位別プル係数: 頭/脚への引き込みは弱め(head0.9/chest1.0/waist0.8/limb0.6)
        const strength =
          this.settings.aimAssistStrength * gate * inputDamp * PART_PULL_SCALE[target.part];
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
        // 回転アシスト(スティックを倒している間だけ、対象の横移動に追従)
        if (gp) {
          this.player.yaw += rotationalAssist(
            targetYawRate,
            this.input.gpLookMag,
            this.settings.aimAssistStrength * gate,
            dt,
            this.settings.gamepadDeadzone,
          );
        }
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
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
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
    const scopeReveal = weapon.def.scope
      ? THREE.MathUtils.smoothstep(weapon.adsProgress, 0.55, 0.9)
      : 0;

    // レンジファインダー: 照準中心レイで、見ている地点までの距離を測る
    if (weapon.def.scope === true && weapon.adsProgress > 0.5 && this.player.alive) {
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
    });
    this.effects.update(vmDt);
  }

  private syncCamera(): void {
    // 死亡直後はキルカメラ: 倒した相手の視点から自分の倒れた地点を見せ、
    // どこから撃たれたのかを伝える。相手が倒れたら観戦カメラへ移る
    if (!this.player.alive && this.deathPos) {
      if (this.killcamTimer > 0 && this.killer?.alive) {
        this.camera.position.copy(this.killer.headPosition());
        this.camera.lookAt(this.deathPos.x, this.deathPos.y + 0.6, this.deathPos.z);
        return;
      }
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
        if (part === 'body') {
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
    const died = bot.takeDamage(damage);
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
    for (const bot of this.bots) {
      const targetEye = bot.alive && bot.blind <= 0 ? this.findTargetFor(bot) : null;
      bot.update(dt, {
        targetEye,
        objective: bot.alive ? this.objectiveFor(bot) : null,
        tuning: bot.tuning,
        rand: this.rand,
        onShoot: (origin, dir) => this.botShoot(bot, origin, dir),
      });
    }
  }

  // 視界内で最も近い敵対エンティティの目の位置。誰も見えなければnull
  private findTargetFor(bot: Bot): THREE.Vector3 | null {
    const head = bot.headPosition();
    let best: THREE.Vector3 | null = null;
    let bestDist = bot.tuning.viewDistM;

    if (this.player.alive && bot.team !== PLAYER_TEAM) {
      const eye = this.player.eyePosition;
      const dist = head.distanceTo(eye);
      if (dist < bestDist && this.botCanSee(bot, head, eye, null)) {
        best = eye;
        bestDist = dist;
      }
    }
    for (const other of this.bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const eye = other.headPosition();
      const dist = head.distanceTo(eye);
      if (dist < bestDist && this.botCanSee(bot, head, eye, other)) {
        best = eye;
        bestDist = dist;
      }
    }
    return best;
  }

  // targetBotがnullならプレイヤーを対象として視線判定する
  private botCanSee(
    bot: Bot,
    head: THREE.Vector3,
    eye: THREE.Vector3,
    targetBot: Bot | null,
  ): boolean {
    if (this.smokeBlocks(head, eye)) return false;
    const toTarget = eye.clone().sub(head);
    const distance = toTarget.length();
    const dirNorm = toTarget.normalize();
    const inCone = bot.alert > 0 || bot.facing().dot(dirNorm) > BOT_VIEW_CONE_COS;
    if (!inCone) return false;
    const hit = this.castRay(head, dirNorm, distance - 0.2, bot.body);
    if (hit === null) return true;
    const tag = this.tags.get(hit.collider.handle);
    if (targetBot === null) return tag?.kind === 'player';
    return tag?.kind === 'bot' && tag.bot === targetBot;
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
    let bestAngle = ACQUIRE_CONE_DEG * DEG;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const base = bot.position; // カプセル中心(新規ベクトル)
      // 角度の近い順に並んだ候補を、可視が取れるまで走査する=最近接の可視部位
      const ranked = rankAimPoints(eye, forward, base, AIM_PARTS, maxRange);
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

    // 発砲音は方向と距離をつけて鳴らす
    const { pan, distance } = this.panAndDistance(origin);
    this.sounds.enemyShot(pan, distance);

    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    const damage = damageAtDistance(tuning.damage, hitToi(hit), BOT_FALLOFF);

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
      const died = tag.bot.takeDamage(damage);
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
  }

  private alertBots(radius: number): void {
    const pos = this.player.position;
    for (const bot of this.bots) {
      if (bot.alive && bot.team !== PLAYER_TEAM && bot.position.distanceTo(pos) < radius) {
        bot.alert = 4;
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

  // グラビティスラムで周囲の敵を吹き飛ばし、オーバードライブを起動する
  private activateUltimate(): void {
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
    // ストーリーでは敵を復活させない(撃破で波が確実に減る)
    if (!this.mission) {
      for (const bot of this.bots) {
        if (!bot.alive && bot.respawnIn <= 0) {
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
  ): Bot {
    const bot = new Bot(this.physics, name, spawn, color, tuning, team, tier);
    this.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
    this.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
    this.scene.add(bot.group);
    this.bots.push(bot);
    return bot;
  }

  private aliveEnemyCount(): number {
    let n = 0;
    for (const b of this.bots) if (b.alive && b.team === ENEMY_TEAM) n += 1;
    return n;
  }

  // ミッション開始時の準備: 濃霧・脱出地点・第1波
  private setupMission(mission: MissionDef): void {
    if (this.modifierSet.has('dense-fog') && this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = Math.min(0.12, this.scene.fog.density * 2.6 + 0.012);
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
        const name =
          tier === 'boss'
            ? (this.mission?.objective.bossName ?? 'BOSS')
            : (BOT_NAMES[n % BOT_NAMES.length] ?? `EN-${n}`);
        this.spawnBot(name, spawn, this.colors.enemy, ENEMY_TEAM, tuningFor(tier, group.difficulty), tier);
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
    const spec = GRENADE_SPECS[this.grenadeKind];
    const cookWindow = spec.fuseS - COOK_SAFETY_S;
    const snapshot: MatchSnapshot = {
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      alive: this.player.alive,
      respawnIn: Math.max(0, this.player.respawnIn),
      ammo: weapon.magazine.rounds,
      reserve: weapon.magazine.reserve,
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
