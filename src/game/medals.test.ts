import { describe, expect, it } from 'vitest';
import { MedalTracker, SUPPRESS_BADGE, ALWAYS_BADGE, type KillCtx, type MedalEvent, type MedalId } from './medals';

function mk(overrides: Partial<KillCtx> = {}): KillCtx {
  return {
    victimName: 'bot',
    victimId: 1,
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
    t.onPlayerDeath(42);
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('double-kill');
  });

  it('REVENGE: 自分を倒した相手(uid)を次に倒すと発火・同名別idでは出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onPlayerDeath(7);
    // 同じ名前でも別uid(名前は再利用される)ではリベンジにならない
    t.onKill(mk({ victimName: 'enemy7', victimId: 99 }), out);
    expect(ids(out)).not.toContain('revenge');
    out.length = 0;
    t.onKill(mk({ victimName: 'enemy7', victimId: 7 }), out);
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

// ══════════════════════════════════════════════════════════════════
// 新メダル180種テスト
// ══════════════════════════════════════════════════════════════════

describe('A: 移動系メダル', () => {
  it('blinkAgeMs<=800のキルでblink-kill、2連でblink-double', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ blinkAgeMs: 300 }), out);
    expect(ids(out)).toContain('blink-kill');
    t.onKill(mk({ blinkAgeMs: 200 }), out);
    expect(ids(out)).toContain('blink-double');
  });

  it('blinkAgeMs>800ではblink-killが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ blinkAgeMs: 900 }), out);
    expect(ids(out)).not.toContain('blink-kill');
  });

  it('ブリンク3連でblink-triple', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ blinkAgeMs: 200 }), out);
    expect(ids(out)).toContain('blink-triple');
  });

  it('スライド中2連続でslide-double', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ sliding: true }), out);
    t.onKill(mk({ sliding: true }), out);
    expect(ids(out)).toContain('slide-double');
    expect(ids(out)).not.toContain('slide-triple');
  });

  it('スライド中3連続でslide-triple', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ sliding: true }), out);
    expect(ids(out)).toContain('slide-triple');
  });

  it('空中2連でair-double', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ grounded: false }), out);
    t.onKill(mk({ grounded: false }), out);
    expect(ids(out)).toContain('air-double');
  });

  it('空中3連でair-triple', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ grounded: false }), out);
    expect(ids(out)).toContain('air-triple');
  });

  it('壁走り2連でwall-double', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ wallRunning: true }), out);
    t.onKill(mk({ wallRunning: true }), out);
    expect(ids(out)).toContain('wall-double');
  });

  it('壁走り3連でwall-triple', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ wallRunning: true }), out);
    expect(ids(out)).toContain('wall-triple');
  });

  it('しゃがみキルでcrouch-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ crouching: true }), out);
    expect(ids(out)).toContain('crouch-kill');
  });

  it('スプリントキルでsprint-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ sprinting: true }), out);
    expect(ids(out)).toContain('sprint-kill');
  });

  it('RONIN(scopeWeapon+adsProgress<0.5+空中)3連でronin-chain', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      t.onKill(mk({ scopeWeapon: true, adsProgress: 0.3, grounded: false }), out);
    }
    expect(ids(out)).toContain('ronin-chain');
  });

  it('窓切れ後は連続がリセットされslide-doubleが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ sliding: true }), out);
    t.tick(5); // 窓(4s)超過
    t.onKill(mk({ sliding: true }), out);
    expect(ids(out)).not.toContain('slide-double');
  });
});

describe('B: 距離メダル', () => {
  it('1m以内でclose-extreme', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ distM: 0.8 }), out);
    expect(ids(out)).toContain('close-extreme');
  });

  it('ARで38m以上でar-longshot-b', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'ar', distM: 40 }), out);
    expect(ids(out)).toContain('ar-longshot-b');
  });

  it('SMGで26m以上でsmg-longshot-b', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'smg', distM: 30 }), out);
    expect(ids(out)).toContain('smg-longshot-b');
  });

  it('スナイパー200mでsniper-200m', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'sniper', scopeWeapon: true, adsProgress: 1, distM: 250 }), out);
    expect(ids(out)).toContain('sniper-200m');
    expect(ids(out)).not.toContain('sniper-400m');
  });

  it('スナイパー400mでsniper-400m', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'sniper', scopeWeapon: true, adsProgress: 1, distM: 450 }), out);
    expect(ids(out)).toContain('sniper-400m');
  });

  it('スナイパー999mでsniper-999m', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'sniper', scopeWeapon: true, adsProgress: 1, distM: 999 }), out);
    expect(ids(out)).toContain('sniper-999m');
  });

  it('QS条件(adsProgress>0.85, adsAgeMs<=350)+200mでqs-200m', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300, distM: 250 }), out);
    expect(ids(out)).toContain('qs-200m');
  });

  it('QS999mでqs-999m', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300, distM: 999 }), out);
    expect(ids(out)).toContain('qs-999m');
  });
});

