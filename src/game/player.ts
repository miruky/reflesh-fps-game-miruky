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
// 空中はQuake系の射影加速で運動量を保ちつつ強い空中制御を効かせる(BO3風)
const AIR_ACCEL = 16;
const AIR_WISH_SPEED = SPRINT_SPEED; // 見ている方向への加速の頭打ち
const AIR_MAX_SPEED = 13; // 水平速度のソフト上限(ストレイフ蓄積の暴走防止)
// 上限超過分の減衰率。ストレイフの加速(near-cap で ~0.5m/s/フレーム)を
// 上回る強さにして、空中加速が上限の2倍まで暴走しないようにする
const AIR_DRAG = 24;
const GRAVITY = 18;
// 下向き終端速度。24/60 = 0.4m/frame で snapToGround(0.4) と床コライダー半厚(0.5)の
// 両方を下回るため、長距離落下しても床スイープがスラブを飛び越さない(トンネリング防止)
export const MAX_FALL_SPEED = 24;
const JUMP_VELOCITY = 6.4;
const THRUST_JUMP_VELOCITY = 6.0; // スラスト(二段)ジャンプの上昇量
const SLIDE_JUMP_VELOCITY = 6.9; // スライドジャンプはやや高く跳ぶ
const AIR_JUMPS = 1; // 接地・壁取り付きで戻る空中ジャンプ回数
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const FALL_DAMAGE_THRESHOLD = 16; // 空中戦主体なので落下耐性を少し上げる
const FALL_DAMAGE_MULT = 4;
const REGEN_DELAY = 4;
const REGEN_PER_SECOND = 25;

const SLIDE_BOOST = 9.2; // パワースライド開始時の加速(刷新)
const SLIDE_MIN_SPEED = 3.0; // スライド終端速度
const SLIDE_DURATION = 0.85;
const SLIDE_STEER = 6;
const SLIDE_ENTER_SPEED = WALK_SPEED * 0.9;
const SLIDE_COOLDOWN = 0.25; // 連続スライドの最小間隔

const WALLRUN_DURATION = 1.5;
const WALLRUN_SPEED = 7.6;
const WALLRUN_GRAVITY = 0.18; // 重力係数。小さいほどゆっくり落ちる
const WALLRUN_MIN_SPEED = 3.0; // 取り付きに必要な水平速度
const WALLRUN_STICK = 1.2; // 壁へ押し付ける速度
const WALLRUN_DETECT = 0.32; // カプセル表面からの壁検出距離
const WALLRUN_COOLDOWN = 0.3; // 離脱後の再取り付き禁止時間
const WALLRUN_FALL_CAP = 2; // ウォールラン中の最大落下速度
const WALLRUN_TILT_SPEED = 8; // 視点ロールの追従速度
const WALLJUMP_UP = 6.6;
const WALLJUMP_PUSH = 5.4;

const LEAN_OFFSET = 0.38;
const LEAN_SPEED = 9;

const MANTLE_REACH = 0.95;
const MANTLE_MAX_CLIMB = 1.55;
const MANTLE_MIN_CLIMB = 0.45;
const MANTLE_DURATION = 0.34;

