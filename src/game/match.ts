import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import { mulberry32, type Rand } from '../core/rng';
import type { Settings } from '../core/settings';
import { Effects } from '../render/effects';
import { ViewModel } from '../render/viewmodel';
import { applyAttachments } from './attachments';
import {
  coneOffset,
  damageAtDistance,
  partFromHitHeight,
  partMultiplier,
  penetrationFactor,
  type HitPart,
} from './ballistics';
import { Bot, BOT_NAMES, DIFFICULTY, HIP_OFFSET_Y, type Difficulty } from './bot';
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
import { Weapon, WEAPON_DEFS } from './weapons';

const DEG = Math.PI / 180;
const LOOK_BASE = 0.0022;
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
  hits: Array<'hit' | 'head' | 'kill'>;
  damageNumbers: DamageNumber[];
  incoming: number[]; // 被弾方向(カメラ基準の角度rad)
  tookDamage: boolean;
  scoreboard: ScoreRow[];
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
  private hits: Array<'hit' | 'head' | 'kill'> = [];
  private damageNumbers: DamageNumber[] = [];
  private incoming: number[] = [];
  private tookDamage = false;
  private shakeTrauma = 0; // 0..1 カメラシェイクの蓄積

  constructor(
    readonly config: MatchConfig,
    private readonly settings: Settings,
    private readonly input: Input,
    private readonly sounds: SoundKit,
    aspect: number,
  ) {
    this.timeLeft = config.durationS;
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
    this.player = new Player(this.physics, spawn);
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

    // チーム戦は人数の少ない側にプレイヤーが入る
    const botCount = config.stage.botCount;
    const allyCount = this.modeDef.teamBased ? Math.floor((botCount - 1) / 2) : 0;
    for (let i = 0; i < botCount; i += 1) {
      const name = BOT_NAMES[i % BOT_NAMES.length] ?? `BOT-${i}`;
      const team = this.modeDef.teamBased ? (i < allyCount ? PLAYER_TEAM : ENEMY_TEAM) : i + 1;
      const isAlly = team === PLAYER_TEAM;
      const spawnList = isAlly ? this.playerSpawns : this.botSpawns;
      const botSpawn = spawnList[(i + (isAlly ? 1 : 0)) % spawnList.length] ?? new THREE.Vector3();
      const bot = new Bot(
        this.physics,
        name,
        botSpawn,
        isAlly ? this.colors.ally : this.colors.enemy,
        team,
      );
      this.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
      this.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
      this.scene.add(bot.group);
      this.bots.push(bot);
    }

    this.domination = config.mode === 'dom' ? new DominationState(['A', 'B', 'C']) : null;
    if (this.domination) this.buildZones();

    this.effects = new Effects(this.scene);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.setWeapon(this.activeWeapon.def);
    this.activeWeapon.raise();
  }

  get activeWeapon(): Weapon {
    return this.weapons[this.activeIndex] ?? this.weapons[0]!;
  }

  private buildStageScene(boxes: ReturnType<typeof generateStage>['boxes']): void {
    const palette = this.config.stage.palette;
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.FogExp2(palette.fog, palette.fogDensity);

    const hemi = new THREE.HemisphereLight(palette.sky, palette.floor, palette.ambientIntensity);
    this.scene.add(hemi);
    const size = this.config.stage.size;
    const sun = new THREE.DirectionalLight(palette.lightColor, palette.lightIntensity);
    sun.position.set(size * 0.5, size * 0.7, size * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = size / 2 + 8;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.far = size * 2;
    this.scene.add(sun);

    const floorBody = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const floorCollider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2 + 1, 0.5, size / 2 + 1).setTranslation(0, -0.5, 0),
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
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    for (const spec of boxes) {
      const key = `${spec.color}:${spec.emissive}`;
      let material = materials.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.85 });
        if (spec.emissive) {
          material.emissive = new THREE.Color(spec.color);
          material.emissiveIntensity = 0.9;
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
          // プレイヤー自身が圏内にいた制圧だけを個人成績に数える
          const center = this.zoneCenters.get(zone.id);
          if (
            center &&
            this.player.alive &&
            Math.hypot(this.player.position.x - center.x, this.player.position.z - center.z) <
              ZONE_RADIUS
          ) {
            this.playerCaptures += 1;
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
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
      return;
    }

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.whiteout = Math.max(0, this.whiteout - dt / 3.2);
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
    const moveInput = {
      x: (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0),
      z: (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0),
      jumpPressed: this.input.wasPressed('jump'),
      crouch: this.settings.crouchToggle ? this.crouchLatch : this.input.isDown('crouch'),
      crouchPressed,
      sprint: this.input.isDown('sprint'),
      lean: (this.input.isDown('leanright') ? 1 : 0) - (this.input.isDown('leanleft') ? 1 : 0),
    };
    this.player.update(dt, moveInput, weapon.adsProgress, this.sounds);
    // 移動由来のカメラシェイク(着地・ブースト)
    if (this.player.landImpact > 6) this.addShake(Math.min(0.5, this.player.landImpact * 0.03));
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
      },
    );
    for (const event of events) {
      if (event.type === 'fired') {
        // RecoilStepの規約はyaw正=右。rotation.yは正で左回りなので符号を反転する
        this.player.yaw -= event.recoil.yaw;
        this.player.pitch = Math.min(PITCH_LIMIT, this.player.pitch + event.recoil.pitch);
        this.fireShot(event.spreadRad);
        this.viewModel.fire();
        this.addShake(0.035);
        if (weapon.def.suppressed) this.sounds.shotSuppressed();
        else this.sounds.shot();
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

    this.updateGrenades(dt);
    this.updateFirePatches(dt);
    this.smokeZones = this.smokeZones.filter((zone) => zone.until > this.elapsed);
    this.updateZones(dt);

    if (!this.player.alive && this.killcamTimer > 0) this.killcamTimer -= dt;

    this.updateBots(dt);
    this.physics.step();
    this.syncCamera();
    this.handleRespawns();

    // 先取スコア到達で試合終了
    if (this.scores.winner() !== null) this.over = true;
  }

  // 描画フレームごとの処理。視点操作はフレームレートに追従させる
  frame(dt: number, playing: boolean): void {
    if (playing && !this.over) {
      const weapon = this.activeWeapon;
      const adsSlow = 1 - 0.4 * weapon.adsProgress;
      const k = LOOK_BASE * this.settings.sensitivity * adsSlow;
      // 既定はマウスを上へ動かすと上を向く。invertYで上下を入れ替える
      const pitchDir = this.settings.invertY ? 1 : -1;
      this.player.yaw -= this.input.mouseDX * k;
      this.player.pitch = THREE.MathUtils.clamp(
        this.player.pitch + pitchDir * this.input.mouseDY * k,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
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
    const targetFov =
      (this.settings.fov + speedFov) * (1 - (1 - weapon.def.adsFovScale) * weapon.adsProgress);
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

    // 観戦カメラをゆっくり回し、死亡中は銃を映さない
    this.orbitAngle += dt * 0.5;
    this.viewModel.root.visible = this.player.alive;

    this.viewModel.update(dt, {
      adsProgress: weapon.adsProgress,
      mouseDX: this.lastLookDX,
      mouseDY: this.lastLookDY,
      moveFactor: this.player.moveFactor,
      grounded: this.player.grounded,
      reloadRatio: weapon.reloading ? weapon.reloadRatio : null,
      raiseRatio: Math.max(weapon.raiseRatio, this.cooking ? 0.65 : 0),
      motionScale: this.settings.reduceMotion ? 0.25 : 1,
    });
    this.effects.update(dt);
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
    // トラウマ式カメラシェイク。揺れ軽減設定では無効
    if (this.shakeTrauma > 0 && !this.settings.reduceMotion) {
      const t = this.shakeTrauma * this.shakeTrauma;
      this.camera.rotation.x += (Math.random() * 2 - 1) * t * SHAKE_PITCH;
      this.camera.rotation.y += (Math.random() * 2 - 1) * t * SHAKE_YAW;
      this.camera.rotation.z += (Math.random() * 2 - 1) * t * SHAKE_ROLL;
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
        this.addShake(Math.min(0.7, damage * 0.01));
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
          this.addShake(0.06);
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

  private fireShot(spreadRad: number): void {
    if (!this.player.alive) return;
    this.player.shotsFired += 1;
    const weapon = this.activeWeapon;
    const origin = this.player.eyePosition;
    const muzzle = this.viewModel.muzzleWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const pelletSpreadRad = weapon.def.pelletSpreadDeg * DEG;

    // ペレット武器は1発の命中・部位を集約して扱う
    const results = new Map<Bot, { damage: number; headshot: boolean; point: THREE.Vector3 }>();

    for (let i = 0; i < weapon.def.pellets; i += 1) {
      const offset = coneOffset(spreadRad + pelletSpreadRad, Math.random);
      const dir = this.cameraForward()
        .addScaledVector(right, Math.tan(offset.yaw))
        .addScaledVector(up, Math.tan(offset.pitch))
        .normalize();
      this.tracePellet(origin, dir, muzzle, results);
    }

    for (const [bot, result] of results) {
      this.player.shotsHit += 1;
      if (result.headshot) this.player.headshots += 1;
      this.applyBotDamage(bot, result.damage, result.point, result.headshot, weapon.def.name);
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

  private applyBotDamage(
    bot: Bot,
    damage: number,
    point: THREE.Vector3,
    headshot: boolean,
    weaponName: string,
  ): void {
    const died = bot.takeDamage(damage);
    this.effects.hitPuff(point);
    this.damageNumbers.push({ amount: Math.round(damage), world: point.clone() });
    if (died) {
      this.player.kills += 1;
      this.player.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.player.streak);
      this.playerWeaponKills[weaponName] = (this.playerWeaponKills[weaponName] ?? 0) + 1;
      this.addKillScore(PLAYER_TEAM);
      this.hits.push('kill');
      this.feed.push({ killer: PLAYER_NAME, victim: bot.name, weapon: weaponName, headshot });
      this.sounds.kill();
    } else {
      this.hits.push(headshot ? 'head' : 'hit');
      if (headshot) this.sounds.headshot();
      else this.sounds.hit();
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
    const tuning = DIFFICULTY[this.config.difficulty];
    for (const bot of this.bots) {
      const targetEye = bot.alive && bot.blind <= 0 ? this.findTargetFor(bot) : null;
      bot.update(dt, {
        targetEye,
        objective: bot.alive ? this.objectiveFor(bot) : null,
        tuning,
        rand: this.rand,
        onShoot: (origin, dir) => this.botShoot(bot, origin, dir),
      });
    }
  }

  // 視界内で最も近い敵対エンティティの目の位置。誰も見えなければnull
  private findTargetFor(bot: Bot): THREE.Vector3 | null {
    const head = bot.headPosition();
    let best: THREE.Vector3 | null = null;
    let bestDist = BOT_VIEW_DISTANCE;

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
    const tuning = DIFFICULTY[this.config.difficulty];
    const hit = this.castRay(origin, dir, BOT_VIEW_DISTANCE, bot.body);
    const end = hit
      ? origin.clone().addScaledVector(dir, hitToi(hit))
      : origin.clone().addScaledVector(dir, BOT_VIEW_DISTANCE);
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
      this.addShake(0.16);
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

  private refillGrenades(): void {
    this.grenadeCounts.frag = GRENADE_SPECS.frag.carry;
    this.grenadeCounts.smoke = GRENADE_SPECS.smoke.carry;
    this.grenadeCounts.flash = GRENADE_SPECS.flash.carry;
    this.grenadeCounts.incendiary = GRENADE_SPECS.incendiary.carry;
  }

  private handleRespawns(): void {
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
    for (const bot of this.bots) {
      if (!bot.alive && bot.respawnIn <= 0) {
        const spawns = bot.team === PLAYER_TEAM ? this.playerSpawns : this.botSpawns;
        bot.respawnAt(this.pickSpawn(spawns, this.hostilesOf(bot.team)));
      }
    }
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
      damageNumbers: this.damageNumbers,
      incoming: this.incoming,
      tookDamage: this.tookDamage,
      scoreboard: this.scoreboard(),
    };
    this.feed = [];
    this.hits = [];
    this.damageNumbers = [];
    this.incoming = [];
    this.tookDamage = false;
    this.announcements = [];
    return snapshot;
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

  result(): MatchResult {
    const rows = this.scoreboard();
    const won = this.modeDef.teamBased
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
    for (const item of this.thrown) {
      this.scene.remove(item.mesh);
      (item.mesh.material as THREE.Material).dispose();
    }
    this.thrown = [];
    this.grenadeGeometry.dispose();
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
