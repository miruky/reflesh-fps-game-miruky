import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from './bot';
import { ZombieDirector, type ZombieHost } from './zombie-director';

// R54 音響2 (M-AU): zombie-director.ts の setBgmStem('zombie-madness') / setHordeDensity /
// zombieVocal('spawn'|'close') / dispose時のsetHordeDensity(0,0) 配線の単体テスト。
// ZombieHost は match.ts への逆参照を持たないDIなので、実際に使われるパスだけを
// 満たす最小ホストを組み立てる(モード判定はconfig.mode!=='zombie'にしてInstancedMesh経路を回避)。

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
    config: { stage: { size: 100 }, difficulty: 'normal', mode: 'ffa' } as unknown as ZombieHost['config'],
    bots: [],
    scene: new THREE.Scene(),
    tags: new Map(),
    tracker: { onZombieRoundStart: vi.fn(), onZombieRoundEnd: vi.fn() } as unknown as ZombieHost['tracker'],
    weapons: [] as unknown as ZombieHost['weapons'],
    rand: () => 0.42,
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
    spawnBot: vi.fn(() => ({ uid: 1, tuning: { damage: 0 } }) as unknown as Bot),
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

function makeZombieBot(uid: number, pos: THREE.Vector3, alive = true): Bot {
  return {
    uid,
    kind: 'zombie',
    alive,
    tier: 'normal',
    position: pos,
    hordeRank: 99,
    crowdSlot: -1,
    getPositionInto: (out: THREE.Vector3) => out.copy(pos),
  } as unknown as Bot;
}

describe('zombie-director.ts 音響配線(R54 M-AU): BGMステム/群密度', () => {
  it('ラウンド進行中(zombieRound>0)はsetBgmStemが\'zombie-madness\'で呼ばれる', () => {
    const host = makeZombieHost();
    const director = new ZombieDirector(host);
    director.zombieRound = 3;
    director.zombieRoundCooldown = 0;
    director.zombieQueue = 5; // ラウンドクリア分岐(round-end)へ入らせない

    director.updateZombieDirector(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith('zombie-madness', expect.any(Number));
  });

  it('特殊ラウンド(rush)中は intensity=1 で呼ばれる', () => {
    const host = makeZombieHost();
    const director = new ZombieDirector(host);
    director.zombieRound = 5;
    director.zombieRoundCooldown = 0;
    director.zombieQueue = 5;
    director.zombieSpecialRound = 'rush';

    director.updateZombieDirector(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith('zombie-madness', 1);
  });

  it('ラウンド未開始(zombieRound===0)へ入る前段ではsetBgmStem(null,...)で通常BGMへ委ねる', () => {
    const host = makeZombieHost();
    const director = new ZombieDirector(host);
    director.zombieRound = 0;

    director.updateZombieDirector(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith(null, expect.any(Number));
  });

  it('setHordeDensityが0.5秒間隔で生存数/36と平均距離を供給する', () => {
    const host = makeZombieHost({
      bots: [
        makeZombieBot(1, new THREE.Vector3(10, 0, 0)),
        makeZombieBot(2, new THREE.Vector3(0, 0, 20)),
      ],
    });
    const director = new ZombieDirector(host);
    director.zombieRound = 3;
    director.zombieRoundCooldown = 0;
    director.zombieQueue = 5;

    // 0.5s未満(初回のみ即時発火。以降は間隔が閉じるまで再発火しない)
    director.updateZombieDirector(1 / 60);
    expect(host.sounds.setHordeDensity).toHaveBeenCalledTimes(1);
    const [density, avgDist] = (host.sounds.setHordeDensity as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(density).toBeCloseTo(2 / 36, 6);
    expect(avgDist).toBeCloseTo(15, 6); // (10 + 20) / 2

    director.updateZombieDirector(1 / 60);
    expect(host.sounds.setHordeDensity).toHaveBeenCalledTimes(1); // まだ再発火しない
  });
});

describe('zombie-director.ts 音響配線(R54 M-AU): dispose時のリセット', () => {
  it('dispose()でsetHordeDensity(0, 0)が呼ばれる(試合跨ぎの持ち越し防止)', () => {
    const host = makeZombieHost();
    const director = new ZombieDirector(host);

    director.dispose();

    expect(host.sounds.setHordeDensity).toHaveBeenCalledWith(0, 0);
  });
});

describe('zombie-director.ts 音響配線(R54 M-AU): 接近ボイス', () => {
  it('プレイヤーから2.5m未満のゾンビにzombieVocal(\'close\', ...)が発火する', () => {
    const closeBot = makeZombieBot(11, new THREE.Vector3(1, 0, 0)); // 距離1m
    const farBot = makeZombieBot(12, new THREE.Vector3(10, 0, 0)); // 距離10m
    const host = makeZombieHost({ bots: [closeBot, farBot] });
    const director = new ZombieDirector(host);

    director.updateZombieHordeRank();

    const calls = (host.sounds.zombieVocal as ReturnType<typeof vi.fn>).mock.calls;
    const closeCalls = calls.filter((c) => c[0] === 'close');
    expect(closeCalls.length).toBe(1);
    expect(closeCalls[0]?.[3]).toBe(11 % 3); // variant = uid % 3
  });

  it('2.5m以上離れたゾンビにはzombieVocal(\'close\')が発火しない', () => {
    const farBot = makeZombieBot(21, new THREE.Vector3(10, 0, 0));
    const host = makeZombieHost({ bots: [farBot] });
    const director = new ZombieDirector(host);

    director.updateZombieHordeRank();

    const calls = (host.sounds.zombieVocal as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter((c) => c[0] === 'close').length).toBe(0);
  });
});
