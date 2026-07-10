import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from './bot';
import type { BossPhase, MissionDef } from './campaign';
import { ENEMY_TEAM, PLAYER_TEAM } from './modes';
import { makeSndSites, SndMatch, SndRound } from './snd';
import { motifWeightForMission, StoryEngine, type StoryHost } from './story-engine';

// R54 音響2 (M-AU): story-engine.ts の setBgmStem 配線(S&D設置中→'snd-planted' /
// ボスフェーズ活性中→'boss-duel' / それ以外の物語進行中→'story-motif')の単体テスト。
// StoryHost はファイル冒頭のコメントどおり「単体テスト可能」なDIなので、実際に使われる
// パスだけを満たす最小ホストを組み立てる。

function makeHost(overrides: Partial<StoryHost> = {}): StoryHost {
  const base: StoryHost = {
    player: { alive: true, position: new THREE.Vector3(), yaw: 0 } as unknown as StoryHost['player'],
    sounds: {
      setBgmStem: vi.fn(),
      sndFuseTick: vi.fn(),
      sndRoundWin: vi.fn(),
      radioSpeak: vi.fn(),
      kuroganeDefeat: vi.fn(),
      capture: vi.fn(),
    } as unknown as StoryHost['sounds'],
    bots: [],
    mission: null,
    modifierSet: new Set<string>(),
    scene: new THREE.Scene(),
    config: {} as unknown as StoryHost['config'],
    input: { isDown: () => false, wasPressed: () => false } as unknown as StoryHost['input'],
    effects: { explosion: vi.fn() } as unknown as StoryHost['effects'],
    tracker: { emitManual: vi.fn() } as unknown as StoryHost['tracker'],
    colors: {} as unknown as StoryHost['colors'],
    botSpawns: [],
    playerSpawns: [],
    announcements: [],
    feed: [],
    incoming: [],
    weapons: [] as unknown as StoryHost['weapons'],
    activeWeapon: {} as unknown as StoryHost['activeWeapon'],
    streakManager: { resetAll: vi.fn() },
    darkSlashWaves: [],
    ultCharge: 0,
    ultReadyNotified: false,
    tookDamage: false,
    deathVeil: 0,
    over: false,
    spawnBot: vi.fn() as unknown as StoryHost['spawnBot'],
    pickSpawn: vi.fn() as unknown as StoryHost['pickSpawn'],
    notePlayerDeath: vi.fn(),
    aliveEnemyCount: () => 0,
    addShake: vi.fn(),
    emitMedals: vi.fn(),
    refillGrenades: vi.fn(),
    incomingAngle: () => 0,
    disposeDarkSlashWave: vi.fn(),
    hostilesOf: () => [],
  };
  return { ...base, ...overrides };
}

function makeMission(over: Partial<MissionDef> = {}): MissionDef {
  return {
    id: 'c1m1-test',
    chapterId: 'ch1',
    index: 0,
    title: 'test',
    subtitle: 'test',
    stageId: 'gen-urban-1',
    primaryId: 'suzume',
    objective: { kind: 'eliminate-all', label: '全滅させろ' },
    waves: [],
    modifiers: [],
    durationS: 300,
    difficulty: 'normal',
    brief: [],
    parTimeS: 300,
    ...over,
  } as unknown as MissionDef;
}

const SND_BUY_TICK = 5.1; // SND_BUY_S(5s)を超えて buy→live へ進める1回更新

describe('story-engine.ts 音響配線(R54 M-AU): S&D設置ステム', () => {
  it('round.phase==="planted" でsetBgmStemが\'snd-planted\'へ切り替わる', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.update(SND_BUY_TICK); // buy→live
    round.onPlanted(); // live→planted(演出用ショートカット)
    const sndMatch = new SndMatch(PLAYER_TEAM);
    const sndSites = makeSndSites({ x: -10, z: 5 }, { x: 10, z: -5 });
    const host = makeHost({
      bots: [{ team: ENEMY_TEAM, alive: true } as unknown as Bot],
    });
    const engine = new StoryEngine(host);
    engine.sndRound = round;
    engine.sndMatch = sndMatch;
    engine.sndSites = sndSites;

    engine.updateSnd(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith('snd-planted');
  });

  it('planted以外(buy/live)ではsetBgmStemが呼ばれない(未突入)', () => {
    const round = new SndRound(PLAYER_TEAM); // phase='buy'のまま
    const sndMatch = new SndMatch(PLAYER_TEAM);
    const sndSites = makeSndSites({ x: -10, z: 5 }, { x: 10, z: -5 });
    const host = makeHost({
      bots: [{ team: ENEMY_TEAM, alive: true } as unknown as Bot],
    });
    const engine = new StoryEngine(host);
    engine.sndRound = round;
    engine.sndMatch = sndMatch;
    engine.sndSites = sndSites;

    engine.updateSnd(1 / 60);

    expect(host.sounds.setBgmStem).not.toHaveBeenCalled();
  });
});

