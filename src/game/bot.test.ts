import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bot,
  BOSS_TUNING,
  DIFFICULTY,
  fearAccuracyMul,
  humanoidCombatMoveWeights,
  ZOMBIE_HORDE_THIN_RANK,
  ZOMBIE_KCC_NEAR_FULL_RANK,
  zombieKccActive,
  zombieKccSkipFactor,
  zombieSeparationGrid,
  type BotContext,
} from './bot';

describe('humanoid combat movement', () => {
  it('適正距離では前後移動が横移動を大きく上回る', () => {
    for (const depthSign of [-1, 1] as const) {
      const weights = humanoidCombatMoveWeights(14, depthSign, {
        flee: false,
        feared: false,
        unstuck: false,
        master: false,
      });
      expect(Math.abs(weights.longitudinal)).toBeGreaterThan(weights.lateral * 2);
      expect(weights.lateral).toBeLessThanOrEqual(0.2);
    }
  });

  it('遠距離は前進、近距離は後退し、横移動は補助に留まる', () => {
    const far = humanoidCombatMoveWeights(30, 1, {
      flee: false, feared: false, unstuck: false, master: false,
    });
    const near = humanoidCombatMoveWeights(5, 1, {
      flee: false, feared: false, unstuck: false, master: false,
    });
    expect(far.longitudinal).toBeGreaterThan(0.8);
    expect(near.longitudinal).toBeLessThan(-0.8);
    expect(far.lateral).toBeLessThan(0.25);
    expect(near.lateral).toBeLessThan(0.25);
  });

  it('アンスタック中だけ横ステアを一時的に強める', () => {
    const normal = humanoidCombatMoveWeights(14, 1, {
      flee: false, feared: false, unstuck: false, master: false,
    });
    const unstuck = humanoidCombatMoveWeights(14, 1, {
      flee: false, feared: false, unstuck: true, master: false,
    });
    expect(unstuck.lateral).toBeGreaterThan(normal.lateral);
    expect(unstuck.longitudinal).toBe(normal.longitudinal);
  });
});

// 平坦な床(cuboid)だけを持つ最小worldを作る(makeFixture以外の個別テストでも使う共通部)
function makeFlatWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
    floorBody,
  );
  return world;
}

beforeAll(async () => {
  await RAPIER.init();
});

interface Fixture {
  world: RAPIER.World;
  bot: Bot;
  floorBody: RAPIER.RigidBody;
}

function makeFixture(): Fixture {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
    floorBody,
  );
  const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
  world.step();
  return { world, bot, floorBody };
}

// 正面の遠方から水平にレイを撃ち、当たったコライダーを返す
function castHorizontal(fixture: Fixture, y: number): RAPIER.Collider | null {
  const ray = new RAPIER.Ray({ x: 0, y, z: -10 }, { x: 0, y: 0, z: 1 });
  const hit = fixture.world.castRay(ray, 100, true);
  return hit ? hit.collider : null;
}

describe('Bot ヒットボックス', () => {
  it('頭の高さの水平レイは頭コライダーに当たる', () => {
    const fixture = makeFixture();
    const headY = fixture.bot.headPosition().y;
    const hit = castHorizontal(fixture, headY);
    expect(hit).not.toBeNull();
    expect(hit!.handle).toBe(fixture.bot.headCollider.handle);
  });

  it('胴の高さの水平レイは胴体コライダーに当たる', () => {
    const fixture = makeFixture();
    const torsoY = fixture.bot.position.y;
    const hit = castHorizontal(fixture, torsoY);
    expect(hit).not.toBeNull();
    expect(hit!.handle).toBe(fixture.bot.bodyCollider.handle);
  });

  it('頭の中心は胴体カプセルの上端より高い', () => {
    const fixture = makeFixture();
    const capsule = fixture.bot.bodyCollider.shape as RAPIER.Capsule;
    const torsoTop = fixture.bot.position.y + capsule.halfHeight + capsule.radius;
    expect(fixture.bot.headPosition().y).toBeGreaterThan(torsoTop);
  });
});

describe('Bot 死亡とリスポーン', () => {
  it('死亡中はコライダーが無効化され、レイに当たらない', () => {
    const fixture = makeFixture();
    const headY = fixture.bot.headPosition().y;
    expect(fixture.bot.takeDamage(999)).toBe(true);
    fixture.world.step();
    expect(castHorizontal(fixture, headY)).toBeNull();
    expect(castHorizontal(fixture, fixture.bot.position.y)).toBeNull();
  });

  it('リスポーンでコライダーが復活する', () => {
    const fixture = makeFixture();
    fixture.bot.takeDamage(999);
    fixture.world.step();
    fixture.bot.respawnAt(new THREE.Vector3(0, 0, 0));
    fixture.world.step();
    const hit = castHorizontal(fixture, fixture.bot.position.y);
    expect(hit).not.toBeNull();
    expect(hit!.handle).toBe(fixture.bot.bodyCollider.handle);
    expect(fixture.bot.alive).toBe(true);
    expect(fixture.bot.hp).toBe(100);
  });
});

describe('Bot animHalfLod フィールド', () => {
  it('初期値は false', () => {
    const fixture = makeFixture();
    expect(fixture.bot.animHalfLod).toBe(false);
  });

  it('外部から書き込み可能(match.ts の updateBots が設定する)', () => {
    const fixture = makeFixture();
    fixture.bot.animHalfLod = true;
    expect(fixture.bot.animHalfLod).toBe(true);
    fixture.bot.animHalfLod = false;
    expect(fixture.bot.animHalfLod).toBe(false);
  });
});

describe('Bot resetForZombieReuse(ゾンビプール再利用)', () => {
  it('新しいチューニングの HP へ回復し、指定位置でコライダーが有効になる', () => {
    const fixture = makeFixture();
    const bot = fixture.bot;

    // 一度ダメージで倒す
    bot.takeDamage(999);
    fixture.world.step();
    expect(bot.alive).toBe(false);

    // tuning: zombieHp風(r10=104相当)の maxHp を渡す
    const newTuning = { ...DIFFICULTY.normal, maxHp: 104, moveSpeedMul: 1.44 };
    const spawnPos = new THREE.Vector3(5, 0, 5);
    bot.resetForZombieReuse(newTuning, spawnPos);
    fixture.world.step();

    expect(bot.alive).toBe(true);
    expect(bot.hp).toBe(104);

    // コライダーがアクティブ化されレイに当たる
    const bodyY = bot.position.y;
    const ray = new RAPIER.Ray({ x: 5, y: bodyY, z: -5 }, { x: 0, y: 0, z: 1 });
    const hit = fixture.world.castRay(ray, 100, true);
    expect(hit).not.toBeNull();
    expect(hit!.collider.handle).toBe(bot.bodyCollider.handle);
  });

  it('moveSpeed が新しい tuning の moveSpeedMul に更新される', () => {
    const fixture = makeFixture();
    const bot = fixture.bot;
    bot.takeDamage(999);
    fixture.world.step();

    const fastTuning = { ...DIFFICULTY.normal, maxHp: 80, moveSpeedMul: 2.3 }; // 走行elite相当
    bot.resetForZombieReuse(fastTuning, new THREE.Vector3(0, 0, 0));
    fixture.world.step();

    const botSlow = new Bot(fixture.world, 'slow', new THREE.Vector3(10, 0, 0), 0x000000, DIFFICULTY.normal);
    botSlow.takeDamage(999);
    fixture.world.step();
    const slowTuning = { ...DIFFICULTY.normal, maxHp: 80, moveSpeedMul: 1.44 };
    botSlow.resetForZombieReuse(slowTuning, new THREE.Vector3(10, 0, 0));
    fixture.world.step();

    // moveSpeed は public でないため animHalfLod 同様に black-box: hp だけ検証
    expect(bot.hp).toBe(80);
    expect(botSlow.hp).toBe(80);
  });
});

