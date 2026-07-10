import { describe, expect, it } from 'vitest';
import { BIOMES } from './biomes';
import { stageDefFromId } from './biomes';
import {
  CAMPAIGN,
  allMissions,
  firstMissionId,
  missionById,
  nextMissionId,
  type MissionChallengeKind,
  type MissionDef,
  type ModifierId,
  type RadioSpeaker,
} from './campaign';

const STAGE_ID_RE = /^gen-([a-z]+)-(\d+)$/;
const VALID_MODIFIERS: readonly ModifierId[] = [
  'one-life',
  'low-gravity',
  'no-regen',
  'dense-fog',
  'elite-swarm',
];
const VALID_CHALLENGE_KINDS: readonly MissionChallengeKind[] = [
  'no-death',
  'hs-count',
  'accuracy',
  'no-reload',
  'weapon-class',
];
const VALID_RADIO_SPEAKERS: readonly RadioSpeaker[] = ['kagerou', 'homura', 'hibana', 'kurogane'];
const VALID_RADIO_EVENTS = ['start', 'boss-hp50', 'wave-clear', 'objective-done'] as const;

function flat(): MissionDef[] {
  return CAMPAIGN.flatMap((c) => c.missions);
}

// ── R53-W2「帝王編」で追加された ch9/ch10 を除いた既存48ミッション(ch1-8)の
// 素片(regression用の手打ちスナップショット)。id/chapterId/index/stageId/primaryId/
// objective.kind/durationS/parTimeS/waves数/modifiers/brief行数が、追加作業の前後で
// 一切変化していないことを保証する。値は実装から独立して手で書き起こしたもの。
interface MissionFingerprint {
  id: string;
  chapterId: string;
  index: number;
  stageId: string;
  primaryId: string;
  objectiveKind: string;
  durationS: number;
  parTimeS: number;
  wavesLen: number;
  modifiers: string;
  briefLen: number;
}
const EXISTING_48: readonly MissionFingerprint[] = [
  // ch1: urban / suzume
  { id: 'c1m1-cold-boot', chapterId: 'ch1', index: 0, stageId: 'gen-urban-1007', primaryId: 'suzume', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 90, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c1m2-zero-in', chapterId: 'ch1', index: 1, stageId: 'gen-urban-1144', primaryId: 'suzume', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 100, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c1m3-wall-trial', chapterId: 'ch1', index: 2, stageId: 'gen-urban-1281', primaryId: 'suzume', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 100, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c1m4-armory-hold', chapterId: 'ch1', index: 3, stageId: 'gen-urban-1418', primaryId: 'suzume', objectiveKind: 'defend', durationS: 90, parTimeS: 90, wavesLen: 3, modifiers: '', briefLen: 3 },
  { id: 'c1m5-swarm-trial', chapterId: 'ch1', index: 4, stageId: 'gen-urban-1555', primaryId: 'suzume', objectiveKind: 'survive', durationS: 120, parTimeS: 120, wavesLen: 4, modifiers: '', briefLen: 3 },
  { id: 'c1m6-instructor-prime', chapterId: 'ch1', index: 5, stageId: 'gen-urban-1692', primaryId: 'suzume', objectiveKind: 'assassinate', durationS: 300, parTimeS: 130, wavesLen: 2, modifiers: '', briefLen: 3 },
  // ch2: harbor / kaede-ar
  { id: 'c2m1-dockfall', chapterId: 'ch2', index: 0, stageId: 'gen-harbor-2007', primaryId: 'kaede-ar', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 110, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c2m2-crane-overwatch', chapterId: 'ch2', index: 1, stageId: 'gen-harbor-2144', primaryId: 'kaede-ar', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c2m3-cargo-breach', chapterId: 'ch2', index: 2, stageId: 'gen-harbor-2281', primaryId: 'kaede-ar', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 130, wavesLen: 3, modifiers: '', briefLen: 3 },
  { id: 'c2m4-fuel-line', chapterId: 'ch2', index: 3, stageId: 'gen-harbor-2418', primaryId: 'kaede-ar', objectiveKind: 'extract', durationS: 300, parTimeS: 110, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c2m5-tide-survival', chapterId: 'ch2', index: 4, stageId: 'gen-harbor-2555', primaryId: 'kaede-ar', objectiveKind: 'survive', durationS: 150, parTimeS: 150, wavesLen: 4, modifiers: '', briefLen: 3 },
  { id: 'c2m6-harbor-hammer', chapterId: 'ch2', index: 5, stageId: 'gen-harbor-2692', primaryId: 'kaede-ar', objectiveKind: 'assassinate', durationS: 300, parTimeS: 140, wavesLen: 2, modifiers: '', briefLen: 3 },
  // ch3: neon / tsubaki-smg
  { id: 'c3m1-neon-ingress', chapterId: 'ch3', index: 0, stageId: 'gen-neon-3007', primaryId: 'tsubaki-smg', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 110, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c3m2-rooftop-run', chapterId: 'ch3', index: 1, stageId: 'gen-neon-3144', primaryId: 'tsubaki-smg', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c3m3-market-hold', chapterId: 'ch3', index: 2, stageId: 'gen-neon-3281', primaryId: 'tsubaki-smg', objectiveKind: 'defend', durationS: 120, parTimeS: 120, wavesLen: 3, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c3m4-blackout-stealth', chapterId: 'ch3', index: 3, stageId: 'gen-neon-3418', primaryId: 'tsubaki-smg', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: 'dense-fog,one-life', briefLen: 3 },
  { id: 'c3m5-arcade-survival', chapterId: 'ch3', index: 4, stageId: 'gen-neon-3555', primaryId: 'tsubaki-smg', objectiveKind: 'survive', durationS: 150, parTimeS: 150, wavesLen: 4, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c3m6-night-wraith', chapterId: 'ch3', index: 5, stageId: 'gen-neon-3692', primaryId: 'tsubaki-smg', objectiveKind: 'assassinate', durationS: 300, parTimeS: 140, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  // ch4: dusk / yamasemi-dmr
  { id: 'c4m1-ridge-assault', chapterId: 'ch4', index: 0, stageId: 'gen-dusk-4007', primaryId: 'yamasemi-dmr', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 110, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c4m2-marksman-duel', chapterId: 'ch4', index: 1, stageId: 'gen-dusk-4144', primaryId: 'yamasemi-dmr', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c4m3-cliff-escort', chapterId: 'ch4', index: 2, stageId: 'gen-dusk-4281', primaryId: 'yamasemi-dmr', objectiveKind: 'extract', durationS: 300, parTimeS: 115, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c4m4-array-breach', chapterId: 'ch4', index: 3, stageId: 'gen-dusk-4418', primaryId: 'yamasemi-dmr', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 135, wavesLen: 3, modifiers: 'no-regen', briefLen: 3 },
  { id: 'c4m5-summit-survival', chapterId: 'ch4', index: 4, stageId: 'gen-dusk-4555', primaryId: 'yamasemi-dmr', objectiveKind: 'survive', durationS: 150, parTimeS: 150, wavesLen: 4, modifiers: 'no-regen', briefLen: 3 },
  { id: 'c4m6-peak-gunner', chapterId: 'ch4', index: 5, stageId: 'gen-dusk-4692', primaryId: 'yamasemi-dmr', objectiveKind: 'assassinate', durationS: 300, parTimeS: 140, wavesLen: 2, modifiers: 'no-regen', briefLen: 3 },
  // ch5: desert / miyama-br
  { id: 'c5m1-dune-drive', chapterId: 'ch5', index: 0, stageId: 'gen-desert-5007', primaryId: 'miyama-br', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 115, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c5m2-nest-hunt', chapterId: 'ch5', index: 1, stageId: 'gen-desert-5144', primaryId: 'miyama-br', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 125, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c5m3-sandstorm-stealth', chapterId: 'ch5', index: 2, stageId: 'gen-desert-5281', primaryId: 'miyama-br', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: 'dense-fog,one-life', briefLen: 3 },
  { id: 'c5m4-oasis-hold', chapterId: 'ch5', index: 3, stageId: 'gen-desert-5418', primaryId: 'miyama-br', objectiveKind: 'defend', durationS: 130, parTimeS: 130, wavesLen: 3, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c5m5-buried-survival', chapterId: 'ch5', index: 4, stageId: 'gen-desert-5555', primaryId: 'miyama-br', objectiveKind: 'survive', durationS: 165, parTimeS: 150, wavesLen: 5, modifiers: 'dense-fog', briefLen: 3 },
  { id: 'c5m6-sand-broodmaker', chapterId: 'ch5', index: 5, stageId: 'gen-desert-5692', primaryId: 'miyama-br', objectiveKind: 'assassinate', durationS: 300, parTimeS: 145, wavesLen: 2, modifiers: 'dense-fog', briefLen: 3 },
  // ch6: snow / kumagera-lmg
  { id: 'c6m1-whiteout-assault', chapterId: 'ch6', index: 0, stageId: 'gen-snow-6007', primaryId: 'kumagera-lmg', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 130, wavesLen: 2, modifiers: 'elite-swarm', briefLen: 3 },
  { id: 'c6m2-icewall-hunt', chapterId: 'ch6', index: 1, stageId: 'gen-snow-6144', primaryId: 'kumagera-lmg', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 130, wavesLen: 2, modifiers: 'elite-swarm', briefLen: 3 },
  { id: 'c6m3-convoy-escort', chapterId: 'ch6', index: 2, stageId: 'gen-snow-6281', primaryId: 'kumagera-lmg', objectiveKind: 'extract', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: '', briefLen: 3 },
  { id: 'c6m4-bunker-breach', chapterId: 'ch6', index: 3, stageId: 'gen-snow-6418', primaryId: 'kumagera-lmg', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 135, wavesLen: 3, modifiers: 'elite-swarm,no-regen', briefLen: 3 },
  { id: 'c6m5-blizzard-survival', chapterId: 'ch6', index: 4, stageId: 'gen-snow-6555', primaryId: 'kumagera-lmg', objectiveKind: 'survive', durationS: 165, parTimeS: 150, wavesLen: 4, modifiers: 'elite-swarm', briefLen: 3 },
  { id: 'c6m6-frost-bulwark', chapterId: 'ch6', index: 5, stageId: 'gen-snow-6692', primaryId: 'kumagera-lmg', objectiveKind: 'assassinate', durationS: 300, parTimeS: 145, wavesLen: 2, modifiers: 'elite-swarm', briefLen: 3 },
  // ch7: industrial / kaede-ar
  { id: 'c7m1-foundry-descent', chapterId: 'ch7', index: 0, stageId: 'gen-industrial-7007', primaryId: 'kaede-ar', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 135, wavesLen: 3, modifiers: 'dense-fog,no-regen', briefLen: 3 },
  { id: 'c7m2-line-shutdown', chapterId: 'ch7', index: 1, stageId: 'gen-industrial-7144', primaryId: 'kaede-ar', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 130, wavesLen: 2, modifiers: 'dense-fog,no-regen', briefLen: 3 },
  { id: 'c7m3-press-stealth', chapterId: 'ch7', index: 2, stageId: 'gen-industrial-7281', primaryId: 'kaede-ar', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: 'dense-fog,no-regen,one-life', briefLen: 3 },
  { id: 'c7m4-core-hold', chapterId: 'ch7', index: 3, stageId: 'gen-industrial-7418', primaryId: 'kaede-ar', objectiveKind: 'defend', durationS: 140, parTimeS: 140, wavesLen: 3, modifiers: 'dense-fog,no-regen', briefLen: 3 },
  { id: 'c7m5-furnace-survival', chapterId: 'ch7', index: 4, stageId: 'gen-industrial-7555', primaryId: 'kaede-ar', objectiveKind: 'survive', durationS: 165, parTimeS: 150, wavesLen: 5, modifiers: 'dense-fog,no-regen', briefLen: 3 },
  { id: 'c7m6-foundry-matron', chapterId: 'ch7', index: 5, stageId: 'gen-industrial-7692', primaryId: 'kaede-ar', objectiveKind: 'assassinate', durationS: 300, parTimeS: 150, wavesLen: 2, modifiers: 'dense-fog,no-regen', briefLen: 3 },
  // ch8: neon / kaede-ar
  { id: 'c8m1-low-g-breach', chapterId: 'ch8', index: 0, stageId: 'gen-neon-8007', primaryId: 'kaede-ar', objectiveKind: 'eliminate-all', durationS: 300, parTimeS: 130, wavesLen: 3, modifiers: 'low-gravity', briefLen: 3 },
  { id: 'c8m2-solar-array-hunt', chapterId: 'ch8', index: 1, stageId: 'gen-neon-8144', primaryId: 'kaede-ar', objectiveKind: 'eliminate-count', durationS: 300, parTimeS: 130, wavesLen: 2, modifiers: 'low-gravity', briefLen: 3 },
  { id: 'c8m3-airlock-escort', chapterId: 'ch8', index: 2, stageId: 'gen-neon-8281', primaryId: 'kaede-ar', objectiveKind: 'extract', durationS: 300, parTimeS: 120, wavesLen: 2, modifiers: 'low-gravity', briefLen: 3 },
  { id: 'c8m4-reactor-hold', chapterId: 'ch8', index: 3, stageId: 'gen-neon-8418', primaryId: 'kaede-ar', objectiveKind: 'defend', durationS: 140, parTimeS: 140, wavesLen: 3, modifiers: 'low-gravity', briefLen: 3 },
  { id: 'c8m5-gauntlet-survival', chapterId: 'ch8', index: 4, stageId: 'gen-neon-8555', primaryId: 'kaede-ar', objectiveKind: 'survive', durationS: 180, parTimeS: 150, wavesLen: 5, modifiers: 'low-gravity,elite-swarm', briefLen: 3 },
  { id: 'c8m6-cinder-core', chapterId: 'ch8', index: 5, stageId: 'gen-neon-8692', primaryId: 'kaede-ar', objectiveKind: 'assassinate', durationS: 300, parTimeS: 150, wavesLen: 2, modifiers: 'low-gravity,one-life', briefLen: 3 },
];

describe('CAMPAIGN 構造(全10章/60ミッション、R53-W2で ch9/ch10「帝王編」を追加)', () => {
  it('10章 / 各章6ミッション / 合計60', () => {
    expect(CAMPAIGN).toHaveLength(10);
    for (const c of CAMPAIGN) {
      expect(c.missions).toHaveLength(6);
    }
    expect(flat()).toHaveLength(60);
  });

  it('chapter.id は ch1..ch10 で順に並ぶ', () => {
    expect(CAMPAIGN.map((c) => c.id)).toEqual([
      'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8', 'ch9', 'ch10',
    ]);
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

  it('章に brief 相当の lore / title / subtitle が非空', () => {
    for (const c of CAMPAIGN) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.subtitle.length).toBeGreaterThan(0);
      expect(c.lore.length).toBeGreaterThan(0);
    }
  });
});

describe('既存48ミッション(ch1-8)の不変性(手打ちフィンガープリントによる回帰防止)', () => {
  it('先頭48件の id 列が既存の並びと完全一致する', () => {
    expect(flat().slice(0, 48).map((m) => m.id)).toEqual(EXISTING_48.map((f) => f.id));
  });

  it.each(EXISTING_48)(
    '$id: chapterId/index/stageId/primaryId/objective/durationS/parTimeS/waves数/modifiers/brief行数が不変',
    (fp) => {
      const m = missionById(fp.id);
      expect(m).not.toBeNull();
      expect(m!.chapterId).toBe(fp.chapterId);
      expect(m!.index).toBe(fp.index);
      expect(m!.stageId).toBe(fp.stageId);
      expect(m!.primaryId).toBe(fp.primaryId);
      expect(m!.objective.kind).toBe(fp.objectiveKind);
      expect(m!.durationS).toBe(fp.durationS);
      expect(m!.parTimeS).toBe(fp.parTimeS);
      expect(m!.waves).toHaveLength(fp.wavesLen);
      expect(m!.modifiers.join(',')).toBe(fp.modifiers);
      expect(m!.brief).toHaveLength(fp.briefLen);
    },
  );
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

  it('stageId は全ミッションで一意(seed衝突なし)', () => {
    const ids = flat().map((m) => m.stageId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('章ごとに想定 biome を使う(ch9=urban/ch10=neon)', () => {
    const expected: Record<string, string> = {
      ch1: 'urban',
      ch2: 'harbor',
      ch3: 'neon',
      ch4: 'dusk',
      ch5: 'desert',
      ch6: 'snow',
      ch7: 'industrial',
      ch8: 'neon',
      ch9: 'urban',
      ch10: 'neon',
    };
    for (const c of CAMPAIGN) {
      for (const m of c.missions) {
        const biome = STAGE_ID_RE.exec(m.stageId)![1]!;
        expect(biome).toBe(expected[c.id]);
      }
    }
  });
});

describe('支給武器 / 章ごとの primaryId(ch10 は c10m6 のみ fists へ上書き)', () => {
  it('各章の全ミッションが規定の支給武器を持つ(章の既定値からの上書きを除く)', () => {
    const expected: Record<string, string> = {
      ch1: 'suzume',
      ch2: 'kaede-ar',
      ch3: 'tsubaki-smg',
      ch4: 'yamasemi-dmr',
      ch5: 'miyama-br',
      ch6: 'kumagera-lmg',
      ch7: 'kaede-ar',
      ch8: 'kaede-ar',
      ch9: 'akatsuki-ar',
      ch10: 'raitei-lmg',
    };
    const overrides: Record<string, string> = { 'c10m6-kurogane-throne': 'fists' };
    for (const c of CAMPAIGN) {
      for (const m of c.missions) {
        expect(m.primaryId).toBe(overrides[m.id] ?? expected[c.id]);
      }
    }
  });

  it('武器id・敵kindは既知の値のみを参照する(存在しないIDの捏造がないことの目視補助)', () => {
    // weapons.ts に実在する id のうち、キャンペーンで使用されているものの部分集合。
    const knownWeaponIds = new Set([
      'suzume', 'kaede-ar', 'tsubaki-smg', 'yamasemi-dmr', 'miyama-br', 'kumagera-lmg',
      'akatsuki-ar', 'raitei-lmg', 'fists',
    ]);
    for (const m of flat()) {
      expect(knownWeaponIds.has(m.primaryId)).toBe(true);
    }
  });
});

describe('waves / objective 不変条件(60ミッション全体)', () => {
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

describe('新objective種(infiltrate/escort/collect)の使用箇所', () => {
  it('infiltrate はch9/ch10に少なくとも1件ずつ、labelを持つ', () => {
    const missions = flat().filter((m) => m.objective.kind === 'infiltrate');
    expect(missions.length).toBeGreaterThanOrEqual(2);
    expect(missions.some((m) => m.chapterId === 'ch9')).toBe(true);
    expect(missions.some((m) => m.chapterId === 'ch10')).toBe(true);
    for (const m of missions) {
      expect(m.objective.label.length).toBeGreaterThan(0);
    }
  });

  it('collect は count が正の整数で、ch9/ch10に存在する', () => {
    const missions = flat().filter((m) => m.objective.kind === 'collect');
    expect(missions.length).toBeGreaterThanOrEqual(2);
    for (const m of missions) {
      expect(Number.isInteger(m.objective.count)).toBe(true);
      expect(m.objective.count!).toBeGreaterThan(0);
    }
    expect(missions.some((m) => m.chapterId === 'ch9')).toBe(true);
  });

  it('escort は surviveS が正で、ch9に存在する', () => {
    const missions = flat().filter((m) => m.objective.kind === 'escort');
    expect(missions.length).toBeGreaterThanOrEqual(1);
    for (const m of missions) {
      expect(m.objective.surviveS).toBeDefined();
      expect(m.objective.surviveS!).toBeGreaterThan(0);
    }
    expect(missions.some((m) => m.id === 'c9m4-ash-escort')).toBe(true);
  });

  it('ch9 は新3種+既存種を混成する(重複なしで6種類)', () => {
    const ch9 = CAMPAIGN.find((c) => c.id === 'ch9')!;
    const kinds = ch9.missions.map((m) => m.objective.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toContain('infiltrate');
    expect(kinds).toContain('collect');
    expect(kinds).toContain('escort');
  });
});

describe('EnemyGroupDef.kind 拡張(zombie/master)', () => {
  it('zombie kind は ch9 の波で使用されている(燼骸の正史接続)', () => {
    const ch9 = CAMPAIGN.find((c) => c.id === 'ch9')!;
    const usesZombie = ch9.missions.some((m) =>
      m.waves.some((w) => w.enemies.some((e) => e.kind === 'zombie')),
    );
    expect(usesZombie).toBe(true);
  });

  it('master kind は ch9/ch10 のボス波で使用されている(灰の剣士/黒雷帝クロガネ)', () => {
    const ashSwordsman = missionById('c9m6-ash-swordsman')!;
    const kurogane = missionById('c10m6-kurogane-throne')!;
    for (const m of [ashSwordsman, kurogane]) {
      const hasMasterBoss = m.waves.some((w) =>
        w.enemies.some((e) => e.tier === 'boss' && e.kind === 'master'),
      );
      expect(hasMasterBoss).toBe(true);
    }
  });

  it('EnemyGroupDef.kind に指定のない既存グループは kind フィールドを持たない', () => {
    // ch1(zombie/master未使用の章)は従来どおり kind 未設定のままであること。
    const ch1 = CAMPAIGN.find((c) => c.id === 'ch1')!;
    for (const m of ch1.missions) {
      for (const w of m.waves) {
        for (const e of w.enemies) {
          expect(e.kind).toBeUndefined();
        }
      }
    }
  });
});

describe('EnemyWaveDef.trigger 拡張(boss-hp)', () => {
  it('boss-hp トリガはc10のボスラッシュで使用され、triggerHp01が0..1', () => {
    const m = missionById('c10m5-guardian-gauntlet')!;
    const bossHpWaves = m.waves.filter((w) => w.trigger === 'boss-hp');
    expect(bossHpWaves.length).toBeGreaterThanOrEqual(1);
    for (const w of bossHpWaves) {
      expect(w.triggerHp01).toBeDefined();
      expect(w.triggerHp01!).toBeGreaterThan(0);
      expect(w.triggerHp01!).toBeLessThanOrEqual(1);
    }
  });
});

describe('bossPhases(c10m6 黒雷帝クロガネ)', () => {
  it('hp01 が降順で並び、0..1に収まる', () => {
    const m = missionById('c10m6-kurogane-throne')!;
    expect(m.bossPhases).toBeDefined();
    const phases = m.bossPhases!;
    expect(phases.length).toBeGreaterThanOrEqual(2);
    for (const p of phases) {
      expect(p.hp01).toBeGreaterThan(0);
      expect(p.hp01).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < phases.length; i += 1) {
      expect(phases[i]!.hp01).toBeLessThan(phases[i - 1]!.hp01);
    }
  });

  it('黒雷帝の2/3段階は blackSlash/blink、pillars/summonCount を持つ(仕様どおり)', () => {
    const m = missionById('c10m6-kurogane-throne')!;
    const phases = m.bossPhases!;
    const p2 = phases.find((p) => Math.abs(p.hp01 - 0.6) < 1e-9);
    const p3 = phases.find((p) => Math.abs(p.hp01 - 0.25) < 1e-9);
    expect(p2).toBeDefined();
    expect(p2!.blackSlash).toBe(true);
    expect(p2!.blink).toBe(true);
    expect(p3).toBeDefined();
    expect(p3!.pillars).toBe(true);
    expect(p3!.summonCount).toBeGreaterThan(0);
  });

  it('他の59ミッションは bossPhases を持たない(単発ボスのまま)', () => {
    for (const m of flat()) {
      if (m.id === 'c10m6-kurogane-throne') continue;
      expect(m.bossPhases).toBeUndefined();
    }
  });
});

describe('rewardId(章クリア報酬のバッジ表示整合)', () => {
  it('c10m6=shinrai / c9m6=jingai(★V-B修正で追加)のみが rewardId を持つ', () => {
    for (const m of flat()) {
      if (m.id === 'c10m6-kurogane-throne') {
        expect(m.rewardId).toBe('shinrai');
      } else if (m.id === 'c9m6-ash-swordsman') {
        expect(m.rewardId).toBe('jingai');
      } else {
        expect(m.rewardId).toBeUndefined();
      }
    }
  });
});

describe('radio(無線劇)の型/内容の妥当性', () => {
  it('60ミッション中、少なくとも56ミッションに radio が設定されている(ch1-8レトロフィット+ch9/10本編)', () => {
    const withRadio = flat().filter((m) => (m.radio?.length ?? 0) > 0);
    expect(withRadio.length).toBeGreaterThanOrEqual(56);
  });

  it('ch1-8 は各3-5本、ch9/ch10 は各4-6本の radio を持つ', () => {
    for (const c of CAMPAIGN) {
      const isLate = c.id === 'ch9' || c.id === 'ch10';
      for (const m of c.missions) {
        const n = m.radio?.length ?? 0;
        if (isLate) {
          expect(n).toBeGreaterThanOrEqual(4);
          expect(n).toBeLessThanOrEqual(6);
        } else {
          expect(n).toBeGreaterThanOrEqual(3);
          expect(n).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('speaker は既知の4種のみ、text/at は非空で妥当', () => {
    for (const m of flat()) {
      for (const line of m.radio ?? []) {
        expect(VALID_RADIO_SPEAKERS).toContain(line.speaker);
        expect(line.text.length).toBeGreaterThan(0);
        const hasS = line.at.s !== undefined;
        const hasEvent = line.at.event !== undefined;
        expect(hasS || hasEvent).toBe(true);
        if (hasEvent) {
          expect(VALID_RADIO_EVENTS).toContain(line.at.event);
        }
        if (hasS) {
          expect(line.at.s!).toBeGreaterThanOrEqual(0);
          expect(line.at.s!).toBeLessThanOrEqual(m.durationS);
        }
      }
    }
  });

  it('text は話者名プレフィックス("カゲロウ:"等)を含まない(speakerフィールドと二重にならないこと)', () => {
    const prefixes = ['カゲロウ:', 'ホムラ:', 'ヒバナ:', 'クロガネ:'];
    for (const m of flat()) {
      for (const line of m.radio ?? []) {
        for (const p of prefixes) {
          expect(line.text.startsWith(p)).toBe(false);
        }
      }
    }
  });

  it('kurogane 話者は ch9(終盤の伏線)/ch10 にのみ登場する', () => {
    for (const m of flat()) {
      const usesKurogane = (m.radio ?? []).some((l) => l.speaker === 'kurogane');
      if (usesKurogane) {
        expect(['ch9', 'ch10']).toContain(m.chapterId);
      }
    }
  });

  it('hibana 話者が radio内で少なくとも1回使われている', () => {
    const usesHibana = flat().some((m) => (m.radio ?? []).some((l) => l.speaker === 'hibana'));
    expect(usesHibana).toBe(true);
  });

  it('radio総本数は150〜260本の範囲(概ね200本前後の目安)', () => {
    const total = flat().reduce((sum, m) => sum + (m.radio?.length ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(150);
    expect(total).toBeLessThanOrEqual(260);
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

  it('one-life は終章ボス c8m6 / 最終決戦 c10m6 を含む', () => {
    const cinderCore = missionById('c8m6-cinder-core')!;
    expect(cinderCore.modifiers).toContain('one-life');
    const kurogane = missionById('c10m6-kurogane-throne')!;
    expect(kurogane.modifiers).toContain('one-life');
  });
});

describe('brief / cutscene', () => {
  it('全ミッションが日本語2〜4行のブリーフを持つ', () => {
    for (const m of flat()) {
      expect(m.brief.length).toBeGreaterThanOrEqual(2);
      expect(m.brief.length).toBeLessThanOrEqual(4);
      for (const line of m.brief) {
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  it('c9m6 の cutscene には伏線の謎の声(???)が含まれない(speaker型の外に出さない設計)', () => {
    // 伏線は radio.speaker='kurogane' で表現しており、cutscene に "???" のような
    // フリーテキストのハックを持ち込まないことを確認する(型の一貫性)。
    const m = missionById('c9m6-ash-swordsman')!;
    for (const line of m.cutscene ?? []) {
      expect(line).not.toContain('???');
    }
  });
});

describe('クエリ関数(60ミッション)', () => {
  it('allMissions は60件で CAMPAIGN を平坦化したもの', () => {
    expect(allMissions()).toHaveLength(60);
    expect(allMissions().map((m) => m.id)).toEqual(flat().map((m) => m.id));
  });

  it('firstMissionId は先頭ミッション(ch1のまま不変)', () => {
    expect(firstMissionId()).toBe('c1m1-cold-boot');
    expect(firstMissionId()).toBe(CAMPAIGN[0]!.missions[0]!.id);
  });

  it('missionById は一致時に返し、不正idで null', () => {
    expect(missionById('c1m1-cold-boot')?.id).toBe('c1m1-cold-boot');
    expect(missionById('c9m1-ashfall-return')?.id).toBe('c9m1-ashfall-return');
    expect(missionById('c10m6-kurogane-throne')?.id).toBe('c10m6-kurogane-throne');
    expect(missionById('does-not-exist')).toBeNull();
  });

  it('nextMissionId は次を返し、末尾と不正idで null', () => {
    const all = allMissions();
    expect(nextMissionId(all[0]!.id)).toBe(all[1]!.id);
    expect(nextMissionId(all[all.length - 1]!.id)).toBeNull();
    expect(nextMissionId('does-not-exist')).toBeNull();
  });

  it('ch8最終ミッションの次は ch9初ミッション(章の連結)', () => {
    expect(nextMissionId('c8m6-cinder-core')).toBe('c9m1-ashfall-return');
  });

  it('ch9最終ミッションの次は ch10初ミッション(章の連結)', () => {
    expect(nextMissionId('c9m6-ash-swordsman')).toBe('c10m1-throne-approach');
  });

  it('nextMissionId を辿ると全60ミッションを順に巡れる', () => {
    const order: string[] = [];
    let cur: string | null = firstMissionId();
    while (cur !== null) {
      order.push(cur);
      cur = nextMissionId(cur);
    }
    expect(order).toEqual(allMissions().map((m) => m.id));
    expect(order[order.length - 1]).toBe('c10m6-kurogane-throne');
  });
});

// ── R54-W2 P0-A: MissionDef.challenge(3つ目の★条件)。60ミッションで3★が
// 構造的に到達不能だった欠陥(旧仕様=モディファイア有無だけで無条件に3★目を配る/
// 配らない設計だった)の根治。判定純関数 evalMissionChallenge は progression.ts 側
// (このファイルはデータ形状/割り当ての妥当性のみを検証する)。
describe('MissionDef.challenge(3つ目の★条件・R54-W2 P0-A)', () => {
  it('全60ミッションが1個ずつ challenge を持つ(3★到達不能の根治)', () => {
    for (const m of allMissions()) {
      expect(m.challenge, `${m.id} に challenge が無い`).toBeDefined();
    }
  });

  it('challenge.kind は既知の5種のみ', () => {
    for (const m of allMissions()) {
      expect(VALID_CHALLENGE_KINDS).toContain(m.challenge?.kind);
    }
  });

  it('challenge.label は非空の日本語文字列', () => {
    for (const m of allMissions()) {
      expect(m.challenge?.label.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("kind別のvalue: 'hs-count'/'accuracy'/'weapon-class' は正の数値を持つ(未定義=事実上1扱いも許容)", () => {
    for (const m of allMissions()) {
      const c = m.challenge;
      if (!c) continue;
      if (c.kind === 'hs-count' || c.kind === 'accuracy' || c.kind === 'weapon-class') {
        if (c.value !== undefined) {
          expect(c.value, `${m.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("kind: 'accuracy' の value は 0-100 の範囲(パーセンテージ)", () => {
    for (const m of allMissions()) {
      const c = m.challenge;
      if (c?.kind !== 'accuracy') continue;
      expect(c.value).toBeDefined();
      expect(c.value!).toBeGreaterThan(0);
      expect(c.value!).toBeLessThanOrEqual(100);
    }
  });

  it("kind: 'no-death'/'no-reload' は value を持たない(真偽判定のみのため不要)", () => {
    for (const m of allMissions()) {
      const c = m.challenge;
      if (c?.kind === 'no-death' || c?.kind === 'no-reload') {
        expect(c.value).toBeUndefined();
      }
    }
  });

  it('ミッション特性に沿った割り当て: 潜入(infiltrate)は全件no-death', () => {
    for (const m of allMissions()) {
      if (m.objective.kind === 'infiltrate') {
        expect(m.challenge?.kind, m.id).toBe('no-death');
      }
    }
  });

  it('ミッション特性に沿った割り当て: 防衛(defend)は全件accuracy', () => {
    for (const m of allMissions()) {
      if (m.objective.kind === 'defend') {
        expect(m.challenge?.kind, m.id).toBe('accuracy');
      }
    }
  });

  it('ミッション特性に沿った割り当て: 収集(collect)は全件no-reload', () => {
    for (const m of allMissions()) {
      if (m.objective.kind === 'collect') {
        expect(m.challenge?.kind, m.id).toBe('no-reload');
      }
    }
  });

  it('ミッション特性に沿った割り当て: 暗殺(assassinate/章末ボス)は全件hs-countかweapon-class', () => {
    // c10m6(黒雷帝クロガネ)のみ拳限定(primaryId:'fists')の近接オンリー最終決戦であり、
    // 近接攻撃はheadshotフラグが常にfalse(match.tsのhandleMelee/kunaiスラッシュ経路)なため、
    // hs-countを割り当てると3★が再び構造的に到達不能になる。weapon-classへ意図的に回避した
    // (この罠は実装中に発見し、報告で申し送り済み)。
    for (const m of allMissions()) {
      if (m.objective.kind !== 'assassinate') continue;
      expect(['hs-count', 'weapon-class']).toContain(m.challenge?.kind);
    }
    expect(missionById('c10m6-kurogane-throne')?.challenge?.kind).toBe('weapon-class');
  });

  it('全kindが少なくとも1回は使われている(バリエーションの確認)', () => {
    const kinds = new Set(allMissions().map((m) => m.challenge?.kind));
    for (const k of VALID_CHALLENGE_KINDS) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it('60ミッションの challenge 一覧表(id×kind×valueの回帰スナップショット)', () => {
    // 表の全件を手打ちで固定し、以後の変更を検知できるようにする(意図しない上書き防止)。
    const expected: Record<string, { kind: MissionChallengeKind; value?: number }> = {
      'c1m1-cold-boot': { kind: 'accuracy', value: 40 },
      'c1m2-zero-in': { kind: 'hs-count', value: 3 },
      'c1m3-wall-trial': { kind: 'no-death' },
      'c1m4-armory-hold': { kind: 'accuracy', value: 40 },
      'c1m5-swarm-trial': { kind: 'no-reload' },
      'c1m6-instructor-prime': { kind: 'hs-count', value: 5 },
      'c2m1-dockfall': { kind: 'accuracy', value: 40 },
      'c2m2-crane-overwatch': { kind: 'hs-count', value: 4 },
      'c2m3-cargo-breach': { kind: 'weapon-class', value: 3 },
      'c2m4-fuel-line': { kind: 'no-reload' },
      'c2m5-tide-survival': { kind: 'accuracy', value: 40 },
      'c2m6-harbor-hammer': { kind: 'hs-count', value: 5 },
      'c3m1-neon-ingress': { kind: 'no-death' },
      'c3m2-rooftop-run': { kind: 'weapon-class', value: 4 },
      'c3m3-market-hold': { kind: 'accuracy', value: 40 },
      'c3m4-blackout-stealth': { kind: 'no-death' },
      'c3m5-arcade-survival': { kind: 'hs-count', value: 5 },
      'c3m6-night-wraith': { kind: 'hs-count', value: 6 },
      'c4m1-ridge-assault': { kind: 'accuracy', value: 40 },
      'c4m2-marksman-duel': { kind: 'hs-count', value: 5 },
      'c4m3-cliff-escort': { kind: 'no-reload' },
      'c4m4-array-breach': { kind: 'no-death' },
      'c4m5-summit-survival': { kind: 'accuracy', value: 40 },
      'c4m6-peak-gunner': { kind: 'hs-count', value: 6 },
      'c5m1-dune-drive': { kind: 'accuracy', value: 40 },
      'c5m2-nest-hunt': { kind: 'hs-count', value: 5 },
      'c5m3-sandstorm-stealth': { kind: 'no-death' },
      'c5m4-oasis-hold': { kind: 'accuracy', value: 40 },
      'c5m5-buried-survival': { kind: 'no-reload' },
      'c5m6-sand-broodmaker': { kind: 'hs-count', value: 6 },
      'c6m1-whiteout-assault': { kind: 'accuracy', value: 40 },
      'c6m2-icewall-hunt': { kind: 'no-reload' },
      'c6m3-convoy-escort': { kind: 'hs-count', value: 4 },
      'c6m4-bunker-breach': { kind: 'no-death' },
      'c6m5-blizzard-survival': { kind: 'accuracy', value: 40 },
      'c6m6-frost-bulwark': { kind: 'hs-count', value: 6 },
      'c7m1-foundry-descent': { kind: 'no-death' },
      'c7m2-line-shutdown': { kind: 'accuracy', value: 40 },
      'c7m3-press-stealth': { kind: 'no-death' },
      'c7m4-core-hold': { kind: 'accuracy', value: 40 },
      'c7m5-furnace-survival': { kind: 'no-reload' },
      'c7m6-foundry-matron': { kind: 'hs-count', value: 7 },
      'c8m1-low-g-breach': { kind: 'accuracy', value: 40 },
      'c8m2-solar-array-hunt': { kind: 'hs-count', value: 5 },
      'c8m3-airlock-escort': { kind: 'no-reload' },
      'c8m4-reactor-hold': { kind: 'accuracy', value: 40 },
      'c8m5-gauntlet-survival': { kind: 'weapon-class', value: 4 },
      'c8m6-cinder-core': { kind: 'hs-count', value: 7 },
      'c9m1-ashfall-return': { kind: 'accuracy', value: 40 },
      'c9m2-silent-approach': { kind: 'no-death' },
      'c9m3-relic-salvage': { kind: 'no-reload' },
      'c9m4-ash-escort': { kind: 'no-reload' },
      'c9m5-jingai-night': { kind: 'hs-count', value: 5 },
      'c9m6-ash-swordsman': { kind: 'hs-count', value: 7 },
      'c10m1-throne-approach': { kind: 'accuracy', value: 40 },
      'c10m2-signal-severance': { kind: 'no-death' },
      'c10m3-echo-retrieval': { kind: 'no-reload' },
      'c10m4-command-hold': { kind: 'accuracy', value: 40 },
      'c10m5-guardian-gauntlet': { kind: 'hs-count', value: 6 },
      'c10m6-kurogane-throne': { kind: 'weapon-class', value: 4 },
    };
    expect(Object.keys(expected)).toHaveLength(60);
    for (const m of allMissions()) {
      const exp = expected[m.id];
      expect(exp, `${m.id} が期待表に無い`).toBeDefined();
      expect(m.challenge?.kind, m.id).toBe(exp!.kind);
      expect(m.challenge?.value, m.id).toBe(exp!.value);
    }
  });
});
