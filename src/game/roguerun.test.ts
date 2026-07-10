// R54-F5: 輪廻(ゾンビ・ローグラン)純ロジックのテスト。
// カードプール/RogueMods線形加算/抽選の決定論/恒久tier/メタ保存(ストレージ注入)を固定する。
import { describe, expect, it } from 'vitest';
import type { Rand } from '../core/rng';
import {
  ROGUE_CARDS,
  ROGUE_META_KEY,
  ROGUE_TIER_ROUNDS,
  accumulateRogueMeta,
  applyCardToMods,
  emptyRogueMods,
  readRogueMeta,
  rogueCardById,
  rogueTierFor,
  rollRogueOffer,
  rollRogueOfferWithTier,
  writeRogueMeta,
} from './roguerun';

// 決定論rand: 固定シードLCG(todayDateSeed非依存)
function lcg(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// 値列を順に返すrand(尽きたら末尾を繰り返す)
function seq(values: number[]): Rand {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

function fakeStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => map,
  };
}

describe('ROGUE_CARDS(カードプール)', () => {
  it('12種でidが全て一意', () => {
    expect(ROGUE_CARDS.length).toBe(12);
    expect(new Set(ROGUE_CARDS.map((c) => c.id)).size).toBe(12);
  });

  it('レア度構成はC8/R3/E1(凍結値)', () => {
    const by = (r: string) => ROGUE_CARDS.filter((c) => c.rarity === r).length;
    expect(by('common')).toBe(8);
    expect(by('rare')).toBe(3);
    expect(by('epic')).toBe(1);
  });

  it('即時カードは無料パーク(free-perk)と蘇りの灯(revive)のみ', () => {
    const instants = ROGUE_CARDS.filter((c) => c.instant);
    expect(instants.map((c) => c.id).sort()).toEqual(['muhai', 'tomoshibi']);
    expect(rogueCardById('muhai')?.instant).toBe('free-perk');
    expect(rogueCardById('tomoshibi')?.instant).toBe('revive');
  });

  it('rogueCardById: 未知idはnull', () => {
    expect(rogueCardById('unknown-card')).toBeNull();
  });
});

describe('applyCardToMods(線形加算・純関数)', () => {
  it('業火の弾丸: dmgAdd +0.15', () => {
    expect(applyCardToMods(emptyRogueMods(), 'gouka').dmgAdd).toBeCloseTo(0.15);
  });

  it('疾風: moveAdd +0.08 / 早込め: reloadAdd +0.2 / 大袋: magAdd +0.25', () => {
    expect(applyCardToMods(emptyRogueMods(), 'shippu').moveAdd).toBeCloseTo(0.08);
    expect(applyCardToMods(emptyRogueMods(), 'hayagome').reloadAdd).toBeCloseTo(0.2);
    expect(applyCardToMods(emptyRogueMods(), 'oobukuro').magAdd).toBeCloseTo(0.25);
  });

  it('守りの札: dmgTakenAdd -0.10(軽減) / 血の契約: dmg+0.30と被ダメ+0.15の両刃', () => {
    expect(applyCardToMods(emptyRogueMods(), 'mamori').dmgTakenAdd).toBeCloseTo(-0.1);
    const chikei = applyCardToMods(emptyRogueMods(), 'chikei');
    expect(chikei.dmgAdd).toBeCloseTo(0.3);
    expect(chikei.dmgTakenAdd).toBeCloseTo(0.15);
  });

  it('商才: pointsAdd +0.15 / 幸運: powerUpAdd +0.5 / 鍛冶割引: papDiscount +0.2', () => {
    expect(applyCardToMods(emptyRogueMods(), 'shousai').pointsAdd).toBeCloseTo(0.15);
    expect(applyCardToMods(emptyRogueMods(), 'kouun').powerUpAdd).toBeCloseTo(0.5);
    expect(applyCardToMods(emptyRogueMods(), 'kaji').papDiscount).toBeCloseTo(0.2);
  });

  it('韋駄天: 移速+0.05とリロード+0.10の複合', () => {
    const m = applyCardToMods(emptyRogueMods(), 'idaten');
    expect(m.moveAdd).toBeCloseTo(0.05);
    expect(m.reloadAdd).toBeCloseTo(0.1);
  });

  it('即時カード(muhai/tomoshibi)と未知idはmods不変', () => {
    expect(applyCardToMods(emptyRogueMods(), 'muhai')).toEqual(emptyRogueMods());
    expect(applyCardToMods(emptyRogueMods(), 'tomoshibi')).toEqual(emptyRogueMods());
    expect(applyCardToMods(emptyRogueMods(), 'no-such-card')).toEqual(emptyRogueMods());
  });

  it('線形スタック: 同カード2回で加算値が2倍(複利なし)', () => {
    const once = applyCardToMods(emptyRogueMods(), 'gouka');
    const twice = applyCardToMods(once, 'gouka');
    expect(twice.dmgAdd).toBeCloseTo(0.3);
  });

  it('純関数: 入力modsを破壊しない', () => {
    const src = emptyRogueMods();
    applyCardToMods(src, 'gouka');
    expect(src.dmgAdd).toBe(0);
  });
});

