import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot, DIFFICULTY, KIND_TUNING, tuningFor } from './bot';
import { applyHellTierTuning, applyHellTuning, resolveNaturalBotKind } from './match';
import { zombieBossHp } from './zombie';

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
  it('KIND_TUNING.master が定義されている(R59②: HPは一般兵100の2倍=200)', () => {
    expect(KIND_TUNING.master).toBeDefined();
    expect(KIND_TUNING.master!.maxHp).toBe(200);
    expect(KIND_TUNING.master!.moveSpeedMul).toBe(2.5);
  });

  it('R59②: 達人HPは一般兵のちょうど2倍(全難度でbase=100)', () => {
    expect(DIFFICULTY.easy.maxHp).toBe(100);
    expect(DIFFICULTY.normal.maxHp).toBe(100);
    expect(DIFFICULTY.hard.maxHp).toBe(100);
    expect(KIND_TUNING.master!.maxHp).toBe(DIFFICULTY.normal.maxHp * 2);
  });

  it('master ボットが生成でき正しいHPを持つ', () => {
    const world = makeWorld();
    const tuning = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.master };
    const bot = new Bot(world, '達人', new THREE.Vector3(0, 0, 0), 0x101010, tuning, 1, 'normal', 'master');
    expect(bot.maxHp).toBe(200);
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

  it('KIND_TUNING合成後の達人へ適用すると 200→600 になる(R59②: 基礎200へ変更)', () => {
    const merged = { ...tuningFor('normal', 'normal'), ...KIND_TUNING.master };
    const hell = applyHellTuning(merged);
    expect(hell.maxHp).toBe(600);
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

describe('T1: 超鬼畜×ボスのHP壁修正(applyHellTierTuning)', () => {
  it('r50(tier=10)のボスHPは80,000上限にちょうど到達する(zombieBossHp単体の前提確認)', () => {
    expect(zombieBossHp(50)).toBe(80000);
  });

  it('boss tierはhellのHP倍率対象外 → r50×hellでも80,000のまま(240,000へ突破しない)', () => {
    const hp = zombieBossHp(50); // 80000
    const merged = { ...tuningFor('normal', 'normal'), maxHp: hp, damage: 90, moveSpeedMul: 1.44 * 2.0 };
    const tuned = applyHellTierTuning(merged, 'boss', 'zombie');
    expect(tuned.maxHp).toBe(80000);
  });

  it('boss tierでも damage/speedは素の applyHellTuning と同じ値を維持する(HPだけが例外)', () => {
    const merged = { ...tuningFor('normal', 'normal'), maxHp: 80000, damage: 90, moveSpeedMul: 1.44 * 2.0 };
    const plainHell = applyHellTuning(merged);
    const tuned = applyHellTierTuning(merged, 'boss', 'zombie');
    expect(tuned.damage).toBe(plainHell.damage); // damage×2.5は維持
    expect(tuned.moveSpeedMul).toBe(plainHell.moveSpeedMul); // speed倍率も維持
    expect(tuned.maxHp).not.toBe(plainHell.maxHp); // HPだけがboss tierで例外的にhell倍率を受けない
    expect(tuned.maxHp).toBe(merged.maxHp);
  });

  it('boss以外のtierは従来どおりHP×3が適用される(回帰確認)', () => {
    const merged = { ...tuningFor('normal', 'normal'), maxHp: 1000 };
    expect(applyHellTierTuning(merged, 'normal', 'zombie').maxHp).toBe(3000);
    expect(applyHellTierTuning(merged, 'elite', 'zombie').maxHp).toBe(3000);
  });

  it('非ゾンビのboss(戦車/章ボス等)は従来どおりHP×3を受ける(V-W1: 除外はゾンビboss限定)', () => {
    // HP除外を kind 非依存にすると、hellで戦車ボスが従来(6600)より柔らかい2200になる回帰
    const merged = { ...tuningFor('boss', 'normal'), maxHp: 2200 };
    expect(applyHellTierTuning(merged, 'boss', 'tank').maxHp).toBe(6600);
    expect(applyHellTierTuning(merged, 'boss', 'humanoid').maxHp).toBe(6600);
  });
});

describe('resolveNaturalBotKind (R51 ユーザー⑥: 個人戦の達人/巨躯自然湧き除外)', () => {
  it('allGiantMode ON: teamBased/hellMode/rand を問わず常に giant', () => {
    expect(resolveNaturalBotKind(() => 0.99, false, false, true)).toBe('giant');
    expect(resolveNaturalBotKind(() => 0.99, true, true, true)).toBe('giant');
  });

  it('hellMode ON かつ個人戦(teamBased=false): 30%/35%の自然湧きが従来どおり作動する', () => {
    expect(resolveNaturalBotKind(() => 0.1, false, true, false)).toBe('master'); // <0.30
    expect(resolveNaturalBotKind(() => 0.32, false, true, false)).toBe('giant'); // <0.35
    expect(resolveNaturalBotKind(() => 0.9, false, true, false)).toBe('humanoid');
  });

  it('hellMode ON かつチーム戦(teamBased=true): 同じ30%/35%(teamBasedでレート変化なし)', () => {
    expect(resolveNaturalBotKind(() => 0.1, true, true, false)).toBe('master');
    expect(resolveNaturalBotKind(() => 0.32, true, true, false)).toBe('giant');
  });

  it('トグルOFF(hell/allGiantとも false) かつ個人戦: randを消費せず常に humanoid(自然湧きゼロ)', () => {
    let calls = 0;
    const rand = () => { calls += 1; return 0.01; }; // 0.01 は本来 master 判定に入る値
    expect(resolveNaturalBotKind(rand, false, false, false)).toBe('humanoid');
    expect(calls).toBe(0); // 個人戦はrandを呼ばずゼロ確定(監査で数値レートを追跡不要にする意図)
  });

  it('トグルOFF かつチーム戦: 8%/13%の自然湧きが従来どおり作動する', () => {
    expect(resolveNaturalBotKind(() => 0.05, true, false, false)).toBe('master'); // <0.08
    expect(resolveNaturalBotKind(() => 0.10, true, false, false)).toBe('giant'); // <0.13
    expect(resolveNaturalBotKind(() => 0.5, true, false, false)).toBe('humanoid');
  });
});
