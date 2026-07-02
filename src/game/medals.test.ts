import { describe, expect, it } from 'vitest';
import { MedalTracker, type KillCtx, type MedalEvent, type MedalId } from './medals';

function mk(overrides: Partial<KillCtx> = {}): KillCtx {
  return {
    victimName: 'bot',
    headshot: false,
    weaponName: 'カエデAR',
    weaponClass: 'ar',
    scopeWeapon: false,
    adsProgress: 0,
    adsAgeMs: 9999,
    distM: 15, // point-blank(3.5)とlongshot(AR38)の間で、距離系メダルは出ない
    victimFullHp: false,
    bulletsThisShot: 1,
    fromBehind: false,
    grounded: true,
    sliding: false,
    wallRunning: false,
    ultActive: false,
    streak: 1,
    ...overrides,
  };
}

const ids = (out: MedalEvent[]): MedalId[] => out.map((m) => m.id);

describe('連続キル(ローリング窓)', () => {
  it('短時間に2キルで DOUBLE KILL、3キルで TRIPLE KILL', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('double-kill');
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).toContain('double-kill');
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).toContain('triple-kill');
  });

  it('窓が切れると連続がリセットされる', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.tick(6); // 窓(<=5s)を超過
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('double-kill'); // chain=1へ戻る
  });
});

describe('死亡で連続系リセット', () => {
  it('onPlayerDeath 後の次キルは連続にならない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.onPlayerDeath('enemy');
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('double-kill');
  });

  it('REVENGE: 自分を倒した相手を次に倒すと発火', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onPlayerDeath('enemy7');
    t.onKill(mk({ victimName: 'enemy7' }), out);
    expect(ids(out)).toContain('revenge');
  });
});

describe('キルストリーク(1ライフ)', () => {
  it('streak 5 で BLOODTHIRSTY、30 で UNSTOPPABLE+NUCLEAR', () => {
    const t = new MedalTracker(new Set());
    let out: MedalEvent[] = [];
    t.onKill(mk({ streak: 5 }), out);
    expect(ids(out)).toContain('bloodthirsty');
    out = [];
    t.onKill(mk({ streak: 30 }), out);
    expect(ids(out)).toContain('unstoppable');
    expect(ids(out)).toContain('nuclear');
  });
});

describe('初取得=firstUnlock / 2回目以降=false / counts集計', () => {
  it('同じメダルの2回目は firstUnlock=false、counts=2', () => {
    const t = new MedalTracker(new Set());
    let out: MedalEvent[] = [];
    t.onKill(mk({ distM: 2 }), out); // point-blank
    const first = out.find((m) => m.id === 'point-blank');
    expect(first?.firstUnlock).toBe(true);
    out = [];
    t.onKill(mk({ distM: 2 }), out);
    const second = out.find((m) => m.id === 'point-blank');
    expect(second?.firstUnlock).toBe(false);
    expect(t.counts['point-blank']).toBe(2);
    expect(t.newlyUnlocked.has('point-blank')).toBe(true);
  });

  it('既知メダルを注入すると初回から firstUnlock=false', () => {
    const t = new MedalTracker(new Set<string>(['point-blank']));
    const out: MedalEvent[] = [];
    t.onKill(mk({ distM: 2 }), out);
    expect(out.find((m) => m.id === 'point-blank')?.firstUnlock).toBe(false);
    expect(t.newlyUnlocked.has('point-blank')).toBe(false);
  });
});

describe('距離・武器・状況メダル', () => {
  it('LONGSHOT は AR で 38m 以上', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ distM: 40 }), out);
    expect(ids(out)).toContain('longshot');
  });

  it('ONE SHOT: スナイパーで満タン即死', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'sniper', scopeWeapon: true, adsProgress: 1, victimFullHp: true }), out);
    expect(ids(out)).toContain('one-shot');
  });

  it('BACKSTAB: 近接で背後から', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponName: '近接', fromBehind: true }), out);
    expect(ids(out)).toContain('backstab');
  });
});

