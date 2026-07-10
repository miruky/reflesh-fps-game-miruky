// R54 match.ts分割リレーのゴールデンテスト(F1 段階0)。
// 目的: 「分割=コードの移動のみ、公開面(exportサーフェス/MatchSnapshot構造)は不変」を
// 機械的に保証する回帰網。分割後も match.ts の re-export シムがこの表面を維持する限り、
// hud/menu/main/既存テスト群のimportは無傷であることの証明になる。
// ⚠ このリストの変更 = 公開契約の変更。分割作業(移動)では絶対に変わらないこと。
// 新機能でexportを「追加」する場合のみリストへ追記する(削除・改名はレビュー必須)。
import { describe, expect, it } from 'vitest';
import * as M from './match';
import type { MatchSnapshot } from './match';
import {
  applyHellTierTuning,
  ckSpeedAt,
  crowdSlotAction,
  fkIsStale,
  refundRound,
  rollWeather,
} from './match';

// ── (a) ランタイムexportサーフェスのスナップショット(main=9ccd851 時点で採取) ──
const GOLDEN_EXPORTS = [
  "EXT_MAG_EXCLUDED_IDS",
  "Match",
  "PAP_CAMO_BY_TIER",
  // R54-F2 意図的追加: ZombieDirectorと共有する4シンボル(移動でなく共有のためexport化)
  "PLAYER_FEET_OFFSET",
  "PLAYER_NAME",
  "ULT_ON_DAMAGE_PER_HP",
  "applyHellTierTuning",
  "applyHellTuning",
  "applyMissionDifficultyTuning",
  "bowChargeMultiplier",
  "buildPropFamilyMaterial",
  "buildPropVisualFamilyGeometries",
  "ckCamPos",
  "ckSpeedAt",
  "crowdSlotAction",
  "emperorChargeStageFor",
  "fanPelletYaw",
  "fkIsStale",
  "floorDetailEligible",
  "hitToi", // R54-F2 意図的追加(同上)
  "hotspotEma",
  "instaKillApplies",
  "isCrowdEligible",
  "minigunNextRpm",
  "ninjaHp300Eligible",
  "papInteractSealed",
  "papTierAfterWallBuy",
  "permanentDarkEmperorEligible",
  "planPropVisualsV2",
  "prewarmSurfaceKitVariants",
  "propFamilyShadowFlags",
  "refundRound",
  "resolveNaturalBotKind",
  "rollWeather",
  "shadowLodFlags",
  "shurikenDiscLife",
  "spawnDistScore",
  "splitRadioLines",
  "zombieHordeRanks"
] as const;

describe('match公開面ゴールデン(分割リレーの前提ゲート)', () => {
  it('ランタイムexportの集合が固定リストと完全一致する', () => {
    expect(Object.keys(M).sort()).toEqual([...GOLDEN_EXPORTS]);
  });

  it('Match はクラス(function)としてexportされている', () => {
    expect(typeof M.Match).toBe('function');
  });
});

