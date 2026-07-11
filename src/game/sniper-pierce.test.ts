// R59③④: SR(sniperクラス)の無限貫通・連鎖と、SR吸着の最近接部位選択のユニットテスト。
// 本リポジトリの規約どおり Match は直接構築せず(WebGLRenderer/RAPIER実初期化が必要)、
// match.ts の tracePellet / スナップ層が消費する純関数(match-helpers)の契約を固定する。
import { describe, expect, it } from 'vitest';
import { PRIMARY_IDS, SECONDARY_IDS, WEAPON_DEFS, type WeaponClass } from './weapons';
import {
  MINIGUN_HOLD_GRACE_S,
  nearestPartByTrueAngle,
  SNIPER_PIERCE_MAX_LEGS,
  SNIPER_PIERCE_MIN_FACTOR,
  SNIPER_WALL_PROBE_M,
  sniperPiercesAll,
  sniperWallDamageFactor,
} from './match-helpers';
import { damageAtDistance, penetrationFactor } from './ballistics';
import { AIM_PARTS, rankAimPoints, type Vec3 } from './aimassist';

// ── ③ 貫通適格(sniperクラスのみ) ─────────────────────────────────────
describe('R59③ sniperPiercesAll(SRだけが無限貫通・連鎖)', () => {
  it('全武器中、貫通連鎖の適格はスコープSR 5種に限られる(marksman/exotic/ARは対象外)', () => {
    const allIds = [...PRIMARY_IDS, ...SECONDARY_IDS];
    const piercers = allIds.filter((id) => sniperPiercesAll(WEAPON_DEFS[id]!.class)).sort();
    expect(piercers).toEqual([
      'kurowashi-am',
      'raicho-sniper',
      'shirayuki-sniper',
      'sigi-sniper',
      'yamasemi-dmr',
    ]);
  });

  it('SR 5種は全て scope 付き(スナップ層/scopedShot と同じ武器群=体感の一貫性)', () => {
    for (const id of ['yamasemi-dmr', 'raicho-sniper', 'shirayuki-sniper', 'sigi-sniper', 'kurowashi-am']) {
      expect(WEAPON_DEFS[id]!.scope, id).toBe(true);
    }
  });

  it('非スナイパー(AR/LMG/SG/marksman/ミニガン)は false=従来挙動(壁1枚・botで停止)不変', () => {
    for (const id of ['kaede-ar', 'kumagera-lmg', 'hiiragi-sg', 'shirasagi-mk', 'shura-lmg', 'fists']) {
      expect(sniperPiercesAll(WEAPON_DEFS[id]!.class), id).toBe(false);
    }
  });
});

// ── ③ 壁減衰の累積と下限 ────────────────────────────────────────────
describe('R59③ sniperWallDamageFactor(壁N枚でも下限0.35で致命傷が残る)', () => {
  it('薄い壁1枚は従来の penetrationFactor と同値(下限に達しない領域は挙動互換)', () => {
    const f = sniperWallDamageFactor(1, 0.1, 0.6);
    expect(f).toBeCloseTo(penetrationFactor(0.1, 0.6), 9);
    expect(f).toBeGreaterThan(SNIPER_PIERCE_MIN_FACTOR);
  });

  it('壁を重ねても単調非増加で、下限0.35を決して下回らない(壁10枚シミュレーション)', () => {
    let factor = 1;
    for (let wall = 0; wall < 10; wall += 1) {
      const next = sniperWallDamageFactor(factor, 0.3, 0.6);
      expect(next).toBeLessThanOrEqual(factor);
      expect(next).toBeGreaterThanOrEqual(SNIPER_PIERCE_MIN_FACTOR);
      factor = next;
    }
    expect(factor).toBe(SNIPER_PIERCE_MIN_FACTOR);
  });

  it('貫通力を超える厚み(従来なら factor=0 で停止)でも 0.35 で弾が生き残る', () => {
    expect(penetrationFactor(1.0, 0.6)).toBe(0); // 従来武器はここで停止
    expect(sniperWallDamageFactor(1, 1.0, 0.6)).toBe(SNIPER_PIERCE_MIN_FACTOR);
  });

  it('黒鷲(対物SR)は壁N枚後も頭OSKが残る(180×1.9×0.35=119.7≥100)、胴も63で致命傷級', () => {
    const am = WEAPON_DEFS['kurowashi-am']!;
    const floorDamage = am.damage * SNIPER_PIERCE_MIN_FACTOR;
    expect(floorDamage * am.headshotMultiplier).toBeGreaterThanOrEqual(100);
    expect(floorDamage).toBeGreaterThan(60);
  });

  it('SRのfalloffは全域0.9維持なので、連鎖ヒットの距離減衰も遠距離で崩れない', () => {
    const dsr = WEAPON_DEFS['yamasemi-dmr']!;
    // 3体連鎖の想定距離(100/150/200m)全てで満額(start=600m より手前)
    for (const d of [100, 150, 200]) {
      expect(damageAtDistance(dsr.damage, d, dsr.falloff)).toBe(dsr.damage);
    }
  });

  it('連鎖の構造定数: 最大レグ16(無限ループ防止)・壁厚計測4.5m(全SRの貫通力1.2m以上)', () => {
    expect(SNIPER_PIERCE_MAX_LEGS).toBe(16);
    expect(SNIPER_PIERCE_MAX_LEGS).toBeGreaterThanOrEqual(8); // 敵連鎖+壁数枚が1弾道に収まる
    for (const id of ['yamasemi-dmr', 'raicho-sniper', 'shirayuki-sniper', 'sigi-sniper', 'kurowashi-am']) {
      expect(SNIPER_WALL_PROBE_M).toBeGreaterThan(WEAPON_DEFS[id]!.penetrationM);
    }
  });

  it('一直線の敵N体はSRなら全員ヒット・ARは1体目で停止(tracePelletのレグ契約シミュレーション)', () => {
    // tracePellet の契約: botヒット時 pierceAll でなければ return、pierceAll なら
    // damageFactor 不変(敵体は減衰なし)のまま次レグへ継続する。
    const simulateChain = (weaponClass: WeaponClass, bots: number): number[] => {
      const pierceAll = sniperPiercesAll(weaponClass);
      const maxLegs = pierceAll ? SNIPER_PIERCE_MAX_LEGS : 2;
      const damageFactor = 1; // 敵体貫通では減衰しない(壁のみ sniperWallDamageFactor)
      const hits: number[] = [];
      for (let leg = 0; leg < maxLegs && hits.length < bots; leg += 1) {
        hits.push(damageFactor);
        if (!pierceAll) break; // 従来武器はbotヒットで停止
      }
      return hits;
    };
    expect(simulateChain('sniper', 5)).toEqual([1, 1, 1, 1, 1]); // 5体全ヒット・全員満額
    expect(simulateChain('ar', 5)).toEqual([1]); // ARは1体目で停止
  });
});