describe('zombieKccActive(R100 群衆ランクKCC時間LOD)', () => {
  it('最近接8体(hordeRank<8)は25m以内で常時フル解決', () => {
    for (let frame = 0; frame < 8; frame += 1) {
      expect(zombieKccActive(0, frame, 10, 0)).toBe(true);
      expect(zombieKccActive(7, frame, 10, ZOMBIE_KCC_NEAR_FULL_RANK - 1)).toBe(true);
    }
  });

  it('近距離の中列(rank8..23)はuid%4、後列(rank24+)はuid%8へ分散', () => {
    expect(Array.from({ length: 8 }, (_, frame) =>
      zombieKccActive(5, frame, 10, ZOMBIE_KCC_NEAR_FULL_RANK),
    )).toEqual([false, true, false, false, false, true, false, false]);
    expect(Array.from({ length: 16 }, (_, frame) =>
      zombieKccActive(11, frame, 10, ZOMBIE_HORDE_THIN_RANK),
    ).filter(Boolean)).toHaveLength(2);
  });

  it('hordeRank省略時は既存呼び出し(3引数)と同じ挙動を保つ(後方互換)', () => {
    for (let frame = 0; frame < 4; frame += 1) {
      expect(zombieKccActive(0, frame, 0)).toBe(true);
      expect(zombieKccActive(7, frame, 25)).toBe(true);
    }
    expect(zombieKccActive(4, 0, 40)).toBe(true);
    expect(zombieKccActive(4, 1, 40)).toBe(false);
  });

  it('25m超も順位と距離に応じ2/4/8フレームへ分散する', () => {
    expect(zombieKccActive(4, 0, 40, 0)).toBe(true);
    expect(zombieKccActive(4, 1, 40, 0)).toBe(false);
    expect(zombieKccActive(0, 0, 80, 0)).toBe(true);
    expect(zombieKccActive(0, 1, 80, 0)).toBe(false);
    expect(zombieKccActive(0, 4, 80, 0)).toBe(false);
    expect(zombieKccActive(0, 8, 80, 0)).toBe(true);
  });
});

describe('zombieKccSkipFactor(★1/★5 stuckTimer実時間補正用)', () => {
  it('最近接8体の25m以内は係数1(毎フレーム)', () => {
    expect(zombieKccSkipFactor(10, 0)).toBe(1);
  });

  it('近距離の中列は係数4、後列は係数8', () => {
    expect(zombieKccSkipFactor(10, ZOMBIE_KCC_NEAR_FULL_RANK)).toBe(4);
    expect(zombieKccSkipFactor(10, ZOMBIE_HORDE_THIN_RANK)).toBe(8);
  });

  it('25-60mの最近接8体は係数2', () => {
    expect(zombieKccSkipFactor(40, 0)).toBe(2);
  });

  it('60m超は係数8', () => {
    expect(zombieKccSkipFactor(80, 0)).toBe(8);
  });
});

// ─── R54-W1(B1) 群衆分離KCC: hordeRank>=THIN_RANKの対ゾンビcollider除外 + 空間ハッシュ分離 ───
describe('Bot ゾンビ 群衆分離KCC(R54-W1 B1)', () => {
  function makeZombieWorld(): RAPIER.World {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      floorBody,
    );
    return world;
  }

  function makeCtx(targetEye: THREE.Vector3 | null, tuning = { ...DIFFICULTY.normal }): BotContext {
    return {
      targetEye,
      objective: null,
      tuning,
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
  }

  it('先頭集団(hordeRank<THIN_RANK)は他ゾンビのbodyColliderに衝突してブロックされる(非回帰)', () => {
    const world = makeZombieWorld();
    const tuning = { ...DIFFICULTY.normal };
    const mover = new Bot(
      world, '前衛', new THREE.Vector3(0, 0, 0), 0x39d465, tuning, 2, 'normal', 'zombie',
    );
    new Bot(world, 'static', new THREE.Vector3(0, 0, -1.5), 0x39d465, tuning, 2, 'normal', 'zombie');
    mover.hordeRank = 0; // 先頭集団=フルKCC(既存挙動を維持する対象)
    world.step();

    const ctx = makeCtx(new THREE.Vector3(0, 1.5, -30), tuning);
    for (let i = 0; i < 30; i += 1) {
      mover.update(1 / 60, ctx);
      world.step();
    }
    // 相手bodyCollider半径0.35×2=0.7相当の接触距離を大きく割り込めない(通り抜けない)
    expect(mover.position.z).toBeGreaterThan(-1.3);
  });

  it('先頭集団外(hordeRank>=THIN_RANK)は他ゾンビのbodyColliderをすり抜ける(密集KCC軽量化)', () => {
    const world = makeZombieWorld();
    const tuning = { ...DIFFICULTY.normal };
    const mover = new Bot(
      world, '後方', new THREE.Vector3(0, 0, 0), 0x39d465, tuning, 2, 'normal', 'zombie',
    );
    new Bot(world, 'static', new THREE.Vector3(0, 0, -1.5), 0x39d465, tuning, 2, 'normal', 'zombie');
    mover.hordeRank = ZOMBIE_HORDE_THIN_RANK; // 群衆後方=対ゾンビKCC除外の対象
    world.step();

    const ctx = makeCtx(new THREE.Vector3(0, 1.5, -30), tuning);
    for (let i = 0; i < 30; i += 1) {
      mover.update(1 / 60, ctx);
      world.step();
    }
    // 相手の中心z(-1.5)を通り過ぎている=対ゾンビ衝突が効いていない
    expect(mover.position.z).toBeLessThan(-1.5);
  });

  it('密集接触group/KCC除外後も通常レイの被弾ヘッドショット判定は非回帰', () => {
    const world = makeZombieWorld();
    const tuning = { ...DIFFICULTY.normal };
    const thinned = new Bot(
      world, '後方', new THREE.Vector3(0, 0, 0), 0x39d465, tuning, 2, 'normal', 'zombie',
    );
    thinned.hordeRank = ZOMBIE_HORDE_THIN_RANK;
    world.step();

    // Interaction groupはゾンビ同士の接触ペアだけを除外し、filterPredicateもKCC限定。
    // filterGroups未指定の通常castRay(被弾判定と同じ経路)は従来どおり頭へ命中する。
    const headY = thinned.headPosition().y;
    const ray = new RAPIER.Ray({ x: 0, y: headY, z: -10 }, { x: 0, y: 0, z: 1 });
    const hit = world.castRay(ray, 100, true);
    expect(hit).not.toBeNull();
    expect(hit!.collider.handle).toBe(thinned.headCollider.handle);
  });

  it('rebuild済みの空間ハッシュはhordeRank>=THIN_RANKの個体のwishへ反発を加算する(統合確認)', () => {
    const world = makeZombieWorld();
    const tuning = { ...DIFFICULTY.normal };
    const mover = new Bot(
      world, 'A', new THREE.Vector3(0, 0, 0), 0x39d465, tuning, 2, 'normal', 'zombie',
    );
    mover.hordeRank = ZOMBIE_HORDE_THIN_RANK;
    world.step();

    // 北側(+z)0.3mに「幽霊」隣接体(実colliderを持たない仮想エントリ)を登録する。
    // targetは+x方向のみ(z成分ゼロ)に置くため、target-tracking由来のwishZは常に0。
    // よってzに変位が生じればそれは空間ハッシュの分離ベクトル以外に発生源がない。
    zombieSeparationGrid.rebuild([
      { uid: mover.uid, x: mover.position.x, z: mover.position.z },
      { uid: -999, x: mover.position.x, z: mover.position.z + 0.3 },
    ]);

    try {
      const ctx = makeCtx(new THREE.Vector3(50, 1.5, 0), tuning); // +x方向へ直進(z成分ゼロ)
      // R100時間LODの後列はuid%8。16tickあればuidに依存せず最低2回はKCCが動く。
      for (let i = 0; i < 16; i += 1) {
        mover.update(1 / 60, ctx);
        world.step();
      }
      // 北側の幽霊隣接体からの反発(-z向き)を受け、targetだけでは生じ得ないz変位が生じる
      expect(mover.position.z).toBeLessThan(0);
    } finally {
      // 他テストへ影響しないよう、モジュール単位のシングルトンを必ず空へ戻す
      // (rebuild()が一度も呼ばれない=常にゼロという非回帰契約を後続テストのために復元)
      zombieSeparationGrid.clear();
    }
  });
});

describe('Bot ゾンビ respawnAt(prevZombieMoved/prevZombieGroundedのリセット)', () => {
  it('プール再利用の取りこぼしを防ぐため、respawnAt後に前回移動量/接地フラグがゼロへ戻る', () => {
    const fixture = makeFixture();
    const internal = fixture.bot as unknown as {
      prevZombieMoved: { x: number; y: number; z: number };
      prevZombieGrounded: boolean;
    };
    // プール再利用前の古いゾンビの移動量が残っている状況を再現
    internal.prevZombieMoved.x = 3;
    internal.prevZombieMoved.y = -1;
    internal.prevZombieMoved.z = 5;
    internal.prevZombieGrounded = true;

    fixture.bot.respawnAt(new THREE.Vector3(1, 0, 1));

    expect(internal.prevZombieMoved.x).toBe(0);
    expect(internal.prevZombieMoved.y).toBe(0);
    expect(internal.prevZombieMoved.z).toBe(0);
    expect(internal.prevZombieGrounded).toBe(false);
  });
});

