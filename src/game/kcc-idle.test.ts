import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SoundKit } from '../core/audio';
import { KCC_IDLE_JITTER_M, Player, type MoveInput } from './player';

// Rapier KCC 退化ケース(dimforge/rapier#485)の回帰テスト。
// 水平成分が厳密に 0 の純垂直 computeColliderMovement を、床天面と隙間 0 の「面一」接触で
// 発行し続けると接地解決が退化し、キャラクターが床へ沈み込む(修正前の実測: 約168フレーム=
// 2.8秒で y<-7 まで落下)。プレイヤーのスポーンは全ステージで床天面 y=0 と面一のため、
// 「試合開始直後に静止したままだと地面の下に落ちる」として発現していた。
// 対策 = 静止フレームのみ ±KCC_IDLE_JITTER_M の交互ジッタをクエリへ注入(player.ts update)。

beforeAll(async () => {
  await RAPIER.init();
});

const IDLE_INPUT: MoveInput = {
  x: 0,
  z: 0,
  jumpPressed: false,
  crouch: false,
  crouchPressed: false,
  sprint: false,
  lean: 0,
};

// player.update が呼ぶ可能性のある効果音のみのスタブ(静止では footstep 着地のみ到達しうる)
const soundsStub = {
  footstep() {},
  mantle() {},
  slide() {},
  thrust() {},
  wallJump() {},
  wallRun() {},
} as unknown as SoundKit;

// match.ts buildStageScene と同じ床: cuboid(half, 1.0, half) を (0,-1,0) に置く=天面 y=0
function makeWorldWithFloor(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(51, 1.0, 51).setTranslation(0, -1, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  return world;
}

describe('KCC 静止退化(rapier#485)の回帰防止', () => {
  it('床天面と面一スポーンで無入力のまま10秒経過しても床下へ沈まない', () => {
    const world = makeWorldWithFloor();
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    const dt = 1 / 60;
    let minY = Infinity;
    // match と同じ順序: player.update → world.step
    for (let i = 0; i < 600; i += 1) {
      player.update(dt, IDLE_INPUT, 0, soundsStub);
      world.step();
      minY = Math.min(minY, player.body.translation().y);
    }
    // body中心はカプセル分だけ床上(≈0.95)。修正前は -7 以下まで沈む。
    expect(minY).toBeGreaterThan(0.5);
  });

  it('静止ジッタは正味ドリフトをほぼ生まない(10秒でサブmm)', () => {
    const world = makeWorldWithFloor();
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    const dt = 1 / 60;
    for (let i = 0; i < 600; i += 1) {
      player.update(dt, IDLE_INPUT, 0, soundsStub);
      world.step();
    }
    const t = player.body.translation();
    // 交互符号で相殺されるため、水平位置は 1 ジッタ幅のオーダーに留まる
    expect(Math.hypot(t.x, t.z)).toBeLessThan(KCC_IDLE_JITTER_M * 20);
  });
});
