import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Rand } from '../core/rng';

// 胴体カプセルは首までの高さに留め、頭の判定球をカプセルの外に出す。
// 全身を覆うカプセルにすると水平レイが常に胴体へ先に当たり、
// ヘッドショットが成立しなくなる。頭頂は足元から1.9mでプレイヤーと同じ。
const BODY_HALF = 0.45;
const BODY_RADIUS = 0.35;
const CENTER_TO_FEET = BODY_HALF + BODY_RADIUS;
const HEAD_OFFSET = 0.88;
const HEAD_RADIUS = 0.22;
const MOVE_SPEED = 3.4;
const GRAVITY = 18;

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotTuning {
  spreadDeg: number;
  reactionS: number;
  damage: number;
  burstPauseMin: number;
  burstPauseMax: number;
}

export const DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { spreadDeg: 5.5, reactionS: 0.6, damage: 8, burstPauseMin: 1.0, burstPauseMax: 1.6 },
  normal: { spreadDeg: 3.2, reactionS: 0.38, damage: 11, burstPauseMin: 0.7, burstPauseMax: 1.2 },
  hard: { spreadDeg: 1.9, reactionS: 0.22, damage: 14, burstPauseMin: 0.5, burstPauseMax: 0.9 },
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
  playerEye: THREE.Vector3 | null; // プレイヤー死亡中はnull
  seesPlayer: boolean;
  tuning: BotTuning;
  rand: Rand;
  onShoot: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
}

export class Bot {
  readonly body: RAPIER.RigidBody;
  readonly bodyCollider: RAPIER.Collider;
  readonly headCollider: RAPIER.Collider;
  readonly group = new THREE.Group();

  hp = 100;
  alive = true;
  respawnIn = 0;
  kills = 0;
  deaths = 0;
  alert = 0; // 0より大きい間は視野制限なしで索敵する

  private readonly controller: RAPIER.KinematicCharacterController;
  private heading = 0;
  private headingTimer = 0;
  private strafeSign = 1;
  private strafeTimer = 0;
  private velY = 0;
  private reaction = 0;
  private burstLeft = 0;
  private shotTimer = 0;
  private pauseTimer = 0;
  private dyingTimer = 0;

  constructor(
    world: RAPIER.World,
    readonly name: string,
    spawn: THREE.Vector3,
    color: number,
  ) {
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      spawn.y + CENTER_TO_FEET,
      spawn.z,
    );
    this.body = world.createRigidBody(desc);
    this.bodyCollider = world.createCollider(
      RAPIER.ColliderDesc.capsule(BODY_HALF, BODY_RADIUS),
      this.body,
    );
    this.headCollider = world.createCollider(
      RAPIER.ColliderDesc.ball(HEAD_RADIUS).setTranslation(0, HEAD_OFFSET, 0),
      this.body,
    );
    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.4, 0.3, true);
    this.controller.enableSnapToGround(0.4);

    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.6),
      roughness: 0.6,
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, BODY_HALF * 2), bodyMat);
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 16, 12), headMat);
    head.position.y = HEAD_OFFSET;
    head.castShadow = true;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.07, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.3 }),
    );
    visor.position.set(0, HEAD_OFFSET + 0.02, -0.2);
    this.group.add(torso, head, visor);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  headPosition(): THREE.Vector3 {
    const p = this.position;
    p.y += HEAD_OFFSET;
    return p;
  }

  facing(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  update(dt: number, ctx: BotContext): void {
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.dyingTimer > 0) {
        this.dyingTimer -= dt;
        // 倒れる演出。残り時間で寝かせていく
        const t = 1 - Math.max(0, this.dyingTimer) / 0.4;
        this.group.rotation.x = (-Math.PI / 2) * t;
        if (this.dyingTimer <= 0) this.group.visible = false;
      }
      return;
    }

    this.alert = Math.max(0, this.alert - dt);
    const engaged = ctx.seesPlayer && ctx.playerEye !== null;

    let wishX = 0;
    let wishZ = 0;
    if (engaged && ctx.playerEye) {
      const toPlayer = ctx.playerEye.clone().sub(this.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      toPlayer.normalize();
      this.heading = Math.atan2(-toPlayer.x, -toPlayer.z);

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        this.strafeTimer = 1 + ctx.rand() * 2;
      }
      const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this.strafeSign);
      // 9〜20mの交戦距離を保つ
      const approach = dist > 20 ? 1 : dist < 9 ? -1 : 0;
      wishX = (side.x * 0.8 + toPlayer.x * approach) * MOVE_SPEED;
      wishZ = (side.z * 0.8 + toPlayer.z * approach) * MOVE_SPEED;
    } else {
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = ctx.rand() * Math.PI * 2;
        this.headingTimer = 2 + ctx.rand() * 3;
      }
      const f = this.facing();
      wishX = f.x * MOVE_SPEED * 0.7;
      wishZ = f.z * MOVE_SPEED * 0.7;
    }

    this.velY -= GRAVITY * dt;
    const movement = { x: wishX * dt, y: this.velY * dt, z: wishZ * dt };
    this.controller.computeColliderMovement(this.bodyCollider, movement);
    const moved = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.velY < 0) this.velY = -0.5;

    // 壁に引っかかったら進路を変える
    const wishLen = Math.hypot(movement.x, movement.z);
    const movedLen = Math.hypot(moved.x, moved.z);
    if (wishLen > 0.001 && movedLen < wishLen * 0.25) {
      this.heading = ctx.rand() * Math.PI * 2;
      this.headingTimer = 1.5;
      this.strafeSign *= -1;
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    });

    this.updateShooting(dt, ctx, engaged);
    this.syncMesh();
  }

  private updateShooting(dt: number, ctx: BotContext, engaged: boolean): void {
    if (!engaged || !ctx.playerEye) {
      this.reaction = ctx.tuning.reactionS;
      this.burstLeft = 0;
      return;
    }
    this.reaction -= dt;
    if (this.reaction > 0) return;

    if (this.burstLeft <= 0) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.burstLeft = 3 + Math.floor(ctx.rand() * 3);
        this.shotTimer = 0;
      }
      return;
    }

    this.shotTimer -= dt;
    if (this.shotTimer > 0) return;
    this.shotTimer = 0.16;
    this.burstLeft -= 1;
    if (this.burstLeft === 0) {
      this.pauseTimer =
        ctx.tuning.burstPauseMin +
        ctx.rand() * (ctx.tuning.burstPauseMax - ctx.tuning.burstPauseMin);
    }

    const origin = this.headPosition();
    const dir = ctx.playerEye.clone().sub(origin).normalize();
    const spread = (ctx.tuning.spreadDeg * Math.PI) / 180;
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

  syncMesh(): void {
    const t = this.body.translation();
    this.group.position.set(t.x, t.y, t.z);
    if (this.alive) this.group.rotation.y = this.heading;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.alert = 5;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      this.respawnIn = 3;
      this.dyingTimer = 0.4;
      // 死体を見えない壁にしない。リスポーンまで弾と移動の判定から外す
      this.bodyCollider.setEnabled(false);
      this.headCollider.setEnabled(false);
      return true;
    }
    return false;
  }

  respawnAt(spawn: THREE.Vector3): void {
    this.hp = 100;
    this.alive = true;
    this.velY = 0;
    this.alert = 0;
    this.group.visible = true;
    this.group.rotation.x = 0;
    this.bodyCollider.setEnabled(true);
    this.headCollider.setEnabled(true);
    this.body.setTranslation({ x: spawn.x, y: spawn.y + CENTER_TO_FEET, z: spawn.z }, true);
    this.syncMesh();
  }
}
