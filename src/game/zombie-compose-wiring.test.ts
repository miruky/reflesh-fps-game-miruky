// R53-W2: match.ts のPack-a-Punch/パーク compose一本化リファクタの回帰テスト。
// match.ts の Match クラス自体は THREE/Rapier のフル世界を要求するため直接ユニットテストしない
// (このリポジトリの既存方針。ext-mag.test.ts 冒頭コメント参照)。
// ここでは match.ts が実際に呼び出す composeZombieWeaponDef の「組み合わせ」と、
// match.ts 内の recomposeWeapon/switchPrimaryWeapon/handleZombieInteract(pack-a-punch/door)/
// addZombiePoints/spawnOneZombie(rush)/applyBotDamage(shell) が実装している純粋な計算手順を
// この場で再現し、以下を確認する:
//   (1) compose移行前後で数値が変わってはならない部分(speed-colaのreload倍率、
//       double-tapのrpm)が実際に不変であること=真の回帰テスト。
//   (2) compose移行で意図的に変わった部分(double-tapのダメージ倍率。zombie-economy.ts側の
//       設計変更で、旧来の「初回1.6倍+以降0.3ずつ加算」から「常に1+0.3×スタック数」の
//       線形式に統一された)を明示的に固定し、今後の意図しない再変更を検知する。
//   (3) Pack-a-Punch tier/ドア/パワーアップ/rush/shellなど新規ロジックの決定論的な出力。
import { describe, expect, it } from 'vitest';
import { EXT_MAG_EXCLUDED_IDS, PAP_CAMO_BY_TIER } from './match';
import {
  composeZombieWeaponDef,
  PAP_COST,
  PAP_REFILL_COST,
  DOOR_COST,
  SHELL_FRONT_REDUCTION,
  type PapTier,
} from './zombie-economy';
import { zombieHp, RUSH_HP_MUL } from './zombie';
import { WEAPON_DEFS } from './weapons';

describe('R53-W2 compose一本化: 既存perk効果値の回帰確認', () => {
  // ─── speed-cola: 旧「現在値への複利」と新compose「基礎値からの都度再計算」は数学的に同値 ───
  it('speed-cola: 旧iterative式(0.85^nを毎回current値へ乗算+floor 0.25)とcomposeの結果が全スタック数で一致する', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    let iterativeMul = 1;
    for (let n = 1; n <= 14; n += 1) {
      // 旧 applyZombiePerk('speed-cola') の手順: prev*0.85 を毎回floor
      iterativeMul = Math.max(0.25, iterativeMul * 0.85);
      const iterativeReload = Math.round(base.reloadTacticalMs * iterativeMul);

      const composed = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: n });
      expect(composed.reloadTacticalMs).toBe(iterativeReload);
    }
  });

  it('speed-cola: 下限0.25はスタック9以降で両方式とも同じ点から効き始める', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    // 0.85^n < 0.25 となる最小のnを求める(ln(0.25)/ln(0.85) ≈ 8.55 → n=9)
    const composedAt9 = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: 9 });
    const composedAt20 = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: 20 });
    expect(composedAt9.reloadTacticalMs).toBe(Math.round(base.reloadTacticalMs * 0.25));
    expect(composedAt20.reloadTacticalMs).toBe(composedAt9.reloadTacticalMs); // 床で頭打ち
  });

  // ─── double-tap: rpmは「初回のみ1.33x適用、以降は据え置き」という旧仕様と一致(回帰) ───
  it('double-tap: rpmは旧仕様(初回のみ×1.33、2スタック目以降は変化なし)とcomposeが一致する', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    const oldRpmForStacks = (n: number): number => (n > 0 ? Math.round(base.rpm * 1.33) : base.rpm);
    for (const n of [0, 1, 2, 3, 5, 10]) {
      const composed = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: n, speedColaStacks: 0 });
      expect(composed.rpm).toBe(oldRpmForStacks(n));
    }
  });

  // ─── double-tap: ダメージ倍率は仕様変更(意図的)。固定値として明示的に確認する ───
  it('double-tap: ダメージ倍率は「常に1+0.3×スタック数」の線形式(旧: 初回1.6+以降0.3ずつ加算とは異なる意図的な変更)', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    // 新式: dmgMul = 1 + 0.3*n → n=1:1.3 / n=2:1.6 / n=3:1.9(旧式は1.6/1.9/2.2だった)
    const expected = [1, 1.3, 1.6, 1.9, 2.2];
    for (let n = 0; n <= 4; n += 1) {
      const composed = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: n, speedColaStacks: 0 });
      expect(composed.damage).toBe(Math.round(base.damage * expected[n]!));
    }
  });

  // ─── ext-mag: PaP無し時はceil(base*(1+0.5*n))で旧applyExtMagCapacityと同一 ───
  it('ext-mag単体(PaP tier0)はceil(base*(1+0.5*n))で旧applyExtMagCapacityと同一の値になる', () => {
    const base = WEAPON_DEFS['kaede-ar']!; // 基礎30発
    for (const n of [0, 1, 2, 3, 4]) {
      const composed = composeZombieWeaponDef(base, { papTier: 0, extMagStacks: n, doubleTapStacks: 0, speedColaStacks: 0 });
      expect(composed.magazineSize).toBe(Math.ceil(30 * (1 + 0.5 * n)));
    }
  });

  it('fists(クナイ)はcompose自体が素通しする(PaP/perk無関係で基礎値のまま)', () => {
    const fistsBase = WEAPON_DEFS['fists']!;
    const composed = composeZombieWeaponDef(fistsBase, { papTier: 3, extMagStacks: 5, doubleTapStacks: 5, speedColaStacks: 5 });
    expect(composed).toBe(fistsBase); // 同一参照(early return)
    expect(EXT_MAG_EXCLUDED_IDS.has('fists')).toBe(true); // match.tsのrecomposeWeaponガードとも整合
  });
});

