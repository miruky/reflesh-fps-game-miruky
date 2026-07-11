import { describe, expect, it } from 'vitest';
import { MedalTracker, type KillCtx, type MedalEvent, type MedalId } from './medals';

// R57 ⑥修正2 回帰テスト: match.ts の KillCtx 帝王フラグ排他化。
//
// 背景: activateKokuraitei() は darkEmperorTimer=Infinity を併せて立てるため、
// 旧実装(match.ts had `darkEmperorActive: this.darkEmperorTimer > 0` 等の生フラグ)では
// 黒雷帝モード中 darkEmperorActive/raiteiActive/kokuraiteiActive の3つが同時にtrueになり得た。
// 効果/SFX/HUD側はすでに match.ts の activeKit()(優先度 kokuraitei > dark > raitei)で
// 排他済みだったが、KillCtx の構築だけがこの排他ロジックを使っていなかったため、
// medals.ts の onKill が dark系メダル(dark-emperor-kill 等)と kokurai系メダル
// (kokurai-kill 等)を同一キルで二重発火し、medalXpTotal が二重加算されていた。
//
// 修正: match.ts の KillCtx 構築を `const kit = this.activeKit();` の結果に基づく
// 排他フラグへ変更(darkEmperorActive: kit==='dark' 等)。ここでは実際に match.ts が
// 生成するのと同じ形の KillCtx を実 MedalTracker に投入し、
// - 黒雷帝(kit='kokuraitei')中は kokurai系のみが発火し dark系が発火しないこと
// - 純黒帝(kit='dark')・純雷帝(kit='raitei')は従来通り各系が単独発火すること(到達性維持)
// を固定する。

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
    distM: 15,
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

// match.ts 修正後の `const kit = this.activeKit(); ctx = { darkEmperorActive: kit==='dark', ... }`
// と等価な3値排他ヘルパー(このテストが検証する契約そのもの)。
function kitCtx(kit: 'kokuraitei' | 'dark' | 'raitei' | 'none'): Partial<KillCtx> {
  return {
    darkEmperorActive: kit === 'dark',
    raiteiActive: kit === 'raitei',
    kokuraiteiActive: kit === 'kokuraitei',
  };
}

describe('R57 ⑥修正2: 黒雷帝キルはkokurai系のみ発火(dark系との二重計上なし)', () => {
  it('黒雷帝(kit=kokuraitei)キルは dark-emperor-kill / de-activation-kill を出さない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(kitCtx('kokuraitei')), out);
    expect(ids(out)).toContain('kokurai-kill');
    expect(ids(out)).toContain('kokurai-activation-kill');
    expect(ids(out)).not.toContain('dark-emperor-kill');
    expect(ids(out)).not.toContain('de-activation-kill');
    expect(ids(out)).not.toContain('raitei-kill');
    expect(ids(out)).not.toContain('raitei-activation-kill');
  });

  it('黒雷帝キル連打でも darkKills/raiteiKills 系マイルストーンは一切出ない(10killでも dark-emperor-nodmg 等が出ない)', () => {
    const t = new MedalTracker(new Set());
    for (let i = 0; i < 10; i += 1) {
      const out: MedalEvent[] = [];
      // victimId をずらして各キルを個別カウントさせる
      t.onKill(mk({ ...kitCtx('kokuraitei'), victimId: 100 + i, victimName: `z${i}` }), out);
      expect(ids(out).some((id) => id.startsWith('dark-') || id === 'de-activation-kill')).toBe(false);
      expect(ids(out).some((id) => id.startsWith('raitei-'))).toBe(false);
    }
  });

  it('旧実装相当(生フラグ3つ同時true)なら二重発火することの確認(修正の意義を示す対照実験)', () => {
    // これは修正前 match.ts の生フラグ構築を模した ctx。medals.ts 側は変更していないため、
    // 3フラグを同時に立てれば実際に dark系+kokurai系の両方が出ることを示し、
    // 「match.ts 側の排他化だけで二重計上が防げる」ことを裏付ける。
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(
      mk({ darkEmperorActive: true, raiteiActive: true, kokuraiteiActive: true }),
      out,
    );
    expect(ids(out)).toContain('kokurai-kill');
    expect(ids(out)).toContain('dark-emperor-kill');
    expect(ids(out)).toContain('raitei-kill');
  });
});

describe('R57 ⑥修正2: 純黒帝・純雷帝は従来通り単独発火(到達性の非回帰)', () => {
  it('純黒帝(kit=dark)は dark-emperor-kill のみ発火', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(kitCtx('dark')), out);
    expect(ids(out)).toContain('dark-emperor-kill');
    expect(ids(out)).toContain('de-activation-kill');
    expect(ids(out)).not.toContain('kokurai-kill');
    expect(ids(out)).not.toContain('raitei-kill');
  });

  it('純雷帝(kit=raitei)は raitei-kill のみ発火', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(kitCtx('raitei')), out);
    expect(ids(out)).toContain('raitei-kill');
    expect(ids(out)).toContain('raitei-activation-kill');
    expect(ids(out)).not.toContain('kokurai-kill');
    expect(ids(out)).not.toContain('dark-emperor-kill');
  });

  it('kit=none(通常キル)はどの帝王系メダルも出ない', () => {
    const t = new MedalTracker(new Set());
    const out: MedalEvent[] = [];
    t.onKill(mk(kitCtx('none')), out);
    expect(ids(out)).not.toContain('kokurai-kill');
    expect(ids(out)).not.toContain('dark-emperor-kill');
    expect(ids(out)).not.toContain('raitei-kill');
  });
});
