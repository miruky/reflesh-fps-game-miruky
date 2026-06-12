import * as THREE from 'three';

export type GrenadeKind = 'frag' | 'smoke' | 'flash' | 'incendiary';

export interface GrenadeSpec {
  kind: GrenadeKind;
  name: string;
  // 投げた瞬間からの起爆秒数。クッキングで短縮される
  fuseS: number;
  cookable: boolean;
  throwSpeed: number;
  radius: number;
  // フラグは即時ダメージ、焼夷は秒間ダメージとして使う
  maxDamage: number;
  // スモークの滞留・フラッシュの最大効果・焼夷の燃焼の持続秒数
  effectDurationS: number;
  color: number;
  carry: number;
}

export const GRENADE_SPECS: Record<GrenadeKind, GrenadeSpec> = {
  frag: {
    kind: 'frag',
    name: 'フラグ',
    fuseS: 4.0,
    cookable: true,
    throwSpeed: 17,
    radius: 7.5,
    maxDamage: 125,
    effectDurationS: 0,
    color: 0x4a5240,
    carry: 2,
  },
  smoke: {
    kind: 'smoke',
    name: 'スモーク',
    fuseS: 2.0,
    cookable: false,
    throwSpeed: 15,
    radius: 5.5,
    maxDamage: 0,
    effectDurationS: 12,
    color: 0x8d96a4,
    carry: 2,
  },
  flash: {
    kind: 'flash',
    name: 'フラッシュ',
    fuseS: 1.6,
    cookable: false,
    throwSpeed: 19,
    radius: 14,
    maxDamage: 0,
    effectDurationS: 3.2,
    color: 0xdfe5ee,
    carry: 2,
  },
  incendiary: {
    kind: 'incendiary',
    name: '焼夷',
    fuseS: 2.2,
    cookable: false,
    throwSpeed: 14,
    radius: 3.6,
    maxDamage: 22,
    effectDurationS: 8,
    color: 0xd9622b,
    carry: 1,
  },
};

export const GRENADE_KINDS: GrenadeKind[] = ['frag', 'smoke', 'flash', 'incendiary'];

export interface SurfaceHit {
  distance: number;
  normal: { x: number; y: number; z: number };
}

// 物理エンジンへの依存を切るための注入点。matchがRapierで実装する
export type SurfaceRaycast = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
) => SurfaceHit | null;

const GRAVITY = 18;
const BODY_RADIUS = 0.09;
const RESTITUTION = 0.32;
const TANGENT_DAMPING = 0.72;
const REST_SPEED = 1.1;

export class GrenadeProjectile {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  fuseRemainingS: number;
  resting = false;
  // 直近のupdateで跳ねたか。バウンド音の再生判定に使う
  bounced = false;

  constructor(
    readonly spec: GrenadeSpec,
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    cookedS = 0,
  ) {
    this.position = origin.clone();
    this.velocity = velocity.clone();
    this.fuseRemainingS = Math.max(0.05, spec.fuseS - cookedS);
  }

  // trueを返したら起爆。位置はpositionを参照する
  update(dt: number, raycast: SurfaceRaycast): boolean {
    this.bounced = false;
    this.fuseRemainingS -= dt;
    if (this.fuseRemainingS <= 0) return true;
    if (this.resting) return false;

    this.velocity.y -= GRAVITY * dt;
    const step = this.velocity.length() * dt;
    if (step <= 1e-6) return false;

    const dir = this.velocity.clone().normalize();
    const hit = raycast(this.position, dir, step + BODY_RADIUS);
    if (!hit || hit.distance > step + BODY_RADIUS) {
      this.position.addScaledVector(dir, step);
      return false;
    }

    this.position.addScaledVector(dir, Math.max(0, hit.distance - BODY_RADIUS));
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    const normalSpeed = this.velocity.dot(normal);
    const vn = normal.clone().multiplyScalar(normalSpeed);
    const vt = this.velocity.clone().sub(vn);
    this.velocity
      .copy(vt.multiplyScalar(TANGENT_DAMPING))
      .addScaledVector(normal, -normalSpeed * RESTITUTION);
    this.bounced = true;

    // 上向きの面で十分減速したら転がりを止める
    if (this.velocity.length() < REST_SPEED && normal.y > 0.5) {
      this.resting = true;
      this.velocity.set(0, 0, 0);
    }
    return false;
  }
}

// 投擲軌道のプレビュー点列。バウンドも含めて実弾と同じ物理で計算する
export function trajectoryPoints(
  spec: GrenadeSpec,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  raycast: SurfaceRaycast,
  durationS = 2.2,
  stepS = 1 / 30,
): THREE.Vector3[] {
  const probe = new GrenadeProjectile(spec, origin, velocity, 0);
  probe.fuseRemainingS = Infinity;
  const points: THREE.Vector3[] = [origin.clone()];
  const steps = Math.ceil(durationS / stepS);
  for (let i = 0; i < steps; i += 1) {
    probe.update(stepS, raycast);
    points.push(probe.position.clone());
    if (probe.resting) break;
  }
  return points;
}

// 中心から半径25%までは満額、以降は半径まで線形減衰
export function explosionDamage(spec: GrenadeSpec, distance: number): number {
  if (distance >= spec.radius) return 0;
  const inner = spec.radius * 0.25;
  if (distance <= inner) return spec.maxDamage;
  return spec.maxDamage * (1 - (distance - inner) / (spec.radius - inner));
}

// 視線が遮られていれば0。正面で食らうほど強く、背面でも近距離なら多少は効く
export function flashIntensity(
  distance: number,
  radius: number,
  viewDot: number,
  occluded: boolean,
): number {
  if (occluded || distance >= radius) return 0;
  const proximity = 1 - (distance / radius) * 0.55;
  const facing = 0.3 + 0.7 * ((viewDot + 1) / 2);
  return Math.min(1, proximity * facing);
}
