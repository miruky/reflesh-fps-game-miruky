import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import { mulberry32, type Rand } from '../core/rng';
import type { Settings } from '../core/settings';
import { Effects } from '../render/effects';
import { ViewModel } from '../render/viewmodel';
import { coneOffset, damageAtDistance, partMultiplier, type HitPart } from './ballistics';
import { Bot, BOT_NAMES, DIFFICULTY, type Difficulty } from './bot';
import { Player } from './player';
import { generateStage, type StageDef } from './stage';
import { Weapon, WEAPON_DEFS } from './weapons';

const LOOK_BASE = 0.0022;
const PITCH_LIMIT = (89 * Math.PI) / 180;
const MELEE_RANGE = 2.2;
const MELEE_DAMAGE = 75;
const MELEE_COOLDOWN = 0.8;
const BOT_VIEW_DISTANCE = 60;
const BOT_VIEW_CONE_COS = Math.cos((75 * Math.PI) / 180);
const BOT_FALLOFF = { start: 14, end: 40, minFactor: 0.6 };
const BOT_COLOR = 0xc84b3c;
const PLAYER_NAME = 'あなた';

export interface MatchConfig {
  stage: StageDef;
  primaryId: string;
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
}

export interface MatchSnapshot {
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnIn: number;
  ammo: number;
  reserve: number;
  weaponName: string;
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

  private feed: FeedEntry[] = [];
  private hits: Array<'hit' | 'head' | 'kill'> = [];
  private damageNumbers: DamageNumber[] = [];
  private incoming: number[] = [];
  private tookDamage = false;

