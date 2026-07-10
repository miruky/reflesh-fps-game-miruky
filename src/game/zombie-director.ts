// R54-F2: ZombieDirector — match.ts から「移動のみ」で抽出したゾンビ系サブシステム。
// ラウンド進行/スポーン(プール・InstancedMesh協定)/経済(PaP・パーク・箱・壁・ドア)/
// パワーアップ/毒霧/お守り/近接/群衆ランク・feed を単独所有する。
// 依存は ZombieHost(遅延getter+委譲メソッドの束)経由 — Match への逆参照/循環importなし。
// 【分割の掟】ここへの追加は「ゾンビ専用」のみ。ダメージパイプ(applyBotDamage)は
// Match 側の単一漏斗のまま(このクラスは状態と発火だけを持つ)。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import type { Rand } from '../core/rng';
import { resolveGraphicsTier, type Settings } from '../core/settings';
import { Effects } from '../render/effects';
import { ViewModel, buildGunBody } from '../render/viewmodel';
import { ZombieCrowdRenderer, ZOMBIE_CROWD_INSTANCED } from '../render/zombie-crowd';
import { applyAttachments } from './attachments';
import { Bot, tuningFor, KIND_TUNING, BOT_NAMES, type BotTuning, type ZombieCrowdPose } from './bot';
import { Player } from './player';
import { Weapon, WEAPON_DEFS } from './weapons';
import { MedalTracker, type MedalEvent } from './medals';
import {
  ZOMBIE_MAX_ALIVE, zombieTotal, zombieHp, zombieRunRate, zombieEliteRate, 
  isBossRound, zombieBossHp, zombieBossSpeedMul, zombieBossDamage, specialRoundKind,
  RUSH_HP_MUL, RUSH_CLEAR_BONUS_PT,
} from './zombie';
import {
  generateShopLayout, purchasePerk, buyResult, rollMysteryBox, canBuy, composeZombieWeaponDef,
  PERKS, MYSTERY_BOX_COST, PAP_COST, PAP_REFILL_COST, DOOR_COST,
  POWERUP_DURATION_S, POWERUP_DESPAWN_S, POWERUP_ROUND_CAP, rollPowerUpAt, POWERUP_DROP_CHANCE,
  NUKE_BONUS_PT, CARPENTER_BONUS_PT, rollZombieVariant, BLAST_RADIUS_M, BLAST_DMG,
  MIASMA_RADIUS_M, MIASMA_DURATION_S, MIASMA_DPS, getCharmEffect, LAST_ZOMBIE_PERK_KEY,
  type ShopLayout, type ShopSlot, type ZombiePerkId, type PapTier, type PowerUpKind, type CharmEffect,
} from './zombie-economy';
import { papInteractSealed, papTierAfterWallBuy, isCrowdEligible, crowdSlotAction, EXT_MAG_EXCLUDED_IDS, PAP_CAMO_BY_TIER, applyHellTuning, zombieHordeRanks } from './match-helpers';
import { zombieSeparationGrid } from './bot';
import {
  emptyRogueMods, applyCardToMods, rollRogueOfferWithTier, rogueTierFor,
  readRogueMeta, writeRogueMeta, accumulateRogueMeta,
  type RogueMods, type RogueCard,
} from './roguerun';
import type { MatchConfig, FeedEntry, MomentEvent } from './match-types';
import { ENEMY_TEAM } from './modes';
import { PLAYER_FEET_OFFSET, PLAYER_NAME, ULT_ON_DAMAGE_PER_HP, hitToi, type ColliderTag, type RayHitLike } from './match';

const MIASMA_TICK_S = 0.5; // 毒雲DPSの離散ティック間隔(FIRE_TICK_Sと同じ流儀)
// ── R16 ゾンビモード ──
const ZOMBIE_MOVE_MUL = 1.44; // 基準速度に対するシャンブル倍率(走行個体は updateZombie で×1.6)
const ZOMBIE_MELEE_GLOBAL_GAP = 0.35; // 何体いても近接ダメージはこの間隔以上(同フレーム多段一撃回避)
const ZOMBIE_IFRAME = 0.5; // 近接被弾後のプレイヤー無敵時間
const ZOMBIE_ROUND_COOLDOWN = 0.8; // ラウンドクリア後、次ラウンドまで(即次波: ジングルのみ)
const ZOMBIE_SPAWN_RING_MIN = 18; // 湧きリング内径(プレイヤーからの距離)
const ZOMBIE_SPAWN_RING_MAX = 32; // 湧きリング外径
// ★ ゾンビメッシュプール: high tierの最大同時生存数までプールを事前確保(108体)
const ZOMBIE_POOL_MAX = ZOMBIE_MAX_ALIVE.high;
// R53-W3 M3: ゾンビ群feed用の姿勢スクラッチ(pose()が値を読み切るため使い回し可)
const CROWD_POSE_SCRATCH: ZombieCrowdPose = {
  x: 0, y: 0, z: 0, visualLift: 0, rigLiftY: 0, scale: 1, heading: 0,
  walkPhase: 0, walkAmp: 0, anim: 0, bobPhase: 0, deathTilt: 0, dying01: 0,
  visible: true, elite: false,
};
const BOT_POS_SCRATCH = new THREE.Vector3();

export interface ZombieHost {
  readonly player: Player;
  readonly sounds: SoundKit;
  readonly announcements: string[];
  readonly config: MatchConfig;
  readonly bots: Bot[];
  readonly scene: THREE.Scene;
  readonly tags: Map<number, ColliderTag>;
  readonly tracker: MedalTracker;
  readonly weapons: [Weapon, Weapon];
  readonly rand: Rand;
  readonly effects: Effects;
  readonly settings: Settings;
  readonly activeWeapon: Weapon;
  readonly incoming: number[];
  readonly feed: FeedEntry[];
  readonly elapsed: number;
  readonly moments: MomentEvent[];
  readonly physics: RAPIER.World;
  readonly viewModel: ViewModel;
  readonly renderer: THREE.WebGLRenderer;
  readonly over: boolean;
  readonly input: Input;
  readonly activeIndex: number;
  addShake(amount: number): void;
  notePlayerDeath(killer?: Bot | null): void;
  applyBotDamage(bot: Bot, damage: number, point: THREE.Vector3, headshot: boolean, weaponName: string, grantUlt?: boolean, scopeKill?: boolean, srcClass?: import('./weapons').WeaponClass | null): boolean;
  spawnBot(name: string, spawn: THREE.Vector3, color: number, team: number, tuning: BotTuning, tier: import('./bot').BotTier, kind?: import('./bot').BotKind): Bot;
  emitMedals(events: MedalEvent[]): void;
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number, exclude: RAPIER.RigidBody | null, predicate?: (collider: RAPIER.Collider) => boolean): RayHitLike | null;
  refillGrenades(): void;
  isInView(pos: THREE.Vector3): boolean;
  haptic(durationMs: number, weak: number, strong: number): void;
  addUltCharge(amount: number): void;
  snapToGround(origin: THREE.Vector3): number;
  incomingAngle(source: THREE.Vector3): number;
  setTookDamage(v: boolean): void;
  setShakeTrauma(v: number): void;
  setDeathPos(v: THREE.Vector3 | null): void;
  setKiller(v: Bot | null): void;
  setKillcamTimer(v: number): void;
  setDeathVeil(v: number): void;
  setAdsLatch(v: boolean): void;
}

export class ZombieDirector {
  zombieFirstPerkSaved = false; // perkcarry供給側: 初回パーク保存の単発ガード
  zombieCrowd: ZombieCrowdRenderer | null = null; // ゾンビ群InstancedMesh
  // ── R16 ゾンビディレクタ(mode==='zombie'のみ稼働。matchが唯一の状態保持者)──
  zombieRound = 0;
  zombieKills = 0;
  zombiePoints = 0;
  zombieQueue = 0; // このラウンドの残り湧き数(一斉湧き: alive<cap のたびに即補充)
  zombieRoundCooldown = 0; // ラウンド間の小休止
  zombieTierCap = ZOMBIE_MAX_ALIVE.medium; // 同時生存上限(tier連動)
  readonly zombiePool: Bot[] = []; // ★ メッシュプール: 死亡済み通常ゾンビを再利用(buildZombieMesh削減)
  zombieMeleeGlobal = 0; // 近接ダメージのグローバル次回許可時刻(elapsed基準)
  zombieMeleeIframe = 0; // プレイヤーi-frameの終了時刻(elapsed基準)
  botShadowLodTimer = 0; // ★1 近接影LODの周期トグル(全モード共通。0.25s)
  zombieSpawnColor = 0x4c5a30; // ゾンビ本体の腐敗色(setupで確定)
  playerDowns = 0;
  private hordeDensityTimer = 0; // R54 音響2: setHordeDensity() 間欠発火(0.5s周期)
  // ── ゾンビ経済(R??) ──
  zombieShopLayout: ShopLayout | null = null;
  readonly zombieShopGroups: THREE.Group[] = [];
  zombieBoxPositions: THREE.Vector3[] = [];
  zombieBoxCurrentIdx = 0;
  zombieBoxGroupIdx = -1; // ミステリーボックスのzombieShopGroups内index(R53-W2: 末尾決め打ちバグの根治)
  zombiePerkStacks = new Map<ZombiePerkId, number>();
  private zombiePerkMoveMulBase = 1; // R54-F5: 実体。公開値は zombiePerkMoveMul ゲッター(輪廻の移速加算を合成)
  zombieQuickReviveCharges = 0;
  zombieBossBot: Bot | null = null;
  zombieBossFlash = 0;
  zombieShopPrompt: { label: string; canAfford: boolean; cost: number } | null = null;
  zombiePointFloats: Array<{ amount: number; world: THREE.Vector3 }> = [];
  zombieReviveFlash = 0;
  zombieBoxAnimTimer = 0;
  zombieBoxAnimMesh: THREE.Mesh | null = null;
  zombieBoxPendingWeapon: string | null = null;
  zombieBoxPendingMove = false; // boxMovesロール中(演出終了時に箱を移動+アナウンス)