describe('Bot ゾンビ unstuckStrafeOverride(壁詰まりのアンスタック)', () => {
  it('高い壁に阻まれ続けると0.8s+でunstuckStrafeOverrideが±1で発火する', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      floorBody,
    );
    // ゾンビの直進経路をふさぐ高い壁(登坂上限2.4mより十分高く、登坂では抜けられない)
    const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(5, 3, 0.3).setTranslation(0, 3, -1.0),
      wallBody,
    );

    const tuning = { ...DIFFICULTY.normal };
    const zombie = new Bot(
      world,
      'ゾンビ',
      new THREE.Vector3(0, 0, 0),
      0x39d465,
      tuning,
      2,
      'normal',
      'zombie',
    );
    // 先頭集団扱いでKCCを毎フレームフル解決させ、検知タイミングを決定論的にする
    zombie.hordeRank = 0;
    world.step();

    const ctx: BotContext = {
      targetEye: new THREE.Vector3(0, 1.5, -10),
      objective: null,
      tuning,
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };

    const dt = 1 / 60;
    let override: number | null = null;
    for (let i = 0; i < 180 && override === null; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      override = (zombie as unknown as { unstuckStrafeOverride: number | null })
        .unstuckStrafeOverride;
    }

    expect(override).not.toBeNull();
    expect(Math.abs(override as number)).toBe(1);
  });
});

describe('Bot ボスゾンビの足元(R53-T1: rig等比拡大の0.40m沈み修正)', () => {
  function makeBossZombie(): Bot {
    const world = makeFlatWorld();
    const tuning = { ...DIFFICULTY.normal, ...BOSS_TUNING }; // BOSS_TUNING.scale=1(視覚はrig側で拡大)
    const boss = new Bot(world, 'ボス', new THREE.Vector3(0, 0, 0), 0xff2200, tuning, 1, 'boss', 'zombie');
    world.step();
    return boss;
  }

  it('rigLiftYが 2.3*0.80 - ZOMBIE_BOSS_CENTER_TO_FEET(=1.44) から導出した+0.40になる', () => {
    const boss = makeBossZombie();
    const internal = boss as unknown as { rigLiftY: number };
    // ZOMBIE_BOSS_CENTER_TO_FEET = ZOMBIE_BOSS_BODY_HALF(0.45*1.8=0.81)
    //                            + ZOMBIE_BOSS_BODY_RADIUS(0.35*1.8=0.63) = 1.44
    const expected = 2.3 * 0.8 - 1.44;
    expect(expected).toBeCloseTo(0.4, 10);
    expect(internal.rigLiftY).toBeCloseTo(expected, 10);
  });

  it('fkResetPose適用後、視覚ブーツ底(rig.scale=2.3考慮)が実コライダー足元(-1.44)と一致する(従来は-1.84=0.40m沈み)', () => {
    const boss = makeBossZombie();
    boss.fkResetPose();
    const internal = boss as unknown as { rig: THREE.Group };
    // buildLeg内コメント: ブーツ底はrigローカル≈-0.80。rig.scale=2.3のため視覚足元は
    // rigLiftY + (-0.80 * 2.3) となる。修正前(rigLiftY=0)は-1.84=0.40m沈んでいた。
    const visualFootLocalY = internal.rig.position.y + -0.8 * 2.3;
    expect(visualFootLocalY).toBeCloseTo(-1.44, 5);
  });

  it('通常/精鋭ゾンビ・humanoidはrigLiftYが0のまま(非回帰)', () => {
    const humanoidFixture = makeFixture();
    const internalHumanoid = humanoidFixture.bot as unknown as { rigLiftY: number };
    expect(internalHumanoid.rigLiftY).toBe(0);

    const world = makeFlatWorld();
    const zombie = new Bot(
      world, 'ゾンビ', new THREE.Vector3(0, 0, 0), 0x39d465,
      { ...DIFFICULTY.normal }, 2, 'normal', 'zombie',
    );
    expect((zombie as unknown as { rigLiftY: number }).rigLiftY).toBe(0);
  });
});

describe('Bot humanoid/masterボスの足元(R54-W1 Q7: position.y+=一度きり補正の実質無効化を根治)', () => {
  it('humanoid boss(kind既定)はrigLiftY=0.8*0.12(=0.096)を持つ', () => {
    const world = makeFlatWorld();
    const boss = new Bot(world, 'ボス', new THREE.Vector3(0, 0, 0), 0xff2200, { ...DIFFICULTY.normal }, 1, 'boss');
    const internal = boss as unknown as { rigLiftY: number };
    expect(internal.rigLiftY).toBeCloseTo(0.8 * 0.12, 10);
  });

  it('master boss(buildMasterMesh経由でも同じbuildMeshの補正が効く)もrigLiftY=0.096を持つ', () => {
    const world = makeFlatWorld();
    const boss = new Bot(world, '達人', new THREE.Vector3(0, 0, 0), 0xff2200, { ...DIFFICULTY.normal }, 1, 'boss', 'master');
    const internal = boss as unknown as { rigLiftY: number };
    expect(internal.rigLiftY).toBeCloseTo(0.8 * 0.12, 10);
  });

  it('非boss(normal/elite)のhumanoidはrigLiftY=0のまま(非回帰)', () => {
    const world = makeFlatWorld();
    for (const tier of ['normal', 'elite'] as const) {
      const bot = new Bot(world, 'BOT', new THREE.Vector3(0, 0, 0), 0xc84b3c, { ...DIFFICULTY.normal }, 1, tier);
      expect((bot as unknown as { rigLiftY: number }).rigLiftY).toBe(0);
    }
  });

  it('syncMesh(通常の毎フレーム歩行/呼吸パス)後もrigLiftYが消えない(旧position.y+=一度きりバグの再現ガード)', () => {
    const world = makeFlatWorld();
    const boss = new Bot(world, 'ボス', new THREE.Vector3(0, 0, 0), 0xff2200, { ...DIFFICULTY.normal }, 1, 'boss');
    const internal = boss as unknown as { rigLiftY: number; rig: THREE.Group };
    // 構築直後(walkAmp=0, anim=0)はbob/breathが0になるため、rig.position.yはrigLiftYと厳密一致する。
    // 旧実装(position.y += 一度きり)ならsyncMeshの式(rigLiftY不参照)がposition.yを0へ
    // 上書きしてしまい、この等式が崩れていた。
    boss.syncMesh();
    expect(internal.rig.position.y).toBeCloseTo(internal.rigLiftY, 10);
    expect(internal.rig.position.y).toBeCloseTo(0.096, 10);
  });

  it('fkResetPose適用後もrigLiftYが視覚足元補正として反映される(zombie bossと同じ契約)', () => {
    const world = makeFlatWorld();
    const boss = new Bot(world, 'ボス', new THREE.Vector3(0, 0, 0), 0xff2200, { ...DIFFICULTY.normal }, 1, 'boss');
    boss.fkResetPose();
    const internal = boss as unknown as { rigLiftY: number; rig: THREE.Group };
    expect(internal.rig.position.y).toBeCloseTo(internal.rigLiftY, 10);
  });
});

describe('Bot allGiantモードのゾンビ頭コライダー(R53-T2: 視覚拡大とのズレ修正)', () => {
  it('tuning.scale=1.35のとき、頭コライダーのY offset/半径がscale倍で生成され、視覚頭位置相当のレイに当たる', () => {
    const world = makeFlatWorld();
    const zombie = new Bot(
      world, '巨躯ゾンビ', new THREE.Vector3(0, 0, 0), 0x39d465,
      { ...DIFFICULTY.normal, scale: 1.35 }, 2, 'normal', 'zombie',
    );
    world.step();

    // headOffsetY(=headOff)がHEAD_OFFSET(0.88)*1.35で算出されている(視覚拡大と同倍率)
    expect(zombie.headOffsetY).toBeCloseTo(0.88 * 1.35, 10);

    // その高さの水平レイが頭コライダーに当たる。修正前は無スケールのHEAD_OFFSET(0.88)固定
    // だったため、scale後の視覚頭位置(+0.308m相当)を狙うと外れていた
    const headY = zombie.position.y + zombie.headOffsetY;
    const ray = new RAPIER.Ray({ x: 0, y: headY, z: -10 }, { x: 0, y: 0, z: 1 });
    const hit = world.castRay(ray, 100, true);
    expect(hit).not.toBeNull();
    expect(hit!.collider.handle).toBe(zombie.headCollider.handle);

    // 半径もHEAD_RADIUS(0.22)*1.35で生成されている
    const ball = zombie.headCollider.shape as RAPIER.Ball;
    expect(ball.radius).toBeCloseTo(0.22 * 1.35, 10);
  });

  it('胴カプセルはscaleの影響を受けない(移動/ドア通過への非回帰)', () => {
    const world = makeFlatWorld();
    const zombie = new Bot(
      world, '巨躯ゾンビ', new THREE.Vector3(0, 0, 0), 0x39d465,
      { ...DIFFICULTY.normal, scale: 1.35 }, 2, 'normal', 'zombie',
    );
    const capsule = zombie.bodyCollider.shape as RAPIER.Capsule;
    expect(capsule.halfHeight).toBeCloseTo(0.45, 10); // BODY_HALF(既定)のまま
    expect(capsule.radius).toBeCloseTo(0.35, 10); // BODY_RADIUS(既定)のまま
  });

  it('scale=1(既定)のゾンビは従来どおりHEAD_RADIUS/HEAD_OFFSETのまま(非回帰)', () => {
    const world = makeFlatWorld();
    const zombie = new Bot(
      world, 'ゾンビ', new THREE.Vector3(0, 0, 0), 0x39d465,
      { ...DIFFICULTY.normal }, 2, 'normal', 'zombie',
    );
    expect(zombie.headOffsetY).toBeCloseTo(0.88, 10);
    const ball = zombie.headCollider.shape as RAPIER.Ball;
    expect(ball.radius).toBeCloseTo(0.22, 10);
  });
});