// match / HUD から参照する移動速度の代表値
export const MOVE_SPEEDS = {
  walk: WALK_SPEED,
  sprint: SPRINT_SPEED,
  slide: SLIDE_BOOST,
  airMax: AIR_MAX_SPEED,
} as const;

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
  wallRunning = false;
  wallRunTilt = 0; // カメラロール用 -1..1(滑らかに追従)
  respawnIn = 0;
  eyeHeight = EYE_STAND;
  lean = 0; // 滑らかに追従した現在値
  // 1フレーム単位の演出フック。matchが update 後に読み取って消費する
  landImpact = 0; // 着地した落下速度(無ければ0)
  justBoosted = false; // スラスト/スライド/壁ジャンプで加速した瞬間
  // matchが制御する一時バフ。アルティメット(オーバードライブ)中に上書きされる
  speedMul = 1; // 水平移動速度の倍率
  damageResist = 0; // 0..1 被ダメージ軽減

  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly vel = new THREE.Vector3();
  private velY = 0;
  private sinceGrounded = 99;
  private jumpBuffered = 0;
  private sinceDamage = 99;
  private stepDistance = 0;
  private slideTimer = 0;
  private slideCooldown = 0;
  private readonly slideDir = new THREE.Vector3();
  private airJumpsLeft = AIR_JUMPS;
  private wallRunTimer = 0;
  private wallRunCooldown = 0;
  private wallRunSide = 1; // 壁が右なら+1、左なら-1
  private readonly wallNormal = new THREE.Vector3(); // 壁から離れる向き(水平・正規化)
  private mantleTimer = 0;
  private readonly mantleFrom = new THREE.Vector3();
  private readonly mantleTo = new THREE.Vector3();
  private diving = false; // ダイブスラム降下中(ジャンプで解除=スラム不発)
  private diveLanded = false; // ダイブのまま着地した(matchが消費してスラム発火)
  // ミッション・モディファイアで上書きする個体設定(既定は従来定数)
  private readonly regenDelay: number;
  private readonly regenPerS: number;
  private readonly gravityScale: number;

  constructor(
    world: RAPIER.World,
    spawn: THREE.Vector3,
    opts?: { regenDelay?: number; regenPerS?: number; gravityScale?: number },
  ) {
    this.world = world;
    this.regenDelay = opts?.regenDelay ?? REGEN_DELAY;
    this.regenPerS = opts?.regenPerS ?? REGEN_PER_SECOND;
    this.gravityScale = opts?.gravityScale ?? 1;
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
    return Math.min(1, this.speed / SPRINT_SPEED);
  }

  // 現在の水平速度(m/s)
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  // 速度に応じたFOVキック量 0..1(歩き=0、スライド最大速で1)
  get fovSpeedKick01(): number {
    return THREE.MathUtils.clamp((this.speed - WALK_SPEED) / (SLIDE_BOOST - WALK_SPEED), 0, 1);
  }

  update(dt: number, input: MoveInput, adsProgress: number, sounds: SoundKit): void {
    this.landImpact = 0;
    this.justBoosted = false;

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

    this.wallRunCooldown = Math.max(0, this.wallRunCooldown - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // ── スライド開始 / キャンセル ──
    if (
      input.crouchPressed &&
      this.sprinting &&
      this.grounded &&
      !this.sliding &&
      this.slideCooldown <= 0 &&
      this.speed > SLIDE_ENTER_SPEED
    ) {
      this.sliding = true;
      this.slideTimer = 0;
      this.slideDir.copy(this.vel).setY(0).normalize();
      // パワースライド: 開始時に勢いを上乗せする
      const boost = Math.max(this.speed, SLIDE_BOOST);
      this.vel.x = this.slideDir.x * boost;
      this.vel.z = this.slideDir.z * boost;
      sounds.slide();
    } else if (this.sliding && input.crouchPressed) {
      // しゃがみ再入力でスライドキャンセル(再スプリント連係用)
      this.endSlide();
    }

    if (this.sliding) {
      this.slideTimer += dt;
      if (this.slideTimer >= SLIDE_DURATION || !input.crouch || !this.grounded) {
        this.endSlide();
      }
    }

    this.crouching = input.crouch || this.sliding;
    const targetEye = this.sliding ? EYE_SLIDE : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    // リーン: 接地・非スプリント・非スライド・非ウォールランのみ
    const leanTarget =
      this.grounded && !this.sprinting && !this.sliding && !this.wallRunning
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

    // ── ウォールラン判定(開始/継続/終了と壁沿い速度の設定)──
    this.updateWallRun(dt, forward, right, input, sounds);

    // ── 水平移動 ──
    if (this.sliding) {
      const speed = slideSpeedAt(this.slideTimer / SLIDE_DURATION) * this.speedMul;
      this.slideDir.addScaledVector(right, input.x * SLIDE_STEER * dt * 0.1).normalize();
      this.vel.x = this.slideDir.x * speed;
      this.vel.z = this.slideDir.z * speed;
    } else if (this.wallRunning) {
      // 速度は updateWallRun で設定済み
    } else if (this.grounded) {
      // バニーホップ: 着地と同時にジャンプを入力(/直前バッファ)していて十分速ければ、
      // その接地フレームの摩擦(approach)を飛ばして水平運動量を保つ。タイミング技なので
      // 再ジャンプしない通常着地では下のapproach+クランプで自然に減速する
      const bhop = (input.jumpPressed || this.jumpBuffered > 0) && this.speed > WALK_SPEED;
      if (bhop) {
        // 摩擦スキップ(velをそのまま持ち越し)。直後のジャンプ処理で打ち上がる
      } else {
        let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
        speed *= 1 - (1 - ADS_SPEED_FACTOR) * adsProgress;
        speed *= this.speedMul;

        const wish = new THREE.Vector3()
          .addScaledVector(forward, input.z)
          .addScaledVector(right, input.x);
        if (wish.lengthSq() > 1) wish.normalize();
        wish.multiplyScalar(speed);

        this.vel.x = approach(this.vel.x, wish.x, GROUND_ACCEL * dt);
        this.vel.z = approach(this.vel.z, wish.z, GROUND_ACCEL * dt);
        // 地上水平クランプ: スライドキャンセル/ホップ連係で無限加速しないための安全弁
        const sp = Math.hypot(this.vel.x, this.vel.z);
        const groundMax = SPRINT_SPEED * 1.3;
        if (sp > groundMax) {
          const f = groundMax / sp;
          this.vel.x *= f;
          this.vel.z *= f;
        }
      }
    } else {
      // 空中: 運動量を保つ射影式エアアクセル + ソフト上限
      const wishX = forward.x * input.z + right.x * input.x;
      const wishZ = forward.z * input.z + right.z * input.x;
      airAccelerate(this.vel, wishX, wishZ, AIR_WISH_SPEED * this.speedMul, AIR_ACCEL, dt);
      softAirCap(this.vel, dt);
    }

    // ── ジャンプ処理(接地 / スライド / スラスト二段 / 壁蹴り)──
    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    this.jumpBuffered = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffered - dt);
    if (this.grounded) this.airJumpsLeft = AIR_JUMPS;

    // ジャンプ系の入力はダイブを解除する(降下をキャンセルした場合スラムは不発=無コスト連打防止)
    if (input.jumpPressed) this.diving = false;

    if (this.wallRunning && input.jumpPressed) {
      // ウォールジャンプ: 壁を蹴って斜め上へ離脱し、スラストも回復
      this.velY = WALLJUMP_UP;
      this.vel.x += this.wallNormal.x * WALLJUMP_PUSH;
      this.vel.z += this.wallNormal.z * WALLJUMP_PUSH;
      this.endWallRun(WALLRUN_COOLDOWN);
      this.airJumpsLeft = AIR_JUMPS;
      this.jumpBuffered = 0;
      this.justBoosted = true;
      sounds.wallJump();
    } else if (this.jumpBuffered > 0 && this.sinceGrounded < COYOTE_TIME && !this.wallRunning) {
      // 接地ジャンプ。スライド中なら水平運動量を保ったまま打ち上げる(スライドジャンプ)
      const wasSliding = this.sliding;
      this.velY = wasSliding ? SLIDE_JUMP_VELOCITY : JUMP_VELOCITY;
      this.jumpBuffered = 0;
      this.sinceGrounded = COYOTE_TIME;
      if (wasSliding) {
        this.endSlide();
        this.justBoosted = true;
      }
      sounds.footstep(0.5);
    } else if (
      input.jumpPressed &&
      !this.grounded &&
      !this.wallRunning &&
      this.airJumpsLeft > 0 &&
      this.sinceGrounded >= COYOTE_TIME
    ) {
      // スラスト(二段)ジャンプ
      this.velY = THRUST_JUMP_VELOCITY;
      this.airJumpsLeft -= 1;
      this.jumpBuffered = 0;
      this.justBoosted = true;
      sounds.thrust();
    }

    // マントリング: 空中で前進入力しながら正面の壁の縁を掴む(ウォールラン中は無効)
    if (
      !this.grounded &&
      !this.wallRunning &&
      input.z > 0.5 &&
      this.velY < 4 &&
      this.tryMantle(forward)
    ) {
      sounds.mantle();
      return;
    }

    // ── 重力(終端速度でクランプし、奈落落下時の床抜けを防ぐ)──
    // gravityScale はモディファイア(低重力ミッション等)で全体を弱める
    this.velY = applyGravityStep(
      this.velY,
      (this.wallRunning ? WALLRUN_GRAVITY : 1) * this.gravityScale,
      dt,
    );

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

    if (!wasGrounded && this.grounded) {
      if (this.diving) {
        // ダイブスラムの着地: 技としての着地なので自傷落下ダメージは免除。
        // 衝撃波の発火は match が consumeDiveLanded() で読む
        this.diving = false;
        this.diveLanded = true;
      } else if (fallSpeed > FALL_DAMAGE_THRESHOLD) {
        this.takeDamage((fallSpeed - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_MULT);
      }
      if (fallSpeed > 6) this.landImpact = fallSpeed;
      sounds.footstep(Math.min(1, fallSpeed / 8), true); // 着地(歩行のヒール・トゥとは別物)
      this.airJumpsLeft = AIR_JUMPS;
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

    // ウォールランの視点ロールを滑らかに追従させる(壁側へ傾ける)
    const tiltTarget = this.wallRunning ? -this.wallRunSide : 0;
    this.wallRunTilt += (tiltTarget - this.wallRunTilt) * Math.min(1, dt * WALLRUN_TILT_SPEED);
    if (Math.abs(this.wallRunTilt) < 0.01 && tiltTarget === 0) this.wallRunTilt = 0;

    this.sinceDamage += dt;
    if (this.regenPerS > 0 && this.sinceDamage > this.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenPerS * dt);
    }
  }

  // ダイブスラム(素手技): 空中から終端速度で急降下する。着地判定・衝撃波はmatch側。
  // MAX_FALL_SPEEDに揃えることで床抜け安全性(1フレーム変位<=床半厚)を保つ。
  // 戻り値=降下を開始したか。降下中フラグはジャンプでキャンセルされ(=スラム不発)、
  // 着地で diveLanded に変換される(matchが consumeDiveLanded で1回だけ読む)
  forceDive(): boolean {
    if (!this.alive || this.grounded || this.mantling) return false;
    this.endWallRun(0);
    this.velY = -MAX_FALL_SPEED;
    this.diving = true;
    return true;
  }

  // ダイブ着地の消費読み取り(スラム発火はこの1回のみ)
  consumeDiveLanded(): boolean {
    const v = this.diveLanded;
    this.diveLanded = false;
    return v;
  }

  // スライド終了。十分に速ければクールダウン0で即連係可(スライドキャンセル・チェーン)。
  // force=true は死亡/マントル等の確実な終了で、通常クールダウンを課す。
  endSlide(force = false): void {
    this.sliding = false;
    this.slideCooldown = !force && this.speed > SLIDE_BOOST * 0.85 ? 0 : SLIDE_COOLDOWN;
  }

  // ウォールランの開始・継続・終了。継続中は壁沿いの速度を設定する
  private updateWallRun(
    dt: number,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    input: MoveInput,
    sounds: SoundKit,
  ): void {
    if (this.wallRunning) {
      this.wallRunTimer += dt;
      const probe = this.wallProbe(right, this.wallRunSide);
      if (this.wallRunTimer >= WALLRUN_DURATION || this.grounded || input.z < 0.2 || probe === null) {
        this.endWallRun(WALLRUN_COOLDOWN);
        return;
      }
      this.wallNormal.copy(probe);
      // 壁面に沿う方向 = 前方ベクトルを壁平面へ射影
      const along = forward.clone().addScaledVector(this.wallNormal, -forward.dot(this.wallNormal));
      if (along.lengthSq() < 1e-4) {
        this.endWallRun(WALLRUN_COOLDOWN);
        return;
      }
      along.normalize();
      this.vel.x = along.x * WALLRUN_SPEED - this.wallNormal.x * WALLRUN_STICK;
      this.vel.z = along.z * WALLRUN_SPEED - this.wallNormal.z * WALLRUN_STICK;
      if (this.velY < -WALLRUN_FALL_CAP) this.velY = -WALLRUN_FALL_CAP;
      return;
    }

    // 開始判定: 空中・前進中・十分な水平速度・上昇中でない・クールダウン明け
    if (
      this.grounded ||
      this.wallRunCooldown > 0 ||
      input.z < 0.4 ||
      this.speed < WALLRUN_MIN_SPEED ||
      this.velY > 3
    ) {
      return;
    }
    for (const side of [1, -1] as const) {
      const normal = this.wallProbe(right, side);
      if (!normal) continue;
      this.wallRunning = true;
      this.wallRunSide = side;
      this.wallRunTimer = 0;
      this.wallNormal.copy(normal);
      this.airJumpsLeft = AIR_JUMPS; // 壁に取り付くとスラストが回復する
      if (this.velY < 0) this.velY = 0; // 取り付き時に落下を止める
      sounds.wallRun();
      return;
    }
  }

  // 指定側に近接する垂直な壁の法線(水平・正規化)。無ければnull
  private wallProbe(right: THREE.Vector3, side: number): THREE.Vector3 | null {
    const dir = right.clone().multiplyScalar(side);
    const hit = this.castRayNormal(this.position, dir, CAPSULE_RADIUS + WALLRUN_DETECT);
    if (hit === null) return null;
    if (Math.abs(hit.normal.y) > 0.4) return null; // 床・天井は除外
    return hit.normal.setY(0).normalize();
  }

  private endWallRun(cooldown: number): void {
    this.wallRunning = false;
    this.wallRunCooldown = cooldown;
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
    // マントル中は早期returnでバッファ減衰が止まるため、ここで消費しておく。
    // さもないと登り切った瞬間に持ち越したジャンプが暴発する
    this.jumpBuffered = 0;
    this.endSlide();
    this.endWallRun(0);
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
      this.airJumpsLeft = AIR_JUMPS;
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

  private castRayNormal(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxToi: number,
  ): { toi: number; normal: THREE.Vector3 } | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    );
    if (hit === null) return null;
    const h = hit as unknown as {
      toi?: number;
      timeOfImpact?: number;
      normal: { x: number; y: number; z: number };
    };
    return {
      toi: h.toi ?? h.timeOfImpact ?? 0,
      normal: new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z),
    };
  }

  // diedをtrueで返す
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    amount *= 1 - this.damageResist;
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
      this.wallRunning = false;
      this.wallRunTilt = 0;
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
    this.wallRunning = false;
    this.wallRunTilt = 0;
    this.wallRunCooldown = 0;
    this.slideCooldown = 0;
    this.airJumpsLeft = AIR_JUMPS;
    this.sinceGrounded = 99;
    this.jumpBuffered = 0;
    this.lean = 0;
    this.landImpact = 0;
    this.justBoosted = false;
    this.diving = false;
    this.diveLanded = false;
    this.speedMul = 1;
    this.damageResist = 0;
    // 死亡時の姿勢(スライド/しゃがみ)を持ち越して視点が湧き直後に
    // 伸び上がらないよう、視点高と移動状態も初期化する
    this.eyeHeight = EYE_STAND;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = false;
    this.stepDistance = 0;
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

