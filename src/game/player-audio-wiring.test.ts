import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SoundKit } from '../core/audio';
import { Player, type MoveInput } from './player';

// R54 音響2 (M-AU): player.ts のスライド/ウォールラン → slideStart/slideStop/wallRunKick 配線の
// 回帰テスト。kcc-idle.test.ts と同じ「実Rapier + SoundKitスタブ」方式(挙動そのものは非対象)。

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorldWithFloor(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(51, 1.0, 51).setTranslation(0, -1, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  return world;
}

type SoundsSpy = SoundKit & {
  footstep: ReturnType<typeof vi.fn>;
  mantle: ReturnType<typeof vi.fn>;
  thrust: ReturnType<typeof vi.fn>;
  wallJump: ReturnType<typeof vi.fn>;
  wallRun: ReturnType<typeof vi.fn>;
  wallRunKick: ReturnType<typeof vi.fn>;
  slideStart: ReturnType<typeof vi.fn>;
  slideStop: ReturnType<typeof vi.fn>;
};

function makeSoundsSpy(): SoundsSpy {
  return {
    footstep: vi.fn(),
    mantle: vi.fn(),
    thrust: vi.fn(),
    wallJump: vi.fn(),
    wallRun: vi.fn(),
    wallRunKick: vi.fn(),
    slideStart: vi.fn(),
    slideStop: vi.fn(),
  } as unknown as SoundsSpy;
}

const FORWARD_SPRINT: MoveInput = {
  x: 0,
  z: 1,
  jumpPressed: false,
  crouch: false,
  crouchPressed: false,
  sprint: true,
  lean: 0,
};

describe('player.ts 音響配線(R54 M-AU): スライド', () => {
  it('スライド開始で slideStart(speed01) が1回、slide()(旧API)は呼ばれない', () => {
    const world = makeWorldWithFloor();
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    const sounds = makeSoundsSpy();
    const dt = 1 / 60;
    // スプリントで SLIDE_ENTER_SPEED を超える速度を作る
    for (let i = 0; i < 30; i += 1) {
      player.update(dt, FORWARD_SPRINT, 0, sounds);
      world.step();
    }
    expect(sounds.slideStart).not.toHaveBeenCalled();
    // しゃがみ押下でスライド開始
    const slideInput: MoveInput = { ...FORWARD_SPRINT, crouch: true, crouchPressed: true };
    player.update(dt, slideInput, 0, sounds);
    world.step();
    expect(player.sliding).toBe(true);
    expect(sounds.slideStart).toHaveBeenCalledTimes(1);
    const speed01 = sounds.slideStart.mock.calls[0]?.[0] as number;
    // 速度比 = 突入時の実速度/最大スライド速度(0より大きく1以下)
    expect(speed01).toBeGreaterThan(0);
    expect(speed01).toBeLessThanOrEqual(1);
  });

  it('スライド終了(自然タイムアウト)で slideStop が呼ばれる', () => {
    const world = makeWorldWithFloor();
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    const sounds = makeSoundsSpy();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i += 1) {
      player.update(dt, FORWARD_SPRINT, 0, sounds);
      world.step();
    }
    const slideInput: MoveInput = { ...FORWARD_SPRINT, crouch: true, crouchPressed: true };
    player.update(dt, slideInput, 0, sounds);
    world.step();
    expect(player.sliding).toBe(true);
    expect(sounds.slideStop).not.toHaveBeenCalled();
    // しゃがみ保持のまま SLIDE_DURATION(0.85s) を超えるまで進める
    const holdInput: MoveInput = { ...FORWARD_SPRINT, crouch: true, crouchPressed: false };
    for (let i = 0; i < 60; i += 1) {
      player.update(dt, holdInput, 0, sounds);
      world.step();
    }
    expect(player.sliding).toBe(false);
    expect(sounds.slideStop).toHaveBeenCalled();
  });

  it('ジャンプによるスライドキャンセルでも slideStop が呼ばれる', () => {
    const world = makeWorldWithFloor();
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    const sounds = makeSoundsSpy();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i += 1) {
      player.update(dt, FORWARD_SPRINT, 0, sounds);
      world.step();
    }
    const slideInput: MoveInput = { ...FORWARD_SPRINT, crouch: true, crouchPressed: true };
    player.update(dt, slideInput, 0, sounds);
    world.step();
    expect(player.sliding).toBe(true);
    // 接地中にジャンプ入力でスライドキャンセル(MW2019式)
    const jumpCancel: MoveInput = { ...FORWARD_SPRINT, crouch: true, crouchPressed: false, jumpPressed: true };
    player.update(dt, jumpCancel, 0, sounds);
    world.step();
    expect(player.sliding).toBe(false);
    expect(sounds.slideStop).toHaveBeenCalled();
  });
});

describe('player.ts 音響配線(R54 M-AU): ウォールラン', () => {
  it('ウォールラン中に周期的な wallRunKick が(取り付き音の1発を超えて)複数回発火する', () => {
    const world = makeWorldWithFloor();
    // 進行方向(-z)に沿う縦の壁を+x側の至近(検知半径0.67m以内)に設置
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 7.5, 50).setTranslation(0.55, 2.5, 0),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
    // 床より高い位置から前進落下させ、空中+前進+検知範囲内の壁でウォールランへ入る
    const player = new Player(world, new THREE.Vector3(0, 3, 0));
    const sounds = makeSoundsSpy();
    const dt = 1 / 60;
    const input: MoveInput = { x: 0, z: 1, jumpPressed: false, crouch: false, crouchPressed: false, sprint: true, lean: 0 };
    let sawWallRunning = false;
    for (let i = 0; i < 150; i += 1) {
      player.update(dt, input, 0, sounds);
      world.step();
      if (player.wallRunning) sawWallRunning = true;
    }
    expect(sawWallRunning).toBe(true);
    expect(sounds.wallRun).toHaveBeenCalled();
    // wallRun()自体が取り付き時に1発鳴らす(wallRunKickへの委譲)。周期発火が機能していれば
    // それを超える回数記録される
    expect(sounds.wallRunKick.mock.calls.length).toBeGreaterThan(1);
  });
});