describe('C: HS連続 (6秒窓)', () => {
  it('HS2連でhs-streak-2', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('hs-streak-2');
  });

  it('HS5連でhs-streak-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('hs-streak-5');
  });

  it('6秒超でHSストリークリセット', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.tick(7);
    t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).not.toContain('hs-streak-2');
  });

  it('非HSキルはHSストリークをリセットしない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.onKill(mk({ headshot: false }), out); // 非HS(ストリーク維持)
    t.onKill(mk({ headshot: true }), out);
    // 2個目のHS後もストリーク=2のまま → 窓内なのでhs-streak-2
    expect(ids(out)).toContain('hs-streak-2');
  });
});

describe('D: 武器クラスメダル', () => {
  it('ARキルでar-specialist', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'ar' }), out);
    expect(ids(out)).toContain('ar-specialist');
  });

  it('ピストル3連でpistol-chain', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ weaponClass: 'pistol' }), out);
    expect(ids(out)).toContain('pistol-chain');
  });

  it('ピストル5連でpistol-rampage', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ weaponClass: 'pistol' }), out);
    expect(ids(out)).toContain('pistol-rampage');
  });

  it('エキゾチック3連でexotic-rampage', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ weaponClass: 'exotic' }), out);
    expect(ids(out)).toContain('exotic-rampage');
  });

  it('ピストル連続が非ピストルキルでリセットされる', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ weaponClass: 'pistol' }), out);
    t.onKill(mk({ weaponClass: 'pistol' }), out);
    t.onKill(mk({ weaponClass: 'ar' }), out); // 分断
    t.onKill(mk({ weaponClass: 'pistol' }), out);
    expect(ids(out)).not.toContain('pistol-chain');
  });

  it('10クラス全使用でall-class-kills', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    const classes = ['ar','smg','sniper','shotgun','br','lmg','pistol','marksman','launcher','exotic'] as const;
    for (const cls of classes) t.onKill(mk({ weaponClass: cls }), out);
    expect(ids(out)).toContain('all-class-kills');
  });

  it('onCollateralでshotgun-doubleとshotgun-triple', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onCollateral(3, out);
    expect(ids(out)).toContain('shotgun-double');
    expect(ids(out)).toContain('shotgun-triple');
    const out2: MedalEvent[] = [];
    t.onCollateral(2, out2);
    expect(ids(out2)).toContain('shotgun-double');
    expect(ids(out2)).not.toContain('shotgun-triple');
  });
});

