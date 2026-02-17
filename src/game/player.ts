import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { SoundKit } from '../core/audio';

export const CAPSULE_RADIUS = 0.35;
export const CAPSULE_HALF = 0.6; // 円柱部の半分。全高 2*(0.6+0.35)=1.9m
const CENTER_TO_FEET = CAPSULE_HALF + CAPSULE_RADIUS;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;

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

export interface MoveInput {
  x: number; // 右が正
  z: number; // 前が正
  jumpPressed: boolean;
  crouch: boolean;
  sprint: boolean;
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
  grounded = false;
  respawnIn = 0;
  eyeHeight = EYE_STAND;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly vel = new THREE.Vector3();
  private velY = 0;
  private sinceGrounded = 99;
  private jumpBuffered = 0;
  private sinceDamage = 99;
  private stepDistance = 0;

  constructor(world: RAPIER.World, spawn: THREE.Vector3) {
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

    this.crouching = input.crouch;
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    this.sprinting =
      input.sprint && input.z > 0.5 && !this.crouching && adsProgress < 0.3 && this.grounded;
    let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    speed *= 1 - (1 - ADS_SPEED_FACTOR) * adsProgress;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wish = new THREE.Vector3()
      .addScaledVector(forward, input.z)
      .addScaledVector(right, input.x);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);

    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    this.vel.x = approach(this.vel.x, wish.x, accel * dt);
    this.vel.z = approach(this.vel.z, wish.z, accel * dt);

    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    this.jumpBuffered = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffered - dt);
    if (this.jumpBuffered > 0 && this.sinceGrounded < COYOTE_TIME) {
      this.velY = JUMP_VELOCITY;
      this.jumpBuffered = 0;
      this.sinceGrounded = COYOTE_TIME;
      sounds.footstep(0.5);
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

    if (this.grounded) {
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
    this.body.setTranslation(
      { x: spawn.x, y: spawn.y + CENTER_TO_FEET, z: spawn.z },
      true,
    );
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