  constructor(
    readonly config: MatchConfig,
    private readonly settings: Settings,
    private readonly input: Input,
    private readonly sounds: SoundKit,
    aspect: number,
  ) {
    this.timeLeft = config.durationS;
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

    const primaryDef = WEAPON_DEFS[config.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    this.weapons = [new Weapon(primaryDef), new Weapon(WEAPON_DEFS['suzume']!)];

    for (let i = 0; i < config.stage.botCount; i += 1) {
      const name = BOT_NAMES[i % BOT_NAMES.length] ?? `BOT-${i}`;
      const botSpawn = this.botSpawns[i % this.botSpawns.length] ?? new THREE.Vector3();
      const bot = new Bot(this.physics, name, botSpawn, BOT_COLOR);
      this.tags.set(bot.bodyCollider.handle, { kind: 'bot', bot, part: 'body' });
      this.tags.set(bot.headCollider.handle, { kind: 'bot', bot, part: 'head' });
      this.scene.add(bot.group);
      this.bots.push(bot);
    }

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

  // 固定60Hzで呼ばれるゲームロジック本体
  update(dt: number): void {
    if (this.over) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
      return;
    }

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    const weapon = this.activeWeapon;

    // ADS: ホールドまたはトグル(アクセシビリティ設定)
    if (this.settings.adsToggle && this.input.adsPressed()) {
      this.adsLatch = !this.adsLatch;
    }
    const wantAds = this.settings.adsToggle ? this.adsLatch : this.input.adsDown();

    const moveInput = {
      x: (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0),
      z: (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0),
      jumpPressed: this.input.wasPressed('jump'),
      crouch: this.input.isDown('crouch'),
      sprint: this.input.isDown('sprint'),
    };
    this.player.update(dt, moveInput, weapon.adsProgress, this.sounds);

    this.handleWeaponSwitch();
    this.handleMelee();

    const sprintBlocksFire = this.player.sprinting;
    const events = weapon.update(
      dt * 1000,
      {
        trigger: this.input.fireDown() && this.player.alive && !sprintBlocksFire,
        ads: wantAds && this.player.alive,
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
        this.sounds.shot();
        this.alertBots();
      } else if (event.type === 'reload-start') {
        this.sounds.reload(event.durationMs);
      } else if (event.type === 'dryfire') {
        this.sounds.dryfire();
      }
    }
    const recovered = weapon.recoil.recover(dt);
    this.player.yaw += recovered.yaw;
    this.player.pitch -= recovered.pitch;

    this.updateBots(dt);
    this.physics.step();
    this.syncCamera();
    this.handleRespawns();
  }

  // 描画フレームごとの処理。視点操作はフレームレートに追従させる
  frame(dt: number, playing: boolean): void {
    if (playing && !this.over) {
      const weapon = this.activeWeapon;
      const adsSlow = 1 - 0.4 * weapon.adsProgress;
      const k = LOOK_BASE * this.settings.sensitivity * adsSlow;
      this.player.yaw -= this.input.mouseDX * k;
      this.player.pitch = THREE.MathUtils.clamp(
        this.player.pitch - this.input.mouseDY * k,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
      this.lastLookDX = this.input.mouseDX;
      this.lastLookDY = this.input.mouseDY;
    } else {
      this.lastLookDX = 0;
      this.lastLookDY = 0;
    }

    this.syncCamera();

    const weapon = this.activeWeapon;
    const targetFov =
      this.settings.fov * (1 - (1 - weapon.def.adsFovScale) * weapon.adsProgress);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }

    this.viewModel.update(dt, {
      adsProgress: weapon.adsProgress,
      mouseDX: this.lastLookDX,
      mouseDY: this.lastLookDY,
      moveFactor: this.player.moveFactor,
      grounded: this.player.grounded,
      reloadRatio: weapon.reloading ? weapon.reloadRatio : null,
      raiseRatio: weapon.raiseRatio,
    });
    this.effects.update(dt);
  }

  private syncCamera(): void {
    const eye = this.player.eyePosition;
    this.camera.position.copy(eye);
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
  }

  private handleWeaponSwitch(): void {
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
    this.meleeCooldown = MELEE_COOLDOWN;
    this.viewModel.fire();
    this.sounds.melee();

    const origin = this.player.eyePosition;
    const dir = this.cameraForward();
    const hit = this.castRay(origin, dir, MELEE_RANGE, this.player.body);
    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    if (tag?.kind === 'bot' && tag.bot.alive) {
      const point = origin.clone().addScaledVector(dir, hitToi(hit));
      this.applyBotDamage(tag.bot, MELEE_DAMAGE, point, false, '近接');
    }
  }

  private cameraForward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  private fireShot(spreadRad: number): void {
    if (!this.player.alive) return;
    this.player.shotsFired += 1;
    const weapon = this.activeWeapon;
    const origin = this.player.eyePosition;
    const offset = coneOffset(spreadRad, Math.random);
    const dir = this.cameraForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    dir
      .addScaledVector(right, Math.tan(offset.yaw))
      .addScaledVector(up, Math.tan(offset.pitch))
      .normalize();

    const hit = this.castRayWithNormal(origin, dir, weapon.def.range, this.player.body);
    const end = hit
      ? origin.clone().addScaledVector(dir, hitToi(hit))
      : origin.clone().addScaledVector(dir, weapon.def.range);

    const muzzle = this.viewModel.muzzleWorldPosition(new THREE.Vector3());
    this.effects.tracer(muzzle, end, weapon.def.tracerColor);

    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    if (tag?.kind === 'bot' && tag.bot.alive) {
      const distance = hitToi(hit);
      const base = damageAtDistance(weapon.def.damage, distance, weapon.def.falloff);
      const damage = base * partMultiplier(tag.part, weapon.def.headshotMultiplier);
      this.player.shotsHit += 1;
      if (tag.part === 'head') this.player.headshots += 1;
      this.applyBotDamage(tag.bot, damage, end, tag.part === 'head', weapon.def.name);
    } else if (tag?.kind === 'world' && hit.normal) {
      this.effects.impact(end, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z));
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
      this.hits.push('kill');
      this.feed.push({ killer: PLAYER_NAME, victim: bot.name, weapon: weaponName, headshot });
      this.sounds.kill();
    } else {
      this.hits.push(headshot ? 'head' : 'hit');
      if (headshot) this.sounds.headshot();
      else this.sounds.hit();
    }
  }

  private updateBots(dt: number): void {
    const tuning = DIFFICULTY[this.config.difficulty];
    const playerEye = this.player.alive ? this.player.eyePosition : null;
    for (const bot of this.bots) {
      let sees = false;
      if (playerEye && bot.alive) {
        const toPlayer = playerEye.clone().sub(bot.headPosition());
        const distance = toPlayer.length();
        if (distance < BOT_VIEW_DISTANCE) {
          const dirNorm = toPlayer.clone().normalize();
          const inCone =
            bot.alert > 0 || bot.facing().dot(dirNorm) > BOT_VIEW_CONE_COS;
          if (inCone) {
            const hit = this.castRay(bot.headPosition(), dirNorm, distance - 0.2, bot.body);
            sees = hit === null || this.tags.get(hit.collider.handle)?.kind === 'player';
          }
        }
      }
      bot.update(dt, {
        playerEye,
        seesPlayer: sees,
        tuning,
        rand: this.rand,
        onShoot: (origin, dir) => this.botShoot(bot, origin, dir),
      });
    }
  }

