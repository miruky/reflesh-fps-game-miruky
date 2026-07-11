import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SoundKit } from '../core/audio';
import { CAPSULE_RADIUS, Player, type MoveInput } from './player';

// R56 W3 回帰テスト: スライド中の壁貫通(トンネリング)バグ。
//
// 旧実装は水平変位0.5m超で computeColliderMovement を2-4分割していたが、各サブステップは
// 「同一のフレーム開始コライダー位置」から (希望移動量/分割数) を毎回クエリしていた(body の
// 実移動は全サブステップ完了後の setNextKinematicTranslation まで起きない)。壁が
// (全量/分割数) より遠く全量より近い位置にあると、どのサブステップも単独では壁に当たらず
// 素通り分をそのまま返す → 合算すると全量分の変位が確定し、壁の向こうへ貫通してしまう。
// 例: SLIDE_BOOST=92m/s, dt=1/60 → 全量 1.5333m を4分割 = 各0.3833m。壁までの隙間が
// 0.75m ならどのサブステップも0.3833mを完全に素通りし、合計1.5333m移動して貫通する。
//
// 修正: サブステップ加算をやめ、単一の computeColliderMovement 呼び出しにする。Rapier KCC は
// 内部でシェイプキャストによる連続衝突判定を行うため、単一クエリで正しく壁の手前に止まる。

beforeAll(async () => {
  await RAPIER.init();
});

const dt = 1 / 60;

const soundsStub = {
  footstep() {},
  mantle() {},
  slide() {},
  slideStart() {},
  slideStop() {},
  thrust() {},
  wallJump() {},
  wallRun() {},
} as unknown as SoundKit;

const NEUTRAL_INPUT: MoveInput = {
  x: 0,
  z: 0,
  jumpPressed: false,
  crouch: true, // スライド継続条件(!input.crouch で終了)を満たしておく
  crouchPressed: false,
  sprint: false,
  lean: 0,
};

// match.ts buildStageScene と同じ床: cuboid(half, 1.0, half) を (0,-1,0) に置く=天面 y=0
function makeWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(51, 1.0, 51).setTranslation(0, -1, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  return world;
}

// 前方(+x)、カプセル表面から gap[m] 離れた位置に薄い静的な壁を置く
function addWall(world: RAPIER.World, gap: number): void {
  const wallHalfX = 0.05;
  const wallCenterX = gap + CAPSULE_RADIUS + wallHalfX;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(wallHalfX, 3, 3).setTranslation(wallCenterX, 1, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
}

// 接地(grounded=true)が確定するまで無入力で数フレーム進める(match.ts と同順序:
// player.update → world.step)。スポーンは床天面と面一のため(R50 rapier#485)、1フレーム目は
// idle ジッタを注入してもまだ computedGrounded()=false のことがあり、2フレーム目で true に
// 安定する。
function warmUpUntilGrounded(world: RAPIER.World, player: Player): void {
  for (let i = 0; i < 10 && !player.grounded; i += 1) {
    player.update(dt, { ...NEUTRAL_INPUT, crouch: false }, 0, soundsStub);
    world.step();
  }
  if (!player.grounded) throw new Error('warm-up failed to ground the player');
}

// スライド状態(SLIDE_BOOST相当の速度・+x方向)へ直接遷移させて1フレーム進める
function primeSlideTowardPlusX(player: Player): void {
  const internal = player as unknown as {
    sliding: boolean;
    slideTimer: number;
    slideDir: THREE.Vector3;
  };
  internal.sliding = true;
  internal.slideTimer = 0; // slideSpeedAt(0) = SLIDE_BOOST = 92m/s
  internal.slideDir.set(1, 0, 0);
}

describe('スライド中の壁貫通(トンネリング)回帰防止(R56 W3)', () => {
  it('SLIDE_BOOST速度・壁まで0.75mの隙間でも壁を貫通しない', () => {
    const world = makeWorld();
    const gap = 0.75;
    addWall(world, gap);
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    warmUpUntilGrounded(world, player);

    primeSlideTowardPlusX(player);
    player.update(dt, NEUTRAL_INPUT, 0, soundsStub);
    world.step();

    // カプセル中心(x=0起点)が正しく停止する位置は「壁の近接面からコントローラoffset分だけ
    // 手前」= 概ね gap - 0.05 未満。旧実装(4分割加算)はここを ~1.5m まで踏み越えてしまう
    // (SLIDE_BOOST=92m/s, dt=1/60 の全量移動が素通りする)。
    expect(player.position.x).toBeLessThan(gap);
  });

  it.each([0.45, 0.75, 1.05, 1.35])('壁までの隙間 %sm でも貫通しない', (gap) => {
    const world = makeWorld();
    addWall(world, gap);
    const player = new Player(world, new THREE.Vector3(0, 0, 0));
    warmUpUntilGrounded(world, player);

    primeSlideTowardPlusX(player);
    player.update(dt, NEUTRAL_INPUT, 0, soundsStub);
    world.step();

    // 中心の変位が gap を超える = カプセル表面が壁の近接面より奥まで進んだ = 貫通
    expect(player.position.x).toBeLessThan(gap);
  });
});
