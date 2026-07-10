import { describe, expect, it } from 'vitest';
import {
  applyMissionDifficultyTuning,
  ninjaHp300Eligible,
  permanentDarkEmperorEligible,
  splitRadioLines,
} from './match';
import { tuningFor } from './bot';
import { CAMPAIGN, type RadioLine } from './campaign';
import { PLAYER_TEAM, ENEMY_TEAM, MODE_DEFS, type GameMode } from './modes';
import { SndMatch, SndRound, SND_ROUNDS_TO_WIN } from './snd';

// ── R53-W2 M2b: ストーリー帝王編+S&D配線のロジック検証 ──────────────────────
// Match本体はWebGL依存のため、配線から抽出した純関数+消費データの整合を固定する
// (killcam.test.ts と同じ「純関数ミラー」方針)。

describe('applyMissionDifficultyTuning(ミッション難易度乗算)', () => {
  const base = { ...tuningFor('normal', 'normal'), maxHp: 100, damage: 20 };

  it('normal/未指定は恒等(参照そのまま=アロケなし)', () => {
    expect(applyMissionDifficultyTuning(base)).toBe(base);
    expect(applyMissionDifficultyTuning(base, 'normal')).toBe(base);
  });

  it('easyはHP×0.75/攻撃×0.75(丸め)', () => {
    const t = applyMissionDifficultyTuning(base, 'easy');
    expect(t.maxHp).toBe(75);
    expect(t.damage).toBe(15);
  });

  it('hardはHP×1.4/攻撃×1.3(丸め)で、hell(×3/×2.5)未満に収まる', () => {
    const t = applyMissionDifficultyTuning(base, 'hard');
    expect(t.maxHp).toBe(140);
    expect(t.damage).toBe(26);
    expect(t.maxHp).toBeLessThan(base.maxHp * 3);
    expect(t.damage).toBeLessThan(base.damage * 2.5);
  });

  it('移動速度など他フィールドは不変', () => {
    const t = applyMissionDifficultyTuning(base, 'hard');
    expect(t.moveSpeedMul).toBe(base.moveSpeedMul);
  });
});

describe('splitRadioLines(無線劇スケジューラの振り分け)', () => {
  const lines: RadioLine[] = [
    { at: { event: 'start' }, speaker: 'kagerou', text: 'A' },
    { at: { s: 10 }, speaker: 'homura', text: 'B' },
    { at: { event: 'boss-hp50' }, speaker: 'kurogane', text: 'C' },
    { at: { s: 30 }, speaker: 'hibana', text: 'D' },
    { at: { event: 'start' }, speaker: 'homura', text: 'E' },
  ];

  it('イベント一致の行だけを fired へ移し、データ順を維持する', () => {
    const { fired, rest } = splitRadioLines(lines, { event: 'start' });
    expect(fired.map((l) => l.text)).toEqual(['A', 'E']);
    expect(rest.map((l) => l.text)).toEqual(['B', 'C', 'D']);
  });

  it('時刻到達の行だけを fired へ移す(未到達は rest に残る)', () => {
    const { fired, rest } = splitRadioLines(lines, { timeS: 12 });
    expect(fired.map((l) => l.text)).toEqual(['B']);
    expect(rest.map((l) => l.text)).toEqual(['A', 'C', 'D', 'E']);
  });

  it('条件なしは全て rest(誤発火しない)', () => {
    const { fired, rest } = splitRadioLines(lines, {});
    expect(fired).toHaveLength(0);
    expect(rest).toHaveLength(5);
  });
});

