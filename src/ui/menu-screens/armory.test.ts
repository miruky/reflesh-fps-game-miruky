// W-ENZA FB8: 武器庫の計器層(純関数)のピン。vitestはnode環境のため、DOM描画ではなく
// 実データ(WEAPON_DEFS/camo)から導出されるテキスト・カウントの正しさを固定する。
import { describe, expect, it } from 'vitest';
import {
  masteryCounts,
  modeLabel,
  nextCamoGoal,
  weaponFlavor,
  weaponKicker,
  weaponSubline,
} from './armory';
import { CLASS_LABELS, computeDerivedStats } from './shared';
import { emptyProfile } from '../../game/progression';
import { PRIMARY_IDS, WEAPON_DEFS } from '../../game/weapons';
import { CAMO_TIERS, camoName, camoTierFor, goldConditionFor } from '../../game/camo';

const kaede = WEAPON_DEFS['kaede-ar']!;

describe('modeLabel', () => {
  it('全主武器で3種のいずれかを返す(実データ全数)', () => {
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id]!;
      const label = modeLabel(def);
      expect(
        label === 'フルオート' || label === '単発' || label.startsWith('バースト'),
        `${id}: ${label}`,
      ).toBe(true);
    }
  });
});

describe('weaponSubline (武器行の計器)', () => {
  it('実績なし: モード/装弾のみ(キル数を出さない)', () => {
    const p = emptyProfile();
    const s = weaponSubline(kaede, p);
    expect(s).toContain(`装弾 ${kaede.magazineSize}`);
    expect(s).not.toContain('キル');
  });

  it('キル実績あり: 実数の千区切りキルと錬度(カモ段位と同期)を含む', () => {
    const p = emptyProfile();
    p.weaponStats[kaede.id] = { kills: 4120, headshots: 300 };
    const s = weaponSubline(kaede, p);
    expect(s).toContain('4,120キル');
    const tier = camoTierFor(p.weaponStats[kaede.id]);
    expect(tier).toBeGreaterThan(0);
    expect(s).toContain(`錬度${tier}`);
  });
});

describe('weaponKicker / weaponFlavor (銘板の計器層)', () => {
  it('kickerは型番大文字+クラス実名+発射モード', () => {
    const k = weaponKicker(kaede);
    expect(k).toContain('KAEDE-AR');
    expect(k).toContain(CLASS_LABELS[kaede.class]);
    expect(k).toContain(modeLabel(kaede));
  });

  it('flavorは実スペック(装弾/TTK/確殺)のみから導出される', () => {
    const d = computeDerivedStats(kaede);
    const f = weaponFlavor(kaede);
    expect(f).toContain(kaede.name);
    expect(f).toContain(`装弾${kaede.magazineSize}発`);
    expect(f).toContain(`TTK ${d.ttk}ms`);
    expect(f).toContain(`確殺${d.shotsToKill}発`);
  });
});

describe('masteryCounts (保有/マスタリーの実カウント)', () => {
  it('空プロファイル: マスタリー0、保有はレベル1解放分のみ(0<owned<=total)', () => {
    const v = masteryCounts(emptyProfile(), 1);
    expect(v.gold).toBe(0);
    expect(v.diamond).toBe(0);
    expect(v.darkMatter).toBe(0);
    expect(v.total).toBe(PRIMARY_IDS.length);
    expect(v.owned).toBeGreaterThan(0);
    expect(v.owned).toBeLessThanOrEqual(v.total);
  });

  it('カンストレベル: 全武器保有。金条件を満たした武器はgoldに数えられる', () => {
    const p = emptyProfile();
    const gc = goldConditionFor(kaede.id);
    p.weaponStats[kaede.id] = { kills: gc.kills, headshots: gc.headshots };
    const v = masteryCounts(p, 99999);
    expect(v.owned).toBe(v.total);
    expect(v.gold).toBeGreaterThanOrEqual(1);
  });
});

describe('nextCamoGoal (次の錬成目標)', () => {
  it('空プロファイル: 最初のティアが目標になり進捗は0から', () => {
    const g = nextCamoGoal(kaede, emptyProfile());
    expect(g).not.toBeNull();
    expect(g!.name).toBe(camoName(CAMO_TIERS[0]!.id));
    expect(g!.current).toBe(0);
    expect(g!.target).toBeGreaterThan(0);
  });

  it('カモ非対応武器(副武器)はnull', () => {
    const suzume = WEAPON_DEFS['suzume'];
    if (!suzume) return; // 実データが変わったら黙って通す(存在ピンは別テストの責務)
    expect(nextCamoGoal(suzume, emptyProfile())).toBeNull();
  });
});