// 重力を1ステップ適用し、下向き終端速度 MAX_FALL_SPEED でクランプする。
// 長距離落下でも 1フレーム変位(|velY|/60)が床厚を超えずトンネリングしないための安全装置。
export function applyGravityStep(velY: number, gravityScale: number, dt: number): number {
  const v = velY - GRAVITY * gravityScale * dt;
  return v < -MAX_FALL_SPEED ? -MAX_FALL_SPEED : v;
}

// スライド速度カーブ。t=0で最大、t=1で終端速度へ線形に落ちる
export function slideSpeedAt(t01: number): number {
  const t = THREE.MathUtils.clamp(t01, 0, 1);
  return SLIDE_BOOST + (SLIDE_MIN_SPEED - SLIDE_BOOST) * t;
}

// Quake系の射影エアアクセル。見ている方向の速度成分だけを wishSpeed まで加速し、
// 直交方向の運動量は保つ。これによりストレイフでの加速と運動量維持が両立する。
export function airAccelerate(
  vel: THREE.Vector3,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  const len = Math.hypot(wishX, wishZ);
  if (len < 1e-4) return;
  const dx = wishX / len;
  const dz = wishZ / len;
  const current = vel.x * dx + vel.z * dz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * wishSpeed * dt, add);
  vel.x += dx * accelSpeed;
  vel.z += dz * accelSpeed;
}

// 水平速度がソフト上限を超えたぶんだけゆるく引き戻す(ストレイフ蓄積の暴走防止)
export function softAirCap(vel: THREE.Vector3, dt: number): void {
  const sp = Math.hypot(vel.x, vel.z);
  if (sp <= AIR_MAX_SPEED) return;
  const target = Math.max(AIR_MAX_SPEED, sp - (sp - AIR_MAX_SPEED) * AIR_DRAG * dt);
  const f = target / sp;
  vel.x *= f;
  vel.z *= f;
}