  private botShoot(bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const tuning = DIFFICULTY[this.config.difficulty];
    const hit = this.castRay(origin, dir, BOT_VIEW_DISTANCE, bot.body);
    const end = hit
      ? origin.clone().addScaledVector(dir, hitToi(hit))
      : origin.clone().addScaledVector(dir, BOT_VIEW_DISTANCE);
    this.effects.tracer(origin, end, 0xff7a6b);

    // 発砲音は方向と距離をつけて鳴らす
    const eye = this.player.eyePosition;
    const toSource = origin.clone().sub(eye);
    const distance = toSource.length();
    const forward = this.cameraForward();
    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = THREE.MathUtils.clamp(toSource.clone().normalize().dot(rightDir), -1, 1);
    this.sounds.enemyShot(pan, distance);

    if (!hit) return;
    const tag = this.tags.get(hit.collider.handle);
    if (tag?.kind !== 'player' || !this.player.alive) return;

    const damage = damageAtDistance(tuning.damage, hitToi(hit), BOT_FALLOFF);
    const died = this.player.takeDamage(damage);
    this.tookDamage = true;
    this.sounds.hurt();

    // 被弾方向インジケータ用の角度(カメラ正面基準)
    const flat = toSource.clone().setY(0).normalize();
    const forwardFlat = forward.clone().setY(0).normalize();
    const cross = forwardFlat.x * flat.z - forwardFlat.z * flat.x;
    const angle = Math.atan2(cross, forwardFlat.dot(flat));
    this.incoming.push(angle);

    if (died) {
      bot.kills += 1;
      this.feed.push({ killer: bot.name, victim: PLAYER_NAME, weapon: 'ボットAR', headshot: false });
      this.sounds.death();
    }
  }

  private alertBots(): void {
    const pos = this.player.position;
    for (const bot of this.bots) {
      if (bot.alive && bot.position.distanceTo(pos) < 35) bot.alert = 4;
    }
  }

  private handleRespawns(): void {
    if (!this.player.alive && this.player.respawnIn <= 0) {
      this.player.respawnAt(this.pickSpawn(this.playerSpawns, this.botPositions()));
      this.activeWeapon.raise();
    }
    for (const bot of this.bots) {
      if (!bot.alive && bot.respawnIn <= 0) {
        bot.respawnAt(this.pickSpawn(this.botSpawns, [this.player.position]));
      }
    }
  }

  private botPositions(): THREE.Vector3[] {
    return this.bots.filter((b) => b.alive).map((b) => b.position);
  }

  // 敵から最も離れた地点に湧く
  private pickSpawn(candidates: THREE.Vector3[], enemies: THREE.Vector3[]): THREE.Vector3 {
    let best = candidates[0] ?? new THREE.Vector3();
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = enemies.length
        ? Math.min(...enemies.map((e) => e.distanceTo(candidate)))
        : 1;
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
    exclude: RAPIER.RigidBody,
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
      exclude,
    ) as unknown as RayHitLike | null;
  }

  private castRayWithNormal(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
    exclude: RAPIER.RigidBody,
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
      exclude,
    ) as unknown as RayNormalHitLike | null;
  }

  snapshot(): MatchSnapshot {
    const weapon = this.activeWeapon;
    const snapshot: MatchSnapshot = {
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      alive: this.player.alive,
      respawnIn: Math.max(0, this.player.respawnIn),
      ammo: weapon.magazine.rounds,
      reserve: weapon.magazine.reserve,
      weaponName: weapon.def.name,
      fireMode:
        weapon.def.mode === 'auto' ? 'フルオート' : weapon.def.mode === 'semi' ? '単発' : 'バースト',
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
    return snapshot;
  }

  scoreboard(): ScoreRow[] {
    const rows: ScoreRow[] = [
      { name: PLAYER_NAME, kills: this.player.kills, deaths: this.player.deaths, isPlayer: true },
      ...this.bots.map((bot) => ({
        name: bot.name,
        kills: bot.kills,
        deaths: bot.deaths,
        isPlayer: false,
      })),
    ];
    return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  result(): {
    rows: ScoreRow[];
    won: boolean;
    accuracy: number;
    headshots: number;
  } {
    const rows = this.scoreboard();
    return {
      rows,
      won: rows[0]?.isPlayer ?? false,
      accuracy:
        this.player.shotsFired > 0 ? this.player.shotsHit / this.player.shotsFired : 0,
      headshots: this.player.headshots,
    };
  }

  projectToScreen(world: THREE.Vector3, width: number, height: number): { x: number; y: number; behind: boolean } {
    const projected = world.clone().project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
      behind: projected.z > 1,
    };
  }

  dispose(): void {
    this.effects.dispose();
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
