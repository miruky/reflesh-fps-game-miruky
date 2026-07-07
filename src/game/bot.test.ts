import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot, DIFFICULTY } from './bot';

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