describe('R53-W2 Pack-a-Punch: match.tsのtier進行/コスト手順の再現', () => {
  // handleZombieInteract の pack-a-punch 分岐と同じ手順を再現する純粋シミュレーション
  function papPurchase(
    papTiers: Map<string, PapTier>,
    weaponId: string,
    points: number,
  ): { ok: boolean; points: number; tier: PapTier; cost: number } {
    const curTier = (papTiers.get(weaponId) ?? 0) as PapTier;
    const isMaxed = curTier >= 3;
    const nextTier = (isMaxed ? 3 : curTier + 1) as PapTier;
    const cost = isMaxed ? PAP_REFILL_COST : PAP_COST[nextTier];
    if (points < cost) return { ok: false, points, tier: curTier, cost };
    if (!isMaxed) papTiers.set(weaponId, nextTier);
    return { ok: true, points: points - cost, tier: (papTiers.get(weaponId) ?? 0) as PapTier, cost };
  }

  it('tier0→1→2→3と順番に進み、コストはPAP_COST[1,2,3]=5000/20000/45000', () => {
    const tiers = new Map<string, PapTier>();
    let points = 100000;
    const r1 = papPurchase(tiers, 'kaede-ar', points); points = r1.points;
    expect(r1.ok).toBe(true); expect(r1.cost).toBe(5000); expect(r1.tier).toBe(1);
    const r2 = papPurchase(tiers, 'kaede-ar', points); points = r2.points;
    expect(r2.cost).toBe(20000); expect(r2.tier).toBe(2);
    const r3 = papPurchase(tiers, 'kaede-ar', points); points = r3.points;
    expect(r3.cost).toBe(45000); expect(r3.tier).toBe(3);
    expect(points).toBe(100000 - 5000 - 20000 - 45000);
  });

  it('tier3到達後の再購入はPAP_REFILL_COST(2000)固定でtierは3のまま', () => {
    const tiers = new Map<string, PapTier>([['kaede-ar', 3]]);
    const r = papPurchase(tiers, 'kaede-ar', 5000);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(PAP_REFILL_COST);
    expect(r.tier).toBe(3);
    expect(r.points).toBe(3000);
  });

  it('残高不足なら購入失敗し、tier/pointsは変化しない', () => {
    const tiers = new Map<string, PapTier>();
    const r = papPurchase(tiers, 'kaede-ar', 100);
    expect(r.ok).toBe(false);
    expect(r.tier).toBe(0);
    expect(r.points).toBe(100);
    expect(tiers.has('kaede-ar')).toBe(false);
  });

  it('武器ごとにtierは独立管理される(Map<weaponId,PapTier>)', () => {
    const tiers = new Map<string, PapTier>();
    papPurchase(tiers, 'kaede-ar', 100000);
    papPurchase(tiers, 'kaede-ar', 100000);
    papPurchase(tiers, 'yamasemi-dmr', 100000);
    expect(tiers.get('kaede-ar')).toBe(2);
    expect(tiers.get('yamasemi-dmr')).toBe(1);
  });

  it('壁/箱で再取得(switchPrimaryWeapon相当)するとMap.deleteでtierがリセットされる', () => {
    const tiers = new Map<string, PapTier>([['kaede-ar', 3]]);
    // switchPrimaryWeapon(weaponId) の最初の手順
    tiers.delete('kaede-ar');
    expect(tiers.get('kaede-ar') ?? 0).toBe(0);
  });

  it('PAP_CAMO_BY_TIER: tier0=undefined、tier1-3=pap1/pap2/pap3', () => {
    expect(PAP_CAMO_BY_TIER[0]).toBeUndefined();
    expect(PAP_CAMO_BY_TIER[1]).toBe('pap1');
    expect(PAP_CAMO_BY_TIER[2]).toBe('pap2');
    expect(PAP_CAMO_BY_TIER[3]).toBe('pap3');
  });

  it('PaP+ext-mag+double-tap+speed-colaを同時購入した武器のdef合成は一度のcompose呼び出しで完結する', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    const composed = composeZombieWeaponDef(base, {
      papTier: 2,
      extMagStacks: 1,
      doubleTapStacks: 1,
      speedColaStacks: 1,
    });
    // damage = round(40 * 5 * 1.3) = 260
    expect(composed.damage).toBe(Math.round(40 * 5 * 1.3));
    // magazineSize = ceil(30 * 1.5 * 1.5) = 68
    expect(composed.magazineSize).toBe(Math.ceil(30 * 1.5 * 1.5));
    // rpm = round(700*1.33)
    expect(composed.rpm).toBe(Math.round(700 * 1.33));
    // reload = round(1700*0.85)
    expect(composed.reloadTacticalMs).toBe(Math.round(1700 * 0.85));
    expect(composed.name).toBe('カエデAR・改二');
  });
});