  // ── R53-W2 Pack-a-Punch(武器ごとのtier。壁/箱で買い直すとMap削除=tier0リセット) ──
  readonly zombiePapTiers = new Map<string, PapTier>();
  zombiePapAnyDone = false; // 'pap-first'メダル用: 試合内で初めて鍛神したか

  // ── R53-W2 特殊ゾンビ変種 ──
  zombieVariantKillCount = 0; // 'variant-100'メダル用
  zombieBossKillCount = 0; // charm(bossdmg)解放条件用: summary.zombieBossKillsへ供給

  // ── R53-W2 パワーアップ(ドロップ+時限効果) ──
  zombiePowerUpRoundCount = 0; // ラウンド内ドロップ数(POWERUP_ROUND_CAPで抑止)
  // ★V-A修正(TODO消化): ドロップ視覚はB-FX2の powerUpBeacon(共有マテリアル・呼び出し側管理型)。
  // 回転/浮遊は group.userData.spinSpeed / bobAmplitude をmatch側updateが適用する契約
  readonly zombiePowerUpDrops: Array<{
    kind: PowerUpKind;
    pos: THREE.Vector3;
    remainS: number;
    mesh: THREE.Group;
  }> = [];
  zombieInstaKillTimer = 0;
  zombieDoublePointsTimer = 0;

  // ── R53-W2 毒霧(miasma variant死亡時に発生)。★V-A修正: 視覚はeffects.miasmaCloudの
  // プールへ委譲済み — matchはDPS判定用の位置/残時間エンティティのみ保持する ──
  readonly zombieMiasmaClouds: Array<{ pos: THREE.Vector3; remainS: number; tickIn: number }> = [];
  zombiePoison01 = 0; // HUDビネット用(0..1、雲内で1へ・それ以外は減衰)

  // ── R53-W2 特殊ラウンド(rush) ──
  zombieSpecialRound: 'rush' | null = null;

  // ── R53-W2 ドア(バリケード。購入でコライダー+ビジュアルを除去) ──
  zombieDoorOpen = false;
  // ★V-A MEDIUM修正: 鍛神台の封印制(ドア開放で解除)。ビジュアル暗転/復帰用のマテリアル参照
  zombieHasDoor = false;
  zombiePapCrystalMat: THREE.MeshStandardMaterial | null = null;
  zombiePapRingMat: THREE.MeshBasicMaterial | null = null;
  zombieDoorBody: RAPIER.RigidBody | null = null;
  zombieDoorCollider: RAPIER.Collider | null = null;
  zombieDoorVisual: { group: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.Material[] } | null = null;

  // ── R53-W2 お守り(charm) ──
  zombieCharmEffect: CharmEffect | null = null;
  zombieCharmReviveAvailable = false;

  // ── R54-F5 輪廻(ローグラン)。強化は rogueMods 単一集約 — 適用点は既存漏斗のみ ──
  rogueMods: RogueMods = emptyRogueMods();
  readonly rogueCardNames: string[] = []; // 取得カード名(表示順。snapshot/result供給)
  roguePickPending = false; // 供物の台座 選択待ち(ディレクタ凍結)
  roguePickRemain = 0; // 自動スキップまでの残秒(30s)
  rogueMetaTier = 0; // 恒久メタ境地(0-5。localStorage v1から)
  private rogueMetaDone = false; // dispose時のメタ加算の単発ガード
  readonly roguePedestals: Array<{
    card: RogueCard;
    group: THREE.Group;
    card3d: THREE.Mesh;
    geos: THREE.BufferGeometry[];
    mats: THREE.Material[];
  }> = [];

  constructor(private readonly h: ZombieHost) {
    // R53-W3 M3: ゾンビ群InstancedMesh(972DC→79の軽量化本命。kill-switchはzombie-crowd.ts)
    if (h.config.mode === 'zombie' && ZOMBIE_CROWD_INSTANCED) {
      this.zombieCrowd = new ZombieCrowdRenderer(h.scene);
    }
  }

  // 試合終了時のゾンビ系リソース解放(旧Match.dispose内の該当ブロックを原順序で移動)
  dispose(): void {
    // R54 音響2: 群密度ベッドを0へ(sounds はmatch跨ぎで単一インスタンス→非ゾンビ試合への持ち越し防止)
    this.h.sounds.setHordeDensity(0, 0);
    // R54-B1: 分離グリッドを空へ(次試合でrebuildされるまで separation はゼロ=安全)
    zombieSeparationGrid.clear();
    // R54-F5 輪廻: 恒久メタ加算(quit/全滅/再戦すべてdispose経由=一元化)。単発ガード付き
    if (this.rogueActive && !this.rogueMetaDone && this.zombieRound > 0) {
      this.rogueMetaDone = true;
      try {
        if (typeof localStorage !== 'undefined') {
          writeRogueMeta(localStorage, accumulateRogueMeta(readRogueMeta(localStorage), this.zombieRound));
        }
      } catch {
        /* localStorage不可は静かに無視 */
      }
    }
    this.clearRoguePedestals();
    this.zombieCrowd?.dispose(this.h.scene); // R53-W3 M3: ゾンビ群InstancedMeshの解放
    // ゾンビショップオブジェクトを解放
    for (const grp of this.zombieShopGroups) {
      this.h.scene.remove(grp);
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
      this.h.scene.remove(drop.mesh);
      this.h.effects.disposePowerUpBeacon(drop.mesh);
    }
    this.zombiePowerUpDrops.length = 0;

    // ★ ゾンビプールをフラッシュ(match終了時=プールBotはsceneに追加されていないのでdisposeのみ)
    for (const b of this.zombiePool) b.dispose();
    this.zombiePool.length = 0;
    if (this.zombieBoxAnimMesh) {
      this.h.scene.remove(this.zombieBoxAnimMesh);
      (this.zombieBoxAnimMesh.geometry as THREE.BufferGeometry).dispose();
      (this.zombieBoxAnimMesh.material as THREE.Material).dispose();
      this.zombieBoxAnimMesh = null;
    }
  }


  addZombiePoints(amount: number): void {
    // ★V-A修正: ヌーク中のキルはノーポイント(BO2準拠 — 100体×満額60ptで6000pt超の
    // 過剰供給を防ぐ。定額 NUKE_BONUS_PT のみ zombieNuke() が抑制フラグの外で付与する)
    if (this.zombieNukeSuppressPoints) return;
    // R54-F5: double(×2)×商才(1+pointsAdd)の合成は×3で頭打ち(将来の重複ボーナス対策)
    const rogueMul = this.rogueActive ? 1 + this.rogueMods.pointsAdd : 1;
    const mul = Math.min(3, (this.zombieDoublePointsTimer > 0 ? 2 : 1) * rogueMul);
    this.zombiePoints += Math.round(amount * mul);
  }

