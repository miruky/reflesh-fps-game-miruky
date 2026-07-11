import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Bot, DIFFICULTY, type BotContext, type BotTuning } from './bot';
import { ZombieDirector, type ZombieHost } from './zombie-director';
import { zombieBossSpeedMul } from './zombie';

// R57 ⑥修正2(確証finding修正・LOW): ゾンビボスの速度二重適用(speedMul²)バグの回帰テスト。
//
// 旧実装の spawnBossZombie は tuning.moveSpeedMul = ZOMBIE_MOVE_MUL * speedMul(→construction時に
// bot.moveSpeed = MOVE_SPEED * tuning.moveSpeedMul へ焼き込まれる)と、bot.zombieRunMul = speedMul
// の両方に speedMul を設定していた。updateZombie の実効速度は spd = moveSpeed * zombieRunMul の
// ため、実効的には speedMul が2回掛かり(speedMul²)、意図(1回だけ適用。r5=1.2倍→上限2.0倍)を
// 超過していた(逆に低rでは通常走行ゾンビより遅くなる逆転現象も起きていた)。
// 通常/eliteゾンビは moveSpeedMul と zombieRunMul を別用途(elite倍率 vs 走行/シャンブル)で
// 正しく使い分けており、二重適用していたのはボスのみだった。

