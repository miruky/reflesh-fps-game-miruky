import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import { mulberry32, type Rand } from '../core/rng';
import { RADAR_RANGE_M, resolveGraphicsTier, type GraphicsQuality, type Settings } from '../core/settings';
import { Effects } from '../render/effects';
import { ViewModel, buildGunBody, CamoStandardMaterial } from '../render/viewmodel';
import { ZombieCrowdRenderer, ZOMBIE_CROWD_INSTANCED } from '../render/zombie-crowd';
import {
  ACQUIRE_CONE_DEG,
  adsSensScale,
  aimAssistDelta,
  AIM_PARTS,
  DRONE_AIM_PARTS,
  TANK_AIM_PARTS,
  TURRET_AIM_PARTS,
  type PartOffset,
  bulletBendFraction,
  BULLET_MAG_CONE_DEG,
  BULLET_MAG_MAX_DEG,
  BULLET_MAG_CONE_SCOPED_DEG,
  BULLET_MAG_MAX_SCOPED_DEG,
  SNIPER_SNAP_CONE_DEG,
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
  ZOMBIE_KCC_LOD_NEAR_M,
  type BotKind,
  type BotTier,
  type BotTuning,
  type ZombieCrowdPose,
} from './bot';
import type { BossPhase, EnemyWaveDef, MissionDef, ObjectiveDef, RadioLine, RadioSpeaker } from './campaign';
import {
  SndMatch,
  SndRound,
  isWithinSndSite,
  makeSndSites,
  SND_FUSE_S,
  type SndSite,
} from './snd';
import { deriveSurfaceMaterials } from './materials';
import { closestApproach } from './whizz';
import { Atmosphere, resolveMood, resolveGrade } from '../render/atmosphere';
import { createGradePass } from '../render/grade';
import { PostFXPass } from '../render/postfx';
import { N8AOPass } from 'n8ao';
import { GodRaysPass } from '../render/godrays';
import { AdsDofPass } from '../render/dof';
import { patchPcss, unpatchPcss, isPcssPatched } from '../render/pcss';
import { AutoExposure } from '../render/exposure';
import type { PropMatFamily } from '../render/prop-visuals';
import { floorDetailGlsl, floorDetailGlslCommon } from '../render/surface-kit';
import { KillcamController, FK_WIN_POST } from './killcam';
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
  GG_BOT_RANK_TUNING,
  GG_LADDER,
  GunGameState,
  HardpointState,
  KillConfirmState,
  MODE_DEFS,
  PLAYER_TEAM,
  ScoreBoard,
  TrainingStats,
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
  zombieTotal,
  isBossRound,
  zombieBossHp,
  zombieBossSpeedMul,
  zombieBossDamage,
  specialRoundKind,
  RUSH_HP_MUL,
  RUSH_CLEAR_BONUS_PT,
} from './zombie';
import {
  generateShopLayout,
  purchasePerk,
  buyResult,
  rollMysteryBox,
  canBuy,
  composeZombieWeaponDef,
  PERKS,
  POINTS,
  MYSTERY_BOX_COST,
  PAP_COST,
  PAP_REFILL_COST,
  DOOR_COST,
  rollPowerUp,
  POWERUP_ROUND_CAP,
  POWERUP_DURATION_S,
  POWERUP_DESPAWN_S,
  NUKE_BONUS_PT,
  CARPENTER_BONUS_PT,
  rollZombieVariant,
  BLAST_RADIUS_M,
  BLAST_DMG,
  MIASMA_RADIUS_M,
  MIASMA_DURATION_S,
  MIASMA_DPS,
  SHELL_FRONT_REDUCTION,
  getCharmEffect,
  type ShopLayout,
  type ShopSlot,
  type ZombiePerkId,
  type PapTier,
  type PowerUpKind,
  type CharmEffect,
  LAST_ZOMBIE_PERK_KEY,
} from './zombie-economy';
import { weaponIdByName, equippedCamoFor, CAMO_VISUALS } from './camo';
import { loadProfile } from '../core/profile';
import {
  generateStage,
  type StageDef,
  type MoodId,
  type PropPlacement,
} from './stage';
import { StreakManager, STREAK_DEFS, type StreakIndex } from './scorestreaks';
import { type SurfaceMaterial } from './materials';
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

// ── R54-W1 F1: match.ts分割リレー第1段 — 純関数クラスタを機能別モジュールへ抽出 ──
// 実装は weather.ts / match-helpers.ts / prop-visual-plan.ts へ「移動のみ」。既存のimport元
// (hud/menu/main/テスト8本)を無破壊にするため、公開面はここから re-export して維持する
// (match-golden.test.ts がこの表面を固定している)。
export { rollWeather } from './weather';
export type { WeatherKind } from './weather';
export {
  spawnDistScore,
  hotspotEma,
  bowChargeMultiplier,
  fanPelletYaw,
  minigunNextRpm,
  EXT_MAG_EXCLUDED_IDS,
  PAP_CAMO_BY_TIER,
  applyHellTuning,
  papInteractSealed,
  ninjaHp300Eligible,
  permanentDarkEmperorEligible,
  instaKillApplies,
  papTierAfterWallBuy,
  applyHellTierTuning,
  emperorChargeStageFor,
  isCrowdEligible,
  crowdSlotAction,
  applyMissionDifficultyTuning,
  splitRadioLines,
  resolveNaturalBotKind,
  shadowLodFlags,
  zombieHordeRanks,
  refundRound,
  shurikenDiscLife,
} from './match-helpers';
export {
  planPropVisualsV2,
  buildPropVisualFamilyGeometries,
  buildPropFamilyMaterial,
  propFamilyShadowFlags,
  prewarmSurfaceKitVariants,
  floorDetailEligible,
} from './prop-visual-plan';
export type { PrewarmRenderer } from './prop-visual-plan';
export { ckCamPos, ckSpeedAt, fkIsStale } from './killcam';
import { rollWeather } from './weather';
import type { WeatherKind } from './weather';
import {
  spawnDistScore,
  hotspotEma,
  bowChargeMultiplier,
  fanPelletYaw,
  minigunNextRpm,
  EXT_MAG_EXCLUDED_IDS,
  PAP_CAMO_BY_TIER,
  applyHellTuning,
  papInteractSealed,
  ninjaHp300Eligible,
  permanentDarkEmperorEligible,
  instaKillApplies,
  papTierAfterWallBuy,
  applyHellTierTuning,
  emperorChargeStageFor,
  isCrowdEligible,
  crowdSlotAction,
  applyMissionDifficultyTuning,
  splitRadioLines,
  resolveNaturalBotKind,
  shadowLodFlags,
  zombieHordeRanks,
  refundRound,
  shurikenDiscLife,
} from './match-helpers';
import {
  planPropVisualsV2,
  buildPropVisualFamilyGeometries,
  buildPropFamilyMaterial,
  propFamilyShadowFlags,
  prewarmSurfaceKitVariants,
  floorDetailEligible,
} from './prop-visual-plan';




// R20 rank3: 床/障害物の onBeforeCompile へ挿す決定論的な値ノイズ(3オクターブfbm)。
// ワールドXZから摩耗/汚れ/濡れパッチのマクロ質感を作る。追加DC/ジオメトリはゼロ、
// フラグメントALUのみ。フラグメント/頂点の #include <common> 直後へ差し込んで使う。
const MACRO_NOISE_GLSL = /* glsl */ `
  float macroHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float macroVnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = macroHash(i);
    float b = macroHash(i + vec2(1.0, 0.0));
    float c = macroHash(i + vec2(0.0, 1.0));
    float d = macroHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float macroFbm(vec2 p) {
    float s = 0.0;
    float amp = 0.5;
    float tot = 0.0;
    for (int oct = 0; oct < 3; oct++) {
      s += amp * macroVnoise(p);
      tot += amp;
      p = p * 2.03 + 11.0;
      amp *= 0.5;
    }
    return s / tot;
  }
`;

const DEG = Math.PI / 180;
const EXOTIC_HOLD_FIRE_IDS = new Set(['banjin-smg', 'fujin-fan', 'gouen-musket', 'shinkirou-sniper']);
const MIASMA_TICK_S = 0.5; // 毒雲DPSの離散ティック間隔(FIRE_TICK_Sと同じ流儀)
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
// R29: プレイヤー追従シャドウボックスの半径(m)。マップサイズ非依存の影テクセル密度を保つ
const SHADOW_FOLLOW_HALF = 70;
const MELEE_DAMAGE = 75;
const MELEE_COOLDOWN = 0.8;
// ── クナイ(ニンジャ・ダガー)専用パラメータ(素手=id 'fists' 装備時のみ) ──
const DAGGER_MELEE_RANGE = 3.2; // 薙ぎ払いのリーチ(拳の 2.6 より広い)
const DAGGER_MELEE_CONE = 0.34; // 前方コーンの内積しきい値(約±70°=広い薙ぎ払い)
// ── 黒技・シュヴァルツヴァルト(M ウルト: fists装備時のみ) ──
const SCHWARZWALD_DAMAGE = 800;     // 発動時の全域ダメージ(遮蔽無視)
const DARK_EMPEROR_DURATION = 300;  // 黒帝モードの持続秒(5分)
const DARK_EMPEROR_MUL_MELEE = 3;   // 通常攻撃/薙ぎ払いのダメージ倍率
const DARK_EMPEROR_MUL_BLINK = 3;   // ブリンク斬撃のダメージ倍率
const DARK_EMPEROR_MUL_SLAM = 4;    // ダイブスラムのダメージ倍率
const DARK_EMPEROR_MUL_ULTS = 2;    // F/B/N ウルトのダメージ倍率
const DARK_BLINK_RANGE = 10;        // 黒帝中のブリンク射程(通常7→10m)
const DARK_EMPEROR_COLOR = 0x1a0030;// 黒帝中の三日月/衝撃波の暗色
const DARK_SLASH_SPEED = 160; // R31: スナイパー級=マップ端まで約3秒
const DARK_SLASH_RANGE = 800; // R31: エリアどこからどこでも届く(描画距離と同値)
const DARK_SLASH_RADIUS = 5.0;    // m ヒット円柱半径(②倍サイズ化)
const DARK_SLASH_DAMAGE = 350;    // ダメージ(固定) — ③黒雷帝強化: 250→350
// R53-W2 M2b: 帝王編ボスの敵対斬撃(プレイヤー被弾)。34=HP100の1/3で「2発は耐えるが3発目が致命」。
// 回避猶予: 発射間隔4s×速度160m/s(视认後の横移動で十分躱せる)。missionDifficultyはbossPhase側で
// damageMul として乗る(dmgOverride経由)ためここは基準値
const HOSTILE_SLASH_DAMAGE = 34;
// ボスblink転移のプレイヤー側面オフセット(m)と周期、黒雷柱の落下ダメージ/半径
const BOSS_BLINK_OFFSET_M = 6;
const BOSS_PILLAR_DAMAGE = 60;
const BOSS_PILLAR_RADIUS_M = 2.2;
const DARK_SLASH_MAX = 8;         // 同時存在上限
// ── ⑤ 雷帝/黒雷帝 AoE 攻撃 ──
const LIGHTNING_AOE_RADIUS = 7;           // 通常攻撃 AoE 半径(m)
const LIGHTNING_AOE_DAMAGE = 180;         // 通常攻撃 AoE ダメージ
const LIGHTNING_AOE_RADIUS_CHARGED = 22;  // 溜め最大時 AoE 半径
const LIGHTNING_AOE_AIM_RANGE = 60;       // 照準先レイキャストの最大距離(m)
const KOKURAITEI_AOE_DAMAGE = 300;        // 黒雷帝通常攻撃 AoE ダメージ — ③: 220→300
// ── 黒雷帝バフ ──
const KOKURAITEI_SPEED_MUL = 1.15;       // 移動速度+15%
const KOKURAITEI_DAMAGE_RESIST = 0.3;    // 被ダメ-30%
// ── 雷帝溜め最大: 超範囲多段落雷 ──
const RAITEI_CHARGE_COUNT_MIN = 12;      // 落雷本数(最小)
const RAITEI_CHARGE_COUNT_MAX = 16;      // 落雷本数(最大)
const RAITEI_CHARGE_SCATTER_R = 40;      // 散布半径(m)
const RAITEI_CHARGE_DMG = 120;           // 各落雷ダメージ(雷帝)
const RAITEI_CHARGE_DURATION = 1.2;      // 全落雷が落ちきるまでの秒数
const RAITEI_CHARGE_HIT_MAX = 3;         // 同一敵への最大ヒット回数
const RAITEI_CHARGE_IMPACT_R = 7;        // 各落雷の命中半径(m)
const KOKURAITEI_CHARGE_DMG = 150;       // 各落雷ダメージ(黒雷帝)
const SHINGETSU_DAMAGE = 1500;    // 真月 ステージ全体ダメージ
const SHINGETSU_CHARGE_S = 0.4;   // 真月 溜め秒数
const BLINK_RANGE = 7; // ブリンク斬撃の瞬間移動距離(m)。壁の手前で停止
const BLINK_DAMAGE = 130; // ブリンク斬撃で経路上の敵を切り裂くダメージ
const BLINK_RADIUS = 1.8; // ブリンク経路(線分)の判定太さ(m)
const BLINK_COOLDOWN = 0; // ブリンク斬撃のクールダウン(0=即連発。神化仕様)
const NINJA_ULT_RADIUS = 12; // 素手ウルトの衝撃波半径(接地でも即発動)
const NINJA_ULT_DAMAGE = 260; // 素手ウルト衝撃波の中心ダメージ
const BOT_VIEW_DISTANCE = 60;
const BOT_VIEW_CONE_COS = Math.cos((75 * Math.PI) / 180);
// ── ① 戦闘引力(battle gravitation)──
// 直近の戦闘イベント(キル/発砲/被弾)位置のEMAを非交戦botの徘徊目標に供給する。
const HOTSPOT_DECAY_S = 10; // 最後の戦闘イベントからこの秒数でホットスポット失効
const HOTSPOT_ARRIVE_M = 25; // 到達圏。これ以内に入ったら通常の局所徘徊へ戻す
// ── 敵AI気配システム(P-E): 敵bot60%にプレイヤー周辺の気配点を30秒バケット毎に供給 ──
const GHOST_REFRESH_S = 30; // 気配点を更新するバケット長(s)
const GHOST_FUZZ_M    = 15; // プレイヤー位置からの最大オフセット(m)。最小は5m固定
const GHOST_ARRIVE_M  = 8;  // この距離以内で到達とみなし、同バケット内は通常徘徊へ戻す
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
const ZOMBIE_MOVE_MUL = 1.44; // 基準速度に対するシャンブル倍率(走行個体は updateZombie で×1.6)
const ZOMBIE_MELEE_GLOBAL_GAP = 0.35; // 何体いても近接ダメージはこの間隔以上(同フレーム多段一撃回避)
const ZOMBIE_IFRAME = 0.5; // 近接被弾後のプレイヤー無敵時間
const ZOMBIE_ROUND_COOLDOWN = 0.8; // ラウンドクリア後、次ラウンドまで(即次波: ジングルのみ)
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
    case 'master':
      return '達人・突撃銃';
    case 'giant':
      return '巨躯の一撃'; // 巨躯は近接のみ(updateGiantは発砲経路を持たない)
    default: {
      const _exhaustive: never = killer.kind;
      return _exhaustive;
    }
  }
}


// ★1 影LOD: 全モードでプレイヤー最近接この体数のみ castShadow=true(影DCを一定に保つ)
const SHADOW_CASTER_CAP = 8;
// ★8 アニメLOD発動距離(この距離を超えたbotはsyncMeshのsin群をスキップ)
const ANIM_LOD_DIST_M = 50;
// ★ ゾンビメッシュプール: high tierの最大同時生存数までプールを事前確保(108体)
const ZOMBIE_POOL_MAX = ZOMBIE_MAX_ALIVE.high;
// F8 手裏剣discの飛行速度(m/s)。fireShurikenDiscのvelと寿命クランプの単一の真実
const SHURIKEN_DISC_SPEED = 60;
// ★4a aimAssistTarget粗ゲート用: AIM_PARTS/DRONE/TANK/TURRET全kindのdy絶対値の最大。
// 中心(bot.position)基準のレンジ/コーン判定にこの分だけマージンを持たせ、部位オフセットで
// 本来ヒットし得た候補を誤って弾かないことを保証する。
// V-W1レビュー: 全巨躯ゾンビはhead dy=0.88×1.35=1.188 が最大(TANKの1.0を上回る)→1.2に拡大
const AIM_PART_DY_MARGIN_M = 1.2;

// V-W1レビューC: スケール付きゾンビ(全巨躯 tuning.scale=1.35)は頭コライダーが scale 倍の
// 高さ/半径で生成される(bot.ts)ため、エイムアシストの head 部位オフセットも同倍率にしないと
// スナップ点が「胴カプセル上端と頭下端の隙間」へ落ちて頭に乗らない。scale値ごとに1回だけ
// 派生配列を生成してキャッシュ(head以外=胴カプセルは無スケールなので dy 据え置き)。
const scaledZombieAimPartsCache = new Map<number, readonly PartOffset[]>();
function zombieAimPartsForScale(scale: number): readonly PartOffset[] {
  if (scale === 1) return AIM_PARTS;
  let parts = scaledZombieAimPartsCache.get(scale);
  if (!parts) {
    parts = AIM_PARTS.map((p) => (p.part === 'head' ? { ...p, dy: p.dy * scale } : p));
    scaledZombieAimPartsCache.set(scale, parts);
  }
  return parts;
}
// ★5 ホットパス用スクラッチ(bot.getPositionInto の受け皿。逐次利用のみ=エイリアス無し)
const BOT_POS_SCRATCH = new THREE.Vector3();
// R53-W3 M3: ゾンビ群feed用の姿勢スクラッチ(pose()が値を読み切るため使い回し可)
const CROWD_POSE_SCRATCH: ZombieCrowdPose = {
  x: 0, y: 0, z: 0, visualLift: 0, rigLiftY: 0, scale: 1, heading: 0,
  walkPhase: 0, walkAmp: 0, anim: 0, bobPhase: 0, deathTilt: 0, dying01: 0,
  visible: true, elite: false,
};
// T7 ホットループGC節約: bot.position系の一時差分ベクトル(足音オクルージョン判定・スタン
// スパーク位置)専用スクラッチ。他の用途と時分割共有しない(同フレーム内で使い切って捨てる値のみ)
// ★V-D修正: 黒転フォグlerp用スクラッチ(per-frameアロケ排除)
const KOKURAI_FOG_SCRATCH = new THREE.Color();
const KOKURAI_FOG_TARGET = new THREE.Color(0x0a0114);
const HOT_DIFF_SCRATCH = new THREE.Vector3();
// T7: bot.alertPos/lkp/lastTargetEye は Vector3|null の永続フィールド。既存インスタンスが
// あれば copy で使い回し、null のときだけ新規確保する(初回のみアロケーション、以降ゼロ割り当て)
function reuseVec3(cur: THREE.Vector3 | null, src: THREE.Vector3): THREE.Vector3 {
  if (cur) {
    cur.copy(src);
    return cur;
  }
  return src.clone();
}

// R12軽量化: bloomを半解像で処理する。EffectComposer.addPass/setSize がフル実効サイズで
// pass.setSize を強制するため、サブクラスで毎回半分へ丸めて bright/blur を面積1/16(現状1/4)へ。
// 合成加算はフル解像 readBuffer を読むので出力はフル解像=見た目維持で bloom実質-40〜50%。
class HalfBloom extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.ceil(width * 0.5), Math.ceil(height * 0.5));
  }
}

// ── 試合の公開型(実体は match-types.ts — R54-W1 F1で型のみ移動、ランタイム影響ゼロ) ──
export type {
  MatchConfig,
  FeedEntry,
  MomentEvent,
  DamageNumber,
  ScoreRow,
  ZoneView,
  MatchResult,
  MatchSnapshot,
} from './match-types';
import type {
  MatchConfig,
  FeedEntry,
  MomentEvent,
  DamageNumber,
  ScoreRow,
  ZoneView,
  MatchResult,
  MatchSnapshot,
} from './match-types';

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
  | { kind: 'boundary' }   // ghost 壁専用(弾/視線/斬撃が素通り, ブリンク/KCCは止まる)
  | { kind: 'player' }
  | { kind: 'bot'; bot: Bot; part: HitPart }
  | { kind: 'trainingTarget'; target: TrainingTarget; part: 'head' | 'body' };

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

interface DarkSlashWave {
  group: THREE.Group;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  traveled: number;
  hitSet: Set<number>; // 既ヒット bot.uid(多段ヒット防止)
  smokeTimer: number;
  chargeScale?: number; // 溜め比率(0-1)。未設定=通常斬撃
  hitRadius: number;    // ヒット円柱の水平半径(m)。通常=DARK_SLASH_RADIUS、溜め=lenM/2(刃の横幅/2)
  dmgOverride?: number; // ダメージ上書き(設定時 DARK_SLASH_DAMAGE の代わりに使用)
  // R53-W2 M2b: 敵(帝王編ボス)起点の斬撃。true のとき bot ヒット判定を行わず、
  // プレイヤーへの単発ヒット(hitPlayer ラッチ)だけを判定する
  hostile?: boolean;
  hitPlayer?: boolean;
  hostileOwnerName?: string; // 死亡フィード用のボス名
}

// 訓練場ターゲット(bot非使用の軽量エンティティ)
interface TrainingTarget {
  group: THREE.Group;
  body: RAPIER.RigidBody;
  bodyCollider: RAPIER.Collider;
  headCollider: RAPIER.Collider;
  hp: number;
  isDown: boolean;
  downTimer: number;
  kind: 'static' | 'moving' | 'popup';
  moveDir: number;
  moveSpeed: number;
  moveRange: number;
  moveOriginX: number;
  moveOriginZ: number;
  /** right軸方向ベクトル(XZ平面, 往復運動の軸) */
  moveRightX: number;
  moveRightZ: number;
}

// BF5簡易破壊可能プロップ: buildStageScene で個別メッシュ+コライダーを生成し登録。
// 'world' タグのままにして既存の弾道/爆発/視線ロジックと整合させ、
// breakableProps マップで HP 管理+破壊演出を担う。
interface BreakableProp {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pos: THREE.Vector3; // ワールド中心座標(body.translation()の静的キャッシュ)
  colorHex: number;   // THREE 16進数色(デブリ演出用)
  w: number;
  h: number;
  d: number;
  hp: number;
  maxHp: number;
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

  // ── ① 戦闘引力: ホットスポット追跡 ──
  private readonly hotspotPos = new THREE.Vector3();  // 直近戦闘位置のEMA
  private hotspotLastT = -Infinity;                    // 最後の戦闘イベント elapsed
  // ── 敵AI気配システム(P-E) ──
  private readonly botGhostUpdateBucket = new Map<number, number>(); // uid → 最後に処理したバケット番号
  private readonly botGhostPos          = new Map<number, THREE.Vector3>(); // uid → 気配目標位置
  // ── ③ 発砲ブリップ ──
  private readonly _fireBlips: Array<{ x: number; z: number; spawnedAt: number; botUid: number }> = [];
  private readonly _fireBlipLastT = new Map<number, number>(); // botUid → 最後のブリップ elapsed

  private readonly modeDef: ModeDef;
  private readonly scores: ScoreBoard;
  private readonly domination: DominationState | null;
  private readonly zoneCenters = new Map<string, THREE.Vector3>();
  private readonly zoneRings = new Map<string, THREE.Mesh>();
  // ── ハードポイント ──
  private readonly hardpointState: HardpointState | null;
  private readonly hardpointZonePositions: THREE.Vector3[] = [];
  private hardpointRing: THREE.Mesh | null = null;
  // ── キルコンファーム ──
  private readonly kcState: KillConfirmState | null;
  private kcDogTagEntities: Array<{ id: number; group: THREE.Group; isEnemy: boolean; spawnedAt: number }> = [];
  // ── ガンゲーム ──
  private readonly ggState: GunGameState | null;
  private ggRankUpFlash = false;  // このフレームにランクアップした(snapshot消費型)
  private ggSetback = false;      // このフレームに setback した(snapshot消費型)
  private kcEvent: 'confirmed' | 'denied' | null = null;
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
  private killSurgeEnv = 0; // R20: キル確定サージのエンベロープ 0..1(キルで1へ、毎フレーム減衰)
  private postfxGrade = 0; // R21: Teal & Orange グレーディング強度(high=0.3, low/mid=0)
  private darkAuraEnv = 0; // R27: 黒帝オーラビネット封筒 0..1(黒帝中のみ > 0)
  private readonly hitDir = new THREE.Vector2(0, 0); // R20: 被弾方向(画面空間の単位ベクトル・平滑)
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
  // カモチャレンジ用: 武器IDごとのプレイヤーキル/ヘッドショットキル(近接・投擲は対象外)
  private readonly playerKillsByWeapon: Record<string, number> = {};
  private readonly playerHsByWeapon: Record<string, number> = {};

  // ── 素手(武器なし)の格闘状態 ──
  private punchStep = 0; // ラッシュコンボの段(0..3)
  private punchWindowS = 0; // コンボ継続の残り秒。切れたら1段目へ戻る
  private slamPending = false; // ダイブスラム降下中(着地で衝撃波)
  private slamStartY = 0; // 降下開始高さ(ダメージスケール用)
  private slamCooldownS = 0; // ダイブスラムの再発動クールダウン(連打支配の防止)
  private blinkCooldownS = 0; // ADSブリンク斬撃の再発動クールダウン
  private punchMotion = 0; // クナイ斬撃モーションサイクル(0=右薙ぎ/1=左薙ぎ/2=突き)
  // ── 黒技・シュヴァルツヴァルト ──
  private darkEmperorTimer = 0; // 黒帝モードの残り秒(0=非発動)
  private darkSmokeTimer = 0;   // 足元黒煙エミッタの次発生タイマー
  // ── 黒帝通常攻撃: 黒い斬撃波 ──
  private darkSlashWaves: DarkSlashWave[] = [];
  // ── 黒技奥伝・真月 ──
  private shingetsuPhase: 'idle' | 'charge' | 'release' = 'idle';
  private shingetsuTimer = 0;
  // ── ⑤ 雷帝/黒雷帝モード ──
  private raiteiMode = false;      // N ウルト発動後に永続
  private kokuraiteiMode = false;  // M 3連押し(1.5s内)で永続
  // ── ② 溜め攻撃 ──
  private chargeTimer = 0;         // 保持秒数(0=非溜め)
  private chargeTickTimer = 0;     // 溜め中の音周期カウントダウン
  private isCharging = false;      // 溜め中フラグ
  // ── ④ 常闇カモ ──
  private tokoyamiActive = false;  // 常闇カモ装備中(darkEmperorTimer を永続化)
  // ── 雷帝溜め多段落雷キュー ──
  private raiteiChargeStrikes: Array<{
    t: number;
    center: THREE.Vector3;
    hitCounts: Map<number, number>;
    dmg: number;
  }> = [];
  // ── ポーズ遷移検出(雷帝ハム自動停止) ──
  private _prevFramePlaying = true;
  // ── 月花雷轟 / 極雷絶滅 ──
  private geppaRaigouTimer = 0;    // 嵐演出残り秒
  private geppaRaigouDmgTimer = 0; // 波状ダメージ周期
  private gokuraiZetsumetsuTimer = 0; // 極雷演出残り秒
  // ── triple-M 黒雷帝化(即時発動+連打カウント方式。遅延ディスパッチは廃止) ──
  private mPressTimestamps: number[] = []; // 直近の M キー押し時刻(秒, this.elapsed 基準)
  private mTripleArmed = false;    // 窓内の1押し目が実際にウルトを発動した(=ゲージ満タンだった)か
  // ── R33 黒雷帝 ambient pack ──
  private kokuraiTrailTimer = 0;    // 移動トレイル生成タイマー
  private kokuraiThunderTimer = 0;  // 遠方落雷(視覚)タイマー
  private kokuraiBlackInTimer = 0;  // 発動黒転ビネットスパイク残り秒(0.6s→0)
  // A4-F08: 雷帝/黒雷帝中の環境雷鳴ハム(3-6s間隔)
  private raiteiHumNextS = 0;

  // ── R44a/R45a 配線タイマー・状態変数 ──
  private lastBlinkElapsed = -Infinity;  // ブリンク時刻(this.elapsed秒ベース)
  private reloadKillBit = false;         // リロード完了後1.5s内フラグ
  private reloadKillTimer = 0;           // 残り秒
  private prevMagAmmo = 0;              // 前フレームのマガジン残弾
  private prevSliding = false;           // スライド立ち下がり検出
  private prevWallRunning = false;       // 壁走り立ち下がり検出
  private prevGrounded = true;           // 着地検出用
  private walkKokuraiTimer = 0;          // 黒雷帝歩行ルーンエミット間隔
  private raiteiFootprintTimer = 0;      // 雷帝足跡エミット間隔
  private kokuteiSmantleTimer = 0;       // 黒帝スモークマントル間隔
  private slideSparksTimer = 0;          // スライドスパーク間隔
  private wallRunSparksTimer = 0;        // 壁走りスパーク間隔
  private playerFootstepTimer = 0;       // プレイヤー足音間隔
  private darkVoidPulseTimer = 0;        // 暗黒チャージパルス間隔

  // ── 特殊兵装 溜め攻撃 / Mウルト ──
  private exoticHoldFireTimer = 0;
  private exoticHoldFireCharging = false;
  private exoticHoldFireActive = false;
  private shuraChargeTimer = 0;
  private shuraChargeTickTimer = 0;
  private shuraRampageTimer = 0;
  private shuraRampageFireTimer = 0;
  private tenraiMaxChargeFired = false;
  private banjinKagemaiTimer = 0;
  private banjinKagemaiDmgTimer = 0;
  private gekkouMoonTimer = 0;
  private gekkouMoonPos: THREE.Vector3 | null = null;
  private shinkirouKyozouTimer = 0;
  private shuraKourinTimer = 0;
  private shuraKourinDmgTimer = 0;
  private exoticDamageBoost = 1;

  // ── 風神・極大手裏剣(B ウルト): 発射中の手裏剣エンティティ ──
  private windShuriken: {
    mesh: THREE.Group;
    mats: THREE.Material[];
    geos: THREE.BufferGeometry[];
    pos: THREE.Vector3;
    dir: THREE.Vector3;
    traveled: number;
    hitSet: Set<number>; // 貫通済みbot.uid(多段ヒット防止)
    trailTimer: number;
  } | null = null;

  // ── 雷帝・神獣降臨(N ウルト): 3秒間の落雷+麒麟疾走 ──
  private lightningBeastTimer = 0; // 残り演出秒(>0で発動中)
  private lightningBeastDamageTimer = 0; // 波状ダメージ(0.5s周期)
  private lightningBeastArcTimer = 0; // 落雷スポーン(0.1s周期)
  private lightningKirinFootTimer = 0; // 麒麟足跡焦げリング(0.18s周期)
  private lightningKirinMesh: THREE.Group | null = null;
  private lightningKirinMats: THREE.Material[] = [];
  private lightningKirinGeos: THREE.BufferGeometry[] = [];
  private readonly lightningKirinPos = new THREE.Vector3();
  private readonly lightningKirinDir = new THREE.Vector3();

  private grenadeKind: GrenadeKind;
  private readonly grenadeCounts: Record<GrenadeKind, number>;
  private cooking = false;
  private cookTimer = 0;
  private thrown: ThrownGrenade[] = [];
  private smokeZones: SmokeZone[] = [];
  private firePatches: FirePatch[] = [];
  private whiteout = 0;
  private readonly grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);

  // ── ロケット弾体(業火RL) ──
  private readonly rocketGeo = new THREE.CylinderGeometry(0.055, 0.04, 0.42, 8, 1);
  private readonly rocketTrailGeo = new THREE.CylinderGeometry(0.025, 0.0, 0.22, 6, 1);
  private readonly rocketMat = new THREE.MeshStandardMaterial({ color: 0xff6a3c, emissive: 0xff3300, emissiveIntensity: 2.2, roughness: 0.6 });
  private readonly rocketTrailMat = new THREE.MeshStandardMaterial({ color: 0x999999, transparent: true, opacity: 0.35, roughness: 1 });
  private rockets: Array<{
    mesh: THREE.Mesh;
    trailMesh: THREE.Mesh;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    timer: number;
  }> = [];

  // ── R33 特殊武器 弾体/状態 ──
  // 月光弓
  private readonly bowArrowGeo = new THREE.CylinderGeometry(0.005, 0.003, 0.36, 6, 1);
  private readonly bowArrowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private bowProjectiles: Array<{
    mesh: THREE.Mesh; trailGroup: THREE.Group;
    pos: THREE.Vector3; vel: THREE.Vector3;
    damage: number; timer: number;
  }> = [];
  private bowChargeTimer = 0;
  private bowCharging = false;
  private bowChargeTickTimer = 0;
  // 天雷杖
  private readonly staffBoltGeo = new THREE.SphereGeometry(0.14, 10, 8);
  private readonly staffBoltMat = new THREE.MeshBasicMaterial({
    color: 0xbbbbff, transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private staffProjectiles: Array<{
    mesh: THREE.Mesh; sparkGroup: THREE.Group;
    pos: THREE.Vector3; vel: THREE.Vector3;
    damage: number; aoeRadius: number; timer: number;
  }> = [];
  private staffChargeTimer = 0;
  private staffChargeTickTimer = 0;
  // 修羅ミニガン
  private minigunCurrentRpm = 0;
  private minigunSpinWasActive = false;
  // スタン追跡(天雷杖AoE)
  private readonly botStunUntil = new WeakMap<import('./bot').Bot, number>();
  // 手裏剣ディスク visual(life=F8: hitscan着弾距離でクランプした飛行寿命s)
  private shurikenDiscs: Array<{
    group: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; timer: number; life: number;
  }> = [];

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
  private missionBossKills = 0; // ★V-B修正: boss tier撃破数(eliminate-count bossOnly=c10m5用)
  private waveSpawnCursor = 0; // 波スポーン地点の巡回カーソル
  private readonly exfilPos = new THREE.Vector3(); // extract目的の脱出地点
  private exfilTimer = 0; // 脱出地点滞在秒
  // ── R53-W2 M2b: ストーリー帝王編エンジン(mission が無ければ未使用) ──
  private radioQueue: RadioLine[] = []; // 未発火の無線(at.s / at.event 待ち)
  private radioPending: Array<{ speaker: RadioSpeaker; text: string }> = []; // 発火済み表示待ち
  private radioCurrent: { speaker: RadioSpeaker; text: string } | null = null;
  private radioCurrentTimer = 0; // 現在行の表示残り秒(5s)
  private radioGapTimer = 0; // 行間の間隔(1s)
  private radioBossHp50Fired = false; // 'boss-hp50' イベントの単発ガード
  private bossPhaseIdx = 0; // 消化済み bossPhases 数(snapshot.bossPhase.idx)
  private bossPhaseRef: Bot | null = null; // フェーズ管理対象のボス(missionのboss)
  private bossPhaseDefeatNoted = false; // クロガネ撃破音/メダルの単発ガード
  private bossSlashTimer = 0; // blackSlash フェーズ挙動の周期
  private bossBlinkTimer = 0; // blink フェーズ挙動の周期
  private bossPillarTimer = 0; // pillars フェーズ挙動の周期
  private infiltrateReinforced = false; // infiltrate: 発覚増援は1回だけ
  private missionCollected = 0; // collect: 回収済み数
  private collectItems: Array<{ pos: THREE.Vector3; mesh: THREE.Mesh }> = [];
  private escortBot: Bot | null = null; // escort: 護衛対象(team=PLAYER_TEAM)
  private escortGoal: THREE.Vector3 | null = null; // escort: 最終到達点
  // ── R53-W2 M2b: S&D状態(mode==='snd' 以外は未使用) ──
  private sndMatch: SndMatch | null = null;
  private sndRound: SndRound | null = null;
  private sndSites: [SndSite, SndSite] | null = null;
  private sndPlantedSite: SndSite | null = null; // 設置されたサイト(bomb位置の基準)
  private sndHoldSite: SndSite | null = null; // プレイヤーが現在ホールド中のサイト
  private sndPlayerHolding: 'plant' | 'defuse' | null = null; // プレイヤー自身のホールド種
  private sndBotHolding = false; // bot が設置/解除ホールド中(プレイヤーと排他: キャリア/最寄り解除者)
  private sndBombDropPos: THREE.Vector3 | null = null; // ドロップ中のボム位置(null=所持中/未使用)
  private sndBombMesh: THREE.Mesh | null = null; // ドロップ/設置ボムの可視化
  private sndPlantTickTimer = 0; // 設置ビープの周期
  private sndFuseTickTimer = 0; // ヒューズ鼓動の周期
  private zombieFirstPerkSaved = false; // perkcarry供給側: 初回パーク保存の単発ガード
  // ── R53-W3 M3: MK.III HUD/黒雷帝層/InstancedMesh配線 ──
  private uiHeat = 0; // snapshot.uiHeat(setCombatHeatと同値の露出)
  private moments: MomentEvent[] = []; // snapshot.moments(ドレイン方式)
  private chargeStage: 0 | 1 | 2 | 3 = 0; // 溜め段(0.5/1.2/2.2s閾値)
  private blinkComboUntil = -Infinity; // ブリンク後0.6sの雷転斬ウィンドウ(elapsed基準)
  private blinkChain: number[] = []; // 3s内3連ブリンク検知(elapsed記録)
  private zombieCrowd: ZombieCrowdRenderer | null = null; // ゾンビ群InstancedMesh
  private skyFogBase: { color: number; density: number } | null = null; // 黒転前のfog退避
  private katanaVeinsOn = false; // 刀身雷脈(kokurai累計100キル)の適用済みフラグ
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
  // ── R30 制圧/天候 ──
  private nearBulletLog: number[] = []; // bulletCrack近弾時刻(制圧判定用)
  private suppressEnv = 0;              // uSuppress エンベロープ 0..1
  // R30 動的天候: configシード決定論の 晴60%/濃霧20%/雨20%(ゾンビは常に'clear')
  private weatherKind: WeatherKind = 'clear';
  private rainPoints: THREE.Points | null = null;
  private rainTimeUniform: { value: number } | null = null;
  private readonly tracker: MedalTracker; // メダル検出(純ロジック)
  private medals: MedalEvent[] = []; // メダル取得イベント(消費型)
  private medalXpTotal = 0; // 試合中のメダルXP累計(リザルトで1回だけ計上)
  private lastAdsStartMs = 0; // ADS開始時刻(クイックスコープ判定)
  private lastAlive = true; // プレイヤー生存の前フレーム値(死亡の立ち下がり検出)
  // ── リアル化(描画) ──
  private composer: EffectComposer | null = null; // medium/high のみ(low は素のレンダラ)
  private envRT: THREE.WebGLRenderTarget | null = null; // 空から焼いたIBL(per-Matchで解放)
  private readonly sunDir = new THREE.Vector3(); // 太陽方向の単一の真実(空/日光/影を駆動)
  // R29: プレイヤー追従シャドウ(巨大マップで影を常に鮮明に保つ)
  private sunLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null; // V30: 天候の環境光補正用
  private shadowTexelWorld = 0.05; // シャドウ1テクセルのワールドサイズ(スナップ用)
  // R29修正: 光空間スナップ用の直交基底(sunDirから1回だけ計算してbuildStageSceneで保存)
  private readonly shadowRight = new THREE.Vector3(1, 0, 0);
  private readonly shadowUp = new THREE.Vector3(0, 0, 1);
  // ── R22 新レンダリングパス(high tierのみ) ──
  private _n8aoPass: N8AOPass | null = null;
  private _godRaysPass: GodRaysPass | null = null;
  private _adsDofPass: AdsDofPass | null = null;
  // AutoExposure: 全tier有効(コストゼロ)
  private readonly _autoExposure = new AutoExposure();
  private _prevShadowType: THREE.ShadowMapType = THREE.PCFSoftShadowMap;
  private _pcssPatched = false;
  // AutoExposure: indoor検出用タイマー・平滑値・scratch
  private _indoorCheckTimer = 0;
  private _indoor01 = 0;
  private readonly _autoExpFwd = new THREE.Vector3();
  // GodRays: mood別太陽強度
  private _sunIntensity = 0.35;
  private readonly _sunWorld = new THREE.Vector3(); // scratch(毎フレームGC回避)
  // AdsDofPass: 焦点距離(0.25s更新)
  private _dofFocusDist = 30;
  private _dofFocusTimer = 0;
  // ウォッチドッグ: 実描画フレーム間隔 EMA + 恒久降格ステート
  private _wdEma = 0.0166;     // ~60fps 初期値(閾値 0.022 未満)
  private _wdOverAccum = 0;    // EMA > 22ms の連続秒数
  private _wdStep = 0;         // 0=full, 1=dof off, 2=godrays off, 3=ao-low
  private _wdNextStepAt = 0;   // 次の降格を許可する elapsed(秒)

  // ── R16 spot-time知覚: setup時にpaletteから保持(Matchはpalette非保持=fog/ambientが必要)──
  private stageFogDensity = 0;
  private stageAmbient = 1;
  private botFrameIdx = 0; // uid%8 のLOSバケット(観測者を間引いてO(N^2)castRayを~1/8に。botCount増員対応)
  // ★4 レーダーbearingsのplayerCanSee(raycast)をuid%4で間引くフレームインデックスと可視キャッシュ
  private bearingsFrameIdx = 0;
  private readonly bearingVisCache = new Map<number, boolean>();
  // ★6 scoreboardのdirtyフラグ+0.2sスロットルキャッシュ(毎フレームの構築+ソートを撃退)
  private scoreboardDirty = true;
  private scoreboardNextAt = 0;
  private scoreboardCache: ScoreRow[] = [];
  // ── R16 ゾンビディレクタ(mode==='zombie'のみ稼働。matchが唯一の状態保持者)──
  private zombieRound = 0;
  private zombieKills = 0;
  private zombiePoints = 0;
  private zombieQueue = 0; // このラウンドの残り湧き数(一斉湧き: alive<cap のたびに即補充)
  private zombieRoundCooldown = 0; // ラウンド間の小休止
  private zombieTierCap = ZOMBIE_MAX_ALIVE.medium; // 同時生存上限(tier連動)
  private readonly zombiePool: Bot[] = []; // ★ メッシュプール: 死亡済み通常ゾンビを再利用(buildZombieMesh削減)
  private zombieMeleeGlobal = 0; // 近接ダメージのグローバル次回許可時刻(elapsed基準)
  private zombieMeleeIframe = 0; // プレイヤーi-frameの終了時刻(elapsed基準)
  private botShadowLodTimer = 0; // ★1 近接影LODの周期トグル(全モード共通。0.25s)
  private zombieSpawnColor = 0x4c5a30; // ゾンビ本体の腐敗色(setupで確定)
  private playerDowns = 0;
  // ── ゾンビ経済(R??) ──
  private zombieShopLayout: ShopLayout | null = null;
  private readonly zombieShopGroups: THREE.Group[] = [];
  private zombieBoxPositions: THREE.Vector3[] = [];
  private zombieBoxCurrentIdx = 0;
  private zombieBoxGroupIdx = -1; // ミステリーボックスのzombieShopGroups内index(R53-W2: 末尾決め打ちバグの根治)
  private zombiePerkStacks = new Map<ZombiePerkId, number>();
  private zombiePerkMoveMul = 1;
  private zombieQuickReviveCharges = 0;
  private zombieBossBot: Bot | null = null;
  private zombieBossFlash = 0;
  private zombieShopPrompt: { label: string; canAfford: boolean; cost: number } | null = null;
  private zombiePointFloats: Array<{ amount: number; world: THREE.Vector3 }> = [];
  private zombieReviveFlash = 0;
  private zombieBoxAnimTimer = 0;
  private zombieBoxAnimMesh: THREE.Mesh | null = null;
  private zombieBoxPendingWeapon: string | null = null;
  private zombieBoxPendingMove = false; // boxMovesロール中(演出終了時に箱を移動+アナウンス)

  // ── R53-W2 Pack-a-Punch(武器ごとのtier。壁/箱で買い直すとMap削除=tier0リセット) ──
  private readonly zombiePapTiers = new Map<string, PapTier>();
  private zombiePapAnyDone = false; // 'pap-first'メダル用: 試合内で初めて鍛神したか

  // ── R53-W2 特殊ゾンビ変種 ──
  private zombieVariantKillCount = 0; // 'variant-100'メダル用
  private zombieBossKillCount = 0; // charm(bossdmg)解放条件用: summary.zombieBossKillsへ供給

  // ── R53-W2 パワーアップ(ドロップ+時限効果) ──
  private zombiePowerUpRoundCount = 0; // ラウンド内ドロップ数(POWERUP_ROUND_CAPで抑止)
  // ★V-A修正(TODO消化): ドロップ視覚はB-FX2の powerUpBeacon(共有マテリアル・呼び出し側管理型)。
  // 回転/浮遊は group.userData.spinSpeed / bobAmplitude をmatch側updateが適用する契約
  private readonly zombiePowerUpDrops: Array<{
    kind: PowerUpKind;
    pos: THREE.Vector3;
    remainS: number;
    mesh: THREE.Group;
  }> = [];
  private zombieInstaKillTimer = 0;
  private zombieDoublePointsTimer = 0;

  // ── R53-W2 毒霧(miasma variant死亡時に発生)。★V-A修正: 視覚はeffects.miasmaCloudの
  // プールへ委譲済み — matchはDPS判定用の位置/残時間エンティティのみ保持する ──
  private readonly zombieMiasmaClouds: Array<{ pos: THREE.Vector3; remainS: number; tickIn: number }> = [];
  private zombiePoison01 = 0; // HUDビネット用(0..1、雲内で1へ・それ以外は減衰)

  // ── R53-W2 特殊ラウンド(rush) ──
  private zombieSpecialRound: 'rush' | null = null;

  // ── R53-W2 ドア(バリケード。購入でコライダー+ビジュアルを除去) ──
  private zombieDoorOpen = false;
  // ★V-A MEDIUM修正: 鍛神台の封印制(ドア開放で解除)。ビジュアル暗転/復帰用のマテリアル参照
  private zombieHasDoor = false;
  private zombiePapCrystalMat: THREE.MeshStandardMaterial | null = null;
  private zombiePapRingMat: THREE.MeshBasicMaterial | null = null;
  private zombieDoorBody: RAPIER.RigidBody | null = null;
  private zombieDoorCollider: RAPIER.Collider | null = null;
  private zombieDoorVisual: { group: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.Material[] } | null = null;

  // ── R53-W2 お守り(charm) ──
  private zombieCharmEffect: CharmEffect | null = null;
  private zombieCharmReviveAvailable = false;

  // ── BO2 スコアストリーク ──
  private readonly streakManager = new StreakManager();
  private uavTimer = 0;         // UAV 残り秒(0=非活動)
  private uavSweepTimer = 0;    // 次の UAV スナップショットまでの残り秒
  private uavEnemySnap: Array<{ x: number; z: number; snappedAt: number }> = [];
  // Hunter-Killer: 軽量エンティティ(フルBotを使わない)
  private readonly hkEntities: Array<{
    mesh: THREE.Mesh;
    geo: THREE.SphereGeometry;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    targetUid: number; // bot.uid (dead になっても位置追跡に使う)
    targetLastPos: THREE.Vector3;
    timer: number;
    phase: 'rise' | 'dive';
  }> = [];
  // Lightning Strike: 遅延爆発キュー
  private readonly lightningQueue: Array<{ pos: THREE.Vector3; fireAt: number }> = [];
  // Sensor Turret: PLAYER_TEAM turret の uid → 有効期限 elapsed
  private readonly streakTurretExpiry = new Map<number, number>();
  // ── RC-XD: 遠隔操作ラジコン爆弾 ──
  private rcxdActive = false;
  private rcxdTimer = 0;
  private readonly rcxdPos = new THREE.Vector3();
  private rcxdYaw = 0;
  private rcxdMesh: THREE.Group | null = null;
  private readonly rcxdGeos: THREE.BufferGeometry[] = [];
  private readonly rcxdMats: THREE.Material[] = [];
  // ── Care Package: クレート投下 ──
  private readonly carePackageCrates: Array<{
    mesh: THREE.Group;
    geos: THREE.BufferGeometry[];
    mats: THREE.Material[];
    pos: THREE.Vector3;
    dropTimer: number;   // 0→2 落下アニメ
    openTimer: number;   // 30s 自動消滅カウントダウン
    landed: boolean;
    startY: number;
    groundY: number;
  }> = [];
  // ── Counter UAV: 索敵妨害 ──
  private cauavTimer = 0;
  // 足音: bot uid → 歩行��積距離(ストライドトリガー用)
  private readonly botStepPhase = new Map<number, number>();
  private stageSurfaceFloor: SurfaceMaterial = 'concrete';
  // ミニマップ用ボックスデータ(setupMinimap()/snapshot()で参照)。
  // breakable プロップには handle フィールドを追加し破壊時に動的削除する。
  private readonly minimapBoxData: Array<{ x: number; z: number; w: number; d: number; handle?: number }> = [];
  // 破壊可能プロップ: handle → BreakableProp(buildStageSceneで登録、破壊時に削除)
  private readonly breakableProps = new Map<number, BreakableProp>();
  // 破壊済みハンドルセット(MatchSnapshot経由でHUDへ公開=将来のミニマップ連携用)
  private readonly destroyedPropHandles = new Set<number>();

  // ── 訓練場 ──
  private trainingTargets: TrainingTarget[] = [];
  private trainingStats: TrainingStats | null = null;

  // ── ファイナルキルカム: 実装は killcam.ts KillcamController(R54-W1 F1分割)。
  // Match は所有+委譲のみ。deps は全て遅延クロージャ=フィールド初期化順に依存しない
  private readonly killcam = new KillcamController({
    getScene: () => this.scene,
    getCamera: () => this.camera,
    getAllyColor: () => this.colors.ally,
    getPlayer: () => this.player,
    getBots: () => this.bots,
    getAdsProgress: () => this.activeWeapon.adsProgress,
    isZombie: () => this.config.mode === 'zombie',
    playHit: () => this.sounds.hit(),
    reduceMotion: () => this.settings.reduceMotion,
    updateEffects: (dt: number) => this.effects.update(dt),
    updateAtmosphere: (dt: number) => this.atmosphere?.update(dt, this.camera.position),
    tracer: (from: THREE.Vector3, to: THREE.Vector3, color: number) => this.effects.tracer(from, to, color),
    blockedToMid: (rayOrg: THREE.Vector3, toMid: THREE.Vector3, dist: number) => {
      const hit = this.castRay(rayOrg, toMid, dist, null);
      return hit !== null && this.tags.get(hit.collider.handle)?.kind !== 'boundary';
    },
  });

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
    // 訓練場: 時間無制限(Infinity <= 0 は常に false なので時間切れ判定を透過する)
    if (config.mode === 'training') this.timeLeft = Infinity;
    this.mission = config.mission ?? null;
    this.modifierSet = new Set(config.mission?.modifiers ?? []);
    this.colors = teamPalette(settings.teamPaletteId);
    this.rand = mulberry32(Date.now() % 0xffffffff);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // R29: エリア超拡大(280-360m)+遠景シルエット(size*1.2-1.5)に合わせ描画距離を800へ
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.05, 800);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // PCSS: high tier の場合、マテリアル生成前にシェーダチャンクへパッチする。
    // buildStageScene より先に行わないとコンパイル済みシェーダへは反映されない。
    const _graphicsTier = resolveGraphicsTier(settings.graphicsQuality, renderer.capabilities.isWebGL2);
    if (_graphicsTier === 'high' && !isPcssPatched()) {
      this._prevShadowType = renderer.shadowMap.type;
      patchPcss();
      renderer.shadowMap.type = THREE.BasicShadowMap;
      this._pcssPatched = true;
    }

    const layout = generateStage(config.stage);
    this.playerSpawns = layout.playerSpawns.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.botSpawns = layout.botSpawns.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    // R30 天候ロール: buildStageScene 前に確定する(雨天の床wetness最大化は
    // buildStageScene 内の resolveWetness→applyMacroFloor で焼き込まれるため)。
    // ゾンビは既存ムード優先=天候ロール無し('clear' のまま)。
    if (config.mode !== 'zombie' && config.mode !== 'training') this.weatherKind = rollWeather(config.stage.seed);
    this.buildStageScene(layout.boxes, layout.propPlacements);
    // ミニマップ用ボックスデータは buildStageScene 内で ghost/decor 除外しながら登録済み
    // ステージの床材質(足音に使用)
    this.stageSurfaceFloor = deriveSurfaceMaterials(config.stage.palette).floor;

    const spawn = this.playerSpawns[0] ?? new THREE.Vector3();
    // モディファイアをプレイヤーの個体設定へ反映(低重力/HP自然回復なし)
    const playerOpts: { regenPerS?: number; gravityScale?: number; maxHp?: number } = {};
    if (this.modifierSet.has('no-regen')) playerOpts.regenPerS = 0;
    if (this.modifierSet.has('low-gravity')) playerOpts.gravityScale = 0.55;
    // クナイ(ニンジャ)装備は接近戦で撃たれ弱い分、体力を 300 へ引き上げてインファイトを成立させる。
    // HUD/スナップショットの maxHp は player.maxHp を参照するため自動追従する。
    // V31修正: ガンゲームはラダー武器強制のためHP300を適用しない(純粋な銃勝負)
    // R54-W1 Q1: S&Dはノーリスポーン戦術モードのため、HP300タンク化+黒雷帝キットの
    // 組み合わせが成立してしまう不公平を避け対象外にする(下のisNinja/kit有効化も同様)
    if (ninjaHp300Eligible(config.primaryId, config.mode)) playerOpts.maxHp = 300;
    if (config.hellMode) playerOpts.regenPerS = 12.5;
    this.player = new Player(this.physics, spawn, playerOpts);
    this.tags.set(this.player.collider.handle, { kind: 'player' });

    // ガンゲーム: ラダー1段目の武器を強制使用(config.primaryId は無視)
    const primaryId = config.mode === 'gungame' ? (GG_LADDER[0] ?? 'kawasemi-pistol') : config.primaryId;
    const primaryBase = WEAPON_DEFS[primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    const primaryDef = applyAttachments(primaryBase, config.mode === 'gungame' ? [] : config.attachments);
    // 副武器: 指定があり SECONDARY_IDS に含まれていればそれを、無ければ拳銃スズメ
    const secDef =
      (config.secondaryId && SECONDARY_IDS.includes(config.secondaryId)
        ? WEAPON_DEFS[config.secondaryId]
        : undefined) ?? WEAPON_DEFS['suzume']!;
    // 副武器defも per-Match のクローンにする(applyAttachments が deep-clone を返す)。
    // ゾンビ経済のパーク(スピードコーラ/ダブルタップ)が def.rpm/reloadMs を直接補正するため、
    // 共有の WEAPON_DEFS を掴んだままだと購入がグローバル定義を汚染し全モードへ波及する
    this.weapons = [new Weapon(primaryDef), new Weapon(applyAttachments(secDef, []))];

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
    } else if (config.mode === 'training') {
      // 訓練場: ボットなし。的エンティティを生成する
      this.trainingStats = new TrainingStats();
      this.spawnTrainingTargets();
      // 的方向へ初期yaw設定(spawn → マップ中心ベクトルをプレイヤー前方へ)
      // player.ts の forward = (-sin yaw, 0, -cos yaw) より yaw = atan2(-fwd.x, -fwd.z)
      {
        const tSpawn = this.playerSpawns[0] ?? new THREE.Vector3();
        const toC = new THREE.Vector3(-tSpawn.x, 0, -tSpawn.z);
        if (toC.lengthSq() > 0.0001) {
          const fwdN = toC.normalize();
          this.player.yaw = Math.atan2(-fwdN.x, -fwdN.z);
        }
      }
    } else {
      // 通常対戦: チーム戦は人数の少ない側にプレイヤーが入る。
      // R30修正: スポーン点数を超えた分が同一座標へ折り返して重なり、kinematic同士が
      // 押し出せず永久スタックするバグを根治。使用済み位置(プレイヤー初期位置含む)から
      // 1.2m未満の候補は決定論的なリングオフセットでずらして配置する。
      // tier別パフォーマンスクランプ(low:16/medium:28/high:設定値。config読み込み点でMath.min)
      const rawBotCount = config.stage.botCount;
      // 超鬼畜: 湧き数+50%(tierパフォーマンス上限の内側で増える=low/mediumは頭打ち維持)
      const hellBotCount = config.hellMode ? Math.ceil(rawBotCount * 1.5) : rawBotCount;
      const botCount =
        _graphicsTier === 'high'
          ? hellBotCount
          : _graphicsTier === 'medium'
            ? Math.min(28, hellBotCount)
            : Math.min(16, hellBotCount);
      const allyCount = this.modeDef.teamBased ? Math.floor((botCount - 1) / 2) : 0;
      const placed: THREE.Vector3[] = [this.player.position];
      const MIN_GAP = 1.2;
      for (let i = 0; i < botCount; i += 1) {
        const name = BOT_NAMES[i % BOT_NAMES.length] ?? `BOT-${i}`;
        const team = this.modeDef.teamBased ? (i < allyCount ? PLAYER_TEAM : ENEMY_TEAM) : i + 1;
        const isAlly = team === PLAYER_TEAM;
        const spawnList = isAlly ? this.playerSpawns : this.botSpawns;
        // ④ FFA系: 初期配置の1/3をプレイヤー近隣(60-120m)に優先(外周孤立防止)
        let effectiveSpawnList = spawnList;
        if (!isAlly && !this.modeDef.teamBased) {
          const nearTarget = Math.ceil(botCount / 3);
          if (i < nearTarget) {
            const pPos = this.player.position;
            const nearSpawns = this.botSpawns.filter((s) => {
              const d = s.distanceTo(pPos);
              return d >= 60 && d <= 120;
            });
            if (nearSpawns.length > 0) effectiveSpawnList = nearSpawns;
          }
        }
        const base = effectiveSpawnList[(i + (isAlly ? 1 : 0)) % effectiveSpawnList.length] ?? new THREE.Vector3();
        const botSpawn = base.clone();
        // 既配置と近すぎる限りリング状にずらす(半径2.5mずつ拡大・角度は決定論)
        // 36bot増員対応: ring上限を6→12に拡大(最大30m分散で重複を確実に解消)
        for (let ring = 1; ring <= 12; ring += 1) {
          const tooClose = placed.some(
            (p) => Math.hypot(p.x - botSpawn.x, p.z - botSpawn.z) < MIN_GAP,
          );
          if (!tooClose) break;
          const a = i * 1.7 + ring * 0.9;
          botSpawn.set(base.x + Math.cos(a) * 2.5 * ring, base.y, base.z + Math.sin(a) * 2.5 * ring);
        }
        placed.push(botSpawn.clone());
        // hellMode/allGiantMode: kind selection for enemy humanoid slots
        // R51: デフォルト(トグルOFF)の自然湧きはチーム系モードのみ(個人戦はゼロ)。
        // トグルON(allGiant/hell)は個人戦でも従来どおり作動(明示的オプトインのため)
        const botKind: BotKind = isAlly
          ? 'humanoid'
          : resolveNaturalBotKind(
              () => this.rand(),
              this.modeDef.teamBased,
              config.hellMode ?? false,
              config.allGiantMode ?? false,
            );
        // 超鬼畜倍率は spawnBot 内(KIND_TUNING合成後)で一元適用する(二重掛け防止)
        // キルフィード/スコアボードで一目で分かるよう、達人/巨躯は種名を表示名にする
        const displayName = botKind === 'master' ? '達人' : botKind === 'giant' ? '巨躯' : name;
        this.spawnBot(
          displayName,
          botSpawn,
          isAlly ? this.colors.ally : this.colors.enemy,
          team,
          tuningFor('normal', config.difficulty),
          'normal',
          botKind,
        );
      }
    }

    this.domination = config.mode === 'dom' ? new DominationState(['A', 'B', 'C']) : null;
    if (this.domination) this.buildZones();
    this.hardpointState = config.mode === 'hardpoint' ? new HardpointState(5) : null;
    if (this.hardpointState) this.buildHardpointZones();
    this.kcState = config.mode === 'killconfirm' ? new KillConfirmState() : null;
    this.ggState = config.mode === 'gungame' ? new GunGameState() : null;
    // R53-W2 M2b: S&D — 初回攻撃側はプレイヤーチーム(BO2の先攻)。サイト/ボム/ラウンドを構築
    if (config.mode === 'snd') {
      this.sndMatch = new SndMatch(PLAYER_TEAM);
      this.buildSndSites();
      this.startSndRound(true);
    }

    this.effects = new Effects(this.scene);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.setWeapon(this.activeWeapon.def);
    this.activeWeapon.raise();
    // R53-W3 M3: 刀身雷脈(黒雷帝キル累計100の恒久報酬)。main.tsが profile.kokuraiKillsTotal
    // (=summary.kokuraiKills の生涯積算=実キル数)を渡す。既達なら試合開始時から適用
    if ((config.kokuraiKillsBase ?? 0) >= 100) {
      this.katanaVeinsOn = true;
      this.viewModel.setKatanaVeins(true);
    }
    // R53-W3 M3: ゾンビ群InstancedMesh(972DC→79の軽量化本命。kill-switchはzombie-crowd.ts)
    if (this.config.mode === 'zombie' && ZOMBIE_CROWD_INSTANCED) {
      this.zombieCrowd = new ZombieCrowdRenderer(this.scene);
    }

    this.buildComposer(_graphicsTier);

    // R30: 遠方戦場アンビエンスは対戦モードのみ(zombie=不気味さ優先/story=演出優先で無し)。
    // quiesce() が自動停止するため後始末はここでは不要
    if (this.config.mode !== 'zombie' && this.config.mode !== 'training' && !this.mission) {
      this.sounds.startDistantBattle();
    }
    // R30 天候適用(ロールはコンストラクタ冒頭で確定済み。zombieは常に'clear'=no-op)
    this.applyWeather();

    // シェーダ事前コンパイル(初フレーム/初撃破のスタッター防止)。ディゾルブ変種(dissolve1)は
    // defineを一時点火してcompile→消灯の順で両プログラムをキャッシュへ載せる
    for (const bot of this.bots) bot.prewarmDissolve(true);
    this.renderer.compile(this.scene, this.camera);
    for (const bot of this.bots) bot.prewarmDissolve(false);

    // 常闇カモ装備中(かつ gungame/training/snd 以外): 試合開始から黒帝モード永続
    // R54-W1 Q1: S&D除外(HP300ゲートと対称。ノーリスポーン戦術モードでの不公平を防ぐ)
    if (this.isNinja && permanentDarkEmperorEligible(config.mode)) {
      const profile = loadProfile();
      const fistsCamo = equippedCamoFor('fists', profile);
      if (fistsCamo === 'tokoyami') {
        this.tokoyamiActive = true;
        this.darkEmperorTimer = Infinity;
        this.viewModel.setKunaiDarkMode(true);
      }
    }
  }

  // ポストプロセス: medium/high のみ Render→Bloom→SMAA→Output の最小4パス。
  // low(WebGL1含む)は composer を作らず render() が素のレンダラへフォールバックする。
  private buildComposer(tier: GraphicsQuality): void {
    if (tier === 'low') {
      this.postfxActive = false; // low: シェーダPostFX無し(CSSフォールバックのみ)
      // AutoExposure: low tier でも有効(コストゼロ)
      this._autoExposure.configure({ baseExposure: this.config.stage.palette.exposure ?? 1.0 });
      return;
    }
    this.postfxActive = true;
    const p = this.config.stage.palette;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);

    // AutoExposure: baseExposure を現行パレットの露出値で初期化(全tier共通)
    this._autoExposure.configure({ baseExposure: p.exposure ?? 1.0 });

    const bloom = new HalfBloom(
      new THREE.Vector2(size.x, size.y),
      p.bloomStrength ?? 0.5, // strength: 真の発光体だけ拾う控えめな値
      0.4, // radius
      // threshold: 0.85 では昼の明部(明るい床/壁/箱の天面)まで滲んで白いグレアになり
      // 「眩しくて見にくい」主因になっていた。0.9 へ上げて真に高輝度なものだけ滲ませる。
      // ネオン/信号灯など発光演出は各パレットが明示 threshold(yoichi0.7/haieki0.8/neon0.85)を持つ。
      p.bloomThreshold ?? 0.9, // threshold
    );

    if (tier === 'high') {
      // ── HIGH TIER: N8AOPass(RenderPass代替) + GodRays + AdsDofPass ──
      // N8AOPass はシーンを内部の beautyRenderTarget へ描画し AO を合成して出力する。
      const n8ao = new N8AOPass(this.scene, this.camera, size.x, size.y);
      n8ao.configuration.aoRadius = 2.0;
      n8ao.configuration.distanceFalloff = 0.4;
      n8ao.configuration.intensity = 2.5;
      n8ao.configuration.halfRes = true;
      n8ao.configuration.depthAwareUpsampling = true;
      n8ao.configuration.transparencyAware = true;
      // gammaCorrection=false: 後段 OutputPass が sRGB 変換するため二重 gamma を防ぐ
      n8ao.configuration.gammaCorrection = false;
      n8ao.setQualityMode('Medium');
      this._n8aoPass = n8ao;

      const godRays = new GodRaysPass();
      godRays.setSize(size.x, size.y);
      this._godRaysPass = godRays;

      const dof = new AdsDofPass(this.scene, this.camera as THREE.PerspectiveCamera);
      dof.setSize(size.x, size.y);
      this._adsDofPass = dof;

      // ムード別太陽強度を算出して保持(毎フレーム setIntensity に渡す)
      this._sunIntensity = this._resolveSunIntensity(resolveMood(p));

      // パス順: N8AO → GodRays → Bloom → Grade → DOF → SMAA → Output → PostFX
      composer.addPass(n8ao); // RenderPass 代替

      // 深度ブリッジ: N8AOPass は beautyRenderTarget に深度を書くが GodRaysPass は
      // readBuffer.depthTexture を参照する。EffectComposer の ping-pong 両バッファに
      // 同じ DepthTexture 参照を共有することで、どちらが readBuffer になっても深度が届く。
      // setSize() は depthTexture JS オブジェクトを置換しないため resize 後も参照は有効。
      const n8aoDepth = n8ao.beautyRenderTarget.depthTexture;
      composer.readBuffer.depthTexture = n8aoDepth;
      composer.readBuffer.depthBuffer = true;
      composer.writeBuffer.depthTexture = n8aoDepth;
      composer.writeBuffer.depthBuffer = true;

      composer.addPass(godRays);
      composer.addPass(bloom);
      // アトモスフィアの映画的カラーグレード(ムード別・HDR空間=bloom後)
      composer.addPass(
        createGradePass(resolveGrade(resolveMood(p), p), {
          reduceMotion: this.settings.reduceMotion,
          width: size.x,
          height: size.y,
        }),
      );
      composer.addPass(dof); // bloom後/SMAA前(dof.ts の推奨位置)
      composer.addPass(new SMAAPass(size.x, size.y));
      composer.addPass(new OutputPass()); // Neutral+exposure+sRGB を renderer から自動適用
      // ジュース専用PostFX(被弾パルスの赤tint+収差)。表示空間(Neutral後)・被弾時のみenable
      const postfxH = new PostFXPass();
      postfxH.setParams({
        vigInner: 0.95, // 静的グレードはgradePassが持つ=ここは実質パススルー
        vigOuter: 1.0,
        grain: 0,
        aberration: 0,
        desat: 0,
        hitPulse: 0,
        hitTint: [1, 0.32, 0.28],
        enabled: false, // hitPulse>0 のフレームだけ有効化(idleコストゼロ)
      });
      // R21: Teal & Orange グレーディング。high tier のみ 0.3 を設定し常時1パス(予算内)
      postfxH.setGrade(0.3);
      this.postfxGrade = 0.3;
      composer.addPass(postfxH);
      this.postfx = postfxH;
    } else {
      // ── MID TIER: 既存チェーン(変更なし) ──
      composer.addPass(new RenderPass(this.scene, this.camera));
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
      const postfxM = new PostFXPass();
      postfxM.setParams({
        vigInner: 0.95, // 静的グレードはgradePassが持つ=ここは実質パススルー
        vigOuter: 1.0,
        grain: 0,
        aberration: 0,
        desat: 0,
        hitPulse: 0,
        hitTint: [1, 0.32, 0.28],
        enabled: false, // hitPulse>0 のフレームだけ有効化(idleコストゼロ)
      });
      composer.addPass(postfxM);
      this.postfx = postfxM;
    }

    this.composer = composer;
  }

  /** ムード別の GodRays 太陽強度を返す(仕様: 晴れ0.35/夕0.45/夜0.12/曇0.08) */
  private _resolveSunIntensity(mood: MoodId): number {
    switch (mood) {
      case 'day':      return 0.35;
      case 'dusk':     return 0.45;
      case 'night':    return 0.12;
      case 'overcast': return 0.08;
      case 'snow':     return 0.20; // 冬の淡い日差し
      default:         return 0.35;
    }
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
    // V31修正: ガンゲームはロードアウト無視のラダー戦のためニンジャ系を全て無効化
    return this.config.primaryId === 'fists' && this.config.mode !== 'gungame';
  }

  private buildStageScene(
    boxes: ReturnType<typeof generateStage>['boxes'],
    propPlacements: readonly PropPlacement[],
  ): void {
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
    // 光空間スナップ用の直交基底を sunDir から算出して保存(frame()で毎フレーム流用)。
    // shadowRight = worldUp × sunDir の正規化(光の right 軸)。
    // shadowUp    = sunDir × shadowRight の正規化(光の up 軸)。
    // これにより shadow snap をワールド XZ でなく「影テクセルグリッド面」で行い snap 誤差をゼロ化。
    this.shadowRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    if (this.shadowRight.lengthSq() < 0.0001) this.shadowRight.set(1, 0, 0); // sunDir≒真上の edge case
    this.shadowUp.crossVectors(this.sunDir, this.shadowRight).normalize();

    // IBL(scene.environment)と二重になるため Hemi は控えめに。
    // 「天井(空)から差す環境光」が上面/明部を洗い流して眩しくする主因の一つなので
    // 係数を 0.55→0.5 に下げて上方フィルを間引く(直射=sun/影は不変。むしろ日陰が締まる)。
    const hemi = new THREE.HemisphereLight(
      palette.sky,
      palette.floor,
      palette.ambientIntensity * 0.5,
    );
    this.scene.add(hemi);
    this.hemiLight = hemi; // V30: 天候(濃霧)の環境光減衰をライトへ届かせるため保持
    const sun = new THREE.DirectionalLight(palette.lightColor, palette.lightIntensity);
    sun.position.copy(this.sunDir).multiplyScalar(size); // 見える太陽と影方向を一致させる
    sun.castShadow = true;
    // R12軽量化: mediumは1024²で影フラグメント1/4・VRAM 12MB→3MB。
    // エリア×3拡大でステージsize比例のshadow camera境界も広がるため、
    // highは2048²→4096²へ増強してテクセル密度を維持(midは1024²のまま)。
    // R29仕様メモ: follow-box ±70m(140m)+ 4096px = 29px/m = 従来小マップ相当の密度。
    //   VRAM 約64MB(4096×4096×4byte)= high tier のみ許容。medium は1024²(約4MB)のまま。
    // ★3 hell/全巨躯モードは巨躯54体で影パス負荷が最大化するため、highでも2048²へ抑える
    // (VRAM 64MB→16MB・影フラグメント1/4。±70m追従ボックスで14.6px/m=中距離でも輪郭維持)
    // R51-4b: ゾンビモードも同種の高密度群像(108体規模)のため heavyHorde 扱いに含める
    const heavyHorde =
      (this.config.hellMode ?? false) ||
      (this.config.allGiantMode ?? false) ||
      this.config.mode === 'zombie';
    const shadowRes = tier === 'high' ? (heavyHorde ? 2048 : 4096) : 1024;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.bias = -0.0005; // シャドウアクネ除去
    sun.shadow.normalBias = 0.02; // ピーターパン(浮き影)防止
    sun.shadow.radius = 2; // PCFカーネル拡大(ほぼ0コストで柔らかく)
    // R29: エリア超拡大(280-360m)対応=ステージ全体を1枚で覆う方式をやめ、
    // プレイヤー追従シャドウボックス(±70m)へ。マップがどれだけ大きくても影の
    // テクセル密度が一定(4096/140m≈29px/m=従来より鮮明)。中心はテクセルグリッドへ
    // スナップし、移動時のシャドウシマーを防ぐ(frame()で毎フレーム追従)。
    const half = SHADOW_FOLLOW_HALF;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.far = size * 2.2;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    this.shadowTexelWorld = (half * 2) / shadowRes; // ★3 実解像度と同期(snap誤差防止)

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
    // R20 rank3: ムード/床材質/バイオームから濡れ度を導き、床マテリアルへマクロ質感を挿す。
    // 追加DCゼロ・フラグメントALUのみで巨大床の「1色平面」読みを解消し、濡れパッチで減光した空IBLを拾う。
    const wetness = this.resolveWetness(palette);
    const floorMat = new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.95 });
    this.applyMacroFloor(floorMat, wetness);
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(size + 2, 1, size + 2), floorMat);
    floorMesh.position.y = -0.5;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    // 体積AO(Tier0): 天面を明るく底面を暗くする乗算頂点カラーを一度だけ焼く。
    // 共有unitBoxに焼くので全障害物が無コストで「平面の豆腐」を脱する
    this.bakeVolumetricAO(unitBox);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const propMerge = new Map<string, THREE.BufferGeometry[]>(); // R41a: prop合流バッファ

    // R53-W2 M2c: プロップ超リアル化v2の適用判定。v2Placements は buildPropVisual で置換する
    // インスタンス一覧、skipBoxes は旧箱ビジュアル(マージ/個別/shadowCaster全経路)の生成を
    // スキップすべき箱集合(コライダー/tags/breakable/minimapには一切影響しない)。
    const { v2Placements, skipBoxes } = planPropVisualsV2(propPlacements, boxes, palette);

    // ghost === true のボックスはコライダーのみ生成し描画をスキップ(不可視境界=開放境界対応)。
    // stage.ts/StageDef 側が ghost フラグを追加する。防御的読み取りで型拡張に依存しない。
    for (const spec of boxes) {
      const isGhost = (spec as { ghost?: boolean }).ghost === true;
      const isDecor = (spec as { decor?: boolean }).decor === true;
      const brkSpec = (spec as { breakable?: { hp: number } }).breakable;
      const isBreakable = !isGhost && brkSpec !== undefined;

      // ── 破壊可能プロップ: 個別メッシュ+個別マテリアル+個別コライダーで生成 ──
      // マージ描画から除外し破壊時にそのメッシュだけ scene.remove できる。
      // draw call 増は +~35 個/ステージ(仕様許容範囲内)。
      if (isBreakable) {
        const mat = new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.72,
          metalness: 0.0,
          vertexColors: true,
        });
        if (spec.emissive) {
          mat.emissive = new THREE.Color(spec.color);
          mat.emissiveIntensity = 0.45;
          mat.envMapIntensity = 0.35;
        }
        this.applyMacroProp(mat);
        const mesh = new THREE.Mesh(unitBox, mat);
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
        this.breakableProps.set(collider.handle, {
          mesh,
          body,
          collider,
          pos: new THREE.Vector3(spec.x, spec.y, spec.z),
          colorHex: parseInt(spec.color.slice(1), 16),
          w: spec.w,
          h: spec.h,
          d: spec.d,
          hp: brkSpec.hp,
          maxHp: brkSpec.hp,
        });
        if (!isDecor) {
          this.minimapBoxData.push({ x: spec.x, z: spec.z, w: spec.w, d: spec.d, handle: collider.handle });
        }
        continue;
      }

      // ── 通常ボックス: 共有マテリアル+共有ジオメトリ ──
      if (!isGhost) {
        const isProp = (spec as { prop?: boolean }).prop === true;
        const isShadowCaster = (spec as { shadowCaster?: boolean }).shadowCaster === true;
        // R53-W2 M2c: v2ビジュアル対象の prop 箱は旧ビジュアル生成(マージ/個別/shadowCaster
        // 全経路)を丸ごとスキップする。コライダー/tags/breakable/minimapはこの if の外(または
        // 下の `!isDecor` 節)で従来どおり不変に処理される — 視覚メッシュの差し替えのみ。
        if (!(isProp && skipBoxes.has(spec))) {
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
            // R20 rank3: 焼込みAO(vertexColor)の上へ弱い汚れグラデを重ね、クローン箱の均一感を崩す
            this.applyMacroProp(material);
            materials.set(key, material);
          }
          // R41a: prop:true の非破壊ボックスはマージ描画(DC削減)。shadowCaster のみ個別メッシュ。
          if (isProp && !isShadowCaster) {
            const geo = unitBox.clone();
            const m4 = new THREE.Matrix4().compose(
              new THREE.Vector3(spec.x, spec.y, spec.z),
              new THREE.Quaternion(),
              new THREE.Vector3(spec.w, spec.h, spec.d),
            );
            geo.applyMatrix4(m4);
            if (!propMerge.has(key)) propMerge.set(key, []);
            propMerge.get(key)!.push(geo);
          } else {
            const mesh = new THREE.Mesh(unitBox, material);
            mesh.position.set(spec.x, spec.y, spec.z);
            mesh.scale.set(spec.w, spec.h, spec.d);
            mesh.castShadow = !isProp || isShadowCaster; // R41a: 通常boxはcastShadow=true, prop非shadowCasterはfalse
            mesh.receiveShadow = true;
            this.scene.add(mesh);
          }
        }
        if (!isDecor) {
          this.minimapBoxData.push({ x: spec.x, z: spec.z, w: spec.w, d: spec.d });
        }
      }

      // ghost の有無にかかわらず物理コライダーは常に生成(不可視境界はプレイヤー/ボットを止める)
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(spec.x, spec.y, spec.z),
      );
      const collider = this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.w / 2, spec.h / 2, spec.d / 2),
        body,
      );
      // ghost 壁は 'boundary' タグ: KCC/ブリンクは物理で止まるが弾/斬撃/視線は素通りする
      this.tags.set(collider.handle, isGhost ? { kind: 'boundary' } : { kind: 'world' });
    }

    // R41a: prop合流バッファをマージしてシーンへ追加(色キーごとに1メッシュ)
    for (const [key, parts] of propMerge) {
      if (parts.length === 0) continue;
      const merged = mergeGeometries(parts, false);
      if (!merged) continue;
      const mat = materials.get(key);
      if (!mat) { merged.dispose(); continue; }
      const mergedPropMesh = new THREE.Mesh(merged, mat);
      mergedPropMesh.castShadow = false;
      mergedPropMesh.receiveShadow = true;
      this.scene.add(mergedPropMesh);
    }

    // R53-W2 M2c: プロップ超リアル化v2 — family(metal/wood/stone/foliage/paint/accent/shadow)
    // 別に1メッシュへ集約して材質キットを適用する(最大7 draw call。旧経路から丸ごと
    // 差し替わる分、正味のDC増はこれ未満に収まる=プランナー#7予算+8DC以内)。
    // rand は視覚専用の独立mulberry32(stage.seedから派生。stage.ts内部の既存乱数消費列は
    // 一切消費しない=既存ステージの配置結果・当たり判定は完全不変)。
    if (v2Placements.length > 0) {
      const visRand = mulberry32(this.config.stage.seed ^ 0x53a1e42c);
      const familyGeos = buildPropVisualFamilyGeometries(v2Placements, palette, visRand);
      for (const familyKey of Object.keys(familyGeos) as PropMatFamily[]) {
        const geo = familyGeos[familyKey];
        if (!geo) continue;
        const mat = buildPropFamilyMaterial(familyKey, palette, tier);
        const mesh = new THREE.Mesh(geo, mat);
        const flags = propFamilyShadowFlags(familyKey);
        mesh.castShadow = flags.castShadow;
        mesh.receiveShadow = flags.receiveShadow;
        this.scene.add(mesh);
      }
    }

    // ghost ボックスはビジュアル装飾・アトモスフィア・ミニマップに含めない(描画なし)
    // decor ボックスも除外(草/プロップ/シルエット配置の基点に遠景装飾ボックスを使わない)
    const visibleBoxes = boxes.filter(
      (b) => !(b as { ghost?: boolean }).ghost && !(b as { decor?: boolean }).decor,
    );
    // 障害物のビジュアル装飾(当たり判定には一切触れない・純粋に飾り)
    this.buildPropDecor(visibleBoxes, palette);
    this.buildAtmosphere(this.config.stage.palette, this.config.stage.size);
    // ステージパレットから床/遮蔽物の材質を推定し、足音・着弾音のテクスチャを決める
    this.sounds.setSurfaceMaterial(deriveSurfaceMaterials(this.config.stage.palette));
    // 映画的アトモスフィア(ムード照明/奥行きフォグ/草/環境パーティクル/遠景シルエット)。
    // physics/tags非受領=当たり判定ゼロ・装飾のみ。tier(hoist済)で低スペックは自動ゲート
    // ghost ボックスを除外した visibleBoxes を渡す(草配置/粒子がゴーストバウンダリに依存しない)
    this.atmosphere = new Atmosphere(
      this.scene,
      this.renderer,
      palette,
      resolveMood(palette),
      tier,
      this.settings.reduceMotion,
      size,
      visibleBoxes,
      this.sunDir,
      mulberry32(this.config.stage.seed ^ 0x0a7),
    );

    // R53-W2 M2c: SurfaceKit 5バリアント+v2家族マテリアルのプリウォーム(R11 dissolve教訓)。
    // v2家族メッシュは既に scene へ追加済みなのでこの1回の renderer.compile() で一緒に
    // 事前コンパイルされる。DC実測は ?perfhud=1 で確認できる。
    // ★W4D: ゾンビモードは鍛神カモ(pap1-3)も同乗プリウォーム — 初回改造時の
    // 戦闘中シェーダコンパイルヒッチ(数十ms)を排除する
    if (this.config.mode === 'zombie') {
      const papGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const papMeshes: THREE.Mesh[] = [];
      for (const camoId of ['pap1', 'pap2', 'pap3'] as const) {
        const mat = new CamoStandardMaterial(CAMO_VISUALS[camoId], new THREE.MeshStandardMaterial({ vertexColors: true }));
        const mesh = new THREE.Mesh(papGeo, mat);
        this.scene.add(mesh);
        papMeshes.push(mesh);
      }
      prewarmSurfaceKitVariants(this.scene, this.renderer, this.camera, tier);
      for (const mesh of papMeshes) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      papGeo.dispose();
    } else {
      prewarmSurfaceKitVariants(this.scene, this.renderer, this.camera, tier);
    }
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

  // R30 天候の適用(ロール自体はコンストラクタで rollWeather 済み)。
  // 濃霧: fogDensity 2.2倍 + ambient微減(スナイパー戦の変化。AI索敵はfog連動=R29係数で自然変化)。
  // 雨: fog 1.3倍 + 雨ストリーク粒子(wetness最大化は buildStageScene の resolveWetness が担う)。
  private applyWeather(): void {
    if (this.weatherKind === 'clear') return;
    const palette = this.config.stage.palette;
    const fogMul = this.weatherKind === 'fog' ? 2.2 : 1.3;
    const newDensity = palette.fogDensity * fogMul;
    this.stageFogDensity = newDensity;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = newDensity;
    if (this.weatherKind === 'fog') {
      this.stageAmbient *= 0.85;
      // V30修正: stageAmbientはAI索敵専用フィールドで照明に届かない。HemisphereLightへも適用
      if (this.hemiLight) this.hemiLight.intensity *= 0.85;
    } else {
      this.buildRainParticles();
    }
  }

  // R30 雨粒子: stage.ts の ParticleKind を変更せずに standalone THREE.Points で実装。
  private buildRainParticles(): void {
    const tier = resolveGraphicsTier(
      this.settings.graphicsQuality,
      this.renderer.capabilities.isWebGL2,
    );
    if (tier === 'low') return;
    const count = tier === 'high' ? 800 : 500;
    const sz = this.config.stage.size * 1.1;
    const pos = new Float32Array(count * 3);
    // 決定論的散布(stage.seed派生)。Math.randomを避けアセットレス決定論の流儀に合わせる
    const rng = mulberry32((this.config.stage.seed ^ 0xb4177) >>> 0);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * sz;
      pos[i * 3 + 1] = rng() * 20;
      pos[i * 3 + 2] = (rng() - 0.5) * sz;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const timeUniform = { value: 0 };
    this.rainTimeUniform = timeUniform;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uCamPos: { value: new THREE.Vector3() },
        uBoxSz: { value: sz },
        uBoxH: { value: 20 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uBoxSz, uBoxH;
        uniform vec3 uCamPos;
        varying float vDist;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 7.0, uBoxH);
          p.xz = mod(p.xz - uCamPos.xz + uBoxSz * 0.5, uBoxSz) - uBoxSz * 0.5;
          p += uCamPos;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
          float depth = max(vDist, 0.1);
          gl_PointSize = clamp(22.0 * (120.0 / depth), 1.0, 6.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDist;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float e = uv.x * uv.x * 4.0 + uv.y * uv.y * 0.25;
          if (e > 0.25) discard;
          float alpha = (1.0 - e / 0.25) * 0.35 * clamp(1.0 - vDist / 60.0, 0.0, 1.0);
          gl_FragColor = vec4(0.78, 0.86, 0.96, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.scene.add(this.rainPoints);
  }

  // R20 rank3: ムード/床材質/バイオーム粒子から「濡れ度」(0..0.8)を導く。夜/曇りは雨上がりで
  // 濡れ、溶岩/残り火の荒廃ステージは溶けた地面の照りとして底上げ。砂/雪/芝は濡れパッチが
  // 不自然なので抑える。減光した空IBLを筋状の映り込みで拾わせる濡れアスファルト読み(MW2019)。
  private resolveWetness(palette: StageDef['palette']): number {
    // R30 雨天: 地面wetnessを最大化(0.8)。コンストラクタで buildStageScene 前に
    // weatherKind が確定しているため、床マテリアルの焼き込みへそのまま効く
    if (this.weatherKind === 'rain') return 0.8;
    const mood = resolveMood(palette);
    let base =
      mood === 'night'
        ? 0.68
        : mood === 'overcast'
          ? 0.6
          : mood === 'dusk'
            ? 0.4
            : mood === 'snow'
              ? 0.0
              : 0.12; // day
    if (palette.particle === 'lava') base = Math.max(base, 0.6);
    else if (palette.particle === 'ember') base = Math.max(base, 0.42);
    const surf = deriveSurfaceMaterials(palette).floor;
    const surfMul =
      surf === 'metal' || surf === 'concrete'
        ? 1.0
        : surf === 'wood'
          ? 0.9
          : surf === 'dirt'
            ? 0.55
            : surf === 'grass'
              ? 0.3
              : surf === 'sand'
                ? 0.2
                : 0.0; // snow
    return Math.min(0.8, base * surfMul);
  }

  // R20 rank3: 床マテリアルへ onBeforeCompile でマクロ質感を挿す。頂点で vWorldXZ を作り、
  // (a)diffuseColor を値ノイズで摩耗/汚れ変調(暗め寄せで白飛び回避)、(b)第2ノイズ+濡れ度
  // uniform で roughnessFactor を筋状に~0.35 まで下げ、減光した空IBLの映り込みを拾わせる。
  private applyMacroFloor(mat: THREE.MeshStandardMaterial, wetness: number): void {
    // R54-W1 Q6: low tierはfloorDetailGlsl(亀裂/オイル染み/タイヤ痕)を合成しない
    const tier = resolveGraphicsTier(this.settings.graphicsQuality, this.renderer.capabilities.isWebGL2);
    const detailEligible = floorDetailEligible(tier);
    mat.customProgramCacheKey = () => 'hibana-macrofloor';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWetness = { value: wetness };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          // ★V-C CRITICAL修正: fd_*ヘルパ関数はグローバルスコープ(common)へ。GLSL ES 3.00は
          // main()内の関数定義を許可しないため、floorDetailGlsl()本体(ブロックのみ)と分離挿入する
          `#include <common>\nvarying vec2 vWorldXZ;\nuniform float uWetness;\n${MACRO_NOISE_GLSL}\n${detailEligible ? floorDetailGlslCommon() : ''}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // 摩耗/汚れの巨大階調(グリッド線非依存)。暗め寄せ(0.90..1.045)で明部の白飛びを避ける
            float macroWear = macroFbm(vWorldXZ * 0.16);
            diffuseColor.rgb *= mix(0.90, 1.045, macroWear);
          }
          ${detailEligible ? floorDetailGlsl() : ''}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            // 濡れパッチ: 第2ノイズを一軸へ引き伸ばし筋状に。濡れ度uniformでroughnessを~0.35へ
            float macroWet = macroFbm(vWorldXZ * vec2(0.22, 0.85) + 41.3);
            float wet = smoothstep(0.5, 0.82, macroWet) * uWetness;
            roughnessFactor = mix(roughnessFactor, 0.35, wet);
          }`,
        );
    };
  }

  // R20 rank3: 共有障害物マテリアルへ onBeforeCompile で弱い汚れグラデを挿す。焼込みAO
  // (vertexColor)の上に diffuseColor を ±数% 変調(0.93..1.03)。emissive/AOは非侵襲、
  // bloom閾値(0.9)未満に据え置く。追加DC/ジオメトリはゼロ。
  private applyMacroProp(mat: THREE.MeshStandardMaterial): void {
    mat.customProgramCacheKey = () => 'hibana-macroprop';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec2 vWorldXZ;\n${MACRO_NOISE_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float macroGrime = macroFbm(vWorldXZ * 0.5 + 7.0);
            diffuseColor.rgb *= mix(0.93, 1.03, macroGrime);
          }`,
        );
    };
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
      // T6: 環境プロップ(prop:true)はR38専用ビジュアル(幹/樹冠/構造材等)を既に持つため、
      // ここでの汎用装飾(コンテナ波板リブ/AABB輪郭線/接地影)は二重掛けで害しかない。
      // 例: 樹木の幹(0.5×3.5)が classifyArchetype で 'container' 誤判定され波板が生える。
      if (spec.prop) continue;
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
    // scale=空HDRの全体倍率(可視空の明るさ)、clampMax=太陽ディスク等の上限。
    // R53-W3 M3: 文字列焼き込み→uniform化。非発動時のデフォルト値は従来の焼き込みと
    // バイト同値の挙動(min(retColor*scale, vec3(clamp)))で、黒雷帝の黒転だけが
    // 可視空のuniformを実行時に動かす。envSky(IBLベイク)は従来どおり据え置き=鉄則遵守。
    const applySky = (sky: Sky, scale: number, clampMax: number): { uSkyScale: { value: number }; uSkyClamp: { value: number } } => {
      const u = sky.material.uniforms as unknown as SkyUniforms;
      u.turbidity.value = turbidity;
      u.rayleigh.value = rayleigh;
      u.mieCoefficient.value = mieCoefficient;
      u.mieDirectionalG.value = mieDirectionalG;
      u.sunPosition.value.copy(this.sunDir);
      // R18: Sky.js の太陽ディスクは vSunE*19000 で桁外れに明るく(HDR~5万)、白い塊に飛ぶ。
      // 空フラグメントの出力を「全体を uSkyScale 倍 + uSkyClamp で上限クランプ」して抑える。
      const uSkyScale = { value: scale };
      const uSkyClamp = { value: clampMax };
      sky.material.onBeforeCompile = (shader) => {
        shader.uniforms.uSkyScale = uSkyScale;
        shader.uniforms.uSkyClamp = uSkyClamp;
        shader.fragmentShader = 'uniform float uSkyScale;\nuniform float uSkyClamp;\n' + shader.fragmentShader.replace(
          'gl_FragColor = vec4( retColor, 1.0 );',
          'gl_FragColor = vec4( min( retColor * uSkyScale, vec3( uSkyClamp ) ), 1.0 );',
        );
      };
      sky.material.needsUpdate = true;
      return { uSkyScale, uSkyClamp };
    };

    // ── プロシージャル大気(Sky.js, 大気散乱)を可視背景にする ──
    // R20: 可視の空(=太陽/日差し)を極限まで暗める(scale0.16/clamp0.5)。clampはbloom閾値(0.9)
    // 未満なので太陽ディスクのブルーム光そのものが立たなくなる=眩しさが消える。ステージ全体の
    // 明るさはシーンのライト(sun/Hemi/IBL)が担い、下のenvSky(IBLベイク)は据え置くので地面は暗くならない。
    const sky = new Sky();
    sky.scale.setScalar(Math.max(10000, size * 40));
    // 可視空のuniformハンドルだけを保持(黒雷帝の黒転が動かす)。envSkyのハンドルは保持しない=不可侵
    this.visibleSkyUniforms = applySky(sky, 0.16, 0.5);
    this.scene.add(sky);

    // ステージ別の露出(明暗の演出)
    this.renderer.toneMappingExposure = palette.exposure ?? 1.0;

    // ── 空から環境マップ(IBL)を1回だけ焼く=金属が空を映り込み、最大の質感UPになる ──
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(10000);
    // IBLベイク用は据え置き(scale1.0/clamp2.6)。ここを暗めると金属反射/環境光=ステージの
    // 明るさが落ちてしまう。可視空だけ暗め、地面の明るさは維持する(ユーザー要望)。
    applySky(envSky, 1.0, 2.6);
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

  // ══ R53-W2 M2b: Search & Destroy 配線 ══════════════════════════════════
  // 重ロジック(フェーズ機/先取/交替)は snd.ts の SndRound/SndMatch。match は
  // 座標・入力・生死・音・snapshot の接着だけを行う(薄配線原則)。

  // サイトA/B: ドミネーションのA/C拠点と同じ係数の対角配置(全31ステージで実績のある安全座標)
  private buildSndSites(): void {
    const size = this.config.stage.size;
    this.sndSites = makeSndSites(
      { x: -size * 0.3, z: size * 0.12 },
      { x: size * 0.3, z: -size * 0.12 },
    );
    for (const site of this.sndSites) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(site.radius - 0.35, site.radius, 36),
        new THREE.MeshBasicMaterial({
          color: 0xffb066,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.center.x, 0.06, site.center.z);
      this.scene.add(ring);
      this.sndSiteRings.push(ring);
    }
  }
  private sndSiteRings: THREE.Mesh[] = [];

  // ラウンド開始(first=試合開始時は初期配置をそのまま使う)。
  // 2ラウンド目以降は全員をチームスポーンへ再配置+復活+補給
  private startSndRound(first: boolean): void {
    if (!this.sndMatch) return;
    this.sndRound = new SndRound(this.sndMatch.currentAttackTeam);
    this.sndPlantedSite = null;
    this.sndHoldSite = null;
    this.sndPlayerHolding = null;
    this.sndBotHolding = false;
    this.sndBombDropPos = null;
    this.disposeSndBombMesh();
    this.sndPlantTickTimer = 0;
    this.sndFuseTickTimer = 0;
    // キャリア割当: プレイヤーが攻撃側なら常にプレイヤー(uid=-1)。
    // (シンプル化の設計判断: bot任せの受動的なラウンドを作らない=プレイヤーが主役)
    const attack = this.sndRound.attackTeam;
    if (attack === PLAYER_TEAM) {
      this.sndRound.pickupBomb(-1);
    } else {
      const carrier = this.bots.find((b) => b.team === attack);
      if (carrier) this.sndRound.pickupBomb(carrier.uid);
    }
    // ★V-B修正: ラウンド頭はウルト/ストリークをリセット(BO2 S&D準拠 — ラウンド跨ぎの
    // 持ち越しはラウンド制の緊張感を壊す。初回ラウンドも同じ初期状態から)
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.streakManager.resetAll();
    if (!first) {
      // 全員復活+再配置(kill/deathの数字は維持=S&Dの通算スタッツ)
      const reserved: THREE.Vector3[] = [];
      const sp = this.pickSpawn(this.playerSpawns, [], reserved);
      this.player.respawnAt(sp);
      reserved.push(sp);
      for (const weapon of this.weapons) weapon.resupply();
      this.activeWeapon.raise();
      this.refillGrenades();
      for (const bot of this.bots) {
        const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
        const bsp = this.pickSpawn(spawns, [], reserved);
        bot.respawnAt(bsp);
        reserved.push(bsp);
      }
      this.deathVeil = Math.max(this.deathVeil, 0.5); // ラウンド替わりの短い暗転
    }
    this.announcements.push(
      attack === PLAYER_TEAM ? '攻撃側: 爆弾を設置せよ' : '防衛側: サイトを死守せよ',
    );
  }

  private disposeSndBombMesh(): void {
    if (!this.sndBombMesh) return;
    this.scene.remove(this.sndBombMesh);
    this.sndBombMesh.geometry.dispose();
    (this.sndBombMesh.material as THREE.Material).dispose();
    this.sndBombMesh = null;
  }

  // ボム可視化(ドロップ中=地面の発光箱 / 設置後=サイトの点滅箱)
  private showSndBombMesh(pos: THREE.Vector3, planted: boolean): void {
    this.disposeSndBombMesh();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.26, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x20242c,
        emissive: planted ? 0xff3020 : 0xffb066,
        emissiveIntensity: 0.55,
      }),
    );
    mesh.position.set(pos.x, pos.y + 0.15, pos.z);
    this.scene.add(mesh);
    this.sndBombMesh = mesh;
  }

  // プレイヤー/botの所属が攻撃側か
  private sndIsAttacker(team: TeamId): boolean {
    return this.sndRound?.attackTeam === team;
  }

  private updateSnd(dt: number): void {
    const round = this.sndRound;
    const sndMatch = this.sndMatch;
    if (!round || !sndMatch || !this.sndSites) return;

    // ノーリスポーン: 死亡者の復活カウントダウンを毎tick凍結(roundEnd中も=次ラウンド側で復活させる)
    if (!this.player.alive) this.player.respawnIn = Infinity;
    for (const b of this.bots) {
      if (!b.alive) b.respawnIn = Infinity;
    }

    // ── キャリア死亡→ドロップ/拾得 ──
    if (round.phase === 'live') {
      if (round.carrierUid === -1 && !this.player.alive && this.sndBombDropPos === null) {
        this.sndBombDropPos = this.player.position.clone();
        round.dropBomb();
        this.showSndBombMesh(this.sndBombDropPos, false);
        this.announcements.push('爆弾がドロップした');
        this.sounds.sndBombDrop(); // W4D: 緊張の要所の情報音
      } else if (round.carrierUid !== null && round.carrierUid >= 0) {
        const carrier = this.bots.find((b) => b.uid === round.carrierUid);
        if (carrier && !carrier.alive && this.sndBombDropPos === null) {
          this.sndBombDropPos = carrier.position.clone();
          round.dropBomb();
          this.showSndBombMesh(this.sndBombDropPos, false);
          this.sounds.sndBombDrop();
        }
      }
      // 拾得(攻撃側のみ、1.6m)
      if (this.sndBombDropPos !== null && round.carrierUid === null) {
        if (
          this.sndIsAttacker(PLAYER_TEAM) &&
          this.player.alive &&
          this.player.position.distanceTo(this.sndBombDropPos) < 1.6
        ) {
          round.pickupBomb(-1);
          this.sndBombDropPos = null;
          this.disposeSndBombMesh();
          this.sounds.sndBombPickup();
        } else {
          for (const b of this.bots) {
            if (!b.alive || !this.sndIsAttacker(b.team)) continue;
            if (b.position.distanceTo(this.sndBombDropPos) < 1.6) {
              round.pickupBomb(b.uid);
              this.sndBombDropPos = null;
              this.disposeSndBombMesh();
              this.sounds.sndBombPickup();
              break;
            }
          }
        }
      }
    }

    // ── プレイヤーの設置/解除ホールド(E長押し。毎tick再判定→継続しないならcancel) ──
    this.sndPlayerHolding = null;
    const holdE = this.player.alive && this.input.isDown('interact');
    if (round.phase === 'live' && round.carrierUid === -1 && holdE) {
      const site = this.sndSites.find((s) => isWithinSndSite(s, this.player.position));
      if (site) {
        this.sndHoldSite = site;
        round.beginPlant();
        this.sndPlayerHolding = 'plant';
        this.sndPlantTickTimer -= dt;
        if (this.sndPlantTickTimer <= 0) {
          this.sndPlantTickTimer = Math.max(0.12, 0.4 * (1 - round.plantProgress01));
          this.sounds.sndPlantTick();
        }
      } else if (round.isPlanting) round.cancelPlant();
    } else if (round.isPlanting && !this.sndBotHolding) {
      round.cancelPlant();
    }
    if (round.phase === 'planted' && !this.sndIsAttacker(PLAYER_TEAM) && holdE && this.sndPlantedSite) {
      if (isWithinSndSite(this.sndPlantedSite, this.player.position)) {
        round.beginDefuse();
        this.sndPlayerHolding = 'defuse';
      } else if (round.isDefusing && !this.sndBotHolding) round.cancelDefuse();
    } else if (round.phase === 'planted' && round.isDefusing && !this.sndBotHolding) {
      // プレイヤーがこのtickで defuse を開始していない(上の分岐に入らなかった)かつ
      // botも前tickで保持していない → 中断(botの保持は直後のブロックで毎tick再判定される)
      round.cancelDefuse();
    }

    // ── botの自動設置/解除(キャリアbot・最寄り守備bot。プレイヤーと同時には起きない=排他) ──
    this.sndBotHolding = false;
    if (round.phase === 'live' && round.carrierUid !== null && round.carrierUid >= 0) {
      const carrier = this.bots.find((b) => b.uid === round.carrierUid);
      if (carrier?.alive) {
        const site = this.sndSites.find((s) => isWithinSndSite(s, carrier.position));
        if (site) {
          this.sndHoldSite = site;
          round.beginPlant();
          this.sndBotHolding = true;
        } else if (round.isPlanting && this.sndPlayerHolding !== 'plant') {
          round.cancelPlant();
        }
      }
    }
    if (round.phase === 'planted' && this.sndPlantedSite && this.sndIsAttacker(PLAYER_TEAM)) {
      // プレイヤーが攻撃側のとき、守備botが解除を試みる
      const defuser = this.bots.find(
        (b) => b.alive && !this.sndIsAttacker(b.team) && isWithinSndSite(this.sndPlantedSite!, b.position),
      );
      if (defuser) {
        round.beginDefuse();
        this.sndBotHolding = true;
      } else if (round.isDefusing && this.sndPlayerHolding !== 'defuse') {
        round.cancelDefuse();
      }
    }

    // ── ヒューズ鼓動(planted中、残時間で加速) ──
    if (round.phase === 'planted') {
      const urgency = 1 - round.phaseTimeLeft / SND_FUSE_S;
      this.sndFuseTickTimer -= dt;
      if (this.sndFuseTickTimer <= 0) {
        this.sndFuseTickTimer = THREE.MathUtils.lerp(1.2, 0.25, urgency);
        this.sounds.sndFuseTick(urgency);
      }
    }

    // ── フェーズ機の進行+イベント処理 ──
    const events = round.update(dt);
    for (const ev of events) {
      if (ev.kind === 'planted') {
        this.sndPlantedSite = this.sndHoldSite ?? this.sndSites[0];
        const c = this.sndPlantedSite.center;
        this.showSndBombMesh(new THREE.Vector3(c.x, 0, c.z), true);
        this.sounds.sndPlanted();
        this.announcements.push(`爆弾設置: ${this.sndPlantedSite.id}サイト`);
      } else if (ev.kind === 'defused') {
        this.sounds.sndDefused();
        this.disposeSndBombMesh();
      } else if (ev.kind === 'detonate') {
        this.sounds.sndDetonate();
        if (this.sndPlantedSite) {
          const c = this.sndPlantedSite.center;
          const pos = new THREE.Vector3(c.x, 0.5, c.z);
          this.effects.explosion(pos, 8);
          this.addShake(0.5);
          // 起爆の巻き込み(演出込みの実害: 半径12m)
          if (this.player.alive && this.player.position.distanceTo(pos) < 12) {
            const died = this.player.takeDamage(160);
            if (died) {
              this.feed.push({ killer: '爆弾', victim: PLAYER_NAME, weapon: '起爆', headshot: false });
              this.sounds.death();
              this.notePlayerDeath(null);
            }
          }
        }
        this.disposeSndBombMesh();
      } else if (ev.kind === 'round-win') {
        this.handleSndRoundWin(ev.winner, ev.reason === 'defenders-dead' || ev.reason === 'attackers-dead');
      }
    }

    // ── 全滅判定(update後=同tickの死亡を反映。planted中の攻撃側全滅はsnd.tsが継続を保証) ──
    if (!round.isResolved) {
      const attackAlive = this.sndTeamAliveCount(round.attackTeam);
      const defendAlive = this.sndTeamAliveCount(round.defendTeam);
      if (attackAlive === 0) {
        const winner = round.resolveRound('attackers-dead');
        if (winner !== null) this.handleSndRoundWin(winner, true);
      } else if (defendAlive === 0) {
        const winner = round.resolveRound('defenders-dead');
        if (winner !== null) this.handleSndRoundWin(winner, true);
      }
    }

    // ── ラウンド終了→次ラウンド or 試合終了 ──
    if (round.phase === 'roundEnd' && round.phaseTimeLeft <= 0) {
      if (sndMatch.matchWinner() !== null) {
        this.over = true;
      } else {
        this.startSndRound(false);
      }
    }
  }

  private sndTeamAliveCount(team: TeamId): number {
    let n = 0;
    if (team === PLAYER_TEAM && this.player.alive) n += 1;
    for (const b of this.bots) if (b.alive && b.team === team) n += 1;
    return n;
  }

  private handleSndRoundWin(winner: TeamId, byWipe: boolean): void {
    if (!this.sndMatch || !this.sndRound) return;
    this.sndMatch.recordRound(winner);
    const won = winner === PLAYER_TEAM;
    this.sounds.sndRoundWin(won);
    this.announcements.push(won ? 'ラウンド勝利' : 'ラウンド敗北');
    // snd-ace: 自チームの全滅勝ち(1ラウンド全滅勝利)でプレイヤーが生存していた場合
    if (won && byWipe && this.player.alive) {
      const out: MedalEvent[] = [];
      this.tracker.emitManual('snd-ace', out);
      this.emitMedals(out);
    }
  }

  private zoneColor(owner: TeamId | null): number {
    if (owner === null) return 0xb9c2cc;
    return owner === PLAYER_TEAM ? this.colors.ally : this.colors.enemy;
  }

  // ── ハードポイント ─────────────────────────────────────────────────────────────────────

  /** ハードポイントのゾーン座標を決定論的に配置し、最初のリングを生成する */
  private buildHardpointZones(): void {
    const size = this.config.stage.size;
    // 5カ所を決定論的に配置(ドミネーション3拠点と同じ係数感)
    const raw: Array<[number, number]> = [
      [-size * 0.28,  size * 0.1 ],
      [ size * 0.18, -size * 0.22],
      [ size * 0.3,   size * 0.15],
      [-size * 0.15,  size * 0.28],
      [ 0,            0           ],
    ];
    this.hardpointZonePositions.length = 0;
    for (const [x, z] of raw) this.hardpointZonePositions.push(new THREE.Vector3(x, 0, z));

    const ring = this.makeHardpointRing(0xffd700);
    ring.rotation.x = -Math.PI / 2;
    const pos = this.hardpointZonePositions[0]!;
    ring.position.set(pos.x, 0.07, pos.z);
    this.hardpointRing = ring;
    this.scene.add(ring);
  }

  private makeHardpointRing(color: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.RingGeometry(ZONE_RADIUS - 0.35, ZONE_RADIUS, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    );
  }

  private updateHardpoint(dt: number): void {
    const state = this.hardpointState;
    if (!state) return;

    const zonePos = this.hardpointZonePositions[state.currentZoneIndex];
    if (!zonePos) return;

    // ゾーン内の在中人数を集計
    const presence = new Map<TeamId, number>();
    const countEntity = (pos: THREE.Vector3, team: TeamId) => {
      const dx = pos.x - zonePos.x;
      const dz = pos.z - zonePos.z;
      if (Math.hypot(dx, dz) < ZONE_RADIUS && Math.abs(pos.y - zonePos.y) < 3) {
        presence.set(team, (presence.get(team) ?? 0) + 1);
      }
    };
    if (this.player.alive) countEntity(this.player.position, PLAYER_TEAM);
    for (const bot of this.bots) {
      if (bot.alive) countEntity(bot.position, bot.team);
    }

    const { points } = state.update(dt, presence, (_from, to) => {
      const newPos = this.hardpointZonePositions[to];
      const names = ['HP-1', 'HP-2', 'HP-3', 'HP-4', 'HP-5'];
      this.announcements.push(`ハードポイント移動 → ${names[to] ?? to + 1}`);
      if (this.hardpointRing && newPos) {
        this.hardpointRing.position.set(newPos.x, 0.07, newPos.z);
      }
    });
    for (const [team, n] of points) this.scores.add(team, n);

    // リングの色を占拠状態に同期
    if (this.hardpointRing) {
      const mat = this.hardpointRing.material as THREE.MeshBasicMaterial;
      const snap = state.snapshot();
      if (snap.contested) {
        mat.color.setHex(0xffffff);
        mat.opacity = 0.95;
      } else if (snap.owner === PLAYER_TEAM) {
        mat.color.setHex(this.colors.ally);
        mat.opacity = 0.8;
      } else if (snap.owner === ENEMY_TEAM) {
        mat.color.setHex(this.colors.enemy);
        mat.opacity = 0.8;
      } else {
        mat.color.setHex(0xffd700);
        mat.opacity = 0.65;
      }
    }

    // プレイヤーが占拠に貢献した場合の個人スコアイベント(1pt毎秒ごとに1回)
    if (points.get(PLAYER_TEAM) && this.player.alive) {
      const snap = state.snapshot();
      const dx = this.player.position.x - zonePos.x;
      const dz = this.player.position.z - zonePos.z;
      if (snap.owner === PLAYER_TEAM && !snap.contested && Math.hypot(dx, dz) < ZONE_RADIUS) {
        this.playerCaptures += points.get(PLAYER_TEAM)!;
      }
    }
  }

  /** ハードポイントのsnapshotフィールド群を返す(snapshot()のスプレッドで使用) */
  private buildHardpointSnap(): {
    hardpointZoneAngle?: number;
    hardpointZoneRelX?: number;
    hardpointZoneRelZ?: number;
    hardpointOwner?: 'mine' | 'enemy' | null;
    hardpointContested?: boolean;
    hardpointTimeLeft?: number;
    hardpointPreview?: boolean;
  } {
    if (!this.hardpointState) return {};
    const snap = this.hardpointState.snapshot();
    const pos = this.hardpointZonePositions[snap.zoneIndex];
    const side = (t: TeamId | null): 'mine' | 'enemy' | null =>
      t === null ? null : t === PLAYER_TEAM ? 'mine' : 'enemy';
    const base = {
      hardpointOwner: side(snap.owner),
      hardpointContested: snap.contested,
      hardpointTimeLeft: snap.timeUntilRotation,
      hardpointPreview: snap.timeUntilRotation <= 10,
    };
    if (!pos) return base;
    const relX = pos.x - this.player.position.x;
    const relZ = pos.z - this.player.position.z;
    let angle: number | undefined;
    if (this.player.alive) {
      const worldAngle = Math.atan2(relX, relZ);
      const forwardAngle = Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
      // V30修正: 減算順が逆で矢印が左右ミラーしていた。既存レーダー規約(右が正)に統一
      angle = wrapAngle(forwardAngle - worldAngle);
    }
    return { ...base, hardpointZoneRelX: relX, hardpointZoneRelZ: relZ, hardpointZoneAngle: angle };
  }

  // ── キルコンファーム ───────────────────────────────────────────────────────────────────

  private updateKillConfirm(dt: number): void {
    if (!this.kcState) return;

    // 期限切れタグを削除
    const expired = this.kcState.pruneExpired(this.elapsed);
    for (const id of expired) this.removeDogTagEntity(id);

    // プレイヤーがタグを自動回収(alive時のみ)
    if (this.player.alive) {
      const res = this.kcState.tryCollect(PLAYER_TEAM, {
        x: this.player.position.x,
        z: this.player.position.z,
      });
      if (res) {
        this.removeDogTagEntity(res.id);
        this.scores.add(PLAYER_TEAM, res.points);
        this.kcEvent = res.event === 'confirm' ? 'confirmed' : 'denied';
        if (res.event === 'confirm') {
          this.scoreEvents.push({ label: 'CONFIRMED', xp: res.points });
          this.sounds.capture();
          this.addUltCharge(ULT_ON_CAPTURE);
          this.playerCaptures += 1;
        } else {
          this.scoreEvents.push({ label: 'DENIED', xp: res.points });
        }
      }
    }

    // ボットが近傍タグを自動回収
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const res = this.kcState.tryCollect(bot.team, { x: bot.position.x, z: bot.position.z });
      if (res) {
        this.removeDogTagEntity(res.id);
        this.scores.add(bot.team, res.points);
      }
    }

    // ドッグタグのボブ + 消える直前の点滅アニメ
    for (const entity of this.kcDogTagEntities) {
      entity.group.position.y = 0.45 + Math.sin(this.elapsed * 2.5 + entity.id * 0.7) * 0.1;
      entity.group.rotation.y += dt * 1.2;
      const age = this.elapsed - entity.spawnedAt;
      const remaining = 30 - age;
      if (remaining < 5) {
        const v = (Math.sin(this.elapsed * 10) + 1) * 0.5;
        entity.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            (obj.material as THREE.MeshBasicMaterial).opacity = 0.3 + v * 0.65;
          }
        });
      }
    }
  }

  /** ボットが死亡した際にキルコンファームのドッグタグをスポーンする */
  private spawnDogTag(bot: Bot): void {
    if (!this.kcState) return;
    const id = this.kcState.spawnTag(
      { x: bot.position.x, y: bot.position.y, z: bot.position.z },
      bot.team,
      this.elapsed,
    );
    const isEnemyTag = bot.team !== PLAYER_TEAM; // 敵チームのタグ = 金
    const group = this.buildDogTagMesh(isEnemyTag);
    group.position.set(bot.position.x, bot.position.y + 0.45, bot.position.z);
    this.scene.add(group);
    this.kcDogTagEntities.push({ id, group, isEnemy: isEnemyTag, spawnedAt: this.elapsed });
  }

  /** プレイヤーが死亡した際に味方タグをスポーンする */
  private spawnPlayerDogTag(): void {
    if (!this.kcState) return;
    const id = this.kcState.spawnTag(
      { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
      PLAYER_TEAM,
      this.elapsed,
    );
    const group = this.buildDogTagMesh(false); // 味方タグ = 赤
    group.position.set(this.player.position.x, this.player.position.y + 0.45, this.player.position.z);
    this.scene.add(group);
    this.kcDogTagEntities.push({ id, group, isEnemy: false, spawnedAt: this.elapsed });
  }

  /** ドッグタグの3Dメッシュを生成する。enemy=金、ally=赤 */
  private buildDogTagMesh(isEnemyTag: boolean): THREE.Group {
    const color = isEnemyTag ? 0xffd700 : 0xff2828;
    const group = new THREE.Group();
    // 円盤ボディ
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.04, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    group.add(cyl);
    // 光リング
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.025, 8, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    return group;
  }

  private removeDogTagEntity(id: number): void {
    const idx = this.kcDogTagEntities.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const entity = this.kcDogTagEntities[idx]!;
    this.scene.remove(entity.group);
    entity.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.kcDogTagEntities.splice(idx, 1);
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
    if (this.over) {
      // キルカム trailing window: over後もFK_WIN_POST秒間だけelapsed/killcam.tickRecordを継続。
      // 物理/AI/スコアは動かさない=記録専用。これでキル後のフレームがバッファに蓄積され、
      // スロー再生後半(kill〜kill+1.2s)が静止画面になるバグを根治する。
      if (
        this.config.mode !== 'zombie' &&
        this.killcam.killElapsed !== -Infinity &&
        this.elapsed <= this.killcam.killElapsed + FK_WIN_POST
      ) {
        this.elapsed += dt;
        this.killcam.tickRecord(this.elapsed);
      }
      return;
    }
    this.elapsed += dt;
    this.tracker.tick(dt);
    // ゾンビは「ダウンするまで無限ウェーブ」。共通試合タイマーで強制終了させない(致命バグ回避)。
    // over は zombieMelee のプレイヤー死亡でのみ立てる(handleRespawns)。timeLeftはHUD非表示。
    // R53-W2 M2b: S&Dも SndRound が時間管理(live 90s/fuse 45s)のため共通タイマー対象外
    if (this.config.mode !== 'zombie' && this.config.mode !== 'snd') {
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

    // ③ 期限切れ発砲ブリップの削除(1秒経過。先頭から順に古い順なので前方trimのみ)
    if (this._fireBlips.length > 0) {
      const cutoff = this.elapsed - 1.0;
      let trimEnd = 0;
      while (trimEnd < this._fireBlips.length && (this._fireBlips[trimEnd]?.spawnedAt ?? 0) < cutoff) {
        trimEnd++;
      }
      if (trimEnd > 0) this._fireBlips.splice(0, trimEnd);
    }
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.whiteout = Math.max(0, this.whiteout - dt / 3.2);
    // R45a: リロードキルビット減衰
    if (this.reloadKillTimer > 0) {
      this.reloadKillTimer = Math.max(0, this.reloadKillTimer - dt);
      if (this.reloadKillTimer <= 0) this.reloadKillBit = false;
    }

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

    // ADS: ホールドまたはトグル(アクセシビリティ設定)。RC-XD操縦中は右クリックをキャンセルに使うためADS無効
    if (!this.rcxdActive && this.settings.adsToggle && this.input.adsPressed()) {
      this.adsLatch = !this.adsLatch;
    }
    const wantAds = !this.rcxdActive && (this.settings.adsToggle ? this.adsLatch : this.input.adsDown());

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
    // RC-XD操縦中はWASDをRC車体へ横取りするためプレイヤー移動を0化する
    const moveInput = {
      x: this.rcxdActive ? 0 : clampUnit(
        this.input.gpMoveX + (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0),
      ),
      z: this.rcxdActive ? 0 : clampUnit(
        this.input.gpMoveZ + (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0),
      ),
      jumpPressed: this.rcxdActive ? false : this.input.wasPressed('jump'),
      crouch: this.rcxdActive ? false : (this.settings.crouchToggle ? this.crouchLatch : this.input.isDown('crouch')),
      crouchPressed: this.rcxdActive ? false : crouchPressed,
      sprint: this.rcxdActive ? false : this.input.isDown('sprint'),
      lean: this.rcxdActive ? 0 : (this.config.mode === 'zombie' || this.nearCarePackage()
        ? -(this.input.isDown('leanleft') ? 1 : 0)
        : (this.input.isDown('leanright') ? 1 : 0) - (this.input.isDown('leanleft') ? 1 : 0)),
    };
    this.player.update(dt, moveInput, weapon.adsProgress, this.sounds);
    // 移動由来のカメラシェイク(着地・ブースト)+ビューモデルの着地インパルス
    if (this.player.landImpact > 6) {
      this.addShake(Math.min(0.5, this.player.landImpact * 0.03));
      this.viewModel.applyLandBob(Math.min(1, this.player.landImpact / 18));
      // R44a: 着地衝撃エフェクト
      if (!this.killcamCamActive) {
        this.effects.landingShockwave(
          new THREE.Vector3(this.player.position.x, this.player.position.y - PLAYER_FEET_OFFSET, this.player.position.z),
          Math.min(1, this.player.landImpact / 24),
          this.settings.reduceMotion,
        );
      }
    }
    if (this.player.justBoosted) this.addShake(0.12);
    // ── R44a/R45a: 状態遷移検出 ──
    {
      const nowSliding = this.player.sliding;
      const nowWallRunning = this.player.wallRunning;
      const nowGrounded = this.player.grounded;
      if (this.prevSliding && !nowSliding && !this.killcamCamActive) this.tracker.onSlideEnd();
      if (this.prevWallRunning && !nowWallRunning && !this.killcamCamActive) this.tracker.onWallRunEnd();
      if (!this.prevGrounded && nowGrounded && !this.killcamCamActive) this.tracker.onLand();
      this.prevSliding = nowSliding;
      this.prevWallRunning = nowWallRunning;
      this.prevGrounded = nowGrounded;
    }
    // ── R44a: スライドスパーク(10Hz) ──
    if (this.player.sliding && this.player.alive && !this.killcamCamActive) {
      this.slideSparksTimer -= dt;
      if (this.slideSparksTimer <= 0) {
        this.slideSparksTimer = 0.10;
        const slideDir = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
        this.effects.slideSparks(
          new THREE.Vector3(this.player.position.x, this.player.position.y - PLAYER_FEET_OFFSET, this.player.position.z),
          slideDir, this.settings.reduceMotion,
        );
      }
    } else {
      this.slideSparksTimer = 0;
    }
    // ── R44a: 壁走りスパーク(8Hz) ──
    if (this.player.wallRunning && this.player.alive && !this.killcamCamActive) {
      this.wallRunSparksTimer -= dt;
      if (this.wallRunSparksTimer <= 0) {
        this.wallRunSparksTimer = 0.125;
        const wallNormal = new THREE.Vector3(Math.cos(this.player.yaw), 0, Math.sin(this.player.yaw));
        this.effects.wallRunSparks(this.player.position.clone(), wallNormal, this.settings.reduceMotion);
      }
    } else {
      this.wallRunSparksTimer = 0;
    }
    // ── R45a: プレイヤー足音 ──
    if (this.player.alive && this.player.grounded && !this.player.sliding && !this.killcamCamActive) {
      const pSpeed = this.player.sprinting ? 1.0 : this.player.crouching ? 0.3 : 0.6;
      const pInterval = this.player.sprinting ? 0.28 : this.player.crouching ? 0.6 : 0.40;
      const pMoving = Math.abs(moveInput.x) > 0.05 || Math.abs(moveInput.z) > 0.05;
      if (pMoving) {
        this.playerFootstepTimer -= dt;
        if (this.playerFootstepTimer <= 0) {
          this.playerFootstepTimer = pInterval;
          const fVariant: 'dark' | 'raitei' | undefined =
            this.darkEmperorTimer > 0 ? 'dark' : this.raiteiMode ? 'raitei' : undefined;
          this.sounds.footstep(pSpeed, false, fVariant);
        }
      } else {
        this.playerFootstepTimer = 0;
      }
    } else {
      this.playerFootstepTimer = 0;
    }

    this.handleWeaponSwitch();
    this.handleMelee();
    if (this.config.mode === 'zombie') this.handleZombieInteract();
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
        this.slamCooldownS = 0.15; // 神化仕様: ほぼ連発可(装填の空白のみ残す)
      }
      this.slamPending = false;
    }

    const sprintBlocksFire = this.player.sprinting;
    this.prevMagAmmo = weapon.magazine.rounds; // R45a: 発射直前残弾キャプチャ
    const events = weapon.update(
      dt * 1000,
      {
        trigger: this.input.fireDown() && this.player.alive && !sprintBlocksFire && !this.cooking && !this.rcxdActive && !this.exoticHoldFireCharging, // V37: 溜め中の空撃ち弾薬消費を止める
        ads: wantAds && this.player.alive && !this.cooking && !this.rcxdActive,
        reloadPressed: !this.rcxdActive && this.input.wasPressed('reload'),
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
          } else if (!this.isCharging) {
            // isCharging=true 中は doPunch をスキップ(updateChargeAttack が管理)
            this.doPunch();
          }
          continue;
        }
        // ロケットランチャー: ヒットスキャン無し。弾体エンティティを発射して終わり。
        if (weapon.def.class === 'launcher') {
          this.player.yaw -= event.recoil.yaw;
          this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
          this.fireRocket();
          this.viewModel.fire(false);
          this.addShake(0.09);
          this.sounds.rocketLaunch();
          this.alertBots(ALERT_RADIUS);
          continue;
        }
        // ── R33 特殊武器分岐 ──
        if (weapon.def.special === 'fan') {
          if (this.exoticHoldFireCharging) { continue; }
          this.player.yaw -= event.recoil.yaw;
          this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
          this.fireFanShot(event.spreadRad);
          this.viewModel.fire(false);
          this.addShake(0.04 * (1 - 0.6 * weapon.adsProgress));
          this.sounds.fanWhoosh();
          this.alertBots(ALERT_RADIUS);
          continue;
        }
        if (weapon.def.special === 'staff') {
          this.player.yaw -= event.recoil.yaw;
          this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
          this.fireStaffBolt();
          this.viewModel.fire(false);
          this.addShake(0.07);
          this.sounds.staffFire(); // 配線: 専用の雷放出音へ置換(汎用shot(dmr)を廃止)
          this.alertBots(ALERT_RADIUS);
          continue;
        }
        if (weapon.def.special === 'beam') {
          if (this.exoticHoldFireCharging) { continue; }
          this.player.yaw -= event.recoil.yaw;
          this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
          this.fireBeam(event.spreadRad);
          this.viewModel.fire(false);
          this.addShake(0.06);
          this.sounds.beamFire();
          this.alertBots(ALERT_RADIUS);
          continue;
        }
        if (weapon.def.special === 'minigun') {
          if (this.shuraRampageTimer > 0) { continue; }
          if (this.minigunCurrentRpm >= 400) {
            const prob = this.minigunCurrentRpm / weapon.def.rpm;
            if (Math.random() < prob) {
              this.player.yaw -= event.recoil.yaw * 0.3;
              this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch * 0.3);
              this.fireShot(event.spreadRad);
              this.viewModel.fire(false);
              this.addShake(0.015);
              this.sounds.shot(weapon.def.soundProfile);
            } else {
              // F2: 確率ゲートで発射しなかったfireイベントの弾を返却(無音消費の根治)
              weapon.magazine.rounds = refundRound(weapon.magazine.rounds, weapon.magazine.capacity);
            }
            this.alertBots(ALERT_RADIUS);
          } else {
            // F2: スピンアップ中(<400rpm)は発砲しないのに弾だけ減っていた。返却する
            weapon.magazine.rounds = refundRound(weapon.magazine.rounds, weapon.magazine.capacity);
          }
          continue;
        }
        if (weapon.def.special === 'shuriken') {
          if (this.exoticHoldFireCharging) { continue; }
          this.player.yaw -= event.recoil.yaw;
          this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
          // F8: hitscanの着弾点までで手裏剣discの飛行を打ち切る(命中後の貫通飛翔を防ぐ)
          const discHit = this.fireShot(event.spreadRad);
          this.fireShurikenDisc(discHit);
          this.viewModel.fire(false);
          this.addShake(0.02);
          this.sounds.shotSuppressed();
          this.alertBots(ALERT_RADIUS_SUPPRESSED);
          continue;
        }
        if (weapon.def.special === 'bow') {
          if (weapon.adsProgress > 0.3) {
            // ADS保持: チャージ開始
            this.bowCharging = true;
            this.bowChargeTimer = 0;
            this.bowChargeTickTimer = 0;
            this.viewModel.setBowCharge(0);
          } else {
            // 即時弱射(ノーチャージ)
            this.player.yaw -= event.recoil.yaw;
            this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
            this.fireBowArrow(0);
            this.viewModel.fire(false);
            this.sounds.bowRelease();
            this.alertBots(ALERT_RADIUS_SUPPRESSED);
          }
          continue;
        }
        if (weapon.def.id === 'gouen-musket' && this.exoticHoldFireCharging) { continue; }
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
        // F5: リロード開始で弓チャージを確実に解除(チャージ表示/引き絞りの残留を防ぐ)
        this.bowCharging = false;
        this.bowChargeTimer = 0;
        this.viewModel.setBowCharge(0);
      } else if (event.type === 'reload-finish') {
        // R45a: リロード完了
        this.reloadKillBit = true;
        this.reloadKillTimer = 1.5;
        this.tracker.onReloadDone();
        if (!this.killcamCamActive) {
          this.effects.reloadCompleteFlash(this.viewModel.muzzleWorldPosition(new THREE.Vector3()));
        }
      } else if (event.type === 'dryfire') {
        this.sounds.dryfire();
      }
    }
    const recovered = weapon.recoil.recover(dt);
    this.player.yaw += recovered.yaw;
    this.player.pitch -= recovered.pitch;

    // ── R33 月光弓チャージ更新 ──
    if (this.bowCharging && this.activeWeapon.def.special === 'bow') {
      this.bowChargeTimer = Math.min(1.2, this.bowChargeTimer + dt);
      this.viewModel.setBowCharge(this.bowChargeTimer / 1.2);
      this.bowChargeTickTimer -= dt;
      if (this.bowChargeTickTimer <= 0 && !this.settings.reduceMotion) {
        this.bowChargeTickTimer = 0.18;
        this.sounds.bowStringTension(this.bowChargeTimer / 1.2);
        // R44a: 月光弓チャージフェーズエフェクト
        if (!this.killcamCamActive) {
          this.effects.gekkouMoonPhaseCharge(
            this.player.eyePosition.clone(),
            this.bowChargeTimer / 1.2,
            this.settings.reduceMotion,
          );
        }
      }
      if (!this.input.fireDown()) {
        // trigger離し → 発射
        const charge = this.bowChargeTimer;
        this.fireBowArrow(charge);
        this.viewModel.fire(weapon.def.scope === true);
        this.sounds.bowRelease();
        this.alertBots(ALERT_RADIUS_SUPPRESSED);
        this.bowCharging = false;
        this.bowChargeTimer = 0;
        this.viewModel.setBowCharge(0);
      } else if (this.bowChargeTimer >= 1.2) {
        // 最大チャージ到達: 満月の矢(charge special)
        this.fireGekkouFullMoon();
        this.bowCharging = false;
        this.bowChargeTimer = 0;
        this.viewModel.setBowCharge(0);
      }
    }
    // ── R33 天雷杖チャージ(ADS時間でaoeRadius拡大) ──
    if (weapon.def.special === 'staff') {
      const adsHeld = weapon.adsProgress > 0.3;
      this.staffChargeTimer = adsHeld
        ? Math.min(0.8, this.staffChargeTimer + dt)
        : Math.max(0, this.staffChargeTimer - dt * 2);
      this.viewModel.setStaffCharge(this.staffChargeTimer / 0.8);
      this.viewModel.setExoticCharge('tenrai-staff', this.staffChargeTimer / 0.8);
      // F7: チャージ中に0.15s周期でstaffChargeTick音
      if (adsHeld && this.staffChargeTimer > 0) {
        this.staffChargeTickTimer -= dt;
        if (this.staffChargeTickTimer <= 0) {
          this.staffChargeTickTimer = 0.15;
          this.sounds.staffChargeTick(this.staffChargeTimer / 0.8);
        }
        // 最大チャージ(0.8s)到達: 天罰(charge special)
        if (this.staffChargeTimer >= 0.8 && !this.tenraiMaxChargeFired) {
          this.tenraiMaxChargeFired = true;
          this.fireTenraiTenbatsu();
        }
      } else {
        this.staffChargeTickTimer = 0;
        this.tenraiMaxChargeFired = false;
      }
    } else {
      this.staffChargeTimer = 0;
      this.staffChargeTickTimer = 0;
    }
    // ── R33 修羅スピンアップ/ダウン ──
    if (weapon.def.special === 'minigun') {
      const triggerHeld = this.input.fireDown() && this.player.alive && !this.player.sprinting;
      const prevRpm = this.minigunCurrentRpm;
      this.minigunCurrentRpm = minigunNextRpm(this.minigunCurrentRpm, dt, triggerHeld);
      this.viewModel.setMinigunSpin(this.minigunCurrentRpm / 1800);
      if (prevRpm < 50 && this.minigunCurrentRpm >= 50 && !this.minigunSpinWasActive) {
        this.sounds.minigunSpin(true);
        this.minigunSpinWasActive = true;
      }
      if (!triggerHeld && this.minigunSpinWasActive && this.minigunCurrentRpm < 50) {
        this.minigunSpinWasActive = false;
        this.sounds.minigunSpin(false);
      }
    } else if (this.minigunCurrentRpm > 0) {
      this.minigunCurrentRpm = minigunNextRpm(this.minigunCurrentRpm, dt, false);
      this.viewModel.setMinigunSpin(this.minigunCurrentRpm / 1800);
      // F6: 切替後スピンダウン完了時に音/フラグを同期
      if (this.minigunSpinWasActive && this.minigunCurrentRpm < 50) {
        this.minigunSpinWasActive = false;
        this.sounds.minigunSpin(false);
      }
    }

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
    this.updateRockets(dt);
    this.updateBowProjectiles(dt);
    this.updateStaffProjectiles(dt);
    this.updateShurikenDiscs(dt);
    this.updateFirePatches(dt);
    this.smokeZones = this.smokeZones.filter((zone) => zone.until > this.elapsed);
    this.updateZones(dt);
    this.updateHardpoint(dt);
    this.updateKillConfirm(dt);

    if (!this.player.alive && this.killcamTimer > 0) this.killcamTimer -= dt;
    // 遷移黒幕/突入フラッシュは死亡ゲート外で無条件減衰(リスポーン後の黒画面固着を防ぐ)
    this.deathVeil = Math.max(0, this.deathVeil - dt * 4);
    this.killcamFlash = Math.max(0, this.killcamFlash - dt * 5.5);
    this.zombieReviveFlash = Math.max(0, this.zombieReviveFlash - dt * 2.5);
    // キルカメラのカメラ姿勢を固定dtで前進(時間前進はここ1箇所に集約=冪等)
    this.advanceKillcam(dt);

    // BO2 スコアストリーク: UAV/HK/LS/Turret は死亡中も進行(タイマー凍結防止)。
    // 入力受付(発動キー)は updateStreaks 内で alive ゲート済み。
    if (this.config.mode !== 'zombie') {
      this.updateStreaks(dt);
    }
    this.updateWindShuriken(dt);
    this.updateLightningBeast(dt);
    this.updateDarkEmperor(dt);
    this.updateKokuraitei(dt); // R33 黒雷帝 ambient pack
    this.updateChargeAttack(dt);
    this.updateExoticHoldFireCharge(dt);
    this.updateShuraCharge(dt);
    this.updateBanjinKagemai(dt);
    this.updateGekkouMoon(dt);
    this.updateShuraKourin(dt);
    this.updateShinkirouKyozou(dt);
    this.updateRaiteiChargeStrikes();
    this.updateGeppaRaigou(dt);
    this.updateGokuraiZetsumetsu(dt);
    this.updateDarkSlashWaves(dt);
    this.updateShingetsu(dt);
    this.updateBots(dt);
    this.physics.step();
    this.syncCamera();
    this.handleRespawns();
    // ★1 影LOD(全モード): プレイヤー最近接8体のみcastShadow=true。
    // mapSize churnを避けるため0.25s周期トグル(旧: ゾンビモード限定運用を一般化)
    this.botShadowLodTimer -= dt;
    if (this.botShadowLodTimer <= 0) {
      this.updateBotShadowLOD();
      // R51-4e: 群衆ランクも同じ0.25s周期に相乗り(ゾンビモードのみ意味を持つ)
      if (this.config.mode === 'zombie') this.updateZombieHordeRank();
      this.botShadowLodTimer = 0.25;
    }
    if (this.config.mode === 'zombie') this.updateZombieDirector(dt);
    if (this.config.mode === 'training') this.updateTrainingTargets(dt);
    if (this.config.mode === 'zombie') {
      this.updateZombieShopProximity();
      this.updateZombieBoxAnim(dt);
      this.updateZombiePowerUps(dt);
      this.updateMiasmaClouds(dt);
    }

    // ファイナルキルカム: 3 tick ごと 20 Hz でキーフレームをリングバッファへ記録
    if (this.config.mode !== 'zombie') {
      this.killcam.tickRecord(this.elapsed);
    }

    // プレイヤー死亡の立ち下がりでメダル連続系をリセット(復讐対象=直近のkiller)
    if (this.lastAlive && !this.player.alive) {
      this.tracker.onPlayerDeath(this.killer?.uid ?? null);
      // クイックリバイブ: ゾンビモードでチャージがあれば即その場復活
      // (position はカプセル中心。respawnAt は足元座標を期待するため足元へ変換して
      // 「その場」復活させる=中心のまま渡すと約1m浮いた位置に湧いて落下する)
      if (this.config.mode === 'zombie' && this.zombieQuickReviveCharges > 0) {
        this.zombieQuickReviveCharges -= 1;
        this.zombieRevivePlayerInPlace('クイックリバイブ');
      } else if (this.config.mode === 'zombie' && this.zombieCharmReviveAvailable) {
        // R53-W2: revive charm(不屈の守り札) — quick-reviveが尽きている場合のみのフォールバック
        this.zombieCharmReviveAvailable = false;
        this.zombieRevivePlayerInPlace('守り札の加護で復活！');
      }
    }
    this.lastAlive = this.player.alive;

    if (this.mission) {
      // ミッションは目的達成/失敗で終了(先取スコアは無効)
      this.updateMission(dt);
      if (this.missionOutcome !== 'pending') this.over = true;
    } else if (this.config.mode === 'snd') {
      // R53-W2 M2b: S&Dはラウンド機(snd.ts)が時間と勝敗を管理(先取スコアは無効)
      this.updateSnd(dt);
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
    this.uiHeat = Math.min(1, heat); // R53-W3 M3: MK.III Adaptive HUDへ露出(snapshot.uiHeat)
    this.sounds.setCombatHeat(this.uiHeat);
    // R53-W3 M3: ゾンビ群InstancedMeshへ姿勢を反映(tick末尾=全bot更新後に1回)
    this.feedZombieCrowd();
    // 瀕死の聴覚こもり(差分ガードはSoundKit側。死亡中は解除して観戦を明瞭に)
    this.sounds.setHealthState(this.player.alive ? this.player.hp / this.player.maxHp : 1);
  }

  // 描画フレームごとの処理。視点操作はフレームレートに追従させる
  frame(dt: number, playing: boolean): void {
    // ④ ポーズ音対策: playing→paused 遷移で雷帝ハムを停止、paused→playing で復元
    if (this._prevFramePlaying && !playing) {
      // ゲームが一時停止: 雷帝ハムを消音
      if (this.raiteiMode || this.kokuraiteiMode) this.sounds.setLightningHum(false);
      // R33: 黒雷帝遠雷スケジューラをポーズ中は一時停止
      if (this.kokuraiteiMode) this.sounds.pauseKokuraiThunder();
    } else if (!this._prevFramePlaying && playing) {
      // ゲーム再開: 雷帝/黒雷帝中ならハムを再開
      if (this.raiteiMode || this.kokuraiteiMode) this.sounds.setLightningHum(true);
      // R33: 黒雷帝遠雷スケジューラをポーズ解除後に再開
      if (this.kokuraiteiMode) this.sounds.resumeKokuraiThunder();
    }
    this._prevFramePlaying = playing;

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
    if (!this.killcamCamActive && !this.rcxdActive && Math.abs(this.camera.fov - targetFov) > 0.01) {
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
      alive: this.player.alive && !this.rcxdActive, // V31: RC操縦ビューに銃が浮かないように
      scopeReveal01: scopeReveal,
      sprinting: this.player.sprinting && this.player.grounded,
      scopeWeapon: weapon.def.scope === true,
    });
    this.effects.update(vmDt);
    // 映画的アトモスフィア(草の風/環境パーティクル/グラウンドフォグ/グレインの時間前進)
    this.atmosphere?.update(vmDt, this.camera.position);
    // ジュース: 被弾フラッシュのエンベロープ→PostFX(被弾/低HP/キル時のみ有効化=idleコストゼロ)
    if (this.tookDamage) this.hitFlashEnv = 1;
    this.hitFlashEnv = Math.max(0, this.hitFlashEnv - dt * 3.5);
    // R20 rank4: キルサージ封筒の減衰(キル確定時に activate 側で1へ叩かれる)
    this.killSurgeEnv = Math.max(0, this.killSurgeEnv - dt * 3.2);
    // R20 rank4: このフレームの被弾角(incomingAngle群)の平均を画面空間の単位方向へ。赤パルスを
    // 被弾側へ寄せる。sin=右が正 / cos=正面が上(HUDと同じ極性)。パルス減衰中は最後の方向を保持
    if (this.incoming.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const a of this.incoming) {
        sx += Math.sin(a);
        sy += Math.cos(a);
      }
      this.hitDir.set(sx, sy);
      if (this.hitDir.lengthSq() > 1e-6) this.hitDir.normalize();
    }
    // 黒帝オーラ封筒: 黒帝発動中にフェードイン(2.5/s)、非発動時フェードアウト(2/s)
    if (this.darkEmperorTimer > 0) {
      this.darkAuraEnv = Math.min(1, this.darkAuraEnv + dt * 2.5);
    } else {
      this.darkAuraEnv = Math.max(0, this.darkAuraEnv - dt * 2.0);
    }
    // R30 制圧封筒: 近弾連続時に立ち上がり、フレームごとに減衰
    this.suppressEnv = Math.max(0, this.suppressEnv - dt * 3.0);
    if (this.postfx) {
      const rm = this.settings.reduceMotion;
      const pulse = rm ? 0 : this.hitFlashEnv * 0.75;
      const healthRatio = this.player.alive ? this.player.hp / this.player.maxHp : 1;
      // 低HP封筒(38%以下で立ち上がり0→1)。脱色は色変化のみ(省モーション非侵襲・持続で有効化)
      const lowHpEnv = this.player.alive
        ? Math.max(0, Math.min(1, (0.38 - healthRatio) / 0.38))
        : 0;
      const killSurge = rm ? 0 : this.killSurgeEnv;
      const suppress = rm ? 0 : this.suppressEnv;
      // R33 黒雷帝ビネット封筒: 発動スパイク(0.6s) → idle呼吸(0.07-0.10)
      let kokuraiVal = 0;
      if (this.kokuraiBlackInTimer > 0) {
        this.kokuraiBlackInTimer = Math.max(0, this.kokuraiBlackInTimer - dt);
        const spikeFrac = this.kokuraiBlackInTimer / 0.6;
        // reduceMotion時はスパイク半減。0.07(idle bed)へ向かって減衰
        kokuraiVal = 0.07 + spikeFrac * 0.78 * (rm ? 0.5 : 1.0);
      } else if (this.kokuraiteiMode) {
        // idle呼吸: 0.07-0.10。reduceMotion時は固定0.08
        kokuraiVal = 0.07 + (rm ? 0.01 : 0.03 * Math.abs(Math.sin(this.elapsed * 0.8)));
      }
      // idleゲート: grade>0(high tier)は常時enabled。それ以外は封筒ゼロ時コストゼロ
      this.postfx.enabled =
        this.postfxGrade > 0 || pulse > 0.002 || killSurge > 0.002 || lowHpEnv > 0.01
        || this.darkAuraEnv > 0.01 || suppress > 0.002 || kokuraiVal > 0.001;
      this.postfx.setHitPulse(pulse);
      this.postfx.setCombat(this.hitDir.x, this.hitDir.y, healthRatio, killSurge, rm ? 0 : 1);
      this.postfx.setTime(this.elapsed);
      this.postfx.setDarkAura(this.darkAuraEnv);
      this.postfx.setSuppress(suppress);
      this.postfx.setKokurai(kokuraiVal); // R33
    }
    // R30 雨パーティクル: 時間ユニフォームとカメラ位置を毎フレーム更新
    if (this.rainTimeUniform) this.rainTimeUniform.value = this.elapsed;
    if (this.rainPoints) {
      const mat = this.rainPoints.material as THREE.ShaderMaterial;
      (mat.uniforms['uCamPos']!.value as THREE.Vector3).copy(this.camera.position);
    }

    // ── AutoExposure: 全tier有効(コストゼロ・CPU only) ──
    // camera forward を取得し、indoor01(天井有無の指数平滑値)と合わせて更新する。
    this.camera.getWorldDirection(this._autoExpFwd);
    this.renderer.toneMappingExposure = this._autoExposure.update(dt, this._autoExpFwd, this._indoor01);

    // Indoor 検出: 0.25s ごとにプレイヤー頭上へ上向きレイ(world限定・~25m)を飛ばし
    // 天井の有無を検出する。指数平滑 tau≈3s で緩やかに推移させる。
    this._indoorCheckTimer -= dt;
    if (this._indoorCheckTimer <= 0) {
      this._indoorCheckTimer = 0.25;
      const eyePos = this.player.alive ? this.player.eyePosition : this.camera.position;
      const rawIndoor = this.castRay(
        eyePos,
        new THREE.Vector3(0, 1, 0),
        25,
        this.player.body,
        (col) => this.tags.get(col.handle)?.kind === 'world',
      ) ? 1 : 0;
      // alpha = 1 - exp(-dt_check / tau) = 1 - exp(-0.25 / 3)
      const indoorAlpha = 1 - Math.exp(-0.25 / 3);
      this._indoor01 += indoorAlpha * (rawIndoor - this._indoor01);
    }

    // ── R29: プレイヤー追従シャドウ(±70mの影ボックスがプレイヤーと共に動く) ──
    // 中心をシャドウテクセルの「光空間グリッド」へスナップしてエッジシマーをゼロ化。
    // ワールドXZではなく shadowRight/shadowUp(sunDirから算出した直交基底)の投影面でスナップする。
    if (this.sunLight) {
      const g = this.shadowTexelWorld;
      const p = this.player.position;
      // 光空間右/上軸へ投影 → グリッドスナップ → ワールド座標へ復元
      const rSnapped = Math.floor(p.dot(this.shadowRight) / g) * g;
      const uSnapped = Math.floor(p.dot(this.shadowUp) / g) * g;
      const snapX = rSnapped * this.shadowRight.x + uSnapped * this.shadowUp.x;
      const snapY = rSnapped * this.shadowRight.y + uSnapped * this.shadowUp.y;
      const snapZ = rSnapped * this.shadowRight.z + uSnapped * this.shadowUp.z;
      this.sunLight.position.set(
        snapX + this.sunDir.x * this.config.stage.size,
        snapY + this.sunDir.y * this.config.stage.size,
        snapZ + this.sunDir.z * this.config.stage.size,
      );
      this.sunLight.target.position.set(snapX, snapY, snapZ);
      this.sunLight.target.updateMatrixWorld();
    }

    // ── High tier 専用パス更新 ──
    if (this._godRaysPass !== null) {
      // GodRays: 太陽ワールド位置 = カメラ位置 + sunDir × (stage.size * 3)
      const stageSz = this.config.stage.size;
      this._sunWorld.copy(this.camera.position).addScaledVector(this.sunDir, stageSz * 3);
      this._godRaysPass.setSun(this._sunWorld, this.camera);
      this._godRaysPass.setIntensity(this._sunIntensity);
    }

    if (this._adsDofPass !== null) {
      const wp = this.activeWeapon;
      // スコープ武器(def.scope===true)は DOF 無効(全画面スコープ演出と干渉するため)
      const ads01 = wp.def.scope === true ? 0 : wp.adsProgress;
      // 焦点距離を 0.25s ごとに更新(照準中心レイ流用)
      this._dofFocusTimer -= dt;
      if (this._dofFocusTimer <= 0) {
        this._dofFocusTimer = 0.25;
        if (ads01 > 0.01 && this.player.alive) {
          const dofHit = this.castRay(
            this.player.eyePosition,
            this.cameraForward(),
            200,
            this.player.body,
          );
          this._dofFocusDist = dofHit ? Math.min(200, Math.max(0.5, hitToi(dofHit))) : 30;
        }
      }
      this._adsDofPass.update(ads01, this._dofFocusDist, dt);
    }

    // ── ウォッチドッグ: high tier のみ、実描画フレームEMA > 22ms(≒45fps)が
    // 2.5s 続いたら段階的降格(DOF→GodRays→AO-Low の 3 段)。
    // main.ts の adaptResolution(DPR 削減)と独立して動作する。
    // N8AOPass は "シーンを描く唯一のパス" なので絶対に無効化しない。
    if (this._wdStep < 3 && (this._n8aoPass !== null || this._godRaysPass !== null)) {
      this._wdEma += (dt - this._wdEma) * 0.06; // ~0.5s平滑(main.ts adaptResolution と同方式)
      if (this._wdEma > 0.022) {
        this._wdOverAccum += dt;
      } else {
        this._wdOverAccum = 0; // 閾値を下回ったらリセット(連続超過のみ発火)
      }
      if (this._wdOverAccum > 2.5 && this.elapsed > this._wdNextStepAt) {
        this._wdStep++;
        this._wdNextStepAt = this.elapsed + 2.0; // 次の降格は 2 秒後以降
        this._wdOverAccum = 0;
        const emaMs = (this._wdEma * 1000).toFixed(1);
        switch (this._wdStep) {
          case 1:
            // forceDisable で以後の update() 内 enabled 上書きを封じる
            if (this._adsDofPass) this._adsDofPass.forceDisable();
            console.info(`[watchdog] step1: AdsDofPass disabled (EMA ${emaMs}ms)`);
            break;
          case 2:
            if (this._godRaysPass) this._godRaysPass.enabled = false;
            console.info(`[watchdog] step2: GodRaysPass disabled (EMA ${emaMs}ms)`);
            break;
          case 3:
            this._n8aoPass?.setQualityMode('Low');
            console.info(`[watchdog] step3: N8AO → Low quality (EMA ${emaMs}ms)`);
            break;
          default:
            break;
        }
      }
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
    // 壁抜け防止: killer頭→カメラ目標へレイ、world/boundary遮蔽なら手前へ寄せる
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
        if (t === undefined || t.kind === 'world' || t.kind === 'boundary') {
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
    // RC-XD操縦中: 車体の斜め後上方からローアングルで前方を向くドライバーズビュー
    if (this.rcxdActive) {
      const fwdDir = new THREE.Vector3(-Math.sin(this.rcxdYaw), 0, -Math.cos(this.rcxdYaw));
      // カメラ位置: RC後方1.2m + 上方0.55m
      const behind = fwdDir.clone().multiplyScalar(-1.2);
      this.camera.position.copy(this.rcxdPos).add(new THREE.Vector3(0, 0.55, 0)).add(behind);
      // 注視点: RC前方2mの接地高さ付近
      const lookAt = this.rcxdPos.clone().addScaledVector(fwdDir, 2).add(new THREE.Vector3(0, 0.12, 0));
      this.camera.lookAt(lookAt);
      if (Math.abs(this.camera.fov - 80) > 0.01) {
        this.camera.fov = 80;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
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

  // V31: ケアパッケージ至近ではEを開封専用にする(リーン右との物理キー衝突回避)
  private nearCarePackage(): boolean {
    if (this.carePackageCrates.length === 0) return false;
    const p = this.player.position;
    for (const crate of this.carePackageCrates) {
      if (!crate.landed) continue;
      if (Math.hypot(crate.pos.x - p.x, crate.pos.z - p.z) < 3.0) return true;
    }
    return false;
  }

  private handleWeaponSwitch(): void {
    if (this.cooking) return;
    if (this.rcxdActive) return; // V31: RC操縦中は本体を凍結
    // ガンゲーム: セカンダリへの切り替えを禁止(ラダー武器のみ)
    if (this.config.mode === 'gungame') {
      this.input.consumeWheel();
      return;
    }
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
      // F1: 弓チャージを切替時にリセット
      this.bowCharging = false;
      this.bowChargeTimer = 0;
      this.viewModel.setBowCharge(0);
    }
  }

  private handleMelee(): void {
    if (!this.input.wasPressed('melee') || this.meleeCooldown > 0 || !this.player.alive) return;
    if (this.rcxdActive) return; // V31: RC操縦中は本体を凍結
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
    // ガンゲーム: グレネード無効(純粋な銃勝負)
    if (this.config.mode === 'gungame') return;
    // V31修正: RC-XD操縦中は投擲を封じる(軌道がRCカメラ方向へ乖離するため)
    if (this.rcxdActive) return;
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
      // F5: training モードはプレイヤー被弾だけをスキップ(関数 return しないことでプロップ破壊ループを継続)
      if (damage > 0 && this.explosionReaches(point, this.player.position) && this.config.mode !== 'training') {
        const died = this.player.takeDamage(damage);
        // 至近爆発は耳鳴り(世界の音が一瞬遠のく)
        if (dist < 6) this.sounds.tinnitus((6 - dist) / 6);
        this.tookDamage = true;
        this.haptic(110, 0.5, 0.55);
        this.addShake(Math.min(0.7, damage * 0.01));
        this.addUltCharge(damage * ULT_ON_DAMAGE_PER_HP);
        this.incoming.push(this.incomingAngle(point));
        this.sounds.hurt();
        this.tracker.onPlayerDamaged();
        this.sounds.playerBodyHit(Math.sin(this.incomingAngle(point)), Math.min(1, damage / 100));
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

    // 破壊可能プロップへの爆発ダメージ: 100%適用(距離減衰あり・LOS不問)
    for (const [handle, prop] of this.breakableProps) {
      const dist = prop.pos.distanceTo(point);
      if (dist > spec.radius) continue;
      const dmg = explosionDamage(spec, dist);
      if (dmg > 0) this.applyPropDamage(handle, dmg);
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

  // ── 破壊可能プロップ: ダメージ適用 + HP50%以下でヒビ色 ──────────────────────
  // rawDamage: 武器ダメージの50% or 爆発ダメージ100%。呼び出し側で係数適用済みで渡す。
  private applyPropDamage(handle: number, rawDamage: number): void {
    const prop = this.breakableProps.get(handle);
    if (!prop) return;
    prop.hp -= rawDamage;

    // HP50%以下でヒビ色(個別マテリアルなので他のプロップに影響しない)
    if (prop.hp > 0 && prop.hp <= prop.maxHp * 0.5) {
      const mat = prop.mesh.material as THREE.MeshStandardMaterial;
      if (!mat.userData.cracked) {
        mat.userData.cracked = true;
        // 暗く色ずれした「ひび割れ」色: 元色を45%まで暗化し暖色ダーティネスを加える
        const c = new THREE.Color(prop.colorHex);
        c.multiplyScalar(0.45);
        mat.color = c;
        mat.needsUpdate = true;
      }
    }

    if (prop.hp <= 0) this.destroyProp(prop);
  }

  // ── 破壊可能プロップ: 破壊処理(演出+物理+メッシュ消去) ──────────────────────
  private destroyProp(prop: BreakableProp): void {
    const { pan, distance } = this.panAndDistance(prop.pos);

    // (a) 破片化演出: 6〜10 個の小箱片 + 小爆発(土煙)
    this.effects.debrisBurst(prop.pos, prop.colorHex, prop.w, prop.h, prop.d);
    this.effects.explosion(prop.pos, Math.max(prop.w, prop.d) * 0.15);
    // (b) 破壊音(既存 impactSurface 流用)
    this.sounds.impactSurface('wall', pan, distance);

    // (c) メッシュ除去(ジオメトリは unitBox 共有なので dispose しない、マテリアルのみ)
    this.scene.remove(prop.mesh);
    (prop.mesh.material as THREE.Material).dispose();

    // (d) コライダー/剛体除去: removeRigidBody が付属コライダーも一括解放
    this.tags.delete(prop.collider.handle);
    this.physics.removeRigidBody(prop.body);

    // (e) 追跡セット更新
    this.destroyedPropHandles.add(prop.collider.handle);
    this.breakableProps.delete(prop.collider.handle);

    // (f) ミニマップデータから削除(minimapBoxes()を通じてHUDが次回 setupMinimap で反映)
    const idx = this.minimapBoxData.findIndex((b) => b.handle === prop.collider.handle);
    if (idx >= 0) this.minimapBoxData.splice(idx, 1);
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
        if (this.player.alive && this.insidePatch(patch, this.player.position) && this.config.mode !== 'training') {
          const died = this.player.takeDamage(tickDamage);
          this.tookDamage = true;
          this.haptic(70, 0.35, 0.3); // 燃焼ダメージは弱く連続的に
          this.addShake(0.06);
          this.addUltCharge(tickDamage * ULT_ON_DAMAGE_PER_HP);
          this.incoming.push(this.incomingAngle(patch.pos));
          this.sounds.hurt();
          this.tracker.onPlayerDamaged();
          this.sounds.playerBodyHit(Math.sin(this.incomingAngle(patch.pos)), Math.min(1, tickDamage / 100));
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

  // ── ロケット弾体(業火RL) ──

  private fireRocket(): void {
    if (!this.player.alive) return;
    if (this.rockets.length >= 6) return; // 同時上限6
    this.haptic(120, 0.4, 0.8);

    // 発射基点: 視線基点から前方オフセット
    const fwd = this.cameraForward();
    const origin = this.player.eyePosition.clone().add(fwd.clone().multiplyScalar(0.5));
    const vel = fwd.clone().multiplyScalar(55); // 55 m/s 直進

    // 弾頭メッシュ(縦長シリンダーを進行方向に沿わせる)
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    mesh.position.copy(origin);
    // シリンダーはデフォルト Y 軸。進行方向(vel)へ向ける
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vel.clone().normalize());
    this.scene.add(mesh);

    // 煙トレイル(弾頭後端にアタッチ)
    const trailMesh = new THREE.Mesh(this.rocketTrailGeo, this.rocketTrailMat);
    // トレイルは弾頭の後ろ(-Y 方向に 0.3 )
    trailMesh.position.set(0, -0.3, 0);
    mesh.add(trailMesh);

    this.rockets.push({ mesh, trailMesh, pos: origin, vel, timer: 0 });
  }

  private updateRockets(dt: number): void {
    const ROCKET_SPEC = { radius: 15, maxDamage: 220, name: '業火RL' } as const;
    const SELF_FACTOR = 0.35;
    const SELF_RADIUS = 10; // 自爆半径(爆発半径15mより小さく=自殺リスク軽減)
    const MAX_LIFE = 8; // 8秒で自爆
    const kept: typeof this.rockets = [];

    for (const r of this.rockets) {
      r.timer += dt;
      // 直進移動(重力なし)
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);

      // 世界/ボットへの衝突チェック(小さなスフィアキャスト近似: 前方短レイ)
      const dir = r.vel.clone().normalize();
      const step = r.vel.length() * dt * 1.05;
      const worldHit = this.castRay(r.pos, dir, step, null);
      const worldTag = worldHit ? this.tags.get(worldHit.collider.handle) : undefined;

      let detonated = false;

      if (worldTag?.kind === 'world' || (worldHit && worldTag?.kind !== 'bot')) {
        // 壁/地面に当たった
        detonated = true;
      }

      if (!detonated) {
        // ボットへの接触チェック
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          if (r.pos.distanceTo(bot.position) < 0.7) {
            detonated = true;
            break;
          }
        }
      }

      if (!detonated && r.timer >= MAX_LIFE) detonated = true;

      if (!detonated) {
        kept.push(r);
        continue;
      }

      // ── 起爆処理 ──
      const point = r.pos.clone();
      const { pan, distance } = this.panAndDistance(point);
      this.effects.rocketBlast(point, ROCKET_SPEC.radius);
      this.sounds.explosion(pan, distance);
      if (distance < 25) this.sounds.rocketSubBoom(pan, distance);

      // ボットへの爆発ダメージ
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        const center = bot.position;
        const dist = Math.min(center.distanceTo(point), bot.headPosition().distanceTo(point));
        if (dist > ROCKET_SPEC.radius) continue;
        const dmg = ROCKET_SPEC.maxDamage * Math.max(0, 1 - dist / ROCKET_SPEC.radius);
        if (dmg <= 0 || !this.explosionReaches(point, center)) continue;
        this.applyBotDamage(bot, dmg, center, false, ROCKET_SPEC.name);
      }

      // 自爆ダメージ(0.35倍で自殺しにくく)
      if (this.player.alive) {
        const selfDist = this.player.position.distanceTo(point);
        // 近接爆風シェイク(ダメージ判定不問・距離比例)
        const blastShake = Math.max(0, 1 - selfDist / ROCKET_SPEC.radius) * 0.55;
        if (blastShake > 0.01) this.addShake(blastShake);
        if (selfDist < SELF_RADIUS && this.explosionReaches(point, this.player.position)) {
          const rawDmg = ROCKET_SPEC.maxDamage * Math.max(0, 1 - selfDist / SELF_RADIUS);
          const selfDmg = rawDmg * SELF_FACTOR;
          if (selfDmg > 0 && this.config.mode !== 'training') {
            const died = this.player.takeDamage(selfDmg);
            if (selfDist < 4) this.sounds.tinnitus((4 - selfDist) / 4);
            this.tookDamage = true;
            this.haptic(120, 0.6, 0.7);
            this.addShake(Math.min(0.7, selfDmg * 0.012));
            this.addUltCharge(selfDmg * ULT_ON_DAMAGE_PER_HP);
            this.incoming.push(this.incomingAngle(point));
            this.sounds.hurt();
            this.tracker.onPlayerDamaged();
            this.sounds.playerBodyHit(Math.sin(this.incomingAngle(point)), Math.min(1, selfDmg / 100));
            if (died) {
              this.feed.push({
                killer: PLAYER_NAME,
                victim: PLAYER_NAME,
                weapon: ROCKET_SPEC.name,
                headshot: false,
              });
              this.sounds.death();
              this.notePlayerDeath();
            }
          }
        }
      }

      // ロケット爆発による破壊可能プロップへのダメージ(100%適用・距離減衰あり)
      for (const [handle, prop] of this.breakableProps) {
        const dist = prop.pos.distanceTo(point);
        if (dist > ROCKET_SPEC.radius) continue;
        const dmg = ROCKET_SPEC.maxDamage * Math.max(0, 1 - dist / ROCKET_SPEC.radius);
        if (dmg > 0) this.applyPropDamage(handle, dmg);
      }

      // メッシュ後始末
      this.scene.remove(r.mesh);
    }
    this.rockets = kept;
  }

  private clearRockets(): void {
    for (const r of this.rockets) {
      this.scene.remove(r.mesh);
    }
    this.rockets = [];
  }

  // ── R33 特殊武器メソッド ──────────────────────────────────────────────────

  private fireBowArrow(chargeS: number): void {
    if (!this.player.alive) return;
    if (this.bowProjectiles.length >= 8) return;
    const fwd = this.cameraForward();
    const origin = this.player.eyePosition.clone().addScaledVector(fwd, 0.4);
    const vel = fwd.clone().multiplyScalar(100); // 強化: 矢速80→100m/s(偏差撃ちの負担軽減)
    const mesh = new THREE.Mesh(this.bowArrowGeo, this.bowArrowMat.clone());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd.clone().normalize());
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const trailGroup = new THREE.Group();
    this.scene.add(trailGroup);
    const damageMultiplier = bowChargeMultiplier(chargeS);
    const damage = this.activeWeapon.def.damage * damageMultiplier;
    this.bowProjectiles.push({ mesh, trailGroup, pos: origin.clone(), vel, damage, timer: 0 });
    this.effects.bowArrowFire(origin, fwd, chargeS / 1.2);
    this.addShake(0.06 * (0.5 + chargeS / 1.2 * 0.5));
    this.player.shotsFired += 1;
  }

  private updateBowProjectiles(dt: number): void {
    const GRAVITY = 3.5;
    const MAX_LIFE = 6;
    const kept: typeof this.bowProjectiles = [];
    for (const p of this.bowProjectiles) {
      p.timer += dt;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.vel.length() > 0.001) {
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.vel.clone().normalize());
      }
      // 衝突チェック
      const dir = p.vel.clone().normalize();
      const step = p.vel.length() * dt * 1.05;
      const hit = this.castRay(p.pos, dir, step, null);
      const tag = hit ? this.tags.get(hit.collider.handle) : undefined;
      // F4: world着弾でbowImpact(到達不能ブロックを削除して直書き)
      // F2: ray直撃botを優先起爆、中心距離判定はフォールバック
      let detonated = false;
      if (tag?.kind === 'world') {
        const end = hit ? p.pos.clone().addScaledVector(dir, hit.toi ?? 0) : p.pos.clone();
        this.effects.bowImpact(end);
        detonated = true;
      } else if (tag?.kind === 'bot' && tag.bot.alive && tag.bot.team !== PLAYER_TEAM) {
        const hitPoint = hit ? p.pos.clone().addScaledVector(dir, hit.toi ?? 0) : p.pos.clone();
        const part = partFromHitHeight(hitPoint.y - tag.bot.position.y, HIP_OFFSET_Y);
        const dmg = p.damage * partMultiplier(part, this.activeWeapon.def.headshotMultiplier);
        this.applyBotDamage(tag.bot, dmg, hitPoint, part === 'head', this.activeWeapon.def.name, true, false, this.activeWeapon.def.class);
        this.effects.bowImpact(hitPoint);
        if (part === 'head') this.sounds.headshot();
        detonated = true;
      }
      if (!detonated) {
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          if (p.pos.distanceTo(bot.position) < 0.55) {
            const part = partFromHitHeight(p.pos.y - bot.position.y, HIP_OFFSET_Y);
            const dmg = p.damage * partMultiplier(part, this.activeWeapon.def.headshotMultiplier);
            this.applyBotDamage(bot, dmg, p.pos.clone(), part === 'head', this.activeWeapon.def.name, true, false, this.activeWeapon.def.class);
            this.effects.bowImpact(p.pos.clone());
            if (part === 'head') this.sounds.headshot();
            detonated = true;
            break;
          }
        }
      }
      if (!detonated && p.timer >= MAX_LIFE) detonated = true;
      if (detonated) {
        this.scene.remove(p.mesh);
        for (const child of p.trailGroup.children) {
          (child as THREE.Line).geometry.dispose();
          ((child as THREE.Line).material as THREE.Material).dispose();
        }
        this.scene.remove(p.trailGroup);
        (p.mesh.material as THREE.Material).dispose();
      } else {
        kept.push(p);
      }
    }
    this.bowProjectiles = kept;
  }

  private clearBowProjectiles(): void {
    for (const p of this.bowProjectiles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      for (const child of p.trailGroup.children) {
        (child as THREE.Line).geometry?.dispose();
        ((child as THREE.Line).material as THREE.Material)?.dispose();
      }
      this.scene.remove(p.trailGroup);
    }
    this.bowProjectiles = [];
  }

  private fireFanShot(spreadRad: number): void {
    if (!this.player.alive) return;
    const weapon = this.activeWeapon;
    const origin = this.player.eyePosition;
    const scopedShot = weapon.adsProgress > 0.85;
    const muzzle = scopedShot
      ? origin.clone().addScaledVector(this.cameraForward(), 0.4)
      : this.viewModel.muzzleWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const base = this.cameraForward();
    const HALF_SPAN_RAD = weapon.def.pelletSpreadDeg * DEG; // F6: def駆動(鉄扇=24°)へ。ハードコード撤去
    const results = new Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>();
    for (let i = 0; i < weapon.def.pellets; i += 1) {
      const yawOff = fanPelletYaw(i, weapon.def.pellets, HALF_SPAN_RAD) + (Math.random() - 0.5) * spreadRad * 0.3;
      const dir = base.clone().addScaledVector(right, Math.tan(yawOff)).normalize();
      this.tracePellet(origin, dir, muzzle, results);
    }
    this.effects.fanWind(muzzle, base.clone(), weapon.adsProgress);
    this.player.shotsFired += 1;
    let kills = 0;
    for (const [bot, result] of results) {
      this.player.shotsHit += 1;
      if (result.headshot) this.player.headshots += 1;
      if (this.applyBotDamage(bot, result.damage, result.point, result.headshot, weapon.def.name, true, false, weapon.def.class)) kills += 1;
    }
    if (kills >= 2) {
      const out: MedalEvent[] = [];
      this.tracker.onCollateral(kills, out);
      this.emitMedals(out);
    }
  }

  private fireStaffBolt(): void {
    if (!this.player.alive) return;
    if (this.staffProjectiles.length >= 5) return;
    const fwd = this.cameraForward();
    const origin = this.player.eyePosition.clone().addScaledVector(fwd, 0.5);
    const vel = fwd.clone().multiplyScalar(70); // 強化: 雷球40→70m/s(中距離の実用化)
    const mesh = new THREE.Mesh(this.staffBoltGeo, this.staffBoltMat.clone());
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const sparkGroup = new THREE.Group();
    this.scene.add(sparkGroup);
    const weapon = this.activeWeapon;
    const charged = this.staffChargeTimer >= 0.8;
    const aoeRadius = 3 * (charged ? 2.5 : 1); // 強化: 完全チャージ倍率1.5→2.5(=半径7.5m)
    // R33: 完全チャージ弾はAoE300(基礎160)
    const boltDamage = charged ? 300 : weapon.def.damage;
    this.staffProjectiles.push({ mesh, sparkGroup, pos: origin.clone(), vel, damage: boltDamage, aoeRadius, timer: 0 });
    this.player.shotsFired += 1;
  }

  private updateStaffProjectiles(dt: number): void {
    const MAX_LIFE = 8;
    const kept: typeof this.staffProjectiles = [];
    for (const p of this.staffProjectiles) {
      p.timer += dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.scale.setScalar(1 + 0.08 * Math.sin(p.timer * 22));
      const dir = p.vel.clone().normalize();
      const step = p.vel.length() * dt * 1.05;
      const hit = this.castRay(p.pos, dir, step, null);
      const tag = hit ? this.tags.get(hit.collider.handle) : undefined;
      // F2: ray直撃botを優先起爆(巨躯への点距離スカり防止)、中心距離はフォールバック
      let exploded = tag?.kind === 'world';
      if (!exploded && tag?.kind === 'bot' && tag.bot.alive && tag.bot.team !== PLAYER_TEAM) {
        exploded = true;
      }
      if (!exploded) {
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          if (p.pos.distanceTo(bot.position) < 0.7) { exploded = true; break; }
        }
      }
      if (!exploded && p.timer >= MAX_LIFE) exploded = true;
      if (exploded) {
        const point = p.pos.clone();
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          const dist = bot.position.distanceTo(point);
          if (dist > p.aoeRadius) continue;
          const dmg = p.damage * Math.max(0, 1 - dist / p.aoeRadius);
          if (dmg > 0) {
            this.applyBotDamage(bot, dmg, bot.position.clone(), false, this.activeWeapon.def.name, true, false, this.activeWeapon.def.class);
            this.botStunUntil.set(bot, this.elapsed + 0.5);
          }
        }
        this.effects.staffAoe(point, p.aoeRadius);
        const { pan, distance } = this.panAndDistance(point);
        this.sounds.staffImpact();
        if (distance < 25) this.sounds.explosion(pan, distance);
        this.addShake(0.12 * (1 - Math.min(1, distance / 20)));
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.scene.remove(p.sparkGroup);
      } else {
        kept.push(p);
      }
    }
    this.staffProjectiles = kept;
  }

  private clearStaffProjectiles(): void {
    for (const p of this.staffProjectiles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      this.scene.remove(p.sparkGroup);
    }
    this.staffProjectiles = [];
  }

  private fireBeam(spreadRad: number): void {
    if (!this.player.alive) return;
    const weapon = this.activeWeapon;
    const origin = this.player.eyePosition;
    const scopedShot = weapon.def.scope === true && weapon.adsProgress > 0.85;
    const muzzle = scopedShot
      ? origin.clone().addScaledVector(this.cameraForward(), 0.4)
      : this.viewModel.muzzleWorldPosition(new THREE.Vector3());
    const base = this.cameraForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const { yaw: yOff, pitch: pOff } = coneOffset(spreadRad, Math.random);
    const dir = base.clone()
      .addScaledVector(right, Math.tan(yOff))
      .addScaledVector(up, Math.tan(pOff))
      .normalize();
    const results = new Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>();
    for (let tick = 0; tick < 3; tick += 1) {
      this.tracePellet(origin, dir, muzzle, results);
    }
    // ビームライン描画(penetration先も含め遠くまで)
    const reach = weapon.def.range;
    const hitResult = this.castRay(origin, dir, reach, this.player.body);
    const hitPoint = hitResult
      ? origin.clone().addScaledVector(dir, hitResult.toi ?? reach)
      : origin.clone().addScaledVector(dir, reach);
    this.effects.beamLine(muzzle, hitPoint);
    this.player.shotsFired += 1;
    let kills = 0;
    for (const [bot, result] of results) {
      this.player.shotsHit += 1;
      if (result.headshot) this.player.headshots += 1;
      if (this.applyBotDamage(bot, result.damage, result.point, result.headshot, weapon.def.name, true, scopedShot, weapon.def.class)) kills += 1;
    }
    if (kills >= 2) {
      const out: MedalEvent[] = [];
      this.tracker.onCollateral(kills, out);
      this.emitMedals(out);
    }
  }

  private fireShurikenDisc(hitPoint: THREE.Vector3 | null = null): void {
    if (this.shurikenDiscs.length >= 12) {
      const old = this.shurikenDiscs.shift();
      if (old) this.scene.remove(old.group);
    }
    const fwd = this.cameraForward();
    const pos = this.player.eyePosition.clone().addScaledVector(fwd, 0.3);
    const vel = fwd.clone().multiplyScalar(SHURIKEN_DISC_SPEED);
    const group = this.effects.shurikenDiscFly(pos, fwd);
    // F8: fireShot(hitscan)の着弾点があれば飛行時間=距離/速度でクランプ(無ければ従来0.5s)
    const life = shurikenDiscLife(hitPoint ? hitPoint.distanceTo(pos) : null, SHURIKEN_DISC_SPEED);
    this.shurikenDiscs.push({ group, pos: pos.clone(), vel, timer: 0, life });
  }

  private updateShurikenDiscs(dt: number): void {
    const kept: typeof this.shurikenDiscs = [];
    for (const d of this.shurikenDiscs) {
      d.timer += dt;
      d.pos.addScaledVector(d.vel, dt);
      d.group.position.copy(d.pos);
      d.group.rotation.z += dt * 28;
      if (d.timer < d.life) {
        kept.push(d);
      } else {
        // F3: geometry/material dispose(disposeObject流儀)
        for (const child of d.group.children) {
          (child as THREE.Line).geometry?.dispose();
          ((child as THREE.Line).material as THREE.Material)?.dispose();
        }
        this.scene.remove(d.group);
      }
    }
    this.shurikenDiscs = kept;
  }

  private clearShurikenDiscs(): void {
    for (const d of this.shurikenDiscs) {
      for (const child of d.group.children) {
        (child as THREE.Line).geometry?.dispose();
        ((child as THREE.Line).material as THREE.Material)?.dispose();
      }
      this.scene.remove(d.group);
    }
    this.shurikenDiscs = [];
  }

  // F8: 最至近のbot着弾点を返す(手裏剣discの飛行打ち切りに使う。非ヒットはnull)
  private fireShot(spreadRad: number): THREE.Vector3 | null {
    if (!this.player.alive) return null;
    this.player.shotsFired += 1;
    if (this.trainingStats) this.trainingStats.shotsFired += 1;
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
    const trainingResults = this.config.mode === 'training'
      ? new Map<TrainingTarget, { damage: number; headshot: boolean; point: THREE.Vector3 }>()
      : undefined;

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

    // ── スナイパースナップアシスト ──
    // scope武器のADS完全時(adsProgress>0.85)に ~1.2° 円錐内の可視ターゲットを胸へスナップ。
    // 「絶対当たる」: 手動照準が円錐内なら必ず胴体に当たる。ヘッド誘導なし=公平感(胴スナップ)。
    // BO2アシスト/バレットマグネティズムとは独立した追加層。距離999m有効。
    // botには影響なし: fireShot はプレイヤー専用。gungame/training でも同条件。
    // V32修正: エイムアシスト設定を尊重(マグネティズムと同じトグル規約)
    if (scopedShot && this.settings.aimAssist) {
      const snapCand = this.aimAssistTarget(weapon.def.range);
      // A2-3: 200m超では実効コーンを 4m横断相当の角度に上限。遠距離スナップを適切に絞る
      const effSnapConeRad = snapCand
        ? Math.min(SNIPER_SNAP_CONE_DEG * DEG, Math.atan(4 / snapCand.dist))
        : SNIPER_SNAP_CONE_DEG * DEG;
      if (snapCand && snapCand.angle <= effSnapConeRad) {
        const bp = snapCand.bot.position;
        const chest = new THREE.Vector3(bp.x, bp.y + 0.15, bp.z);
        // V32修正: 胸点が遮蔽されている(頭出しだけの敵)なら可視エイム点へフォールバック
        // (胸へ曲げて壁に吸われる=「絶対当たる」の逆効果を防ぐ)
        const chestBlocked = this.castRay(
          origin,
          chest.clone().sub(origin).normalize(),
          origin.distanceTo(chest) - 0.4,
          this.player.body,
          (c) => {
            const k = this.tags.get(c.handle)?.kind;
            return k === 'world' || k === 'boundary';
          },
        );
        if (chestBlocked) {
          base = snapCand.dir.clone().normalize(); // 可視部位(頭出し等)へのスナップ
        } else {
          const snapVec = chest.clone().sub(origin);
          const snapLen = snapVec.length();
          if (snapLen > 1e-4) base = snapVec.multiplyScalar(1 / snapLen);
        }
      }
    }

    for (let i = 0; i < weapon.def.pellets; i += 1) {
      const offset = coneOffset(spreadRad + pelletSpreadRad, Math.random);
      const dir = base
        .clone()
        .addScaledVector(right, Math.tan(offset.yaw))
        .addScaledVector(up, Math.tan(offset.pitch))
        .normalize();
      this.tracePellet(origin, dir, muzzle, results, trainingResults);
    }

    // 訓練場: 的へのヒットを集計
    if (trainingResults && this.trainingStats) {
      for (const [target, result] of trainingResults) {
        this.player.shotsHit += 1;
        this.trainingStats.shotsHit += 1;
        this.trainingStats.consecutiveHits += 1;
        if (result.headshot) {
          this.player.headshots += 1;
          this.trainingStats.headshots += 1;
        }
        this.trainingStats.addDamage(this.elapsed, result.damage);
        this.applyTrainingTargetDamage(target, result.damage, result.headshot, result.point);
      }
      if (results.size === 0 && trainingResults.size === 0) {
        this.trainingStats.addMiss();
      }
    }

    let kills = 0;
    // F8: 最至近のbot着弾点(手裏剣discのスナップ先)
    let nearestHit: THREE.Vector3 | null = null;
    let nearestHitD2 = Infinity;
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
      const hd2 = result.point.distanceToSquared(origin);
      if (hd2 < nearestHitD2) {
        nearestHitD2 = hd2;
        nearestHit = result.point;
      }
      // F7: 手裏剣命中スパーク音+着弾エフェクト
      if (weapon.def.special === 'shuriken') {
        this.sounds.shurikenHit();
        this.effects.shurikenImpact(result.point);
      }
    }
    // 1トリガーで2体以上 = コラテラル(ショットガンのペレット拡散でのみ成立)
    if (kills >= 2) {
      const out: MedalEvent[] = [];
      this.tracker.onCollateral(kills, out);
      this.emitMedals(out);
    }
    return nearestHit;
  }

  // 1本の弾道を追う。世界ジオメトリに当たった場合は貫通力の範囲で1枚だけ抜ける
  private tracePellet(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    muzzle: THREE.Vector3,
    results: Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>,
    trainingResults?: Map<TrainingTarget, { damage: number; headshot: boolean; point: THREE.Vector3 }>,
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
      this.killcam.recordShot(tracerFrom, end, weapon.def.tracerColor, this.elapsed);
      if (!hit) return;

      const tag = this.tags.get(hit.collider.handle);
      // boundary(ghost壁)は素通り: 着弾エフェクト/衝撃音なしで弾道終端(開放境界演出)
      if (tag?.kind === 'boundary') return;
      if (tag?.kind === 'trainingTarget' && !tag.target.isDown && trainingResults) {
        const distance = traveled + hitToi(hit);
        const base = damageAtDistance(weapon.def.damage, distance, weapon.def.falloff);
        const damage = base * (tag.part === 'head' ? (weapon.def.headshotMultiplier ?? 2) : 1);
        const entry = trainingResults.get(tag.target) ?? { damage: 0, headshot: false, point: end };
        entry.damage += damage;
        entry.headshot = entry.headshot || tag.part === 'head';
        entry.point = end;
        trainingResults.set(tag.target, entry);
        return;
      }
      if (tag?.kind === 'bot' && tag.bot.alive) {
        // 味方への誤射はダメージなしで弾が止まる
        if (tag.bot.team === PLAYER_TEAM) return;
        const distance = traveled + hitToi(hit);
        let part: HitPart = tag.part;
        // 高さによる部位再分類は人型のみ。戦車/ドローン等は車体下部が「脚」扱いで
        // 減衰しないようbody満額を維持する(弱点=headコライダーは別枠で成立)
        if (part === 'body' && (tag.bot.kind === 'humanoid' || tag.bot.kind === 'master' || tag.bot.kind === 'giant')) {
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

      // 破壊可能プロップへのダメージ: 武器ダメージの50%を適用
      this.applyPropDamage(hit.collider.handle, weapon.def.damage * 0.5);

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
    let finalDamage = damage;
    if (this.exoticDamageBoost > 1 && srcClass !== null) {
      finalDamage *= this.exoticDamageBoost;
    }
    // painDir: humanoidが被弾方向へ振り向く材料(bot→射手=プレイヤー)。tank/turret/droneは
    // 全周維持なので影響なし、方向不明経路も takeDamage 側で全周フォールバック
    const toShooter = this.player.eyePosition.clone().sub(bot.position);
    // R53-W2: ゾンビ経済のダメージ修飾は一箇所に集約(旧zombiePerkDamageMulは
    // compose一本化で撤去。double-tap/PaPのダメージ倍率は武器def.damage自体に
    // 焼き込み済みなのでここでは触れない=二重計上を避ける)
    if (bot.kind === 'zombie') {
      if (bot.tier === 'boss' && this.zombieCharmEffect?.bossDamageMultiplier) {
        finalDamage *= this.zombieCharmEffect.bossDamageMultiplier;
      }
      if (bot.zombieVariant === 'shell' && !headshot && bot.facingDot(toShooter) > 0.3) {
        finalDamage *= 1 - SHELL_FRONT_REDUCTION;
        this.sounds.shellHit();
      }
      // ★V-A MEDIUM修正: インスタキルはボス非適用(instaKillApplies参照。nukeと対称)
      if (instaKillApplies(this.zombieInstaKillTimer, bot.tier)) {
        finalDamage = Math.max(finalDamage, bot.hp + 1);
      }
    }
    const died = bot.takeDamage(finalDamage, toShooter);
    // ゾンビ経済: 命中+10 / キル+60 / HSキル+110 / 近接キル+130 / ボスキル+500ボーナス
    if (bot.kind === 'zombie') {
      if (died) {
        this.zombieKills += 1;
        // ★V一括修正: charm解放条件(bossdmg=ボス10体)の入力。summary.zombieBossKillsへ供給
        if (bot.tier === 'boss') this.zombieBossKillCount += 1;
        const isMelee = ['近接', 'ブリンク斬撃', 'ダイブスラム', '黒帝斬撃', '雷帝斬撃'].includes(weaponName);
        let gain = isMelee ? POINTS.melee : headshot ? POINTS.hskill : POINTS.kill;
        if (bot.tier === 'boss') gain += 500;
        this.addZombiePoints(gain);
        this.zombiePointFloats.push({ amount: gain, world: point.clone() });
        // ボス撃破: 大演出
        if (bot.tier === 'boss') {
          const bossPos = bot.position.clone();
          bossPos.y += 0.5;
          this.effects.deathBurst(bossPos, 0xff2200);
          this.effects.deathBurst(bossPos, 0xff6600);
          const groundPos = bot.position.clone();
          this.effects.shockwaveRing(groundPos, 6.0, 0xff2200);
          this.effects.explosion(bossPos, 2.5);
          this.addShake(0.8);
          this.announcements.push('巨躯を撃破！');
          if (this.zombieBossBot === bot) this.zombieBossBot = null;
        }
        // R53-W2: 特殊ゾンビ変種の死亡演出+累計メダル
        if (bot.zombieVariant === 'blast') {
          this.zombieVariantBlastExplode(bot.position.clone());
        } else if (bot.zombieVariant === 'miasma') {
          this.zombieVariantMiasmaBurst(bot.position.clone());
        }
        if (bot.zombieVariant) {
          this.zombieVariantKillCount += 1;
          if (this.zombieVariantKillCount === 100) {
            const variantOut: MedalEvent[] = [];
            this.tracker.emitManual('variant-100', variantOut);
            this.emitMedals(variantOut);
          }
        }
        // R53-W2: キル時パワーアップドロップ判定(ラウンド内上限あり)
        if (this.zombiePowerUpRoundCount < POWERUP_ROUND_CAP) {
          const kind = rollPowerUp(Math.random);
          if (kind) {
            this.zombiePowerUpRoundCount += 1;
            this.spawnZombiePowerUp(kind, bot.position.clone());
          }
        }
      } else {
        this.addZombiePoints(POINTS.hit);
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
      amount: Math.round(finalDamage),
      world: point.clone(),
      kind: died ? 'kill' : headshot ? 'head' : 'body',
    });
    // ① 戦闘引力: bot被弾/キルイベント記録(プレイヤーが交戦中の位置へ群れを引き寄せる)
    if (this.config.mode !== 'zombie' && !this.mission) {
      this.recordCombatPos(point);
    }
    if (died) {
      this.haptic(150, 0.5, 0.75); // キル確定の手応え
      // ファイナルキルカム: プレイヤーのキルを記録
      if (this.config.mode !== 'zombie') {
        this.killcam.noteKill(true, -1, this.bots.indexOf(bot), this.elapsed);
      }
      this.killSurgeEnv = 1; // R20 rank4: キル確定サージ(PostFXの彩度/コントラスト+白エッジ)を点火
      this.scoreboardDirty = true; // ★6 キル確定は即時反映
      this.player.kills += 1;
      this.player.streak += 1;
      if (this.mission && bot.team === ENEMY_TEAM) {
        this.missionKills += 1;
        if (bot.tier === 'boss') this.missionBossKills += 1; // bossOnly判定(c10m5)用
      }
      this.bestStreak = Math.max(this.bestStreak, this.player.streak);
      this.playerWeaponKills[weaponName] = (this.playerWeaponKills[weaponName] ?? 0) + 1;
      // カモチャレンジ: 表示名→武器IDの逆引きで武器別キル/HSキルを記録(近接/投擲は null=対象外)
      const camoWeaponId = weaponIdByName(weaponName);
      if (camoWeaponId) {
        this.playerKillsByWeapon[camoWeaponId] = (this.playerKillsByWeapon[camoWeaponId] ?? 0) + 1;
        if (headshot) {
          this.playerHsByWeapon[camoWeaponId] = (this.playerHsByWeapon[camoWeaponId] ?? 0) + 1;
        }
      }
      // クナイ(fists)カモ: 近接/ダイブスラム/黒帝斬撃/ブリンク斬撃/雷帝斬撃のキルを専用カウンタへ
      const isMeleeKill = ['近接', 'ダイブスラム', '黒帝斬撃', 'ブリンク斬撃', '雷帝斬撃'].includes(weaponName);
      if (isMeleeKill) {
        this.playerKillsByWeapon['fists'] = (this.playerKillsByWeapon['fists'] ?? 0) + 1;
        // ブリンク斬撃: headshots スロットを blink-slash キルカウンタとして流用
        if (weaponName === 'ブリンク斬撃') {
          this.playerHsByWeapon['fists'] = (this.playerHsByWeapon['fists'] ?? 0) + 1;
        }
      }
      this.addKillScore(PLAYER_TEAM);
      this.spawnDogTag(bot);
      this.hits.push(scopeKill ? 'snipe' : 'kill');
      this.feed.push({ killer: PLAYER_NAME, victim: bot.name, weapon: weaponName, headshot });
      this.scoreEvents.push({ label: 'キル', xp: 100 });
      if (bot.kind === 'master') {
        this.scoreEvents.push({ label: '達人撃破', xp: 500 });
      }
      // ガンゲーム: ランク進行(スコアストリーク/アナウンサーの前に処理してthis.overを確定させる)
      if (this.config.mode === 'gungame') {
        this.ggOnPlayerKill(bot, weaponName === '近接');
      }
      // BO2 スコアストリーク: ゾンビ/ガンゲーム/トレーニングモードは無効
      // T2: トレーニングは自動蘇生標的の無限キルで容易にバンクが貯まってしまい、
      // 無敵化(HK)やRC-XD凍結等の未設計な相互作用を起こすため明示的に除外する
      if (
        this.config.mode !== 'zombie' &&
        this.config.mode !== 'gungame' &&
        this.config.mode !== 'training'
      ) {
        const newly = this.streakManager.addScore(headshot ? 125 : 100);
        for (const idx of newly) {
          const def = STREAK_DEFS[idx];
          if (def) {
            this.announcements.push(def.name + ' READY');
            this.sounds.announceMedal(1, this.settings.announcerVolume);
          }
        }
      }
      if (scopeKill) this.sounds.snipeKill();
      else this.sounds.killPitchTier(Math.min(this.player.streak, 5));
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
      // R30 ストリークスティンガー(Valorant式マイルストーン音)
      if (this.player.streak === 5)       this.sounds.streakStinger(1);
      else if (this.player.streak === 10) this.sounds.streakStinger(2);
      else if (this.player.streak === 15) this.sounds.streakStinger(3);
      else if (this.player.streak === 20) this.sounds.streakStinger(4);
      else if (this.player.streak === 25) this.sounds.streakStinger(5);
      this.botDeathFx(bot, srcClass ?? undefined);
      // ③ 黒雷帝中のキル演出: 対象位置に黒雷柱+雷鳴小
      // ※ 真の「黒い雷柱」は effects.kokuraiteiKillColumn(pos) として別担当へ依頼
      if (this.kokuraiteiMode) {
        const killPos = new THREE.Vector3(bot.position.x, bot.position.y, bot.position.z);
        // R53-W3 M3: キル演出のtier格差(雑魚/精鋭/ボスで柱・スティングが変わる)
        this.effects.kokuraiteiKillColumn(killPos, bot.tier, this.settings.reduceMotion);
        this.sounds.lightningStrikeAoE(false);
        this.sounds.kokuraiKillLayer(this.player.streak); // R33: 紫電レイヤ + マルチキル轟音
        this.sounds.kokuraiKillTierSting(bot.tier);
        // 帝威: 25m内のキルは周辺(キル地点10m)の敵を怯えさせる
        if (killPos.distanceTo(this.player.position) <= 25) {
          this.applyEmperorFear(killPos, 10);
        }
        // R53-W3 M3: 刀身雷脈 — 累計(前試合まで=kokuraiKillsBase + 今試合=実キル数)100到達。
        // ★V-D HIGH修正: tracker.counts['kokurai-kill']はメダル発火回数(初キルの1回のみ≒試合数)で
        // キル数ではない。在match寄与は tracker.kokuraiKillCount(本当のキル数)を使う
        if (!this.katanaVeinsOn) {
          const total = (this.config.kokuraiKillsBase ?? 0) + this.tracker.kokuraiKillCount;
          if (total >= 100) {
            this.katanaVeinsOn = true;
            this.viewModel.setKatanaVeins(true);
            this.announcements.push('黒雷百殺 — 刀身に雷脈が刻まれた');
          }
        }
      } else if (this.raiteiMode && this.isNinja) {
        // R53-W3 M3: 雷帝キルの氷青スティング(黒雷帝優先=else側)
        this.sounds.raiteiKillSting();
      }
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
        // R45a: 新フィールド
        crouching: this.player.crouching && !this.player.sliding,
        sprinting: this.player.sprinting,
        blinkAgeMs: (this.elapsed - this.lastBlinkElapsed) * 1000,
        reloadKillBit: this.reloadKillBit,
        magAmmoBeforeKill: isGun ? this.prevMagAmmo : undefined, // V-FINAL: 近接キルでのlast-bullet誤爆防止
        darkEmperorActive: this.darkEmperorTimer > 0,
        raiteiActive: this.raiteiMode,
        kokuraiteiActive: this.kokuraiteiMode,
        hellMode: this.config.hellMode ?? false,
        botKind: bot.kind,
        matchKillCount: this.player.kills,
        matchElapsed: this.elapsed,
        playerHpRatio: this.player.alive ? this.player.hp / this.player.maxHp : 0,
      };
      const out: MedalEvent[] = [];
      this.tracker.onKill(ctx, out);
      this.emitMedals(out);
      // R44a: 黒雷帝キルで魂吸収ビーム
      if (this.kokuraiteiMode && !this.killcamCamActive) {
        this.effects.soulAbsorbBeam(
          new THREE.Vector3(bot.position.x, bot.position.y + 0.5, bot.position.z),
          this.player.eyePosition.clone(),
          this.settings.reduceMotion,
        );
      }
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
      // 初解放はファンファーレ+読み上げ、以降はWebAudioスティングのみ(announceStreakと非衝突)。
      // R51-3: ゾンビは無限ラウンドで同じ実績を再達成し続けるため、非firstUnlockのスティングは
      // ゾンビモード中のみ抑制する(HUD側もバッジ非表示・左フィードのみに揃えてある)。
      // firstUnlockのファンファーレ+読み上げは非ゾンビと同じく常に鳴らす
      if (top.firstUnlock) this.sounds.announceUnlock(top.name, vol);
      else if (this.config.mode !== 'zombie') this.sounds.announceMedal(tierLevel[top.tier], vol);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R53-W2: PaP compose一本化 + 特殊ゾンビ変種 + パワーアップ + 特殊ラウンド + お守り
  // ═══════════════════════════════════════════════════════════════════

  // ゾンビ経済のポイント加算を一箇所に集約(double powerup中は×2)。
  // 命中/キル/ボスボーナス/rushクリア/nuke/carpenterの全てがここを通る。
  private addZombiePoints(amount: number): void {
    // ★V-A修正: ヌーク中のキルはノーポイント(BO2準拠 — 100体×満額60ptで6000pt超の
    // 過剰供給を防ぐ。定額 NUKE_BONUS_PT のみ zombieNuke() が抑制フラグの外で付与する)
    if (this.zombieNukeSuppressPoints) return;
    const mul = this.zombieDoublePointsTimer > 0 ? 2 : 1;
    this.zombiePoints += Math.round(amount * mul);
  }

  // ── Pack-a-Punch/パーク: composeZombieWeaponDefへの一本化 ──────────────────
  // WEAPON_DEFSの基礎値から常に再計算する(現在値への乗算は禁止。R53-W2契約)。
  // fists(クナイ)はcompose自体が素通しするが、papCamo付与も無意味なため早期returnする。
  private recomposeWeapon(w: Weapon): void {
    if (EXT_MAG_EXCLUDED_IDS.has(w.def.id)) return;
    const baseDef = WEAPON_DEFS[w.def.id];
    if (!baseDef) return;
    const papTier = (this.zombiePapTiers.get(w.def.id) ?? 0) as PapTier;
    const composed = composeZombieWeaponDef(baseDef, {
      papTier,
      extMagStacks: this.zombiePerkStacks.get('ext-mag') ?? 0,
      doubleTapStacks: this.zombiePerkStacks.get('double-tap') ?? 0,
      speedColaStacks: this.zombiePerkStacks.get('speed-cola') ?? 0,
    });
    w.def.damage = composed.damage;
    w.def.rpm = composed.rpm;
    w.def.reloadTacticalMs = composed.reloadTacticalMs;
    w.def.reloadEmptyMs = composed.reloadEmptyMs;
    w.def.name = composed.name;
    w.def.papCamo = PAP_CAMO_BY_TIER[papTier];
    w.def.magazineSize = composed.magazineSize;
    // 容量が変わらない場合でも need=0 のno-opになるだけなので常に呼んで安全
    // (副次効果: パーク購入のたびに現在弾を最大容量まで無償で継ぎ足す=害のない気持ちよさ)
    w.magazine.setCapacity(composed.magazineSize, true);
  }

  private recomposeAllWeapons(): void {
    for (const w of this.weapons) this.recomposeWeapon(w);
  }

  // Pack-a-Punch台/HUDプロンプトが参照する実効コスト(スロット定義のcost=0はダミー)
  private zombiePapEffectiveCost(): number {
    const weapon = this.activeWeapon;
    if (EXT_MAG_EXCLUDED_IDS.has(weapon.def.id)) return Infinity;
    const curTier = (this.zombiePapTiers.get(weapon.def.id) ?? 0) as PapTier;
    if (curTier >= 3) return PAP_REFILL_COST;
    return PAP_COST[(curTier + 1) as PapTier];
  }

  // ショッププロンプト用: pack-a-punchのみ動的コストへ差し替え、他は素通し
  private zombieSlotEffectiveCost(slot: ShopSlot): number {
    return slot.kind === 'pack-a-punch' ? this.zombiePapEffectiveCost() : slot.cost;
  }

  // ── 特殊ゾンビ変種: 死亡演出 ─────────────────────────────────────────────────
  private aliveMiasmaCount(): number {
    let n = 0;
    for (const b of this.bots) if (b.kind === 'zombie' && b.alive && b.zombieVariant === 'miasma') n += 1;
    return n;
  }

  private zombieVariantBlastExplode(pos: THREE.Vector3): void {
    // ★V-A修正(TODO消化): B-FX2の専用FX(小型爆発+緑破片、既存プール流用)へ置換
    this.effects.variantBlastFx(pos.x, pos.y, pos.z);
    this.sounds.variantBlastExplode();
    if (this.player.alive) {
      const d = this.player.position.distanceTo(pos);
      if (d < BLAST_RADIUS_M) {
        const falloff = 1 - d / BLAST_RADIUS_M;
        const dmg = Math.round(BLAST_DMG * Math.max(0.3, falloff));
        const died = this.player.takeDamage(dmg);
        this.tookDamage = true;
        this.addShake(0.3);
        this.incoming.push(this.incomingAngle(pos));
        this.sounds.hurt();
        this.tracker.onPlayerDamaged();
        if (died) {
          this.feed.push({ killer: '自爆ゾンビ', victim: PLAYER_NAME, weapon: '自爆ゾンビ', headshot: false });
          this.sounds.death();
          this.notePlayerDeath(null);
        }
      }
    }
    // 周囲ゾンビも巻き込む(BO2らしい連鎖爆発。既存の範囲ダメージ処理と同じくapplyBotDamage経由で
    // 経済/メダル/他variantの連鎖演出を一貫させる。HK/Lightning Strike等と同一の既存パターン)
    for (const other of this.bots) {
      if (other.kind !== 'zombie' || !other.alive) continue;
      const d = other.position.distanceTo(pos);
      if (d >= BLAST_RADIUS_M) continue;
      this.applyBotDamage(other, BLAST_DMG, other.position.clone(), false, '自爆ゾンビ', false);
    }
  }

  private zombieVariantMiasmaBurst(pos: THREE.Vector3): void {
    this.sounds.variantMiasmaBurst();
    if (this.zombieMiasmaClouds.length >= 4) return; // 同時上限(task仕様)
    // ★V-A修正(TODO消化): 視覚はB-FX2のプール実装(effects.miasmaCloud、多層スプライト+粒子、
    // 上限4は effects側でも保証)へ委譲。matchはDPS判定用の位置/残時間エンティティのみ保持
    this.effects.miasmaCloud(pos.x, pos.y, pos.z, this.settings.reduceMotion);
    this.zombieMiasmaClouds.push({ pos: pos.clone(), remainS: MIASMA_DURATION_S, tickIn: 0 });
  }

  private updateMiasmaClouds(dt: number): void {
    this.zombiePoison01 = Math.max(0, this.zombiePoison01 - dt / 1.2);
    for (let i = this.zombieMiasmaClouds.length - 1; i >= 0; i -= 1) {
      const cloud = this.zombieMiasmaClouds[i]!;
      cloud.remainS -= dt;
      if (cloud.remainS <= 0) {
        // 視覚はeffects側プールが同じ寿命(6s)で自然消滅する — match側はエンティティ除去のみ
        this.zombieMiasmaClouds.splice(i, 1);
        continue;
      }
      const inside = this.player.alive && this.player.position.distanceTo(cloud.pos) < MIASMA_RADIUS_M;
      if (inside) this.zombiePoison01 = 1;
      cloud.tickIn -= dt;
      if (cloud.tickIn <= 0) {
        cloud.tickIn = MIASMA_TICK_S;
        // このメソッドはmode==='zombie'時のみ呼ばれる(update()側のガード)ためtraining除外は不要
        if (inside) {
          const tickDamage = MIASMA_DPS * MIASMA_TICK_S;
          const died = this.player.takeDamage(tickDamage);
          this.tookDamage = true;
          this.addShake(0.04);
          this.incoming.push(this.incomingAngle(cloud.pos));
          this.sounds.hurt();
          this.tracker.onPlayerDamaged();
          if (died) {
            this.feed.push({ killer: '毒霧', victim: PLAYER_NAME, weapon: '毒霧', headshot: false });
            this.sounds.death();
            this.notePlayerDeath(null);
          }
        }
      }
    }
  }

  // ── パワーアップ: ドロップ管理+収集効果(ドロップ視覚/色はeffects.powerUpBeacon側) ──

  private spawnZombiePowerUp(kind: PowerUpKind, pos: THREE.Vector3): void {
    // ★V-A修正(TODO消化): B-FX2のビーコン(八面体+リング、kind別共有マテリアル)を使用。
    // scene.add/位置更新/despawnはmatch側管理(呼び出し側管理型の契約)
    const mesh = this.effects.powerUpBeacon(kind, this.settings.reduceMotion);
    mesh.position.copy(pos);
    mesh.position.y += 0.4;
    this.scene.add(mesh);
    this.zombiePowerUpDrops.push({ kind, pos: mesh.position.clone(), remainS: POWERUP_DESPAWN_S, mesh });
  }

  private updateZombiePowerUps(dt: number): void {
    if (this.zombieInstaKillTimer > 0) {
      this.zombieInstaKillTimer = Math.max(0, this.zombieInstaKillTimer - dt);
      if (this.zombieInstaKillTimer === 0) {
        this.sounds.powerUpExpire();
        this.announcements.push('インスタキル終了');
      }
    }
    if (this.zombieDoublePointsTimer > 0) {
      this.zombieDoublePointsTimer = Math.max(0, this.zombieDoublePointsTimer - dt);
      if (this.zombieDoublePointsTimer === 0) {
        this.sounds.powerUpExpire();
        this.announcements.push('2倍ポイント終了');
      }
    }
    for (let i = this.zombiePowerUpDrops.length - 1; i >= 0; i -= 1) {
      const drop = this.zombiePowerUpDrops[i]!;
      // ビーコンの回転/浮遊パラメタはeffects側がuserDataで供給(reduceMotion時 bob=0)
      const spin = (drop.mesh.userData.spinSpeed as number | undefined) ?? 2.2;
      const bob = (drop.mesh.userData.bobAmplitude as number | undefined) ?? 0.08;
      drop.mesh.rotation.y += dt * spin;
      drop.mesh.position.y = drop.pos.y + Math.sin(this.elapsed * 2 + i) * bob;
      drop.remainS -= dt;
      let picked = false;
      if (this.player.alive && this.player.position.distanceTo(drop.pos) < 1.6) {
        picked = true;
        this.zombieCollectPowerUp(drop.kind);
      }
      if (picked || drop.remainS <= 0) {
        this.scene.remove(drop.mesh);
        this.effects.disposePowerUpBeacon(drop.mesh); // parentから外すのみ(共有マテリアル保護)
        this.zombiePowerUpDrops.splice(i, 1);
      }
    }
  }

  private zombieNukeSuppressPoints = false;

  private zombieNuke(): void {
    // ★V-A修正: キルループ中は per-kill ポイントを抑制(定額のみ。BO2準拠)
    this.zombieNukeSuppressPoints = true;
    try {
      for (const bot of this.bots) {
        if (bot.kind !== 'zombie' || !bot.alive || bot.tier === 'boss') continue;
        this.applyBotDamage(bot, bot.hp + 1, bot.position.clone(), false, 'ヌーク', false);
      }
    } finally {
      this.zombieNukeSuppressPoints = false;
    }
    this.addZombiePoints(NUKE_BONUS_PT);
  }

  private zombieCollectPowerUp(kind: PowerUpKind): void {
    this.sounds.powerUpPickup(kind);
    switch (kind) {
      case 'insta':
        this.zombieInstaKillTimer = POWERUP_DURATION_S;
        this.announcements.push('インスタキル！');
        break;
      case 'double':
        this.zombieDoublePointsTimer = POWERUP_DURATION_S;
        this.announcements.push('2倍ポイント！');
        break;
      case 'nuke':
        this.zombieNuke();
        this.announcements.push('ヌーク！');
        break;
      case 'maxammo':
        for (const w of this.weapons) w.resupply();
        this.refillGrenades();
        this.announcements.push('弾薬満タン！');
        break;
      case 'carpenter':
        // R53-W2: R31破壊カバーの復元(handle再生成+destroyedPropHandlesからの除去+
        // breakableProps再登録)は本タスクのスコープ外と判断(専用の永続レジストリが
        // 別途必要で影響範囲が大きい)。ボーナスポイントのみ付与する(判断は報告済み)。
        this.addZombiePoints(CARPENTER_BONUS_PT);
        this.announcements.push('カーペンター(修復対象なし、ボーナスのみ)');
        break;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  private zombieActivePowerUpsSnap(): Array<{ kind: PowerUpKind; remainS: number }> {
    const out: Array<{ kind: PowerUpKind; remainS: number }> = [];
    if (this.zombieInstaKillTimer > 0) out.push({ kind: 'insta', remainS: this.zombieInstaKillTimer });
    if (this.zombieDoublePointsTimer > 0) out.push({ kind: 'double', remainS: this.zombieDoublePointsTimer });
    return out;
  }

  // ── お守り(charm): 死亡edgeでの自動復活を quick-revive と共有ロジックで処理 ──
  private zombieRevivePlayerInPlace(message: string): void {
    const revivePos = this.player.position.clone();
    revivePos.y -= PLAYER_FEET_OFFSET;
    this.player.respawnAt(revivePos);
    this.player.hp = Math.max(1, Math.floor(this.player.maxHp * 0.5));
    this.zombieMeleeIframe = this.elapsed + 2;
    for (const weapon of this.weapons) weapon.resupply();
    this.activeWeapon.raise();
    this.shakeTrauma = 0;
    this.deathPos = null;
    this.killer = null;
    this.killcamTimer = 0;
    this.deathVeil = 0;
    this.zombieReviveFlash = 1;
    this.announcements.push(message);
    this.sounds.announceMedal(1, this.settings.announcerVolume);
  }

  // 視線の途中にスモークがあれば互いに見えない
  private smokeBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const zone of this.smokeZones) {
      if (segmentDistance(a, b, zone.pos) < zone.radius * 0.75) return true;
    }
    return false;
  }

  // ── BO2 スコアストリーク: 入力受付 + 各ストリークの毎フレーム処理 ────────────────
  private updateStreaks(dt: number): void {
    const vol = this.settings.announcerVolume;

    // ── RC-XD: 操縦中フレーム処理 ────
    if (this.rcxdActive) {
      this.rcxdTimer -= dt;
      const RCXD_SPEED = 18; // m/s
      const RCXD_TURN_RATE = 2.8; // rad/s
      const fwdInput = (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0);
      const turnInput = (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0);
      if (turnInput !== 0) this.rcxdYaw += turnInput * RCXD_TURN_RATE * dt;
      const moveDir = new THREE.Vector3(-Math.sin(this.rcxdYaw), 0, -Math.cos(this.rcxdYaw));
      if (fwdInput !== 0) {
        const checkDir = moveDir.clone().multiplyScalar(fwdInput > 0 ? 1 : -1);
        const wallHit = this.castRay(
          this.rcxdPos.clone().add(new THREE.Vector3(0, 0.1, 0)),
          checkDir,
          0.5,
          null,
        );
        if (!wallHit) {
          this.rcxdPos.addScaledVector(moveDir, fwdInput * RCXD_SPEED * dt);
        }
      }
      // 接地スナップ
      const groundHit = this.castRay(
        this.rcxdPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
        new THREE.Vector3(0, -1, 0),
        3,
        null,
      );
      if (groundHit) {
        this.rcxdPos.y = this.rcxdPos.y + 1.5 - hitToi(groundHit) + 0.09;
      }
      if (this.rcxdMesh) {
        this.rcxdMesh.position.copy(this.rcxdPos);
        this.rcxdMesh.rotation.y = this.rcxdYaw;
      }
      // 起爆: 左クリック or タイムアウト
      const detonate = (this.input.locked && this.input.fireDown()) || this.rcxdTimer <= 0;
      // キャンセル: ポインタロック解除(ESC) or 右クリック(ADS)
      const cancel = !this.input.locked || this.input.adsPressed();
      if (detonate) {
        this.detonateRcxd();
      } else if (cancel) {
        this.cancelRcxd();
      }
    }

    // ── キー入力 → 対応ストリークを tryConsume (生存中・RC-XD非操縦中のみ) ────
    // T2: トレーニングはバンクが常に空のはずだが「空だから安全」という暗黙依存を断ち、
    // 発動ゲート自体にもモード除外を明示する
    if (this.player.alive && !this.rcxdActive && this.config.mode !== 'training') {
      type StreakAction = 'streak1' | 'streak2' | 'streak3' | 'streak4' | 'streak5' | 'streak6' | 'streak7';
      const activationMap: Array<[StreakAction, StreakIndex]> = [
        ['streak1', 0],  // RC-XD 325
        ['streak2', 1],  // UAV 425
        ['streak3', 2],  // Hunter-Killer 525
        ['streak4', 3],  // Care Package 550
        ['streak5', 4],  // Counter UAV 600
        ['streak6', 5],  // Lightning Strike 750
        ['streak7', 6],  // Sensor Turret 800
      ];
      for (const [action, idx] of activationMap) {
        if (this.input.wasPressed(action)) {
          // RC-XD(idx=0): 既に操縦中なら不可
          if (idx === 0 && this.rcxdActive) continue;
          // HK(idx=2): 標的不在なら消費しない(バンクを無駄に使わない)
          if (idx === 2 && !this.findNearestEnemyBot()) continue;
          if (this.streakManager.tryConsume(idx)) {
            this.activateStreak(idx, vol);
          }
        }
      }
    }

    // ── UAV: タイマー減算 + 4 秒ごとにスナップ更新 ────
    if (this.uavTimer > 0) {
      this.uavTimer = Math.max(0, this.uavTimer - dt);
      this.uavSweepTimer -= dt;
      if (this.uavSweepTimer <= 0) {
        this.uavSweepTimer = 4;
        // 敵の現在位置をスナップショット
        this.uavEnemySnap = [];
        for (const bot of this.bots) {
          if (bot.alive && bot.team !== PLAYER_TEAM) {
            this.uavEnemySnap.push({
              x: bot.position.x,
              z: bot.position.z,
              snappedAt: this.elapsed,
            });
          }
        }
      }
    }

    // ── Hunter-Killer: エンティティ更新 ────
    const HK_SPEED = 28;     // m/s
    const HK_IMPACT_DIST = 2.2; // m (この距離で爆発)
    const HK_RADIUS = 6;    // 爆発半径(m)
    const HK_MAX_DMG = 220;
    for (let i = this.hkEntities.length - 1; i >= 0; i -= 1) {
      const hk = this.hkEntities[i]!;
      hk.timer -= dt;

      // フェーズ判定
      if (hk.phase === 'rise' && hk.timer <= 9.5) {
        hk.phase = 'dive';
        hk.vel.set(0, 0, 0);
      }
      if (hk.phase === 'rise') {
        hk.vel.set(0, 8, 0);
      } else {
        // ターゲットが生きていれば追いかける
        const target = this.bots.find((b) => b.uid === hk.targetUid && b.alive);
        if (target) hk.targetLastPos.copy(target.position);
        const toTarget = hk.targetLastPos.clone().sub(hk.pos);
        const dist = toTarget.length();
        if (dist > 0.1) {
          hk.vel.copy(toTarget.normalize().multiplyScalar(HK_SPEED));
        }
      }

      // 位置更新
      hk.pos.addScaledVector(hk.vel, dt);
      hk.mesh.position.copy(hk.pos);

      // 命中判定 or タイムアウト
      const target = this.bots.find((b) => b.uid === hk.targetUid && b.alive);
      const distToTarget = target ? hk.pos.distanceTo(target.position) : Infinity;
      if (distToTarget < HK_IMPACT_DIST || hk.timer <= 0) {
        // 爆発
        const ep = this.panAndDistance(hk.pos);
        this.effects.explosion(hk.pos.clone(), 1.6);
        this.sounds.explosion(ep.pan, ep.distance);
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          const d = hk.pos.distanceTo(bot.position);
          if (d >= HK_RADIUS || !this.explosionReaches(hk.pos.clone(), bot.position)) continue;
          this.applyBotDamage(bot, HK_MAX_DMG * (1 - d / HK_RADIUS), bot.position, false, 'HUNTER KILLER');
        }
        // クリーンアップ
        this.scene.remove(hk.mesh);
        hk.geo.dispose();
        (hk.mesh.material as THREE.Material).dispose();
        this.hkEntities.splice(i, 1);
      }
    }

    // ── Lightning Strike: 遅延爆発キュー ────
    const LS_RADIUS = 8;
    const LS_MAX_DMG = 180;
    for (let i = this.lightningQueue.length - 1; i >= 0; i -= 1) {
      const ls = this.lightningQueue[i]!;
      if (this.elapsed < ls.fireAt) continue;
      const ep = this.panAndDistance(ls.pos);
      this.effects.explosion(ls.pos.clone(), 2.2);
      this.sounds.explosion(ep.pan, ep.distance);
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        const d = Math.min(ls.pos.distanceTo(bot.position), ls.pos.distanceTo(bot.headPosition()));
        if (d >= LS_RADIUS || !this.explosionReaches(ls.pos.clone(), bot.position)) continue;
        this.applyBotDamage(bot, LS_MAX_DMG * (1 - d / LS_RADIUS), bot.position, false, 'LIGHTNING STRIKE');
      }
      this.lightningQueue.splice(i, 1);
    }

    // ── Sensor Turret: 有効期限チェック ────
    for (const [uid, expiresAt] of this.streakTurretExpiry) {
      if (this.elapsed >= expiresAt) {
        const bot = this.bots.find((b) => b.uid === uid && b.alive);
        if (bot) bot.takeDamage(9999, undefined);
        this.streakTurretExpiry.delete(uid);
      }
    }

    // ── Counter UAV: タイマー減算 ────
    if (this.cauavTimer > 0) {
      this.cauavTimer = Math.max(0, this.cauavTimer - dt);
    }

    // ── Care Package: 落下アニメ + 自動消滅 ────
    for (let i = this.carePackageCrates.length - 1; i >= 0; i -= 1) {
      const crate = this.carePackageCrates[i]!;
      if (!crate.landed) {
        crate.dropTimer += dt;
        const t = Math.min(1, crate.dropTimer / 2.0); // 2秒で着地
        const eased = t * t; // ease-in
        crate.mesh.position.y = crate.startY + (crate.groundY - crate.startY) * eased;
        if (t >= 1) {
          crate.landed = true;
          crate.mesh.position.y = crate.groundY;
          crate.pos.y = crate.groundY;
          const ep = this.panAndDistance(crate.pos);
          this.effects.explosion(crate.pos.clone(), 0.7); // 着地衝撃
          this.sounds.explosion(ep.pan, ep.distance * 1.4);
        }
      } else {
        crate.openTimer -= dt;
        if (crate.openTimer <= 0) {
          this.disposeCarePackageCrate(i);
        }
      }
    }

    // ── Care Package: E キーで開封 ────
    // ★V-B CRITICAL修正: wasPressed() は読み取りと同時に押下を消費する。近接クレートが
    // 無いのに毎tick消費すると、後段の collect(story)/S&D設置 のE押下が永遠に届かず
    // c9m3/c10m3 がクリア不能になる(B-F1)。nearCarePackage() を先に短絡させ、
    // クレート非近接時は wasPressed を評価しない(=未消費で後段へ渡す)。
    if (
      this.player.alive &&
      this.config.mode !== 'zombie' &&
      this.nearCarePackage() &&
      this.input.wasPressed('interact')
    ) {
      const pp = this.player.position;
      for (let i = this.carePackageCrates.length - 1; i >= 0; i -= 1) {
        const crate = this.carePackageCrates[i]!;
        if (!crate.landed) continue;
        if (pp.distanceTo(crate.pos) > 2.5) continue;
        // ランダム報酬: 50%でストリーク付与、50%でスコア+500
        const roll = Math.random();
        if (roll < 0.5) {
          // ランダムなストリーク1種をバンクへ付与
          const preferIdx = Math.floor(Math.random() * 7) as StreakIndex;
          const granted = this.streakManager.forceBankOne(preferIdx);
          const def = granted !== null ? STREAK_DEFS[granted] : undefined;
          if (def) {
            this.announcements.push(`CARE PACKAGE: ${def.name} RECEIVED`);
            this.sounds.announceMedal(1, vol);
          }
        } else {
          this.scores.add(PLAYER_TEAM, 500);
          this.scoreEvents.push({ label: 'ケアパッケージ', xp: 500 });
          this.announcements.push('CARE PACKAGE: +500 PTS');
          this.sounds.announceMedal(1, vol);
        }
        this.disposeCarePackageCrate(i);
        break;
      }
    }

    // 終了した UAV のスナップをクリア
    if (this.uavTimer <= 0 && this.uavEnemySnap.length > 0) {
      this.uavEnemySnap = [];
    }
  }

  // ── RC-XD ヘルパー ────────────────────────────────────────────────────────────────────
  private spawnRcxd(): void {
    // プロシージャル箱車(車体+4輪+アンテナ+点滅LED)
    const bodyGeo = new THREE.BoxGeometry(0.45, 0.18, 0.7);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a33, emissive: 0x0a0818, roughness: 0.7 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.18;

    const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const wheelPositions: [number, number, number][] = [
      [-0.26, 0.09, 0.24], [0.26, 0.09, 0.24],
      [-0.26, 0.09, -0.24], [0.26, 0.09, -0.24],
    ];

    const antennaGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.28, 4);
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
    const antenna = new THREE.Mesh(antennaGeo, antennaMat);
    antenna.position.set(-0.1, 0.38, -0.15);

    const ledGeo = new THREE.SphereGeometry(0.022, 4, 4);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2.5,
    });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 0.26, 0.36);

    const group = new THREE.Group();
    group.add(body);
    for (const [wx, wy, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      group.add(wheel);
    }
    group.add(antenna);
    group.add(led);

    this.rcxdGeos.push(bodyGeo, wheelGeo, antennaGeo, ledGeo);
    this.rcxdMats.push(bodyMat, wheelMat, antennaMat, ledMat);
    this.rcxdMesh = group;

    const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    this.rcxdPos.copy(this.player.position).addScaledVector(fwd, 1.5);
    this.rcxdYaw = this.player.yaw;
    // 接地させる
    const down = this.castRay(
      this.rcxdPos.clone().add(new THREE.Vector3(0, 1, 0)),
      new THREE.Vector3(0, -1, 0),
      3,
      null,
    );
    if (down) this.rcxdPos.y = this.rcxdPos.y + 1 - hitToi(down) + 0.09;

    group.position.copy(this.rcxdPos);
    group.rotation.y = this.rcxdYaw;
    this.scene.add(group);
    this.rcxdActive = true;
    this.rcxdTimer = 30;
    this.announcements.push('RC-XD DEPLOYED');
  }

  private detonateRcxd(): void {
    if (!this.rcxdActive) return;
    const pos = this.rcxdPos.clone();
    const ep = this.panAndDistance(pos);
    this.effects.explosion(pos, 1.4);
    this.sounds.explosion(ep.pan, ep.distance);
    // 爆発ダメージ: 半径5m / 最大220ダメージ
    const RADIUS = 5;
    const MAX_DMG = 220;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const d = pos.distanceTo(bot.position);
      if (d >= RADIUS || !this.explosionReaches(pos.clone(), bot.position)) continue;
      this.applyBotDamage(bot, MAX_DMG * (1 - d / RADIUS), bot.position, false, 'RC-XD');
    }
    // 自爆ダメージ: 近すぎると自分も巻き込まれる(半径2m以内で50ダメ)
    const selfDist = pos.distanceTo(this.player.position);
    if (selfDist < 2 && this.player.alive) {
      this.player.hp = Math.max(1, this.player.hp - 50);
    }
    this.cleanupRcxd();
  }

  private cancelRcxd(): void {
    if (!this.rcxdActive) return;
    // 自壊(小さな爆発のみ・ダメージなし)
    const pos = this.rcxdPos.clone();
    const ep = this.panAndDistance(pos);
    this.effects.explosion(pos, 0.5);
    this.sounds.explosion(ep.pan, ep.distance * 1.5);
    this.cleanupRcxd();
  }

  private cleanupRcxd(): void {
    if (this.rcxdMesh) {
      this.scene.remove(this.rcxdMesh);
      for (const g of this.rcxdGeos) g.dispose();
      for (const m of this.rcxdMats) m.dispose();
      this.rcxdGeos.length = 0;
      this.rcxdMats.length = 0;
      this.rcxdMesh = null;
    }
    this.rcxdActive = false;
    this.rcxdTimer = 0;
  }

  // ── Care Package ヘルパー ─────────────────────────────────────────────────────────────
  private spawnCarePackage(): void {
    // 照準方向の地面に落とす(~10m前方)
    const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    const dropCenter = this.player.position.clone().addScaledVector(fwd, 8);
    const down = this.castRay(
      new THREE.Vector3(dropCenter.x, dropCenter.y + 15, dropCenter.z),
      new THREE.Vector3(0, -1, 0),
      25,
      null,
    );
    const groundY = down ? dropCenter.y + 15 - hitToi(down) + 0.3 : dropCenter.y + 0.3;
    const startY = groundY + 14;

    // クレートメッシュ(木箱風)
    const boxGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.85 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.y = 0.35;

    // 十字マーク
    const stripV = new THREE.BoxGeometry(0.08, 0.72, 0.08);
    const stripH = new THREE.BoxGeometry(0.72, 0.08, 0.08);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaaaaa, emissiveIntensity: 0.3 });
    const sv = new THREE.Mesh(stripV, stripMat);
    sv.position.set(0, 0.35, 0.36);
    const sh = new THREE.Mesh(stripH, stripMat);
    sh.position.set(0, 0.35, 0.36);

    const group = new THREE.Group();
    group.add(box, sv, sh);
    group.position.set(dropCenter.x, startY, dropCenter.z);
    this.scene.add(group);

    const cratePos = new THREE.Vector3(dropCenter.x, groundY, dropCenter.z);
    this.carePackageCrates.push({
      mesh: group,
      geos: [boxGeo, stripV, stripH],
      mats: [boxMat, stripMat],
      pos: cratePos,
      dropTimer: 0,
      openTimer: 30,
      landed: false,
      startY,
      groundY,
    });
    this.announcements.push('CARE PACKAGE INBOUND');
    this.sounds.announceMedal(1, this.settings.announcerVolume);
  }

  private disposeCarePackageCrate(index: number): void {
    const crate = this.carePackageCrates[index];
    if (!crate) return;
    this.scene.remove(crate.mesh);
    for (const g of crate.geos) g.dispose();
    for (const m of crate.mats) m.dispose();
    this.carePackageCrates.splice(index, 1);
  }

  // ── 各ストリークの発動 ────────────────────────────────────────────────────────────────
  // idx:  0=RC-XD(325) / 1=UAV(425) / 2=HK(525) / 3=CarePackage(550)
  //       4=CounterUAV(600) / 5=Lightning(750) / 6=SensorTurret(800)
  private activateStreak(idx: StreakIndex, vol: number): void {
    if (idx === 0) {
      // RC-XD: 遠隔操作爆走ラジコン爆弾
      this.spawnRcxd();
    } else if (idx === 1) {
      // UAV
      this.uavTimer = 25;
      this.uavSweepTimer = 0; // 即座に1回スナップ
      this.sounds.announceStreak('Friendly UAV inbound.', vol);
      this.announcements.push('UAV ONLINE');
    } else if (idx === 2) {
      // Hunter-Killer: 最寄り敵へ自動誘導
      const nearest = this.findNearestEnemyBot();
      if (!nearest) return; // 敵がいないと発動不可(バンクは消費済み)
      const geo = new THREE.SphereGeometry(0.18, 8, 6);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff2200, emissiveIntensity: 1.2 });
      const mesh = new THREE.Mesh(geo, mat);
      const startPos = this.player.eyePosition.clone().add(new THREE.Vector3(0, 0.3, 0));
      mesh.position.copy(startPos);
      this.scene.add(mesh);
      this.hkEntities.push({
        mesh,
        geo,
        pos: startPos.clone(),
        vel: new THREE.Vector3(0, 8, 0),
        targetUid: nearest.uid,
        targetLastPos: nearest.position.clone(),
        timer: 10,
        phase: 'rise',
      });
    } else if (idx === 3) {
      // Care Package: 照準前方へクレート投下
      this.spawnCarePackage();
    } else if (idx === 4) {
      // Counter UAV: 30秒間 索敵妨害(spotRate×0.3 + alertBots半径×0.5)
      this.cauavTimer = 30;
      this.announcements.push('COUNTER UAV ONLINE');
      this.sounds.announceStreak('Counter UAV online.', vol);
    } else if (idx === 5) {
      // Lightning Strike: プレイヤーの正面方向に 3 発
      const yaw = this.player.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const center = this.player.position.clone().addScaledVector(fwd, 35);
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const offsets = [
        new THREE.Vector3(0, 0, 0),
        right.clone().multiplyScalar(4),
        right.clone().multiplyScalar(-4),
      ];
      for (let i = 0; i < offsets.length; i += 1) {
        const pos = center.clone().add(offsets[i]!);
        // 地面の高さを取得
        const down = this.castRay(new THREE.Vector3(pos.x, pos.y + 10, pos.z), new THREE.Vector3(0, -1, 0), 20, null);
        pos.y = down ? pos.y + 10 - hitToi(down) + 0.1 : pos.y;
        this.lightningQueue.push({ pos, fireAt: this.elapsed + 0.9 + i * 0.2 });
      }
    } else if (idx === 6) {
      // Sensor Turret: プレイヤー正面 2.5m に設置
      const yaw = this.player.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const spawnXZ = this.player.position.clone().addScaledVector(fwd, 2.5);
      spawnXZ.y = this.player.position.y;
      const down = this.castRay(
        new THREE.Vector3(spawnXZ.x, spawnXZ.y + 1, spawnXZ.z),
        new THREE.Vector3(0, -1, 0),
        4,
        null,
      );
      if (down) spawnXZ.y = spawnXZ.y + 1 - hitToi(down) + 0.05;
      const bot = this.spawnBot(
        'センサータレット',
        spawnXZ,
        this.colors.ally,
        PLAYER_TEAM,
        tuningFor('normal', this.config.difficulty),
        'normal',
        'turret',
      );
      // 60秒後に自動消滅
      this.streakTurretExpiry.set(bot.uid, this.elapsed + 60);
    }
  }

  // 生存している最近傍の敵ボットを返す
  private findNearestEnemyBot(): Bot | null {
    let best: Bot | null = null;
    let bestDist = Infinity;
    const pp = this.player.position;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const d = pp.distanceTo(bot.position);
      if (d < bestDist) { bestDist = d; best = bot; }
    }
    return best;
  }

  private updateBots(dt: number): void {
    // 足音: スプリント/スライド中のプレイヤーが至近にいると敵が振り向く。
    // 歩き/しゃがみは無音なので、静かに近づけば背後を取れる
    const noisy = this.player.alive && (this.player.sprinting || this.player.sliding);
    const playerPos = this.player.position;
    this.botFrameIdx = (this.botFrameIdx + 1) % 8; // 今フレームにLOSを走らせる観測者バケット(36bot増員対応)
    for (const bot of this.bots) {
      // ★5 プレイヤー距離を1回だけ算出(スクラッチ再利用)。足音判定/敵足音の双方で使う
      const botDistToPlayer = bot.getPositionInto(BOT_POS_SCRATCH).distanceTo(playerPos);
      // ★8 遠距離(>50m)アニメLOD: syncMeshのsway/呼吸sin群をスキップ(位置/向きのみ同期)
      bot.animLod = botDistToPlayer > ANIM_LOD_DIST_M;
      // ★ ゾンビアニメ半減LOD: 25-50mはuid%2バケットで更新を間引く
      bot.animHalfLod = bot.kind === 'zombie' && !bot.animLod && botDistToPlayer > ZOMBIE_KCC_LOD_NEAR_M;
      if (
        noisy &&
        bot.alive &&
        bot.team !== PLAYER_TEAM &&
        botDistToPlayer < FOOTSTEP_HEAR_DIST
      ) {
        bot.alert = Math.max(bot.alert, 1.5);
        bot.alertPos = reuseVec3(bot.alertPos, playerPos);
      }
      let targetEye: THREE.Vector3 | null = null;
      if (bot.alive) {
        if (bot.kind === 'zombie' || bot.kind === 'giant') {
          // 近接群れ: LOSレイを一切撃たず、生存プレイヤーを直接ターゲット(0 rays / spot-time無し)
          targetEye = this.player.alive ? this.player.eyePosition : null;
        } else if (bot.blind <= 0) {
          targetEye = this.perceive(bot, dt); // spot-time知覚FSMで積分してから供給
        }
      }
      // ガンゲーム: botランクに応じてdamage/burstPauseを段階テーブルで近似する
      let effectiveTuning = bot.tuning;
      if (this.ggState && bot.kind === 'humanoid') {
        const rank = this.ggState.getBotRank(bot.uid);
        const rankTune = GG_BOT_RANK_TUNING[rank - 1];
        if (rankTune) {
          effectiveTuning = { ...bot.tuning, ...rankTune };
        }
      }
      // ── R33 天雷杖スタン: スタン中は bot.update をスキップ ──
      const stunUntil = this.botStunUntil.get(bot) ?? 0;
      if (this.elapsed < stunUntil) {
        if (Math.random() < dt * 6 && !this.settings.reduceMotion) {
          // T7: new Vector3(0,1,0)の使い捨て確保→既存CAM_UP定数を再利用。位置はスクラッチ経由
          // (staffStunSpark は同期的に読むだけで参照を保持しない=使い回し安全)
          this.effects.staffStunSpark(HOT_DIFF_SCRATCH.copy(bot.position).addScaledVector(CAM_UP, 0.5));
        }
        continue;
      }
      // R33 虚像世界: 発動中は敵全体の時間を×0.1へスロー(移動・射撃とも減速)
      const kyozouSlowMul = this.shinkirouKyozouTimer > 0 && bot.team !== PLAYER_TEAM ? 0.1 : 1;
      bot.update(dt * kyozouSlowMul, {
        targetEye,
        objective: bot.alive ? this.objectiveFor(bot) : null,
        tuning: effectiveTuning,
        rand: this.rand,
        onShoot: (origin, dir) => this.botShoot(bot, origin, dir),
        onMelee: (b) => this.zombieMelee(b),
      });
      // 死亡ボットの足音フェーズを即解放(生存ボットのみが足音を持つ)
      if (!bot.alive) {
        this.botStepPhase.delete(bot.uid);
        continue;
      }

      // ── 敵足音 ── (生存ボットのみ。遠距離25m超/歩行ゼロはスキップ)
      if (bot.alive && this.player.alive) {
        // ★5 ループ先頭の距離を再利用(bot.updateは物理stepまで translation を変えない)
        const botDist = botDistToPlayer;
        if (botDist < 25 && bot.horizSpeedMps > 0.1) {
          const prev = this.botStepPhase.get(bot.uid) ?? 0;
          const next = prev + bot.horizSpeedMps * dt * kyozouSlowMul; // V37: 虚像世界スロー中は足音ケイデンスも同期
          this.botStepPhase.set(bot.uid, next % 2.2);
          if (next >= 2.2) {
            // ストライドイベント発火
            const sp = this.panAndDistance(bot.position);
            // 遮蔽判定: プレイヤー視点からのレイキャスト(一歩ごとに1回のみ)
            const eye = this.player.eyePosition;
            // T7: ストライド毎(頻度は低いが継続発生)のclone().sub()をスクラッチへ
            // (castRayは同期的にx/y/zを読むだけで参照を保持しない=使い回し安全)
            const toBotDir = HOT_DIFF_SCRATCH.copy(bot.position).sub(eye);
            const d = toBotDir.length();
            let occluded = false;
            if (d > 0.5) {
              const hit = this.castRay(eye, toBotDir.normalize(), d - 0.3, this.player.body);
              if (hit) {
                const tag = this.tags.get(hit.collider.handle);
                occluded = tag === undefined || tag.kind === 'world';
              }
            }
            const isZombie = bot.kind === 'zombie';
            const intensity = isZombie ? Math.min(1, 0.6 + bot.horizSpeedMps * 0.08) : 0.45;
            this.sounds.enemyFootstep(sp.pan, sp.distance, this.stageSurfaceFloor, intensity, occluded);
          }
        } else if (!bot.alive || bot.horizSpeedMps < 0.05) {
          this.botStepPhase.delete(bot.uid);
        }
      }
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
      // 前回の対象がまだコーン内なら継続、無ければ最至近。LOSは uid%8 バケットで間引く(36bot増員対応)
      const cached = cands.find((c) => c.uid === bot.lastCandidateUid) ?? null;
      const runLos = bot.uid % 8 === this.botFrameIdx || cached === null;
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
        if (rawVisible) bot.lastTargetEye = reuseVec3(bot.lastTargetEye, cand.eye);
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
      bot.lkp = reuseVec3(bot.lkp, cand.eye);
      bot.engageGrace = ENGAGE_GRACE_S;
      // 発見途中(SPOTTED未満)は脅威方向へ振り向かせて自然に気づかせる(視線が外れて発見が止まらない)
      if (bot.spotAwareness < SPOTTED_TH && bot.alert <= 0) {
        bot.alert = 1.0;
        bot.alertPos = reuseVec3(bot.alertPos, cand.eye);
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
    // boundary(ghost壁)は視線を遮蔽しない(演出系=除外原則)
    const hit = this.castRay(head, dir, dist - 0.2, bot.body,
      (c) => this.tags.get(c.handle)?.kind !== 'boundary',
    );
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
    // R29再校正: fogDensity が約半減したため係数 2.5→5.0 へ戻し実効発見速度を従来相当に維持する。
    const fogFactor =
      Math.max(0.35, Math.exp(-cand.dist * this.stageFogDensity * 5.0)) * Math.max(0.5, this.stageAmbient);
    let rate = base * distFactor * coneFactor * moveFactor * fogFactor;
    if (bot.alert > 0) rate *= ALERT_SPOT_MUL; // 銃声を聞いた=戦闘文脈では素早く発見
    if (bot.pain > 0) rate = Math.max(rate, base * PAIN_SPOT_MUL); // 撃たれた=即発見に近づく
    // カウンターUAV: 索敵能力を×0.3まで減衰(プレイヤーが見つかりにくくなる)
    if (cand.isPlayer && this.cauavTimer > 0) rate *= 0.3;
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
      // ★4a 軽量化: rankAimPoints(候補配列を新規生成)を呼ぶ前の粗ゲート。新規オブジェクト生成
      // ゼロで「レンジ外」「コーン外」を即skipする。AIM_PARTS系のdy最大絶対値(TANK head dy=1.0)を
      // 安全マージンとして両判定に加算し、部位オフセットぶんで本来ヒットし得た候補を誤って
      // 弾かないことを保証する(挙動不変)。コーン側は近距離ほどマージン角が発散して自然に
      // ノーガード化する(asinで距離依存の安全角を厳密に算出)ため近接での取りこぼしも無い。
      const gdx = base.x - eye.x;
      const gdy = base.y - eye.y;
      const gdz = base.z - eye.z;
      const gDistSq = gdx * gdx + gdy * gdy + gdz * gdz;
      const gEffRange = maxRange + AIM_PART_DY_MARGIN_M;
      if (gDistSq > gEffRange * gEffRange) continue; // レンジ外
      const gDist = Math.sqrt(gDistSq);
      if (gDist > 1e-3) {
        const marginDenom = Math.max(gDist - AIM_PART_DY_MARGIN_M, 0.05);
        const marginRad = Math.min(Math.PI / 2, Math.asin(Math.min(1, AIM_PART_DY_MARGIN_M / marginDenom)));
        const coneCos = Math.cos(bestAngle + marginRad);
        const dot = forward.x * gdx + forward.y * gdy + forward.z * gdz;
        if (dot < gDist * coneCos) continue; // コーン外(bestAngleは走査中に狭まるので毎回再評価)
      }
      // 機体種に合った部位候補で、角度の近い順に可視が取れるまで走査=最近接の可視部位
      const parts =
        bot.kind === 'drone'
          ? DRONE_AIM_PARTS
          : bot.kind === 'tank'
            ? TANK_AIM_PARTS
            : bot.kind === 'turret'
              ? TURRET_AIM_PARTS
              : bot.kind === 'zombie' && bot.tuning.scale !== 1
                ? zombieAimPartsForScale(bot.tuning.scale) // 全巨躯: 頭スナップをスケール追従
                : AIM_PARTS; // humanoid, zombie, master, giant -> AIM_PARTS
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

  /** ① 戦闘引力: キル/発砲/被弾イベントの位置をEMAで記録(~10秒減衰) */
  private recordCombatPos(pos: THREE.Vector3): void {
    // 10秒以上戦闘が無ければ古い重心を引きずらずリセット(hotspotEmaのprev=null経路)
    const fresh =
      Number.isFinite(this.hotspotLastT) && this.elapsed - this.hotspotLastT < HOTSPOT_DECAY_S;
    const next = hotspotEma(
      fresh ? { x: this.hotspotPos.x, z: this.hotspotPos.z } : null,
      { x: pos.x, z: pos.z },
    );
    this.hotspotPos.set(next.x, pos.y, next.z);
    this.hotspotLastT = this.elapsed;
  }

  /** ③ ミニマップ発砲ブリップのスナップショット計算(プレイヤー相対座標 + age01) */
  private computeFireBlips(): ReadonlyArray<{ relX: number; relZ: number; age01: number }> {
    if (this.config.mode === 'zombie' || this.config.mode === 'training') return [];
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const out: Array<{ relX: number; relZ: number; age01: number }> = [];
    for (const b of this._fireBlips) {
      const age = this.elapsed - b.spawnedAt;
      if (age <= 1.0) {
        out.push({ relX: b.x - px, relZ: b.z - pz, age01: age });
      }
    }
    return out;
  }

  // ドミネーションでは自チームが持っていない最寄り拠点へ、
  // TDMの味方BOTはプレイヤーの近くへ向かわせる
  private objectiveFor(bot: Bot): THREE.Vector3 | null {
    // R53-W2 M2b: S&D — 攻撃側はサイト/ドロップボムへ、守備側はサイト警戒/解除へ
    if (this.sndRound && this.sndSites) {
      const round = this.sndRound;
      const siteVec = (s: SndSite): THREE.Vector3 => new THREE.Vector3(s.center.x, 0, s.center.z);
      if (this.sndIsAttacker(bot.team)) {
        // ボムがドロップ中なら最寄り攻撃botが回収に向かう
        if (this.sndBombDropPos !== null && round.carrierUid === null) {
          return this.sndBombDropPos.clone();
        }
        if (round.phase === 'planted' && this.sndPlantedSite) {
          return siteVec(this.sndPlantedSite); // 設置後は守り
        }
        // キャリアは最寄りサイトへ、他は uid で A/B に分散して支援
        if (round.carrierUid === bot.uid) {
          const a = this.sndSites[0];
          const b = this.sndSites[1];
          const da = bot.position.distanceTo(siteVec(a));
          const db = bot.position.distanceTo(siteVec(b));
          return siteVec(da <= db ? a : b);
        }
        return siteVec(this.sndSites[bot.uid % 2 === 0 ? 0 : 1]);
      }
      // 守備側
      if (round.phase === 'planted' && this.sndPlantedSite) {
        return siteVec(this.sndPlantedSite); // 解除へ向かう
      }
      return siteVec(this.sndSites[bot.uid % 2 === 0 ? 0 : 1]); // A/B分散警戒
    }
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
    // ハードポイント: 常にアクティブゾーンへ向かわせる(占拠or防衛)
    if (this.hardpointState) {
      return this.hardpointZonePositions[this.hardpointState.currentZoneIndex] ?? null;
    }
    // キルコンファーム: 15m以内の最寄りタグへ向かわせる(無ければ交戦優先=null)
    if (this.kcState) {
      let best: THREE.Vector3 | null = null;
      let bestDist = 15;
      for (const entity of this.kcDogTagEntities) {
        const dx = entity.group.position.x - bot.position.x;
        const dz = entity.group.position.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bestDist) {
          bestDist = dist;
          best = entity.group.position.clone();
        }
      }
      return best;
    }
    if (this.config.mode === 'tdm' && bot.team === PLAYER_TEAM && this.player.alive) {
      return this.player.position;
    }
    // ① 戦闘引力: 目標なし対戦モード(FFA/TDM/スコア/ガンゲーム)で非交戦botの徘徊目標を供給。
    // dom/hardpoint/killconfirm は上の拠点/タグ経路が先に返る=モードゲート。
    // ゾンビ/ミッション/訓練は不変。
    if (
      this.config.mode !== 'zombie' &&
      this.config.mode !== 'training' &&
      !this.mission &&
      bot.aiState !== 'combat'
    ) {
      // V31修正: 新鮮な警戒(近くの銃声=R16の振り向き調査)を持つbotにはソフト引力を
      // 供給しない(局所反応が戦闘重心への直行に潰されないように。dom等の拠点目標は上で返済済み)
      if (bot.alert > 0 && bot.alertPos) return null;

      // ── 気配システム(P-E): FFA/TDM等の敵bot 60%(uid%5<3)にプレイヤー周辺の気配点を供給 ──
      // 30秒バケット毎の決定論ハッシュ(uid*40503^bucket*7919)でrand非消費。
      // alert優先(上でreturn済み)/combat除外(外側のaiState !== 'combat')/ゾンビ・訓練・ミッション不変。
      // 到達(8m)で同バケット内の気配点を消去 → hotspot/中心散布へfall-through。
      if (bot.team !== PLAYER_TEAM && (bot.uid % 5) < 3) {
        const bucket = Math.floor(this.elapsed / GHOST_REFRESH_S);
        const prevBucket = this.botGhostUpdateBucket.get(bot.uid) ?? -1;
        if (bucket !== prevBucket) {
          // 決定論ハッシュでプレイヤー周辺5-15mの点を計算(rand経路は消費しない)
          const h = (bot.uid * 40503) ^ (bucket * 7919);
          const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
          const t     = ((h >>> 16) & 0xffff) / 0xffff;
          const radius = 5 + t * (GHOST_FUZZ_M - 5); // 5..15m
          const px = this.player.position.x + Math.cos(angle) * radius;
          const pz = this.player.position.z + Math.sin(angle) * radius;
          this.botGhostPos.set(bot.uid, new THREE.Vector3(px, bot.position.y, pz));
          this.botGhostUpdateBucket.set(bot.uid, bucket);
        }
        const ghostTarget = this.botGhostPos.get(bot.uid);
        if (ghostTarget) {
          const dist = bot.position.distanceTo(ghostTarget);
          if (dist > GHOST_ARRIVE_M) {
            return ghostTarget.clone();
          } else {
            // 到達: 同バケット内は通常徘徊へ戻す(bucketは据え置き=再算出しない)
            this.botGhostPos.delete(bot.uid);
          }
        }
      }

      const hotValid =
        Number.isFinite(this.hotspotLastT) && this.elapsed - this.hotspotLastT < HOTSPOT_DECAY_S;
      if (hotValid) {
        const distToHot = bot.position.distanceTo(this.hotspotPos);
        // 到達圏(25m)内はnull=通常の局所徘徊へ戻し、ホットスポット周辺を探索させる
        return distToHot > HOTSPOT_ARRIVE_M ? this.hotspotPos.clone() : null;
      }
      // 戦闘なし時: マップ中心寄りの点への弱い引力(全員が外周で孤立しない)。
      // uid由来の黄金角オフセットで各botの目標点を決定論的に散らし、中心1点への密集を防ぐ
      const halfSize = this.config.stage.size / 2;
      const flatDist = Math.hypot(bot.position.x, bot.position.z);
      if (flatDist > halfSize * 0.45) {
        const a = (bot.uid * 2.399963) % (Math.PI * 2); // 黄金角散布(rand経路は消費しない)
        const r = halfSize * (0.08 + 0.17 * (((bot.uid * 7919) % 97) / 97));
        return new THREE.Vector3(Math.cos(a) * r, bot.position.y, Math.sin(a) * r);
      }
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
    if (this.config.mode !== 'zombie') {
      this.killcam.recordShot(origin, end, bot.team === PLAYER_TEAM ? this.colors.allyTracer : this.colors.enemyTracer, this.elapsed);
    }

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
      // R30 bulletCrack: 1.5m 以内の至近弾にクラック音 + 制圧エンベロープ更新
      if (!hitPlayer && ca.dist < 1.5 && ca.along > 2) {
        const atCrack = origin.clone().addScaledVector(dir, ca.along);
        const wpc = this.panAndDistance(atCrack);
        this.sounds.bulletCrack(wpc.pan, 1 - ca.dist / 1.5);
        const nowSec = this.elapsed;
        this.nearBulletLog.push(nowSec);
        const cutoff = nowSec - 1.2;
        while (this.nearBulletLog.length > 0 && this.nearBulletLog[0]! < cutoff) {
          this.nearBulletLog.shift();
        }
        const n = this.nearBulletLog.length;
        if (n >= 3) {
          this.sounds.suppressionWhoosh(Math.min(1, n / 6));
          this.suppressEnv = Math.min(1, this.suppressEnv + 0.35);
        }
      }
    }
    this.sounds.enemyShot(pan, distance, occluded);

    // ① 戦闘引力: 発砲イベント記録(敵botのみ・ゾンビ除外)
    if (bot.team !== PLAYER_TEAM && this.config.mode !== 'zombie' && !this.mission) {
      this.recordCombatPos(origin);
    }
    // ③ 発砲ブリップ追加(敵botのみ・スロットル0.5s/bot)
    if (bot.team !== PLAYER_TEAM && this.config.mode !== 'zombie' && this.config.mode !== 'training') {
      const lastBlip = this._fireBlipLastT.get(bot.uid) ?? -Infinity;
      if (this.elapsed - lastBlip >= 0.5) {
        this._fireBlipLastT.set(bot.uid, this.elapsed);
        this._fireBlips.push({ x: origin.x, z: origin.z, spawnedAt: this.elapsed, botUid: bot.uid });
      }
    }

    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    const damage = damageAtDistance(tuning.damage, hitToi(hit), BOT_FALLOFF);

    // 戦車の主砲: 着弾点で炸裂し、直撃しなくても至近のプレイヤーへスプラッシュが入る
    if (bot.kind === 'tank' && bot.team !== PLAYER_TEAM) {
      this.effects.explosion(end, 1.5);
      const boom = this.panAndDistance(end);
      this.sounds.explosion(boom.pan, boom.distance);
      const splashD = this.player.alive ? this.player.position.distanceTo(end) : Infinity;
      if (splashD < 3.2 && tag?.kind !== 'player' && this.config.mode !== 'training') {
        const died = this.player.takeDamage(14);
        this.tookDamage = true;
        this.addShake(0.25);
        this.addUltCharge(14 * ULT_ON_DAMAGE_PER_HP);
        this.incoming.push(this.incomingAngle(end));
        this.sounds.hurt();
        this.tracker.onPlayerDamaged();
        this.sounds.playerBodyHit(Math.sin(this.incomingAngle(end)), Math.min(1, 14 / 100));
        // スプラッシュ死も直撃と同じ死亡処理(キルカメラ/死亡音/フィード/キル加算)
        if (died) {
          bot.kills += 1;
          this.addKillScore(bot.team);
          this.spawnPlayerDogTag();
          this.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: '戦車砲', headshot: false });
          this.sounds.death();
          this.notePlayerDeath(bot);
        }
      }
    }

    if (tag?.kind === 'player' && this.player.alive) {
      // 味方の流れ弾はダメージにしない
      if (bot.team === PLAYER_TEAM) return;
      if (this.config.mode === 'training') return;
      const died = this.player.takeDamage(damage);
      this.tookDamage = true;
      this.haptic(110, 0.5, 0.55);
      this.addShake(0.16);
      this.addUltCharge(damage * ULT_ON_DAMAGE_PER_HP);
      this.sounds.hurt();
      this.incoming.push(this.incomingAngle(origin));
      this.tracker.onPlayerDamaged();
      this.sounds.playerBodyHit(Math.sin(this.incomingAngle(origin)), Math.min(1, damage / 100));
      // ① 戦闘引力: 被弾イベント記録
      if (this.config.mode !== 'zombie' && !this.mission) this.recordCombatPos(origin);
      if (died) {
        bot.kills += 1;
        this.addKillScore(bot.team);
        this.spawnPlayerDogTag();
        // ガンゲーム: botがプレイヤーをキルした場合のランク進行
        // V31修正: ランクアップ前に「キルに使った武器名」を取ってからggOnBotKillする(off-by-one解消)
        const ggWepName = this.ggState ? (WEAPON_DEFS[this.ggState.getWeaponIdAt(this.ggState.getBotRank(bot.uid))]?.name ?? 'ボットAR') : 'ボットAR';
        if (this.ggState) this.ggOnBotKill(bot, null);
        this.feed.push({
          killer: bot.name,
          victim: PLAYER_NAME,
          weapon: ggWepName,
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
        this.spawnDogTag(tag.bot);
        // ガンゲーム: bot-bot キルのランク進行(killer rankUp, victim rankDown は近接のみ。bot間は近接なし)
        const ggWepName2 = this.ggState ? (WEAPON_DEFS[this.ggState.getWeaponIdAt(this.ggState.getBotRank(bot.uid))]?.name ?? 'ボットAR') : 'ボットAR';
        if (this.ggState) this.ggOnBotKill(bot, tag.bot);
        this.feed.push({
          killer: bot.name,
          victim: tag.bot.name,
          weapon: ggWepName2,
          headshot: false,
        });
        this.tracker.onFeed(false); // 他者のキルは自分の連続フィード(QuadFeed)を分断する
        this.botDeathFx(tag.bot);
      }
    }
  }

  // キルを取ったチームのスコアを進める。ドミネーション/キルコンファーム/ガンゲームはキル直接加算なし
  private addKillScore(team: TeamId): void {
    if (this.config.mode !== 'dom' && this.config.mode !== 'killconfirm' && this.config.mode !== 'gungame') {
      this.scores.add(team, 1);
    }
  }

  // ── ガンゲーム: プレイヤーがキルを取ったとき ──────────────────────────────────────────
  private ggOnPlayerKill(killedBot: Bot, isMelee: boolean): void {
    if (!this.ggState) return;
    // ランクアップ
    const { newRank, isWin } = this.ggState.playerRankUp();
    this.ggRankUpFlash = true;
    // R53-W3 M3: MK.IIIモーメント(ガンゲームのランク遷移)
    this.moments.push({ kind: 'ggrank', title: String(newRank + 1), sub: 'RANK' });

    // setback: メレーキルされた bot のランクダウン(BO2仕様)
    if (isMelee) {
      this.ggState.botRankDown(killedBot.uid);
      this.ggSetback = true;
      this.announcements.push('SETBACK!');
    }

    // 武器切替(ランク20は fists なのでそのまま)
    // T3: WEAPON_DEFS の生参照ではなく applyAttachments(base, []) のクローンを使う
    // (switchPrimaryWeapon等と同じ流儀。def変異系機能(ext-mag等)がWEAPON_DEFS本体を
    // 書き換えてしまう将来の波及を断つ)
    const newWeaponId = this.ggState.getWeaponIdAt(newRank);
    const newBaseDef = WEAPON_DEFS[newWeaponId] ?? WEAPON_DEFS['kaede-ar']!;
    const newDef = applyAttachments(newBaseDef, []);
    const newWeapon = new Weapon(newDef);
    newWeapon.raise();
    (this.weapons as Weapon[])[0] = newWeapon;
    if (this.activeIndex !== 0) this.activeIndex = 0;
    this.viewModel.setWeapon(newWeapon.def);
    this.adsLatch = false;

    // ランクアップアナウンス
    const rankLabel = `RANK ${newRank}/20 → ${newDef.name}`;
    this.announcements.push(rankLabel);
    this.sounds.announceMedal(1, this.settings.announcerVolume);

    // 勝利判定: ランク20で1キル
    if (isWin) {
      this.over = true;
    }
  }

  // ── ガンゲーム: bot がキルを取ったとき ────────────────────────────────────────────────
  private ggOnBotKill(killer: Bot, _victim: Bot | null): void {
    if (!this.ggState) return;
    const { isWin } = this.ggState.botRankUp(killer.uid);
    if (isWin) {
      this.over = true;
    }
  }

  // killerは敵BOTに倒された場合のみ。自爆や火災ではキルカメラを出さない
  private notePlayerDeath(killer: Bot | null = null): void {
    // P-H確証バグ修正: トグル設定時のラッチが死亡でリセットされず、リスポーン直後に
    // しゃがみ/ADSが継続していた
    this.crouchLatch = false;
    this.adsLatch = false;
    // R53-W3 M3: 死亡で溜め段/ブリンク連携ウィンドウを解除(視覚残留防止)
    this.resetChargeStage();
    this.blinkComboUntil = -Infinity;
    // ★V-D修正: 3連ブリンクのチェーンも死亡でクリア(2連→死亡→即リスポーン1回で
    // 放電ノヴァが早期暴発するのを防ぐ)
    this.blinkChain.length = 0;
    // 訓練場: プレイヤーは無敵なので呼ばれないはずだが念のためガード
    if (this.config.mode === 'training') return;
    this.scoreboardDirty = true; // ★6 デス(相手キル)確定は即時反映
    // BO2 スコアストリーク: 死亡でprogress リセット (バンク保持)
    this.streakManager.onDeath();
    // RC-XD操縦中に死亡した場合は強制終了(本体は無防備という仕様)
    if (this.rcxdActive) this.cancelRcxd();
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
      // ファイナルキルカム: ボットのキルを記録
      if (this.config.mode !== 'zombie') {
        this.killcam.noteKill(false, this.bots.indexOf(killer), -1, this.elapsed);
      }
      this.killcamElapsedS = 0;
      this.killcamArc = 0;
      this.prevKillcamCamActive = false;
      this.killcamSeeded = false; // 現在のカメラ姿勢を一人称からシードし直す
    } else {
      this.killcamWeaponLabel = null;
    }
  }

  // 銃声を「聞かせる」。全周検知にはせず、音源方向への警戒(調査行動)を与える
  // カウンターUAV発動中は警戒伝播半径を半減(本家の敵ミニマップ妨害に相当するbot戦翻案)
  private alertBots(radius: number): void {
    const effectiveRadius = this.cauavTimer > 0 ? radius * 0.5 : radius;
    const pos = this.player.position;
    for (const bot of this.bots) {
      if (bot.alive && bot.team !== PLAYER_TEAM && bot.position.distanceTo(pos) < effectiveRadius) {
        bot.alert = 4;
        bot.alertPos = reuseVec3(bot.alertPos, pos);
      }
    }
  }

  // カメラシェイクのトラウマを加算する(0..1で頭打ち)
  private addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  // 撃破時のチーム色バースト演出
  private botDeathFx(bot: Bot, weaponClass?: string): void {
    const color = bot.team === PLAYER_TEAM ? this.colors.ally : this.colors.enemy;
    const point = bot.position.clone();
    point.y += 0.4;
    this.effects.deathBurst(point, color);
    if (!this.killcamCamActive) {
      this.effects.botDeathFxByClass(point, color, weaponClass ?? 'rifle', this.settings.reduceMotion);
    }
  }

  private addUltCharge(amount: number): void {
    this.ultCharge = Math.min(1, this.ultCharge + amount);
  }

  // アルティメットの充填・発動・オーバードライブ持続。player.update前に呼ぶ
  private updateUltimate(dt: number): void {
    // ガンゲーム: ウルト無効(純粋な銃勝負)
    if (this.config.mode === 'gungame') return;
    // V31修正: RC-XD操縦中は本体からのウルト発動を封じる(視点と発生位置が乖離するため)
    if (this.rcxdActive) return;
    // 死亡中はオーバードライブを終了し、バフを残さない(ゲージ自体は維持)。
    // 落下死などnotePlayerDeathを通らない経路も含めて確実に解除する。
    // 黒帝モードは死亡で解除しない(解除条件は300秒経過 or 試合終了のみ。
    // タイマー減算は updateDarkEmperor が死亡ゲート外で継続する)
    if (!this.player.alive) {
      this.ultActive = 0;
      this.player.speedMul = this.zombiePerkMoveMul;
      this.player.damageResist = 0;
      return;
    }

    this.ultCharge = Math.min(1, this.ultCharge + dt * ULT_PASSIVE_PER_S);
    // 訓練場: ウルトは常に即満タン(練習用)
    if (this.config.mode === 'training') this.ultCharge = 1;

    // M(ult4)はゲージ状態に関係なく毎フレーム1回だけ読む(wasPressed は消費型のため
    // 二重読みは不可)。即時動作はゲージ満タン時のみだが、triple-M の連打カウントは
    // 2押し目以降ゲージ 0 でも継続する必要がある(1押し目の発動で全消費されるため)。
    // killcam/alive/fists ガードは従来の ult4 経路と同一(alive は本メソッド冒頭で return 済み)。
    const mPressed = this.isNinja && this.input.wasPressed('ult4') && !this.killcamCamActive;
    const nPressed = this.isNinja && this.input.wasPressed('ult3') && !this.killcamCamActive;
    const isExoticEquipped = !this.isNinja && this.activeWeapon.def.class === 'exotic';
    const exoticMPressed = isExoticEquipped && this.input.wasPressed('ult4') && !this.killcamCamActive;
    let nUltFired = false;
    let mUltFired = false;

    if (this.ultCharge >= 1 && this.ultActive <= 0 && !this.cooking) {
      if (this.input.wasPressed('ultimate')) {
        this.activateUltimate();
      } else if (this.isNinja && this.input.wasPressed('ult2')) {
        // B: 風神・極大手裏剣(fists装備時のみ。ゲージ全消費)
        this.activateWindShuriken();
      } else if (nPressed) {
        nUltFired = true;
        if (this.raiteiMode) {
          // N: 雷帝中→月花雷轟(マップ全域嵐)
          this.activateGeppaRaigou();
        } else {
          // N: 雷帝・神獣降臨(初回 → raiteiMode 永続化)
          this.activateLightningBeast();
        }
      } else if (mPressed) {
        // M: 通常動作を即時発動(入力遅延ゼロ)。黒雷帝化は registerMPress が追加発動する
        mUltFired = true;
        if (this.kokuraiteiMode) {
          // M: 黒雷帝中→極雷絶滅
          this.activateGokuraiZetsumetsu();
        } else if (this.darkEmperorTimer > 0) {
          // M: 黒帝中→真月
          this.activateShingetsu();
        } else {
          // M: シュヴァルツヴァルト
          this.activateSchwarzwald();
        }
      } else if (exoticMPressed) {
        this.activateExoticUlt(this.activeWeapon.def.id);
      }
    }
    // triple-M 黒雷帝化: 1.5s 内の3押し(1押し目がウルト発動済み=armed)で追加発動
    if (mPressed) this.registerMPress(mUltFired);
    // triple-N 黒雷帝化(黒帝中限定): 黒帝になるとMは真月に取られるため、Nの3連打でも到達できる救済経路
    if (nPressed && this.darkEmperorTimer > 0 && !this.kokuraiteiMode) this.registerNPress(nUltFired);

    // ③ 黒雷帝バフ: 移動+15% / 被ダメ-30%。ult上書きと非衝突(乗算スタック)
    const kokuraiSpeedMul = this.kokuraiteiMode ? KOKURAITEI_SPEED_MUL : 1;
    const kokuraiResist = this.kokuraiteiMode ? KOKURAITEI_DAMAGE_RESIST : 0;
    const shuraKourinSpeedMul = this.shuraKourinTimer > 0 ? 1.3 : 1; // 阿修羅降臨: 移動+30%
    if (this.ultActive > 0) {
      this.ultActive = Math.max(0, this.ultActive - dt);
      this.player.speedMul = OVERDRIVE_SPEED_MUL * this.zombiePerkMoveMul * kokuraiSpeedMul * shuraKourinSpeedMul;
      this.player.damageResist = Math.max(OVERDRIVE_RESIST, kokuraiResist);
    } else {
      this.player.speedMul = this.zombiePerkMoveMul * kokuraiSpeedMul * shuraKourinSpeedMul;
      this.player.damageResist = kokuraiResist;
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
    // コンボ進行(0.8s窓=rpm480の連撃に合わせて延長)。スライドキックは常に最終段扱い
    this.punchStep = this.player.sliding ? 3 : this.punchWindowS > 0 ? Math.min(this.punchStep + 1, 3) : 1;
    this.punchWindowS = 0.8;
    const darkMul = this.darkEmperorTimer > 0 ? DARK_EMPEROR_MUL_MELEE : 1;
    const dmg = (this.punchStep >= 3 ? 90 : this.punchStep === 2 ? 63 : 45) * darkMul;

    // 3連モーション巡回(右薙ぎ→左薙ぎ→突き)。スライドキックは突き固定
    const motion = this.player.sliding ? 2 : this.punchMotion;
    if (!this.player.sliding) this.punchMotion = (this.punchMotion + 1) % 3;
    // R45a: 黒帝/黒雷帝中は暗黒斬撃音
    if (this.darkEmperorTimer > 0) {
      this.sounds.kunaiSlashDark(motion);
    } else {
      this.sounds.kunaiSlash(motion);
    }
    this.viewModel.fire(false, false, motion); // 斬りの振り抜きアニメ(モーション別・マズルフラッシュなし)
    this.addShake(this.punchStep >= 3 ? 0.08 : 0.03);
    // 静かな攻撃: 銃声アラートは出さず、至近の敵だけが気づく
    this.alertBots(5);

    // 前方の広いコーン内の敵を「複数まとめて」斬る(薙ぎ払い)。リーチは機体の大きさで補正
    // (戦車は車体が巨大なので中心距離では密着しても届かないため)。
    // 黒帝モード中: 黒刀への変形に合わせてリーチを 7.0m へ拡大、コーンも 0.22 へ広げる。
    const isDark = this.darkEmperorTimer > 0;
    const baseReach = isDark ? 7.0 : DAGGER_MELEE_RANGE;
    const meleeCone = isDark ? 0.22 : DAGGER_MELEE_CONE;
    const eye = this.player.eyePosition;
    const fwd = this.cameraForward();
    let hitAny = false;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const reach = baseReach + (bot.kind === 'tank' ? 2.2 : bot.kind === 'turret' ? 0.5 : 0);
      const to = bot.position.sub(eye);
      const dist = to.length();
      if (dist > reach) continue;
      to.normalize();
      if (fwd.dot(to) < meleeCone) continue;
      // 遮蔽判定: 薄い壁・コンテナ越しに斬れないようにする(handleMeleeと同じ流儀)
      const hit = this.castRay(eye, to, dist - 0.1, this.player.body);
      if (hit) {
        const tag = this.tags.get(hit.collider.handle);
        if (!(tag?.kind === 'bot' && tag.bot === bot)) continue;
      }
      const point = bot.position;
      point.y += 0.3;
      // R53-W3 M3: 雷転斬 — ブリンク後0.6s内の近接ヒットは×1.5+専用スパークFX
      // (帝王状態限定。ウィンドウは最初のヒットで消費=1回だけの読み合い)
      let hitDmg = dmg;
      if (this.elapsed < this.blinkComboUntil && this.activeKit() !== 'none') {
        this.blinkComboUntil = -Infinity;
        hitDmg = Math.round(dmg * 1.5);
        this.effects.raitenSlashFx(point.clone());
        this.announcements.push('雷転斬');
      }
      // weaponName '近接' で既存の近接メダル/チャレンジ経路に乗る
      this.applyBotDamage(bot, hitDmg, point, false, '近接');
      hitAny = true;
    }
    if (hitAny) {
      this.sounds.punchHit(this.punchStep); // A4-F07: コンボステップ連動の打撃音
      this.haptic(70, 0.4, 0.5);
    }

    // ── kit 排他: kokuraitei > dark(timer>0) > raitei ──
    const kit = this.activeKit();
    if (kit === 'dark' || kit === 'kokuraitei') {
      // 黒帝/黒雷帝: 視線方向へ黒い斬撃波を発射
      // tilt=0=水平(右薙ぎ/左薙ぎ)、tilt=π/2=垂直(突き)
      const slashTilt = motion === 2 ? Math.PI / 2 : 0;
      this.spawnDarkSlashWave(slashTilt);
    }
    // 雷帝/黒雷帝: 各スウィングに AoE 雷撃を追加(dark のみでは出さない)
    if ((kit === 'raitei' || kit === 'kokuraitei') && this.player.alive) {
      this.spawnLightningAoE(LIGHTNING_AOE_RADIUS);
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
    const isDarkMode = this.darkEmperorTimer > 0;
    const blinkRange = isDarkMode ? DARK_BLINK_RANGE : BLINK_RANGE;
    const blinkDmg = BLINK_DAMAGE * (isDarkMode ? DARK_EMPEROR_MUL_BLINK : 1);
    const blinkColor = isDarkMode ? DARK_EMPEROR_COLOR : this.activeWeapon.def.tracerColor;

    // 進行方向は視線の水平成分。真上/真下を向いていても水平の一貫した方向を確保する
    const dir = this.cameraForward().setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    dir.normalize();

    const start = this.player.position; // body中心(fresh vector)
    // 壁の手前で停止(壁抜け防止)。V18修正: 敵が壁の手前に立つと最近接ヒットが敵になり壁を
    // 見逃して7m貫通・場外テレポートしていた。filterPredicateでワールドgeometryのみを対象に
    // レイキャストし、敵の背後にある壁でも確実に手前停止させる。
    // boundary(ghost壁)もブリンク停止に含める(境界エスケープ防止は絶対維持)。
    const hit = this.castRay(
      start,
      dir,
      blinkRange + CAPSULE_RADIUS,
      this.player.body,
      (c) => { const k = this.tags.get(c.handle)?.kind; return k === 'world' || k === 'boundary'; },
    );
    let dist = blinkRange;
    if (hit) dist = Math.max(0, hitToi(hit) - CAPSULE_RADIUS - 0.05);
    const end = start.clone().addScaledVector(dir, dist);

    // 三日月斬撃+並行ゴースト残像+着地点の小衝撃リング+抜刀音
    const eyeY = this.player.eyePosition.y;
    const blinkMid = new THREE.Vector3((start.x + end.x) / 2, eyeY, (start.z + end.z) / 2);
    this.effects.crescentSlash(blinkMid, dir, blinkColor);
    this.effects.blinkGhosts(
      new THREE.Vector3(start.x, eyeY - 0.1, start.z),
      new THREE.Vector3(end.x, eyeY - 0.1, end.z),
      blinkColor,
    );
    this.effects.impactRing(
      new THREE.Vector3(end.x, start.y - PLAYER_FEET_OFFSET + 0.05, end.z),
      blinkColor,
    );
    // R45a: 黒帝中はブリンク斬撃音も暗黒バリアント
    if (this.darkEmperorTimer > 0) {
      this.sounds.kunaiSlashDark(2);
    } else {
      this.sounds.kunaiSlash(2); // 突き音=ブリンクの刺突
    }
    this.sounds.punchHit(3); // A4-F07: ブリンクは常に最終段の重打音
    this.tracker.onBlink(); // R45a
    this.lastBlinkElapsed = this.elapsed; // R45a
    // R33 黒雷帝中: 雷転移エフェクト(消失点バースト + 出現点着地ボルト + 移動残光ライン)
    if (this.kokuraiteiMode) {
      const departPos = new THREE.Vector3(start.x, start.y - PLAYER_FEET_OFFSET + 0.05, start.z);
      const arrivePos = new THREE.Vector3(end.x, end.y - PLAYER_FEET_OFFSET + 0.05, end.z);
      this.effects.kokuraiBlinkDepart(departPos);
      this.effects.kokuraiBlinkArrive(arrivePos);
      this.effects.kokuraiBlinkResidual(
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(end.x, end.y, end.z),
      );
      this.sounds.kokuraiBlinkTeleport();
    } else if (this.raiteiMode) {
      // 雷帝中: 氷青版の電撃(消失点小ボルト + 出現点地這い電撃)
      const departPos = new THREE.Vector3(start.x, start.y - PLAYER_FEET_OFFSET + 0.05, start.z);
      const arrivePos = new THREE.Vector3(end.x, end.y - PLAYER_FEET_OFFSET + 0.05, end.z);
      this.effects.raiteiBlinkDepart(departPos);
      this.effects.raiteiBlinkArrive(arrivePos);
      this.sounds.raiteiBlinkTeleport();
    }
    this.addShake(0.12);
    this.haptic(90, 0.5, 0.6);
    this.alertBots(6);
    this.viewModel.fire(false, false, 2);
    // R53-W3 M3: ブリンク連携(帝王状態限定) — 雷転斬ウィンドウ0.6s+3s内3連で自動放電ノヴァ
    if (this.activeKit() !== 'none') {
      this.blinkComboUntil = this.elapsed + 0.6;
      this.blinkChain.push(this.elapsed);
      while (this.blinkChain.length > 0 && this.blinkChain[0]! < this.elapsed - 3) this.blinkChain.shift();
      if (this.blinkChain.length >= 3) {
        this.blinkChain.length = 0;
        const novaPos = new THREE.Vector3(end.x, end.y, end.z);
        this.effects.blinkDischargeNova(novaPos);
        this.sounds.lightningStrikeAoE(true);
        this.addShake(this.settings.reduceMotion ? 0.25 : 0.6);
        this.announcements.push('雷連環・放電');
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          if (bot.position.distanceTo(novaPos) > 8) continue;
          const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
          this.applyBotDamage(bot, 150, point, false, '雷連環・放電', false);
        }
      }
    }

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
      this.applyBotDamage(bot, blinkDmg, point, false, 'ブリンク斬撃');
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
    const isDarkMode = this.darkEmperorTimer > 0;
    const slamMul = isDarkMode ? DARK_EMPEROR_MUL_SLAM : 1;
    this.effects.explosion(ground, radius * 0.55);
    // 神化演出: 地を走るリング+放射クラック+小型土煙+飛散火花(判定は不変)
    this.effects.shockwaveRing(ground, radius, isDarkMode ? DARK_EMPEROR_COLOR : this.colors.ally);
    this.effects.smokeCloud(ground, radius * 0.4, 0.6);
    this.effects.slamSparks(ground, this.activeWeapon.def.tracerColor);
    if (isDarkMode) {
      this.effects.darkSmokeEmit(ground);
      this.effects.darkSmokeEmit(new THREE.Vector3(ground.x + 0.5, ground.y, ground.z));
      this.effects.darkSmokeEmit(new THREE.Vector3(ground.x - 0.5, ground.y, ground.z + 0.5));
    }
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
      const scaledFinal = scaled * slamMul;
      // アルティメット同様、スラムキルでのアルト自己充填はしない
      this.applyBotDamage(bot, scaledFinal, bot.position, false, 'ダイブスラム', false);
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
    this.tracker.onUltActivate('f'); // R45a
    const center = this.player.position;
    // 演出はカメラの内側で生成すると裏面カリングで消えるため、足元の地面で炸裂
    // させて衝撃波・土煙が周囲に広がって見えるようにする。画面側の閃光はHUDが
    // ultActiveの立ち上がりから出す(reduceMotion尊重)。判定は胴中心のまま
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    this.effects.explosion(ground, SLAM_RADIUS * 0.6);
    this.effects.deathBurst(ground, this.colors.ally);
    this.effects.overdriveActivateAura(ground);
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
    this.tracker.onUltActivate('f'); // R45a
    const center = this.player.position;
    const darkBoost = this.darkEmperorTimer > 0 ? DARK_EMPEROR_MUL_ULTS : 1;
    // 演出はカメラ内側だと裏面カリングで消えるため、足元の地面で炸裂させて衝撃波を広げる
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    this.effects.explosion(ground, NINJA_ULT_RADIUS * 0.6);
    this.effects.deathBurst(ground, this.colors.ally);
    // 地を走る拡大リング+放射クラック+刃閃で「大破斬」を上積み(演出層のみ・判定不変)
    this.effects.shockwaveRing(ground, NINJA_ULT_RADIUS, this.colors.ally);
    if (!this.settings.reduceMotion) this.effects.fissureGlow(ground, NINJA_ULT_RADIUS);
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
      const scaled = NINJA_ULT_DAMAGE * darkBoost * (1 - (dist / NINJA_ULT_RADIUS) * 0.4); // 中心ほど痛い
      // ウルト同様、衝撃波キルでのアルト自己充填はしない(自己還元の連鎖を防ぐ)
      this.applyBotDamage(bot, scaled, bot.position, false, 'グラビティスラム', false);
    }
  }

  // ── 風神・極大手裏剣(B ウルト) ──────────────────────────────
  // 特大の4枚刃風手裏剣を正面へ発射。直進45m・経路半径3m内の敵へ400ダメージ(貫通・
  // 1体1ヒット)。トレイルは風の光跡、終端で爆発演出。全メッシュはper-call生成→
  // 到達/破棄時に確実にdisposeする(HKエンティティと同じ流儀)。
  private activateWindShuriken(): void {
    if (this.windShuriken) return; // 飛行中の二重発動は不可(ゲージも消費しない)
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.tracker.onUltActivate('b'); // R45a

    // 発射方向は視線の水平成分(ブリンクと同じ流儀)
    const dir = this.cameraForward().setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    dir.normalize();

    const group = new THREE.Group();
    const mats: THREE.Material[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const bladeColor = this.activeWeapon.def.tracerColor;
    // 4枚刃スター(薄板2.2mを45°刻みで重ねる)
    for (let i = 0; i < 4; i += 1) {
      const geo = new THREE.BoxGeometry(0.15, 2.2, 0.03);
      const mat = new THREE.MeshBasicMaterial({
        color: bladeColor,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const blade = new THREE.Mesh(geo, mat);
      blade.rotation.z = (i / 4) * Math.PI;
      group.add(blade);
      geos.push(geo);
      mats.push(mat);
    }
    // 中心コア(白の発光球)
    const coreGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(coreGeo, coreMat));
    geos.push(coreGeo);
    mats.push(coreMat);

    const startPos = this.player.position; // fresh vector(body中心)
    startPos.y += 0.2;
    group.position.copy(startPos);
    // 刃面を進行方向へ立てる(スピンはX軸回転で見せる)
    group.rotation.y = Math.atan2(dir.x, dir.z);
    this.scene.add(group);

    this.windShuriken = {
      mesh: group,
      mats,
      geos,
      pos: startPos.clone(),
      dir: dir.clone(),
      traveled: 0,
      hitSet: new Set<number>(),
      trailTimer: 0,
    };

    this.sounds.kunaiWindShuriken();
    this.addShake(this.settings.reduceMotion ? 0.1 : 0.3);
    this.haptic(160, 0.6, 0.8);
    this.announcements.push('風神・極大手裏剣');
    this.alertBots(30);
  }

  // 風神手裏剣の毎フレーム更新(移動・スピン・トレイル・経路ヒット・終端処理)
  private updateWindShuriken(dt: number): void {
    const s = this.windShuriken;
    if (!s) return;

    const SHURIKEN_SPEED = 35; // m/s(45mを約1.3秒で駆け抜ける)
    const SHURIKEN_RANGE = 45;
    const SHURIKEN_RADIUS = 3.0;
    const SHURIKEN_DAMAGE = 400 * (this.darkEmperorTimer > 0 ? DARK_EMPEROR_MUL_ULTS : 1);

    const move = SHURIKEN_SPEED * dt;
    s.pos.addScaledVector(s.dir, move);
    s.traveled += move;
    s.mesh.position.copy(s.pos);
    s.mesh.rotation.x += dt * 18; // 高速スピン

    // 風の螺旋トレイル(0.06s周期の短命トレーサー) + モーションブレード残像
    s.trailTimer += dt;
    if (s.trailTimer > 0.06) {
      s.trailTimer = 0;
      const phase = s.traveled * 2.2;
      const perp = new THREE.Vector3(-s.dir.z, 0, s.dir.x);
      const off = perp.clone().multiplyScalar(Math.cos(phase) * 0.6);
      off.y = Math.sin(phase) * 0.6;
      this.effects.tracer(
        s.pos.clone().add(off),
        s.pos.clone().sub(off),
        this.activeWeapon.def.tracerColor,
      );
      this.effects.shurikenMotionBlade(s.pos.clone(), s.dir.clone(), this.activeWeapon.def.tracerColor);
    }

    // 経路ヒット(貫通・1体1回)。水平3m筒+高さ±2.5mの寛容判定
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (s.hitSet.has(bot.uid)) continue;
      const bp = bot.position;
      const dx = bp.x - s.pos.x;
      const dz = bp.z - s.pos.z;
      if (dx * dx + dz * dz > SHURIKEN_RADIUS * SHURIKEN_RADIUS) continue;
      if (Math.abs(bp.y - s.pos.y) > 2.5) continue;
      s.hitSet.add(bot.uid);
      const point = new THREE.Vector3(bp.x, bp.y + 0.3, bp.z);
      // ウルト系はキルでのゲージ自己充填をしない(既存流儀)
      this.applyBotDamage(bot, SHURIKEN_DAMAGE, point, false, '風神手裏剣', false);
      this.effects.hitPuff(point);
    }

    // 射程到達で終端爆発→確実にdispose
    if (s.traveled >= SHURIKEN_RANGE) {
      this.scene.remove(s.mesh);
      for (const g of s.geos) g.dispose();
      for (const m of s.mats) m.dispose();
      this.windShuriken = null;
      this.effects.explosion(s.pos, 2.5);
    }
  }

  // ── 雷帝・神獣降臨(N ウルト) ──────────────────────────────
  // 3秒の天変地異: 画面フラッシュ→周囲14mへジグザグ落雷連打(0.1s周期)→雷の麒麟が
  // 前方へ疾走→0.5s周期の波状ダメージ(6波×80≈480)。全メッシュは3秒で確実にdispose。
  private activateLightningBeast(): void {
    if (this.lightningBeastTimer > 0) return; // 発動中の重ね掛け不可
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.lightningBeastTimer = 3.0;
    this.lightningBeastDamageTimer = 0;
    this.lightningBeastArcTimer = 0;
    this.lightningKirinFootTimer = 0;

    // 雷の麒麟: ワイヤーフレーム加算Boxで組む発光四足獣(胴+首頭+双角+4脚+尾)
    const kirin = new THREE.Group();
    const kMats: THREE.Material[] = [];
    const kGeos: THREE.BufferGeometry[] = [];
    const addPart = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      color: number,
    ): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        wireframe: true, // エッジ発光のシルエット(面を塗らない)
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      kirin.add(mesh);
      kGeos.push(g);
      kMats.push(m);
    };
    const kBlue = 0x88ddff;
    addPart(0.5, 0.6, 2.0, 0, 0.8, 0, kBlue); // 胴体
    addPart(0.25, 0.8, 0.3, 0, 1.4, -0.9, 0xffffff); // 首+頭
    addPart(0.06, 0.4, 0.06, 0.15, 2.0, -0.9, 0xffffff); // 右角
    addPart(0.06, 0.4, 0.06, -0.15, 2.0, -0.9, 0xffffff); // 左角
    for (let leg = 0; leg < 4; leg += 1) {
      const lx = leg < 2 ? 0.28 : -0.28;
      const lz = leg % 2 === 0 ? -0.6 : 0.6;
      addPart(0.12, 0.75, 0.12, lx, 0.4, lz, kBlue); // 4本脚(children[4..7])
    }
    addPart(0.08, 0.08, 0.7, 0, 0.9, 0.9, kBlue); // 尾

    // 視線の水平前方へ疾走させる(約20m/3s=尾を引いて駆け抜ける)
    const kDir = this.cameraForward().setY(0);
    if (kDir.lengthSq() < 1e-4) kDir.set(0, 0, -1);
    kDir.normalize();
    this.lightningKirinDir.copy(kDir);
    const center = this.player.position;
    this.lightningKirinPos.copy(center).addScaledVector(kDir, 2);
    this.lightningKirinPos.y = center.y - PLAYER_FEET_OFFSET;
    kirin.position.copy(this.lightningKirinPos);
    kirin.rotation.y = Math.atan2(kDir.x, kDir.z);
    this.scene.add(kirin);
    this.lightningKirinMesh = kirin;
    this.lightningKirinMats = kMats;
    this.lightningKirinGeos = kGeos;

    // 画面フラッシュ+強シェイク(reduceMotionでは大幅減)
    if (this.settings.reduceMotion) {
      this.whiteout = Math.max(this.whiteout, 0.25);
      this.addShake(0.3);
    } else {
      this.whiteout = Math.max(this.whiteout, 0.85);
      this.addShake(1.0);
    }
    this.sounds.kunaiLightningBeast();
    this.haptic(300, 0.9, 1.0);
    this.announcements.push('雷帝・神獣降臨');
    this.alertBots(40);
    // 雷帝モード永続化
    this.raiteiMode = true;
    this.viewModel.setKunaiLightningMode(true);
    this.sounds.setLightningHum(true);
    this.sounds.setRaiteiAura(true); // R45a
    this.tracker.onUltActivate('n'); // R45a
    // R53-W3 M3: 帝王モーメント+BGM転調(黒雷帝が優先=既に降臨済みなら上書きしない)
    if (!this.kokuraiteiMode) {
      this.moments.push({ kind: 'emperor', title: '雷帝', tone: 'ice' });
      this.sounds.setEmperorBgm(this.darkEmperorTimer > 0 ? 'dark' : 'raitei');
    }
  }

  // ── 黒技・シュヴァルツヴァルト(M ウルト: fists装備時のみ) ──
  // ゲージ全消費。アリーナ全域の敵に遮蔽無視の超絶ダメージ + 300秒の黒帝モード起動。
  // killcam中は発動不可(既存ウルト規約に従う)。
  private activateSchwarzwald(): void {
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.darkEmperorTimer = DARK_EMPEROR_DURATION;
    this.darkSmokeTimer = 0;

    const center = this.player.position;
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);

    // 発動演出: 一瞬の暗転 + 暗黒ノヴァ + 暗黒逆流 + 強シェイク
    this.effects.darkNova(ground, 14, this.settings.reduceMotion ? 0.5 : 1);
    this.effects.schwarzwaldAbsorb(ground, this.settings.reduceMotion);
    this.sounds.schwarzwald();
    this.sounds.setDarkEmperorAura(true); // R45a
    this.addShake(this.settings.reduceMotion ? 0.35 : 1.1);
    this.haptic(400, 1.0, 1.0);
    this.announcements.push('黒帝・シュヴァルツヴァルト');
    this.alertBots(60); // 全域に銃声情報を伝播

    // アリーナ全域の敵を全消費(遮蔽無視=究極技の特権)
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, SCHWARZWALD_DAMAGE, point, false, '黒技・シュヴァルツヴァルト', false);
    }

    // 黒帝モード起動: viewModel の常時黒オーラを点灯(setKunaiDarkMode 契約)
    this.viewModel.setKunaiDarkMode(true);
    // R53-W3 M3: 帝王モーメント+BGM転調(黒雷帝が優先)
    if (!this.kokuraiteiMode) {
      this.moments.push({ kind: 'emperor', title: '黒帝', tone: 'violet' });
      this.sounds.setEmperorBgm('dark');
    }
  }

  // M ウルト3連押し(1.5s内)の検出: 通常動作(シュヴァルツヴァルト/真月/極雷絶滅)の
  // 即時発動とは独立に押下時刻を数え、3押し目で黒雷帝モードを「追加」発動する。
  // armed 条件: 窓内の1押し目が実際にウルトを発動していた(=ゲージ満タンだった)こと。
  // 2押し目以降はゲージ 0 でも数える(1押し目の発動で全消費されるため)。
  // 追加のゲージ消費はなく、既に黒雷帝なら activateKokuraitei 冒頭ガードで何もしない。
  // 黒帝中の N 3連打(1.5s窓)で黒雷帝化。M側と同じ armed 規約(1押し目が実発動していること)
  private nPressTimestamps: number[] = [];
  private nTripleArmed = false;

  private registerNPress(ultFired: boolean): void {
    const now = this.elapsed;
    this.nPressTimestamps = this.nPressTimestamps.filter((t) => now - t <= 1.5);
    if (this.nPressTimestamps.length === 0) this.nTripleArmed = false;
    this.nPressTimestamps.push(now);
    if (this.nPressTimestamps.length === 1) this.nTripleArmed = ultFired;
    if (this.nPressTimestamps.length >= 3) {
      const armed = this.nTripleArmed;
      this.nPressTimestamps = [];
      this.nTripleArmed = false;
      if (armed) this.activateKokuraitei();
    }
  }

  private registerMPress(ultFired: boolean): void {
    const now = this.elapsed;
    // 1.5s より古いスタンプを除去。窓が切れていたら armed 状態もリセット
    this.mPressTimestamps = this.mPressTimestamps.filter((t) => now - t <= 1.5);
    if (this.mPressTimestamps.length === 0) this.mTripleArmed = false;
    this.mPressTimestamps.push(now);
    if (this.mPressTimestamps.length === 1) this.mTripleArmed = ultFired;
    if (this.mPressTimestamps.length >= 3) {
      const armed = this.mTripleArmed;
      this.mPressTimestamps = [];
      this.mTripleArmed = false;
      if (armed) this.activateKokuraitei();
    }
  }

  // 黒雷帝モード永続化(triple-M からの追加発動専用)。
  // ゲージは1押し目の通常ウルトで消費済みのため、ここでは追加消費しない。
  private activateKokuraitei(): void {
    if (this.kokuraiteiMode) return; // 再入は no-op
    this.kokuraiteiMode = true;
    // 降臨の見得: 紫電リング+周囲に黒雷ボルト(タイムスロー代替)
    const kokuraiGround = this.player.position.clone();
    kokuraiGround.y -= PLAYER_FEET_OFFSET - 0.05;
    this.effects.kokuraiteiActivateFlash(kokuraiGround, this.settings.reduceMotion);
    // 黒帝モードも永続化
    this.darkEmperorTimer = Infinity;
    this.darkSmokeTimer = 0;
    this.viewModel.setKunaiDarkMode(true);
    this.viewModel.setKunaiLightningMode(true, true);
    this.sounds.setLightningHum(true);
    this.sounds.startKokuraiThunder(); // R33: 遠雷アンビエンス開始
    // R33: 発動黒転ビネットスパイク(0.6s)
    this.kokuraiBlackInTimer = 0.6;
    const center = this.player.position;
    const ground = new THREE.Vector3(center.x, center.y - PLAYER_FEET_OFFSET, center.z);
    // ③ 発動演出: 暗黒ノヴァ + 暗黒逆流 + 超強シェイク
    this.effects.darkNova(ground, 14, this.settings.reduceMotion ? 0.5 : 1);
    this.effects.schwarzwaldAbsorb(ground, this.settings.reduceMotion);
    this.sounds.kokuraiWorldBreathe(); // R45a: 黒雷帝固有降臨サウンド
    this.sounds.setDarkEmperorAura(true); // R45a
    this.addShake(this.settings.reduceMotion ? 0.6 : 1.8); // 強化: 0.4/1.2 → 0.6/1.8
    this.haptic(600, 1.0, 1.0); // 強振動
    this.announcements.push('黒雷帝、降臨');
    this.sounds.announceStreak('黒雷帝、降臨', this.settings.announcerVolume);
    this.alertBots(60);
    // R53-W3 M3: 「世界が変わる」降臨 — モーメント/BGM転調/敵の怯え/空の黒転開始
    this.moments.push({ kind: 'emperor', title: '黒雷帝', tone: 'violet' });
    this.sounds.setEmperorBgm('kokuraitei');
    this.applyEmperorFear(this.player.position, 30);
    this.beginKokuraiSkyTurn();
    // 全域敵に黒帝ダメージ
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, SCHWARZWALD_DAMAGE, point, false, '黒技・黒雷帝降臨', false);
    }
  }

  // R53-W3 M3: 帝威の怯え — 中心から radius 内の敵へ applyFear(bot.ts契約:
  // humanoid系=後退+命中率低下1.2〜2.0s / zombie=0.4s硬直)。boss/turretは怯えない威厳を残す
  private applyEmperorFear(center: THREE.Vector3, radius: number): void {
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (bot.tier === 'boss' || bot.kind === 'turret') continue;
      if (bot.position.distanceTo(center) > radius) continue;
      bot.applyFear(bot.kind === 'zombie' ? 0.4 : 1.2 + Math.random() * 0.8);
    }
  }

  // R53-W3 M3: 可視空の黒転(黒雷帝の特権)。envSky/IBLは不可侵(鉄則) — applySkyの
  // uniform化された可視空のみを (0.16,0.5)→(0.06,0.3) へ遷移させ、fogも紫黒へ寄せる。
  // reduceMotionは即時遷移(updateKokuraiSkyTurnがlerpを担う)
  private kokuraiSkyTurn01 = 0; // 0=通常空, 1=黒転完了
  private visibleSkyUniforms: { uSkyScale: { value: number }; uSkyClamp: { value: number } } | null = null;

  // 可視空の減光uniformを直接更新(黒雷帝の黒転専用。envSkyには一切触れない)
  private setVisibleSkyDim(scale: number, clampMax: number): void {
    if (!this.visibleSkyUniforms) return;
    this.visibleSkyUniforms.uSkyScale.value = scale;
    this.visibleSkyUniforms.uSkyClamp.value = clampMax;
  }
  private beginKokuraiSkyTurn(): void {
    if (this.scene.fog instanceof THREE.FogExp2 && !this.skyFogBase) {
      this.skyFogBase = { color: this.scene.fog.color.getHex(), density: this.scene.fog.density };
    }
    if (this.settings.reduceMotion) this.kokuraiSkyTurn01 = 1; // 即時(脈動なしの一方向契約)
  }

  // ★V-D修正: 黒転完了後(t=1)の毎フレーム再適用を settled フラグで停止(他システムは
  // fog/可視空uniformを毎フレーム触らないため、完了後の再適用自体が冗長だった)
  private kokuraiSkySettled = false;

  private updateKokuraiSkyTurn(dt: number): void {
    if (!this.kokuraiteiMode) return;
    if (this.kokuraiSkyTurn01 >= 1) {
      if (!this.kokuraiSkySettled) {
        this.applyKokuraiSkyValues(1);
        this.kokuraiSkySettled = true;
      }
      return;
    }
    this.kokuraiSkyTurn01 = Math.min(1, this.kokuraiSkyTurn01 + dt / 1.2); // 1.2sで完了
    this.applyKokuraiSkyValues(this.kokuraiSkyTurn01);
  }

  private applyKokuraiSkyValues(t: number): void {
    // 可視空: scale 0.16→0.06 / clamp 0.5→0.3(bloom閾値0.9より十分下=白飛び安全)
    this.setVisibleSkyDim(
      THREE.MathUtils.lerp(0.16, 0.06, t),
      THREE.MathUtils.lerp(0.5, 0.3, t),
    );
    if (this.scene.fog instanceof THREE.FogExp2 && this.skyFogBase) {
      // ★V-D修正: per-frameアロケ排除(黒転lerp中の毎フレーム new THREE.Color ×2 → スクラッチ)
      KOKURAI_FOG_SCRATCH.set(this.skyFogBase.color);
      this.scene.fog.color.copy(KOKURAI_FOG_SCRATCH).lerp(KOKURAI_FOG_TARGET, t);
      this.scene.fog.density = this.skyFogBase.density * (1 + 0.15 * t);
    }
  }

  // 月花雷轟: N ウルト(雷帝中)。演出中の再入は不可(ゲージも消費しない)
  private activateGeppaRaigou(): void {
    if (this.geppaRaigouTimer > 0) return;
    this.tracker.onUltActivate('n'); // R45a
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.geppaRaigouTimer = 4.0;
    this.geppaRaigouDmgTimer = 0;
    const center = this.player.position;
    const stageR = (this.config.stage.size ?? 100) * 0.7;
    this.effects.geppaRaigouStorm(center, stageR, 4.0, this.settings.reduceMotion);
    this.sounds.geppaRaigou();
    this.addShake(this.settings.reduceMotion ? 0.5 : 1.5);
    this.haptic(400, 1.0, 1.0);
    this.announcements.push('月花雷轟');
    this.alertBots(80);
    // 全域に波状ダメージ(4sで分散: 即時+2発)
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, 400, point, false, '月花雷轟', false);
    }
  }

  // 極雷絶滅: M ウルト(黒雷帝中)。演出中の再入は不可(ゲージも消費しない)
  private activateGokuraiZetsumetsu(): void {
    if (this.gokuraiZetsumetsuTimer > 0) return;
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.gokuraiZetsumetsuTimer = 4.0; // 演出実寿命(effects.gokuraiZetsumetsuEffect の life=4.0)に一致
    const center = this.player.position;
    this.effects.gokuraiZetsumetsuEffect(center, this.settings.reduceMotion);
    this.sounds.gokuraiZetsumetsu();
    this.addShake(this.settings.reduceMotion ? 0.6 : 2.0);
    this.haptic(600, 1.0, 1.0);
    this.announcements.push('極雷絶滅');
    this.alertBots(80);
    // 全域全敵を即死(r35+ の巨躯は HP 20万 に達するため、固定 99999 では生き残る。
    // MAX_SAFE_INTEGER で HP 上限に依らず確実に致死させる)
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, Number.MAX_SAFE_INTEGER, point, false, '極雷絶滅', false);
    }
  }

  // 溜め攻撃の毎フレーム更新(黒帝/雷帝/黒雷帝モード中 fists 専用)
  // R53-W3 M3: 溜め段閾値0.5/1.2/2.2s(chargeStageFor)。段3(黒雷・天壊)は黒雷帝のみ到達可能
  private chargeMaxS(): number {
    return this.activeKit() === 'kokuraitei' ? 2.2 : 1.2;
  }
  private chargeStageFor(timer: number): 0 | 1 | 2 | 3 {
    return emperorChargeStageFor(timer);
  }
  private resetChargeStage(): void {
    if (this.chargeStage !== 0) {
      this.chargeStage = 0;
      this.viewModel.setEmperorChargeStage(0);
    }
  }

  private updateChargeAttack(dt: number): void {
    if (!this.isNinja || !this.player.alive || this.activeWeapon.def.id !== 'fists') {
      if (this.isCharging) {
        this.isCharging = false;
        this.chargeTimer = 0;
        this.resetChargeStage();
      }
      return;
    }
    // 黒帝/雷帝/黒雷帝のいずれかで溜め可能(純雷帝のみでも溜め22m雷が撃てる)
    if (this.darkEmperorTimer <= 0 && !this.raiteiMode && !this.kokuraiteiMode) {
      if (this.isCharging) {
        this.isCharging = false;
        this.chargeTimer = 0;
        this.resetChargeStage();
      }
      return;
    }
    const adsActive = this.activeWeapon.adsProgress > 0.5;
    const fireHeld =
      this.input.fireDown() &&
      this.player.alive &&
      !this.player.sprinting &&
      !this.cooking &&
      !this.rcxdActive;

    if (!this.isCharging) {
      // 新規プレス開始
      if (fireHeld && !adsActive) {
        this.isCharging = true;
        this.chargeTimer = 0;
        this.chargeTickTimer = 0;
      }
      return;
    }

    // 溜め中
    if (fireHeld && !adsActive) {
      const maxS = this.chargeMaxS();
      this.chargeTimer = Math.min(maxS, this.chargeTimer + dt);
      // R53-W3 M3: 溜め段の閾値跨ぎ(段ごとに1回だけ viewModel+音を発火)
      const stage = this.chargeStageFor(this.chargeTimer);
      if (stage > this.chargeStage) {
        this.chargeStage = stage;
        this.viewModel.setEmperorChargeStage(stage);
        this.sounds.emperorChargeStage(stage as 1 | 2 | 3);
      }
      this.chargeTickTimer -= dt;
      if (this.chargeTickTimer <= 0) {
        this.chargeTickTimer = 0.15;
        this.sounds.chargeAttackTick(this.chargeTimer / maxS);
      }
      // R44a: 暗黒チャージパルス(黒帝/黒雷帝のみ, 0.1s毎)
      if (this.darkEmperorTimer > 0 && !this.killcamCamActive) {
        this.darkVoidPulseTimer -= dt;
        if (this.darkVoidPulseTimer <= 0) {
          this.darkVoidPulseTimer = 0.10;
          this.effects.darkVoidPulse(
            this.player.position.clone(),
            Math.min(1, this.chargeTimer / 1.2),
            this.settings.reduceMotion,
          );
        }
      }
    } else {
      // リリース
      const ratio = Math.min(1, this.chargeTimer / 1.2);
      // R53-W3 M3: リリース時点の段(天壊判定)を控えてから状態リセット
      const releasedStage = this.chargeStageFor(this.chargeTimer);
      this.isCharging = false;
      this.chargeTimer = 0;
      this.resetChargeStage();
      if (ratio >= 0.3) {
        // 溜め斬撃解放(段3=黒雷・天壊は黒雷帝限定でspawnChargeSlashWave側が強化)
        this.spawnChargeSlashWave(ratio, releasedStage === 3);
        this.sounds.chargeAttackRelease();
      }
      // ratio<0.3(タップ)は何もしない: 押下フレームの fired イベントで doPunch 済みのため、
      // ここで doPunch を呼ぶと1タップで二重パンチになる
    }
  }

  // 溜め斬撃波を生成(ratio=0-1 溜め比率) — kit 排他による分岐。
  // R53-W3 M3: tenkai=true(溜め段3=2.2s保持、黒雷帝限定)は「黒雷・天壊」— 既存の
  // 横薙ぎ+超範囲落雷に加え、ダメージ×1.5+周囲8柱+軽ノックバック(怯えで表現+微displace)
  private spawnChargeSlashWave(ratio: number, tenkai = false): void {
    if (!this.player.alive) return;
    const kit = this.activeKit();

    // ── raitei kit: 斬撃波なし → 超範囲多段落雷(最大charge時) or スケール単発落雷 ──
    if (kit === 'raitei') {
      this.addShake(0.2 + ratio * 0.6);
      this.alertBots(20);
      if (ratio >= 1.0 - 0.01) {
        // 溜め最大: 超範囲落雷(12-16本 / 1.2s)
        this.spawnRaiteiChargeLightning(RAITEI_CHARGE_SCATTER_R, RAITEI_CHARGE_DMG);
      } else {
        // 中途リリース: 拡大単発AoE(半径を ratio でスケール)
        const r = LIGHTNING_AOE_RADIUS + (LIGHTNING_AOE_RADIUS_CHARGED - LIGHTNING_AOE_RADIUS) * ratio;
        this.spawnLightningAoE(r);
      }
      return;
    }

    // ── dark / kokuraitei kit: 横薙ぎ斬撃波 ──
    const dir = this.cameraForward();
    const origin = this.player.eyePosition.clone();
    const lenM = 4.2 * 2 * (1 + ratio * 9); // 最大: 4.2*2*10 = 84m
    const thickM = 0.6 * (1 + ratio * 9); // 最大: 6m
    // 上限超過時: 最古を排除
    if (this.darkSlashWaves.length >= DARK_SLASH_MAX) {
      const oldest = this.darkSlashWaves.shift()!;
      this.disposeDarkSlashWave(oldest);
    }
    const group = this.effects.darkSlashWaveSized(origin, dir, 0, lenM, thickM);
    // 黒雷帝は横薙ぎ dmg×4、通常は×3。天壊(段3)はさらに×1.5
    const dmgMul = (kit === 'kokuraitei' ? 4 : 3) * (tenkai && kit === 'kokuraitei' ? 1.5 : 1);
    const slashDmg = DARK_SLASH_DAMAGE * dmgMul * ratio;
    this.darkSlashWaves.push({
      group,
      pos: origin.clone(),
      dir: dir.clone(),
      traveled: 0,
      hitSet: new Set(),
      smokeTimer: 0,
      chargeScale: ratio,
      // 横薙ぎの刃の横幅/2 = 刃に沿った当たり
      hitRadius: lenM / 2,
      dmgOverride: slashDmg,
    });
    this.addShake(0.3 + ratio * 0.7);
    this.alertBots(20);
    // 黒雷帝: 溜め最大時に横薙ぎ+超範囲落雷の両方
    if (kit === 'kokuraitei' && ratio >= 1.0 - 0.01) {
      this.spawnRaiteiChargeLightning(RAITEI_CHARGE_SCATTER_R, KOKURAITEI_CHARGE_DMG);
    }
    // R53-W3 M3: 黒雷・天壊(段3リリース) — 世界を割る画: プレイヤー周囲8本の黒雷柱リング
    // +14m内の敵に軽ノックバック(1.2m displace+怯え)。ダメージ本体は上のsweep×1.5が担う
    if (tenkai && kit === 'kokuraitei') {
      const center = this.player.position;
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        this.effects.kokuraiteiKillColumn(
          new THREE.Vector3(center.x + Math.cos(a) * 6, center.y - PLAYER_FEET_OFFSET, center.z + Math.sin(a) * 6),
          'elite',
          this.settings.reduceMotion,
        );
      }
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        if (bot.tier === 'boss' || bot.kind === 'turret') continue;
        const d = bot.position.distanceTo(center);
        if (d > 14 || d < 0.5) continue;
        // 軽ノックバック: 中心から1.2m押し出し(blinkToが内部状態も整合させる)
        const push = bot.position.clone().sub(center).setY(0).normalize().multiplyScalar(1.2);
        bot.blinkTo(bot.position.x + push.x, bot.position.y, bot.position.z + push.z);
        bot.applyFear(bot.kind === 'zombie' ? 0.4 : 1.2);
      }
      this.announcements.push('黒雷・天壊');
      this.addShake(this.settings.reduceMotion ? 0.5 : 1.4);
      this.haptic(400, 1.0, 1.0);
    }
  }

  // 月花雷轟: 4秒嵐の継続タイマー管理 + 0.33s 毎に 100dmg の波状ダメージ(~1200 total)
  private updateGeppaRaigou(dt: number): void {
    if (this.geppaRaigouTimer <= 0) return;
    this.geppaRaigouTimer -= dt;
    this.geppaRaigouDmgTimer -= dt;
    if (this.geppaRaigouDmgTimer <= 0) {
      this.geppaRaigouDmgTimer = 0.33;
      const center = this.player.position;
      const stageR = (this.config.stage.size ?? 100) * 0.7;
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        if (bot.position.distanceTo(center) > stageR + 10) continue;
        const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
        this.applyBotDamage(bot, 100, point, false, '月花雷轟', false);
      }
    }
    if (this.geppaRaigouTimer <= 0) {
      this.geppaRaigouTimer = 0;
      this.geppaRaigouDmgTimer = 0;
    }
  }

  // 極雷絶滅: 4秒演出タイマー管理(エフェクトは effects.gokuraiZetsumetsuEffect が自己完結)
  private updateGokuraiZetsumetsu(dt: number): void {
    if (this.gokuraiZetsumetsuTimer <= 0) return;
    this.gokuraiZetsumetsuTimer -= dt;
    if (this.gokuraiZetsumetsuTimer <= 0) this.gokuraiZetsumetsuTimer = 0;
  }

  // ⑤ 雷帝/黒雷帝 AoE 雷撃スポーン(doPunch/溜め解放から呼ぶ)。
  // 落雷中心は自分の足元ではなく「照準先」: カメラ前方へ castRay(最大60m、world+boundary)
  // した命中点。空振り時は eye+fwd*60 の地面投影(下向きレイの着地点、無ければ bot 高さ相当
  // =プレイヤー胴体中心の高さ)を中心にする。
  // L10仕様: 落雷は「上空からの一撃」であるため、中心半径内の敵には遮蔽(壁)越しでも命中する。
  // これは意図された仕様であり、遮蔽判定は追加しない。
  private spawnLightningAoE(radius: number): void {
    if (!this.player.alive) return;
    const eye = this.player.eyePosition;
    const fwd = this.cameraForward();
    const aimHit = this.castRay(
      eye,
      fwd,
      LIGHTNING_AOE_AIM_RANGE,
      this.player.body,
      (c) => { const k = this.tags.get(c.handle)?.kind; return k === 'world' || k === 'boundary'; },
    );
    const center = eye.clone().addScaledVector(fwd, aimHit ? hitToi(aimHit) : LIGHTNING_AOE_AIM_RANGE);
    if (!aimHit) {
      // 空振り: 落下点を地面へ投影。地面が見つからなければプレイヤー胴体中心の高さを採用
      const downHit = this.castRay(
        center,
        new THREE.Vector3(0, -1, 0),
        120,
        this.player.body,
        (c) => this.tags.get(c.handle)?.kind === 'world',
      );
      center.y = downHit ? center.y - hitToi(downHit) : this.player.position.y;
    }
    const dmg = this.kokuraiteiMode ? KOKURAITEI_AOE_DAMAGE : LIGHTNING_AOE_DAMAGE;
    if (this.kokuraiteiMode) {
      this.effects.kokuraiteiStrikeAoE(center, radius, this.settings.reduceMotion);
    } else {
      this.effects.lightningStrikeAoE(center, radius, this.settings.reduceMotion);
    }
    this.sounds.lightningStrikeAoE(radius >= 20);
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (bot.position.distanceTo(center) > radius) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, dmg, point, false, '雷帝斬撃', false);
    }
  }

  // 黒帝モードの毎フレーム更新: タイマー減算 + 足元黒煙エミッタ
  private updateDarkEmperor(dt: number): void {
    if (this.darkEmperorTimer <= 0) return;
    // 常闇カモ(tokoyami)による永続化: tokoyamiActive=true または Infinity のまま減算しない
    if (!this.tokoyamiActive && isFinite(this.darkEmperorTimer)) {
      this.darkEmperorTimer = Math.max(0, this.darkEmperorTimer - dt);
    }

    // 足元から漂う黒煙(頻度~3倍: 0.25-0.4s間隔、1回に2-3パフ)+ 周囲の渦ウィスプ
    if (this.player.alive) {
      this.darkSmokeTimer -= dt;
      if (this.darkSmokeTimer <= 0) {
        this.darkSmokeTimer = 0.25 + Math.random() * 0.15;
        const base = this.player.position;
        const puffCount = 2 + (this.rand() < 0.4 ? 1 : 0);
        for (let _pi = 0; _pi < puffCount; _pi++) {
          this.effects.darkSmokeEmit(new THREE.Vector3(
            base.x + (Math.random() - 0.5) * 0.5,
            base.y - PLAYER_FEET_OFFSET,
            base.z + (Math.random() - 0.5) * 0.5,
          ));
        }
        // 黒い焔の渦: 周囲に螺旋上昇するウィスプリング
        this.effects.darkAuraSwirl(
          new THREE.Vector3(base.x, base.y - PLAYER_FEET_OFFSET + 0.15, base.z),
        );
      }
    }

    // R44a: 黒帝スモークマントル(1-2Hz)
    if (this.player.alive && !this.killcamCamActive) {
      this.kokuteiSmantleTimer -= dt;
      if (this.kokuteiSmantleTimer <= 0) {
        this.kokuteiSmantleTimer = 0.5 + Math.random() * 0.5;
        this.effects.kokuteiSmokeMantle(this.player.position.clone(), this.settings.reduceMotion);
      }
    }
    if (this.darkEmperorTimer <= 0) this.endDarkEmperor();
  }

  // 黒帝モード解除: エミッタ停止 + viewModel通知 + バフリセット
  private endDarkEmperor(): void {
    this.darkEmperorTimer = 0;
    this.viewModel.setKunaiDarkMode(false);
    this.sounds.setDarkEmperorAura(false); // R45a
    // R53-W3 M3: 黒帝終了後のBGM(雷帝が残っていれば雷帝層、なければ通常へ復帰)。
    // 黒雷帝は darkEmperorTimer=Infinity で endDarkEmperor に到達しない(永続契約)
    this.sounds.setEmperorBgm(this.raiteiMode ? 'raitei' : null);
  }

  // R33 黒雷帝の毎フレーム演出: 移動トレイル + 遠方落雷スケジューラ
  private updateKokuraitei(dt: number): void {
    this.updateKokuraiSkyTurn(dt); // R53-W3 M3: 空の黒転lerp(黒雷帝中のみ進行)
    // A4-F08: 雷帝/黒雷帝中のハム音(3-6s間隔)。kokuraitei限定ブロックの前で両モードをカバー
    if ((this.raiteiMode || this.kokuraiteiMode) && this.player.alive) {
      this.raiteiHumNextS -= dt;
      if (this.raiteiHumNextS <= 0) {
        this.raiteiHumNextS = 3 + Math.random() * 3;
        this.sounds.raiteiHumTick();
      }
    }

    // R44a: 雷帝(非黒雷帝)歩行足跡(0.18s毎)
    if (this.raiteiMode && !this.kokuraiteiMode && this.player.alive && !this.killcamCamActive) {
      const raiteiMoving = !this.player.sprinting && !this.player.sliding;
      if (raiteiMoving) {
        this.raiteiFootprintTimer -= dt;
        if (this.raiteiFootprintTimer <= 0) {
          this.raiteiFootprintTimer = 0.18;
          this.effects.raiteiFootprint(
            new THREE.Vector3(this.player.position.x, this.player.position.y - PLAYER_FEET_OFFSET, this.player.position.z),
            this.settings.reduceMotion,
          );
        }
      } else {
        this.raiteiFootprintTimer = 0;
      }
    }

    if (!this.kokuraiteiMode) return;

    // ① 移動トレイル: スプリント/スライド中に足元へ這う小電弧
    if (this.player.alive && !this.killcamCamActive) {
      const isSliding = this.player.sliding;
      const isSprinting = this.player.sprinting;
      if (isSprinting || isSliding) {
        this.kokuraiTrailTimer -= dt;
        if (this.kokuraiTrailTimer <= 0) {
          this.kokuraiTrailTimer = isSliding ? 0.06 : 0.12;
          const feet = new THREE.Vector3(
            this.player.position.x,
            this.player.position.y - PLAYER_FEET_OFFSET,
            this.player.position.z,
          );
          this.effects.spawnKokuraiTrail(feet, isSliding);
        }
      } else {
        this.kokuraiTrailTimer = 0;
        // R44a: 歩行中(非スプリント・非スライド)の黒雷帝ルーンエミット
        if (this.player.alive && !this.killcamCamActive) {
          this.walkKokuraiTimer -= dt;
          if (this.walkKokuraiTimer <= 0) {
            this.walkKokuraiTimer = 0.22;
            this.effects.walkKokuraiRune(
              new THREE.Vector3(this.player.position.x, this.player.position.y - PLAYER_FEET_OFFSET, this.player.position.z),
              this.settings.reduceMotion,
            );
          }
        }
      }
    }

    // ③a 遠方落雷スケジューラ(視覚): 8-15s 間隔でマップ遠方に黒雷柱
    if (this.player.alive && !this.killcamCamActive) {
      this.kokuraiThunderTimer -= dt;
      if (this.kokuraiThunderTimer <= 0) {
        this.kokuraiThunderTimer = 8 + Math.random() * 7;
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 60;
        const base = this.player.position;
        const stageSize = (this.config.stage.size ?? 100) * 0.7;
        const strikePos = new THREE.Vector3(
          THREE.MathUtils.clamp(base.x + Math.cos(angle) * dist, -stageSize, stageSize),
          base.y,
          THREE.MathUtils.clamp(base.z + Math.sin(angle) * dist, -stageSize, stageSize),
        );
        this.effects.spawnKokuraiDistantColumn(strikePos, 18, 0.35);
        // 距離減衰パン(プレイヤーの向きに対する相対方位から計算)
        const relAngle = angle - this.player.yaw;
        this.sounds.rumbleDistantThunder(Math.sin(relAngle) * 0.70);
      }
    }
  }

  // ── kit 排他解決: 優先度 kokuraitei > dark(timer>0) > raitei ──
  private activeKit(): 'kokuraitei' | 'dark' | 'raitei' | 'none' {
    if (this.kokuraiteiMode) return 'kokuraitei';
    if (this.darkEmperorTimer > 0) return 'dark';
    if (this.raiteiMode) return 'raitei';
    return 'none';
  }

  // 雷帝溜め最大: 照準先を中心に scatter 半径内へ多段落雷をスケジューリング
  private spawnRaiteiChargeLightning(scatterR: number, dmgPerStrike: number): void {
    if (!this.player.alive) return;
    // 照準先を計算(spawnLightningAoE と同じロジック)
    const eye = this.player.eyePosition;
    const fwd = this.cameraForward();
    const aimHit = this.castRay(
      eye, fwd, LIGHTNING_AOE_AIM_RANGE, this.player.body,
      (c) => { const k = this.tags.get(c.handle)?.kind; return k === 'world' || k === 'boundary'; },
    );
    const center = eye.clone().addScaledVector(fwd, aimHit ? hitToi(aimHit) : LIGHTNING_AOE_AIM_RANGE);
    if (!aimHit) {
      const downHit = this.castRay(
        center, new THREE.Vector3(0, -1, 0), 120, this.player.body,
        (c) => this.tags.get(c.handle)?.kind === 'world',
      );
      center.y = downHit ? center.y - hitToi(downHit) : this.player.position.y;
    }

    const count = RAITEI_CHARGE_COUNT_MIN +
      Math.floor(this.rand() * (RAITEI_CHARGE_COUNT_MAX - RAITEI_CHARGE_COUNT_MIN + 1));
    const hitCounts = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const t = this.elapsed + (i / count) * RAITEI_CHARGE_DURATION;
      const angle = this.rand() * Math.PI * 2;
      const dist = this.rand() * scatterR;
      const strikeCenter = new THREE.Vector3(
        center.x + Math.cos(angle) * dist,
        center.y,
        center.z + Math.sin(angle) * dist,
      );
      this.raiteiChargeStrikes.push({ t, center: strikeCenter, hitCounts, dmg: dmgPerStrike });
    }
    this.addShake(this.settings.reduceMotion ? 0.4 : 0.9);
    this.alertBots(40);
    this.sounds.lightningStrikeAoE(true); // 大落雷音で開幕
  }

  // 雷帝溜め多段落雷: 時刻 t に達したものから順次発火
  private updateRaiteiChargeStrikes(): void {
    if (this.raiteiChargeStrikes.length === 0) return;
    const now = this.elapsed;
    const pending: typeof this.raiteiChargeStrikes = [];
    for (const strike of this.raiteiChargeStrikes) {
      if (now >= strike.t) {
        // V33: 発火時に接地スナップ(メガマップの高低差/建物階層でボルトが浮く・埋まるのを防ぐ)
        const groundHit = this.castRay(
          new THREE.Vector3(strike.center.x, strike.center.y + 12, strike.center.z),
          new THREE.Vector3(0, -1, 0),
          60,
          null,
          (c) => this.tags.get(c.handle)?.kind === 'world',
        );
        if (groundHit && groundHit.timeOfImpact !== undefined) {
          strike.center.y = strike.center.y + 12 - groundHit.timeOfImpact;
        }
        // 視覚+音
        if (this.kokuraiteiMode) {
          this.effects.kokuraiteiStrikeAoE(strike.center, RAITEI_CHARGE_IMPACT_R, this.settings.reduceMotion);
        } else {
          this.effects.lightningStrikeAoE(strike.center, RAITEI_CHARGE_IMPACT_R, this.settings.reduceMotion);
        }
        this.sounds.lightningStrikeAoE(false); // 各1本=小音
        // ダメージ(同一敵は最大 RAITEI_CHARGE_HIT_MAX 回まで)
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          // XZ円柱+縦許容(3D球だと別階層の敵を系統的に外す)
          const dxz = Math.hypot(bot.position.x - strike.center.x, bot.position.z - strike.center.z);
          if (dxz > RAITEI_CHARGE_IMPACT_R || Math.abs(bot.position.y - strike.center.y) > 6) continue;
          const hits = strike.hitCounts.get(bot.uid) ?? 0;
          if (hits >= RAITEI_CHARGE_HIT_MAX) continue;
          strike.hitCounts.set(bot.uid, hits + 1);
          const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
          this.applyBotDamage(bot, strike.dmg, point, false, '雷帝斬撃', false);
        }
      } else {
        pending.push(strike);
      }
    }
    this.raiteiChargeStrikes = pending;
  }

  // 雷帝の毎フレーム更新(落雷・麒麟疾走・波状ダメージ・終了dispose)
  private updateLightningBeast(dt: number): void {
    if (this.lightningBeastTimer <= 0) return;
    this.lightningBeastTimer -= dt;

    const BEAST_RADIUS = 14;
    const WAVE_DAMAGE = 80 * (this.darkEmperorTimer > 0 ? DARK_EMPEROR_MUL_ULTS : 1); // 6波×80≈480(演出3秒に集中する高密度DoT)
    const WAVE_INTERVAL = 0.5;
    const ARC_INTERVAL = 0.1;
    const arcColor = 0x88ddff;
    const center = this.player.position;

    // ジグザグ落雷: 0.1s周期で6本、半径4..14mへランダム落下
    this.lightningBeastArcTimer += dt;
    if (this.lightningBeastArcTimer >= ARC_INTERVAL) {
      this.lightningBeastArcTimer = 0;
      const n = 6;
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const r = 4 + Math.random() * (BEAST_RADIUS - 4);
        const from = new THREE.Vector3(center.x + Math.sin(a) * r, center.y + 14, center.z + Math.cos(a) * r);
        const to = new THREE.Vector3(
          center.x + Math.sin(a) * r * 0.5,
          center.y - PLAYER_FEET_OFFSET + 0.1,
          center.z + Math.cos(a) * r * 0.5,
        );
        this.effects.lightningArc(from, to, arcColor);
        if (Math.random() < 0.4) this.effects.impactRing(to, arcColor);
      }
    }

    // 麒麟の疾走+脚の駆動+発光フリッカー+足元への放電+随伴分岐雷+足跡焦げリング
    const kirin = this.lightningKirinMesh;
    if (kirin) {
      const kirinSpeed = 7; // m/s ≈ 3秒で21m駆け抜ける
      this.lightningKirinPos.addScaledVector(this.lightningKirinDir, kirinSpeed * dt);
      kirin.position.copy(this.lightningKirinPos);
      const legPhase = Math.sin(this.elapsed * 12) * 0.12;
      for (let i = 0; i < kirin.children.length; i += 1) {
        const mesh = kirin.children[i] as THREE.Mesh;
        if (i >= 4 && i <= 7) mesh.position.y = 0.4 + legPhase * (i % 2 === 0 ? 1 : -1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.random() * 0.3;
      }
      if (Math.random() < 0.3) {
        this.effects.lightningArc(
          this.lightningKirinPos.clone().add(new THREE.Vector3(0, 2, 0)),
          this.lightningKirinPos.clone(),
          0xffffff,
        );
      }
      // 随伴分岐雷(buildBranchBolt 側方 2 本)
      if (!this.settings.reduceMotion && Math.random() < 0.25) {
        const sideA = Math.random() * Math.PI * 2;
        const sideFrom = this.lightningKirinPos.clone().add(new THREE.Vector3(0, 4, 0));
        const sideTo = this.lightningKirinPos.clone().add(
          new THREE.Vector3(Math.cos(sideA) * 3, 0, Math.sin(sideA) * 3),
        );
        this.effects.buildBranchBolt(sideFrom, sideTo, 2, false, 0.12);
      }
      // 足跡焦げリング(0.18s周期)
      this.lightningKirinFootTimer += dt;
      if (!this.settings.reduceMotion && this.lightningKirinFootTimer >= 0.18) {
        this.lightningKirinFootTimer = 0;
        const footPos = this.lightningKirinPos.clone();
        footPos.y -= PLAYER_FEET_OFFSET;
        this.effects.impactRing(footPos, arcColor);
      }
    }

    // フィナーレ落雷(最後 0.4s)
    if (!this.settings.reduceMotion && this.lightningBeastTimer < 0.4 && this.lightningBeastTimer > 0) {
      if (Math.random() < 0.6) {
        const fa = Math.random() * Math.PI * 2;
        const fr = 2 + Math.random() * 5;
        const finalPos = new THREE.Vector3(
          center.x + Math.cos(fa) * fr,
          center.y - PLAYER_FEET_OFFSET + 0.1,
          center.z + Math.sin(fa) * fr,
        );
        this.effects.buildBranchBolt(
          finalPos.clone().add(new THREE.Vector3(0, 8, 0)),
          finalPos, 3, false, 0.22,
        );
      }
    }

    // 波状ダメージ(0.5s周期・遮蔽規約あり・中心ほど痛い)
    this.lightningBeastDamageTimer += dt;
    if (this.lightningBeastDamageTimer >= WAVE_INTERVAL) {
      this.lightningBeastDamageTimer = 0;
      this.addShake(this.settings.reduceMotion ? 0.12 : 0.45);
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        const dist = bot.position.distanceTo(center);
        if (dist > BEAST_RADIUS) continue;
        if (!this.explosionReaches(center, bot.position)) continue;
        const scaled = WAVE_DAMAGE * (1 - (dist / BEAST_RADIUS) * 0.35);
        this.applyBotDamage(bot, scaled, bot.position, false, '雷帝降臨', false);
      }
    }

    // 3秒経過で全て確実にdispose
    if (this.lightningBeastTimer <= 0) {
      this.lightningBeastTimer = 0;
      this.disposeLightningKirin();
    }
  }

  // 麒麟メッシュの解放(演出終了・試合破棄の両経路から呼ぶ)
  private disposeLightningKirin(): void {
    if (!this.lightningKirinMesh) return;
    this.scene.remove(this.lightningKirinMesh);
    for (const g of this.lightningKirinGeos) g.dispose();
    for (const m of this.lightningKirinMats) m.dispose();
    this.lightningKirinMesh = null;
    this.lightningKirinGeos = [];
    this.lightningKirinMats = [];
  }

  // ── 黒帝斬撃波 ──────────────────────────────────────────────────
  private spawnDarkSlashWave(tiltRad: number): void {
    if (!this.player.alive) return;
    const dir = this.cameraForward();
    const origin = this.player.eyePosition.clone();

    // 上限超過時: 最古エンティティを排除
    if (this.darkSlashWaves.length >= DARK_SLASH_MAX) {
      const oldest = this.darkSlashWaves.shift()!;
      this.disposeDarkSlashWave(oldest);
    }

    const group = this.effects.darkSlashWave(origin, dir, tiltRad);
    this.darkSlashWaves.push({
      group,
      pos: origin.clone(),
      dir: dir.clone(),
      traveled: 0,
      hitSet: new Set(),
      smokeTimer: 0,
      hitRadius: DARK_SLASH_RADIUS,
    });
    this.sounds.darkSlash();
  }

  private updateDarkSlashWaves(dt: number): void {
    if (this.darkSlashWaves.length === 0) return;
    const remaining: DarkSlashWave[] = [];
    for (const w of this.darkSlashWaves) {
      const move = DARK_SLASH_SPEED * dt;
      w.pos.addScaledVector(w.dir, move);
      w.traveled += move;
      w.group.position.copy(w.pos);
      // 飛翔中の回転は廃止 → 向き(tilt)を保持し「鋭い斬線」が向きを保つ

      // スモークトレイル(控えめ: 0.18s周期)
      w.smokeTimer += dt;
      if (w.smokeTimer >= 0.18) {
        w.smokeTimer = 0;
        this.effects.darkSlashSmoke(w.pos.clone());
        // R44a: 黒雷帝中は後流残光
        if (this.kokuraiteiMode) {
          const behind = w.pos.clone().addScaledVector(w.dir, -0.5);
          this.effects.kokuteiSlashResidual(behind, w.pos.clone());
        }
      }

      // 前方に壁があれば手前で終端
      const wallHit = this.castRay(
        w.pos.clone().addScaledVector(w.dir, -0.3),
        w.dir,
        DARK_SLASH_SPEED * dt + 1.0,
        null,
        (c) => this.tags.get(c.handle)?.kind === 'world',
      );
      if (wallHit) {
        // 黒斬撃が破壊可能プロップに命中した場合は HP を削る(壁で止まる動作は変わらない)
        this.applyPropDamage(wallHit.collider.handle, DARK_SLASH_DAMAGE);
        this.disposeDarkSlashWave(w);
        continue;
      }

      // R53-W2 M2b: 敵対斬撃(帝王編ボス)はプレイヤーのみを判定して bot ループへ入らない
      if (w.hostile) {
        if (!w.hitPlayer && this.player.alive) {
          const pp = this.player.position;
          const dxp = pp.x - w.pos.x;
          const dzp = pp.z - w.pos.z;
          if (dxp * dxp + dzp * dzp <= w.hitRadius * w.hitRadius && Math.abs(pp.y - w.pos.y) <= 2.5) {
            w.hitPlayer = true;
            const dmg = w.dmgOverride ?? HOSTILE_SLASH_DAMAGE;
            const died = this.player.takeDamage(dmg);
            this.tookDamage = true;
            this.addShake(0.22);
            this.incoming.push(this.incomingAngle(w.pos));
            this.sounds.hurt();
            this.tracker.onPlayerDamaged();
            this.sounds.playerBodyHit(Math.sin(this.incomingAngle(w.pos)), Math.min(1, dmg / 100));
            this.effects.hitPuff(new THREE.Vector3(pp.x, pp.y + 0.3, pp.z));
            if (died) {
              this.feed.push({
                killer: w.hostileOwnerName ?? 'クロガネ',
                victim: PLAYER_NAME,
                weapon: '黒雷斬撃',
                headshot: false,
              });
              this.sounds.death();
              this.notePlayerDeath(this.bossPhaseRef);
            }
          }
        }
        if (w.traveled >= DARK_SLASH_RANGE) {
          this.disposeDarkSlashWave(w);
          continue;
        }
        remaining.push(w);
        continue;
      }

      // ヒットボックス: 水平半径 w.hitRadius + 高さ±2.5m の円柱
      const hitRadius = w.hitRadius;
      const slashDmg = w.dmgOverride ?? DARK_SLASH_DAMAGE;
      for (const bot of this.bots) {
        if (!bot.alive || bot.team === PLAYER_TEAM) continue;
        if (w.hitSet.has(bot.uid)) continue;
        const bp = bot.position;
        const dx = bp.x - w.pos.x;
        const dz = bp.z - w.pos.z;
        if (dx * dx + dz * dz > hitRadius * hitRadius) continue;
        if (Math.abs(bp.y - w.pos.y) > 2.5) continue;
        w.hitSet.add(bot.uid);
        const point = new THREE.Vector3(bp.x, bp.y + 0.3, bp.z);
        this.applyBotDamage(bot, slashDmg, point, false, '黒帝斬撃', false);
        this.effects.hitPuff(point);
      }

      if (w.traveled >= DARK_SLASH_RANGE) {
        this.disposeDarkSlashWave(w);
        continue;
      }
      remaining.push(w);
    }
    this.darkSlashWaves = remaining;
  }

  private disposeDarkSlashWave(w: DarkSlashWave): void {
    this.scene.remove(w.group);
    w.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
  }

  private disposeAllDarkSlashWaves(): void {
    for (const w of this.darkSlashWaves) this.disposeDarkSlashWave(w);
    this.darkSlashWaves = [];
  }



  // ── 黒技奥伝・真月 ──────────────────────────────────────────────
  private activateShingetsu(): void {
    if (this.shingetsuPhase !== 'idle') return;
    if (!this.player.alive) return;
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    this.shingetsuPhase = 'charge';
    this.shingetsuTimer = SHINGETSU_CHARGE_S;
    this.sounds.shingetsuCharge();
    this.addShake(this.settings.reduceMotion ? 0.1 : 0.25);
  }

  private updateShingetsu(dt: number): void {
    if (this.shingetsuPhase === 'idle') return;

    if (this.shingetsuPhase === 'charge') {
      // 溜め中は画面を暗くキープ
      this.deathVeil = Math.max(this.deathVeil, this.settings.reduceMotion ? 0.35 : 0.72);
      this.shingetsuTimer -= dt;
      if (this.shingetsuTimer <= 0) {
        this.shingetsuPhase = 'idle';
        this.releaseShingetsu();
      }
    }
  }

  private releaseShingetsu(): void {
    if (!this.player.alive) return;
    const center = this.player.position.clone();
    const stageRadius = this.config.stage.size / 2 + 8;
    const chestY = center.y + 0.4;

    // ビジュアル: ステージ全域に広がる暗黒リング + スラッシュフラッシュ + 空間切れ残留線
    this.effects.shingetsuWave(
      new THREE.Vector3(center.x, chestY, center.z),
      stageRadius,
      this.settings.reduceMotion,
    );
    if (!this.settings.reduceMotion) {
      this.effects.shingetsuSpatialCut(new THREE.Vector3(center.x, chestY, center.z), stageRadius);
    }

    // 画面フラッシュ + 最大シェイク
    if (!this.settings.reduceMotion) {
      this.whiteout = Math.max(this.whiteout, 0.6);
      this.addShake(1.4);
    } else {
      this.addShake(0.4);
    }
    this.deathVeil = 0;

    // 全敵を一撃(遮蔽無視=奥伝の特権)
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, SHINGETSU_DAMAGE, point, false, '黒技奥伝・真月', false);
      this.effects.hitPuff(point);
    }

    this.sounds.shingetsuRelease();
    this.haptic(600, 1.0, 1.0);
    this.announcements.push('黒技奥伝・真月');
    this.alertBots(80);
  }

  // 手裏剣メッシュの解放(飛行中の試合破棄経路から呼ぶ)
  private disposeWindShuriken(): void {
    if (!this.windShuriken) return;
    this.scene.remove(this.windShuriken.mesh);
    for (const g of this.windShuriken.geos) g.dispose();
    for (const m of this.windShuriken.mats) m.dispose();
    this.windShuriken = null;
  }

  private refillGrenades(): void {
    this.grenadeCounts.frag = GRENADE_SPECS.frag.carry;
    this.grenadeCounts.smoke = GRENADE_SPECS.smoke.carry;
    this.grenadeCounts.flash = GRENADE_SPECS.flash.carry;
    this.grenadeCounts.incendiary = GRENADE_SPECS.incendiary.carry;
  }

  private handleRespawns(): void {
    // reserved: このフレームで確保済みのスポーン位置。同フレーム複数リスポーンで
    // 同一地点を選ばないよう pickSpawn へ渡し、occupancy チェックの起点にする。
    const reserved: THREE.Vector3[] = [];
    // R51-4d: 生存中の全キャラ位置(チーム不問)は実際にpickSpawnが必要になった時だけ構築する。
    // VOID_Y発火も死亡リスポーンも無い通常フレーム(ゾンビ大群でも大半のフレームがこれ)では
    // .position(新規Vector3)を全alive分呼ぶだけ無駄だったため、遅延構築+メモ化にする。
    let allAliveCache: THREE.Vector3[] | null = null;
    const allAlive = (): THREE.Vector3[] => {
      if (!allAliveCache) {
        allAliveCache = [];
        if (this.player.alive) allAliveCache.push(this.player.position);
        for (const b of this.bots) if (b.alive) allAliveCache.push(b.position);
      }
      return allAliveCache;
    };

    // ── 奈落セーフティネット(無限落下の構造的封じ込め)──
    // 床抜けはレベル設計でなくエンジン由来のアーティファクトなので、K/D・ストリークを
    // 罰さず非致死で安全スポーンへ再配置する。物理ステップ後の最新座標で判定する。
    if (this.player.alive && this.player.position.y < VOID_Y) {
      const sp = this.pickSpawn(
        this.playerSpawns,
        this.hostilesOf(PLAYER_TEAM),
        [...allAlive(), ...reserved],
      );
      this.player.respawnAt(sp);
      reserved.push(sp);
      for (const weapon of this.weapons) weapon.resupply();
      this.refillGrenades();
    }
    for (const bot of this.bots) {
      if (bot.alive && bot.position.y < VOID_Y) {
        const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
        const sp = this.pickSpawn(
          spawns,
          this.hostilesOf(bot.team),
          [...allAlive(), ...reserved],
        );
        bot.respawnAt(sp);
        reserved.push(sp);
      }
    }

    if (!this.player.alive && this.player.respawnIn <= 0) {
      if (this.config.mode === 'zombie') {
        // ゾンビはダウン=無限ウェーブ終了(復活しない)。over は zombie の唯一の終了条件
        this.playerDowns += 1;
        this.over = true;
      } else {
        const sp = this.pickSpawn(
          this.playerSpawns,
          this.hostilesOf(PLAYER_TEAM),
          [...allAlive(), ...reserved],
        );
        this.player.respawnAt(sp);
        reserved.push(sp);
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
    // ストーリー/ゾンビでは敵を復活させない(撃破で波/ラウンドが確実に減る。ゾンビはディレクタが管理)。
    // R53-W2 M2b: S&Dはノーリスポーン(復活はラウンド替わりの startSndRound が行う)
    if (!this.mission && this.config.mode !== 'snd') {
      for (const bot of this.bots) {
        if (!bot.alive && bot.respawnIn <= 0 && bot.kind !== 'zombie' && bot.kind !== 'turret') {
          const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
          const sp = this.pickSpawn(
            spawns,
            this.hostilesOf(bot.team),
            [...allAlive(), ...reserved],
          );
          bot.respawnAt(sp);
          reserved.push(sp);
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
    // 超鬼畜: 敵側のみ倍率適用。全spawn経路(対戦/ミッション波/ゾンビ)が
    // この漏斗を通るため、ここ一箇所で全モードへ効く
    // T1: ゾンビboss tier のみ HP倍率対象外(applyHellTierTuning側で分岐。damage/speedは維持)
    let finalTuning =
      this.config.hellMode && team !== PLAYER_TEAM ? applyHellTierTuning(merged, tier, kind) : merged;
    // R53-W2 M2b: ミッション難易度(MN2契約)。hellの後に乗算(hellと重なるのは意図=両方選んだ強度)。
    // starRateは既存基準のまま=難易度で星を変えない設計判断(数値根拠は関数コメント)
    if (this.mission && team !== PLAYER_TEAM) {
      finalTuning = applyMissionDifficultyTuning(finalTuning, this.config.missionDifficulty);
    }
    const bot = new Bot(this.physics, name, spawn, color, finalTuning, team, tier, kind);
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

  // ── 訓練場ターゲット ────────────────────────────────────────────────────────────
  private spawnTrainingTargets(): void {
    // F2: static的5基をright軸方向へ (i-2)*3 で横に散らして相互遮蔽を防ぐ
    const staticDists = [5, 10, 20, 30, 50];
    for (let i = 0; i < staticDists.length; i += 1) {
      this.createTrainingTarget('static', (i - 2) * 3, staticDists[i]!, 0);
    }
    const movingSpeeds = [1, 2, 3];
    for (let i = 0; i < 3; i += 1) {
      this.createTrainingTarget('moving', (i - 1) * 4, 15, movingSpeeds[i] ?? 1);
    }
    for (let i = 0; i < 4; i += 1) {
      this.createTrainingTarget('popup', (i - 1.5) * 2, 8, 0);
    }
  }

  private createTrainingTarget(
    kind: 'static' | 'moving' | 'popup',
    offsetX: number,
    dist: number,
    speed: number,
  ): void {
    const spawn = this.playerSpawns[0] ?? new THREE.Vector3();
    // F3: spawn → マップ中心(原点) 方向の水平単位ベクトル forward と直交 right を使って配置
    // これにより隅スポーンでも全的が場内に収まり、境界外へのはみ出しがなくなる
    const toCenter = new THREE.Vector3(-spawn.x, 0, -spawn.z);
    const fwdLen = toCenter.length();
    const fwd = fwdLen > 0.01 ? toCenter.clone().divideScalar(fwdLen) : new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const cx = spawn.x + fwd.x * dist + right.x * offsetX;
    const cz = spawn.z + fwd.z * dist + right.z * offsetX;
    const groundY = spawn.y;

    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(0.5, 1.3, 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.8 });
    const bodyMesh = new THREE.Mesh(bodyGeo, mat);
    bodyMesh.position.y = 0.65;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.8 });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.55;
    headMesh.castShadow = true;
    group.add(headMesh);
    const baseGeo = new THREE.CylinderGeometry(0.25, 0.28, 0.06, 8);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.03;
    group.add(baseMesh);
    group.position.set(cx, groundY, cz);
    this.scene.add(group);

    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, groundY, cz),
    );
    const bodyCollider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.65, 0.025).setTranslation(0, 0.65, 0),
      body,
    );
    const headCollider = this.physics.createCollider(
      RAPIER.ColliderDesc.ball(0.18).setTranslation(0, 1.55, 0),
      body,
    );

    const target: TrainingTarget = {
      group,
      body,
      bodyCollider,
      headCollider,
      hp: 100,
      isDown: false,
      downTimer: 0,
      kind,
      moveDir: 1,
      moveSpeed: speed,
      moveRange: 3.5,
      moveOriginX: cx,
      moveOriginZ: cz,
      // F3: 往復運動は right 軸方向へ(コーナースポーンでも場内で往復する)
      moveRightX: right.x,
      moveRightZ: right.z,
    };
    this.tags.set(bodyCollider.handle, { kind: 'trainingTarget', target, part: 'body' });
    this.tags.set(headCollider.handle, { kind: 'trainingTarget', target, part: 'head' });
    this.trainingTargets.push(target);
  }

  private updateTrainingTargets(dt: number): void {
    for (const t of this.trainingTargets) {
      if (t.isDown) {
        const targetRot = Math.PI / 2;
        if (t.group.rotation.z < targetRot) {
          t.group.rotation.z = Math.min(targetRot, t.group.rotation.z + dt * 3);
        }
        // F1: static/moving も popup と同じ2秒自動復活で射場が劣化しない
        t.downTimer -= dt;
        if (t.downTimer <= 0) this.reviveTrainingTarget(t);
      } else if (t.kind === 'moving' && t.moveSpeed > 0) {
        const cur = t.body.translation();
        // F3: 往復運動を right 軸方向に沿わせる
        const step = t.moveDir * t.moveSpeed * dt;
        const nextX = cur.x + step * t.moveRightX;
        const nextZ = cur.z + step * t.moveRightZ;
        // right 軸に投影した原点からの符号付き距離でrange判定
        const proj = (nextX - t.moveOriginX) * t.moveRightX + (nextZ - t.moveOriginZ) * t.moveRightZ;
        if (Math.abs(proj) >= t.moveRange) t.moveDir *= -1;
        t.body.setNextKinematicTranslation({ x: nextX, y: cur.y, z: nextZ });
        t.group.position.x = nextX;
        t.group.position.z = nextZ;
      }
    }
  }

  private reviveTrainingTarget(t: TrainingTarget): void {
    t.hp = 100;
    t.isDown = false;
    t.downTimer = 0;
    t.group.rotation.z = 0;
    // F1: bot.ts 死亡/復活イディオムと同型: 復活時にコライダーを再有効化
    t.bodyCollider.setEnabled(true);
    t.headCollider.setEnabled(true);
  }

  private applyTrainingTargetDamage(
    target: TrainingTarget,
    damage: number,
    headshot: boolean,
    point: THREE.Vector3,
  ): void {
    if (target.isDown) return;
    target.hp -= damage;
    this.damageNumbers.push({
      amount: Math.round(damage),
      world: point.clone(),
      kind: headshot ? 'head' : 'body',
    });
    this.hits.push(headshot ? 'head' : 'hit');
    if (headshot) this.sounds.headshot();
    else this.sounds.hit(1 + THREE.MathUtils.clamp((damage - 12) / 90, 0, 0.45));
    if (target.hp <= 0) {
      target.hp = 0;
      target.isDown = true;
      // F1: static/moving も popup と同じ2秒で再出現(全的が2秒で復活=射場が劣化しない)
      target.downTimer = 2;
      // F1: bot.ts 死亡イディオムと同型: ダウン中は被弾しないようコライダーを無効化
      target.bodyCollider.setEnabled(false);
      target.headCollider.setEnabled(false);
    }
  }

  private disposeTrainingTargets(): void {
    for (const t of this.trainingTargets) {
      this.tags.delete(t.bodyCollider.handle);
      this.tags.delete(t.headCollider.handle);
      this.scene.remove(t.group);
    }
    this.trainingTargets.length = 0;
  }

  // ── R16 BO2式ラウンド制ゾンビディレクタ ─────────────────────────
  // 同時生存上限をtierへ連動させる(多数描画/物理予算を守る主レバー)
  // tier別パフォーマンスクランプ: low上限40/medium上限84/high=設定値のまま(Math.minで保護)
  private setupZombie(): void {
    const tier = resolveGraphicsTier(
      this.settings.graphicsQuality,
      this.renderer.capabilities.isWebGL2,
    );
    const rawCap =
      tier === 'high'
        ? ZOMBIE_MAX_ALIVE.high
        : tier === 'medium'
          ? ZOMBIE_MAX_ALIVE.medium
          : ZOMBIE_MAX_ALIVE.low;
    // low:40/medium:84/high:rawCap(108)。ZOMBIE_MAX_ALIVE増員(54/84/108)に対する描画/物理上限
    this.zombieTierCap =
      tier === 'high'
        ? rawCap
        : tier === 'medium'
          ? Math.min(84, rawCap)
          : Math.min(40, rawCap);
    this.buildZombieShop();

    // R53-W2: お守り(charm)効果の解決+開幕適用
    this.zombieCharmEffect = this.config.charm ? getCharmEffect(this.config.charm) : null;
    if (this.zombieCharmEffect?.bonusStartPoints) {
      this.addZombiePoints(this.zombieCharmEffect.bonusStartPoints);
    }
    this.zombieCharmReviveAvailable = (this.zombieCharmEffect?.autoReviveCharges ?? 0) > 0;
    // perkcarry: 引き継ぎパークを1種、購入と同じ経路(applyZombiePerk)で無償付与する
    if (this.config.carriedPerk) {
      this.zombiePerkStacks.set(this.config.carriedPerk, 1);
      this.applyZombiePerk(this.config.carriedPerk, 1);
    }
  }

  private aliveZombieCount(): number {
    let n = 0;
    for (const b of this.bots) if (b.kind === 'zombie' && b.alive) n += 1;
    return n;
  }

  private startZombieRound(r: number): void {
    this.zombieRound = r;
    this.zombieQueue = zombieTotal(r); // 一斉湧き: 次フレームから即バッチ充填開始
    this.zombiePowerUpRoundCount = 0; // R53-W2: ラウンドごとのドロップ上限リセット
    this.zombieSpecialRound = specialRoundKind(r); // R53-W2: rush判定(ボスラウンドとは排他。zombie.ts契約)
    this.announcements.push(`ラウンド ${r}`);
    this.tracker.onZombieRoundStart(); // R45a
    // R53-W3 M3: MK.IIIモーメント(ラウンド遷移=BO2の象徴的瞬間)
    this.moments.push({ kind: 'round', title: String(r), sub: 'ROUND' });
    if (this.zombieSpecialRound === 'rush') {
      this.announcements.push('餓鬼の大群、来襲'); // W4C I-1: バナー/モーメントと呼称統一
      this.sounds.specialRoundStart();
      this.moments.push({ kind: 'special', title: '餓鬼の大群', tone: 'ember' });
    }
    if (isBossRound(r)) {
      this.spawnBossZombie(r);
      this.announcements.push('BOSS ROUND');
      this.announcements.push('巨躯来襲');
      this.addShake(0.4);
      this.sounds.heartbeat(); // R45a: 咆哮代替SE
      this.addShake(1.5);
      this.sounds.hurt();
      this.zombieBossFlash = 1.0;
    }
  }

  private spawnBossZombie(r: number): void {
    const spawn = this.zombieSpawnPoint();
    if (!spawn) return;
    const hp = zombieBossHp(r);
    const dmg = zombieBossDamage(r);
    const speedMul = zombieBossSpeedMul(r);
    const base = tuningFor('normal', this.config.difficulty);
    const tuning: BotTuning = {
      ...base,
      maxHp: hp,
      moveSpeedMul: ZOMBIE_MOVE_MUL * speedMul,
    };
    const bot = this.spawnBot('巨躯', spawn, 0x3a1a0d, ENEMY_TEAM, tuning, 'boss', 'zombie');
    // R51バグ根治: spawnBot 内で hellMode 補正済みの damage を、この直後の代入が生値 dmg で
    // 無条件上書きしていた(hellMode でもボスの攻撃力×2.5が一切効かない状態だった)
    bot.tuning.damage = this.config.hellMode ? Math.round(dmg * 2.5) : dmg;
    bot.zombieRunMul = speedMul;
    this.zombieBossBot = bot;
  }

  // 毎フレーム(handleRespawns後): 死体解放→影LOD→ラウンド進行(ドリップ湧き/クリア判定)
  private updateZombieDirector(dt: number): void {
    // 死体解放を最初に(Rapier handle再利用でnewゾンビが無敵化するのを防ぐ)
    this.cleanupDeadZombies();
    // ボス出現フラッシュ減衰
    if (this.zombieBossFlash > 0) {
      this.zombieBossFlash = Math.max(0, this.zombieBossFlash - dt * 3.0);
    }
    // (影LODは★1で全モード共通化し update() 側で駆動。ここでの個別運用は廃止)
    if (this.over) return;

    if (this.zombieRoundCooldown > 0) {
      this.zombieRoundCooldown -= dt;
      if (this.zombieRoundCooldown <= 0) this.startZombieRound(this.zombieRound + 1);
      return;
    }
    if (this.zombieRound === 0) {
      // R27: 任意ラウンド開始。開始ラウンド>1 の場合は装備差を補う開始ポイントを付与
      const startRound = Math.max(1, Math.min(999, this.config.zombieStartRound ?? 1));
      if (startRound > 1) {
        const ZOMBIE_CATCHUP_BASE = 500;
        const ZOMBIE_CATCHUP_PER_ROUND = 300;
        const ZOMBIE_CATCHUP_CAP = 8000;
        this.zombiePoints = Math.min(ZOMBIE_CATCHUP_CAP, ZOMBIE_CATCHUP_BASE + ZOMBIE_CATCHUP_PER_ROUND * (startRound - 1));
      }
      this.startZombieRound(startRound);
      return;
    }
    const aliveZ = this.aliveZombieCount();
    // 一斉湧き: フレームあたり最大8体まで高速充填(スパイク抑制。体感は即時湧き)
    // alive < tierCap のスロットが出来た瞬間に補充するため、倒した直後も即湧きする。
    if (this.zombieQueue > 0 && aliveZ < this.zombieTierCap) {
      const batchMax = 8;
      let batched = 0;
      // ★4c: 生存ゾンビ位置配列をバッチ開始時に1回だけ構築(毎spawnOneZombie呼び出しでの
      // bots.filter().map()再構築を排除。最大8回/フレームの重複走査を1回へ)
      const aliveZombiePos = this.bots
        .filter((b) => b.kind === 'zombie' && b.alive)
        .map((b) => b.position);
      while (this.zombieQueue > 0 && aliveZ + batched < this.zombieTierCap && batched < batchMax) {
        if (this.spawnOneZombie(aliveZombiePos)) {
          this.zombieQueue -= 1;
          batched += 1;
        } else {
          break; // 有効な湧き点がなければ次フレーム再試行
        }
      }
    }
    // ラウンドクリア: 湧き残0 && 生存0 → 短ジングル後に即次ラウンド
    if (this.zombieQueue === 0 && aliveZ === 0) {
      if (this.zombieRoundCooldown <= 0) {
        // R45a: ラウンドクリアコールバック(遷移初フレームのみ)
        const roundEndOut: MedalEvent[] = [];
        this.tracker.onZombieRoundEnd(roundEndOut);
        this.emitMedals(roundEndOut);
        // R53-W2: 特殊ラウンド(rush)クリア報酬 — 遷移初フレームのみ1回発火
        if (this.zombieSpecialRound === 'rush') {
          this.addZombiePoints(RUSH_CLEAR_BONUS_PT);
          for (const w of this.weapons) w.resupply();
          this.sounds.specialRoundClear();
          this.announcements.push('大群を殲滅！');
        }
      }
      this.zombieRoundCooldown = ZOMBIE_ROUND_COOLDOWN;
    }
  }

  // 湧きリング(プレイヤーの18〜32m外周・フラスタム外)へ1体。HP/速度は tuning に載せて渡す
  // (KIND_TUNING.zombieに maxHp/moveSpeedMul を入れると spawnBot merge で後勝ち上書きされる致命バグ回避)
  // ★ 通常tierはプール優先: resetForZombieReuse で再利用し buildZombieMesh コストをゼロにする。
  // R51: allGiantMode は視覚 scale ×1.35(HP×1.5含む)。collider/meleeReachの拡大はbot.ts側の
  // コンストラクタ時決定が必要なため今回は対象外(master同様、視覚のみ拡大する既存パターンに準拠)。
  // R51-4c: aliveZombiePos はバッチ呼び出し元(updateZombieDirector)が1回だけ構築して渡す
  // 生存ゾンビ位置の共有配列。zombieSpawnPoint内で新規スポーン点をpushし、同一バッチ内の
  // 後続呼び出しからも重なり回避対象として見える(挙動維持)
  private spawnOneZombie(aliveZombiePos: THREE.Vector3[]): boolean {
    const spawn = this.zombieSpawnPoint(aliveZombiePos);
    if (!spawn) return false; // 有効な湧き点が無ければ次フレーム再試行(queueは減らさない)
    const r = this.zombieRound;
    const isRush = this.zombieSpecialRound === 'rush';
    const elite = this.rand() < zombieEliteRate(r);
    // R53-W2: rushラウンドは全個体が走者になる(zombieRunRateの抽選をバイパス)
    const run = isRush ? true : this.rand() < zombieRunRate(r);
    const giant = this.config.allGiantMode ?? false;
    const base = tuningFor('normal', this.config.difficulty);
    const tuning: BotTuning = {
      ...base,
      maxHp: zombieHp(r) * (elite ? 1.6 : 1) * (giant ? 1.5 : 1) * (isRush ? RUSH_HP_MUL : 1),
      moveSpeedMul: ZOMBIE_MOVE_MUL * (elite ? 1.15 : 1),
      scale: giant ? 1.35 : 1,
    };
    const color = elite ? 0x6d7d3a : this.zombieSpawnColor;
    const name = BOT_NAMES[Math.floor(this.rand() * BOT_NAMES.length)] ?? 'ゾンビ';
    // R53-W2: 特殊ゾンビ変種(spawnOneZombieの新規/プール再利用の両経路に適用)
    const variant = rollZombieVariant(r, () => this.rand(), this.aliveMiasmaCount());

    // ★ メッシュプール: 通常tier(=elite でない)かつプールに再利用可能インスタンスがあれば流用
    if (!elite && this.zombiePool.length > 0) {
      const bot = this.zombiePool.pop()!;
      // R51バグ根治: プール再利用は spawnBot の合成漏斗(KIND_TUNING+hellMode)を経由しないため、
      // 従来はプール個体に KIND_TUNING.zombie.damage(22) も hellMode 倍率も一切効いていなかった
      // (常に難度基礎damage=11のまま)。ここで spawnBot と同じ合成を明示的に再現する。
      const merged: BotTuning = { ...tuning, ...KIND_TUNING.zombie };
      const poolTuning = this.config.hellMode ? applyHellTuning(merged) : merged;
      bot.resetForZombieReuse(poolTuning, spawn);
      bot.zombieRunMul = run ? 1.6 : 1;
      if (variant) bot.applyZombieVariantVisual(variant);
      this.assignCrowdSlot(bot); // R53-W3 M3: variant決定後にInstancedMeshスロット割当(協定)
      // tags 再登録(cleanupDeadZombies で削除済み → 新しいcollider handleで再登録)
      this.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
      this.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
      this.scene.add(bot.group);
      this.bots.push(bot);
      return true;
    }

    const bot = this.spawnBot(name, spawn, color, ENEMY_TEAM, tuning, 'normal', 'zombie');
    bot.zombieRunMul = run ? 1.6 : 1; // 走行個体はローカル倍率で加速(moveSpeedはreadonly)
    if (variant) bot.applyZombieVariantVisual(variant);
    this.assignCrowdSlot(bot); // R53-W3 M3: 新規生成経路も同じ協定で割当
    return true;
  }

  // R53-W3 M3: ゾンビ群InstancedMeshのスロット割当(zombie-crowd.ts冒頭ドキュメントの協定)。
  // eligible = kill-switch ON かつ 非boss かつ variant無し。最近接8体(hordeRank<8)は
  // 高忠実度(実articulated影+個体マテリアル)のため除外 — spawn直後はhordeRank=99なので
  // 遠方湧きは即instanced、0.25s後のランク更新で近接だけObject3Dへ戻る
  private assignCrowdSlot(bot: Bot): void {
    if (!this.zombieCrowd) return;
    const eligible = isCrowdEligible(bot.tier, bot.zombieVariant, bot.hordeRank);
    bot.setCrowdSlot(eligible ? this.zombieCrowd.acquire() : -1);
  }

  // 地面Yを下向きレイで確定し、フラスタム外の湧き点を返す(目前でのポップインを避ける)。
  // R21修正: 生存中ゾンビとの最小間隔(1.2m)も確保し、リング湧きでの重なりスタックを防ぐ。
  // R51-4c: aliveZombiePos省略時(ボス湧き等の非バッチ経路)は従来どおり内部で1回構築する。
  // バッチ経路(spawnOneZombie)は呼び出し元が共有配列を渡し、採用したスポーン点をここでpushして
  // 同一バッチ内の以降の試行からも重なり回避対象として見えるようにする(挙動維持)
  private zombieSpawnPoint(aliveZombiePos?: THREE.Vector3[]): THREE.Vector3 | null {
    const size = this.config.stage.size;
    const bound = size / 2 - 2;
    const around = this.player.alive ? this.player.position : new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    // 生存中ゾンビの現在位置(近接スポーンで重なるのを防ぐ)
    const positions =
      aliveZombiePos ??
      this.bots.filter((b) => b.kind === 'zombie' && b.alive).map((b) => b.position);
    const MIN_ZOMBIE_GAP = 1.2;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ang = this.rand() * Math.PI * 2;
      const rad =
        ZOMBIE_SPAWN_RING_MIN + this.rand() * (ZOMBIE_SPAWN_RING_MAX - ZOMBIE_SPAWN_RING_MIN);
      const x = THREE.MathUtils.clamp(around.x + Math.cos(ang) * rad, -bound, bound);
      const z = THREE.MathUtils.clamp(around.z + Math.sin(ang) * rad, -bound, bound);
      const hit = this.castRay(new THREE.Vector3(x, 8, z), down, 20, null);
      const groundY = hit ? 8 - hitToi(hit) : 0;
      // A1-F05: キャットウォーク/建物1Fヒットで上層(y>0.6)に湧くのを防ぐ
      if (groundY > 0.6) continue;
      const p = new THREE.Vector3(x, groundY + 0.05, z);
      if (attempt < 10) {
        // フラスタム内(=プレイヤーの目前)はポップインになるので避ける
        if (this.isInView(p)) continue;
        // 直近スポーンゾンビとの重なりを避ける(最終2試行は妥協)
        if (positions.some((zp) => zp.distanceTo(p) < MIN_ZOMBIE_GAP)) continue;
      }
      positions.push(p); // 同一バッチ内の後続呼び出しへ即反映(呼び出し元が共有配列を渡した場合)
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
  // (b)垂直差・(c)LOSチェック追加: オブジェクト上のプレイヤーへの誤ヒットを防ぐ
  private zombieMelee(bot: Bot): void {
    if (bot.kind !== 'zombie' && bot.kind !== 'giant' && bot.kind !== 'master') return;
    if (!this.player.alive) return;
    const now = this.elapsed;
    if (now < this.zombieMeleeIframe || now < this.zombieMeleeGlobal) return;
    // (b) 垂直差チェック: プレイヤーが1.5m以上高い/低い位置にいたら届かない
    if (Math.abs(this.player.position.y - bot.position.y) > 1.5) return;
    // (c) LOS チェック: ゾンビ目線からプレイヤーへのレイが world/プロップに遮られていたら届かない
    const zombieEye = bot.position.clone();
    zombieEye.y += 1.5;
    const toPlayer = this.player.position.clone().sub(zombieEye);
    const meleeDist = toPlayer.length();
    if (meleeDist > 0.3) {
      const losHit = this.castRay(zombieEye, toPlayer.clone().normalize(), meleeDist - 0.3, bot.body);
      if (losHit) {
        const tag = this.tags.get(losHit.collider.handle);
        // undefined(タグなし)= 静的コライダー、world/boundary = 地形/プロップ → LOS遮断
        if (tag === undefined || tag.kind === 'world' || tag.kind === 'boundary') return;
      }
    }
    const dmg = bot.tuning.damage;
    if (this.config.mode === 'training') return;
    const died = this.player.takeDamage(dmg);
    this.tookDamage = true;
    this.haptic(90, 0.5, 0.6);
    this.addShake(0.18);
    this.addUltCharge(dmg * ULT_ON_DAMAGE_PER_HP);
    this.incoming.push(this.incomingAngle(bot.position));
    this.sounds.hurt();
    this.tracker.onPlayerDamaged();
    this.sounds.playerBodyHit(Math.sin(this.incomingAngle(bot.position)), Math.min(1, dmg / 100));
    this.zombieMeleeGlobal = now + ZOMBIE_MELEE_GLOBAL_GAP;
    this.zombieMeleeIframe = now + ZOMBIE_IFRAME;
    if (died) {
      const meleeWeapon = bot.kind === 'giant' ? '巨躯の一撃' : bot.kind === 'master' ? '達人の刃' : 'ゾンビの爪';
      this.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: meleeWeapon, headshot: false });
      this.sounds.death();
      this.notePlayerDeath(bot);
    }
  }

  // 死んで演出も終わったゾンビを解放する。厳密順序: tags削除 → dispose/pool → scene除去 → splice。
  // tagsを先に消さないと解放済みhandleの再利用で旧タグが新ゾンビのcolliderを旧Botへ解決する。
  // ★ 通常tier(normal)ゾンビはプールへ退避してbuildZombieMeshの再実行を避ける。
  // elite/bossは色が異なるため dispose して毎回生成する(出現頻度が低いので許容)。
  private cleanupDeadZombies(): void {
    for (let i = this.bots.length - 1; i >= 0; i -= 1) {
      const b = this.bots[i]!;
      if (b.kind !== 'zombie' || !b.corpseCleared) continue;
      this.tags.delete(b.bodyCollider.handle);
      this.tags.delete(b.headCollider.handle);
      for (const c of b.extraColliders) this.tags.delete(c.handle);
      // R53-W3 M3: InstancedMeshスロットを先に返却(協定: release→setCrowdSlot(-1)の順)
      if (b.crowdSlot >= 0 && this.zombieCrowd) {
        this.zombieCrowd.release(b.crowdSlot);
        b.setCrowdSlot(-1);
      }
      // 通常tierかつプール未満ならプールへ退避(再利用でbuildZombieMesh削減)
      if (b.tier === 'normal' && this.zombiePool.length < ZOMBIE_POOL_MAX) {
        this.scene.remove(b.group);
        this.zombiePool.push(b);
      } else {
        b.dispose();
        this.scene.remove(b.group);
      }
      this.bots.splice(i, 1);
    }
    // ボスbot参照が解放済みなら null へ
    if (this.zombieBossBot && !this.bots.includes(this.zombieBossBot)) {
      this.zombieBossBot = null;
    }
  }

  // ★1 近接≤8体のみ影を落とす距離LOD(多数の影パス/mapSize churnを抑える)。
  // ゾンビ専用だった運用を全モード/全kindへ一般化(全巨躯54体で影DC162→24)。
  // aliveのみ再判定し、死亡演出中の個体は直近フラグを維持する(従来と同じ)
  private updateBotShadowLOD(): void {
    const alive: Bot[] = [];
    const d2: number[] = [];
    const cam = this.camera.position;
    for (const b of this.bots) {
      if (!b.alive) continue;
      alive.push(b);
      d2.push(b.getPositionInto(BOT_POS_SCRATCH).distanceToSquared(cam)); // ★5 割り当てゼロ
    }
    const flags = shadowLodFlags(d2, SHADOW_CASTER_CAP);
    for (let i = 0; i < alive.length; i += 1) alive[i]!.setCastShadow(flags[i]!);
  }

  // ★5 群衆ランク書き込み(R100高密度対策・R51-4e): ★1影LODと同じ0.25s周期で、生存ゾンビを
  // プレイヤー距離の近い順に bot.hordeRank へ書き込む(0=最近接)。死亡/非ゾンビは99固定。
  // distToPlayer は updateBots と同型のアロケーション最小パターン(BOT_POS_SCRATCH再利用)を踏襲
  private updateZombieHordeRank(): void {
    const playerPos = this.player.position;
    const zAlive: Bot[] = [];
    const d2: number[] = [];
    for (const b of this.bots) {
      if (b.kind !== 'zombie' || !b.alive) {
        b.hordeRank = 99;
        continue;
      }
      zAlive.push(b);
      d2.push(b.getPositionInto(BOT_POS_SCRATCH).distanceToSquared(playerPos)); // ★5 割り当てゼロ
    }
    const ranks = zombieHordeRanks(d2);
    for (let i = 0; i < zAlive.length; i += 1) zAlive[i]!.hordeRank = ranks[i]!;
    // R53-W3 M3: 最近接8体⇔群の動的切替(両経路は式同一=ポップなし)。
    // rank<8はObject3D(実articulated影+個体忠実度)、rank>=8はInstancedMeshへ
    if (this.zombieCrowd) {
      for (const b of zAlive) {
        // R54-W1 Q8: ヒステリシス判定(rank7-9はデッドバンド=チャタリング防止)
        const action = crowdSlotAction(
          b.hordeRank,
          b.crowdSlot >= 0,
          isCrowdEligible(b.tier, b.zombieVariant, b.hordeRank),
        );
        if (action === 'release') {
          this.zombieCrowd.release(b.crowdSlot);
          b.setCrowdSlot(-1);
        } else if (action === 'acquire') {
          b.setCrowdSlot(this.zombieCrowd.acquire());
        }
      }
    }
  }

  // R53-W3 M3: ゾンビ群InstancedMeshの毎フレームfeed(updateBots後に1回)。
  // crowdSlot>=0の個体(生存+死亡演出中)の姿勢をpose→commit。スクラッチ使い回しでアロケゼロ
  private feedZombieCrowd(): void {
    if (!this.zombieCrowd) return;
    for (const b of this.bots) {
      if (b.crowdSlot < 0) continue;
      b.getCrowdPose(CROWD_POSE_SCRATCH);
      this.zombieCrowd.pose(b.crowdSlot, CROWD_POSE_SCRATCH);
    }
    this.zombieCrowd.commit();
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
    // ── R53-W2 M2b: 新objective 3種の初期化 ──
    if (mission.objective.kind === 'infiltrate') {
      // 到達点=最遠隅(exfilPosを流用)。青いビーコンで可視化(extractの緑と区別)
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 14, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x35a0ff,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.position.set(this.exfilPos.x, 7, this.exfilPos.z);
      this.scene.add(beacon);
    }
    if (mission.objective.kind === 'escort') {
      // 護衛対象: プレイヤー側の随伴機。中央経由で最遠隅へ歩かせる
      const start = this.playerSpawns[1] ?? this.playerSpawns[0] ?? new THREE.Vector3();
      const ally = this.spawnBot(
        '随伴機ホタル',
        start.clone(),
        this.colors.ally,
        PLAYER_TEAM,
        tuningFor('elite', 'normal'),
        'elite',
        'humanoid',
      );
      const mid = new THREE.Vector3(0, 0, 0);
      this.escortGoal = this.exfilPos.clone();
      ally.escortWaypoints = [mid, this.escortGoal.clone()];
      this.escortBot = ally;
    }
    if (mission.objective.kind === 'collect') {
      // 回収物: botSpawns から散らばった N 点(障害物クリアランス済み座標)に発光オクタを置く
      const n = mission.objective.count ?? 3;
      for (let i = 0; i < n; i += 1) {
        const base = this.botSpawns[(i * 2 + 1) % this.botSpawns.length] ?? new THREE.Vector3();
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.34),
          new THREE.MeshStandardMaterial({
            color: 0x223344,
            emissive: 0x35d0ff,
            emissiveIntensity: 0.5,
          }),
        );
        mesh.position.set(base.x, 1.1, base.z);
        this.scene.add(mesh);
        this.collectItems.push({ pos: new THREE.Vector3(base.x, 1.1, base.z), mesh });
      }
    }
    // ── R53-W2 M2b: 無線劇のロード。at.event==='start' はここで即時キューへ ──
    this.radioQueue = (mission.radio ?? []).slice();
    this.fireRadioEvent('start');
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
      else if (wave.trigger === 'boss-hp') {
        // R53-W2 M2b: ボスHPが閾値以下になった瞬間に発火(ch10ボスラッシュ等)。
        // ボス不在(未出現)の間は待機、ボス死亡後(bossHp01=undefined)は即発火して波を詰まらせない
        const hp01 = this.bossHp01();
        ready = hp01 === undefined ? !this.bots.some((b) => b.tier === 'boss' && b.alive) && this.waveIndex > 0 : hp01 <= (wave.triggerHp01 ?? 0.5);
      } else {
        ready = this.aliveEnemyCount() === 0; // 'wave-clear'
        if (ready) this.fireRadioEvent('wave-clear');
      }
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
        // A1-F04: ステージ外に出ないよう ±(size/2-5) にクランプ
        const wrap = Math.floor(cursor / this.botSpawns.length);
        const halfSize = (this.config.stage.size ?? 100) / 2 - 5;
        const spawn =
          wrap > 0
            ? new THREE.Vector3(
                THREE.MathUtils.clamp(baseSpawn.x + Math.cos(cursor * 1.7) * 2.5 * wrap, -halfSize, halfSize),
                baseSpawn.y,
                THREE.MathUtils.clamp(baseSpawn.z + Math.sin(cursor * 1.7) * 2.5 * wrap, -halfSize, halfSize),
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
        // ★W4B: 章ボスのHP倍率(EnemyGroupDef.hpMul)。tuning.maxHpへ乗算しておけば
        // spawnBot内のboss床 max(merged.maxHp, tuning.maxHp) が乗算後の値を採用する
        const waveTuning = tuningFor(tier, group.difficulty);
        if (group.hpMul !== undefined && group.hpMul !== 1) {
          waveTuning.maxHp = Math.round(waveTuning.maxHp * group.hpMul);
        }
        const spawned = this.spawnBot(
          name,
          spawn,
          this.colors.enemy,
          ENEMY_TEAM,
          waveTuning,
          tier,
          kind,
        );
        // R54-W1 Q4: story帝王編の燼骸(kind='zombie')は少数編成が設計意図のため、群衆間引き
        // LOD(既定hordeRank=99=最遠扱い)を外し常時フル精度で描画する。zombieモード本編は
        // updateZombieHordeRank が0.25s周期で上書きするため対象外(spawnWave専用の初期値上書き)
        if (kind === 'zombie') spawned.hordeRank = 0;
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
        if (this.missionEliminateCount(obj) >= (obj.count ?? 1)) this.missionOutcome = 'won';
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
      // ── R53-W2 M2b: 新objective 3種 ──
      case 'infiltrate': {
        // 到達点(exfilPos流用)へ到達で達成。発覚(SPOTTED)は即敗北ではなく増援1回(親切設計)
        if (this.player.alive && this.player.position.distanceTo(this.exfilPos) < 4) {
          this.missionOutcome = 'won';
        }
        if (!this.infiltrateReinforced && this.maxEnemySpotAwareness() >= 0.9) {
          this.infiltrateReinforced = true;
          this.announcements.push('発覚: 増援接近');
          this.spawnWave({
            trigger: 'start',
            enemies: [{ tier: 'normal', count: 3, difficulty: m.difficulty }],
          });
        }
        break;
      }
      case 'escort': {
        const ally = this.escortBot;
        if (!ally || !ally.alive) {
          this.missionOutcome = 'lost';
          break;
        }
        if (this.escortGoal && ally.position.distanceTo(this.escortGoal) < 3.5) {
          this.missionOutcome = 'won';
        }
        break;
      }
      case 'collect': {
        if (this.missionCollected >= (obj.count ?? this.collectItems.length + this.missionCollected)) {
          this.missionOutcome = 'won';
        }
        break;
      }
    }
    // R53-W2 M2b: ストーリー帝王編の毎tick進行(無線/ボスフェーズ/回収物の見た目)
    this.updateStoryEngine(dt);
    if (this.missionOutcome === 'won') this.onMissionWon();
  }

  // R53-W2 M2b: 敵bot(ENEMY_TEAM)の最大発見メータ(infiltrateのdetect01供給)
  private maxEnemySpotAwareness(): number {
    let max = 0;
    for (const b of this.bots) {
      if (!b.alive || b.team === PLAYER_TEAM) continue;
      if (b.spotAwareness > max) max = b.spotAwareness;
    }
    return Math.min(1, max);
  }

  // R53-W2 M2b: 勝利確定時の単発処理(章クリアメダル+objective-done無線)。
  // updateMission は outcome!=='pending' で以後早期returnするため、この関数は勝利遷移の
  // まさにそのtickに1回だけ呼ばれる
  private onMissionWon(): void {
    this.fireRadioEvent('objective-done');
    const id = this.mission?.id ?? '';
    // 章最終ミッションのクリア=章制覇メダル(報酬カモ/称号はprogression側が自動処理)。
    // emitManual→emitMedals はPaPと同じ流儀(XP/バッジ/アナウンスの既存経路に乗せる)
    if (id.startsWith('c9m6') || id.startsWith('c10m6')) {
      const out: MedalEvent[] = [];
      this.tracker.emitManual(id.startsWith('c9m6') ? 'ch9-clear' : 'ch10-clear', out);
      this.emitMedals(out);
    }
  }

  // 目的の表示文言と進捗(HUD用)
  // ★V-B MEDIUM修正: eliminate-countの実カウント。bossOnly(c10m5ボスラッシュ)は護衛elite等の
  // 巻き込みキルで早期達成しないよう boss tier撃破のみを数える。既定=従来の総キル
  private missionEliminateCount(obj: ObjectiveDef): number {
    return obj.bossOnly ? this.missionBossKills : this.missionKills;
  }

  private objectiveText(): string {
    const m = this.mission;
    if (!m) return '';
    const obj = m.objective;
    if (obj.kind === 'eliminate-count')
      return `${obj.label} (${this.missionEliminateCount(obj)}/${obj.count ?? 0})`;
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      const left = Math.max(0, Math.ceil((obj.surviveS ?? m.durationS) - this.missionTimeS));
      return `${obj.label} (残り${left}s)`;
    }
    if (obj.kind === 'extract' && this.exfilTimer > 0) return `${obj.label} (確保 ${this.exfilTimer.toFixed(1)}s/3s)`;
    // R53-W2 M2b: 新objective 3種の進捗文言
    if (obj.kind === 'collect') return `${obj.label} (${this.missionCollected}/${obj.count ?? 0})`;
    if (obj.kind === 'infiltrate' && this.maxEnemySpotAwareness() >= 0.9) return `${obj.label} 【発覚】`;
    if (obj.kind === 'escort' && this.escortBot) {
      const hp01 = Math.max(0, Math.ceil((this.escortBot.hp / this.escortBot.maxHp) * 100));
      return `${obj.label} (随伴機 ${hp01}%)`;
    }
    return obj.label;
  }

  private objectiveProgress01(): number {
    const m = this.mission;
    if (!m) return 0;
    const obj = m.objective;
    if (obj.kind === 'eliminate-count' && obj.count)
      return Math.min(1, this.missionEliminateCount(obj) / obj.count);
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      return Math.min(1, this.missionTimeS / (obj.surviveS ?? m.durationS));
    }
    if (obj.kind === 'extract') return Math.min(1, this.exfilTimer / 3);
    // R53-W2 M2b: 新objective 3種の進捗
    if (obj.kind === 'collect' && obj.count) return Math.min(1, this.missionCollected / obj.count);
    if (obj.kind === 'infiltrate') {
      // 到達距離ベース(開始点=最初のプレイヤースポーンからexfilまでを1とする近似)
      const start = this.playerSpawns[0];
      if (!start) return 0;
      const total = start.distanceTo(this.exfilPos);
      const left = this.player.position.distanceTo(this.exfilPos);
      return total > 0 ? THREE.MathUtils.clamp(1 - left / total, 0, 1) : 0;
    }
    if (obj.kind === 'escort' && this.escortBot && this.escortGoal) {
      const start = this.playerSpawns[1] ?? this.playerSpawns[0];
      if (!start) return 0;
      const total = start.distanceTo(this.escortGoal);
      const left = this.escortBot.position.distanceTo(this.escortGoal);
      return total > 0 ? THREE.MathUtils.clamp(1 - left / total, 0, 1) : 0;
    }
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

  // ══ R53-W2 M2b: ストーリー帝王編エンジン ═══════════════════════════════
  // updateMission から毎tick呼ばれる(mission確定時のみ)。無線劇・ボスフェーズ・回収物の
  // 「進行」だけを担い、重いロジック(台本/フェーズ定義)は campaign.ts のデータ、
  // 挙動プリミティブ(applyBossPhase/blinkTo等)は bot.ts の公開APIに委譲する薄い配線。
  private updateStoryEngine(dt: number): void {
    this.updateRadio(dt);
    this.updateBossPhases(dt);
    // 回収物の回転(視認性)。ダメージ等は持たない演出のみ
    for (const item of this.collectItems) item.mesh.rotation.y += dt * 1.8;
    // collectのEインタラクト(ゾンビEと同じキー。storyではケアパッケージと共存 — 距離判定が排他)
    if (
      this.mission?.objective.kind === 'collect' &&
      this.player.alive &&
      this.input.wasPressed('interact')
    ) {
      const pp = this.player.position;
      for (let i = this.collectItems.length - 1; i >= 0; i -= 1) {
        const item = this.collectItems[i]!;
        if (pp.distanceTo(item.pos) > 2.2) continue;
        this.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        (item.mesh.material as THREE.Material).dispose();
        this.collectItems.splice(i, 1);
        this.missionCollected += 1;
        this.sounds.capture(); // 既存の確保ジングルを流用(回収の手応え)
        this.announcements.push(`回収 ${this.missionCollected}/${this.mission.objective.count ?? 0}`);
        break;
      }
    }
  }

  // 無線イベント発火: 該当する未発火行を表示待ちキューへ移す(データ順を維持)
  private fireRadioEvent(event: 'start' | 'boss-hp50' | 'wave-clear' | 'objective-done'): void {
    if (this.radioQueue.length === 0) return;
    const { fired, rest } = splitRadioLines(this.radioQueue, { event });
    for (const line of fired) this.radioPending.push({ speaker: line.speaker, text: line.text });
    this.radioQueue = rest;
  }

  private updateRadio(dt: number): void {
    // 時刻トリガーの行を表示待ちへ
    if (this.radioQueue.length > 0) {
      const { fired, rest } = splitRadioLines(this.radioQueue, { timeS: this.missionTimeS });
      for (const line of fired) this.radioPending.push({ speaker: line.speaker, text: line.text });
      this.radioQueue = rest;
    }
    // boss-hp50 イベント(単発)
    if (!this.radioBossHp50Fired) {
      const hp01 = this.bossHp01();
      if (hp01 !== undefined && hp01 <= 0.5) {
        this.radioBossHp50Fired = true;
        this.fireRadioEvent('boss-hp50');
      }
    }
    // 表示中の行の寿命
    if (this.radioCurrent) {
      this.radioCurrentTimer -= dt;
      if (this.radioCurrentTimer <= 0) {
        this.radioCurrent = null;
        this.radioGapTimer = 1; // 行間1s
      }
      return;
    }
    if (this.radioGapTimer > 0) {
      this.radioGapTimer -= dt;
      return;
    }
    // 次の行を表示+発話(TTS無効環境でも字幕は snapshot.radioLine で必ず出る)
    const next = this.radioPending.shift();
    if (next) {
      this.radioCurrent = next;
      this.radioCurrentTimer = 5;
      this.sounds.radioSpeak(next.speaker, next.text);
    }
  }

  // ボスフェーズ: HP閾値通過で campaign.ts の bossPhases を順に適用し、
  // アクティブなフェーズ挙動(blackSlash/blink/pillars)を周期実行する
  private updateBossPhases(dt: number): void {
    const phases = this.mission?.bossPhases;
    if (!phases || phases.length === 0) return;
    const isKurogane = (this.mission?.id ?? '').startsWith('c10m6');
    // ボス参照の解決(未出現→出現の遷移を拾う)
    if (!this.bossPhaseRef || !this.bots.includes(this.bossPhaseRef)) {
      this.bossPhaseRef = this.bots.find((b) => b.tier === 'boss') ?? null;
    }
    const boss = this.bossPhaseRef;
    if (!boss) return;
    // 撃破検知(単発): クロガネなら専用の終焉音+メダル
    if (!boss.alive) {
      if (!this.bossPhaseDefeatNoted) {
        this.bossPhaseDefeatNoted = true;
        if (isKurogane) {
          this.sounds.kuroganeDefeat();
          const out: MedalEvent[] = [];
          this.tracker.emitManual('kurogane-slayer', out);
          this.emitMedals(out);
        }
      }
      return;
    }
    // フェーズ遷移(hp01降順データ。1tickに1段のみ=多段同時通過でも順に演出される)
    const hp01 = boss.hp / boss.maxHp;
    const next = phases[this.bossPhaseIdx];
    if (next && hp01 <= next.hp01) {
      this.bossPhaseIdx += 1;
      this.applyBossPhaseTransition(boss, next, isKurogane);
    }
    // アクティブフェーズ挙動
    const flags = boss.bossPhaseFlags;
    if (flags.blackSlash) {
      this.bossSlashTimer -= dt;
      if (this.bossSlashTimer <= 0 && this.player.alive && boss.alive) {
        this.bossSlashTimer = 4;
        this.spawnHostileBossSlash(boss);
      }
    }
    if (flags.blink) {
      this.bossBlinkTimer -= dt;
      if (this.bossBlinkTimer <= 0 && this.player.alive) {
        this.bossBlinkTimer = 6.5;
        // プレイヤー側面へ転移(左右は交互ではなくヨー基準の右側=読み合いの余地を残す)
        const yaw = this.player.yaw;
        const px = this.player.position.x + Math.cos(yaw) * BOSS_BLINK_OFFSET_M;
        const pz = this.player.position.z - Math.sin(yaw) * BOSS_BLINK_OFFSET_M;
        this.effects.darkSlashSmoke(boss.position.clone()); // 出発点の残煙
        boss.blinkTo(px, boss.position.y, pz);
        this.effects.darkSlashSmoke(new THREE.Vector3(px, boss.position.y, pz));
        this.sounds.darkSlash();
      }
    }
    if (flags.pillars) {
      this.bossPillarTimer -= dt;
      if (this.bossPillarTimer <= 0 && this.player.alive) {
        this.bossPillarTimer = 5;
        // プレイヤー近傍±3mへ黒雷柱(既存キル柱FXの流用)。直下回避の猶予がある小AoE
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 3;
        const pos = new THREE.Vector3(
          this.player.position.x + Math.cos(ang) * r,
          this.player.position.y,
          this.player.position.z + Math.sin(ang) * r,
        );
        this.effects.kokuraiteiKillColumn(pos);
        const d = this.player.position.distanceTo(pos);
        if (d < BOSS_PILLAR_RADIUS_M && this.player.alive) {
          const died = this.player.takeDamage(BOSS_PILLAR_DAMAGE);
          this.tookDamage = true;
          this.incoming.push(this.incomingAngle(pos));
          this.sounds.hurt();
          this.tracker.onPlayerDamaged();
          if (died) {
            this.feed.push({ killer: boss.name, victim: PLAYER_NAME, weapon: '黒雷柱', headshot: false });
            this.sounds.death();
            this.notePlayerDeath(boss);
          }
        }
      }
    }
  }

  private applyBossPhaseTransition(boss: Bot, phase: BossPhase, isKurogane: boolean): void {
    boss.applyBossPhase(phase.speedMul, phase.damageMul);
    boss.setBossPhaseFlags({
      blackSlash: phase.blackSlash ?? false,
      blink: phase.blink ?? false,
      pillars: phase.pillars ?? false,
    });
    if (phase.announce) this.announcements.push(phase.announce);
    // クロガネ専用: フェーズ2/3のスティング(bossPhaseIdxは遷移後の段数=2段目→2)
    if (isKurogane && (this.bossPhaseIdx === 2 || this.bossPhaseIdx === 3)) {
      this.sounds.kuroganePhase(this.bossPhaseIdx as 2 | 3);
    }
    // 増援召喚(章の絵に合わせ humanoid。少数=フェーズの脅威はボス本体が主役)
    const summon = phase.summonCount ?? 0;
    for (let i = 0; i < summon; i += 1) {
      const spawn = this.botSpawns[(this.waveSpawnCursor + i) % this.botSpawns.length];
      if (!spawn) continue;
      this.spawnBot(
        `增援-${i + 1}`,
        spawn.clone(),
        this.colors.enemy,
        ENEMY_TEAM,
        tuningFor('normal', this.mission?.difficulty ?? 'normal'),
        'normal',
        'humanoid',
      );
    }
    this.waveSpawnCursor += summon;
    // フェーズ遷移の画: ボス足元に柱1本(演出のみ、ダメージなし)
    this.effects.kokuraiteiKillColumn(boss.position.clone());
    this.addShake(0.3);
  }

  // ボスの敵対黒斬撃: プレイヤーの現在位置へ向けて水平発射(既存の黒帝斬撃資産を敵起点で流用)
  private spawnHostileBossSlash(boss: Bot): void {
    const origin = boss.position.clone();
    origin.y += 1.5;
    const dir = this.player.position.clone().sub(origin);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    if (this.darkSlashWaves.length >= DARK_SLASH_MAX) {
      const oldest = this.darkSlashWaves.shift()!;
      this.disposeDarkSlashWave(oldest);
    }
    const group = this.effects.darkSlashWave(origin, dir, 0);
    this.darkSlashWaves.push({
      group,
      pos: origin,
      dir,
      traveled: 0,
      hitSet: new Set(),
      smokeTimer: 0,
      hitRadius: DARK_SLASH_RADIUS,
      hostile: true,
      hitPlayer: false,
      hostileOwnerName: boss.name,
      // ボスフェーズの damageMul は「基準34×現フェーズ倍率」で反映(bot.tuning.damageは近接用)
      dmgOverride: Math.round(HOSTILE_SLASH_DAMAGE * (this.mission?.bossPhases?.[this.bossPhaseIdx - 1]?.damageMul ?? 1)),
    });
    this.sounds.darkSlash();
  }

  // 指定チームから見た敵対エンティティの現在位置一覧
  private hostilesOf(team: TeamId): THREE.Vector3[] {
    const positions = this.bots.filter((b) => b.alive && b.team !== team).map((b) => b.position);
    if (team !== PLAYER_TEAM && this.player.alive) positions.push(this.player.position);
    return positions;
  }

  // 敵から最も離れた地点に湧く。occupants(生存中の全キャラ+このフレームで既に確保済みの
  // スポーン位置)との最小距離が MIN_SPAWN_GAP 未満の候補は除外し、同フレーム同時リスポーンで
  // 複数 bot が同じ地点に重なるスタックバグを根治する。全候補が占有済みのフォールバックでは
  // 敵最遠の地点に決定論的な小オフセットを加えて重なりを散らす。
  private pickSpawn(
    candidates: THREE.Vector3[],
    enemies: THREE.Vector3[],
    occupants: THREE.Vector3[] = [],
  ): THREE.Vector3 {
    const MIN_SPAWN_GAP = 1.2; // 生存キャラ・直前スポーンからの必要最小距離(m)
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    let fallback: THREE.Vector3 | null = null;
    let fallbackScore = -Infinity;
    for (const c of candidates) {
      // ② BO2式スポーンスコアリング: 敵から40-70mを最高点(旧: 敵最遠スコア)
      const nearEnemy = enemies.length
        ? Math.min(...enemies.map((e) => e.distanceTo(c)))
        : 55; // 敵ゼロは中距離リスポーンとして扱う
      const score = spawnDistScore(nearEnemy);
      const minOcc = occupants.length
        ? Math.min(...occupants.map((o) => o.distanceTo(c)))
        : Infinity;
      if (minOcc >= MIN_SPAWN_GAP && score > bestScore) {
        bestScore = score;
        best = c;
      }
      if (score > fallbackScore) {
        fallbackScore = score;
        fallback = c;
      }
    }
    if (best) return best;
    // 全候補が近接占有 → 最高スコア地点に決定論的な小オフセットを加えてスタックを散らす
    const base = fallback ?? candidates[0] ?? new THREE.Vector3();
    return new THREE.Vector3(
      base.x + (this.rand() - 0.5) * 0.8,
      base.y,
      base.z + (this.rand() - 0.5) * 0.8,
    );
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
      // W4C C-2: S&D はラウンド状態機械が時間を管理する(共有timeLeftは凍結)ため、
      // 上部タイマーへ現フェーズ残時間(=攻撃側の設置期限/ヒューズ)を流す
      timeLeft: this.sndRound ? this.sndRound.phaseTimeLeft : this.timeLeft,
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
      // ガンゲーム: score = rank(1-20) をオーバーライド
      scoreMine: this.ggState ? this.ggState.getPlayerRank() : this.scores.get(PLAYER_TEAM),
      scoreEnemy: this.ggState ? this.ggState.topBotRank(this.bots.map((b) => b.uid)) : this.enemyTopScore(),
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
      fkCinematicActive: this.killcam.playing,
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
      bossHp01: (() => {
        if (this.mission) return this.bossHp01();
        if (this.config.mode === 'zombie' && this.zombieBossBot?.alive) {
          return this.zombieBossBot.hp / this.zombieBossBot.maxHp;
        }
        return undefined;
      })(),
      // ── R53-W3 M3: MK.III HUD(Fable#3消費。uiHeatは全モード供給) ──
      uiHeat: this.uiHeat,
      moments: this.moments,
      emperorState: this.isNinja ? (() => { const k = this.activeKit(); return k === 'none' ? null : k; })() : null,
      // ── R53-W2 M2b: ストーリー帝王編(mission時のみ) ──
      radioLine: this.mission ? this.radioCurrent : undefined,
      detect01: this.mission?.objective.kind === 'infiltrate' ? this.maxEnemySpotAwareness() : undefined,
      bossPhase:
        this.mission?.bossPhases && this.mission.bossPhases.length > 0 && this.bossPhaseIdx > 0
          ? { idx: this.bossPhaseIdx, total: this.mission.bossPhases.length }
          : undefined,
      // ── R53-W2 M2b: S&D(mode==='snd'のみ。H2契約: sndScore=[自,敵]・先取4) ──
      sndPhase: this.sndRound?.phase,
      sndScore: this.sndMatch
        ? [this.sndMatch.scoreOf(PLAYER_TEAM), this.sndMatch.scoreOf(ENEMY_TEAM)]
        : undefined,
      sndBombTimer:
        this.sndRound?.phase === 'planted' ? this.sndRound.phaseTimeLeft : undefined,
      sndProgress01:
        this.sndPlayerHolding === 'plant'
          ? this.sndRound?.plantProgress01
          : this.sndPlayerHolding === 'defuse'
            ? this.sndRound?.defuseProgress01
            : undefined,
      sndProgressKind: this.sndPlayerHolding ?? undefined,
      sndCarrierIsPlayer: this.sndRound ? this.sndRound.carrierUid === -1 : undefined,
      // ── R16 ゾンビ(mode!=='zombie'では undefined)──
      zombieRound: this.config.mode === 'zombie' ? this.zombieRound : undefined,
      zombieKills: this.config.mode === 'zombie' ? this.zombieKills : undefined,
      zombiePoints: this.config.mode === 'zombie' ? this.zombiePoints : undefined,
      playerDowns: this.config.mode === 'zombie' ? this.playerDowns : undefined,
      zombieShopPrompt: this.config.mode === 'zombie' ? (this.zombieShopPrompt ?? undefined) : undefined,
      zombiePerks: this.config.mode === 'zombie' ? Array.from(this.zombiePerkStacks.keys()) : undefined,
      zombiePerkStacks: this.config.mode === 'zombie' ? (Object.fromEntries(this.zombiePerkStacks.entries()) as Partial<Record<ZombiePerkId, number>>) : undefined,
      zombieQuickReviveCharges: this.config.mode === 'zombie' ? this.zombieQuickReviveCharges : undefined,
      zombieBossFlash: this.config.mode === 'zombie' && this.zombieBossFlash > 0 ? this.zombieBossFlash : undefined,
      zombiePointFloats: this.config.mode === 'zombie' ? this.zombiePointFloats : undefined,
      zombieReviveFlash: this.config.mode === 'zombie' && this.zombieReviveFlash > 0 ? this.zombieReviveFlash : undefined,
      // ── R53-W2 Pack-a-Punch/パワーアップ/特殊ラウンド/毒霧 ──
      papTier: this.config.mode === 'zombie' ? (this.zombiePapTiers.get(this.activeWeapon.def.id) ?? 0) : undefined,
      // W4D: zombiePowerUps は HUD が意図的に未描画(3Dビーコンで視認)のため供給を停止
      // (毎レンダフレームの配列アロケ浪費を根絶。snapshot型のoptionalフィールドは温存)
      activePowerUps: this.config.mode === 'zombie' ? this.zombieActivePowerUpsSnap() : undefined,
      specialRound: this.config.mode === 'zombie' ? this.zombieSpecialRound : undefined,
      poison01: this.config.mode === 'zombie' ? this.zombiePoison01 : undefined,
      darkEmperorS: this.isNinja && this.darkEmperorTimer > 0 && isFinite(this.darkEmperorTimer) ? Math.ceil(this.darkEmperorTimer) : (this.isNinja && this.darkEmperorTimer > 0 ? 1 : undefined),
      darkEmperorPermanent: this.isNinja && !isFinite(this.darkEmperorTimer) ? true : undefined,
      raiteiMode: this.isNinja && this.raiteiMode ? true : undefined,
      kokuraiteiMode: this.isNinja && this.kokuraiteiMode ? true : undefined,
      chargeRatio: this.isNinja && this.isCharging
        ? Math.min(1, this.chargeTimer / this.chargeMaxS()) // R53-W3 M3: 黒雷帝は2.2s(天壊)満充填
        : this.exoticHoldFireCharging
          ? Math.min(1, this.exoticHoldFireTimer / 1.2)
          : this.shuraRampageTimer > 0 ? 1
            : this.shuraChargeTimer > 0 ? this.shuraChargeTimer
              : undefined,
      // 修羅スピンアップRPMゲージ(minigun装備+スピン>0のみ供給。0..1=currentRpm/def.rpm)
      minigunSpin01:
        weapon.def.special === 'minigun' && this.minigunCurrentRpm > 0
          ? Math.min(1, this.minigunCurrentRpm / weapon.def.rpm)
          : undefined,
      // T7: minigun(修羅)/fan(風神扇)はADSでスコープに入らずブレース姿勢のまま
      // なので、HUD側の全画面クロスヘアを消さない。shapeは他武器と共有され非一意なため、
      // 一意な special で判定する。W1-D1実査: 蜃気楼(beam)は正規のscope-in経路
      // (scopeReveal→root非表示)を持ち閉塞バグと無関係=対象外。真の第二被害者は風神扇
      adsKeepsCrosshair: weapon.def.special === 'minigun' || weapon.def.special === 'fan',
      // ── BO2 スコアストリーク ──
      streakProgress: this.streakManager.state.progress,
      streakBanked: this.streakManager.state.banked,
      streakUavActive: this.uavTimer > 0,
      streakUavTimeLeft: this.uavTimer,
      streakRcxdActive: this.rcxdActive,
      streakRcxdTimeLeft: this.rcxdTimer,
      streakCauavActive: this.cauavTimer > 0,
      streakCauavTimeLeft: this.cauavTimer,
      // ── ミニマップ ──
      fireBlips: this.computeFireBlips(),
      minimapEnemies: this.computeMinimapEnemies(),
      minimapAllies: this.computeMinimapAllies(),
      minimapStageSize: this.config.stage.size,
      // ── ハードポイント ──
      ...this.buildHardpointSnap(),
      // ── キルコンファーム ──
      kcEvent: this.kcState ? this.kcEvent : undefined,
      kcTagPositions: this.kcState ? this.kcDogTagEntities.map((e) => ({
        relX: e.group.position.x - this.player.position.x,
        relZ: e.group.position.z - this.player.position.z,
        isEnemy: e.isEnemy,
      })) : undefined,
      // ── ガンゲーム ──
      ...this.buildGunGameSnap(),
      // ── 訓練場 ──
      trainingStats: this.config.mode === 'training' && this.trainingStats ? {
        dps: this.trainingStats.dps(this.elapsed),
        accuracy: this.trainingStats.accuracy(),
        hsRate: this.trainingStats.hsRate(),
        streak: this.trainingStats.consecutiveHits,
      } : undefined,
      // 破壊済み breakable プロップのハンドルセット(HUD ミニマップ将来連携用)
      destroyedPropHandles: this.destroyedPropHandles,
      hellMode: this.config.hellMode ?? false,
    };
    this.feed = [];
    this.hits = [];
    this.damageNumbers = [];
    this.incoming = [];
    this.tookDamage = false;
    this.announcements = [];
    this.scoreEvents = [];
    this.medals = [];
    this.moments = []; // R53-W3 M3: medalsと同じドレイン(snapshot渡し→次tickでクリア)
    this.zombiePointFloats = [];
    this.kcEvent = null;
    this.ggRankUpFlash = false;
    this.ggSetback = false;
    return snapshot;
  }

  private buildGunGameSnap(): Partial<MatchSnapshot> {
    if (!this.ggState) return {};
    const playerRank = this.ggState.getPlayerRank();
    const weaponId = this.ggState.getWeaponIdAt(playerRank);
    const weaponName = WEAPON_DEFS[weaponId]?.name ?? weaponId;

    // top3: プレイヤー + ボット全員のランクを降順で上位3エントリ
    type Entry = { name: string; rank: number; isPlayer: boolean };
    const entries: Entry[] = [{ name: 'YOU', rank: playerRank, isPlayer: true }];
    for (const b of this.bots) {
      if (b.team !== PLAYER_TEAM) { // V31修正: FFAでは全botがteam=i+1のため==1だと先頭1体しか出ない
        entries.push({ name: b.name, rank: this.ggState.getBotRank(b.uid), isPlayer: false });
      }
    }
    entries.sort((a, b) => b.rank - a.rank);
    const top3 = entries.slice(0, 3) as ReadonlyArray<Entry>;

    return {
      ggRank: playerRank,
      ggWeaponName: weaponName,
      ggRankUpFlash: this.ggRankUpFlash,
      ggSetback: this.ggSetback,
      ggTop3: top3,
    };
  }

  // レーダー用: 視認できている敵(LoS・煙で遮られていない)の、自機の向きを基準にした
  // 相対方位(rad, 0=正面・右が正)と水平距離。透視にならないよう必ず視認判定を通す。
  // HUD側は cx=sin(angle), cy=-cos(angle) で描くため、右が正になるよう forwardAngle - 方位 とする
  private computeEnemyBearings(): Array<{ angle: number; dist: number }> {
    const out: Array<{ angle: number; dist: number }> = [];
    if (!this.player.alive) return out;
    this.bearingsFrameIdx = (this.bearingsFrameIdx + 1) % 4;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const eye = this.player.eyePosition;
    const forwardAngle = Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const aim = bot.getPositionInto(BOT_POS_SCRATCH); // ★5 割り当てゼロ(旧: new×2/bot)
      const dx = aim.x - px;
      const dz = aim.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > RADAR_RANGE_M) continue;
      aim.y += 0.15;
      if (this.smokeBlocks(eye, aim)) continue;
      // ★4 playerCanSee(raycast)はuid%4バケットの担当フレームのみ実行し、
      // 非担当フレームは前回可視値を再利用(レーダー表示は最大4フレーム=67ms遅延で視認不能)
      let visible: boolean;
      const cached = this.bearingVisCache.get(bot.uid);
      if (bot.uid % 4 === this.bearingsFrameIdx || cached === undefined) {
        visible = this.playerCanSee(eye, aim, bot);
        this.bearingVisCache.set(bot.uid, visible);
      } else {
        visible = cached;
      }
      if (!visible) continue;
      out.push({ angle: wrapAngle(forwardAngle - Math.atan2(dx, dz)), dist });
    }
    return out;
  }

  // ── ミニマップ用データ ────────────────────────────────────────────────────────────────

  /** ミニマップ上の敵ドット(UAV スナップショット)を返す。プレイヤー相対座標 */
  private computeMinimapEnemies(): Array<{ relX: number; relZ: number; opacity: number }> {
    if (this.uavTimer <= 0) return [];
    const px = this.player.position.x;
    const pz = this.player.position.z;
    return this.uavEnemySnap.map((s) => ({
      relX: s.x - px,
      relZ: s.z - pz,
      opacity: Math.max(0, 1 - (this.elapsed - s.snappedAt) / 4),
    }));
  }

  /** ミニマップ上の味方ドットを返す。プレイヤー相対座標 */
  private computeMinimapAllies(): Array<{ relX: number; relZ: number }> {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const out: Array<{ relX: number; relZ: number }> = [];
    for (const bot of this.bots) {
      if (!bot.alive || bot.team !== PLAYER_TEAM) continue;
      const bp = bot.getPositionInto(BOT_POS_SCRATCH); // ★5 割り当てゼロ
      out.push({ relX: bp.x - px, relZ: bp.z - pz });
    }
    return out;
  }

  /** ミニマップ背景描画用ボックスデータ(HUD が初期化時に一度だけ参照する) */
  minimapBoxes(): ReadonlyArray<{ x: number; z: number; w: number; d: number }> {
    return this.minimapBoxData;
  }

  // FFAでは首位の敵スコア、チーム戦では敵チームスコア
  private enemyTopScore(): number {
    if (this.modeDef.teamBased) return this.scores.get(ENEMY_TEAM);
    let best = 0;
    for (const bot of this.bots) best = Math.max(best, this.scores.get(bot.team));
    return best;
  }

  private zoneViews(): ZoneView[] {
    if (this.domination) {
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
    if (this.hardpointState) {
      const snap = this.hardpointState.snapshot();
      const side = (team: TeamId | null): 'mine' | 'enemy' | null =>
        team === null ? null : team === PLAYER_TEAM ? 'mine' : 'enemy';
      return [{
        id: 'HP',
        owner: side(snap.owner),
        progress: 0,
        capturing: null,
        contested: snap.contested,
      }];
    }
    return [];
  }

  scoreboard(): ScoreRow[] {
    // ★6 dirtyフラグ+0.2sスロットル: 毎フレームの配列構築+sortをキャッシュで撃退。
    // kill/death funnelがdirtyを立てれば即時再構築、それ以外も0.2sで必ず追随。
    // 試合終了(over)後は常に最新(リザルト画面の確定値を保証)
    if (!this.over && !this.scoreboardDirty && this.elapsed < this.scoreboardNextAt) {
      return this.scoreboardCache;
    }
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
    this.scoreboardCache = rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.scoreboardDirty = false;
    this.scoreboardNextAt = this.elapsed + 0.2;
    return this.scoreboardCache;
  }

  // ── ファイナルキルカム(実装は killcam.ts へ分割 — R54-W1 F1) ──────────────

  /**
   * match.over 確定後に main.ts から1回だけ呼ぶ。
   * 条件を満たせば再生状態をセットアップして true、対象外なら false を返す。
   * ガード判定(canStart)→Match側の演出クリーンアップ→再生初期化(begin)の順は分割前と同一
   * (ガード失敗でリザルト直行する場合に pauseCombatLoops 等の副作用を残さない)。
   */
  startFinalKillcam(): boolean {
    if (!this.killcam.canStart(this.elapsed)) return false;
    // ─── ガード通過確定: 以下は副作用クリーンアップ ───
    // V33: キルカムに遠雷/ハムと黒転ビネットを持ち込まない
    this.sounds.pauseCombatLoops(true);
    this.postfx?.setKokurai(0);
    // キルカム開始時に飛行中のHKメッシュを全て除去(凍結表示を防ぐ)
    for (const hk of this.hkEntities) {
      this.scene.remove(hk.mesh);
      hk.geo.dispose();
      (hk.mesh.material as THREE.Material).dispose();
    }
    this.hkEntities.length = 0;
    // RC-XD / ケアパッケージも凍結表示させない
    this.cleanupRcxd();
    for (let i = this.carePackageCrates.length - 1; i >= 0; i -= 1) this.disposeCarePackageCrate(i);
    // 同様に飛行中の風神手裏剣・疾走中の雷麒麟・黒帝斬撃波も凍結表示させない
    this.disposeWindShuriken();
    this.disposeLightningKirin();
    this.disposeAllDarkSlashWaves();
    this.lightningBeastTimer = 0;
    // ロケット弾体も凍結表示させない
    this.clearRockets();
    this.clearBowProjectiles();
    this.clearStaffProjectiles();
    this.clearShurikenDiscs();
    this.bowCharging = false;
    this.bowChargeTimer = 0;
    // V26修正: 真月の溜め(0.4s)中に試合が決まると deathVeil=0.72 がファイナルキルカムへ
    // 凍結され画面が暗いままになる。キルカム開始時に演出ベールを必ずリセットする
    this.deathVeil = 0;
    this.whiteout = 0;
    this.shingetsuPhase = 'idle';
    this.killcam.begin();
    return true;
  }

  /** finalKillcam 中に毎フレーム呼ぶ。完了(窓を抜けた)なら true、継続なら false を返す。 */
  advanceFinalKillcam(dt: number): boolean {
    return this.killcam.advance(dt);
  }

  /** main.ts が読むキル瞬間フラッシュ値(旧 public field の読み取り互換getter)。 */
  get fkFlash(): number {
    return this.killcam.fkFlash;
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
      : this.config.mode === 'snd' && this.sndMatch
        ? this.sndMatch.matchWinner() === PLAYER_TEAM
        : this.modeDef.teamBased
          ? this.scores.get(PLAYER_TEAM) > this.scores.get(ENEMY_TEAM)
          : (rows[0]?.isPlayer ?? false);
    return {
      rows,
      won,
      accuracy: this.player.shotsFired > 0 ? this.player.shotsHit / this.player.shotsFired : 0,
      headshots: this.player.headshots,
      modeName: this.modeDef.name,
      // R53-W2 M2b: S&Dのチームスコアはキル先取ではなくラウンド先取(SndMatch)を表示する
      teamScores:
        this.config.mode === 'snd' && this.sndMatch
          ? { mine: this.sndMatch.scoreOf(PLAYER_TEAM), enemy: this.sndMatch.scoreOf(ENEMY_TEAM) }
          : this.modeDef.teamBased
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
        killsByWeapon: { ...this.playerKillsByWeapon },
        hsByWeapon: { ...this.playerHsByWeapon },
        unlockedMedals: [...this.tracker.newlyUnlocked],
        medalCounts: { ...this.tracker.counts },
        medalXp: this.medalXpTotal,
        // ★V一括修正: ゾンビ統計(charm解放)+黒雷帝キル実数(刀身雷脈)を summary へ供給。
        // progression.accumulateMatch がこれらを profile へ積算する(未供給時は0扱いだった)
        zombieRound: this.config.mode === 'zombie' ? this.zombieRound : undefined,
        zombieBossKills: this.config.mode === 'zombie' ? this.zombieBossKillCount : undefined,
        kokuraiKills: this.tracker.kokuraiKillCount > 0 ? this.tracker.kokuraiKillCount : undefined,
      },
      // R45a: ゾンビモード結果
      zombieRound: this.config.mode === 'zombie' ? this.zombieRound : undefined,
      zombiePoints: this.config.mode === 'zombie' ? this.zombiePoints : undefined,
      // R53-W2 M2b: ゾンビAAR用の追加行(menu側が消費)
      papTierMax:
        this.config.mode === 'zombie' && this.zombiePapTiers.size > 0
          ? Math.max(...this.zombiePapTiers.values())
          : undefined,
      specialZombieKills: this.config.mode === 'zombie' ? this.zombieVariantKillCount : undefined,
      sndScore: this.sndMatch
        ? [this.sndMatch.scoreOf(PLAYER_TEAM), this.sndMatch.scoreOf(ENEMY_TEAM)]
        : undefined,
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

  // ── ゾンビ経済: ショップ構築 ──────────────────────────────────────────
  private buildZombieShop(): void {
    const layout = generateShopLayout(this.config.stage.seed);
    this.zombieShopLayout = layout;
    const total = layout.slots.length;
    const size = this.config.stage.size;

    // ミステリーボックス移動先候補を5点生成(種ベース+オフセット)
    this.zombieBoxPositions = [];
    const boxAngles = [0.1, 1.3, 2.5, 3.8, 5.1];
    for (const a of boxAngles) {
      this.zombieBoxPositions.push(
        this.findShopGroundPos(a + this.config.stage.seed * 0.01, size * 0.15),
      );
    }

    this.zombieBoxGroupIdx = -1;
    for (const slot of layout.slots) {
      const baseAngle = (slot.slotIndex / total) * Math.PI * 2 + this.config.stage.seed * 0.01;
      let radius: number;
      if (slot.kind === 'wall-buy') radius = size * 0.36;
      // R53-W2: ドアは建物入口に見立て、壁武器と同程度の外周へ独立ゲートとして配置する
      // (PaP台と座標的に結びつける生成側ロジックは無く、無理に近接させると不自然になるため。
      // 判断は報告参照: 「実装の単純さ優先」でPaP台は従来のmystery-box同様の内周に据え置く)
      else if (slot.kind === 'door') radius = size * 0.4;
      else if (slot.kind === 'perk-machine') radius = size * 0.26;
      else radius = size * 0.16; // mystery-box / pack-a-punch

      const group = this.buildShopVisual(slot);
      group.position.copy(this.findShopGroundPos(baseAngle, radius));
      this.scene.add(group);
      this.zombieShopGroups.push(group);
      if (slot.kind === 'mystery-box') this.zombieBoxGroupIdx = this.zombieShopGroups.length - 1;
      if (slot.kind === 'door') {
        // R53-W2: ドアのバリケードコライダー(world扱い=移動を阻む。弾/視線はcastRay側のタグ判定で
        // 個別に扱われるため通常のworldプロップと同じ挙動=弾は当たる。購入で除去する)
        const body = this.physics.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(group.position.x, group.position.y + 1.0, group.position.z),
        );
        const collider = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 1.05, 0.15), body);
        this.tags.set(collider.handle, { kind: 'world' });
        this.zombieDoorBody = body;
        this.zombieDoorCollider = collider;
      }
    }

    // ミステリーボックス: 初期位置を最後の boxPositions[0] に設定
    // R53-W2バグ修正: 旧実装は「ミステリーボックスは常に末尾スロット」前提でlayout.slots.length-1を
    // 直接参照していたが、pack-a-punch/doorが末尾に追加されたため崩壊していた(末尾はdoorになる)。
    // 生成時に記録したkind一致indexを使う。
    this.zombieBoxCurrentIdx = 0;
    if (this.zombieBoxGroupIdx >= 0 && this.zombieBoxPositions[0]) {
      const grp = this.zombieShopGroups[this.zombieBoxGroupIdx];
      if (grp) grp.position.copy(this.zombieBoxPositions[0]);
    }
  }

  private snapToGround(origin: THREE.Vector3): number {
    const down = new THREE.Vector3(0, -1, 0);
    const hit = this.castRay(origin, down, 40, this.player.body);
    return hit ? origin.y - hitToi(hit) : 0;
  }

  // 決定論的な接地点探索: 基準角の周辺(±0.22/±0.44rad)を走査し、最も低い接地Yの候補を選ぶ。
  // 障害物の天面(高所)にラック/自販機が乗って実質購入不能になるのを避ける。
  // レイキャストのみでコライダーは一切足さない=ゾンビのナビ/スタックに影響ゼロ
  private findShopGroundPos(baseAngle: number, radius: number): THREE.Vector3 {
    const offsets = [0, 0.22, -0.22, 0.44, -0.44];
    let best: THREE.Vector3 | null = null;
    for (const off of offsets) {
      const x = Math.cos(baseAngle + off) * radius;
      const z = Math.sin(baseAngle + off) * radius;
      const y = this.snapToGround(new THREE.Vector3(x, 20, z));
      if (y <= 0.5) return new THREE.Vector3(x, y, z); // 床レベル=即採用
      if (!best || y < best.y) best = new THREE.Vector3(x, y, z);
    }
    return best ?? new THREE.Vector3(Math.cos(baseAngle) * radius, 0, Math.sin(baseAngle) * radius);
  }

  private buildShopVisual(slot: ShopSlot): THREE.Group {
    const group = new THREE.Group();
    (group as unknown as { _shopSlotIndex: number })._shopSlotIndex = slot.slotIndex;

    if (slot.kind === 'wall-buy') {
      // ラック本体(暗いパネル)
      const rackGeo = new THREE.BoxGeometry(1.0, 1.6, 0.12);
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.8, metalness: 0.3 });
      const rack = new THREE.Mesh(rackGeo, rackMat);
      rack.position.y = 0.8;
      group.add(rack);
      // 発光リムライト(枠線エミッシブ)
      const rimGeo = new THREE.BoxGeometry(1.02, 1.62, 0.08);
      const rimMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff, wireframe: true });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.8;
      group.add(rim);
      // 本物の武器モデル(buildGunBody)
      const wdef = WEAPON_DEFS[slot.weaponId ?? ''];
      if (wdef) {
        try {
          const { gun } = buildGunBody(wdef);
          gun.scale.setScalar(0.7);
          gun.position.set(0, 1.1, 0.09);
          gun.rotation.set(0, Math.PI, -Math.PI / 2);
          group.add(gun);
        } catch {
          const barGeo = new THREE.BoxGeometry(0.65, 0.06, 0.06);
          const barMat = new THREE.MeshBasicMaterial({ color: 0x88ddff });
          const bar = new THREE.Mesh(barGeo, barMat);
          bar.position.set(0, 1.1, 0.07);
          group.add(bar);
        }
      }
      const ringGeo = new THREE.RingGeometry(0.3, 0.35, 16);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      group.add(ring);
    } else if (slot.kind === 'perk-machine') {
      const perkColors: Record<ZombiePerkId, number> = {
        juggernog: 0xff2222,
        'speed-cola': 0x22ffdd,
        'double-tap': 0xff8822,
        'stamin-up': 0xffee22,
        'quick-revive': 0x2244ff,
        'ext-mag': 0x88ff44,
      };
      const col = perkColors[slot.perkId as ZombiePerkId] ?? 0xffffff;
      const bodyGeo = new THREE.BoxGeometry(0.65, 1.9, 0.55);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: new THREE.Color(col),
        emissiveIntensity: 0.35,
        roughness: 0.6,
        metalness: 0.3,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.95;
      group.add(body);
      const panelGeo = new THREE.BoxGeometry(0.5, 0.08, 0.01);
      const panelMat = new THREE.MeshBasicMaterial({ color: col });
      for (let i = 0; i < 3; i++) {
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0, 0.6 + i * 0.4, 0.28);
        group.add(panel);
      }
    } else if (slot.kind === 'mystery-box') {
      const crateGeo = new THREE.BoxGeometry(0.82, 0.62, 0.62);
      const crateMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: new THREE.Color(0xffaa00),
        emissiveIntensity: 0.7,
        roughness: 0.4,
        metalness: 0.5,
      });
      const crate = new THREE.Mesh(crateGeo, crateMat);
      crate.position.y = 0.31;
      group.add(crate);
      const lidGeo = new THREE.BoxGeometry(0.82, 0.06, 0.62);
      const lid = new THREE.Mesh(lidGeo, crateMat.clone());
      lid.position.set(0, 0.62, -0.15);
      lid.rotation.x = 0.25;
      group.add(lid);
      const ringGeo = new THREE.RingGeometry(0.28, 0.34, 20);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      group.add(ring);
    } else if (slot.kind === 'pack-a-punch') {
      // 鍛神台(Pack-a-Punch): 鉄床本体+4本柱+橙の發光クリスタル(emissiveIntensity 0.5 ≤0.55上限)
      const anvilGeo = new THREE.BoxGeometry(0.9, 0.5, 0.7);
      const anvilMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.55, metalness: 0.75 });
      const anvil = new THREE.Mesh(anvilGeo, anvilMat);
      anvil.position.y = 0.25;
      group.add(anvil);
      const pillarGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x22262f, roughness: 0.6, metalness: 0.6 });
      for (const [px, pz] of [[-0.32, -0.24], [0.32, -0.24], [-0.32, 0.24], [0.32, 0.24]] as const) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, 0.95, pz);
        group.add(pillar);
      }
      const crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x341400,
        emissive: new THREE.Color(0xff6a00),
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.2,
      });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.position.y = 1.55;
      group.add(crystal);
      const ringGeo = new THREE.RingGeometry(0.34, 0.42, 20);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      group.add(ring);
      // ★V-A MEDIUM修正: 鍛神台はゲート(door)開放までの封印制 — ドアに機能的意味を持たせる。
      // 封印中はクリスタル/リングを暗転(発光0.1/透明0.15)し、開放時に papSealDim(false) で復帰
      this.zombiePapCrystalMat = crystalMat;
      this.zombiePapRingMat = ringMat;
      if (papInteractSealed(true, this.zombieDoorOpen)) this.papSealDim(true);
    } else if (slot.kind === 'door') {
      // ドア(バリケード板): 暗色木材のクロス板2枚+フレーム2本。購入時に個別disposeするため
      // ジオメトリ/マテリアルをzombieDoorVisualへ記録する(match.tsが唯一のオーナー)。
      this.zombieHasDoor = true; // 鍛神台の封印判定(papInteractSealed)の入力
      const boardMat = new THREE.MeshStandardMaterial({ color: 0x2a1f14, roughness: 0.9, metalness: 0.05 });
      const boardGeo = new THREE.BoxGeometry(1.5, 0.22, 0.06);
      const board1 = new THREE.Mesh(boardGeo, boardMat);
      board1.position.set(0, 1.1, 0);
      board1.rotation.z = 0.35;
      group.add(board1);
      const board2 = new THREE.Mesh(boardGeo, boardMat);
      board2.position.set(0, 1.1, 0);
      board2.rotation.z = -0.35;
      group.add(board2);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c140c, roughness: 0.85 });
      const frameGeo = new THREE.BoxGeometry(0.12, 2.1, 0.12);
      const frameL = new THREE.Mesh(frameGeo, frameMat);
      frameL.position.set(-0.75, 1.05, 0);
      group.add(frameL);
      const frameR = new THREE.Mesh(frameGeo, frameMat);
      frameR.position.set(0.75, 1.05, 0);
      group.add(frameR);
      this.zombieDoorVisual = { group, geos: [boardGeo, frameGeo], mats: [boardMat, frameMat] };
    }
    return group;
  }

  private updateZombieShopProximity(): void {
    if (!this.zombieShopLayout || !this.player.alive) {
      this.zombieShopPrompt = null;
      return;
    }
    const ppos = this.player.position;
    let bestDist = 2.2;
    let bestSlot: ShopSlot | null = null;

    for (let i = 0; i < this.zombieShopGroups.length; i++) {
      const grp = this.zombieShopGroups[i];
      if (!grp) continue;
      const slot = this.zombieShopLayout.slots[i];
      if (!slot) continue;
      if (slot.kind === 'door' && this.zombieDoorOpen) continue; // 開放済みドアは対象外
      const dist = grp.position.distanceTo(ppos);
      if (dist < bestDist) {
        bestDist = dist;
        bestSlot = slot;
      }
    }

    if (!bestSlot) {
      this.zombieShopPrompt = null;
      return;
    }

    const label = this.zombieShopSlotLabel(bestSlot);
    const cost = this.zombieSlotEffectiveCost(bestSlot);
    const canAfford = canBuy(this.zombiePoints, cost);
    this.zombieShopPrompt = { label, canAfford, cost };
  }

  private zombieShopSlotLabel(slot: ShopSlot): string {
    if (slot.kind === 'wall-buy') {
      const wdef = WEAPON_DEFS[slot.weaponId ?? ''];
      const name = wdef?.name ?? slot.weaponId ?? '?';
      return `[E] ${name}  ${slot.cost}pt`;
    }
    if (slot.kind === 'perk-machine') {
      const perkDef = slot.perkId ? PERKS[slot.perkId] : null;
      let label = `[E] ${perkDef?.name ?? slot.perkId ?? '?'}  ${slot.cost}pt`;
      if (slot.perkId === 'stamin-up' && this.zombiePerkMoveMul >= 1.5) {
        label += ' (速度上限)';
      }
      const stackN = slot.perkId ? (this.zombiePerkStacks.get(slot.perkId) ?? 0) : 0;
      if (stackN > 0 && slot.perkId !== 'quick-revive') {
        label += ` ×${stackN + 1}目`;
      }
      return label;
    }
    if (slot.kind === 'pack-a-punch') {
      // ★V-A MEDIUM修正: 封印中は誘導プロンプト(ドア開放が解錠条件)
      if (papInteractSealed(this.zombieHasDoor, this.zombieDoorOpen)) {
        return '鍛神台は封印されている — ゲートを開放せよ';
      }
      const weapon = this.activeWeapon;
      if (EXT_MAG_EXCLUDED_IDS.has(weapon.def.id)) return '[E] 鍛神台(クナイは対象外)';
      const curTier = (this.zombiePapTiers.get(weapon.def.id) ?? 0) as PapTier;
      const isMaxed = curTier >= 3;
      const cost = this.zombiePapEffectiveCost();
      return isMaxed ? `[E] 鍛神台(補充)  ${cost}pt` : `[E] 鍛神台 改${curTier + 1}  ${cost}pt`;
    }
    if (slot.kind === 'door') {
      return `[E] ドアを開放  ${DOOR_COST}pt`;
    }
    return `[E] ミステリーボックス  ${slot.cost}pt`;
  }

  // 鍛神台の封印ビジュアル(クリスタル/床リング)の暗転/復帰。封印中=発光0.1/リング0.15、
  // 開放=ビルド時の定数(0.5/0.5)へ戻す。bloom閾値0.9には両状態とも遠く及ばない
  private papSealDim(sealed: boolean): void {
    if (this.zombiePapCrystalMat) this.zombiePapCrystalMat.emissiveIntensity = sealed ? 0.1 : 0.5;
    if (this.zombiePapRingMat) this.zombiePapRingMat.opacity = sealed ? 0.15 : 0.5;
  }

  private handleZombieInteract(): void {
    if (!this.input.wasPressed('interact')) return;
    if (!this.player.alive || !this.zombieShopLayout) return;
    if (this.zombieBoxAnimTimer > 0) return;

    const ppos = this.player.position;
    let bestDist = 2.2;
    let bestSlotIdx = -1;

    for (let i = 0; i < this.zombieShopGroups.length; i++) {
      const grp = this.zombieShopGroups[i];
      if (!grp) continue;
      const s = this.zombieShopLayout.slots[i];
      if (s?.kind === 'door' && this.zombieDoorOpen) continue; // 開放済みドアは対象外
      const dist = grp.position.distanceTo(ppos);
      if (dist < bestDist) {
        bestDist = dist;
        bestSlotIdx = i;
      }
    }

    if (bestSlotIdx < 0) return;
    const slot = this.zombieShopLayout.slots[bestSlotIdx];
    if (!slot) return;

    if (!canBuy(this.zombiePoints, slot.cost)) {
      return;
    }

    if (slot.kind === 'wall-buy') {
      try {
        this.zombiePoints = buyResult(this.zombiePoints, slot.cost);
      } catch {
        return;
      }
      this.switchPrimaryWeapon(slot.weaponId ?? '');
      this.sounds.uiClick();
    } else if (slot.kind === 'perk-machine') {
      if (!slot.perkId) return;
      const stacksRecord = Object.fromEntries(this.zombiePerkStacks.entries()) as Partial<Record<ZombiePerkId, number>>;
      const result = purchasePerk(stacksRecord, slot.perkId, this.zombiePoints, this.zombieQuickReviveCharges);
      if (!result.ok) return;
      this.zombiePoints = result.remainingPoints;
      if (slot.perkId !== 'quick-revive') {
        this.zombiePerkStacks.set(slot.perkId, result.stackCount);
      }
      this.applyZombiePerk(slot.perkId, result.stackCount);
      // R53-W2 M2b: 継承の守り札(perkcarry)の供給側 — この試合で「最初に買ったパーク」を
      // 次試合へ引き継げるよう保存する(menu側 readLastZombiePerk / キー名はMN2凍結契約)
      if (!this.zombieFirstPerkSaved) {
        this.zombieFirstPerkSaved = true;
        try {
          localStorage.setItem(LAST_ZOMBIE_PERK_KEY, slot.perkId);
        } catch {
          /* localStorage不可(プライベートモード等)は静かに無視 */
        }
      }
      const stackSuffix = result.stackCount > 1 ? ` ×${result.stackCount}` : '';
      this.announcements.push(PERKS[slot.perkId].name + stackSuffix + ' 取得');
      // R53-W3 M3: MK.IIIモーメント(パーク取得)
      this.moments.push({ kind: 'perk', title: PERKS[slot.perkId].name, sub: stackSuffix ? `×${result.stackCount}` : undefined });
      this.sounds.uiClick();
    } else if (slot.kind === 'mystery-box') {
      try {
        this.zombiePoints = buyResult(this.zombiePoints, MYSTERY_BOX_COST);
      } catch {
        return;
      }
      const result = rollMysteryBox(Math.random.bind(Math));
      this.zombieBoxPendingWeapon = result.weaponId;
      this.zombieBoxAnimTimer = 1.2;
      const grp = this.zombieShopGroups[bestSlotIdx];
      if (grp) {
        const pillarGeo = new THREE.CylinderGeometry(0.08, 0.08, 5, 8, 1, true);
        const pillarMat = new THREE.MeshBasicMaterial({
          color: 0xffd700,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        this.zombieBoxAnimMesh = new THREE.Mesh(pillarGeo, pillarMat);
        this.zombieBoxAnimMesh.position.set(grp.position.x, grp.position.y + 2.5, grp.position.z);
        this.scene.add(this.zombieBoxAnimMesh);
      }
      if (result.boxMoves) {
        // 移動は演出(1.2s)終了時に適用する。フラグを立てないと毎ロールで
        // 「移動した」アナウンスが誤発火する
        this.zombieBoxCurrentIdx = (this.zombieBoxCurrentIdx + 1) % this.zombieBoxPositions.length;
        this.zombieBoxPendingMove = true;
      }
      this.sounds.uiClick();
    } else if (slot.kind === 'pack-a-punch') {
      // ★V-A MEDIUM修正: ドア未開放の間は封印(ドアに機能的意味を付与)
      if (papInteractSealed(this.zombieHasDoor, this.zombieDoorOpen)) {
        this.sounds.papDeny();
        this.announcements.push('鍛神台は封印されている — ゲートを開放せよ');
        return;
      }
      const weapon = this.activeWeapon;
      if (EXT_MAG_EXCLUDED_IDS.has(weapon.def.id)) {
        this.sounds.papDeny(); // クナイ(近接)は鍛神対象外
        return;
      }
      const curTier = (this.zombiePapTiers.get(weapon.def.id) ?? 0) as PapTier;
      const isMaxed = curTier >= 3;
      const nextTier = (isMaxed ? 3 : curTier + 1) as PapTier;
      const cost = isMaxed ? PAP_REFILL_COST : PAP_COST[nextTier];
      if (!canBuy(this.zombiePoints, cost)) {
        this.sounds.papDeny();
        return;
      }
      this.zombiePoints = buyResult(this.zombiePoints, cost);
      if (!isMaxed) this.zombiePapTiers.set(weapon.def.id, nextTier);
      this.recomposeWeapon(weapon);
      this.viewModel.setWeapon(weapon.def);
      this.viewModel.playPapUpgradeAnim(this.settings.reduceMotion);
      this.sounds.papUpgrade();
      // ★V-A修正(TODO消化): 鍛神台の改造演出FX(B-FX2、火花+光条2.5s、既存プール流用)
      {
        const g = this.zombieShopGroups[bestSlotIdx];
        if (g) this.effects.papMachineGlow(g.position.x, g.position.y, g.position.z);
      }
      this.announcements.push(`${weapon.def.name} を鍛神！`);
      const medalOut: MedalEvent[] = [];
      if (!this.zombiePapAnyDone) {
        this.zombiePapAnyDone = true;
        this.tracker.emitManual('pap-first', medalOut);
      }
      if (!isMaxed && nextTier === 3) {
        this.tracker.emitManual('pap-max', medalOut);
      }
      this.emitMedals(medalOut);
    } else if (slot.kind === 'door') {
      if (this.zombieDoorOpen) return;
      try {
        this.zombiePoints = buyResult(this.zombiePoints, DOOR_COST);
      } catch {
        return;
      }
      this.zombieDoorOpen = true;
      // R31と同じ順序: tags削除 → removeRigidBody → ビジュアル除去
      if (this.zombieDoorCollider) this.tags.delete(this.zombieDoorCollider.handle);
      if (this.zombieDoorBody) this.physics.removeRigidBody(this.zombieDoorBody);
      this.zombieDoorBody = null;
      this.zombieDoorCollider = null;
      if (this.zombieDoorVisual) {
        this.scene.remove(this.zombieDoorVisual.group);
        for (const g of this.zombieDoorVisual.geos) g.dispose();
        for (const m of this.zombieDoorVisual.mats) m.dispose();
        this.zombieDoorVisual = null;
      }
      this.announcements.push('ドアを開放した！ — 鍛神台の封印が解けた');
      // ★V-A MEDIUM修正: 鍛神台の封印解除(ビジュアル復帰)
      this.papSealDim(false);
      this.sounds.doorUnlock(); // W4D: 1750ptの解錠に相応しい重ラッチ+チャイム
    }
  }

  private updateZombieBoxAnim(dt: number): void {
    if (this.zombieBoxAnimTimer <= 0) return;
    this.zombieBoxAnimTimer = Math.max(0, this.zombieBoxAnimTimer - dt);

    if (this.zombieBoxAnimMesh) {
      const t = this.zombieBoxAnimTimer / 1.2;
      (this.zombieBoxAnimMesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.sin(t * Math.PI);
    }

    if (this.zombieBoxAnimTimer <= 0) {
      if (this.zombieBoxPendingWeapon) {
        // 期待感の答え合わせ: 排出武器名をアナウンス(BO2のロール演出の締め)
        const wname =
          WEAPON_DEFS[this.zombieBoxPendingWeapon]?.name ?? this.zombieBoxPendingWeapon;
        this.switchPrimaryWeapon(this.zombieBoxPendingWeapon);
        this.announcements.push(`${wname} を引き当てた！`);
        this.zombieBoxPendingWeapon = null;
      }
      if (this.zombieBoxAnimMesh) {
        this.scene.remove(this.zombieBoxAnimMesh);
        (this.zombieBoxAnimMesh.geometry as THREE.BufferGeometry).dispose();
        (this.zombieBoxAnimMesh.material as THREE.Material).dispose();
        this.zombieBoxAnimMesh = null;
      }
      // boxMoves のロールだった時だけ箱を次候補へ移す(元位置は消灯=グループごと移動)
      // R53-W2バグ修正: 末尾決め打ちではなくbuildZombieShopが記録したindexを使う
      if (this.zombieBoxPendingMove) {
        this.zombieBoxPendingMove = false;
        const boxGrp = this.zombieShopGroups[this.zombieBoxGroupIdx];
        const newPos = this.zombieBoxPositions[this.zombieBoxCurrentIdx];
        if (boxGrp && newPos) {
          boxGrp.position.copy(newPos);
          this.announcements.push('ミステリーボックスが移動した！');
        }
      }
    }
  }

  private applyZombiePerk(perkId: ZombiePerkId, stackCount: number): void {
    if (perkId === 'juggernog') {
      if (stackCount === 1) {
        // 初回: ×2.5。現在HPの割合を保持して逆転を防ぐ(300→750)
        const ratio = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 1;
        const newMax = Math.round(this.player.maxHp * 2.5);
        this.player.maxHp = newMax;
        this.player.hp = Math.max(1, Math.round(newMax * ratio));
      } else {
        // 2回目以降: +150HP/スタック
        this.player.maxHp += 150;
        this.player.hp = Math.min(this.player.hp + 150, this.player.maxHp);
      }
    } else if (perkId === 'stamin-up') {
      // +5%/スタック、上限×1.5。上限でも購入はできる(ポイントシンク)
      this.zombiePerkMoveMul = Math.min(1.5, this.zombiePerkMoveMul * 1.05);
    } else if (perkId === 'quick-revive') {
      this.zombieQuickReviveCharges += 1;
    } else {
      // R53-W2: speed-cola/double-tap/ext-mag は個別のdef直接変異(旧: 現在値への
      // 複利/加算)を撤去し、composeZombieWeaponDefへ一本化。常にWEAPON_DEFSの基礎値
      // から全武器を再合成する(PaP tierとの組み合わせも自動的に正しく反映される)。
      this.recomposeAllWeapons();
    }
  }

  private switchPrimaryWeapon(weaponId: string): void {
    // ★V-A修正: 「今まさに所持している改造済み武器」を壁で再購入した場合は弾補給扱いにして
    // PaP tierを維持する(BO2の壁弾補給準拠 — 改造が消える体験劣化の根治)。
    // 非所持武器への切替(=新品取得)は従来どおりtier0リセット。
    const currentlyHeld = this.weapons.some((w) => w.def.id === weaponId);
    const papTier = papTierAfterWallBuy(
      currentlyHeld,
      (this.zombiePapTiers.get(weaponId) ?? 0) as PapTier,
    );
    if (papTier === 0) this.zombiePapTiers.delete(weaponId);
    const baseDef = WEAPON_DEFS[weaponId] ?? WEAPON_DEFS['kaede-ar']!;
    // R53-W2: per-matchクローン(applyAttachments)→composeZombieWeaponDef の順で一本化。
    // composeは自身でfists(クナイ)をガードして素通しするため、呼び出し側での分岐は不要。
    const cloned = applyAttachments(baseDef, []);
    const composed = composeZombieWeaponDef(cloned, {
      papTier,
      extMagStacks: this.zombiePerkStacks.get('ext-mag') ?? 0,
      doubleTapStacks: this.zombiePerkStacks.get('double-tap') ?? 0,
      speedColaStacks: this.zombiePerkStacks.get('speed-cola') ?? 0,
    });
    // ★V-A修正: tier維持の再購入では鍛神カモも維持(composeはカモを扱わないため明示設定)
    composed.papCamo = PAP_CAMO_BY_TIER[papTier];
    const newWeapon = new Weapon(composed);
    newWeapon.raise();
    // BO2式: 構えているスロット(activeIndex)を置換し、アクティブスロットは変えない
    (this.weapons as Weapon[])[this.activeIndex] = newWeapon;
    this.viewModel.setWeapon(newWeapon.def);
    this.adsLatch = false;
  }

  dispose(): void {
    // BO2 ストリーク: HK エンティティを解放(scene.traverse前に手動removeが必要)
    for (const hk of this.hkEntities) {
      this.scene.remove(hk.mesh);
      hk.geo.dispose();
      (hk.mesh.material as THREE.Material).dispose();
    }
    this.hkEntities.length = 0;
    this.killcam.dispose();
    // RC-XD / ケアパッケージクレートを解放
    this.cleanupRcxd();
    for (let i = this.carePackageCrates.length - 1; i >= 0; i -= 1) this.disposeCarePackageCrate(i);
    // クナイウルト: 飛行中の風神手裏剣・疾走中の雷麒麟・黒帝斬撃波を解放
    this.disposeWindShuriken();
    this.disposeLightningKirin();
    this.disposeAllDarkSlashWaves();
    // R53-W2 M2b: ストーリー回収物+S&Dボム/サイトリングを解放
    for (const item of this.collectItems) {
      this.scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
    }
    this.collectItems = [];
    this.disposeSndBombMesh();
    for (const ring of this.sndSiteRings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.sndSiteRings = [];
    this.radioQueue = [];
    this.radioPending = [];
    this.radioCurrent = null;
    this.lightningBeastTimer = 0;
    if (this.darkEmperorTimer > 0) this.endDarkEmperor();
    this.darkEmperorTimer = 0;
    this.raiteiMode = false;
    this.kokuraiteiMode = false;
    this.sounds.setLightningHum(false); // 雷帝ハムのループ音を停止(リスタート時の残留防止)
    this.sounds.stopKokuraiThunder();   // R33: 遠雷スケジューラ停止
    this.sounds.setEmperorBgm(null);    // R53-W3 M3: 帝王BGM層を通常へ復帰(試合終了/quit)
    this.zombieCrowd?.dispose(this.scene); // R53-W3 M3: ゾンビ群InstancedMeshの解放
    this.zombieCrowd = null;
    this.kokuraiTrailTimer = 0;         // R33
    this.kokuraiThunderTimer = 0;       // R33
    this.kokuraiBlackInTimer = 0;       // R33
    this.raiteiChargeStrikes = []; // 多段落雷キューを空にする
    this._prevFramePlaying = true; // ポーズ検出フラグをリセット
    this.isCharging = false;
    this.chargeTimer = 0;
    this.exoticHoldFireTimer = 0;
    this.exoticHoldFireCharging = false;
    this.exoticHoldFireActive = false;
    this.shuraChargeTimer = 0;
    this.shuraChargeTickTimer = 0;
    this.shuraRampageTimer = 0;
    this.shuraRampageFireTimer = 0;
    this.tenraiMaxChargeFired = false;
    this.banjinKagemaiTimer = 0;
    this.banjinKagemaiDmgTimer = 0;
    this.gekkouMoonTimer = 0;
    this.gekkouMoonPos = null;
    this.shinkirouKyozouTimer = 0;
    this.shuraKourinTimer = 0;
    this.shuraKourinDmgTimer = 0;
    this.exoticDamageBoost = 1;
    this.geppaRaigouTimer = 0;
    this.geppaRaigouDmgTimer = 0;
    this.gokuraiZetsumetsuTimer = 0;
    this.tokoyamiActive = false;
    this.mPressTimestamps = [];
    this.mTripleArmed = false;
    this.nPressTimestamps = [];
    this.nTripleArmed = false;
    this.viewModel.setKunaiLightningMode(false);
    this.atmosphere?.dispose(); // 草/フォグ/粒子/遠景/リムライトを解放(scene.traverse前)
    this.atmosphere = null;
    // R30 雨パーティクル解放
    if (this.rainPoints) {
      this.scene.remove(this.rainPoints);
      this.rainPoints.geometry.dispose();
      (this.rainPoints.material as THREE.Material).dispose();
      this.rainPoints = null;
      this.rainTimeUniform = null;
    }
    // ゾンビショップオブジェクトを解放
    for (const grp of this.zombieShopGroups) {
      this.scene.remove(grp);
      grp.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) m.dispose();
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    this.zombieShopGroups.length = 0;
    this.zombieBossBot = null;
    // R53-W2: 未購入ドアの参照だけ後始末(メッシュ自体は上のzombieShopGroups一括disposeで解放済み)
    this.zombieDoorVisual = null;
    this.zombieDoorBody = null;
    this.zombieDoorCollider = null;
    // R53-W2: 毒霧/パワーアップドロップを解放(zombieShopGroupsとは別系統のscene常駐エンティティ)
    this.zombieMiasmaClouds.length = 0;
    // ★V-A修正: 毒霧/ドロップの視覚はeffects側プール(effects.dispose)が解放する
    for (const drop of this.zombiePowerUpDrops) {
      this.scene.remove(drop.mesh);
      this.effects.disposePowerUpBeacon(drop.mesh);
    }
    this.zombiePowerUpDrops.length = 0;

    // ★ ゾンビプールをフラッシュ(match終了時=プールBotはsceneに追加されていないのでdisposeのみ)
    for (const b of this.zombiePool) b.dispose();
    this.zombiePool.length = 0;
    // ドッグタグエンティティを解放(scene.traverse前に削除してからgeometry/material解放)
    for (const entity of this.kcDogTagEntities) {
      this.scene.remove(entity.group);
      entity.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.kcDogTagEntities.length = 0;
    if (this.zombieBoxAnimMesh) {
      this.scene.remove(this.zombieBoxAnimMesh);
      (this.zombieBoxAnimMesh.geometry as THREE.BufferGeometry).dispose();
      (this.zombieBoxAnimMesh.material as THREE.Material).dispose();
      this.zombieBoxAnimMesh = null;
    }
    // ── R22 新パスの解放 ──
    // AdsDofPass/GodRaysPass は composer.passes ループで一括 dispose されるため明示呼び出し不要
    this._adsDofPass = null;
    this._godRaysPass = null;
    // N8AOPass は dispose() を持たないため、内部 RT/マテリアル/FSQuad を明示破棄する
    if (this._n8aoPass) {
      const n = this._n8aoPass;
      n.beautyRenderTarget.depthTexture?.dispose();
      n.beautyRenderTarget.dispose();
      n.writeTargetInternal?.dispose();
      n.readTargetInternal?.dispose();
      n.accumulationRenderTarget?.dispose();
      n.depthDownsampleTarget?.dispose();
      n.transparencyRenderTargetDWFalse?.dispose();
      n.transparencyRenderTargetDWTrue?.depthTexture?.dispose();
      n.transparencyRenderTargetDWTrue?.dispose();
      n.effectShaderQuad?.material?.dispose();
      n.effectShaderQuad?.dispose();
      n.poissonBlurQuad?.material?.dispose();
      n.poissonBlurQuad?.dispose();
      n.effectCompositerQuad?.material?.dispose();
      n.effectCompositerQuad?.dispose();
      n.accumulationQuad?.material?.dispose();
      n.accumulationQuad?.dispose();
      n.depthDownsampleQuad?.material?.dispose();
      n.depthDownsampleQuad?.dispose();
      n.depthCopyPass?.material?.dispose();
      n.depthCopyPass?.dispose();
      n.bluenoise?.dispose();
      this._n8aoPass = null;
    }

    // PCSS: このMatchがパッチを適用していた場合のみ復元する(連戦冪等性)
    if (this._pcssPatched) {
      unpatchPcss();
      this.renderer.shadowMap.type = this._prevShadowType;
      this._pcssPatched = false;
    }

    this.effects.dispose();
    this.viewModel.dispose();
    for (const item of this.thrown) {
      this.scene.remove(item.mesh);
      (item.mesh.material as THREE.Material).dispose();
    }
    this.thrown = [];
    this.clearRockets();
    this.clearBowProjectiles();
    this.clearStaffProjectiles();
    this.clearShurikenDiscs();
    this.rocketGeo.dispose();
    this.rocketTrailGeo.dispose();
    this.rocketMat.dispose();
    this.rocketTrailMat.dispose();
    this.bowArrowGeo.dispose();
    this.bowArrowMat.dispose();
    this.staffBoltGeo.dispose();
    this.staffBoltMat.dispose();
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
        // ★V-C修正(防御): userData.shared=true のジオメトリ/マテリアルはモジュール寿命の
        // 共有資産(zombie-crowd正準ジオメトリ/共有マテリアル等)なので解放しない。
        // 現状はtraverse前にremove済みで到達しないが、順序変更に対する二重の守り
        if (obj.geometry.userData.shared !== true) obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          for (const m of material) if (m.userData.shared !== true) m.dispose();
        } else {
          if (material.userData.shared !== true) material.dispose();
        }
        // InstancedMeshのinstanceMatrixはgeometry.dispose()では解放されないため明示的に
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      } else if (obj instanceof THREE.Light) {
        // DirectionalLightの影マップ(2048²のRT)はLightShadow.dispose()でのみ解放される
        const light = obj as THREE.Light & { shadow?: { dispose?: () => void } };
        light.shadow?.dispose?.();
      }
    });
    this.disposeTrainingTargets();
    // ★ ゾンビメッシュプールを解放(scene.traverseの外にいるため明示的に dispose が必要)
    for (const bot of this.zombiePool) {
      bot.dispose();
    }
    this.zombiePool.length = 0;
    this.botGhostUpdateBucket.clear();
    this.botGhostPos.clear();
    this.physics.free();
  }

  // ── 特殊兵装: 月光弓 満月の矢 ──────────────────────────────────
  private fireGekkouFullMoon(): void {
    const origin = this.player.eyePosition.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'),
    );
    this.effects.gekkouFullMoon(origin, dir);
    this.sounds.gekkouFullMoonSound();
    this.viewModel.fire(true);
    this.addShake(0.18);
    this.alertBots(ALERT_RADIUS_SUPPRESSED);
    // 貫通hitscan ×3本 各200dmg
    const BASE_DMG = 200;
    for (let i = 0; i < 3; i++) {
      const spread = (i - 1) * 0.015;
      const spreadDir = dir.clone().applyEuler(new THREE.Euler(spread, spread * 0.5, 0));
      spreadDir.normalize();
      this.fireExoticBeamRay(origin, spreadDir, BASE_DMG, 600, '月光弓');
    }
  }

  // ── 特殊兵装: 天雷杖 天罰 ──────────────────────────────────────
  private fireTenraiTenbatsu(): void {
    const origin = this.player.eyePosition.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'),
    );
    // 照準点(60m以内の着弾点)へ天雷を落とす
    const aimHit = this.castRay(origin, dir, 60, this.player.body);
    const center = origin.clone().addScaledVector(dir, aimHit ? hitToi(aimHit) : 30);
    const radius = 12;
    this.effects.tenraiTenbatsu(center, radius, this.settings.reduceMotion);
    this.sounds.tenraiTenbatsuSound();
    this.addShake(0.25);
    this.alertBots(ALERT_RADIUS);
    const dmg = 800; // 桁外れ: 基礎160の5倍
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (bot.position.distanceTo(center) <= radius) {
        this.applyBotDamage(bot, dmg, bot.position.clone(), false, '天雷杖', true, false, 'exotic');
        this.botStunUntil.set(bot, this.elapsed + 2.0);
      }
    }
  }

  // ── 特殊兵装: 貫通ビームhitscan共通 ─────────────────────────────
  private fireExoticBeamRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    damage: number,
    range: number,
    weaponName = '特殊兵装',
    grantUlt = true,
    srcClass: WeaponClass | null = 'exotic',
    stopAtWorld = false,
  ): void {
    const hitSet = new Set<number>();
    let from = origin.clone();
    let remaining = range;
    for (let pass = 0; pass < 6 && remaining > 0; pass++) {
      const hit = this.castRay(from, dir, remaining, this.player.body);
      if (!hit) break;
      const toi = hitToi(hit);
      const tag = this.tags.get(hit.collider.handle);
      // V37: 万刃/修羅は壁で止まる(満月の矢/蜃気楼は全貫通=仕様)
      if (stopAtWorld && tag?.kind === 'world') break;
      if (tag?.kind === 'bot' && tag.bot.alive && tag.bot.team !== PLAYER_TEAM && !hitSet.has(tag.bot.uid)) {
        hitSet.add(tag.bot.uid);
        const pt = from.clone().addScaledVector(dir, toi);
        this.applyBotDamage(tag.bot, damage, pt, false, weaponName, grantUlt, false, srcClass);
      }
      from = from.clone().addScaledVector(dir, toi + 0.05);
      remaining -= toi + 0.05;
    }
  }

  // ── 特殊兵装: hold-fire溜めチャージ更新 ──────────────────────────
  private updateExoticHoldFireCharge(dt: number): void {
    const weapon = this.activeWeapon;
    if (!EXOTIC_HOLD_FIRE_IDS.has(weapon.def.id) || !this.player.alive || this.killcamCamActive) {
      // 武器替え/死亡/killcam中は溜め状態を破棄(リスポーン直後の暴発防止)
      if (this.exoticHoldFireCharging || this.exoticHoldFireActive) {
        this.exoticHoldFireCharging = false;
        this.exoticHoldFireActive = false;
        this.exoticHoldFireTimer = 0;
        this.viewModel.setExoticCharge(weapon.def.id, 0);
      }
      return;
    }

    const triggerDown = this.input.fireDown();
    if (triggerDown && !this.exoticHoldFireActive) {
      this.exoticHoldFireActive = true;
      this.exoticHoldFireTimer = 0;
    }
    if (this.exoticHoldFireActive) {
      if (triggerDown) {
        this.exoticHoldFireTimer += dt;
        if (this.exoticHoldFireTimer >= 0.25) {
          this.exoticHoldFireCharging = true;
        }
        if (this.exoticHoldFireCharging) {
          this.viewModel.setExoticCharge(weapon.def.id, Math.min(1, this.exoticHoldFireTimer / 1.2));
        }
      } else {
        if (this.exoticHoldFireCharging && this.exoticHoldFireTimer >= 0.25) {
          this.fireExoticHoldFireRelease(weapon.def.id, Math.min(1, this.exoticHoldFireTimer / 1.2));
        }
        this.exoticHoldFireActive = false;
        this.exoticHoldFireCharging = false;
        this.exoticHoldFireTimer = 0;
        this.viewModel.setExoticCharge(weapon.def.id, 0);
      }
    }
  }

  // ── 特殊兵装: hold-fire溜め発射 ──────────────────────────────────
  private fireExoticHoldFireRelease(weaponId: string, charge01: number): void {
    const origin = this.player.eyePosition.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'),
    );
    const isMax = charge01 >= 0.99;
    switch (weaponId) {
      case 'banjin-smg': {
        if (isMax) {
          this.effects.banjinStorm(origin, dir);
          this.sounds.banjinStormSound();
          this.addShake(0.15);
          const pellets = 16;
          for (let i = 0; i < pellets; i++) {
            const angle = ((i / (pellets - 1)) - 0.5) * Math.PI * 0.5;
            const spreadDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            this.fireExoticBeamRay(origin, spreadDir, 45 * charge01 * 2, 60, '万刃', true, 'exotic', true);
          }
        } else {
          for (let i = 0; i < 3; i++) {
            this.fireExoticBeamRay(origin, dir, 45 * charge01 * 2, 60, '万刃', true, 'exotic', true);
          }
          this.addShake(0.05);
        }
        this.alertBots(ALERT_RADIUS_SUPPRESSED);
        break;
      }
      case 'fujin-fan': {
        this.effects.fujinTyphoon(origin, dir);
        this.sounds.fujinTyphoonSound();
        this.addShake(0.12);
        const fanRange = 12 + charge01 * 8;
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          const toBotDir = bot.position.clone().sub(origin).normalize();
          const dot = toBotDir.dot(dir);
          const dist = bot.position.distanceTo(origin);
          if (dot > 0.5 && dist <= fanRange) {
            const dmg = 35 * charge01 * 10;
            this.applyBotDamage(bot, dmg, bot.position.clone(), false, '風神扇', true, false, 'exotic');
            this.botStunUntil.set(bot, this.elapsed + 0.8 * charge01);
          }
        }
        this.alertBots(ALERT_RADIUS);
        break;
      }
      case 'gouen-musket': {
        // 照準先の着弾点(120m以内)に大爆風
        const aimHit = this.castRay(origin, dir, 120, this.player.body);
        const target = origin.clone().addScaledVector(dir, aimHit ? hitToi(aimHit) : 120);
        this.effects.gouenBlast(target, this.settings.reduceMotion);
        this.sounds.gouenBlastSound();
        this.addShake(0.3 * charge01);
        const blastR = 6 + charge01 * 6;
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          if (bot.position.distanceTo(target) <= blastR) {
            const dmg = 260 * charge01 * 3; // 桁外れ: 最大780
            this.applyBotDamage(bot, dmg, bot.position.clone(), false, '業炎銃', true, false, 'exotic');
          }
        }
        // 爆心に延焼床
        this.firePatches.push({
          pos: target.clone(),
          radius: blastR * 0.6,
          until: this.elapsed + 3 * charge01,
          tickIn: 0,
          crackleIn: 0,
        });
        this.alertBots(ALERT_RADIUS);
        break;
      }
      case 'shinkirou-sniper': {
        const yawFrom = this.player.yaw - 0.3 * charge01;
        const yawTo = this.player.yaw + 0.3 * charge01;
        this.effects.shinkirouSweep(origin, yawFrom, yawTo);
        this.sounds.shinkirouSweepSound();
        this.addShake(0.1);
        const sweepSteps = 7;
        for (let i = 0; i < sweepSteps; i++) {
          const yaw = yawFrom + (yawTo - yawFrom) * (i / (sweepSteps - 1));
          const sweepDir = new THREE.Vector3(0, 0, -1).applyEuler(
            new THREE.Euler(this.player.pitch, yaw, 0, 'YXZ'),
          );
          this.fireExoticBeamRay(origin, sweepDir, 90 * charge01 * 3, 600, '蜃気楼');
        }
        this.alertBots(ALERT_RADIUS);
        break;
      }
    }
  }

  // ── 特殊兵装: 修羅チャージ(ADS+fire hold) ───────────────────────
  private updateShuraCharge(dt: number): void {
    const weapon = this.activeWeapon;
    if (weapon.def.special !== 'minigun' || !this.player.alive || this.killcamCamActive) {
      // 武器替え/死亡/killcam中は溜め・連撃とも破棄
      if (this.shuraChargeTimer > 0 || this.shuraRampageTimer > 0) {
        this.shuraChargeTimer = 0;
        this.shuraRampageTimer = 0;
        this.shuraRampageFireTimer = 0;
        this.exoticDamageBoost = 1;
        this.viewModel.setExoticCharge('shura-lmg', 0);
      }
      return;
    }
    if (this.shuraRampageTimer > 0) {
      this.shuraRampageTimer -= dt;
      this.exoticDamageBoost = this.shuraRampageTimer > 0 ? 1.5 : 1;
      this.shuraRampageFireTimer -= dt;
      if (this.shuraRampageFireTimer <= 0 && this.shuraRampageTimer > 0) {
        this.shuraRampageFireTimer = 0.05;
        const rampageOrigin = this.player.eyePosition.clone();
        const rampageDir = new THREE.Vector3(0, 0, -1).applyEuler(
          new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'),
        );
        const spread = Math.sin(this.elapsed * 97.3) * 0.02; // 決定論スプレッド(乱数不使用)
        const spreadDir = rampageDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        this.fireExoticBeamRay(rampageOrigin, spreadDir, 28, 360, '修羅', true, 'exotic', true);
        this.sounds.shot('lmg');
        this.effects.shuraRampage(rampageOrigin);
      }
      if (this.shuraRampageTimer <= 0) {
        this.shuraRampageTimer = 0;
        this.exoticDamageBoost = 1;
        this.viewModel.setExoticCharge('shura-lmg', 0);
      }
      return;
    }
    const adsHeld = weapon.adsProgress > 0.3 && this.input.fireDown();
    if (adsHeld) {
      // 仕様: ADS-hold 1.0s で阿修羅連撃
      this.shuraChargeTimer = Math.min(1, this.shuraChargeTimer + dt);
      this.viewModel.setExoticCharge('shura-lmg', this.shuraChargeTimer);
      this.shuraChargeTickTimer -= dt;
      if (this.shuraChargeTickTimer <= 0) {
        this.shuraChargeTickTimer = 0.2;
        this.sounds.staffChargeTick(this.shuraChargeTimer);
      }
      if (this.shuraChargeTimer >= 1) {
        this.shuraRampageTimer = 4.0;
        this.shuraRampageFireTimer = 0;
        this.exoticDamageBoost = 1.5;
        this.effects.shuraRampage(this.player.eyePosition.clone());
        this.sounds.shuraRampageSound();
        this.announcements.push('阿修羅連撃');
        this.addShake(0.3);
        this.shuraChargeTimer = 0;
        this.viewModel.setExoticCharge('shura-lmg', 0);
      }
    } else {
      if (this.shuraChargeTimer > 0) {
        this.shuraChargeTimer = Math.max(0, this.shuraChargeTimer - dt * 2);
        this.viewModel.setExoticCharge('shura-lmg', this.shuraChargeTimer);
      }
    }
  }

  // ── 特殊兵装: 影分身・万刃繚乱 持続更新(4秒間0.4s毎に可視全敵へ150) ──
  private updateBanjinKagemai(dt: number): void {
    if (this.banjinKagemaiTimer <= 0) return;
    this.banjinKagemaiTimer = Math.max(0, this.banjinKagemaiTimer - dt);
    this.banjinKagemaiDmgTimer -= dt;
    if (this.banjinKagemaiDmgTimer > 0) return;
    this.banjinKagemaiDmgTimer = 0.4;
    const eye = this.player.eyePosition;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const toBot = bot.position.clone().sub(eye);
      const dist = toBot.length();
      // 可視判定: world遮蔽が無い敵のみ(boundaryは視線を通す)
      const losHit = this.castRay(eye, toBot.clone().normalize(), Math.max(0.1, dist - 0.3), this.player.body,
        (c) => this.tags.get(c.handle)?.kind === 'world');
      if (losHit) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, 150, point, false, '影分身・万刃繚乱', false);
    }
    this.alertBots(ALERT_RADIUS_SUPPRESSED);
  }

  // ── 特殊兵装: 月落とし 着弾更新(発動2秒後に照準点30m圏へ5000) ──
  private updateGekkouMoon(dt: number): void {
    if (this.gekkouMoonTimer <= 0) return;
    this.gekkouMoonTimer -= dt;
    if (this.gekkouMoonTimer > 0) return;
    this.gekkouMoonTimer = 0;
    const center = this.gekkouMoonPos;
    this.gekkouMoonPos = null;
    if (!center) return;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      if (bot.position.distanceTo(center) > 30) continue;
      const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
      this.applyBotDamage(bot, 5000, point, false, '月落とし', false);
    }
    this.addShake(this.settings.reduceMotion ? 0.3 : 0.7);
    this.alertBots(80);
  }

  // ── 特殊兵装: 蜃気楼 虚像世界 持続更新 ─────────────────────────
  private updateShinkirouKyozou(dt: number): void {
    if (this.shinkirouKyozouTimer <= 0) return;
    this.shinkirouKyozouTimer -= dt;
    if (this.shinkirouKyozouTimer > 0) {
      this.exoticDamageBoost = 1.5;
    } else {
      this.shinkirouKyozouTimer = 0;
      this.exoticDamageBoost = 1;
    }
  }

  // ── 特殊兵装: 阿修羅降臨 持続更新(5秒間0.15s毎に最寄り可視敵へ自動120) ──
  private updateShuraKourin(dt: number): void {
    if (this.shuraKourinTimer <= 0) return;
    this.shuraKourinTimer = Math.max(0, this.shuraKourinTimer - dt);
    this.shuraKourinDmgTimer -= dt;
    if (this.shuraKourinDmgTimer > 0) return;
    this.shuraKourinDmgTimer = 0.15;
    const eye = this.player.eyePosition;
    let nearest: Bot | null = null;
    let nearestDist = Infinity;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === PLAYER_TEAM) continue;
      const dist = bot.position.distanceTo(eye);
      if (dist >= nearestDist) continue;
      const toBot = bot.position.clone().sub(eye);
      const losHit = this.castRay(eye, toBot.clone().normalize(), Math.max(0.1, dist - 0.3), this.player.body,
        (c) => this.tags.get(c.handle)?.kind === 'world');
      if (losHit) continue;
      nearest = bot;
      nearestDist = dist;
    }
    if (nearest) {
      const point = new THREE.Vector3(nearest.position.x, nearest.position.y + 0.3, nearest.position.z);
      this.applyBotDamage(nearest, 120, point, false, '阿修羅降臨', false);
    }
  }

  // ── 特殊兵装: Mウルト発動ルーター(ゲージ全消費 + TTS/バナー告知) ──
  private activateExoticUlt(weaponId: string): void {
    if (this.ultCharge < 1) return;
    this.ultCharge = 0;
    this.ultReadyNotified = false;
    const origin = this.player.eyePosition.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'),
    );
    const announce = (label: string): void => {
      this.announcements.push(label);
      this.sounds.announceStreak(label, this.settings.announcerVolume);
    };
    switch (weaponId) {
      case 'banjin-smg': {
        // 影分身・万刃繚乱: 4秒間0.4s毎に可視全敵へ150(updateBanjinKagemai)
        this.effects.banjinKagemai(this.player.position.clone(), this.settings.reduceMotion);
        this.sounds.banjinKagemaiSound();
        this.banjinKagemaiTimer = 4.0;
        this.banjinKagemaiDmgTimer = 0;
        announce('影分身・万刃繚乱');
        this.addShake(0.3);
        break;
      }
      case 'gekkou-bow': {
        // 月落とし: 照準点へ2秒後に着弾、30m圏5000(updateGekkouMoon)
        const aimHit = this.castRay(origin, dir, 200, this.player.body);
        const aimPt = origin.clone().addScaledVector(dir, aimHit ? hitToi(aimHit) : 100);
        this.effects.gekkouTsukiotoshi(aimPt, this.settings.reduceMotion);
        this.sounds.gekkouTsukiotoshiSound();
        this.gekkouMoonTimer = 2.0;
        this.gekkouMoonPos = aimPt;
        announce('月落とし');
        this.addShake(0.2);
        break;
      }
      case 'fujin-fan': {
        // 神風・天空舞: 全敵の足元に竜巻 + 1500 + 1.5sスタン
        this.effects.fujinKamikaze(this.player.position.clone(), 60, this.settings.reduceMotion);
        this.sounds.fujinKamikazeSound();
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          this.effects.fujinTornadoAt(bot.position.clone());
          const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
          this.applyBotDamage(bot, 1500, point, false, '神風・天空舞', false);
          this.botStunUntil.set(bot, Math.max(this.botStunUntil.get(bot) ?? 0, this.elapsed + 1.5));
        }
        announce('神風・天空舞');
        this.addShake(0.5);
        this.alertBots(80);
        break;
      }
      case 'gouen-musket': {
        // 業火滅世: 前方60m×幅20mの回廊に2000 + 延焼床
        this.effects.gouenMesse(origin, dir, this.settings.reduceMotion);
        this.sounds.gouenMesseSound();
        const fwdH = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        const right = new THREE.Vector3().crossVectors(fwdH, new THREE.Vector3(0, 1, 0)).normalize();
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          const toBot = new THREE.Vector3(bot.position.x - origin.x, 0, bot.position.z - origin.z);
          const along = fwdH.dot(toBot);
          if (along < 0 || along > 60) continue;
          if (Math.abs(right.dot(toBot)) > 10) continue;
          const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
          this.applyBotDamage(bot, 2000, point, false, '業火滅世', false);
        }
        // 回廊に沿って延焼床(足元高さ)
        const foot = this.player.position.clone();
        foot.y -= PLAYER_FEET_OFFSET;
        // V37修正: 第1パッチを12mから(半径8.4mの判定内に術者が入り自己延焼していた)
        for (let d = 12; d <= 60; d += 12) {
          this.firePatches.push({
            pos: foot.clone().addScaledVector(fwdH, d),
            radius: 8,
            until: this.elapsed + 4,
            tickIn: 0,
            crackleIn: 0,
          });
        }
        announce('業火滅世');
        this.addShake(0.5);
        this.alertBots(80);
        break;
      }
      case 'tenrai-staff': {
        // 神鳴八雷: 全敵の頭上へ落雷、各2500
        const positions: THREE.Vector3[] = [];
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          positions.push(bot.position.clone());
        }
        this.effects.tenraiHachirai(positions, this.settings.reduceMotion);
        this.sounds.tenraiHachiraiSound();
        for (const bot of this.bots) {
          if (!bot.alive || bot.team === PLAYER_TEAM) continue;
          const point = new THREE.Vector3(bot.position.x, bot.position.y + 0.3, bot.position.z);
          this.applyBotDamage(bot, 2500, point, false, '神鳴八雷', false);
        }
        announce('神鳴八雷');
        this.addShake(0.6);
        this.alertBots(80);
        break;
      }
      case 'shinkirou-sniper': {
        // 虚像世界: 6秒間 敵全体速度×0.1スロー + 自ダメージ×1.5バフ
        this.effects.shinkirouKyozou(6, this.settings.reduceMotion);
        this.sounds.shinkirouKyozouSound();
        this.shinkirouKyozouTimer = 6.0;
        this.exoticDamageBoost = 1.5;
        announce('虚像世界');
        this.addShake(0.25);
        break;
      }
      case 'shura-lmg': {
        // 阿修羅降臨: 5秒間0.15s毎に最寄り可視敵へ自動120 + 移動+30%
        this.effects.shuraKourin(this.player.position.clone(), this.settings.reduceMotion);
        this.sounds.shuraKourinSound();
        this.shuraKourinTimer = 5.0;
        this.shuraKourinDmgTimer = 0;
        announce('阿修羅降臨');
        this.addShake(0.3);
        break;
      }
    }
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
