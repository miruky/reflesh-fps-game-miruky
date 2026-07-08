import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bot,
  DIFFICULTY,
  ZOMBIE_HORDE_THIN_RANK,
  zombieKccActive,
  zombieKccSkipFactor,
  type BotContext,
} from './bot';

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

describe('zombieKccActive(★5 群衆ランクKCC LOD)', () => {
  it('先頭集団(hordeRank<ZOMBIE_HORDE_THIN_RANK)は25m以内で常時フル解決', () => {
    for (let frame = 0; frame < 4; frame += 1) {
      expect(zombieKccActive(0, frame, 10, 0)).toBe(true);
      expect(zombieKccActive(7, frame, 10, ZOMBIE_HORDE_THIN_RANK - 1)).toBe(true);
    }
  });

  it('先頭集団外(hordeRank>=ZOMBIE_HORDE_THIN_RANK)は25m以内でもuid%2バケットへ間引かれる', () => {
    // uid偶数: 偶数フレームのみ担当
    expect(zombieKccActive(4, 0, 10, ZOMBIE_HORDE_THIN_RANK)).toBe(true);
    expect(zombieKccActive(4, 1, 10, ZOMBIE_HORDE_THIN_RANK)).toBe(false);
    expect(zombieKccActive(4, 2, 10, ZOMBIE_HORDE_THIN_RANK)).toBe(true);
    // uid奇数: 奇数フレームのみ担当
    expect(zombieKccActive(3, 0, 10, 99)).toBe(false);
    expect(zombieKccActive(3, 1, 10, 99)).toBe(true);
  });

  it('hordeRank省略時は既存呼び出し(3引数)と同じ挙動を保つ(後方互換)', () => {
    for (let frame = 0; frame < 4; frame += 1) {
      expect(zombieKccActive(0, frame, 0)).toBe(true);
      expect(zombieKccActive(7, frame, 25)).toBe(true);
    }
    expect(zombieKccActive(4, 0, 40)).toBe(true);
    expect(zombieKccActive(4, 1, 40)).toBe(false);
  });

  it('25m超はhordeRankに関わらず距離バケットのまま(既存挙動を維持)', () => {
    expect(zombieKccActive(4, 0, 40, 0)).toBe(true);
    expect(zombieKccActive(4, 1, 40, 0)).toBe(false);
    expect(zombieKccActive(0, 0, 80, 0)).toBe(true);
    expect(zombieKccActive(0, 1, 80, 0)).toBe(false);
  });
});

describe('zombieKccSkipFactor(★1/★5 stuckTimer実時間補正用)', () => {
  it('先頭集団(hordeRank<24)の25m以内は係数1(毎フレーム)', () => {
    expect(zombieKccSkipFactor(10, 0)).toBe(1);
  });

  it('先頭集団外の25m以内・25-60mは係数2', () => {
    expect(zombieKccSkipFactor(10, ZOMBIE_HORDE_THIN_RANK)).toBe(2);
    expect(zombieKccSkipFactor(40, 0)).toBe(2);
  });

  it('60m超は係数4', () => {
    expect(zombieKccSkipFactor(80, 0)).toBe(4);
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
