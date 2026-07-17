import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from './bot';
import { ZombieDirector, type ZombieHost } from './zombie-director';

// R55 ⑧: 「ゾンビがプロップに引っかかって死なずラウンドが変わらない」バグの最終安全弁の
// 配線テスト。bot.ts側(Bot.zombieHardStuck/zombieHardStuckForceゲッター。詳細は
// bot.test.ts『Bot ゾンビ hardStuckサンプリング』参照)が「本当に前進できていない」個体を
// マークし、zombie-director.ts の updateZombieDirector が毎フレームそれを走査して
// zombieSpawnPoint() が返す有効なスポーン点へ blinkTo で再配置する。
// ZombieHost は match.ts への逆参照を持たないDIなので、実際に使われるパスだけを
// 満たす最小ホストを組み立てる(zombie-director-audio-wiring.test.ts と同じ流儀)。

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

// R55: 実Botではなく最小モック(kind/alive/position/zombieHardStuck系/blinkTo)。
// 他のBotフィールドは updateZombieDirector 冒頭〜スキャン地点までの経路では未参照。
function makeStuckZombieBot(
  uid: number,
  pos: THREE.Vector3,
  opts: { hardStuck: boolean; force: boolean; feetY?: number },
): Bot {
  return {
    uid,
    kind: 'zombie',
    alive: true,
    tier: 'normal',
    position: pos,
    feetY: opts.feetY ?? 0,
    hordeRank: 99,
    crowdSlot: -1,
    zombieHardStuck: opts.hardStuck,
    zombieHardStuckForce: opts.force,
    blinkTo: vi.fn(),
    getPositionInto: (out: THREE.Vector3) => out.copy(pos),
  } as unknown as Bot;
}

// ラウンド進行の副作用(スポーン湧き/ラウンドクリア分岐)を避けるための共通セットアップ。
// zombieRound>0でround-0初期化を避け、zombieQueue=0且つaliveZ>=1(=stuckBotが生存)で
// 湧き/クリア分岐の両方を素通りさせる(このテストが検証したいのはスキャン処理単体)。
function armDirector(director: ZombieDirector): void {
  director.zombieRound = 3;
  director.zombieRoundCooldown = 0;
  director.zombieQueue = 0;
}

describe('zombie-director.ts ⑧ 最終安全弁(R55): hardStuck個体のテレポート救済配線', () => {
  it('視界外のhardStuck個体をzombieSpawnPoint()の有効点へblinkToで再配置する', () => {
    const stuckBot = makeStuckZombieBot(1, new THREE.Vector3(5, 0, 5), {
      hardStuck: true,
      force: false,
    });
    const host = makeZombieHost({ bots: [stuckBot], isInView: vi.fn(() => false) });
    const director = new ZombieDirector(host);
    armDirector(director);

    director.updateZombieDirector(1 / 60);

    expect(stuckBot.blinkTo).toHaveBeenCalledTimes(1);
    const args = (stuckBot.blinkTo as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toHaveLength(3);
    for (const v of args as number[]) expect(Number.isFinite(v)).toBe(true);
  });

  it('視界内では強制段階(zombieHardStuckForce)でない限り再配置を見送る', () => {
    const stuckBot = makeStuckZombieBot(2, new THREE.Vector3(5, 0, 5), {
      hardStuck: true,
      force: false,
    });
    const host = makeZombieHost({ bots: [stuckBot], isInView: vi.fn(() => true) });
    const director = new ZombieDirector(host);
    armDirector(director);

    director.updateZombieDirector(1 / 60);

    expect(stuckBot.blinkTo).not.toHaveBeenCalled();
  });

  it('視界内でもzombieHardStuckForce(強制段階)なら再配置する(ラウンド進行の絶対保証)', () => {
    const stuckBot = makeStuckZombieBot(3, new THREE.Vector3(5, 0, 5), {
      hardStuck: true,
      force: true,
    });
    const host = makeZombieHost({ bots: [stuckBot], isInView: vi.fn(() => true) });
    const director = new ZombieDirector(host);
    armDirector(director);

    director.updateZombieDirector(1 / 60);

    expect(stuckBot.blinkTo).toHaveBeenCalledTimes(1);
  });

  it('zombieHardStuckでない個体には触れない(非回帰)', () => {
    const okBot = makeStuckZombieBot(4, new THREE.Vector3(5, 0, 5), {
      hardStuck: false,
      force: false,
    });
    const host = makeZombieHost({ bots: [okBot] });
    const director = new ZombieDirector(host);
    armDirector(director);

    // スキャン周期(1s)をまたいでも触れないことを確認
    director.updateZombieDirector(0.6);
    director.updateZombieDirector(0.6);

    expect(okBot.blinkTo).not.toHaveBeenCalled();
  });

  it('床下に埋没した個体はhardStuck待ちや視界外待ちなしで救済する', () => {
    const buriedBot = makeStuckZombieBot(6, new THREE.Vector3(5, 0.3, 5), {
      hardStuck: false,
      force: false,
      feetY: -0.3,
    });
    const host = makeZombieHost({ bots: [buriedBot], isInView: vi.fn(() => true) });
    const director = new ZombieDirector(host);
    armDirector(director);

    director.updateZombieDirector(1 / 60);

    expect(buriedBot.blinkTo).toHaveBeenCalledTimes(1);
  });

  it('有効なスポーン点が見つからない場合は何もしない(次周期へ先送り。例外を投げない)', () => {
    const stuckBot = makeStuckZombieBot(5, new THREE.Vector3(5, 0, 5), {
      hardStuck: true,
      force: false,
    });
    // isInView=trueかつforce=falseなら見送られる経路と重複しないよう、ここでは
    // isInView=falseのまま『地面が高すぎて候補点が常に却下される』ケースを再現する
    // (castRayが常にヒットしTOI=0付近→groundY>0.6で全試行棄却)。
    const host = makeZombieHost({
      bots: [stuckBot],
      isInView: vi.fn(() => false),
      castRay: vi.fn(() => ({ toi: 0 }) as unknown as ReturnType<ZombieHost['castRay']>),
    });
    const director = new ZombieDirector(host);
    armDirector(director);

    expect(() => director.updateZombieDirector(1 / 60)).not.toThrow();
    expect(stuckBot.blinkTo).not.toHaveBeenCalled();
  });
});