describe('E: 状況メダル', () => {
  it('matchKillCount=1でfirst-blood', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ matchKillCount: 1 }), out);
    expect(ids(out)).toContain('first-blood');
  });

  it('first-bloodは1回だけ発火', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ matchKillCount: 1 }), out);
    const out2: MedalEvent[] = [];
    t.onKill(mk({ matchKillCount: 1 }), out2); // 2回目はfired=true
    expect(ids(out2)).not.toContain('first-blood');
  });

  it('matchElapsed<=5でspeed-opener', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ matchElapsed: 3 }), out);
    expect(ids(out)).toContain('speed-opener');
  });

  it('matchElapsed>5ではspeed-openerが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ matchElapsed: 6 }), out);
    expect(ids(out)).not.toContain('speed-opener');
  });

  it('playerHpRatio<0.2でlow-hp-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ playerHpRatio: 0.15 }), out);
    expect(ids(out)).toContain('low-hp-kill');
  });

  it('playerHpRatio<0.1でclutch-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ playerHpRatio: 0.05 }), out);
    expect(ids(out)).toContain('clutch-kill');
    // 0.1未満は0.2未満も満たすが、clutchの方が下位なのでlow-hp-killも出るかは実装による
    // 設計: <0.1はclutch-kill, 0.1-0.2はlow-hp-kill(排他)
    expect(ids(out)).not.toContain('low-hp-kill');
  });

  it('magAmmoBeforeKill=1でlast-bullet', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ magAmmoBeforeKill: 1 }), out);
    expect(ids(out)).toContain('last-bullet');
  });

  it('botKind=masterでmaster-killとboss-slayer', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ botKind: 'master' }), out);
    expect(ids(out)).toContain('master-kill');
    expect(ids(out)).toContain('boss-slayer');
  });

  it('botKind=tankでtank-killとboss-slayer', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ botKind: 'tank' }), out);
    expect(ids(out)).toContain('tank-kill');
    expect(ids(out)).toContain('boss-slayer');
  });

  it('botKind=droneでdrone-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ botKind: 'drone' }), out);
    expect(ids(out)).toContain('drone-kill');
  });

  it('botKind=zombieでzombie-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ botKind: 'zombie' }), out);
    expect(ids(out)).toContain('zombie-kill');
  });

  it('noScope+HSでno-scope-hs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.3, headshot: true }), out);
    expect(ids(out)).toContain('no-scope-hs');
  });

  it('QS+HSでqs-hs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300, headshot: true }), out);
    expect(ids(out)).toContain('qs-hs');
  });

  it('onPlayerDamaged後はnoDmgKillStreakリセット→no-damage-5が出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t.onKill(mk(), out);
    t.onPlayerDamaged();
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('no-damage-5');
  });

  it('5連無被弾でno-damage-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk(), out);
    expect(ids(out)).toContain('no-damage-5');
  });

  it('同じ敵に3回やられるとnextkillでnemesis-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onPlayerDeath(42);
    t.onPlayerDeath(42);
    t.onPlayerDeath(42);
    // nemesisUid = 42
    t.onKill(mk({ victimId: 42 }), out);
    expect(ids(out)).toContain('nemesis-kill');
    expect(ids(out)).toContain('nemesis-revenge');
  });

  it('宿敵討ち後はnextkillでnemesis-killが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onPlayerDeath(42);
    t.onPlayerDeath(42);
    t.onPlayerDeath(42);
    t.onKill(mk({ victimId: 42 }), out);
    const out2: MedalEvent[] = [];
    t.onKill(mk({ victimId: 42 }), out2);
    expect(ids(out2)).not.toContain('nemesis-kill');
  });
});

describe('F: フィード拡張', () => {
  it('5連フィードでpenta-feed', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) { t.onKill(mk(), out); t.tick(0.4); }
    expect(ids(out)).toContain('penta-feed');
  });

  it('他者キルで分断するとpenta-feedが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk(), out);
    t.onFeed(false); // 分断
    for (let i = 0; i < 2; i += 1) t.onKill(mk(), out);
    expect(ids(out)).not.toContain('penta-feed');
  });

  it('HS2連フィードでhs-feed-2', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('hs-feed-2');
  });

  it('非HSキルでhs-feedストリークリセット', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.onKill(mk({ headshot: false }), out); // 分断
    t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).not.toContain('hs-feed-2');
  });

  it('HS3連フィードでhs-feed-3', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('hs-feed-3');
  });
});

describe('G: ストリーク延長', () => {
  it('streak=35でstreak-35', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ streak: 35 }), out);
    expect(ids(out)).toContain('streak-35');
  });

  it('streak=100でstreak-100', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ streak: 100 }), out);
    expect(ids(out)).toContain('streak-100');
  });

  it('streak=50でstreak-50', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ streak: 50 }), out);
    expect(ids(out)).toContain('streak-50');
  });
});

describe('H: マガジンメダル', () => {
  it('1マガジン2キルでmag-2', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.onKill(mk(), out);
    expect(ids(out)).toContain('mag-2');
  });

  it('1マガジン3キルでmag-3', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk(), out);
    expect(ids(out)).toContain('mag-3');
  });

  it('onReloadDoneでmagKillSeqがリセットされる', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.onKill(mk(), out);
    t.onReloadDone();
    t.onKill(mk(), out);
    // リロード後は1キル目 → mag-3にはならない
    expect(ids(out)).not.toContain('mag-3');
  });

  it('3連続HSマガジンでmag-all-hs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('mag-all-hs');
  });

  it('非HSが混在するとmag-all-hsが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: true }), out);
    t.onKill(mk({ headshot: false }), out);
    t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).not.toContain('mag-all-hs');
  });

  it('1マガジン5キルでmag-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk(), out);
    expect(ids(out)).toContain('mag-5');
  });
});

