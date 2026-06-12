import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { SoundKit } from '../core/audio';

export const CAPSULE_RADIUS = 0.35;
export const CAPSULE_HALF = 0.6; // 円柱部の半分。全高 2*(0.6+0.35)=1.9m
const CENTER_TO_FEET = CAPSULE_HALF + CAPSULE_RADIUS;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;
const EYE_SLIDE = 0.88;

const WALK_SPEED = 4.6;
const SPRINT_SPEED = 6.4;
const CROUCH_SPEED = 2.4;
const ADS_SPEED_FACTOR = 0.6;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 9;
const GRAVITY = 18;
const JUMP_VELOCITY = 6.4;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const FALL_DAMAGE_THRESHOLD = 12;
const REGEN_DELAY = 4;
const REGEN_PER_SECOND = 25;

const SLIDE_BOOST = 8.4;
const SLIDE_DURATION = 0.9;
const SLIDE_STEER = 6;

const LEAN_OFFSET = 0.38;
const LEAN_SPEED = 9;

const MANTLE_REACH = 0.95;
const MANTLE_MAX_CLIMB = 1.55;
const MANTLE_MIN_CLIMB = 0.45;
const MANTLE_DURATION = 0.34;

export interface MoveInput {
  x: number; // 右が正
  z: number; // 前が正
  jumpPressed: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  sprint: boolean;
  lean: number; // -1(左)..1(右)
}

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  yaw = 0;
  pitch = 0;
  hp = 100;
  readonly maxHp = 100;
  alive = true;
  kills = 0;
  deaths = 0;
  streak = 0;
  shotsFired = 0;
  shotsHit = 0;
  headshots = 0;
  crouching = false;
  sprinting = false;
  sliding = false;
  mantling = false;
  grounded = false;
  respawnIn = 0;
  eyeHeight = EYE_STAND;
  lean = 0; // 滑らかに追従した現在値

  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly vel = new THREE.Vector3();
  private velY = 0;
  private sinceGrounded = 99;
  private jumpBuffered = 0;
  private sinceDamage = 99;
  private stepDistance = 0;
  private slideTimer = 0;
  private readonly slideDir = new THREE.Vector3();
  private mantleTimer = 0;
  private readonly mantleFrom = new THREE.Vector3();
  private readonly mantleTo = new THREE.Vector3();

  constructor(world: RAPIER.World, spawn: THREE.Vector3) {
    this.world = world;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      spawn.y + CENTER_TO_FEET,
      spawn.z,
    );
    this.body = world.createRigidBody(bodyDesc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS),
      this.body,
    );
    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.4, 0.3, true);
    this.controller.enableSnapToGround(0.4);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get eyePosition(): THREE.Vector3 {
    const p = this.position;
    p.y += -CENTER_TO_FEET + this.eyeHeight;
    // リーンは視点を真横へずらす。射線も同じ点から出るため覗き撃ちが成立する
    if (this.lean !== 0) {
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      p.x += rightX * this.lean * LEAN_OFFSET;
      p.z += rightZ * this.lean * LEAN_OFFSET;
      p.y -= Math.abs(this.lean) * 0.08;
    }
    return p;
  }

  // 0(静止)から1(全力)。スプレッド計算用
  get moveFactor(): number {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    return Math.min(1, speed / SPRINT_SPEED);
  }

  update(dt: number, input: MoveInput, adsProgress: number, sounds: SoundKit): void {
    if (!this.alive) {
      this.respawnIn -= dt;
      return;
    }

    if (this.mantling) {
      this.updateMantle(dt);
      return;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    // スライディング: スプリント中にしゃがみで発動
    const horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (
      input.crouchPressed &&
      this.sprinting &&
      this.grounded &&
      !this.sliding &&
      horizontalSpeed > WALK_SPEED * 0.9
    ) {
      this.sliding = true;
      this.slideTimer = 0;
      this.slideDir.copy(this.vel).setY(0).normalize();
      sounds.slide();
    }
    if (this.sliding) {
      this.slideTimer += dt;
      const ended = this.slideTimer >= SLIDE_DURATION || !input.crouch || !this.grounded;
      if (ended) this.sliding = false;
    }

    this.crouching = input.crouch || this.sliding;
    const targetEye = this.sliding ? EYE_SLIDE : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    // リーン: 接地中のみ。スプリントやスライド中は構えが崩れるので戻す
    const leanTarget =
      this.grounded && !this.sprinting && !this.sliding
        ? THREE.MathUtils.clamp(input.lean, -1, 1)
        : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * LEAN_SPEED);
    if (Math.abs(this.lean) < 0.01 && leanTarget === 0) this.lean = 0;

    this.sprinting =
      input.sprint &&
      input.z > 0.5 &&
      !input.crouch &&
      !this.sliding &&
      adsProgress < 0.3 &&
      this.grounded;

    if (this.sliding) {
      // 滑走は時間で減速し、入力でわずかに舵が切れる
      const t = this.slideTimer / SLIDE_DURATION;
      const speed = SLIDE_BOOST + (CROUCH_SPEED - SLIDE_BOOST) * t;
      this.slideDir.addScaledVector(right, input.x * SLIDE_STEER * dt * 0.1).normalize();
      this.vel.x = this.slideDir.x * speed;
      this.vel.z = this.slideDir.z * speed;
    } else {
      let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
      speed *= 1 - (1 - ADS_SPEED_FACTOR) * adsProgress;

      const wish = new THREE.Vector3()
        .addScaledVector(forward, input.z)
        .addScaledVector(right, input.x);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(speed);

      const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
      this.vel.x = approach(this.vel.x, wish.x, accel * dt);
      this.vel.z = approach(this.vel.z, wish.z, accel * dt);
    }

    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    this.jumpBuffered = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffered - dt);
    if (this.jumpBuffered > 0 && this.sinceGrounded < COYOTE_TIME) {
      this.velY = JUMP_VELOCITY;
      this.jumpBuffered = 0;
      this.sinceGrounded = COYOTE_TIME;
      this.sliding = false;
      sounds.footstep(0.5);
    }

    // マントリング: 空中で前進入力しながら壁に向かっていれば、登れる縁を探す
    if (!this.grounded && input.z > 0.5 && this.velY < 4 && this.tryMantle(forward)) {
      sounds.mantle();
      return;
    }

    this.velY -= GRAVITY * dt;

    const movement = {
      x: this.vel.x * dt,
      y: this.velY * dt,
      z: this.vel.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, movement);
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velY;
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.velY < 0) this.velY = -0.5;
    // 頭上に当たって上昇が遮られた場合
    if (this.velY > 0 && moved.y < movement.y * 0.5) this.velY = 0;

    if (!wasGrounded && this.grounded && fallSpeed > FALL_DAMAGE_THRESHOLD) {
      this.takeDamage((fallSpeed - FALL_DAMAGE_THRESHOLD) * 5);
      sounds.footstep(1);
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    });

    if (this.grounded && !this.sliding) {
      this.stepDistance += Math.hypot(moved.x, moved.z);
      const stride = this.sprinting ? 2.9 : 2.3;
      if (this.stepDistance >= stride) {
        this.stepDistance = 0;
        sounds.footstep(this.crouching ? 0.2 : this.sprinting ? 1 : 0.55);
      }
    }

    this.sinceDamage += dt;
    if (this.sinceDamage > REGEN_DELAY && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + REGEN_PER_SECOND * dt);
    }
  }

  // 登れる縁が見つかったらマントリングを開始してtrueを返す
  private tryMantle(forward: THREE.Vector3): boolean {
    const center = this.position;
    const chest = center.clone();
    chest.y += 0.1;
    const wall = this.castRay(chest, forward, MANTLE_REACH);
    if (wall === null) return false;

    // 頭上が塞がっていたら登れない
    if (this.castRay(center, new THREE.Vector3(0, 1, 0), MANTLE_MAX_CLIMB) !== null) return false;

    const probeTop = center.clone();
    probeTop.y += MANTLE_MAX_CLIMB;
    probeTop.addScaledVector(forward, wall + CAPSULE_RADIUS + 0.15);
    const down = this.castRay(probeTop, new THREE.Vector3(0, -1, 0), MANTLE_MAX_CLIMB + 0.5);
    if (down === null) return false;

    const ledgeY = probeTop.y - down;
    const feetY = center.y - CENTER_TO_FEET;
    const climb = ledgeY - feetY;
    if (climb < MANTLE_MIN_CLIMB || climb > MANTLE_MAX_CLIMB) return false;

    this.mantling = true;
    this.mantleTimer = 0;
    this.mantleFrom.copy(center);
    this.mantleTo.set(probeTop.x, ledgeY + CENTER_TO_FEET + 0.05, probeTop.z);
    this.vel.set(0, 0, 0);
    this.velY = 0;
    this.sliding = false;
    return true;
  }

  private updateMantle(dt: number): void {
    this.mantleTimer += dt;
    const t = Math.min(1, this.mantleTimer / MANTLE_DURATION);
    // 先に体を持ち上げ、その後に前へ乗り出す
    const up = Math.min(1, t * 1.6);
    const fwd = Math.max(0, (t - 0.35) / 0.65);
    const x = THREE.MathUtils.lerp(this.mantleFrom.x, this.mantleTo.x, ease(fwd));
    const z = THREE.MathUtils.lerp(this.mantleFrom.z, this.mantleTo.z, ease(fwd));
    const y = THREE.MathUtils.lerp(this.mantleFrom.y, this.mantleTo.y, ease(up));
    this.body.setNextKinematicTranslation({ x, y, z });
    if (t >= 1) {
      this.mantling = false;
      this.grounded = true;
    }
  }

  private castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number): number | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, this.body);
    if (hit === null) return null;
    const h = hit as unknown as { toi?: number; timeOfImpact?: number };
    return h.toi ?? h.timeOfImpact ?? 0;
  }

  // diedをtrueで返す
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.sinceDamage = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      this.streak = 0;
      this.respawnIn = 2.5;
      this.sliding = false;
      this.mantling = false;
      this.lean = 0;
      // 死亡中の体をBOTの弾・移動・視線の障害物にしない
      this.collider.setEnabled(false);
      return true;
    }
    return false;
  }

  respawnAt(spawn: THREE.Vector3): void {
    this.hp = this.maxHp;
    this.alive = true;
    this.velY = 0;
    this.vel.set(0, 0, 0);
    this.sinceDamage = 99;
    this.sliding = false;
    this.mantling = false;
    this.lean = 0;
    this.collider.setEnabled(true);
    this.body.setTranslation({ x: spawn.x, y: spawn.y + CENTER_TO_FEET, z: spawn.z }, true);
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}