// ── ④ SR吸着の最近接部位選択(真の角度・頭バイアス排除) ─────────────────
describe('R59④ nearestPartByTrueAngle(頭が近ければ頭、胴が近ければ胴)', () => {
  const EYE: Vec3 = { x: 0, y: 0, z: 0 };
  const BASE: Vec3 = { x: 0, y: 0, z: -100 }; // 100m先の敵(カプセル中心が視線の高さ)
  const fwdTo = (dy: number): Vec3 => {
    const len = Math.hypot(dy, 100);
    return { x: 0, y: dy / len, z: -100 / len };
  };

  it('頭付近(dy=0.7)を狙うと head アンカーが選ばれる', () => {
    const ranked = rankAimPoints(EYE, fwdTo(0.7), BASE, AIM_PARTS, 300);
    expect(nearestPartByTrueAngle(ranked)?.part).toBe('head');
  });

  it('胴付近(dy=0.4)では chest — バイアス順の先頭(head)ではなく真の角度で選ぶ', () => {
    const ranked = rankAimPoints(EYE, fwdTo(0.4), BASE, AIM_PARTS, 300);
    // 100m では head バイアス(+0.4°)が角度差を上回り、eff順の先頭は head になってしまう。
    // 吸着でこれを使うと自動HS化するため、真の角度最近接=chest を選ぶのが④の本質
    expect(ranked[0]?.part).toBe('head');
    expect(nearestPartByTrueAngle(ranked)?.part).toBe('chest');
  });

  it('腰下(dy=-0.3)では waist/limb 側に寄る(頭へは決して吸われない)', () => {
    const ranked = rankAimPoints(EYE, fwdTo(-0.3), BASE, AIM_PARTS, 300);
    const part = nearestPartByTrueAngle(ranked)?.part;
    expect(part === 'waist' || part === 'limb').toBe(true);
  });

  it('候補が空(可視部位なし)なら null=呼び出し側は従来方向へフォールバック', () => {
    expect(nearestPartByTrueAngle([])).toBeNull();
  });

  it('選択結果は候補中の最小 angle と一致する(定義の固定)', () => {
    const ranked = rankAimPoints(EYE, fwdTo(0.5), BASE, AIM_PARTS, 300);
    const best = nearestPartByTrueAngle(ranked);
    const minAngle = Math.min(...ranked.map((r) => r.angle));
    expect(best?.angle).toBe(minAngle);
  });
});

// ── ①関連の整合(このラウンドでmatch側が参照する定数の存在確認) ──────────
describe('R59 配線整合スモーク', () => {
  it('MINIGUN_HOLD_GRACE_S は 0.8s(match.ts スピン維持猶予の配線先)', () => {
    expect(MINIGUN_HOLD_GRACE_S).toBe(0.8);
  });
});