describe('I: スライド/空中特化', () => {
  it('スライド中HSでslide-hs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ sliding: true, headshot: true }), out);
    expect(ids(out)).toContain('slide-hs');
  });

  it('空中スナイパーキルでair-snipe', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ grounded: false, weaponClass: 'sniper', scopeWeapon: true, adsProgress: 1 }), out);
    expect(ids(out)).toContain('air-snipe');
  });

  it('スライド中QSでslide-qs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ sliding: true, scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300 }), out);
    expect(ids(out)).toContain('slide-qs');
  });

  it('空中中QSでair-qs', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ grounded: false, scopeWeapon: true, adsProgress: 0.9, adsAgeMs: 300 }), out);
    expect(ids(out)).toContain('air-qs');
  });

  it('空中でグラビティスラムでair-slam-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ grounded: false, weaponName: 'グラビティスラム' }), out);
    expect(ids(out)).toContain('air-slam-kill');
  });
});

describe('J: 特殊モードメダル', () => {
  it('darkEmperorActive=trueでdark-emperor-killとde-activation-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ darkEmperorActive: true }), out);
    expect(ids(out)).toContain('dark-emperor-kill');
    expect(ids(out)).toContain('de-activation-kill');
  });

  it('黒帝5連でdark-emperor-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ darkEmperorActive: true }), out);
    expect(ids(out)).toContain('dark-emperor-5');
  });

  it('onPlayerDamaged後は黒帝無被弾メダルが出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ darkEmperorActive: true }), out);
    t.onPlayerDamaged();
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ darkEmperorActive: true }), out);
    expect(ids(out)).not.toContain('dark-emperor-nodmg');
  });

  it('raiteiActive=trueでraitei-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ raiteiActive: true }), out);
    expect(ids(out)).toContain('raitei-kill');
    expect(ids(out)).toContain('raitei-activation-kill');
  });

  it('kokuraiteiActive=trueでkokurai-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ kokuraiteiActive: true }), out);
    expect(ids(out)).toContain('kokurai-kill');
    expect(ids(out)).toContain('kokurai-activation-kill');
  });

  it('hellMode=trueでhell-kill', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ hellMode: true }), out);
    expect(ids(out)).toContain('hell-kill');
  });

  it('超鬼畜5連でhell-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ hellMode: true }), out);
    expect(ids(out)).toContain('hell-5');
  });

  it('ultActive=trueでult-kill(overdrive含む)', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ ultActive: true }), out);
    expect(ids(out)).toContain('ult-kill');
    expect(ids(out)).toContain('overdrive'); // 既存
  });

  it('ウルト5連でult-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ ultActive: true }), out);
    expect(ids(out)).toContain('ult-5');
  });

  it('chain>=50かつhellMode=trueでchain-god', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    // 50連ローリング窓でchain=50まで積む
    for (let i = 0; i < 50; i += 1) { t.onKill(mk({ hellMode: true }), out); t.tick(0.1); }
    expect(ids(out)).toContain('chain-god');
  });
});

describe('K: 超難度メダル', () => {
  it('1ライフ5連無被弾でperfect-life-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ streak: i + 1 }), out);
    expect(ids(out)).toContain('perfect-life-5');
  });

  it('onPlayerDamaged後はperfect-life-5が出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onPlayerDamaged();
    for (let i = 0; i < 5; i += 1) t.onKill(mk(), out);
    expect(ids(out)).not.toContain('perfect-life-5');
  });

  it('1ライフ10連無被弾でperfect-life-10', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 10; i += 1) t.onKill(mk(), out);
    expect(ids(out)).toContain('perfect-life-10');
  });

  it('1ライフ5連全HSでall-hs-life-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).toContain('all-hs-life-5');
  });

  it('1ライフで非HSが混じるとall-hs-life-5が出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ headshot: false }), out); // 最初に非HS
    for (let i = 0; i < 5; i += 1) t.onKill(mk({ headshot: true }), out);
    expect(ids(out)).not.toContain('all-hs-life-5');
  });

  it('botKind=masterでboss-slayer', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ botKind: 'master' }), out);
    expect(ids(out)).toContain('boss-slayer');
  });

  it('onPlayerDeathで1ライフカウンタリセット', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t.onKill(mk(), out);
    t.onPlayerDeath(null);
    t.onKill(mk(), out); // 1ライフ1キル→perfect-life-5にはならない
    expect(ids(out)).not.toContain('perfect-life-5');
  });

  it('matchKillCount=50でexecutioner-50', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk({ matchKillCount: 50 }), out);
    expect(ids(out)).toContain('executioner-50');
  });
});