describe('機構メダルの排他', () => {
  it('ウォールラン中は wall-hunter のみ(slide/skyfall は出ない)', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ wallRunning: true, sliding: true, grounded: false }), out);
    expect(ids(out)).toContain('wall-hunter');
    expect(ids(out)).not.toContain('slide-kill');
    expect(ids(out)).not.toContain('skyfall');
  });

  it('RONIN: スコープ未覗き込み + 空中 で no-scope を置き換える', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.2, grounded: false }), out);
    expect(ids(out)).toContain('ronin');
    expect(ids(out)).not.toContain('no-scope');
  });

  it('QUICKSCOPE: 覗き込み直後の即撃ち', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300 }), out);
    expect(ids(out)).toContain('quickscope');
  });
});

describe('QuadFeed と Collateral', () => {
  it('分断されない4連続キルで QUAD FEED', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t.onKill(mk(), out);
    expect(ids(out)).toContain('quad-feed');
  });

  it('他者キルで分断されると QUAD FEED は出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.onKill(mk(), out);
    t.onFeed(false); // 他者のキルで分断
    t.onKill(mk(), out);
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('quad-feed');
  });

  it('先頭4キルが2秒超でも、直近4キルが2秒以内ならローリング窓で QUAD FEED', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    // 1,2キル目を間延びさせ、先頭固定窓(1-4)は2秒を超える状況を作る
    t.onKill(mk(), out); // t=0
    t.tick(1.6);
    t.onKill(mk(), out); // t=1.6
    t.tick(0.2);
    t.onKill(mk(), out); // t=1.8
    t.tick(0.2);
    out.length = 0;
    t.onKill(mk(), out); // t=2.0 → 直近4キル(0,1.6,1.8,2.0)は2.0秒ちょうどで成立
    expect(ids(out)).toContain('quad-feed');
  });

  it('連続8キルで QUAD FEED は2回(4キルごとに再武装)', () => {
    const t = new MedalTracker(new Set());
    let quads = 0;
    for (let i = 0; i < 8; i += 1) {
      const out: MedalEvent[] = [];
      t.onKill(mk(), out);
      if (ids(out).includes('quad-feed')) quads += 1;
    }
    expect(quads).toBe(2);
  });

  it('3連続キル(1.4秒以内)で TRIPLE FEED', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.tick(0.5);
    t.onKill(mk(), out);
    t.tick(0.5);
    t.onKill(mk(), out);
    expect(ids(out)).toContain('triple-feed');
  });

  it('4連フィードが全てヘッドショットなら QHSF(混在なら出ない)', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('quad-feed');
    expect(ids(out)).toContain('qhsf');

    const t2 = new MedalTracker(new Set());
    const out2: MedalEvent[] = [];
    t2.onKill(mk({ headshot: true }), out2);
    t2.onKill(mk(), out2); // 1発だけ胴
    t2.onKill(mk({ headshot: true }), out2);
    t2.onKill(mk({ headshot: true }), out2);
    expect(ids(out2)).toContain('quad-feed');
    expect(ids(out2)).not.toContain('qhsf');
  });

  it('5連続キル(3秒以内)で MEGA FEED、分断でリセット', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) {
      t.onKill(mk(), out);
      t.tick(0.4);
    }
    expect(ids(out)).toContain('mega-feed');

    const t2 = new MedalTracker(new Set());
    const out2: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t2.onKill(mk(), out2);
    t2.onFeed(false); // 分断
    t2.onKill(mk(), out2);
    expect(ids(out2)).not.toContain('mega-feed');
  });

  it('Collateral は2体以上で発火、1体では出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onCollateral(1, out);
    expect(ids(out)).not.toContain('collateral');
    t.onCollateral(2, out);
    expect(ids(out)).toContain('collateral');
  });
});