function makeZombieHost(overrides: Partial<ZombieHost> = {}): ZombieHost {
  const base: ZombieHost = {
    player: {
      alive: true,
      position: new THREE.Vector3(0, 0, 0),
      eyePosition: new THREE.Vector3(0, 1.6, 0),
      yaw: 0,
    } as unknown as ZombieHost['player'],
    sounds: {
      setBgmStem: vi.fn(),
      setHordeDensity: vi.fn(),
      zombieVocal: vi.fn(),
      heartbeat: vi.fn(),
      hurt: vi.fn(),
      specialRoundStart: vi.fn(),
      specialRoundClear: vi.fn(),
      capture: vi.fn(),
    } as unknown as ZombieHost['sounds'],
    announcements: [],
    config: {
      stage: { size: 100 },
      difficulty: 'normal',
      mode: 'zombie',
      hellMode: false,
    } as unknown as ZombieHost['config'],
    bots: [],
    scene: new THREE.Scene(),
    tags: new Map(),
    tracker: { onZombieRoundStart: vi.fn(), onZombieRoundEnd: vi.fn() } as unknown as ZombieHost['tracker'],
    weapons: [] as unknown as ZombieHost['weapons'],
    rand: () => 0.3,
    effects: {} as unknown as ZombieHost['effects'],
    settings: {} as unknown as ZombieHost['settings'],
    activeWeapon: {} as unknown as ZombieHost['activeWeapon'],
    incoming: [],
    feed: [],
    elapsed: 0,
    moments: [],
    physics: {} as unknown as ZombieHost['physics'],
    viewModel: {} as unknown as ZombieHost['viewModel'],
    renderer: {} as unknown as ZombieHost['renderer'],
    over: false,
    input: {} as unknown as ZombieHost['input'],
    activeIndex: 0,
    addShake: vi.fn(),
    notePlayerDeath: vi.fn(),
    applyBotDamage: vi.fn(() => false),
    spawnBot: vi.fn(
      () => ({ uid: 1, tuning: { damage: 0 }, zombieRunMul: 1 }) as unknown as Bot,
    ),
    emitMedals: vi.fn(),
    castRay: vi.fn(() => null),
    refillGrenades: vi.fn(),
    isInView: vi.fn(() => false),
    haptic: vi.fn(),
    addUltCharge: vi.fn(),
    snapToGround: vi.fn(() => 0),
    incomingAngle: vi.fn(() => 0),
    setTookDamage: vi.fn(),
    setShakeTrauma: vi.fn(),
    setDeathPos: vi.fn(),
    setKiller: vi.fn(),
    setKillcamTimer: vi.fn(),
    setDeathVeil: vi.fn(),
    setAdsLatch: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe('zombie-director.ts spawnBossZombie(R57 ⑥修正2): 速度倍率は1回だけ適用', () => {
  it('host.spawnBotへ渡すtuning.moveSpeedMulにspeedMulが乗るが、bot.zombieRunMulはspeedMulで上書きされない', () => {
    const spawnBot = vi.fn<ZombieHost['spawnBot']>(
      () => ({ uid: 1, tuning: { damage: 0 }, zombieRunMul: 1 }) as unknown as Bot,
    );
    const host = makeZombieHost({ spawnBot });
    const director = new ZombieDirector(host);

    director.spawnBossZombie(5); // r5: zombieBossSpeedMul(5) = 1.2

    expect(spawnBot).toHaveBeenCalledTimes(1);
    const tuningArg = spawnBot.mock.calls[0]![4] as BotTuning; // spawnBot(name,spawn,color,team,tuning,tier,kind)
    const speedMul = zombieBossSpeedMul(5);
    expect(speedMul).toBeCloseTo(1.2, 5);
    // moveSpeedMul側だけがspeedMulを担う(ZOMBIE_MOVE_MUL(=1.44)*speedMul)
    expect(tuningArg.moveSpeedMul).toBeCloseTo(1.44 * speedMul, 5);

    const bot = spawnBot.mock.results[0]!.value as { zombieRunMul: number };
    // 修正前は speedMul(=1.2) で上書きされていた。修正後はzombieRunMulに一切触れないため
    // spawnBot側の初期値(既定1)のまま=speedMulの二重適用が起きない。
    expect(bot.zombieRunMul).toBe(1);
  });

  it('高ラウンド(speedMul上限2.0)でもzombieRunMulは上書きされない', () => {
    const spawnBot = vi.fn<ZombieHost['spawnBot']>(
      () => ({ uid: 2, tuning: { damage: 0 }, zombieRunMul: 1 }) as unknown as Bot,
    );
    const host = makeZombieHost({ spawnBot });
    const director = new ZombieDirector(host);

    director.spawnBossZombie(100); // 高rでspeedMulはcap(2.0)に達する

    const speedMul = zombieBossSpeedMul(100);
    expect(speedMul).toBeCloseTo(2.0, 5);
    const tuningArg = spawnBot.mock.calls[0]![4] as BotTuning;
    expect(tuningArg.moveSpeedMul).toBeCloseTo(1.44 * 2.0, 5);
    const bot = spawnBot.mock.results[0]!.value as { zombieRunMul: number };
    expect(bot.zombieRunMul).toBe(1);
  });
});

// ── 実物理での「実効速度は1回分」検証(bot.ts updateZombie: spd = moveSpeed * zombieRunMul) ──
// spawnBossZombieが実際に生成するのと同じ形のtuning(moveSpeedMul = ZOMBIE_MOVE_MUL*speedMul,
// zombieRunMul = 1)をBotへ直接与え、speedMulが2倍のボス個体の実効速度が「ちょうど2倍」になる
// (2倍²=4倍にはならない)ことを、壁なしの開けた場での実測移動量で確認する。
describe('Bot ゾンビボス実効速度(R57 ⑥修正2): moveSpeedMul一本でspeedMulを反映(zombieRunMul=1)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  const ZOMBIE_MOVE_MUL = 1.44; // zombie-director.ts と同値(private constのためテスト側で複製)

  function makeOpenWorld(): RAPIER.World {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0),
      floorBody,
    );
    return world;
  }

  function makeBossLikeZombie(world: RAPIER.World, speedMul: number): Bot {
    const tuning: BotTuning = { ...DIFFICULTY.normal, moveSpeedMul: ZOMBIE_MOVE_MUL * speedMul };
    const zombie = new Bot(
      world,
      '巨躯',
      new THREE.Vector3(0, 0, 0),
      0x3a1a0d,
      tuning,
      2,
      'boss',
      'zombie',
    );
    zombie.zombieRunMul = 1; // spawnBossZombie(修正後)と同じ配線: speedMulはmoveSpeedMul側のみ
    return zombie;
  }

  function measureHorizontalSpeed(speedMul: number): number {
    const world = makeOpenWorld();
    const zombie = makeBossLikeZombie(world, speedMul);
    world.step();
    const ctx: BotContext = {
      // 遠方(meleeRangeの意図的減速0.15倍が掛からない距離)へまっすぐ向かわせる
      targetEye: new THREE.Vector3(0, 1.5, -100),
      objective: null,
      tuning: { ...DIFFICULTY.normal },
      rand: () => 0.5,
      onShoot: () => {},
      onMelee: () => {},
    };
    const dt = 1 / 60;
    const before = zombie.position.clone();
    // 数フレーム進めて定常状態の移動量を測る(初速安定後の10フレーム分)
    for (let i = 0; i < 5; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    const mid = zombie.position.clone();
    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      zombie.update(dt, ctx);
      world.step();
    }
    const after = zombie.position.clone();
    const dx = after.x - mid.x;
    const dz = after.z - mid.z;
    void before;
    return Math.hypot(dx, dz) / (steps * dt);
  }

  it('speedMul=2倍の個体の実効水平速度は基準(speedMul=1)のちょうど2倍(4倍=二重適用は再発しない)', () => {
    const baseSpeed = measureHorizontalSpeed(1);
    const doubledSpeed = measureHorizontalSpeed(2);
    expect(baseSpeed).toBeGreaterThan(0);
    const ratio = doubledSpeed / baseSpeed;
    // 単一適用なら比は2.0。旧バグ(二重適用)なら比は4.0になっていたはず。
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('r5相当(speedMul=1.2)の実効水平速度は基準の1.2倍(1.44倍=二重適用は再発しない)', () => {
    const baseSpeed = measureHorizontalSpeed(1);
    const r5Speed = measureHorizontalSpeed(1.2);
    const ratio = r5Speed / baseSpeed;
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.3);
  });
});