describe('story-engine.ts 音響配線(R54 M-AU): ボスフェーズ活性判定', () => {
  it('bossPhases未設定/ボス不在ならfalse', () => {
    const host = makeHost({ mission: makeMission() });
    const engine = new StoryEngine(host);
    expect(engine.bossPhasesActive()).toBe(false);
  });

  it('bossPhasesが設定され、対応するボスが生存していればtrue', () => {
    const phases: BossPhase[] = [{ hp01: 0.5, blackSlash: true }];
    const boss = {
      tier: 'boss',
      alive: true,
      name: 'クロガネ',
      hp: 100,
      maxHp: 100,
      bossPhaseFlags: { blackSlash: false, blink: false, pillars: false },
    } as unknown as Bot;
    const host = makeHost({ mission: makeMission({ bossPhases: phases }), bots: [boss] });
    const engine = new StoryEngine(host);
    // フェーズ遷移/挙動を起こさないよう、既存フェーズを消化済み扱いにしておく
    engine.bossPhaseIdx = phases.length;
    expect(engine.bossPhasesActive()).toBe(true);
  });

  it('ボスが死亡していればfalse(撃破後は物語動機へ戻る)', () => {
    const phases: BossPhase[] = [{ hp01: 0.5 }];
    const boss = {
      tier: 'boss',
      alive: false,
      name: 'クロガネ',
      hp: 0,
      maxHp: 100,
      bossPhaseFlags: { blackSlash: false, blink: false, pillars: false },
    } as unknown as Bot;
    const host = makeHost({ mission: makeMission({ bossPhases: phases }), bots: [boss] });
    const engine = new StoryEngine(host);
    engine.bossPhaseRef = boss;
    expect(engine.bossPhasesActive()).toBe(false);
  });
});

describe('story-engine.ts 音響配線(R54 M-AU): updateStoryEngineのステム分岐', () => {
  it('ボスフェーズ活性中は setBgmStem(\'boss-duel\') が呼ばれる', () => {
    const phases: BossPhase[] = [{ hp01: 0.5 }];
    const boss = {
      tier: 'boss',
      alive: true,
      name: 'クロガネ',
      hp: 100,
      maxHp: 100,
      bossPhaseFlags: { blackSlash: false, blink: false, pillars: false },
    } as unknown as Bot;
    const mission = makeMission({ bossPhases: phases });
    const host = makeHost({ mission, bots: [boss] });
    const engine = new StoryEngine(host);
    // 既存フェーズ消化済み+フラグ全OFF: updateBossPhasesの演出分岐に入らせない
    engine.bossPhaseIdx = phases.length;

    engine.updateStoryEngine(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith('boss-duel');
  });

  it('ボスフェーズ非活性の通常進行中は setBgmStem(\'story-motif\', 進行度) が呼ばれる', () => {
    const mission = makeMission();
    const host = makeHost({ mission });
    const engine = new StoryEngine(host);

    engine.updateStoryEngine(1 / 60);

    expect(host.sounds.setBgmStem).toHaveBeenCalledWith('story-motif', expect.any(Number));
    const call = (host.sounds.setBgmStem as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('story-motif');
  });
});

describe('motifWeightForMission(章番号→動機の重み。main.tsのsetMusicProfile第2引数)', () => {
  it('非ストーリー(mission未注入)は0', () => {
    expect(motifWeightForMission(null)).toBe(0);
    expect(motifWeightForMission(undefined)).toBe(0);
  });

  it('ch1-3は0', () => {
    expect(motifWeightForMission(makeMission({ chapterId: 'ch1' }))).toBe(0);
    expect(motifWeightForMission(makeMission({ chapterId: 'ch3' }))).toBe(0);
  });

  it('ch4-6は0.4', () => {
    expect(motifWeightForMission(makeMission({ chapterId: 'ch4' }))).toBe(0.4);
    expect(motifWeightForMission(makeMission({ chapterId: 'ch6' }))).toBe(0.4);
  });

  it('ch7以降は0.8', () => {
    expect(motifWeightForMission(makeMission({ chapterId: 'ch7' }))).toBe(0.8);
    expect(motifWeightForMission(makeMission({ chapterId: 'ch10' }))).toBe(0.8);
  });

  it('数値化できない特別章(chB等)は0', () => {
    expect(motifWeightForMission(makeMission({ chapterId: 'chB' }))).toBe(0);
  });
});