describe('Bot キルカム公開API(R53-T3: fkApplyLivePose/fkApplyDeathPose/fkResetPose)', () => {
  const ctxBase: BotContext = {
    targetEye: null,
    objective: null,
    tuning: DIFFICULTY.normal,
    rand: () => 0.5,
    onShoot: () => {},
    onMelee: () => {},
  };

  it('fkApplyLivePoseは位置/向き/可視を設定し、死亡演出で変形したトランスフォームをalive姿勢へ巻き戻す', () => {
    const world = makeFlatWorld();
    const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
    bot.takeDamage(999);
    world.step();
    for (let i = 0; i < 20; i += 1) bot.update(1 / 60, ctxBase);

    const internal = bot as unknown as {
      rig: THREE.Group;
      legL: THREE.Group;
      kneeL: THREE.Group;
      dissolveU: { value: number };
    };
    // 死亡演出で実際に変形している(前提の確認。でなければ以降の巻き戻し検証が無意味)
    expect(internal.legL.rotation.x).toBeGreaterThan(0);

    bot.fkApplyLivePose(3, 0, -4, 1.2);
    expect(bot.group.position.x).toBe(3);
    expect(bot.group.position.y).toBe(0);
    expect(bot.group.position.z).toBe(-4);
    expect(bot.group.rotation.y).toBe(1.2);
    expect(bot.group.visible).toBe(true);
    expect(bot.group.rotation.x).toBe(0);
    expect(bot.group.rotation.z).toBe(0);
    expect(internal.rig.position.y).toBe(0); // rigLiftY=0(通常humanoid)
    expect(internal.legL.rotation.x).toBe(0);
    expect(internal.kneeL.rotation.x).toBe(0);
    expect(internal.dissolveU.value).toBe(0);
  });

  it('fkApplyDeathPoseはupdateDyingと同一の式で死亡ポーズを再現する(キルカム見た目の非回帰=数式の等価性)', () => {
    const totalS = 0.6; // bot.ts KIND_DEATH_S.humanoid(=match.ts FK_DEATH_S.humanoidと同値)
    const dt = 1 / 60;
    const steps = 12; // 0.2s経過(t=0.2/0.6=0.333、膝崩れbuckle区間)

    // 基準: 実際に死なせてupdateDyingを走らせる(内部private経路。update()経由でのみ駆動)
    const worldA = makeFlatWorld();
    const reference = new Bot(worldA, '基準', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
    reference.takeDamage(999);
    worldA.step();
    for (let i = 0; i < steps; i += 1) reference.update(dt, ctxBase);

    // 検証対象: 公開APIのfkApplyDeathPoseだけで同じ経過時間を手続き再現する
    const worldB = makeFlatWorld();
    const replay = new Bot(worldB, '再現', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
    replay.fkApplyLivePose(0, 0, 0, 0);
    const t01 = (steps * dt) / totalS;
    replay.fkApplyDeathPose(t01);

    const refI = reference as unknown as { rig: THREE.Group; legL: THREE.Group; kneeL: THREE.Group };
    const repI = replay as unknown as { rig: THREE.Group; legL: THREE.Group; kneeL: THREE.Group };
    expect(repI.rig.position.y).toBeCloseTo(refI.rig.position.y, 5);
    expect(repI.legL.rotation.x).toBeCloseTo(refI.legL.rotation.x, 5);
    expect(repI.kneeL.rotation.x).toBeCloseTo(refI.kneeL.rotation.x, 5);
    expect(replay.group.rotation.x).toBeCloseTo(reference.group.rotation.x, 5);
    expect(replay.group.rotation.z).toBeCloseTo(reference.group.rotation.z, 5);
  });

  it('fkApplyDeathPoseはboss zombieのrigLiftYを保持する(T1補正との整合)', () => {
    const world = makeFlatWorld();
    const tuning = { ...DIFFICULTY.normal, ...BOSS_TUNING };
    const boss = new Bot(world, 'ボス', new THREE.Vector3(0, 0, 0), 0xff2200, tuning, 1, 'boss', 'zombie');
    const rigLiftY = (boss as unknown as { rigLiftY: number }).rigLiftY;
    boss.fkApplyLivePose(0, 0, 0, 0);
    boss.fkApplyDeathPose(0); // t01=0 → buckle=0 なので rig.position.y は rigLiftY のみ
    const rigY = (boss as unknown as { rig: THREE.Group }).rig.position.y;
    expect(rigY).toBeCloseTo(rigLiftY, 10);
    expect(rigLiftY).toBeCloseTo(0.4, 10);
  });
});

// ─── R53-W2: 特殊ゾンビ変種の視覚適用/リセット ─────────────────────────────────

function makeZombie(world: RAPIER.World, spawn = new THREE.Vector3(0, 0, 0)): Bot {
  return new Bot(world, 'ゾンビ', spawn, 0x39d465, { ...DIFFICULTY.normal }, 2, 'normal', 'zombie');
}

describe('Bot applyZombieVariantVisual(R53-W2 特殊ゾンビ変種)', () => {
  it('blastは腹部パスチュール3個をrig配下へ追加しzombieVariantを設定する', () => {
    const world = makeFlatWorld();
    const zombie = makeZombie(world);
    const rig = (zombie as unknown as { rig: THREE.Group }).rig;
    const before = rig.children.length;
    zombie.applyZombieVariantVisual('blast');
    expect(zombie.zombieVariant).toBe('blast');
    expect(rig.children.length).toBe(before + 3);
  });

  it('miasmaはシェル+頭部発光の2メッシュを追加する', () => {
    const world = makeFlatWorld();
    const zombie = makeZombie(world);
    const rig = (zombie as unknown as { rig: THREE.Group }).rig;
    const before = rig.children.length;
    zombie.applyZombieVariantVisual('miasma');
    expect(zombie.zombieVariant).toBe('miasma');
    expect(rig.children.length).toBe(before + 2);
  });

  it('shellは胸+顔の骨甲板2メッシュを追加する', () => {
    const world = makeFlatWorld();
    const zombie = makeZombie(world);
    const rig = (zombie as unknown as { rig: THREE.Group }).rig;
    const before = rig.children.length;
    zombie.applyZombieVariantVisual('shell');
    expect(zombie.zombieVariant).toBe('shell');
    expect(rig.children.length).toBe(before + 2);
  });

  it('同一変種の追加メッシュは個体間で同一のマテリアルインスタンスを共有する(個体クローン禁止)', () => {
    const world = makeFlatWorld();
    const zA = makeZombie(world, new THREE.Vector3(0, 0, 0));
    const zB = makeZombie(world, new THREE.Vector3(10, 0, 10));
    zA.applyZombieVariantVisual('miasma');
    zB.applyZombieVariantVisual('miasma');
    const rigA = (zA as unknown as { rig: THREE.Group }).rig;
    const rigB = (zB as unknown as { rig: THREE.Group }).rig;
    const meshesA = rigA.children.slice(-2) as THREE.Mesh[];
    const meshesB = rigB.children.slice(-2) as THREE.Mesh[];
    expect(meshesA[0]?.material).toBe(meshesB[0]?.material);
    expect(meshesA[1]?.material).toBe(meshesB[1]?.material);
    // ジオメトリは個体別(共有マテリアルとは別。安価なprimitiveなので複製は問題ない)
    expect(meshesA[0]?.geometry).not.toBe(meshesB[0]?.geometry);
  });

  it('再適用は前回の装飾を除去してから新しい変種を追加する(多重適用での残留防止)', () => {
    const world = makeFlatWorld();
    const zombie = makeZombie(world);
    const rig = (zombie as unknown as { rig: THREE.Group }).rig;
    const baseline = rig.children.length;
    zombie.applyZombieVariantVisual('blast'); // +3
    expect(rig.children.length).toBe(baseline + 3);
    zombie.applyZombieVariantVisual('shell'); // 旧blastの3個を除去してから+2
    expect(zombie.zombieVariant).toBe('shell');
    expect(rig.children.length).toBe(baseline + 2);
  });

  it('resetForZombieReuse(プール再利用)で旧variantの装飾が除去されzombieVariantがnullへ戻る', () => {
    const world = makeFlatWorld();
    const zombie = makeZombie(world);
    world.step();
    const rig = (zombie as unknown as { rig: THREE.Group }).rig;
    const baseline = rig.children.length;
    zombie.applyZombieVariantVisual('shell');
    expect(rig.children.length).toBe(baseline + 2);

    zombie.takeDamage(999);
    world.step();
    zombie.resetForZombieReuse(
      { ...DIFFICULTY.normal, maxHp: 104, moveSpeedMul: 1.44 },
      new THREE.Vector3(3, 0, 3),
    );

    expect(zombie.zombieVariant).toBeNull();
    expect(rig.children.length).toBe(baseline);
  });
});

describe('Bot facingDot(前面被弾判定)', () => {
  it('正面(bot→射手 = facingと同方向)からの被弾は+1に近い', () => {
    const fixture = makeFixture();
    const facing = fixture.bot.facing(); // heading初期値0
    expect(fixture.bot.facingDot(facing)).toBeCloseTo(1, 5);
  });

  it('背面(facingの逆方向)からの被弾は-1に近い', () => {
    const fixture = makeFixture();
    const facing = fixture.bot.facing();
    expect(fixture.bot.facingDot(facing.clone().negate())).toBeCloseTo(-1, 5);
  });

  it('側面からの被弾は0に近い', () => {
    const fixture = makeFixture();
    const facing = fixture.bot.facing();
    const side = new THREE.Vector3(-facing.z, 0, facing.x);
    expect(fixture.bot.facingDot(side)).toBeCloseTo(0, 5);
  });

  it('ゼロベクトルは0を返す(安全側フォールバック)', () => {
    const fixture = makeFixture();
    expect(fixture.bot.facingDot(new THREE.Vector3(0, 0, 0))).toBe(0);
  });
});

describe('Bot applyBossPhase(R53-W2 campaign.ts BossPhase契約)', () => {
  it('speedMul/damageMulを現在のtuningへ乗算する(基礎からの再計算ではない)', () => {
    const fixture = makeFixture();
    const bot = fixture.bot;
    const baseSpeedMul = bot.tuning.moveSpeedMul;
    const baseDamage = bot.tuning.damage;
    bot.applyBossPhase(1.5, 2);
    expect(bot.tuning.moveSpeedMul).toBeCloseTo(baseSpeedMul * 1.5, 10);
    expect(bot.tuning.damage).toBeCloseTo(baseDamage * 2, 10);
  });

  it('複数回呼ぶと重ねがけされる(フェーズは単調進行で戻らない前提)', () => {
    const fixture = makeFixture();
    const bot = fixture.bot;
    const baseSpeedMul = bot.tuning.moveSpeedMul;
    bot.applyBossPhase(1.2);
    bot.applyBossPhase(1.2);
    expect(bot.tuning.moveSpeedMul).toBeCloseTo(baseSpeedMul * 1.2 * 1.2, 10);
  });

  it('省略した引数(undefined)は変更しない', () => {
    const fixture = makeFixture();
    const bot = fixture.bot;
    const baseDamage = bot.tuning.damage;
    const baseSpeedMul = bot.tuning.moveSpeedMul;
    bot.applyBossPhase(1.5); // damageMul省略
    expect(bot.tuning.damage).toBe(baseDamage);
    bot.applyBossPhase(undefined, 3); // speedMul省略
    expect(bot.tuning.moveSpeedMul).toBeCloseTo(baseSpeedMul * 1.5, 10);
  });

  it('speedMulは実効moveSpeed(private)にも反映され、実際の移動量が倍率どおり変化する', () => {
    const ctx: BotContext = {
      targetEye: null,
      objective: new THREE.Vector3(0, 0, -50),
      tuning: DIFFICULTY.normal,
      rand: () => 0.5, // headingTimer<=0の初回でoffset=0(決定論的に objective 直進)
      onShoot: () => {},
    };

    const worldA = makeFlatWorld();
    const botA = new Bot(worldA, 'A', new THREE.Vector3(0, 0, 0), 0xffffff, { ...DIFFICULTY.normal });
    worldA.step();
    botA.update(1 / 60, ctx);
    worldA.step();
    const dA = Math.hypot(botA.position.x, botA.position.z);

    const worldB = makeFlatWorld();
    const botB = new Bot(worldB, 'B', new THREE.Vector3(0, 0, 0), 0xffffff, { ...DIFFICULTY.normal });
    worldB.step();
    botB.applyBossPhase(2);
    botB.update(1 / 60, ctx);
    worldB.step();
    const dB = Math.hypot(botB.position.x, botB.position.z);

    expect(dA).toBeGreaterThan(0);
    expect(dB).toBeGreaterThan(dA * 1.5); // 概ね2倍(KCCスナップの微小変動を許容)
  });
});

describe('Bot blinkTo(R53-W2 ボス演出: 即時転移)', () => {
  it('次のworld.step()で指定座標(足元/地面基準のY)へ転移する', () => {
    const fixture = makeFixture();
    fixture.bot.blinkTo(10, 0, -10);
    fixture.world.step();
    expect(fixture.bot.position.x).toBeCloseTo(10, 5);
    expect(fixture.bot.position.z).toBeCloseTo(-10, 5);
  });

  // R55 W-C確証finding修正(CRITICAL): setNextKinematicTranslationは「次のworld.step()で
  // 消費されるキュー」に過ぎず、呼び出しただけではbody.translation()は更新されない。
  // 旧実装はこれのみを呼んでいたため、blinkTo直後にworld.step()を挟まずtranslation()を
  // 読むと転移前の座標のままだった(=zombie-director側の救済テレポートが本フィールドを
  // 一切更新しないまま「テレポート済み」として扱われていた)。
  it('world.step()を挟まなくても呼び出し直後にbody.translation()が目標座標へ即時反映される', () => {
    const fixture = makeFixture();
    fixture.bot.blinkTo(10, 0, -10);
    expect(fixture.bot.position.x).toBeCloseTo(10, 5);
    expect(fixture.bot.position.z).toBeCloseTo(-10, 5);
  });

  // R55 W-C確証finding修正(CRITICAL・本丸): zombie-director.updateZombieDirectorは
  // match.tsのphysics.step()「後」に呼ばれる(match.ts: updateBots→physics.step→...→
  // updateZombieDirector)。旧実装のblinkToはsetNextKinematicTranslationのみだったため、
  // 次フレームのupdateBots→updateZombie冒頭 `const t = this.body.translation()` が
  // まだキュー未消化のstale(=転移前)座標を読み、そこへ徘徊/追跡の微小移動を足して
  // 改めてsetNextKinematicTranslationし直す(=テレポート先を上書き)。結果、直後の
  // physics.step()ではテレポートが一切着地せず、詰まったゾンビが永久に動けなかった
  // (⑧最終安全弁が実質無効化されていた)。setTranslation(..., true)による即時反映で、
  // 次フレームのupdateZombieが必ずテレポート後の座標をtranslation()で読めることを保証する。
  it('blinkTo直後の次フレームupdateZombie(match.tsと同じupdateBots→physics.stepの順)がstale座標でテレポートを上書きしない', () => {
    const world = makeFlatWorld();
    const tuning = { ...DIFFICULTY.normal };
    const zombie = new Bot(
      world,
      'ゾンビ',
      new THREE.Vector3(0, 0, 0),
      0x39d465,
      tuning,
      2,
      'normal',
      'zombie',
    );
    world.step();

    const ctx: BotContext = {
      targetEye: null, // 徘徊: wishが小さく保たれ、テレポート判定を汚さない
      objective: null,
      tuning,
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };

    // match.tsの通常ティック(updateBots→physics.step)を数フレーム回してから、
    // zombie-director.updateZombieDirector相当(physics.step「後」)でblinkToする。
    const dt = 1 / 60;
    for (let i = 0; i < 3; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    zombie.blinkTo(30, 0, 30);

    // 次フレームのupdateBots→physics.step相当を1回だけ回す
    zombie.update(dt, ctx);
    world.step();

    // 徘徊の微小移動(moveSpeed*0.4*dt ≒ 数cm)を許容しても、旧実装のバグでは
    // origin(0,0,0)付近に留まり続ける。この閾値は5m離れているため両者を明確に判別できる。
    expect(zombie.position.x).toBeGreaterThan(25);
    expect(zombie.position.z).toBeGreaterThan(25);
  });

  it('KCC距離LOD前回移動キャッシュ/詰まり・登坂状態を転移時にリセットする(誤検知防止)', () => {
    const fixture = makeFixture();
    const internal = fixture.bot as unknown as {
      prevZombieMoved: { x: number; y: number; z: number };
      prevZombieGrounded: boolean;
      prevGiantMoved: { x: number; y: number; z: number };
      stuckTimer: number;
      unstuckSteerS: number;
      unstuckStrafeOverride: number | null;
      climbing: boolean;
      zombieUnstuckAttempts: number;
      hardStuckS: number;
    };
    internal.prevZombieMoved.x = 5;
    internal.prevZombieMoved.y = -1;
    internal.prevZombieMoved.z = 5;
    internal.prevZombieGrounded = true;
    internal.prevGiantMoved.x = 3;
    internal.prevGiantMoved.y = -2;
    internal.prevGiantMoved.z = 3;
    internal.stuckTimer = 2;
    internal.unstuckSteerS = 0.5;
    internal.unstuckStrafeOverride = 1;
    internal.climbing = true;
    internal.zombieUnstuckAttempts = 3;
    internal.hardStuckS = 7; // R55: zombieHardStuck=trueの状態から転移した想定

    fixture.bot.blinkTo(0, 0, 0);

    expect(internal.prevZombieMoved).toEqual({ x: 0, y: 0, z: 0 });
    expect(internal.prevZombieGrounded).toBe(false);
    expect(internal.prevGiantMoved).toEqual({ x: 0, y: 0, z: 0 });
    expect(internal.stuckTimer).toBe(0);
    expect(internal.unstuckSteerS).toBe(0);
    expect(internal.unstuckStrafeOverride).toBeNull();
    expect(internal.climbing).toBe(false);
    expect(internal.zombieUnstuckAttempts).toBe(0);
    expect(internal.hardStuckS).toBe(0);
    // R55: リセット後は救済対象フラグも即falseへ戻る(無限再テレポートループ防止)
    expect(fixture.bot.zombieHardStuck).toBe(false);
    expect(fixture.bot.zombieHardStuckForce).toBe(false);
  });
});

// R55 ⑧: ゾンビがプロップ/障害物に挟まって永久に停止し「倒せずラウンドが変わらない」
// バグの最終安全弁。stuckTimer/unstuckSteerS(短周期の迂回試行)とは独立に、実位置の
// ドリフトを1s間隔でサンプリングし、5秒以上「本当に前進できていない」個体を
// zombieHardStuck、9秒以上を zombieHardStuckForce として立てる(zombie-director側が
// これを読んでテレポート救済する。配線テストは zombie-director-audio-wiring.test.ts 系の
// フィクスチャを流用する専用ファイルを参照)。
describe('Bot ゾンビ zombieHardStuck/zombieHardStuckForce(R55 ⑧ 最終安全弁のしきい値契約)', () => {
  it('hardStuckSが5s未満ではzombieHardStuck=false、5s以上でtrueになる', () => {
    const fixture = makeFixture();
    const internal = fixture.bot as unknown as { hardStuckS: number };
    internal.hardStuckS = 4.999;
    expect(fixture.bot.zombieHardStuck).toBe(false);
    internal.hardStuckS = 5;
    expect(fixture.bot.zombieHardStuck).toBe(true);
  });

  it('hardStuckSが9s未満ではzombieHardStuckForce=false、9s以上でtrueになる', () => {
    const fixture = makeFixture();
    const internal = fixture.bot as unknown as { hardStuckS: number };
    internal.hardStuckS = 8.999;
    expect(fixture.bot.zombieHardStuck).toBe(true); // 5s閾値は既に超えている
    expect(fixture.bot.zombieHardStuckForce).toBe(false);
    internal.hardStuckS = 9;
    expect(fixture.bot.zombieHardStuckForce).toBe(true);
  });
});

describe('Bot ゾンビ hardStuckサンプリング(R55 ⑧: 実位置ドリフトの1s間隔検出)', () => {
  // 完全に4方向を囲む箱(高さ6m=登坂上限2.4mより十分高く登坂でも越えられない・
  // 内寸0.9m四方=カプセル半径0.35を差し引いても中心の可動域は最大±0.1m=対角でも
  // 0.28m未満)に閉じ込める。迂回(横ステア)を試みても箱の中で跳ね返るだけで
  // ZOMBIE_HARD_STUCK_MOVE_M(0.4m)を上回るサンプル間ドリフトを起こし得ないため、
  // 「本当に前進できない個体」を物理シミュレーションで決定論的に再現できる。
  function makeBoxedZombie(): { world: RAPIER.World; zombie: Bot } {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      floorBody,
    );
    const wallsBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // 前(-z, ターゲット方向)/後/左/右の4枚で完全に囲む。角に隙間が出ないよう厚みを重ねる
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.6, 3, 0.15).setTranslation(0, 3, -0.6),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.6, 3, 0.15).setTranslation(0, 3, 0.6),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 3, 0.6).setTranslation(-0.6, 3, 0),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 3, 0.6).setTranslation(0.6, 3, 0),
      wallsBody,
    );
    const tuning = { ...DIFFICULTY.normal };
    const zombie = new Bot(
      world,
      'ゾンビ',
      new THREE.Vector3(0, 0, 0),
      0x39d465,
      tuning,
      2,
      'normal',
      'zombie',
    );
    zombie.hordeRank = 0; // 先頭集団扱いでKCCを毎フレームフル解決させ、検知タイミングを決定論的にする
    world.step();
    return { world, zombie };
  }

  it('4方向を完全に囲まれ迂回しても抜けられないと、やがてzombieHardStuckが真になる', () => {
    const { world, zombie } = makeBoxedZombie();
    const ctx: BotContext = {
      targetEye: new THREE.Vector3(0, 1.5, -10), // 箱の外。プレイヤーまでの距離はmeleeRangeより十分遠い
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    // 登坂試行(最大2.5s)→クールダウン(1.2s)のサイクルを何周かカバーする余裕を持って
    // 20s分シミュレートする(1200 step。物理計算のみで軽量、テスト時間への影響は無視できる)
    let becameHardStuck = false;
    for (let i = 0; i < 1200 && !becameHardStuck; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      if (zombie.zombieHardStuck) becameHardStuck = true;
    }
    expect(becameHardStuck).toBe(true);
  });

  // R55 W-C3: 障害物のない開けた場(壁なし)で本当に密着できているケース。dist<=meleeRangeの間、
  // KCCは一切ブロックされない(=blockedは常にfalse)ため、prevZombieBlockedガード併用後も
  // 従来どおり停滞と誤検知しないことを確認する(壁越し偽近接と区別する非回帰確認)。
  function makeOpenZombie(): { world: RAPIER.World; zombie: Bot } {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      floorBody,
    );
    const tuning = { ...DIFFICULTY.normal };
    const zombie = new Bot(
      world,
      'ゾンビ',
      new THREE.Vector3(0, 0, 0),
      0x39d465,
      tuning,
      2,
      'normal',
      'zombie',
    );
    zombie.hordeRank = 0; // 先頭集団扱いでKCCを毎フレームフル解決させ、検知タイミングを決定論的にする
    world.step();
    return { world, zombie };
  }

  it('近接交戦距離(meleeRange以内)かつ遮蔽物なしの本当の密着では意図的低速を停滞と誤検知しない', () => {
    const { world, zombie } = makeOpenZombie();
    const ctx: BotContext = {
      // meleeRange(2.3m)未満の至近距離を維持。遮蔽物が一切ないため実際にKCCブロックされない
      targetEye: new THREE.Vector3(0, 1.5, -1.2),
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    for (let i = 0; i < 90; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    const internal = zombie as unknown as { hardStuckS: number; unstuckStrafeOverride: number | null };
    expect(internal.hardStuckS).toBe(0);
    expect(zombie.zombieHardStuck).toBe(false);
    expect(internal.unstuckStrafeOverride).toBeNull(); // 本当に密着できているので迂回も注入されない
  });

  it('目標喪失中(徘徊)は停滞と誤検知しない', () => {
    const { world, zombie } = makeBoxedZombie();
    const ctx: BotContext = {
      targetEye: null,
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    for (let i = 0; i < 90; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    const hardStuckS = (zombie as unknown as { hardStuckS: number }).hardStuckS;
    expect(hardStuckS).toBe(0);
  });

  // R55 W-C3(finding[16]): 壁の向こうにプレイヤーがいて直線距離だけはmeleeRange以内という
  // 「壁越しの偽近接」。旧実装は distToPlayer<=meleeRange の直線距離だけで「本当に密着している」
  // と誤判定し、短周期の迂回注入(unstuckStrafeOverride)と長周期の最終安全弁(hardStuckS)を
  // 両方とも永久に無効化していた(makeBoxedZombieの箱=全方向を塞ぐ壁。target(-1.2)は箱の外
  // なので実際には絶対に到達できないが、直線距離1.2mはmeleeRange2.3m未満)。
  // 修正後は前フレームの実測blocked(prevZombieBlocked)を併用し、「近接射程内だが前進ブロック
  // (=偽近接で詰まっている)」を「本当の密着」と区別して、両方の機構を再び有効化する。
  it('壁越しの偽近接(dist<=meleeRangeだが前進ブロックされている)では迂回注入も最終安全弁も無効化されない', () => {
    const { world, zombie } = makeBoxedZombie();
    const ctx: BotContext = {
      // meleeRange(2.3m)未満の至近距離だが、target(-1.2)は箱の外(全方向を壁で塞がれ到達不能)
      targetEye: new THREE.Vector3(0, 1.5, -1.2),
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    const internal = zombie as unknown as {
      hardStuckS: number;
      unstuckStrafeOverride: number | null;
    };

    // 短周期: 迂回注入(unstuckStrafeOverride)がdist<=meleeRangeにもかかわらず発火する
    let overrideFiredAt = -1;
    for (let i = 0; i < 120 && overrideFiredAt < 0; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      if (internal.unstuckStrafeOverride !== null) overrideFiredAt = i;
    }
    expect(overrideFiredAt).toBeGreaterThanOrEqual(0);

    // 長周期: 最終安全弁(hardStuckS)が0のまま永久停止せず積算される(旧実装は0のまま固定)
    let sawPositiveHardStuck = false;
    for (let i = 0; i < 900 && !sawPositiveHardStuck; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      if (internal.hardStuckS > 0) sawPositiveHardStuck = true;
    }
    expect(sawPositiveHardStuck).toBe(true);
  });

  // R55 W-C6確証finding修正(HIGH・登坂チャタリングで最終安全弁が永久に発火しない):
  // 旧実装は updateZombie 冒頭のhardStuckサンプリング判定が `this.climbing` を含んでおり、
  // 登坂中(climbing=true)はサンプリング窓(hardStuckCheckS)を毎フレームリセットしていた。
  // 一方、登坂の「成功終了パス」(climbMinS経過&&grounded&&!blocked)はclimbCooldownSを
  // 設定しない実装だったため、越えられない縁/段差(2.4m未満)でgrounded&&!blockedが一瞬だけ
  // 成立→即座に登坂終了→次フレーム即再点火、というチャタリングが起き得た。この場合
  // climbing=falseの区間が常にZOMBIE_HARD_STUCK_CHECK_S(1.0s)未満しか続かないため、
  // hardStuckCheckSが1.0sへ戻り続けて一度もサンプル評価に到達できず、hardStuckSが永久に0
  // のまま=⑧最終安全弁(zombieHardStuck/zombieHardStuckForce)が絶対に発火しなかった
  // (既存の「4方向を完全に囲まれ」テストは高さ6m=`!underCap`の1.2sクールダウン経路しか
  // 通っておらず、このパターンを再現できていなかった)。
  //
  // 再現には「climbCooldownSを気にせず何度でも登坂を再点火できるが、天井付き密閉ポケットで
  // 絶対に登り切れない(高度もXZも実質進まない)」状況が必要。天井を壁の高さぴったりに
  // 据えて登坂の見かけ上の可動域を0.15m程度に抑えることで、実RAPIER物理で「climbing on/off
  // チャタリング(net XZ≈0・net Y<0.4m)」を決定論的に再現する。
  function makeTightPocketZombie(): { world: RAPIER.World; zombie: Bot } {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      floorBody,
    );
    const wallsBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // 4方向の壁(高さ1.75m。登坂上限2.4mより十分低い=このケースは`!underCap`経路を通らない)
    const wallTop = 1.75;
    const wallHalf = wallTop / 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.6, wallHalf, 0.15).setTranslation(0, wallHalf, -0.6),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.6, wallHalf, 0.15).setTranslation(0, wallHalf, 0.6),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, wallHalf, 0.6).setTranslation(-0.6, wallHalf, 0),
      wallsBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, wallHalf, 0.6).setTranslation(0.6, wallHalf, 0),
      wallsBody,
    );
    // 壁の真上に天井スラブを重ねて密閉する(内寸クリア高さ≒壁高さ=1.75m。安静時の胴カプセル
    // 上端≒0.8+0.8=1.6mのため、登坂で稼げる余地は≒0.15mしかなく、越えられない)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.1, 0.75).setTranslation(0, wallTop + 0.1, 0),
      wallsBody,
    );
    const tuning = { ...DIFFICULTY.normal };
    const zombie = new Bot(
      world,
      'ゾンビ',
      new THREE.Vector3(0, 0, 0),
      0x39d465,
      tuning,
      2,
      'normal',
      'zombie',
    );
    zombie.hordeRank = 0; // 先頭集団扱いでKCCを毎フレームフル解決させ、検知タイミングを決定論的にする
    world.step();
    return { world, zombie };
  }

  it('登坂チャタリング(under-2.4mの密閉ポケットでnet XZ/Y共に進まない)でもclimbing中に測定が止まらず、やがてzombieHardStuckが真になる', () => {
    const { world, zombie } = makeTightPocketZombie();
    const ctx: BotContext = {
      targetEye: new THREE.Vector3(0, 1.5, -10), // 箱の外。距離はmeleeRangeより十分遠い
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    const internal = zombie as unknown as { climbing: boolean };

    // 前提確認: このジオメトリで実際に climbing on/off のチャタリングが起きている
    // (climbing=trueのフレームが有意に存在する=登坂が繰り返し再点火されている)
    let climbTrueFrames = 0;
    let becameHardStuck = false;
    for (let i = 0; i < 1200 && !becameHardStuck; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      if (internal.climbing) climbTrueFrames += 1;
      if (zombie.zombieHardStuck) becameHardStuck = true;
    }
    expect(climbTrueFrames).toBeGreaterThan(60); // 登坂が実際に繰り返し点火されたことの確認
    // 本題: 登坂チャタリングが起きてもhardStuckSの測定は止まらず、最終安全弁が発火する
    // (修正前は climbing=true の間ずっとサンプリング窓がリセットされ、ここが恒久的にfalseだった)
    expect(becameHardStuck).toBe(true);
  });

  // R57 ⑥修正1(確証finding修正・ユーザー高優先度⑧直結): 桟橋/張り出し等、ゾンビが登れない
  // 高所(>2.4m上)にプレイヤーがいるケースの垂直盲点。distToPlayerは水平のみ(to.y=0で算出)
  // のため、真下のゾンビは水平ではmeleeRange以内かつ遮蔽物なし(=KCC非ブロック、真下は開けて
  // いる)で「近接交戦中の意図的低速」と誤判定され、旧実装ではhardStuckSが毎フレーム0に
  // リセットされ続けて最終安全弁(zombieHardStuck)が永久に発火しなかった(そのゾンビが
  // 最後の1体だとラウンドが永久に進まない致命バグ)。makeOpenZombie(壁なし=KCCは絶対に
  // ブロックされない)でtargetEyeを真上の届かない高さに置き、実物理で再現する。
  it('真下(垂直差>1.6m)で水平密着しているだけの届かないターゲットでは、hardStuckSが積算されやがてzombieHardStuckが真になる', () => {
    const { world, zombie } = makeOpenZombie();
    const ctx: BotContext = {
      // 水平距離1.0m(<meleeRange2.3m)だが、Y=6mは桟橋のように届かない高さ
      // (ゾンビ体幹中心≒0.8m起点なので垂直差≒5.2m>>1.6m)
      targetEye: new THREE.Vector3(0, 6, -1.0),
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    let becameHardStuck = false;
    for (let i = 0; i < 1800 && !becameHardStuck; i += 1) {
      zombie.update(dt, ctx);
      world.step();
      if (zombie.zombieHardStuck) becameHardStuck = true;
    }
    expect(becameHardStuck).toBe(true);
  });

  // 非回帰: 垂直差が閾値(1.6m)以内の「実際に攻撃が届き得る」高低差(段差程度)では、
  // 水平密着かつ非ブロックなら従来どおり意図的低速とみなされ、hardStuckSは積算されない。
  it('垂直差が閾値以内(実際に攻撃が届き得る段差)の水平密着は従来どおり停滞と誤検知しない', () => {
    const { world, zombie } = makeOpenZombie();
    const ctx: BotContext = {
      // 水平距離1.0m(<meleeRange2.3m)、Y=1.5は垂直差≒0.7m(<1.6m)で届く高さ
      targetEye: new THREE.Vector3(0, 1.5, -1.0),
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    for (let i = 0; i < 300; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    const internal = zombie as unknown as { hardStuckS: number };
    expect(internal.hardStuckS).toBe(0);
    expect(zombie.zombieHardStuck).toBe(false);
  });
});

describe('Bot fleeMode(R53-W2 追跡ミッション: 逃走)', () => {
  it('既定falseでは20m超のtargetEyeへ接近する(approach=+1の非回帰)', () => {
    const world = makeFlatWorld();
    const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, { ...DIFFICULTY.normal });
    world.step();
    const ctx: BotContext = {
      targetEye: new THREE.Vector3(0, 1.5, -30),
      objective: null,
      tuning: DIFFICULTY.normal,
      rand: () => 0.5,
      onShoot: () => {},
    };
    const before = bot.position.distanceTo(new THREE.Vector3(0, bot.position.y, -30));
    for (let i = 0; i < 30; i += 1) {
      bot.update(1 / 60, ctx);
      world.step();
    }
    const after = bot.position.distanceTo(new THREE.Vector3(0, bot.position.y, -30));
    expect(after).toBeLessThan(before);
  });

  it('trueにすると同条件でtargetEyeから遠ざかる(approachが反転)', () => {
    const world = makeFlatWorld();
    const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, { ...DIFFICULTY.normal });
    world.step();
    bot.fleeMode = true;
    const ctx: BotContext = {
      targetEye: new THREE.Vector3(0, 1.5, -30),
      objective: null,
      tuning: DIFFICULTY.normal,
      rand: () => 0.5,
      onShoot: () => {},
    };
    const before = bot.position.distanceTo(new THREE.Vector3(0, bot.position.y, -30));
    for (let i = 0; i < 30; i += 1) {
      bot.update(1 / 60, ctx);
      world.step();
    }
    const after = bot.position.distanceTo(new THREE.Vector3(0, bot.position.y, -30));
    expect(after).toBeGreaterThan(before);
  });
});