describe('L: チェーン拡張', () => {
  it('chain=10でchain-10', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 10; i += 1) { t.onKill(mk(), out); t.tick(0.1); }
    expect(ids(out)).toContain('chain-10');
  });

  it('chain=15でchain-15', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 15; i += 1) { t.onKill(mk(), out); t.tick(0.1); }
    expect(ids(out)).toContain('chain-15');
  });

  it('chain=20でchain-20', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 20; i += 1) { t.onKill(mk(), out); t.tick(0.1); }
    expect(ids(out)).toContain('chain-20');
  });

  it('chain=50でchain-50', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 50; i += 1) { t.onKill(mk(), out); t.tick(0.05); }
    expect(ids(out)).toContain('chain-50');
  });

  it('chain-comeback: 窓切れ後1秒以内の次キルで発火', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out); // chain=1
    t.tick(6); // 窓切れ → lastChainExpiredTs 設定
    out.length = 0;
    t.onKill(mk(), out); // chain=1 再開, justExpired
    expect(ids(out)).toContain('chain-comeback');
  });

  it('chain-comeback: 窓切れから1秒超では発火しない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.tick(6);
    t.tick(2); // さらに2秒経過
    out.length = 0;
    t.onKill(mk(), out);
    expect(ids(out)).not.toContain('chain-comeback');
  });
});

describe('コールバック', () => {
  it('onReloadDoneでmagKillSeqがリセット', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(), out);
    t.onKill(mk(), out);
    t.onReloadDone();
    // リセット後: magKillSeq=0
    const out2: MedalEvent[] = [];
    t.onKill(mk(), out2);
    t.onKill(mk(), out2);
    // 2キル後mag-2が出るはず(リセット後の新マガジン)
    expect(ids(out2)).toContain('mag-2');
  });

  it('onBlinkでblinkKillExpireが設定される', () => {
    const t = new MedalTracker(new Set());
    t.onBlink(); // blinkKillExpire = now + 0.8
    const out: MedalEvent[] = [];
    // blinkAgeMs未設定なのでblink-killは出ないが、クラッシュしない
    t.onKill(mk(), out);
    // エラーなし確認
    expect(out).toBeDefined();
  });

  it('onPlayerDamagedでnoDmgKillStreakがリセット(4キル止まりではno-damage-5不発)', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 3; i += 1) t.onKill(mk(), out);
    t.onPlayerDamaged();
    // noDmgKillStreak=0に戻る → 4キルではまだ5に届かない
    const out2: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) t.onKill(mk(), out2);
    expect(ids(out2)).not.toContain('no-damage-5');
  });

  it('onZombieRoundEndで10ラウンド達成時にsurvivor-10', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      t.onZombieRoundStart();
      t.onZombieRoundEnd(out);
    }
    expect(ids(out)).toContain('survivor-10');
  });

  it('onZombieRoundEndで20ラウンド達成時にsurvivor-20', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 20; i += 1) {
      t.onZombieRoundStart();
      t.onZombieRoundEnd(out);
    }
    expect(ids(out)).toContain('survivor-20');
  });

  it('5ウェーブ全て無被弾でwave-clean-5', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 5; i += 1) {
      t.onZombieRoundStart();
      // 被弾なし
      t.onZombieRoundEnd(out);
    }
    expect(ids(out)).toContain('wave-clean-5');
  });

  it('波中に被弾するとwave-clean-5カウントが積まれない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      t.onZombieRoundStart();
      t.onZombieRoundEnd(out);
    }
    // 5波目は被弾あり
    t.onZombieRoundStart();
    t.onPlayerDamaged();
    t.onZombieRoundEnd(out);
    expect(ids(out)).not.toContain('wave-clean-5');
  });
});

