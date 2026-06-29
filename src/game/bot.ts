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

// カプセル中心からこの高さより下への着弾は脚部扱い
export const HIP_OFFSET_Y = -0.1;

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
  // 現在見えている交戦対象の目の位置。誰も見えなければnull
  targetEye: THREE.Vector3 | null;
  // 非交戦時に向かう地点(ドミネーションの拠点など)。なければ徘徊する
  objective: THREE.Vector3 | null;
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
  blind = 0; // フラッシュで目が眩んでいる残り秒数

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

  // 歩行アニメ用。胴体ボブと四肢スイングを駆動する
  private readonly rig = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private walkPhase = 0;
  private walkAmp = 0;
  private hitFlash = 0; // 被弾時に装甲を一瞬発光させる残り時間
  private armorMat: THREE.MeshStandardMaterial | null = null;

  constructor(
    world: RAPIER.World,
    readonly name: string,
    spawn: THREE.Vector3,
    color: number,
    readonly team: number = 1,
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

    this.buildMesh(color);
  }

  // チーム色の装甲・暗い下地・発光バイザーで構成したヒューマノイド兵士。
  // 当たり判定(胴カプセル+頭球)は別管理なので見た目は自由に組める。
  private buildMesh(color: number): void {
    const c = new THREE.Color(color);
    const armor = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.55,
      metalness: 0.12,
      emissive: c.clone(),
      emissiveIntensity: 0,
    });
    this.armorMat = armor;
    const dark = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.42),
      roughness: 0.6,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0d0f13,
      emissive: c.clone(),
      emissiveIntensity: 1.15,
      roughness: 0.3,
    });
    const gun = new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.5 });
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // 胴・腰・胸・背・肩・首・頭・ヘルメット・発光バイザーと胸の発光帯
    this.rig.add(
      part(box(0.4, 0.26, 0.28), dark, 0, -0.2, 0), // 腰
      part(box(0.38, 0.3, 0.28), armor, 0, 0.02, 0), // 腹
      part(box(0.52, 0.38, 0.32), armor, 0, 0.34, 0), // 胸
      part(box(0.54, 0.06, 0.02), glow, 0, 0.36, -0.17), // 胸の発光帯
      part(box(0.3, 0.34, 0.16), dark, 0, 0.3, 0.2), // バックパック
      part(box(0.18, 0.16, 0.22), dark, -0.32, 0.5, 0), // 左肩
      part(box(0.18, 0.16, 0.22), dark, 0.32, 0.5, 0), // 右肩
      part(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), dark, 0, 0.6, 0), // 首
      part(new THREE.SphereGeometry(0.19, 16, 12), dark, 0, HEAD_OFFSET, 0), // 頭
      part(box(0.3, 0.17, 0.32), armor, 0, HEAD_OFFSET + 0.08, 0.02), // ヘルメット
      part(box(0.27, 0.09, 0.06), glow, 0, HEAD_OFFSET - 0.01, -0.16), // 発光バイザー
    );

    // 腕(ライフルを前方に構える静的ポーズ)
    const arm = (sx: number) => {
      const g = new THREE.Group();
      g.position.set(sx, 0.48, 0);
      g.rotation.x = -1.15;
      g.rotation.z = -sx * 0.4;
      g.add(part(box(0.12, 0.3, 0.12), armor, 0, -0.13, 0)); // 上腕
      g.add(part(box(0.1, 0.28, 0.1), dark, 0, -0.34, 0.02)); // 前腕
      return g;
    };
    this.rig.add(arm(-0.34), arm(0.34));

    // 構えるライフル
    const rifle = new THREE.Group();
    rifle.position.set(0.02, 0.34, -0.36);
    rifle.add(part(box(0.08, 0.1, 0.42), gun, 0, 0, 0));
    rifle.add(part(box(0.04, 0.04, 0.3), gun, 0, 0.01, -0.32));
    rifle.add(part(box(0.05, 0.16, 0.08), gun, 0, -0.12, 0.04));
    this.rig.add(rifle);

    // 脚(股関節ピボット + 膝ピボット)。歩行で前後にスイングする
    const buildLeg = (pivot: THREE.Group, knee: THREE.Group, sx: number) => {
      pivot.position.set(sx, -0.18, 0);
      pivot.add(part(box(0.15, 0.32, 0.16), armor, 0, -0.16, 0)); // 腿
      knee.position.set(0, -0.32, 0);
      knee.add(part(box(0.13, 0.3, 0.14), dark, 0, -0.15, 0)); // 脛
      knee.add(part(box(0.14, 0.08, 0.26), dark, 0, -0.3, -0.05)); // 足
      pivot.add(knee);
      this.rig.add(pivot);
    };
    buildLeg(this.legL, this.kneeL, -0.12);
    buildLeg(this.legR, this.kneeR, 0.12);

    this.group.add(this.rig);
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
    this.blind = Math.max(0, this.blind - dt);
    if (this.hitFlash > 0 && this.armorMat) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.armorMat.emissiveIntensity = (this.hitFlash / 0.12) * 0.9;
    }
    const engaged = ctx.targetEye !== null;

    let wishX = 0;
    let wishZ = 0;
    if (ctx.targetEye) {
      const toTarget = ctx.targetEye.clone().sub(this.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      toTarget.normalize();
      this.heading = Math.atan2(-toTarget.x, -toTarget.z);

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        this.strafeTimer = 1 + ctx.rand() * 2;
      }
      const side = new THREE.Vector3(-toTarget.z, 0, toTarget.x).multiplyScalar(this.strafeSign);
      // 9〜20mの交戦距離を保つ
      const approach = dist > 20 ? 1 : dist < 9 ? -1 : 0;
      wishX = (side.x * 0.8 + toTarget.x * approach) * MOVE_SPEED;
      wishZ = (side.z * 0.8 + toTarget.z * approach) * MOVE_SPEED;
    } else if (ctx.objective && this.position.distanceTo(ctx.objective) > 3) {
      // 拠点へ向かう。直進しすぎないよう周期的に揺らす
      const toObjective = ctx.objective.clone().sub(this.position).setY(0).normalize();
      this.headingTimer -= dt;
      if (this.headingTimer <= 0) {
        this.heading = Math.atan2(-toObjective.x, -toObjective.z) + (ctx.rand() - 0.5) * 0.7;
        this.headingTimer = 0.8 + ctx.rand() * 1.2;
      }
      const f = this.facing();
      wishX = f.x * MOVE_SPEED * 0.85;
      wishZ = f.z * MOVE_SPEED * 0.85;
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

    // 歩行アニメ: 実移動量から歩調(位相)と振幅を進める
    const step = Math.hypot(moved.x, moved.z);
    const targetAmp = Math.min(1, step / Math.max(1e-4, MOVE_SPEED * dt));
    this.walkAmp += (targetAmp - this.walkAmp) * Math.min(1, dt * 8);
    this.walkPhase += step * 9;

    this.updateShooting(dt, ctx, engaged);
    this.syncMesh();
  }

  private updateShooting(dt: number, ctx: BotContext, engaged: boolean): void {
    if (!engaged || !ctx.targetEye) {
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
    const dir = ctx.targetEye.clone().sub(origin).normalize();
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
    if (!this.alive) return;
    this.group.rotation.y = this.heading;
    // 歩行サイクル: 左右の脚を逆位相でスイングし、接地脚側の膝を曲げ、胴を上下させる
    const s = Math.sin(this.walkPhase);
    const swing = s * this.walkAmp * 0.8;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.kneeL.rotation.x = Math.max(0, -s) * this.walkAmp;
    this.kneeR.rotation.x = Math.max(0, s) * this.walkAmp;
    this.rig.position.y = Math.abs(Math.cos(this.walkPhase)) * this.walkAmp * 0.04;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.alert = 5;
    this.hitFlash = 0.12;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      this.respawnIn = 3;
      this.dyingTimer = 0.4;
      // 死亡フレームでupdateの被弾発光減衰(alive早期returnの後)が止まるため、
      // ここで明示的に消す。さもないと倒れる演出中ずっと装甲が光ったままになる
      this.hitFlash = 0;
      if (this.armorMat) this.armorMat.emissiveIntensity = 0;
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
    this.blind = 0;
    this.group.visible = true;
    this.group.rotation.x = 0;
    this.walkAmp = 0;
    this.rig.position.y = 0;
    this.hitFlash = 0;
    if (this.armorMat) this.armorMat.emissiveIntensity = 0;
    this.bodyCollider.setEnabled(true);
    this.headCollider.setEnabled(true);
    this.body.setTranslation({ x: spawn.x, y: spawn.y + CENTER_TO_FEET, z: spawn.z }, true);
    this.syncMesh();
  }
}