describe('rollRogueOffer(台座の抽選)', () => {
  it('3枚を重複なしで返す', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const offer = rollRogueOffer(lcg(seed), false);
      expect(offer.length).toBe(3);
      expect(new Set(offer.map((c) => c.id)).size).toBe(3);
    }
  });

  it('決定論: 同じrandシードなら同じ提示', () => {
    const a = rollRogueOffer(lcg(42), false).map((c) => c.id);
    const b = rollRogueOffer(lcg(42), false).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('rand→0固定なら1枚目はepic(chikei)、epicプール枯渇後はフォールバック', () => {
    const offer = rollRogueOffer(() => 0, false);
    expect(offer[0]!.id).toBe('chikei');
    expect(offer.length).toBe(3);
    expect(new Set(offer.map((c) => c.id)).size).toBe(3);
  });

  it('rand→0.99固定ならcommonのみが並ぶ', () => {
    const offer = rollRogueOffer(() => 0.99, false);
    expect(offer.every((c) => c.rarity === 'common')).toBe(true);
  });

  it('rarityBoost: r=0.1はepicに昇格する(通常はrare)', () => {
    // rollRarity消費1回→プール抽選1回の順。r=0.1: 通常 0.1>=0.05→<0.30でrare / boost 0.1<0.15でepic
    const normal = rollRogueOffer(seq([0.1, 0, 0.99, 0.99, 0.99, 0.99]), false);
    const boosted = rollRogueOffer(seq([0.1, 0, 0.99, 0.99, 0.99, 0.99]), true);
    expect(normal[0]!.rarity).toBe('rare');
    expect(boosted[0]!.rarity).toBe('epic');
  });

  it('countは12(全カード)でクランプされ全て一意', () => {
    const offer = rollRogueOffer(lcg(7), false, 99);
    expect(offer.length).toBe(12);
    expect(new Set(offer.map((c) => c.id)).size).toBe(12);
  });
});

describe('rogueTierFor(恒久メタ境地)', () => {
  it('しきい値: 10/30/60/100/150(凍結値)', () => {
    expect(ROGUE_TIER_ROUNDS).toEqual([10, 30, 60, 100, 150]);
  });

  it('累計ラウンド→境地の対応', () => {
    expect(rogueTierFor(0)).toBe(0);
    expect(rogueTierFor(9)).toBe(0);
    expect(rogueTierFor(10)).toBe(1);
    expect(rogueTierFor(29)).toBe(1);
    expect(rogueTierFor(30)).toBe(2);
    expect(rogueTierFor(60)).toBe(3);
    expect(rogueTierFor(99)).toBe(3);
    expect(rogueTierFor(100)).toBe(4);
    expect(rogueTierFor(150)).toBe(5);
    expect(rogueTierFor(99999)).toBe(5);
  });
});

describe('rollRogueOfferWithTier', () => {
  it('tier<5は3枚、tier5は4枚(台座4基)', () => {
    expect(rollRogueOfferWithTier(lcg(3), false, 0).length).toBe(3);
    expect(rollRogueOfferWithTier(lcg(3), false, 4).length).toBe(3);
    expect(rollRogueOfferWithTier(lcg(3), false, 5).length).toBe(4);
  });

  it('countOverrideが優先される', () => {
    expect(rollRogueOfferWithTier(lcg(3), false, 5, 2).length).toBe(2);
  });

  it('tier3+: common判定の10%がrareへ底上げされる', () => {
    // 消費順: rollRarity(0.99=common)→昇格判定(0.05<0.1=rare昇格)→プール抽選(0)
    const offer = rollRogueOfferWithTier(seq([0.99, 0.05, 0, 0.99, 0.5, 0.99, 0.99, 0.5, 0.99]), false, 3);
    expect(offer[0]!.rarity).toBe('rare');
  });

  it('tier3+でも重複なし・決定論を維持', () => {
    const a = rollRogueOfferWithTier(lcg(11), true, 5).map((c) => c.id);
    const b = rollRogueOfferWithTier(lcg(11), true, 5).map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(4);
  });
});

describe('RogueMeta(localStorage v1・ストレージ注入)', () => {
  it('キーは hibana.rogue.v1(移行時の互換キー)', () => {
    expect(ROGUE_META_KEY).toBe('hibana.rogue.v1');
  });

  it('空ストレージ→ゼロ初期値', () => {
    expect(readRogueMeta(fakeStorage())).toEqual({ totalRounds: 0, bestRound: 0 });
  });

  it('壊れたJSON/型不正→ゼロへフォールバック', () => {
    expect(readRogueMeta(fakeStorage({ [ROGUE_META_KEY]: '{broken' }))).toEqual({ totalRounds: 0, bestRound: 0 });
    expect(
      readRogueMeta(fakeStorage({ [ROGUE_META_KEY]: JSON.stringify({ totalRounds: 'x', bestRound: -5 }) })),
    ).toEqual({ totalRounds: 0, bestRound: 0 });
    expect(
      readRogueMeta(fakeStorage({ [ROGUE_META_KEY]: JSON.stringify({ totalRounds: Number.NaN, bestRound: 3.9 }) })),
    ).toEqual({ totalRounds: 0, bestRound: 3 });
  });

  it('write→read往復で値が保たれる', () => {
    const st = fakeStorage();
    writeRogueMeta(st, { totalRounds: 42, bestRound: 17 });
    expect(readRogueMeta(st)).toEqual({ totalRounds: 42, bestRound: 17 });
  });

  it('accumulateRogueMeta: 到達R-1がクリア数として累計され、ベストを更新', () => {
    const meta = { totalRounds: 10, bestRound: 6 };
    expect(accumulateRogueMeta(meta, 5)).toEqual({ totalRounds: 14, bestRound: 6 });
    expect(accumulateRogueMeta(meta, 9)).toEqual({ totalRounds: 18, bestRound: 8 });
  });

  it('accumulateRogueMeta: R1到達(未クリア)やR0は加算ゼロ', () => {
    const meta = { totalRounds: 3, bestRound: 2 };
    expect(accumulateRogueMeta(meta, 1)).toEqual({ totalRounds: 3, bestRound: 2 });
    expect(accumulateRogueMeta(meta, 0)).toEqual({ totalRounds: 3, bestRound: 2 });
  });
});