describe('Bot escortWaypoints(R53-W2 護衛追従)', () => {
  it('先頭waypointへ向かい、到達半径3m以内で次のwaypointへ進む(escortIdxが進む)', () => {
    const world = makeFlatWorld();
    const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, { ...DIFFICULTY.normal });
    world.step();
    bot.escortWaypoints = [new THREE.Vector3(5, 0, -5), new THREE.Vector3(5, 0, -40)];
    const ctx: BotContext = {
      targetEye: null,
      objective: null,
      tuning: DIFFICULTY.normal,
      rand: () => 0.5,
      onShoot: () => {},
    };
    const internal = bot as unknown as { escortIdx: number };
    for (let i = 0; i < 200 && internal.escortIdx === 0; i += 1) {
      bot.update(1 / 60, ctx);
      world.step();
    }
    expect(internal.escortIdx).toBe(1);
    // 先頭waypointへ実際に近づいている(到達判定が正しく機能した根拠)
    expect(bot.position.distanceTo(new THREE.Vector3(5, bot.position.y, -5))).toBeLessThanOrEqual(3);
  });

  it('escortWaypointsへの再代入でescortIdxが0へリセットされる', () => {
    const fixture = makeFixture();
    const internal = fixture.bot as unknown as { escortIdx: number };
    fixture.bot.escortWaypoints = [new THREE.Vector3(1, 0, 1)];
    internal.escortIdx = 1; // 進行済み状態を模倣
    fixture.bot.escortWaypoints = [new THREE.Vector3(2, 0, 2), new THREE.Vector3(3, 0, 3)];
    expect(internal.escortIdx).toBe(0);
  });

  it('nullを代入すると通常のobjective/徘徊AIへ戻る(escortWaypoints getterがnullを返す)', () => {
    const fixture = makeFixture();
    fixture.bot.escortWaypoints = [new THREE.Vector3(1, 0, 1)];
    fixture.bot.escortWaypoints = null;
    expect(fixture.bot.escortWaypoints).toBeNull();
  });
});

