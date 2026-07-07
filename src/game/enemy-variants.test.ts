import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot, DIFFICULTY, KIND_TUNING, tuningFor } from './bot';
import { applyHellTuning } from './match';

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0),
    floor,
  );
  return world;
}

describe('達人 (master) ボット', () => {
  it('KIND_TUNING.master が定義されている', () => {
    expect(KIND_TUNING.master).toBeDefined();
    expect(KIND_TUNING.master!.maxHp).toBe(600);
    expect(KIND_TUNING.master!.moveSpeedMul).toBe(2.5);
  });

  it('master ボットが生成でき正しいHPを持つ', () => {
    const world = makeWorld();
    const tuning = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.master };
    const bot = new Bot(world, '達人', new THREE.Vector3(0, 0, 0), 0x101010, tuning, 1, 'normal', 'master');
    expect(bot.maxHp).toBe(600);
    world.removeRigidBody(bot.body);
  });
});

describe('巨躯 (giant) ボット', () => {
  it('KIND_TUNING.giant が定義されている', () => {
    expect(KIND_TUNING.giant).toBeDefined();
    expect(KIND_TUNING.giant!.maxHp).toBe(1500);
    expect(KIND_TUNING.giant!.moveSpeedMul).toBe(1.6);
  });

  it('giant ボットが生成でき大きいコライダーを持つ', () => {
    const world = makeWorld();
    const tuning = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.giant };
    const bot = new Bot(world, '巨躯', new THREE.Vector3(0, 0, 0), 0x884400, tuning, 1, 'normal', 'giant');
    world.step();
    const capsule = bot.bodyCollider.shape as RAPIER.Capsule;
    expect(capsule.halfHeight).toBeGreaterThan(0.45);
    world.removeRigidBody(bot.body);
  });
});

describe('DIFFICULTY 速度係数 (×2)', () => {
  it('easy moveSpeedMul は 2', () => {
    expect(DIFFICULTY.easy.moveSpeedMul).toBe(2);
  });
  it('normal moveSpeedMul は 2', () => {
    expect(DIFFICULTY.normal.moveSpeedMul).toBe(2);
  });
  it('hard moveSpeedMul は 2', () => {
    expect(DIFFICULTY.hard.moveSpeedMul).toBe(2);
  });
});

describe('超鬼畜 (hell) チューニング倍率', () => {
  it('HP×3 / ダメージ×2.5 / 速度×1.3(1.75 cap) を適用する', () => {
    const base = tuningFor('normal', 'normal'); // maxHp100 / damage11 / moveSpeedMul2
    const hell = applyHellTuning(base);
    expect(hell.maxHp).toBe(300);
    expect(hell.damage).toBe(Math.round(11 * 2.5));
    // V36: capは基礎速度未満に落とさない(2×1.3=2.6→cap1.75<基礎2 → 基礎2を維持)
    expect(hell.moveSpeedMul).toBeCloseTo(2);
  });

  it('元のチューニングを破壊しない(新オブジェクトを返す)', () => {
    const base = tuningFor('normal', 'normal');
    const hpBefore = base.maxHp;
    applyHellTuning(base);
    expect(base.maxHp).toBe(hpBefore);
  });

  it('KIND_TUNING合成後の達人へ適用すると 600→1800 になる', () => {
    const merged = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.master };
    const hell = applyHellTuning(merged);
    expect(hell.maxHp).toBe(1800);
    expect(hell.moveSpeedMul).toBeCloseTo(2.5); // V36: 達人の基礎2.5は落とさない(鈍足化回帰の防止)
  });

  it('KIND_TUNING合成後の巨躯へ適用すると 1500→4500 になる', () => {
    const merged = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.giant };
    const hell = applyHellTuning(merged);
    expect(hell.maxHp).toBe(4500);
    expect(hell.damage).toBe(Math.round(45 * 2.5));
    expect(hell.moveSpeedMul).toBeCloseTo(1.75); // ★7: 1.6×1.3=2.08 → cap 1.75
  });

  it('★7 capは低速kindには効かない(1.3倍がcap未満ならそのまま)', () => {
    const merged = { ...tuningFor('normal', 'normal'), moveSpeedMul: 0.9 };
    const hell = applyHellTuning(merged);
    expect(hell.moveSpeedMul).toBeCloseTo(0.9 * 1.3); // 1.17 < 1.75
  });
});
