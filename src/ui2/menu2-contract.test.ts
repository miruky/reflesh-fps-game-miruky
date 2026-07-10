// W-ENZA2 契約網(F1) — jsdom不使用。
// v1の教訓: 「公開契約が揃っていること」自体をピンで固定する(main.tsの1行スワップの担保)。
import { describe, expect, it } from 'vitest';
import { Menu2 } from './menu2';
import { mountArmory } from './screens/armory';
import { mountBriefing, mountCampaign, mountMissionResult } from './screens/campaign';
import { mountDeploy } from './screens/deploy';
import { fmtInt, hubSublines, mountHub } from './screens/hub';
import { mountOptions, mountPause } from './screens/options';
import { mountResult } from './screens/result';
import { mountTitle } from './screens/title';
import type { Profile } from './types';

describe('W-ENZA2 契約網', () => {
  it('Menu2は旧Menuの公開APIを完全ミラーする(main.ts 1行スワップの根拠)', () => {
    const api = [
      'showMain',
      'showPause',
      'showResult',
      'showMissionResult',
      'showBriefing',
      'handleGamepad',
      'hide',
      'attachBg',
    ] as const;
    for (const name of api) {
      expect(typeof Menu2.prototype[name], name).toBe('function');
    }
  });

  it('全画面モジュールがmount契約をexportする', () => {
    for (const [name, fn] of Object.entries({
      mountTitle,
      mountHub,
      mountDeploy,
      mountArmory,
      mountCampaign,
      mountBriefing,
      mountMissionResult,
      mountOptions,
      mountPause,
      mountResult,
    })) {
      expect(typeof fn, name).toBe('function');
    }
  });

  it('hubの副文は実データから導出される(架空値の焼き込みなし)', () => {
    const profile = {
      campaign: { clearedMissions: ['c1m1', 'c1m2'] },
      bestZombieRound: 12,
    } as unknown as Profile;
    const sub = hubSublines(profile);
    expect(sub.stages).toMatch(/^全\d+面 · /);
    expect(sub.armory).toMatch(/^武器\d+種 · カモ · 特殊兵装EXOTIC \d+種$/);
    expect(sub.sortie).toMatch(/対戦\d+モード/);
    expect(sub.campaignRatio.cleared).toBe(2);
    expect(sub.campaignRatio.total).toBeGreaterThanOrEqual(60);
    expect(sub.zombieBest).toBe('最高 R12');
    // 稼働ロビー/PING等の架空値が混ざっていない
    expect(JSON.stringify(sub)).not.toMatch(/ロビー 21|8ms|BETA/);
  });

  it('fmtIntは千区切り', () => {
    expect(fmtInt(312847)).toBe('312,847');
    expect(fmtInt(0)).toBe('0');
  });
});