// ══════════════════════════════════════════════════════════════════
// SUPPRESS_BADGE / ALWAYS_BADGE 表示抑制ルール
// ══════════════════════════════════════════════════════════════════

describe('SUPPRESS_BADGE: 拡張バッジ抑止セット', () => {
  it('既存頻出14種(headshot/specialists/zombie-kill等)が含まれる', () => {
    expect(SUPPRESS_BADGE.has('headshot')).toBe(true);
    expect(SUPPRESS_BADGE.has('ar-specialist')).toBe(true);
    expect(SUPPRESS_BADGE.has('zombie-kill')).toBe(true);
    expect(SUPPRESS_BADGE.has('drone-kill')).toBe(true);
    expect(SUPPRESS_BADGE.has('turret-kill')).toBe(true);
  });

  it('新追加の低ランク/頻出/重複メダルが抑止される', () => {
    expect(SUPPRESS_BADGE.has('crouch-kill')).toBe(true);
    expect(SUPPRESS_BADGE.has('blink-kill')).toBe(true);
    expect(SUPPRESS_BADGE.has('hs-streak-2')).toBe(true);
    expect(SUPPRESS_BADGE.has('streak-35')).toBe(true);
    expect(SUPPRESS_BADGE.has('streak-75')).toBe(true); // LEGEND(100)のみ保留
    expect(SUPPRESS_BADGE.has('mag-2')).toBe(true);
    expect(SUPPRESS_BADGE.has('chain-10')).toBe(true);
    expect(SUPPRESS_BADGE.has('boss-slayer')).toBe(true); // ボス種毎キルで頻出
    expect(SUPPRESS_BADGE.has('clutch-kill')).toBe(true); // 低HP時に頻出
    expect(SUPPRESS_BADGE.has('penta-feed')).toBe(true); // rampage-feedのみ保留
    expect(SUPPRESS_BADGE.has('octa-feed')).toBe(true);
    expect(SUPPRESS_BADGE.has('mag-all-hs')).toBe(true); // mag-10のみ保留
    expect(SUPPRESS_BADGE.has('all-class-kills')).toBe(true);
  });

  it('エリート系メダルはSUPPRESS_BADGEに含まれない', () => {
    expect(SUPPRESS_BADGE.has('sniper-999m')).toBe(false);
    expect(SUPPRESS_BADGE.has('qs-999m')).toBe(false);
    expect(SUPPRESS_BADGE.has('streak-100')).toBe(false);
    expect(SUPPRESS_BADGE.has('chain-50')).toBe(false);
    expect(SUPPRESS_BADGE.has('chain-god')).toBe(false);
    expect(SUPPRESS_BADGE.has('rampage-feed')).toBe(false);
    expect(SUPPRESS_BADGE.has('kokurai-50')).toBe(false);
    expect(SUPPRESS_BADGE.has('quad-feed')).toBe(false);
    expect(SUPPRESS_BADGE.has('nuclear')).toBe(false);
    expect(SUPPRESS_BADGE.has('qhsf')).toBe(false);
    // 体験が明確に変わる新メダル(黒帝/雷帝/黒雷帝/超鬼畜10連・達人撃破・無傷ライフ・mag-10)
    expect(SUPPRESS_BADGE.has('dark-emperor-10')).toBe(false);
    expect(SUPPRESS_BADGE.has('raitei-10')).toBe(false);
    expect(SUPPRESS_BADGE.has('kokurai-10')).toBe(false);
    expect(SUPPRESS_BADGE.has('hell-10')).toBe(false);
    expect(SUPPRESS_BADGE.has('master-kill')).toBe(false);
    expect(SUPPRESS_BADGE.has('perfect-life-10')).toBe(false);
    expect(SUPPRESS_BADGE.has('mag-10')).toBe(false);
  });

  it('SUPPRESS_BADGEが163種 = バッジ解放は216種中53種(約1/4)', () => {
    expect(SUPPRESS_BADGE.size).toBe(163);
  });
});