// ── (b) MatchSnapshot の全フィールド名を型レベルで固定 ──
// Record<keyof MatchSnapshot, true> への代入は、キーの欠落・過剰の両方でコンパイルエラーになる。
// (tscゲートが構造の增減を検知する。ランタイムassertはMatch実体が必要なため型で固定する)
const SNAPSHOT_KEYS: Record<keyof MatchSnapshot, true> = {
  hp: true,
  maxHp: true,
  alive: true,
  respawnIn: true,
  ammo: true,
  reserve: true,
  magSize: true,
  weaponName: true,
  weaponSlot: true,
  fireMode: true,
  reloading: true,
  reloadRatio: true,
  spreadRad: true,
  adsProgress: true,
  kills: true,
  deaths: true,
  streak: true,
  timeLeft: true,
  yaw: true,
  fov: true,
  over: true,
  speed: true,
  sliding: true,
  wallRunning: true,
  airborne: true,
  reduceMotion: true,
  radarEnabled: true,
  ultCharge: true,
  ultActive: true,
  scopedWeapon: true,
  opticId: true,
  adsOpticActive: true,
  sightStyle: true,
  scope: true,
  aimAssistEngaged: true,
  rangeM: true,
  zoomX: true,
  reticleStyle: true,
  reticleColor: true,
  weaponId: true,
  grenadeName: true,
  grenadeCount: true,
  cookRatio: true,
  whiteout: true,
  modeName: true,
  teamBased: true,
  scoreMine: true,
  scoreEnemy: true,
  scoreTarget: true,
  zones: true,
  announcements: true,
  spectating: true,
  killcam: true,
  killcamRatio: true,
  killcamWeapon: true,
  killcamDistM: true,
  killcamFlash: true,
  deathVeil: true,
  killcamFinal: true,
  killcamCamActive: true,
  fkCinematicActive: true,
  fkWeaponName: true, // R54-F7 意図的追加: 最終キル武器名(シネマ帯バナー)
  lowHp01: true,
  postfxActive: true,
  feed: true,
  hits: true,
  hitExpandRad: true,
  damageNumbers: true,
  missionId: true,
  objectiveText: true,
  objectiveProgress01: true,
  waveIndex: true,
  waveTotal: true,
  bossHp01: true,
  zombieRound: true,
  zombieKills: true,
  zombiePoints: true,
  playerDowns: true,
  zombieShopPrompt: true,
  zombiePerks: true,
  zombiePerkStacks: true,
  zombieQuickReviveCharges: true,
  papTier: true,
  zombiePowerUps: true,
  activePowerUps: true,
  specialRound: true,
  poison01: true,
  // R54-F5: 輪廻(ローグラン)snapshot契約の意図的追加(供給=ZombieDirector.rogueSnap())
  rogue: true,
  radioLine: true,
  detect01: true,
  bossPhase: true,
  sndPhase: true,
  sndScore: true,
  sndBombTimer: true,
  sndProgress01: true,
  sndProgressKind: true,
  sndCarrierIsPlayer: true,
  uiHeat: true,
  moments: true,
  emperorState: true,
  zombieBossFlash: true,
  zombiePointFloats: true,
  zombieReviveFlash: true,
  darkEmperorS: true,
  darkEmperorPermanent: true,
  raiteiMode: true,
  kokuraiteiMode: true,
  chargeRatio: true,
  minigunSpin01: true,
  adsKeepsCrosshair: true,
  incoming: true,
  tookDamage: true,
  scoreboard: true,
  scoreEvents: true,
  enemyBearings: true,
  medals: true,
  streakProgress: true,
  streakBanked: true,
  streakUavActive: true,
  streakUavTimeLeft: true,
  streakRcxdActive: true,
  streakRcxdTimeLeft: true,
  streakCauavActive: true,
  streakCauavTimeLeft: true,
  minimapEnemies: true,
  minimapAllies: true,
  minimapStageSize: true,
  fireBlips: true,
  hardpointZoneAngle: true,
  hardpointZoneRelX: true,
  hardpointZoneRelZ: true,
  hardpointOwner: true,
  hardpointContested: true,
  hardpointTimeLeft: true,
  hardpointPreview: true,
  kcEvent: true,
  kcTagPositions: true,
  ggRank: true,
  ggWeaponName: true,
  ggRankUpFlash: true,
  ggSetback: true,
  ggTop3: true,
  trainingStats: true,
  destroyedPropHandles: true,
  hellMode: true,
};

describe('MatchSnapshot構造ゴールデン', () => {
  it('フィールド数が固定値と一致する(143フィールド、main=9ccd851時点)', () => {
    expect(Object.keys(SNAPSHOT_KEYS).length).toBe(145); // R54-F5: +rogue / R54-F7: +fkWeaponName
  });
});

// ── (c) 主要純関数の代表値スモーク(移動後も値が1bitも変わらないことの標本) ──
describe('純関数ゴールデンスモーク', () => {
  it('rollWeather: 同一seedは決定論、既知標本', () => {
    expect(rollWeather(1234)).toBe(rollWeather(1234));
    expect(rollWeather(1)).toBe(rollWeather(1));
    // 3種のいずれかであること(分布実装の存在確認)
    expect(['clear', 'fog', 'rain']).toContain(rollWeather(42));
  });

  it('fkIsStale: 境界値(バッファ窓-1秒が閾値)', () => {
    expect(fkIsStale(10, 10, 4.5)).toBe(false);
    expect(fkIsStale(13.4, 10, 4.5)).toBe(false); // 3.4 < 3.5
    expect(fkIsStale(13.6, 10, 4.5)).toBe(true); // 3.6 > 3.5
  });

  it('ckSpeedAt: ランプ標本(kill前1.0→0.2→復帰)', () => {
    expect(ckSpeedAt(-1, 0)).toBeCloseTo(1.0, 6);
    expect(ckSpeedAt(0.3, 0)).toBeCloseTo(0.2, 6);
    expect(ckSpeedAt(-0.2, 0)).toBeCloseTo(0.6, 6); // 線形補間の中点
  });

  it('crowdSlotAction: デッドバンド標本(rank<7かつslot有=release / rank>9かつslot無=acquire)', () => {
    expect(crowdSlotAction(5, true, true)).toBe('release');
    expect(crowdSlotAction(8, true, true)).toBe('none'); // デッドバンド帯は現状維持
    expect(crowdSlotAction(8, false, true)).toBe('none');
    expect(crowdSlotAction(10, false, true)).toBe('acquire');
  });

  it('refundRound: 上限クランプ標本', () => {
    expect(refundRound(3, 10)).toBe(4);
    expect(refundRound(10, 10)).toBe(10);
  });

  it('applyHellTierTuning: zombie bossのみHP据え置き標本', () => {
    const merged = { maxHp: 1000, damage: 10, moveSpeedMul: 1, fireCooldownMul: 1, spreadMul: 1, scale: 1 };
    const z = applyHellTierTuning({ ...merged } as never, 'boss', 'zombie');
    const t = applyHellTierTuning({ ...merged } as never, 'boss', 'tank');
    expect(z.maxHp).toBe(1000);
    expect(t.maxHp).toBe(3000);
  });
});
