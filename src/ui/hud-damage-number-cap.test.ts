import { describe, expect, it } from 'vitest';
import { DAMAGE_NUMBER_FRAME_CAP, splitDamageNumbersForFrame } from './hud';

// 軽量化監査#8: pushDamageNumbers は splitDamageNumbersForFrame の戻り値を
// そのまま1ノードずつ(shown)+集約1ノード(overflow)としてDOM化する(hud.ts参照)。
// そのためDOM生成数の頭打ちは、この純関数の shown.length / overflow の有無で検証できる。
type FakeDamageNumber = { amount: number; kind: 'body' | 'head' | 'kill' | 'limb'; world: number };

function makeList(n: number, kind: FakeDamageNumber['kind'] = 'body'): FakeDamageNumber[] {
  return Array.from({ length: n }, (_, i) => ({ amount: 10 + i, kind, world: i }));
}

describe('splitDamageNumbersForFrame (R: ダメージ数値DOMの上限キャップ+集約)', () => {
  it('上限(24)ちょうどでは集約なし・全件そのまま(境界値、既存挙動を変えない)', () => {
    const list = makeList(DAMAGE_NUMBER_FRAME_CAP);
    const { shown, overflow } = splitDamageNumbersForFrame(list);
    expect(shown).toHaveLength(DAMAGE_NUMBER_FRAME_CAP);
    expect(shown).toEqual(list);
    expect(overflow).toBeNull();
  });

  it('5件(少数ヒット)は従来どおり5ノード分、集約なし', () => {
    const list = makeList(5);
    const { shown, overflow } = splitDamageNumbersForFrame(list);
    expect(shown).toHaveLength(5);
    expect(shown).toEqual(list);
    expect(overflow).toBeNull();
  });

  it('30件同時(全滅ウルト相当)は24件+集約1件に頭打ちする(DOM生成 = 24+1 = 25ノード相当)', () => {
    const list = makeList(30, 'kill');
    const { shown, overflow } = splitDamageNumbersForFrame(list);
    expect(shown).toHaveLength(DAMAGE_NUMBER_FRAME_CAP);
    expect(shown).toEqual(list.slice(0, DAMAGE_NUMBER_FRAME_CAP));
    expect(overflow).not.toBeNull();
    // 情報を消さず集約: 超過6件ぶんの件数が正しく反映される
    expect(overflow?.count).toBe(30 - DAMAGE_NUMBER_FRAME_CAP);
  });

  it('集約ノードの内容: キルを含む超過分は件数(hasKill=true)を保持する', () => {
    const list = makeList(30, 'kill');
    const { overflow } = splitDamageNumbersForFrame(list);
    expect(overflow?.hasKill).toBe(true);
    expect(overflow?.count).toBe(6);
    // 代表エントリ(anchor)は超過分の先頭(=25件目, index24)を再利用する(新規Vector3を作らない)
    expect(overflow?.anchor).toEqual(list[24]);
  });

  it('集約ノードの内容: キルを含まない超過分は合計ダメージ量が正しい', () => {
    const list = makeList(30, 'body'); // amount = 10..39
    const { overflow } = splitDamageNumbersForFrame(list);
    expect(overflow?.hasKill).toBe(false);
    const expectedTotal = list.slice(24).reduce((sum, dn) => sum + dn.amount, 0);
    expect(overflow?.totalAmount).toBe(expectedTotal);
    expect(overflow?.count).toBe(6);
  });

  it('超過が1件だけでも集約経路に入る(境界値: 上限+1件)', () => {
    const list = makeList(DAMAGE_NUMBER_FRAME_CAP + 1, 'head');
    const { shown, overflow } = splitDamageNumbersForFrame(list);
    expect(shown).toHaveLength(DAMAGE_NUMBER_FRAME_CAP);
    expect(overflow?.count).toBe(1);
    expect(overflow?.anchor).toEqual(list[DAMAGE_NUMBER_FRAME_CAP]);
  });

  it('空配列では集約なし・shownも空', () => {
    const { shown, overflow } = splitDamageNumbersForFrame([]);
    expect(shown).toHaveLength(0);
    expect(overflow).toBeNull();
  });

  it('カスタムcapを指定した場合もその値で頭打ちする', () => {
    const list = makeList(10, 'body');
    const { shown, overflow } = splitDamageNumbersForFrame(list, 3);
    expect(shown).toHaveLength(3);
    expect(overflow?.count).toBe(7);
  });
});