describe('帝王編データとエンジンの整合(ch9/ch10)', () => {
  const ch9 = CAMPAIGN.find((c) => c.id === 'ch9');
  const ch10 = CAMPAIGN.find((c) => c.id === 'ch10');

  it('ch9/ch10が存在し、各6ミッション(章クリアメダルの前提)', () => {
    expect(ch9).toBeDefined();
    expect(ch10).toBeDefined();
    expect(ch9!.missions).toHaveLength(6);
    expect(ch10!.missions).toHaveLength(6);
  });

  it('章最終ミッションIDが onMissionWon のメダル判定プレフィクスと一致する', () => {
    // match.ts onMissionWon は id.startsWith('c9m6') / ('c10m6') で章制覇を判定する
    expect(ch9!.missions[5]!.id.startsWith('c9m6')).toBe(true);
    expect(ch10!.missions[5]!.id.startsWith('c10m6')).toBe(true);
  });

  it('クロガネ(c10m6)は bossPhases を持ち hp01 降順(フェーズ機の遷移前提)', () => {
    const phases = ch10!.missions[5]!.bossPhases;
    expect(phases).toBeDefined();
    expect(phases!.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < phases!.length; i += 1) {
      expect(phases![i]!.hp01).toBeLessThan(phases![i - 1]!.hp01);
    }
  });

  it('新objective 3種(infiltrate/escort/collect)が帝王編で実際に使われている', () => {
    const kinds = new Set(
      [...ch9!.missions, ...ch10!.missions].map((m) => m.objective.kind),
    );
    expect(kinds.has('infiltrate')).toBe(true);
    expect(kinds.has('escort')).toBe(true);
    expect(kinds.has('collect')).toBe(true);
  });

  it('collectミッションは count を持つ(進捗/勝利判定の前提)', () => {
    for (const m of [...ch9!.missions, ...ch10!.missions]) {
      if (m.objective.kind === 'collect') {
        expect(m.objective.count ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('S&D配線の前提整合(H2契約との突き合わせ)', () => {
  it("mode 'snd' は teamBased(達人/巨躯ゲート・チームスポーンの前提)", () => {
    expect(MODE_DEFS.snd.teamBased).toBe(true);
  });

  it('先取はH2のハードコード(4)と一致する', () => {
    expect(SND_ROUNDS_TO_WIN).toBe(4);
  });

  it('sndScore=[自チーム,敵チーム]: SndMatch.scoreOf で自軍/敵軍を並べられる', () => {
    const m = new SndMatch(PLAYER_TEAM);
    m.recordRound(PLAYER_TEAM);
    m.recordRound(ENEMY_TEAM);
    m.recordRound(PLAYER_TEAM);
    expect([m.scoreOf(PLAYER_TEAM), m.scoreOf(ENEMY_TEAM)]).toEqual([2, 1]);
  });

  it('プレイヤーキャリアは uid=-1 センチネル(botのuidは0以上)で衝突しない', () => {
    const r = new SndRound(PLAYER_TEAM);
    r.pickupBomb(-1);
    expect(r.carrierUid).toBe(-1);
  });
});

// ── R54-W1 Q1: S&Dのfists優遇ゲート(HP300タンク化 + 常闇黒帝キット永続化を除外) ──
describe('ninjaHp300Eligible(HP300タンク化ゲート)', () => {
  it('fists装備かつ gungame/snd 以外は適用(既存挙動維持)', () => {
    const modes: GameMode[] = ['ffa', 'tdm', 'dom', 'story', 'score', 'zombie', 'hardpoint', 'killconfirm', 'training'];
    for (const m of modes) expect(ninjaHp300Eligible('fists', m)).toBe(true);
  });

  it('gungameは除外(V31既存挙動の非回帰)', () => {
    expect(ninjaHp300Eligible('fists', 'gungame')).toBe(false);
  });

  it('R54-W1 Q1: S&Dは新規に除外(ノーリスポーン戦術モードでのHP300タンク+黒雷帝の不公平を防ぐ)', () => {
    expect(ninjaHp300Eligible('fists', 'snd')).toBe(false);
  });

  it('fists以外の装備はどのモードでも適用しない', () => {
    expect(ninjaHp300Eligible('kaede-ar', 'ffa')).toBe(false);
    expect(ninjaHp300Eligible('kaede-ar', 'snd')).toBe(false);
  });
});

describe('permanentDarkEmperorEligible(常闇カモ黒帝モード永続化ゲート)', () => {
  it('gungame/training/snd 以外は適用(既存挙動維持)', () => {
    const modes: GameMode[] = ['ffa', 'tdm', 'dom', 'story', 'score', 'zombie', 'hardpoint', 'killconfirm'];
    for (const m of modes) expect(permanentDarkEmperorEligible(m)).toBe(true);
  });

  it('gungame/trainingは既存どおり除外(非回帰)', () => {
    expect(permanentDarkEmperorEligible('gungame')).toBe(false);
    expect(permanentDarkEmperorEligible('training')).toBe(false);
  });

  it('R54-W1 Q1: S&Dは新規に除外(HP300ゲートと対称)', () => {
    expect(permanentDarkEmperorEligible('snd')).toBe(false);
  });
});