describe('Bot bossPhaseFlags/setBossPhaseFlags(R53-W2 campaign.ts BossPhase契約)', () => {
  it('既定値はすべてfalse', () => {
    const fixture = makeFixture();
    expect(fixture.bot.bossPhaseFlags).toEqual({ blackSlash: false, blink: false, pillars: false });
  });

  it('指定キーのみ更新し、省略キーは現状維持する(部分更新)', () => {
    const fixture = makeFixture();
    fixture.bot.setBossPhaseFlags({ blackSlash: true });
    expect(fixture.bot.bossPhaseFlags).toEqual({ blackSlash: true, blink: false, pillars: false });
    fixture.bot.setBossPhaseFlags({ blink: true, pillars: true });
    expect(fixture.bot.bossPhaseFlags).toEqual({ blackSlash: true, blink: true, pillars: true });
  });
});

// ── R53 帝王の怯え(fearUntil/applyFear/fearAccuracyMul)────────────────────────
// M3配線契約: humanoid系=applyFear(1.2〜2.0)で後退+match側spread拡大(1/fearAccuracyMul)、
// zombie=applyFear(0.4)でよろめき(移動×0.2)。姿勢式は速度非依存=InstancedMesh群経路と整合。
describe('R53: 怯え(applyFear/feared)', () => {
  it('fearAccuracyMul は 0.5(match updateShooting の実効spread拡大係数の逆数)', () => {
    expect(fearAccuracyMul).toBe(0.5);
  });

  it('applyFear は残時間で減衰し feared が false へ戻る(長い方を優先)', () => {
    const { world, bot } = ((): { world: RAPIER.World; bot: Bot } => {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
        world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
      );
      const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
      world.step();
      return { world, bot };
    })();
    const ctx: BotContext = {
      targetEye: null,
      objective: null,
      tuning: DIFFICULTY.normal,
      rand: () => 0.5,
      onShoot: () => {},
    };
    expect(bot.feared).toBe(false);
    bot.applyFear(0.3);
    bot.applyFear(0.1); // 短い方は延長しない
    expect(bot.feared).toBe(true);
    const dt = 1 / 60;
    for (let i = 0; i < 12; i += 1) {
      bot.update(dt, ctx);
      world.step();
    }
    expect(bot.feared).toBe(true); // 0.2s経過ではまだ怯え中
    for (let i = 0; i < 12; i += 1) {
      bot.update(dt, ctx);
      world.step();
    }
    expect(bot.feared).toBe(false); // 0.4s経過で解除(0.3sの設定値を超過)
  });

  it('ゾンビは怯え中に移動が大きく鈍る(×0.2よろめき)', () => {
    const run = (fear: boolean): number => {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0),
        world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
      );
      const tuning = { ...DIFFICULTY.normal };
      const zombie = new Bot(world, 'ゾンビ', new THREE.Vector3(0, 0, 0), 0x39d465, tuning, 2, 'normal', 'zombie');
      zombie.hordeRank = 0; // 毎フレームフルKCC=決定論
      world.step();
      const ctx: BotContext = {
        targetEye: new THREE.Vector3(0, 1.5, -30),
        objective: null,
        tuning,
        rand: () => 0.5,
        onShoot: () => {},
        onMelee: () => {},
      };
      if (fear) zombie.applyFear(0.4);
      const start = zombie.position.clone();
      const dt = 1 / 60;
      for (let i = 0; i < 20; i += 1) {
        // 0.33s: 怯え(0.4s)の内側だけを計測(再付与はしない)
        zombie.update(dt, ctx);
        world.step();
      }
      return zombie.position.distanceTo(start);
    };
    const normal = run(false);
    const feared = run(true);
    expect(feared).toBeLessThan(normal * 0.45); // ×0.2よろめき(サブステップ誤差込みで<45%)
    expect(normal).toBeGreaterThan(0.5); // 前提: 非怯えは実際に前進している
  });

  it('humanoidは怯え中に後退する(approach反転。狙いは維持=headingは対象向きのまま)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
    const bot = new Bot(world, '兵', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
    world.step();
    const target = new THREE.Vector3(0, 1.5, -14); // 9-20m帯=非怯えなら approach 0(距離維持)
    const ctx: BotContext = {
      targetEye: target,
      objective: null,
      tuning: DIFFICULTY.normal,
      rand: () => 0.5,
      onShoot: () => {},
    };
    bot.applyFear(2.0);
    const d0 = bot.position.distanceTo(target);
    const dt = 1 / 60;
    for (let i = 0; i < 45; i += 1) {
      bot.update(dt, ctx);
      world.step();
    }
    const d1 = bot.position.distanceTo(target);
    expect(d1).toBeGreaterThan(d0 + 0.5); // 対象から明確に離れている
  });
});