describe('R53-W2 ドア: 実効コスト固定値', () => {
  it('DOOR_COSTは1750', () => {
    expect(DOOR_COST).toBe(1750);
  });
});

describe('R53-W2 addZombiePoints相当: doubleパワーアップの2倍計算', () => {
  function addZombiePoints(amount: number, doubleActive: boolean): number {
    const mul = doubleActive ? 2 : 1;
    return Math.round(amount * mul);
  }
  it('double非activeなら等倍、activeなら2倍(四捨五入)', () => {
    expect(addZombiePoints(60, false)).toBe(60);
    expect(addZombiePoints(60, true)).toBe(120);
    expect(addZombiePoints(110, true)).toBe(220); // ヘッドショットキル
    expect(addZombiePoints(10, true)).toBe(20); // 命中
  });
});

describe('R53-W2 rush特殊ラウンド: HP倍率のみ低減、速度/湧きは別軸', () => {
  it('RUSH_HP_MULはzombieHp(r)に乗算されるのみでカーブ自体は変更しない', () => {
    for (const r of [7, 14, 21]) {
      const normalHp = zombieHp(r);
      const rushHp = zombieHp(r) * RUSH_HP_MUL;
      expect(rushHp).toBe(normalHp * 0.6);
      expect(rushHp).toBeLessThan(normalHp);
    }
  });
});

describe('R53-W2 特殊ゾンビ変種: shell前面ダメージ軽減の計算式', () => {
  it('SHELL_FRONT_REDUCTION分の軽減 → match.ts applyBotDamageと同じ式(finalDamage *= 1 - SHELL_FRONT_REDUCTION)', () => {
    expect(SHELL_FRONT_REDUCTION).toBe(0.7);
    const dmg = 100;
    const reduced = dmg * (1 - SHELL_FRONT_REDUCTION);
    expect(reduced).toBeCloseTo(30);
  });
});
