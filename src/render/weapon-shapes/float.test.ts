// R59 MODEL-FLOAT: 浮遊パーツ機械監査の回帰テスト(float-audit.ts 専有)。
// 全武器の buildGunBody 出力(構造系バケツ)を連結クラスタ分解し、本体クラスタに
// 連結しない浮遊クラスタが 0 であることを恒久保証する(除外リスト=サイト系/意匠は
// float-audit.ts の ALLOWED_FLOATS/isIronEar が管理)。
import { describe, expect, it } from 'vitest';
import { WEAPON_DEFS } from '../../game/weapons';
import { auditWeaponFloat, formatCluster } from './float-audit';

describe('R59 全武器 浮遊パーツ機械監査', () => {
  it('全武器: 本体に連結しない未許容の浮遊クラスタ = 0', () => {
    const defs = Object.values(WEAPON_DEFS);
    expect(defs.length).toBeGreaterThanOrEqual(42);
    const failures: string[] = [];
    for (const def of defs) {
      const rep = auditWeaponFloat(def);
      for (const c of rep.floating) {
        failures.push(`${def.id}: ${formatCluster(c)}`);
      }
    }
    expect(failures, `浮遊クラスタ検出:\n${failures.join('\n')}`).toEqual([]);
  });

  it('監査は本体クラスタを必ず検出する(構造パーツ空の武器はない)', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      const rep = auditWeaponFloat(def);
      expect(rep.clusters, def.id).toBeGreaterThan(0);
    }
  });
});