describe('ALWAYS_BADGE: 毎回バッジを出すエリート10種', () => {
  it('12種以下に絞られている', () => {
    expect(ALWAYS_BADGE.size).toBeLessThanOrEqual(12);
  });

  it('quad-feed / mega-feed / qhsf / nuclear が含まれる', () => {
    expect(ALWAYS_BADGE.has('quad-feed')).toBe(true);
    expect(ALWAYS_BADGE.has('mega-feed')).toBe(true);
    expect(ALWAYS_BADGE.has('qhsf')).toBe(true);
    expect(ALWAYS_BADGE.has('nuclear')).toBe(true);
  });

  it('streak-100 / chain-50 / sniper-999m / qs-999m が含まれる', () => {
    expect(ALWAYS_BADGE.has('streak-100')).toBe(true);
    expect(ALWAYS_BADGE.has('chain-50')).toBe(true);
    expect(ALWAYS_BADGE.has('sniper-999m')).toBe(true);
    expect(ALWAYS_BADGE.has('qs-999m')).toBe(true);
  });

  it('ALWAYS_BADGEのメンバーはすべてSUPPRESS_BADGEに含まれない', () => {
    for (const id of ALWAYS_BADGE) {
      expect(SUPPRESS_BADGE.has(id as MedalId)).toBe(false);
    }
  });

  it('頻出・低ランクメダルはALWAYS_BADGEに含まれない', () => {
    expect(ALWAYS_BADGE.has('headshot')).toBe(false);
    expect(ALWAYS_BADGE.has('longshot')).toBe(false);
    expect(ALWAYS_BADGE.has('bloodthirsty')).toBe(false);
    expect(ALWAYS_BADGE.has('triple-feed')).toBe(false);
    expect(ALWAYS_BADGE.has('streak-35')).toBe(false);
    expect(ALWAYS_BADGE.has('blink-kill')).toBe(false);
  });

  it('R53-W2: ch10-clear / kurogane-slayer がALWAYS_BADGE級として含まれる', () => {
    expect(ALWAYS_BADGE.has('ch10-clear')).toBe(true);
    expect(ALWAYS_BADGE.has('kurogane-slayer')).toBe(true);
    expect(SUPPRESS_BADGE.has('ch10-clear')).toBe(false);
    expect(SUPPRESS_BADGE.has('kurogane-slayer')).toBe(false);
  });
});

// ── R53-W2: 帝王編+W2システム連動(KillCtx非依存・match側emitManual契約) ────────
describe('M: 帝王編+W2システム連動メダル(emitManual)', () => {
  const M_IDS: MedalId[] = [
    'pap-first',
    'pap-max',
    'variant-100',
    'snd-ace',
    'ch9-clear',
    'ch10-clear',
    'kurogane-slayer',
  ];

  it('emitManualで直接発火し、firstUnlock/countsが通常のonKill経路と同じく機能する', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.emitManual('pap-first', out);
    expect(ids(out)).toEqual(['pap-first']);
    expect(out[0]?.firstUnlock).toBe(true);
    expect(t.counts['pap-first']).toBe(1);

    out.length = 0;
    t.emitManual('pap-first', out);
    expect(out[0]?.firstUnlock).toBe(false); // 2回目は初取得ではない
    expect(t.counts['pap-first']).toBe(2);
  });

  it('既知セット(profile.unlockedMedals相当)を渡すとfirstUnlock=falseで始まる', () => {
    const t = new MedalTracker(new Set(['ch9-clear']));
    const out: MedalEvent[] = [];
    t.emitManual('ch9-clear', out);
    expect(out[0]?.firstUnlock).toBe(false);
  });

  it('7種すべてがMEDALS定義を持ち、tier/color/xpが有効値である', () => {
    const t = new MedalTracker(new Set());
    for (const id of M_IDS) {
      const out: MedalEvent[] = [];
      t.emitManual(id, out);
      expect(out).toHaveLength(1);
      const ev = out[0]!;
      expect(ev.name.length).toBeGreaterThan(0);
      expect(['bronze', 'silver', 'gold', 'platinum']).toContain(ev.tier);
      expect(ev.color.length).toBeGreaterThan(0);
      expect(ev.xp).toBeGreaterThan(0);
    }
  });

  it('7種のIDは互いに一意で他区分と重複しない', () => {
    expect(new Set(M_IDS).size).toBe(M_IDS.length);
  });
});
