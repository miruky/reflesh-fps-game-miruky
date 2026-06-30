import { describe, expect, it } from 'vitest';
import { BIOMES } from './biomes';
import { stageDefFromId } from './biomes';
import {
  CAMPAIGN,
  allMissions,
  firstMissionId,
  missionById,
  nextMissionId,
  type MissionDef,
  type ModifierId,
} from './campaign';

const STAGE_ID_RE = /^gen-([a-z]+)-(\d+)$/;
const VALID_MODIFIERS: readonly ModifierId[] = [
  'one-life',
  'low-gravity',
  'no-regen',
  'dense-fog',
  'elite-swarm',
];

function flat(): MissionDef[] {
  return CAMPAIGN.flatMap((c) => c.missions);
}

describe('CAMPAIGN 構造', () => {
  it('8章 / 各章6ミッション / 合計48', () => {
    expect(CAMPAIGN).toHaveLength(8);
    for (const c of CAMPAIGN) {
      expect(c.missions).toHaveLength(6);
    }
    expect(flat()).toHaveLength(48);
  });

  it('chapter.id は ch1..ch8 で順に並ぶ', () => {
    expect(CAMPAIGN.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8']);
  });

  it('全 mission.id が一意', () => {
    const ids = flat().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mission.chapterId が所属章に一致し index が 0..5', () => {
    for (const c of CAMPAIGN) {
      c.missions.forEach((m, i) => {
        expect(m.chapterId).toBe(c.id);
        expect(m.index).toBe(i);
        expect(m.index).toBeGreaterThanOrEqual(0);
        expect(m.index).toBeLessThanOrEqual(5);
      });
    }
  });
});

describe('stageId / バイオーム', () => {
  it('全 stageId が正規表現に一致し biome 部が BIOMES のいずれか', () => {
    for (const m of flat()) {
      const match = STAGE_ID_RE.exec(m.stageId);
      expect(match).not.toBeNull();
      const biome = match![1]!;
      expect((BIOMES as readonly string[]).includes(biome)).toBe(true);
    }
  });

  it('stageDefFromId(stageId) が null でない', () => {
    for (const m of flat()) {
      expect(stageDefFromId(m.stageId)).not.toBeNull();
    }
  });

  it('章ごとに想定 biome を使う', () => {
    const expected: Record<string, string> = {
      ch1: 'urban',
      ch2: 'harbor',
      ch3: 'neon',
      ch4: 'dusk',
      ch5: 'desert',
      ch6: 'snow',
      ch7: 'industrial',
      ch8: 'neon',
    };
    for (const c of CAMPAIGN) {
      for (const m of c.missions) {
        const biome = STAGE_ID_RE.exec(m.stageId)![1]!;
        expect(biome).toBe(expected[c.id]);
      }
    }
  });
});

describe('支給武器 / 章ごとの primaryId', () => {
  it('各章の全ミッションが規定の支給武器を持つ', () => {
    const expected: Record<string, string> = {
      ch1: 'suzume',
      ch2: 'kaede-ar',
      ch3: 'tsubaki-smg',
      ch4: 'yamasemi-dmr',
      ch5: 'miyama-br',
      ch6: 'kumagera-lmg',
      ch7: 'kaede-ar',
      ch8: 'kaede-ar',
    };
    for (const c of CAMPAIGN) {
      for (const m of c.missions) {
        expect(m.primaryId).toBe(expected[c.id]);
      }
    }
  });
});

describe('waves / objective 不変条件', () => {
  it('waves は空でなく先頭が start トリガ', () => {
    for (const m of flat()) {
      expect(m.waves.length).toBeGreaterThan(0);
      expect(m.waves[0]!.trigger).toBe('start');
    }
  });

  it('eliminate-count は count が正の整数', () => {
    for (const m of flat()) {
      if (m.objective.kind === 'eliminate-count') {
        const n = m.objective.count;
        expect(n).toBeDefined();
        expect(Number.isInteger(n)).toBe(true);
        expect(n!).toBeGreaterThan(0);
      }
    }
  });

  it('survive / defend は surviveS が正', () => {
    for (const m of flat()) {
      if (m.objective.kind === 'survive' || m.objective.kind === 'defend') {
        expect(m.objective.surviveS).toBeDefined();
        expect(m.objective.surviveS!).toBeGreaterThan(0);
      }
    }
  });

  it('assassinate は少なくとも1波に boss 階層を含み bossName を持つ', () => {
    for (const m of flat()) {
      if (m.objective.kind === 'assassinate') {
        expect(m.objective.bossName).toBeTruthy();
        const hasBoss = m.waves.some((w) => w.enemies.some((e) => e.tier === 'boss'));
        expect(hasBoss).toBe(true);
      }
    }
  });

  it('各 wave の合計 count は 8 以下', () => {
    for (const m of flat()) {
      for (const w of m.waves) {
        const total = w.enemies.reduce((sum, e) => sum + e.count, 0);
        expect(total).toBeLessThanOrEqual(8);
      }
    }
  });

  it('enemies の count は全て正の整数', () => {
    for (const m of flat()) {
      for (const w of m.waves) {
        for (const e of w.enemies) {
          expect(Number.isInteger(e.count)).toBe(true);
          expect(e.count).toBeGreaterThan(0);
        }
      }
    }
  });

  it('durationS / parTimeS は正で parTimeS <= durationS', () => {
    for (const m of flat()) {
      expect(m.durationS).toBeGreaterThan(0);
      expect(m.parTimeS).toBeGreaterThan(0);
      expect(m.parTimeS).toBeLessThanOrEqual(m.durationS);
    }
  });
});

describe('modifiers', () => {
  it('使用される modifier は5種のいずれかのみ', () => {
    for (const m of flat()) {
      for (const mod of m.modifiers) {
        expect(VALID_MODIFIERS).toContain(mod);
      }
    }
  });

  it('ch8 の全ミッションが low-gravity を含む', () => {
    const ch8 = CAMPAIGN.find((c) => c.id === 'ch8')!;
    for (const m of ch8.missions) {
      expect(m.modifiers).toContain('low-gravity');
    }
  });

  it('one-life は終章ボス c8m6 を含む', () => {
    const boss = missionById('c8m6-cinder-core')!;
    expect(boss.modifiers).toContain('one-life');
  });
});

describe('brief', () => {
  it('全ミッションが日本語2〜4行のブリーフを持つ', () => {
    for (const m of flat()) {
      expect(m.brief.length).toBeGreaterThanOrEqual(2);
      expect(m.brief.length).toBeLessThanOrEqual(4);
      for (const line of m.brief) {
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('クエリ関数', () => {
  it('allMissions は48件で CAMPAIGN を平坦化したもの', () => {
    expect(allMissions()).toHaveLength(48);
    expect(allMissions().map((m) => m.id)).toEqual(flat().map((m) => m.id));
  });

  it('firstMissionId は先頭ミッション', () => {
    expect(firstMissionId()).toBe('c1m1-cold-boot');
    expect(firstMissionId()).toBe(CAMPAIGN[0]!.missions[0]!.id);
  });

  it('missionById は一致時に返し、不正idで null', () => {
    expect(missionById('c1m1-cold-boot')?.id).toBe('c1m1-cold-boot');
    expect(missionById('does-not-exist')).toBeNull();
  });

  it('nextMissionId は次を返し、末尾と不正idで null', () => {
    const all = allMissions();
    expect(nextMissionId(all[0]!.id)).toBe(all[1]!.id);
    expect(nextMissionId(all[all.length - 1]!.id)).toBeNull();
    expect(nextMissionId('does-not-exist')).toBeNull();
  });

  it('nextMissionId を辿ると全48ミッションを順に巡れる', () => {
    const order: string[] = [];
    let cur: string | null = firstMissionId();
    while (cur !== null) {
      order.push(cur);
      cur = nextMissionId(cur);
    }
    expect(order).toEqual(allMissions().map((m) => m.id));
  });
});
