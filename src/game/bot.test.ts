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
