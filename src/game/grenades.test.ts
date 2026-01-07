import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  explosionDamage,
  flashIntensity,
  GRENADE_SPECS,
  GrenadeProjectile,
  type SurfaceRaycast,
  trajectoryPoints,
} from './grenades';

// y=0の無限平面だけがある世界
const flatGround: SurfaceRaycast = (origin, dir, maxDist) => {
  if (dir.y >= 0) return null;
  const t = origin.y / -dir.y;
  if (t < 0 || t > maxDist) return null;
  return { distance: t, normal: { x: 0, y: 1, z: 0 } };
};

const noWalls: SurfaceRaycast = () => null;

function simulate(projectile: GrenadeProjectile, raycast: SurfaceRaycast, maxS: number): number {
  const dt = 1 / 60;
  for (let t = 0; t < maxS; t += dt) {
    if (projectile.update(dt, raycast)) return t + dt;
  }
  return Infinity;
}

describe('GrenadeProjectile', () => {
  it('ヒューズ時間で起爆する', () => {
    const spec = GRENADE_SPECS.frag;
    const projectile = new GrenadeProjectile(
      spec,
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(5, 4, 0),
    );
    const explodedAt = simulate(projectile, flatGround, 10);
    expect(explodedAt).toBeGreaterThan(spec.fuseS - 0.1);
    expect(explodedAt).toBeLessThan(spec.fuseS + 0.1);
  });

  it('クッキングした分だけ早く起爆する', () => {
    const spec = GRENADE_SPECS.frag;
    const cooked = new GrenadeProjectile(
      spec,
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(5, 4, 0),
      2.5,
    );
    const explodedAt = simulate(cooked, flatGround, 10);
    expect(explodedAt).toBeLessThan(spec.fuseS - 2.3);
  });

  it('地面で跳ねて減速し、やがて静止する', () => {
    const projectile = new GrenadeProjectile(
      GRENADE_SPECS.smoke,
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(6, 0, 0),
    );
    projectile.fuseRemainingS = Infinity;
    let bounces = 0;
    for (let i = 0; i < 600 && !projectile.resting; i += 1) {
      projectile.update(1 / 60, flatGround);
      if (projectile.bounced) bounces += 1;
    }
    expect(bounces).toBeGreaterThan(0);
    expect(projectile.resting).toBe(true);
    expect(projectile.position.y).toBeLessThan(0.3);
    expect(projectile.position.x).toBeGreaterThan(0);
  });

  it('遮蔽がなければ放物線を描いて落ち続ける', () => {
    const projectile = new GrenadeProjectile(
      GRENADE_SPECS.frag,
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(10, 5, 0),
    );
    projectile.fuseRemainingS = Infinity;
    for (let i = 0; i < 180; i += 1) projectile.update(1 / 60, noWalls);
    expect(projectile.position.x).toBeGreaterThan(20);
    expect(projectile.position.y).toBeLessThan(-10);
  });
});

describe('trajectoryPoints', () => {
  it('点列は始点から始まり前方へ伸びる', () => {
    const points = trajectoryPoints(
      GRENADE_SPECS.frag,
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(0, 3, -12),
      flatGround,
    );
    expect(points.length).toBeGreaterThan(10);
    expect(points[0]!.distanceTo(new THREE.Vector3(0, 1.6, 0))).toBeLessThan(1e-9);
    const last = points.at(-1)!;
    expect(last.z).toBeLessThan(-3);
  });

  it('同じ入力なら同じ軌道になる', () => {
    const origin = new THREE.Vector3(1, 1.5, 2);
    const velocity = new THREE.Vector3(4, 6, -8);
    const a = trajectoryPoints(GRENADE_SPECS.smoke, origin, velocity, flatGround);
    const b = trajectoryPoints(GRENADE_SPECS.smoke, origin, velocity, flatGround);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.distanceTo(b[i]!)).toBeLessThan(1e-9);
    }
  });
});

describe('explosionDamage', () => {
  const spec = GRENADE_SPECS.frag;

  it('至近距離は満額、半径の外は0', () => {
    expect(explosionDamage(spec, 0)).toBe(spec.maxDamage);
    expect(explosionDamage(spec, spec.radius)).toBe(0);
    expect(explosionDamage(spec, spec.radius + 5)).toBe(0);
  });

  it('距離に応じて単調減少する', () => {
    const near = explosionDamage(spec, spec.radius * 0.4);
    const far = explosionDamage(spec, spec.radius * 0.8);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
});

describe('flashIntensity', () => {
  it('遮蔽されていれば効果なし', () => {
    expect(flashIntensity(3, 14, 1, true)).toBe(0);
  });

  it('正面で見るほど強い', () => {
    const facing = flashIntensity(5, 14, 1, false);
    const side = flashIntensity(5, 14, 0, false);
    const behind = flashIntensity(5, 14, -1, false);
    expect(facing).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(behind);
    expect(behind).toBeGreaterThan(0);
  });

  it('半径の外は0', () => {
    expect(flashIntensity(15, 14, 1, false)).toBe(0);
  });
});