  // ── Pack-a-Punch/パーク: composeZombieWeaponDefへの一本化 ──────────────────
  // WEAPON_DEFSの基礎値から常に再計算する(現在値への乗算は禁止。R53-W2契約)。
  // fists(クナイ)はcompose自体が素通しするが、papCamo付与も無意味なため早期returnする。
  recomposeWeapon(w: Weapon): void {
    if (EXT_MAG_EXCLUDED_IDS.has(w.def.id)) return;
    const baseDef = WEAPON_DEFS[w.def.id];
    if (!baseDef) return;
    const papTier = (this.zombiePapTiers.get(w.def.id) ?? 0) as PapTier;
    const composed = composeZombieWeaponDef(baseDef, {
      papTier,
      extMagStacks: this.zombiePerkStacks.get('ext-mag') ?? 0,
      doubleTapStacks: this.zombiePerkStacks.get('double-tap') ?? 0,
      speedColaStacks: this.zombiePerkStacks.get('speed-cola') ?? 0,
      rogue: this.rogueWeaponOpts(),
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

  recomposeAllWeapons(): void {
    for (const w of this.h.weapons) this.recomposeWeapon(w);
  }

  // Pack-a-Punch台/HUDプロンプトが参照する実効コスト(スロット定義のcost=0はダミー)
  zombiePapEffectiveCost(): number {
    const weapon = this.h.activeWeapon;
    if (EXT_MAG_EXCLUDED_IDS.has(weapon.def.id)) return Infinity;
    const curTier = (this.zombiePapTiers.get(weapon.def.id) ?? 0) as PapTier;
    if (curTier >= 3) return this.roguePapCost(PAP_REFILL_COST);
    return this.roguePapCost(PAP_COST[(curTier + 1) as PapTier]);
  }

  // ショッププロンプト用: pack-a-punchのみ動的コストへ差し替え、他は素通し
  zombieSlotEffectiveCost(slot: ShopSlot): number {
    return slot.kind === 'pack-a-punch' ? this.zombiePapEffectiveCost() : slot.cost;
  }

  // ── 特殊ゾンビ変種: 死亡演出 ─────────────────────────────────────────────────
  aliveMiasmaCount(): number {
    let n = 0;
    for (const b of this.h.bots) if (b.kind === 'zombie' && b.alive && b.zombieVariant === 'miasma') n += 1;
    return n;
  }

  zombieVariantBlastExplode(pos: THREE.Vector3): void {
    // ★V-A修正(TODO消化): B-FX2の専用FX(小型爆発+緑破片、既存プール流用)へ置換
    this.h.effects.variantBlastFx(pos.x, pos.y, pos.z);
    this.h.sounds.variantBlastExplode();
    if (this.h.player.alive) {
      const d = this.h.player.position.distanceTo(pos);
      if (d < BLAST_RADIUS_M) {
        const falloff = 1 - d / BLAST_RADIUS_M;
        const dmg = this.rogueDamageIn(Math.round(BLAST_DMG * Math.max(0.3, falloff)));
        const died = this.h.player.takeDamage(dmg);
        this.h.setTookDamage(true);
        this.h.addShake(0.3);
        this.h.incoming.push(this.h.incomingAngle(pos));
        this.h.sounds.hurt();
        this.h.tracker.onPlayerDamaged();
        if (died) {
          this.h.feed.push({ killer: '自爆ゾンビ', victim: PLAYER_NAME, weapon: '自爆ゾンビ', headshot: false });
          this.h.sounds.death();
          this.h.notePlayerDeath(null);
        }
      }
    }
    // 周囲ゾンビも巻き込む(BO2らしい連鎖爆発。既存の範囲ダメージ処理と同じくapplyBotDamage経由で
    // 経済/メダル/他variantの連鎖演出を一貫させる。HK/Lightning Strike等と同一の既存パターン)
    for (const other of this.h.bots) {
      if (other.kind !== 'zombie' || !other.alive) continue;
      const d = other.position.distanceTo(pos);
      if (d >= BLAST_RADIUS_M) continue;
      this.h.applyBotDamage(other, BLAST_DMG, other.position.clone(), false, '自爆ゾンビ', false);
    }
  }

  zombieVariantMiasmaBurst(pos: THREE.Vector3): void {
    this.h.sounds.variantMiasmaBurst();
    if (this.zombieMiasmaClouds.length >= 4) return; // 同時上限(task仕様)
    // ★V-A修正(TODO消化): 視覚はB-FX2のプール実装(effects.miasmaCloud、多層スプライト+粒子、
    // 上限4は effects側でも保証)へ委譲。matchはDPS判定用の位置/残時間エンティティのみ保持
    this.h.effects.miasmaCloud(pos.x, pos.y, pos.z, this.h.settings.reduceMotion);
    this.zombieMiasmaClouds.push({ pos: pos.clone(), remainS: MIASMA_DURATION_S, tickIn: 0 });
  }

  updateMiasmaClouds(dt: number): void {
    this.zombiePoison01 = Math.max(0, this.zombiePoison01 - dt / 1.2);
    for (let i = this.zombieMiasmaClouds.length - 1; i >= 0; i -= 1) {
      const cloud = this.zombieMiasmaClouds[i]!;
      cloud.remainS -= dt;
      if (cloud.remainS <= 0) {
        // 視覚はeffects側プールが同じ寿命(6s)で自然消滅する — match側はエンティティ除去のみ
        this.zombieMiasmaClouds.splice(i, 1);
        continue;
      }
      const inside = this.h.player.alive && this.h.player.position.distanceTo(cloud.pos) < MIASMA_RADIUS_M;
      if (inside) this.zombiePoison01 = 1;
      cloud.tickIn -= dt;
      if (cloud.tickIn <= 0) {
        cloud.tickIn = MIASMA_TICK_S;
        // このメソッドはmode==='zombie'時のみ呼ばれる(update()側のガード)ためtraining除外は不要
        if (inside) {
          const tickDamage = this.rogueDamageIn(MIASMA_DPS * MIASMA_TICK_S);
          const died = this.h.player.takeDamage(tickDamage);
          this.h.setTookDamage(true);
          this.h.addShake(0.04);
          this.h.incoming.push(this.h.incomingAngle(cloud.pos));
          this.h.sounds.hurt();
          this.h.tracker.onPlayerDamaged();
          if (died) {
            this.h.feed.push({ killer: '毒霧', victim: PLAYER_NAME, weapon: '毒霧', headshot: false });
            this.h.sounds.death();
            this.h.notePlayerDeath(null);
          }
        }
      }
    }
  }

  // ── パワーアップ: ドロップ管理+収集効果(ドロップ視覚/色はeffects.powerUpBeacon側) ──

  spawnZombiePowerUp(kind: PowerUpKind, pos: THREE.Vector3): void {
    // ★V-A修正(TODO消化): B-FX2のビーコン(八面体+リング、kind別共有マテリアル)を使用。
    // scene.add/位置更新/despawnはmatch側管理(呼び出し側管理型の契約)
    const mesh = this.h.effects.powerUpBeacon(kind, this.h.settings.reduceMotion);
    mesh.position.copy(pos);
    mesh.position.y += 0.4;
    this.h.scene.add(mesh);
    this.zombiePowerUpDrops.push({ kind, pos: mesh.position.clone(), remainS: POWERUP_DESPAWN_S, mesh });
  }

  updateZombiePowerUps(dt: number): void {
    if (this.zombieInstaKillTimer > 0) {
      this.zombieInstaKillTimer = Math.max(0, this.zombieInstaKillTimer - dt);
      if (this.zombieInstaKillTimer === 0) {
        this.h.sounds.powerUpExpire();
        this.h.announcements.push('インスタキル終了');
      }
    }
    if (this.zombieDoublePointsTimer > 0) {
      this.zombieDoublePointsTimer = Math.max(0, this.zombieDoublePointsTimer - dt);
      if (this.zombieDoublePointsTimer === 0) {
        this.h.sounds.powerUpExpire();
        this.h.announcements.push('2倍ポイント終了');
      }
    }
    for (let i = this.zombiePowerUpDrops.length - 1; i >= 0; i -= 1) {
      const drop = this.zombiePowerUpDrops[i]!;
      // ビーコンの回転/浮遊パラメタはeffects側がuserDataで供給(reduceMotion時 bob=0)
      const spin = (drop.mesh.userData.spinSpeed as number | undefined) ?? 2.2;
      const bob = (drop.mesh.userData.bobAmplitude as number | undefined) ?? 0.08;
      drop.mesh.rotation.y += dt * spin;
      drop.mesh.position.y = drop.pos.y + Math.sin(this.h.elapsed * 2 + i) * bob;
      drop.remainS -= dt;
      let picked = false;
      if (this.h.player.alive && this.h.player.position.distanceTo(drop.pos) < 1.6) {
        picked = true;
        this.zombieCollectPowerUp(drop.kind);
      }
      if (picked || drop.remainS <= 0) {
        this.h.scene.remove(drop.mesh);
        this.h.effects.disposePowerUpBeacon(drop.mesh); // parentから外すのみ(共有マテリアル保護)
        this.zombiePowerUpDrops.splice(i, 1);
      }
    }
  }

  zombieNukeSuppressPoints = false;

  zombieNuke(): void {
    // ★V-A修正: キルループ中は per-kill ポイントを抑制(定額のみ。BO2準拠)
    this.zombieNukeSuppressPoints = true;
    try {
      for (const bot of this.h.bots) {
        if (bot.kind !== 'zombie' || !bot.alive || bot.tier === 'boss') continue;
        this.h.applyBotDamage(bot, bot.hp + 1, bot.position.clone(), false, 'ヌーク', false);
      }
    } finally {
      this.zombieNukeSuppressPoints = false;
    }
    this.addZombiePoints(NUKE_BONUS_PT);
  }

  zombieCollectPowerUp(kind: PowerUpKind): void {
    this.h.sounds.powerUpPickup(kind);
    switch (kind) {
      case 'insta':
        this.zombieInstaKillTimer = POWERUP_DURATION_S;
        this.h.announcements.push('インスタキル！');
        break;
      case 'double':
        this.zombieDoublePointsTimer = POWERUP_DURATION_S;
        this.h.announcements.push('2倍ポイント！');
        break;
      case 'nuke':
        this.zombieNuke();
        this.h.announcements.push('ヌーク！');
        break;
      case 'maxammo':
        for (const w of this.h.weapons) w.resupply();
        this.h.refillGrenades();
        this.h.announcements.push('弾薬満タン！');
        break;
      case 'carpenter':
        // R53-W2: R31破壊カバーの復元(handle再生成+destroyedPropHandlesからの除去+
        // breakableProps再登録)は本タスクのスコープ外と判断(専用の永続レジストリが
        // 別途必要で影響範囲が大きい)。ボーナスポイントのみ付与する(判断は報告済み)。
        this.addZombiePoints(CARPENTER_BONUS_PT);
        this.h.announcements.push('カーペンター(修復対象なし、ボーナスのみ)');
        break;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  zombieActivePowerUpsSnap(): Array<{ kind: PowerUpKind; remainS: number }> {
    const out: Array<{ kind: PowerUpKind; remainS: number }> = [];
    if (this.zombieInstaKillTimer > 0) out.push({ kind: 'insta', remainS: this.zombieInstaKillTimer });
    if (this.zombieDoublePointsTimer > 0) out.push({ kind: 'double', remainS: this.zombieDoublePointsTimer });
    return out;
  }

  // ── お守り(charm): 死亡edgeでの自動復活を quick-revive と共有ロジックで処理 ──
  zombieRevivePlayerInPlace(message: string): void {
    const revivePos = this.h.player.position.clone();
    revivePos.y -= PLAYER_FEET_OFFSET;
    this.h.player.respawnAt(revivePos);
    this.h.player.hp = Math.max(1, Math.floor(this.h.player.maxHp * 0.5));
    this.zombieMeleeIframe = this.h.elapsed + 2;
    for (const weapon of this.h.weapons) weapon.resupply();
    this.h.activeWeapon.raise();
    this.h.setShakeTrauma(0);
    this.h.setDeathPos(null);
    this.h.setKiller(null);
    this.h.setKillcamTimer(0);
    this.h.setDeathVeil(0);
    this.zombieReviveFlash = 1;
    this.h.announcements.push(message);
    this.h.sounds.announceMedal(1, this.h.settings.announcerVolume);
  }

  // 視線の途中にスモークがあれば互いに見えない

  setupZombie(): void {
    const tier = resolveGraphicsTier(
      this.h.settings.graphicsQuality,
      this.h.renderer.capabilities.isWebGL2,
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
    this.zombieCharmEffect = this.h.config.charm ? getCharmEffect(this.h.config.charm) : null;
    if (this.zombieCharmEffect?.bonusStartPoints) {
      this.addZombiePoints(this.zombieCharmEffect.bonusStartPoints);
    }
    this.zombieCharmReviveAvailable = (this.zombieCharmEffect?.autoReviveCharges ?? 0) > 0;
    // perkcarry: 引き継ぎパークを1種、購入と同じ経路(applyZombiePerk)で無償付与する
    if (this.h.config.carriedPerk) {
      this.zombiePerkStacks.set(this.h.config.carriedPerk, 1);
      this.applyZombiePerk(this.h.config.carriedPerk, 1);
    }

    // R54-F5 輪廻: 恒久メタ(localStorage v1)を読み、境地の開始特典を適用。
    // charm/carriedPerk/hell/allGiant/startRound は main.ts が転記段階で落とす(純度優先)
    if (this.rogueActive) {
      try {
        if (typeof localStorage !== 'undefined') {
          this.rogueMetaTier = rogueTierFor(readRogueMeta(localStorage).totalRounds);
        }
      } catch {
        this.rogueMetaTier = 0;
      }
      if (this.rogueMetaTier >= 1) this.addZombiePoints(500); // T1: 開始+500pt
      if (this.rogueMetaTier >= 2) this.zombieQuickReviveCharges += 1; // T2: 自己復活1
      if (this.rogueMetaTier >= 4) {
        // T4: 開始武器がPaP1(クナイ等の除外武器はスキップ)
        const pid = this.h.weapons[0].def.id;
        if (!EXT_MAG_EXCLUDED_IDS.has(pid)) {
          this.zombiePapTiers.set(pid, 1);
          this.recomposeAllWeapons();
        }
      }
      this.h.announcements.push(
        this.rogueMetaTier > 0 ? `輪廻 — 境地${this.rogueMetaTier}の加護` : '輪廻 — 供物を集め、深淵を目指せ',
      );
    }
  }

  aliveZombieCount(): number {
    let n = 0;
    for (const b of this.h.bots) if (b.kind === 'zombie' && b.alive) n += 1;
    return n;
  }

  // R54 音響2: プレイヤー視点基準のpan/distance(match.ts panAndDistanceと同じ規約)。
  // カメラ実体を持たないためyawのみから水平右方向を導く(zombieVocalは定位のみ=ピッチ非依存で十分)
  private zombiePanAndDist(source: THREE.Vector3): { pan: number; distance: number } {
    const eye = this.h.player.eyePosition;
    const dx = source.x - eye.x;
    const dz = source.z - eye.z;
    const distance = Math.hypot(dx, dz, source.y - eye.y);
    const flat = Math.hypot(dx, dz) || 1;
    const rightX = Math.cos(this.h.player.yaw);
    const rightZ = -Math.sin(this.h.player.yaw);
    const pan = THREE.MathUtils.clamp((dx / flat) * rightX + (dz / flat) * rightZ, -1, 1);
    return { pan, distance };
  }

  startZombieRound(r: number): void {
    this.zombieRound = r;
    this.zombieQueue = zombieTotal(r); // 一斉湧き: 次フレームから即バッチ充填開始
    this.zombiePowerUpRoundCount = 0; // R53-W2: ラウンドごとのドロップ上限リセット
    this.zombieSpecialRound = specialRoundKind(r); // R53-W2: rush判定(ボスラウンドとは排他。zombie.ts契約)
    this.h.announcements.push(`ラウンド ${r}`);
    this.h.tracker.onZombieRoundStart(); // R45a
    // R53-W3 M3: MK.IIIモーメント(ラウンド遷移=BO2の象徴的瞬間)
    this.h.moments.push({ kind: 'round', title: String(r), sub: 'ROUND' });
    if (this.zombieSpecialRound === 'rush') {
      this.h.announcements.push('餓鬼の大群、来襲'); // W4C I-1: バナー/モーメントと呼称統一
      this.h.sounds.specialRoundStart();
      this.h.moments.push({ kind: 'special', title: '餓鬼の大群', tone: 'ember' });
    }
    if (isBossRound(r)) {
      this.spawnBossZombie(r);
      this.h.announcements.push('BOSS ROUND');
      this.h.announcements.push('巨躯来襲');
      this.h.addShake(0.4);
      this.h.sounds.heartbeat(); // R45a: 咆哮代替SE
      this.h.addShake(1.5);
      this.h.sounds.hurt();
      this.zombieBossFlash = 1.0;
    }
  }

  spawnBossZombie(r: number): void {
    const spawn = this.zombieSpawnPoint();
    if (!spawn) return;
    const hp = zombieBossHp(r);
    const dmg = zombieBossDamage(r);
    const speedMul = zombieBossSpeedMul(r);
    const base = tuningFor('normal', this.h.config.difficulty);
    const tuning: BotTuning = {
      ...base,
      maxHp: hp,
      moveSpeedMul: ZOMBIE_MOVE_MUL * speedMul,
    };
    const bot = this.h.spawnBot('巨躯', spawn, 0x3a1a0d, ENEMY_TEAM, tuning, 'boss', 'zombie');
    // R51バグ根治: spawnBot 内で hellMode 補正済みの damage を、この直後の代入が生値 dmg で
    // 無条件上書きしていた(hellMode でもボスの攻撃力×2.5が一切効かない状態だった)
    bot.tuning.damage = this.h.config.hellMode ? Math.round(dmg * 2.5) : dmg;
    bot.zombieRunMul = speedMul;
    this.zombieBossBot = bot;
    // R54 音響2: 出現ボイス(距離カリング/スロットルはSoundKit側で内蔵)
    const sp = this.zombiePanAndDist(spawn);
    this.h.sounds.zombieVocal('spawn', sp.pan, sp.distance, bot.uid % 3);
  }

  // 毎フレーム(handleRespawns後): 死体解放→影LOD→ラウンド進行(ドリップ湧き/クリア判定)
  updateZombieDirector(dt: number): void {
    // 死体解放を最初に(Rapier handle再利用でnewゾンビが無敵化するのを防ぐ)
    this.cleanupDeadZombies();
    // ボス出現フラッシュ減衰
    if (this.zombieBossFlash > 0) {
      this.zombieBossFlash = Math.max(0, this.zombieBossFlash - dt * 3.0);
    }
    // (影LODは★1で全モード共通化し update() 側で駆動。ここでの個別運用は廃止)
    if (this.h.over) return;

    // R54 音響2: BGM排他ステム(狂乱/特殊ラウンド)。ラウンド開始前(0)は通常BGMへ委ねる
    this.h.sounds.setBgmStem(
      this.zombieRound > 0 ? 'zombie-madness' : null,
      this.zombieSpecialRound === 'rush' ? 1 : Math.min(1, 0.4 + this.zombieRound / 25),
    );
    // R54 音響2: 群密度ベッド(生存数/上限・平均距離)を0.5s間隔で供給
    this.hordeDensityTimer -= dt;
    if (this.hordeDensityTimer <= 0) {
      this.hordeDensityTimer = 0.5;
      let sum = 0;
      let n = 0;
      for (const b of this.h.bots) {
        if (b.kind !== 'zombie' || !b.alive) continue;
        n += 1;
        sum += b.position.distanceTo(this.h.player.position);
      }
      this.h.sounds.setHordeDensity(Math.min(1, n / 36), n > 0 ? sum / n : 0);
    }

    // R54-F5 輪廻: 供物選択中はラウンド進行を完全凍結(台座の演出/タイマーのみ進む)
    if (this.roguePickPending) {
      this.updateRoguePick(dt);
      return;
    }

    if (this.zombieRoundCooldown > 0) {
      this.zombieRoundCooldown -= dt;
      if (this.zombieRoundCooldown <= 0) this.startZombieRound(this.zombieRound + 1);
      return;
    }
    if (this.zombieRound === 0) {
      // R27: 任意ラウンド開始。開始ラウンド>1 の場合は装備差を補う開始ポイントを付与
      const startRound = Math.max(1, Math.min(999, this.h.config.zombieStartRound ?? 1));
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
      const aliveZombiePos = this.h.bots
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
        this.h.tracker.onZombieRoundEnd(roundEndOut);
        this.h.emitMedals(roundEndOut);
        // R53-W2: 特殊ラウンド(rush)クリア報酬 — 遷移初フレームのみ1回発火
        if (this.zombieSpecialRound === 'rush') {
          this.addZombiePoints(RUSH_CLEAR_BONUS_PT);
          for (const w of this.h.weapons) w.resupply();
          this.h.sounds.specialRoundClear();
          this.h.announcements.push('大群を殲滅！');
        }
        // R54-F5 輪廻: 報酬処理の後に供物の台座を出し、選択が済むまで次ラウンドを凍結
        // (クールダウンは resolveRoguePick が設定する)。R1開始前(zombieRound=0)は対象外
        if (this.rogueActive && this.zombieRound > 0) {
          this.spawnRoguePedestals();
          return;
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
  spawnOneZombie(aliveZombiePos: THREE.Vector3[]): boolean {
    const spawn = this.zombieSpawnPoint(aliveZombiePos);
    if (!spawn) return false; // 有効な湧き点が無ければ次フレーム再試行(queueは減らさない)
    const r = this.zombieRound;
    const isRush = this.zombieSpecialRound === 'rush';
    const elite = this.h.rand() < zombieEliteRate(r);
    // R53-W2: rushラウンドは全個体が走者になる(zombieRunRateの抽選をバイパス)
    const run = isRush ? true : this.h.rand() < zombieRunRate(r);
    const giant = this.h.config.allGiantMode ?? false;
    const base = tuningFor('normal', this.h.config.difficulty);
    const tuning: BotTuning = {
      ...base,
      maxHp: zombieHp(r) * (elite ? 1.6 : 1) * (giant ? 1.5 : 1) * (isRush ? RUSH_HP_MUL : 1),
      moveSpeedMul: ZOMBIE_MOVE_MUL * (elite ? 1.15 : 1),
      scale: giant ? 1.35 : 1,
    };
    const color = elite ? 0x6d7d3a : this.zombieSpawnColor;
    const name = BOT_NAMES[Math.floor(this.h.rand() * BOT_NAMES.length)] ?? 'ゾンビ';
    // R53-W2: 特殊ゾンビ変種(spawnOneZombieの新規/プール再利用の両経路に適用)
    const variant = rollZombieVariant(r, () => this.h.rand(), this.aliveMiasmaCount());
    // R54 音響2: 出現ボイス(新規/プール再利用の両経路共通。個体uidで3声を分散。距離カリング/スロットルは内蔵)
    const spawnVoice = this.zombiePanAndDist(spawn);

    // ★ メッシュプール: 通常tier(=elite でない)かつプールに再利用可能インスタンスがあれば流用
    if (!elite && this.zombiePool.length > 0) {
      const bot = this.zombiePool.pop()!;
      // R51バグ根治: プール再利用は spawnBot の合成漏斗(KIND_TUNING+hellMode)を経由しないため、
      // 従来はプール個体に KIND_TUNING.zombie.damage(22) も hellMode 倍率も一切効いていなかった
      // (常に難度基礎damage=11のまま)。ここで spawnBot と同じ合成を明示的に再現する。
      const merged: BotTuning = { ...tuning, ...KIND_TUNING.zombie };
      const poolTuning = this.h.config.hellMode ? applyHellTuning(merged) : merged;
      bot.resetForZombieReuse(poolTuning, spawn);
      bot.zombieRunMul = run ? 1.6 : 1;
      if (variant) bot.applyZombieVariantVisual(variant);
      this.assignCrowdSlot(bot); // R53-W3 M3: variant決定後にInstancedMeshスロット割当(協定)
      // tags 再登録(cleanupDeadZombies で削除済み → 新しいcollider handleで再登録)
      this.h.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
      this.h.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
      this.h.scene.add(bot.group);
      this.h.bots.push(bot);
      this.h.sounds.zombieVocal('spawn', spawnVoice.pan, spawnVoice.distance, bot.uid % 3);
      return true;
    }

    const bot = this.h.spawnBot(name, spawn, color, ENEMY_TEAM, tuning, 'normal', 'zombie');
    bot.zombieRunMul = run ? 1.6 : 1; // 走行個体はローカル倍率で加速(moveSpeedはreadonly)
    if (variant) bot.applyZombieVariantVisual(variant);
    this.assignCrowdSlot(bot); // R53-W3 M3: 新規生成経路も同じ協定で割当
    this.h.sounds.zombieVocal('spawn', spawnVoice.pan, spawnVoice.distance, bot.uid % 3);
    return true;
  }

  // R53-W3 M3: ゾンビ群InstancedMeshのスロット割当(zombie-crowd.ts冒頭ドキュメントの協定)。
  // eligible = kill-switch ON かつ 非boss かつ variant無し。最近接8体(hordeRank<8)は
  // 高忠実度(実articulated影+個体マテリアル)のため除外 — spawn直後はhordeRank=99なので
  // 遠方湧きは即instanced、0.25s後のランク更新で近接だけObject3Dへ戻る
  assignCrowdSlot(bot: Bot): void {
    if (!this.zombieCrowd) return;
    const eligible = isCrowdEligible(bot.tier, bot.zombieVariant, bot.hordeRank);
    bot.setCrowdSlot(eligible ? this.zombieCrowd.acquire() : -1);
  }

  // 地面Yを下向きレイで確定し、フラスタム外の湧き点を返す(目前でのポップインを避ける)。
  // R21修正: 生存中ゾンビとの最小間隔(1.2m)も確保し、リング湧きでの重なりスタックを防ぐ。
  // R51-4c: aliveZombiePos省略時(ボス湧き等の非バッチ経路)は従来どおり内部で1回構築する。
  // バッチ経路(spawnOneZombie)は呼び出し元が共有配列を渡し、採用したスポーン点をここでpushして
  // 同一バッチ内の以降の試行からも重なり回避対象として見えるようにする(挙動維持)
  zombieSpawnPoint(aliveZombiePos?: THREE.Vector3[]): THREE.Vector3 | null {
    const size = this.h.config.stage.size;
    const bound = size / 2 - 2;
    const around = this.h.player.alive ? this.h.player.position : new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    // 生存中ゾンビの現在位置(近接スポーンで重なるのを防ぐ)
    const positions =
      aliveZombiePos ??
      this.h.bots.filter((b) => b.kind === 'zombie' && b.alive).map((b) => b.position);
    const MIN_ZOMBIE_GAP = 1.2;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ang = this.h.rand() * Math.PI * 2;
      const rad =
        ZOMBIE_SPAWN_RING_MIN + this.h.rand() * (ZOMBIE_SPAWN_RING_MAX - ZOMBIE_SPAWN_RING_MIN);
      const x = THREE.MathUtils.clamp(around.x + Math.cos(ang) * rad, -bound, bound);
      const z = THREE.MathUtils.clamp(around.z + Math.sin(ang) * rad, -bound, bound);
      const hit = this.h.castRay(new THREE.Vector3(x, 8, z), down, 20, null);
      const groundY = hit ? 8 - hitToi(hit) : 0;
      // A1-F05: キャットウォーク/建物1Fヒットで上層(y>0.6)に湧くのを防ぐ
      if (groundY > 0.6) continue;
      const p = new THREE.Vector3(x, groundY + 0.05, z);
      if (attempt < 10) {
        // フラスタム内(=プレイヤーの目前)はポップインになるので避ける
        if (this.h.isInView(p)) continue;
        // 直近スポーンゾンビとの重なりを避ける(最終2試行は妥協)
        if (positions.some((zp) => zp.distanceTo(p) < MIN_ZOMBIE_GAP)) continue;
      }
      positions.push(p); // 同一バッチ内の後続呼び出しへ即反映(呼び出し元が共有配列を渡した場合)
      return p;
    }
    return null;
  }

  zombieMelee(bot: Bot): void {
    if (bot.kind !== 'zombie' && bot.kind !== 'giant' && bot.kind !== 'master') return;
    if (!this.h.player.alive) return;
    const now = this.h.elapsed;
    if (now < this.zombieMeleeIframe || now < this.zombieMeleeGlobal) return;
    // (b) 垂直差チェック: プレイヤーが1.5m以上高い/低い位置にいたら届かない
    if (Math.abs(this.h.player.position.y - bot.position.y) > 1.5) return;
    // (c) LOS チェック: ゾンビ目線からプレイヤーへのレイが world/プロップに遮られていたら届かない
    const zombieEye = bot.position.clone();
    zombieEye.y += 1.5;
    const toPlayer = this.h.player.position.clone().sub(zombieEye);
    const meleeDist = toPlayer.length();
    if (meleeDist > 0.3) {
      const losHit = this.h.castRay(zombieEye, toPlayer.clone().normalize(), meleeDist - 0.3, bot.body);
      if (losHit) {
        const tag = this.h.tags.get(losHit.collider.handle);
        // undefined(タグなし)= 静的コライダー、world/boundary = 地形/プロップ → LOS遮断
        if (tag === undefined || tag.kind === 'world' || tag.kind === 'boundary') return;
      }
    }
    const dmg = this.rogueDamageIn(bot.tuning.damage);
    if (this.h.config.mode === 'training') return;
    const died = this.h.player.takeDamage(dmg);
    this.h.setTookDamage(true);
    this.h.haptic(90, 0.5, 0.6);
    this.h.addShake(0.18);
    this.h.addUltCharge(dmg * ULT_ON_DAMAGE_PER_HP);
    this.h.incoming.push(this.h.incomingAngle(bot.position));
    this.h.sounds.hurt();
    this.h.tracker.onPlayerDamaged();
    this.h.sounds.playerBodyHit(Math.sin(this.h.incomingAngle(bot.position)), Math.min(1, dmg / 100));
    this.zombieMeleeGlobal = now + ZOMBIE_MELEE_GLOBAL_GAP;
    this.zombieMeleeIframe = now + ZOMBIE_IFRAME;
    if (died) {
      const meleeWeapon = bot.kind === 'giant' ? '巨躯の一撃' : bot.kind === 'master' ? '達人の刃' : 'ゾンビの爪';
      this.h.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: meleeWeapon, headshot: false });
      this.h.sounds.death();
      this.h.notePlayerDeath(bot);
    }
  }

  // 死んで演出も終わったゾンビを解放する。厳密順序: tags削除 → dispose/pool → scene除去 → splice。
  // tagsを先に消さないと解放済みhandleの再利用で旧タグが新ゾンビのcolliderを旧Botへ解決する。
  // ★ 通常tier(normal)ゾンビはプールへ退避してbuildZombieMeshの再実行を避ける。
  // elite/bossは色が異なるため dispose して毎回生成する(出現頻度が低いので許容)。
  cleanupDeadZombies(): void {
    for (let i = this.h.bots.length - 1; i >= 0; i -= 1) {
      const b = this.h.bots[i]!;
      if (b.kind !== 'zombie' || !b.corpseCleared) continue;
      this.h.tags.delete(b.bodyCollider.handle);
      this.h.tags.delete(b.headCollider.handle);
      for (const c of b.extraColliders) this.h.tags.delete(c.handle);
      // R54-F5 輪廻「幸運」: 加算分(基本2.5%×powerUpAdd)を死体解放時に補充抽選する
      // (キル時の基本抽選は match.ts 側=不可侵のため、こちらで独立に補う。ラウンド上限は共有)
      if (this.rogueActive && this.rogueMods.powerUpAdd > 0 && this.zombiePowerUpRoundCount < POWERUP_ROUND_CAP) {
        const luckKind = rollPowerUpAt(Math.random, POWERUP_DROP_CHANCE * this.rogueMods.powerUpAdd);
        if (luckKind) {
          this.zombiePowerUpRoundCount += 1;
          this.spawnZombiePowerUp(luckKind, b.position.clone());
        }
      }
      // R53-W3 M3: InstancedMeshスロットを先に返却(協定: release→setCrowdSlot(-1)の順)
      if (b.crowdSlot >= 0 && this.zombieCrowd) {
        this.zombieCrowd.release(b.crowdSlot);
        b.setCrowdSlot(-1);
      }
      // 通常tierかつプール未満ならプールへ退避(再利用でbuildZombieMesh削減)
      if (b.tier === 'normal' && this.zombiePool.length < ZOMBIE_POOL_MAX) {
        this.h.scene.remove(b.group);
        this.zombiePool.push(b);
      } else {
        b.dispose();
        this.h.scene.remove(b.group);
      }
      this.h.bots.splice(i, 1);
    }
    // ボスbot参照が解放済みなら null へ
    if (this.zombieBossBot && !this.h.bots.includes(this.zombieBossBot)) {
      this.zombieBossBot = null;
    }
  }

  // ★1 近接≤8体のみ影を落とす距離LOD(多数の影パス/mapSize churnを抑える)。
  // ゾンビ専用だった運用を全モード/全kindへ一般化(全巨躯54体で影DC162→24)。
  // aliveのみ再判定し、死亡演出中の個体は直近フラグを維持する(従来と同じ)
  updateZombieHordeRank(): void {
    const playerPos = this.h.player.position;
    const zAlive: Bot[] = [];
    const d2: number[] = [];
    for (const b of this.h.bots) {
      if (b.kind !== 'zombie' || !b.alive) {
        b.hordeRank = 99;
        continue;
      }
      zAlive.push(b);
      d2.push(b.getPositionInto(BOT_POS_SCRATCH).distanceToSquared(playerPos)); // ★5 割り当てゼロ
    }
    const ranks = zombieHordeRanks(d2);
    // R54 音響2: 接近ボイス(2.5m以内)。距離二乗はhordeRank算出用に既に持っているので閾値比較のみ追加
    const CLOSE_D2 = 2.5 * 2.5;
    for (let i = 0; i < zAlive.length; i += 1) {
      const b = zAlive[i]!;
      b.hordeRank = ranks[i]!;
      if (d2[i]! < CLOSE_D2) {
        const cv = this.zombiePanAndDist(b.position);
        this.h.sounds.zombieVocal('close', cv.pan, cv.distance, b.uid % 3);
      }
    }
    // R54-B1: 群衆分離グリッドの再構築(0.25s周期=この関数の呼び出し周期)。
    // rank>=24の後方群はKCCから対ゾンビ衝突を除外(bot.ts filterPredicate)しており、
    // 重なり防止はこのグリッドのseparation(bot.ts updateZombie)が担う
    zombieSeparationGrid.rebuild(
      zAlive.map((b) => ({ uid: b.uid, x: b.position.x, z: b.position.z })),
    );
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
  feedZombieCrowd(): void {
    if (!this.zombieCrowd) return;
    for (const b of this.h.bots) {
      if (b.crowdSlot < 0) continue;
      b.getCrowdPose(CROWD_POSE_SCRATCH);
      this.zombieCrowd.pose(b.crowdSlot, CROWD_POSE_SCRATCH);
    }
    this.zombieCrowd.commit();
  }

  // ミッション開始時の準備: 濃霧・脱出地点・第1波

  buildZombieShop(): void {
    const layout = generateShopLayout(this.h.config.stage.seed);
    this.zombieShopLayout = layout;
    const total = layout.slots.length;
    const size = this.h.config.stage.size;

    // ミステリーボックス移動先候補を5点生成(種ベース+オフセット)
    this.zombieBoxPositions = [];
    const boxAngles = [0.1, 1.3, 2.5, 3.8, 5.1];
    for (const a of boxAngles) {
      this.zombieBoxPositions.push(
        this.findShopGroundPos(a + this.h.config.stage.seed * 0.01, size * 0.15),
      );
    }

    this.zombieBoxGroupIdx = -1;
    for (const slot of layout.slots) {
      const baseAngle = (slot.slotIndex / total) * Math.PI * 2 + this.h.config.stage.seed * 0.01;
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
      this.h.scene.add(group);
      this.zombieShopGroups.push(group);
      if (slot.kind === 'mystery-box') this.zombieBoxGroupIdx = this.zombieShopGroups.length - 1;
      if (slot.kind === 'door') {
        // R53-W2: ドアのバリケードコライダー(world扱い=移動を阻む。弾/視線はcastRay側のタグ判定で
        // 個別に扱われるため通常のworldプロップと同じ挙動=弾は当たる。購入で除去する)
        const body = this.h.physics.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(group.position.x, group.position.y + 1.0, group.position.z),
        );
        const collider = this.h.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 1.05, 0.15), body);
        this.h.tags.set(collider.handle, { kind: 'world' });
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

  findShopGroundPos(baseAngle: number, radius: number): THREE.Vector3 {
    const offsets = [0, 0.22, -0.22, 0.44, -0.44];
    let best: THREE.Vector3 | null = null;
    for (const off of offsets) {
      const x = Math.cos(baseAngle + off) * radius;
      const z = Math.sin(baseAngle + off) * radius;
      const y = this.h.snapToGround(new THREE.Vector3(x, 20, z));
      if (y <= 0.5) return new THREE.Vector3(x, y, z); // 床レベル=即採用
      if (!best || y < best.y) best = new THREE.Vector3(x, y, z);
    }
    return best ?? new THREE.Vector3(Math.cos(baseAngle) * radius, 0, Math.sin(baseAngle) * radius);
  }

  buildShopVisual(slot: ShopSlot): THREE.Group {
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

  // ══ R54-F5 輪廻(ローグラン) ════════════════════════════════════════════════
  // 強化は rogueMods 単一集約。適用点(漏斗)は: compose(rogue opts)/addZombiePoints/
  // 被弾3点(rogueDamageIn)/zombiePerkMoveMulゲッター/PaPコスト(roguePapCost)/幸運補充抽選。

  get rogueActive(): boolean {
    return this.h.config.rogueRun === true;
  }

  /** match.ts が読む公開移速倍率(パーク実体 × 輪廻の移速加算)。match側は無改修 */
  get zombiePerkMoveMul(): number {
    return this.zombiePerkMoveMulBase * (this.rogueActive ? 1 + this.rogueMods.moveAdd : 1);
  }

  /** compose用の武器系乗数(単一漏斗)。非アクティブ時はundefined=完全無効 */
  rogueWeaponOpts(): { dmgMul: number; magMul: number; reloadMul: number } | undefined {
    if (!this.rogueActive) return undefined;
    return {
      dmgMul: 1 + this.rogueMods.dmgAdd,
      magMul: 1 + this.rogueMods.magAdd,
      reloadMul: Math.max(0.25, 1 - this.rogueMods.reloadAdd),
    };
  }

  /** 鍛冶割引: 下限×0.4、50pt単位へ丸め(表示と請求が同関数=ズレなし) */
  roguePapCost(cost: number): number {
    if (!this.rogueActive || this.rogueMods.papDiscount <= 0) return cost;
    return Math.max(50, Math.round((cost * Math.max(0.4, 1 - this.rogueMods.papDiscount)) / 50) * 50);
  }

  /** 被ダメージ倍率(守りの札/血の契約)。下限×0.4、最低1ダメージ保証 */
  rogueDamageIn(dmg: number): number {
    if (!this.rogueActive) return dmg;
    return Math.max(1, dmg * Math.max(0.4, 1 + this.rogueMods.dmgTakenAdd));
  }

  /** ラウンドクリア時: プレイヤー前方4mに供物の台座を並べ、選択までディレクタを凍結 */
  spawnRoguePedestals(): void {
    this.clearRoguePedestals();
    const offer = rollRogueOfferWithTier(this.h.rand, isBossRound(this.zombieRound), this.rogueMetaTier);
    if (offer.length === 0) {
      this.zombieRoundCooldown = ZOMBIE_ROUND_COOLDOWN;
      return;
    }
    const p = this.h.player;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const half = this.h.config.stage.size / 2 - 4; // 境界壁の内側へクランプ
    const mid = (offer.length - 1) / 2;
    for (let i = 0; i < offer.length; i += 1) {
      const card = offer[i]!;
      const px = THREE.MathUtils.clamp(p.position.x + fx * 4 - fz * (i - mid) * 1.8, -half, half);
      const pz = THREE.MathUtils.clamp(p.position.z + fz * 4 + fx * (i - mid) * 1.8, -half, half);
      const pos = new THREE.Vector3(px, 0, pz);
      pos.y = this.h.snapToGround(pos);
      const geos: THREE.BufferGeometry[] = [];
      const mats: THREE.Material[] = [];
      const group = new THREE.Group();
      // 台座(石柱)+浮遊カード+レア度リング。発光はbloom閾値内(白飛び禁止)
      const color = card.rarity === 'epic' ? 0xb07cff : card.rarity === 'rare' ? 0x19e6ff : 0x9fb8c9;
      const baseGeo = new THREE.BoxGeometry(0.5, 0.9, 0.5);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.85, metalness: 0.1 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.45;
      group.add(base); geos.push(baseGeo); mats.push(baseMat);
      const cardGeo = new THREE.PlaneGeometry(0.55, 0.8);
      const cardMat = new THREE.MeshStandardMaterial({
        color: 0x0a0c10, emissive: new THREE.Color(color), emissiveIntensity: 0.45,
        side: THREE.DoubleSide, transparent: true, opacity: 0.92,
      });
      const card3d = new THREE.Mesh(cardGeo, cardMat);
      card3d.position.y = 1.55;
      group.add(card3d); geos.push(cardGeo); mats.push(cardMat);
      const ringGeo = new THREE.RingGeometry(0.5, 0.62, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      group.add(ring); geos.push(ringGeo); mats.push(ringMat);
      group.position.copy(pos);
      this.h.scene.add(group);
      this.roguePedestals.push({ card, group, card3d, geos, mats });
    }
    this.roguePickPending = true;
    this.roguePickRemain = 30;
    this.h.announcements.push('供物の台座が現れた — Eで選択(30秒で見送り)');
    this.h.sounds.uiClick();
  }

  /** 凍結中の毎フレーム: カード演出+自動スキップタイマー */
  updateRoguePick(dt: number): void {
    if (!this.h.settings.reduceMotion) {
      for (const ped of this.roguePedestals) {
        ped.card3d.rotation.y += dt * 1.4;
        ped.card3d.position.y = 1.55 + Math.sin(this.h.elapsed * 2 + ped.group.position.x) * 0.06;
      }
    }
    this.roguePickRemain -= dt;
    if (this.roguePickRemain <= 0) this.resolveRoguePick(null);
  }

  /** 供物の確定(null=見送り)。カード適用→台座撤去→凍結解除→クールダウン設定 */
  resolveRoguePick(card: RogueCard | null): void {
    if (!this.roguePickPending) return;
    if (card) {
      if (card.instant === 'free-perk') {
        this.grantFreeRoguePerk();
      } else if (card.instant === 'revive') {
        this.zombieQuickReviveCharges += 1;
      } else {
        this.rogueMods = applyCardToMods(this.rogueMods, card.id);
        this.recomposeAllWeapons(); // 武器系は基礎から再計算(複利なし)
      }
      this.rogueCardNames.push(card.name);
      this.h.moments.push({ kind: 'perk', title: card.name, sub: '輪廻の供物' });
      this.h.announcements.push(`供物『${card.name}』 — ${card.desc}`);
      this.h.sounds.uiClick();
    } else {
      this.h.announcements.push('供物を見送った');
    }
    this.clearRoguePedestals();
    this.roguePickPending = false;
    this.roguePickRemain = 0;
    this.zombieRoundCooldown = ZOMBIE_ROUND_COOLDOWN;
  }

  /** 無料パーク: quick-revive以外からランダム1種を即時付与(購入と同じ適用経路) */
  private grantFreeRoguePerk(): void {
    const ids = (Object.keys(PERKS) as ZombiePerkId[]).filter((id) => id !== 'quick-revive');
    const id = ids[Math.min(ids.length - 1, Math.floor(this.h.rand() * ids.length))];
    if (!id) return;
    const count = (this.zombiePerkStacks.get(id) ?? 0) + 1;
    this.zombiePerkStacks.set(id, count);
    this.applyZombiePerk(id, count);
    this.h.announcements.push(`${PERKS[id].name} を無償取得`);
  }

  clearRoguePedestals(): void {
    for (const ped of this.roguePedestals) {
      this.h.scene.remove(ped.group);
      for (const g of ped.geos) g.dispose();
      for (const m of ped.mats) m.dispose();
    }
    this.roguePedestals.length = 0;
  }

  /** 台座選択中の最寄り台座(interact/プロンプト共用。範囲2.6m) */
  private nearestRoguePedestal(): { card: RogueCard; dist: number } | null {
    let best: { card: RogueCard; dist: number } | null = null;
    const ppos = this.h.player.position;
    for (const ped of this.roguePedestals) {
      const dist = ped.group.position.distanceTo(ppos);
      if (dist < 2.6 && (!best || dist < best.dist)) best = { card: ped.card, dist };
    }
    return best;
  }

  /** snapshot供給(match側は `rogue: this.zombie.rogueSnap(),` の1行配線のみ) */
  rogueSnap(): { round: number; cards: string[]; pick?: { options: { id: string; name: string; desc: string; rarity: string }[]; remainS: number } } | undefined {
    if (!this.rogueActive) return undefined;
    return {
      round: this.zombieRound,
      cards: this.rogueCardNames.slice(),
      pick: this.roguePickPending
        ? {
            options: this.roguePedestals.map((ped) => ({
              id: ped.card.id, name: ped.card.name, desc: ped.card.desc, rarity: ped.card.rarity,
            })),
            remainS: this.roguePickRemain,
          }
        : undefined,
    };
  }

  /** MatchResult.rogue供給(match側 `rogue: this.zombie.rogueResult(),` の1行配線) */
  rogueResult(): { round: number; cards: string[] } | undefined {
    if (!this.rogueActive) return undefined;
    return { round: this.zombieRound, cards: this.rogueCardNames.slice() };
  }

  updateZombieShopProximity(): void {
    // R54-F5 輪廻: 供物選択中はショップより台座プロンプトを優先(ショップは一時休止)
    if (this.roguePickPending) {
      if (!this.h.player.alive) {
        this.zombieShopPrompt = null;
        return;
      }
      const near = this.nearestRoguePedestal();
      this.zombieShopPrompt = near
        ? { label: `供物『${near.card.name}』 — ${near.card.desc}`, canAfford: true, cost: 0 }
        : { label: `供物を選べ(残り${Math.ceil(this.roguePickRemain)}秒)`, canAfford: false, cost: 0 };
      return;
    }
    if (!this.zombieShopLayout || !this.h.player.alive) {
      this.zombieShopPrompt = null;
      return;
    }
    const ppos = this.h.player.position;
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

  zombieShopSlotLabel(slot: ShopSlot): string {
    if (slot.kind === 'wall-buy') {
      const wdef = WEAPON_DEFS[slot.weaponId ?? ''];
      const name = wdef?.name ?? slot.weaponId ?? '?';
      return `[E] ${name}  ${slot.cost}pt`;
    }
    if (slot.kind === 'perk-machine') {
      const perkDef = slot.perkId ? PERKS[slot.perkId] : null;
      let label = `[E] ${perkDef?.name ?? slot.perkId ?? '?'}  ${slot.cost}pt`;
      if (slot.perkId === 'stamin-up' && this.zombiePerkMoveMulBase >= 1.5) {
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
      const weapon = this.h.activeWeapon;
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
  papSealDim(sealed: boolean): void {
    if (this.zombiePapCrystalMat) this.zombiePapCrystalMat.emissiveIntensity = sealed ? 0.1 : 0.5;
    if (this.zombiePapRingMat) this.zombiePapRingMat.opacity = sealed ? 0.15 : 0.5;
  }

  handleZombieInteract(): void {
    if (!this.h.input.wasPressed('interact')) return;
    if (!this.h.player.alive) return;
    // R54-F5 輪廻: 供物選択中はEを台座選択に専有(ショップ購入は封止)
    if (this.roguePickPending) {
      const near = this.nearestRoguePedestal();
      if (near) this.resolveRoguePick(near.card);
      return;
    }
    if (!this.zombieShopLayout) return;
    if (this.zombieBoxAnimTimer > 0) return;

    const ppos = this.h.player.position;
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
      this.h.sounds.uiClick();
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
      this.h.announcements.push(PERKS[slot.perkId].name + stackSuffix + ' 取得');
      // R53-W3 M3: MK.IIIモーメント(パーク取得)
      this.h.moments.push({ kind: 'perk', title: PERKS[slot.perkId].name, sub: stackSuffix ? `×${result.stackCount}` : undefined });
      this.h.sounds.uiClick();
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
        this.h.scene.add(this.zombieBoxAnimMesh);
      }
      if (result.boxMoves) {
        // 移動は演出(1.2s)終了時に適用する。フラグを立てないと毎ロールで
        // 「移動した」アナウンスが誤発火する
        this.zombieBoxCurrentIdx = (this.zombieBoxCurrentIdx + 1) % this.zombieBoxPositions.length;
        this.zombieBoxPendingMove = true;
      }
      this.h.sounds.uiClick();
    } else if (slot.kind === 'pack-a-punch') {
      // ★V-A MEDIUM修正: ドア未開放の間は封印(ドアに機能的意味を付与)
      if (papInteractSealed(this.zombieHasDoor, this.zombieDoorOpen)) {
        this.h.sounds.papDeny();
        this.h.announcements.push('鍛神台は封印されている — ゲートを開放せよ');
        return;
      }
      const weapon = this.h.activeWeapon;
      if (EXT_MAG_EXCLUDED_IDS.has(weapon.def.id)) {
        this.h.sounds.papDeny(); // クナイ(近接)は鍛神対象外
        return;
      }
      const curTier = (this.zombiePapTiers.get(weapon.def.id) ?? 0) as PapTier;
      const isMaxed = curTier >= 3;
      const nextTier = (isMaxed ? 3 : curTier + 1) as PapTier;
      const cost = this.roguePapCost(isMaxed ? PAP_REFILL_COST : PAP_COST[nextTier]);
      if (!canBuy(this.zombiePoints, cost)) {
        this.h.sounds.papDeny();
        return;
      }
      this.zombiePoints = buyResult(this.zombiePoints, cost);
      if (!isMaxed) this.zombiePapTiers.set(weapon.def.id, nextTier);
      this.recomposeWeapon(weapon);
      this.h.viewModel.setWeapon(weapon.def);
      this.h.viewModel.playPapUpgradeAnim(this.h.settings.reduceMotion);
      this.h.sounds.papUpgrade();
      // ★V-A修正(TODO消化): 鍛神台の改造演出FX(B-FX2、火花+光条2.5s、既存プール流用)
      {
        const g = this.zombieShopGroups[bestSlotIdx];
        if (g) this.h.effects.papMachineGlow(g.position.x, g.position.y, g.position.z);
      }
      this.h.announcements.push(`${weapon.def.name} を鍛神！`);
      const medalOut: MedalEvent[] = [];
      if (!this.zombiePapAnyDone) {
        this.zombiePapAnyDone = true;
        this.h.tracker.emitManual('pap-first', medalOut);
      }
      if (!isMaxed && nextTier === 3) {
        this.h.tracker.emitManual('pap-max', medalOut);
      }
      this.h.emitMedals(medalOut);
    } else if (slot.kind === 'door') {
      if (this.zombieDoorOpen) return;
      try {
        this.zombiePoints = buyResult(this.zombiePoints, DOOR_COST);
      } catch {
        return;
      }
      this.zombieDoorOpen = true;
      // R31と同じ順序: tags削除 → removeRigidBody → ビジュアル除去
      if (this.zombieDoorCollider) this.h.tags.delete(this.zombieDoorCollider.handle);
      if (this.zombieDoorBody) this.h.physics.removeRigidBody(this.zombieDoorBody);
      this.zombieDoorBody = null;
      this.zombieDoorCollider = null;
      if (this.zombieDoorVisual) {
        this.h.scene.remove(this.zombieDoorVisual.group);
        for (const g of this.zombieDoorVisual.geos) g.dispose();
        for (const m of this.zombieDoorVisual.mats) m.dispose();
        this.zombieDoorVisual = null;
      }
      this.h.announcements.push('ドアを開放した！ — 鍛神台の封印が解けた');
      // ★V-A MEDIUM修正: 鍛神台の封印解除(ビジュアル復帰)
      this.papSealDim(false);
      this.h.sounds.doorUnlock(); // W4D: 1750ptの解錠に相応しい重ラッチ+チャイム
    }
  }

  updateZombieBoxAnim(dt: number): void {
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
        this.h.announcements.push(`${wname} を引き当てた！`);
        this.zombieBoxPendingWeapon = null;
      }
      if (this.zombieBoxAnimMesh) {
        this.h.scene.remove(this.zombieBoxAnimMesh);
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
          this.h.announcements.push('ミステリーボックスが移動した！');
        }
      }
    }
  }

  applyZombiePerk(perkId: ZombiePerkId, stackCount: number): void {
    if (perkId === 'juggernog') {
      if (stackCount === 1) {
        // 初回: ×2.5。現在HPの割合を保持して逆転を防ぐ(300→750)
        const ratio = this.h.player.maxHp > 0 ? this.h.player.hp / this.h.player.maxHp : 1;
        const newMax = Math.round(this.h.player.maxHp * 2.5);
        this.h.player.maxHp = newMax;
        this.h.player.hp = Math.max(1, Math.round(newMax * ratio));
      } else {
        // 2回目以降: +150HP/スタック
        this.h.player.maxHp += 150;
        this.h.player.hp = Math.min(this.h.player.hp + 150, this.h.player.maxHp);
      }
    } else if (perkId === 'stamin-up') {
      // +5%/スタック、上限×1.5。上限でも購入はできる(ポイントシンク)
      this.zombiePerkMoveMulBase = Math.min(1.5, this.zombiePerkMoveMulBase * 1.05);
    } else if (perkId === 'quick-revive') {
      this.zombieQuickReviveCharges += 1;
    } else {
      // R53-W2: speed-cola/double-tap/ext-mag は個別のdef直接変異(旧: 現在値への
      // 複利/加算)を撤去し、composeZombieWeaponDefへ一本化。常にWEAPON_DEFSの基礎値
      // から全武器を再合成する(PaP tierとの組み合わせも自動的に正しく反映される)。
      this.recomposeAllWeapons();
    }
  }

  switchPrimaryWeapon(weaponId: string): void {
    // ★V-A修正: 「今まさに所持している改造済み武器」を壁で再購入した場合は弾補給扱いにして
    // PaP tierを維持する(BO2の壁弾補給準拠 — 改造が消える体験劣化の根治)。
    // 非所持武器への切替(=新品取得)は従来どおりtier0リセット。
    const currentlyHeld = this.h.weapons.some((w) => w.def.id === weaponId);
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
      rogue: this.rogueWeaponOpts(),
    });
    // ★V-A修正: tier維持の再購入では鍛神カモも維持(composeはカモを扱わないため明示設定)
    composed.papCamo = PAP_CAMO_BY_TIER[papTier];
    const newWeapon = new Weapon(composed);
    newWeapon.raise();
    // BO2式: 構えているスロット(activeIndex)を置換し、アクティブスロットは変えない
    (this.h.weapons as Weapon[])[this.h.activeIndex] = newWeapon;
    this.h.viewModel.setWeapon(newWeapon.def);
    this.h.setAdsLatch(false);
  }

}