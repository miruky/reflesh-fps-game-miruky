import { describe, expect, it } from 'vitest';
import { PLAYER_TEAM, ENEMY_TEAM, MODE_DEFS, MODE_IDS } from './modes';
import {
  SndRound,
  SndMatch,
  isWithinSndSite,
  makeSndSites,
  SND_BUY_S,
  SND_LIVE_S,
  SND_FUSE_S,
  SND_ROUND_END_S,
  SND_PLANT_HOLD_S,
  SND_DEFUSE_HOLD_S,
  SND_ROUNDS_TO_WIN,
  SND_SIDE_SWAP_EVERY,
} from './snd';

// 60Hz固定ロジック相当の刻みでNステップ進める
function tick(round: SndRound, dt: number, steps: number): ReturnType<SndRound['update']> {
  let all: ReturnType<SndRound['update']> = [];
  for (let i = 0; i < steps; i += 1) all = all.concat(round.update(dt));
  return all;
}

describe('modes.ts snd 定義', () => {
  it("GameMode 'snd' が MODE_DEFS に存在する", () => {
    expect(MODE_DEFS.snd).toBeDefined();
    expect(MODE_DEFS.snd.name).toBe('サーチ&デストロイ');
    expect(MODE_DEFS.snd.teamBased).toBe(true);
  });

  it("MODE_IDS に 'snd' が含まれる", () => {
    expect(MODE_IDS).toContain('snd');
  });
});

describe('SndRound: フェーズ遷移', () => {
  it('初期フェーズは buy', () => {
    const round = new SndRound(PLAYER_TEAM);
    expect(round.phase).toBe('buy');
    expect(round.phaseTimeLeft).toBeCloseTo(SND_BUY_S);
  });

  it('buy が経過しないと live へ遷移しない', () => {
    const round = new SndRound(PLAYER_TEAM);
    const events = tick(round, 0.1, Math.floor((SND_BUY_S - 0.5) * 10));
    expect(round.phase).toBe('buy');
    expect(events.some((e) => e.kind === 'phase')).toBe(false);
  });

  it('buy 経過で live へ遷移し phase イベントを発火する', () => {
    const round = new SndRound(PLAYER_TEAM);
    const events = tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    expect(round.phase).toBe('live');
    expect(events).toContainEqual({ kind: 'phase', phase: 'live' });
    expect(round.phaseTimeLeft).toBeLessThanOrEqual(SND_LIVE_S);
  });

  function toLive(round: SndRound): void {
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
  }

  it('live で90秒未設置のままだと timeout で守備側勝利', () => {
    const round = new SndRound(PLAYER_TEAM);
    toLive(round);
    const events = tick(round, 0.5, Math.ceil((SND_LIVE_S + 1) * 2));
    expect(round.phase).toBe('roundEnd');
    expect(round.winner).toBe(ENEMY_TEAM); // 守備側 = 攻撃側の対
    expect(events).toContainEqual({ kind: 'round-win', winner: ENEMY_TEAM, reason: 'timeout' });
    expect(events).toContainEqual({ kind: 'phase', phase: 'roundEnd' });
  });

  it('roundEnd フェーズはタイマーのみ経過し追加イベントは出ない', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.resolveRound('timeout');
    expect(round.phase).toBe('roundEnd');
    expect(round.phaseTimeLeft).toBeCloseTo(SND_ROUND_END_S);
    const events = tick(round, 1, 10);
    expect(events).toEqual([]);
    expect(round.phaseTimeLeft).toBe(0); // clamp
  });
});

describe('SndRound: 設置(plant)', () => {
  function toLive(round: SndRound): void {
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
  }

  it('beginPlant は live フェーズ以外では無視される(buyでは進捗が動かない)', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.beginPlant();
    round.update(1);
    expect(round.plantProgress01).toBe(0);
  });

  it('beginPlant→SND_PLANT_HOLD_S 秒のホールドで設置完了し planted へ遷移する', () => {
    const round = new SndRound(PLAYER_TEAM);
    toLive(round);
    round.beginPlant();
    const events = tick(round, 0.1, Math.ceil(SND_PLANT_HOLD_S * 10) + 1);
    expect(round.phase).toBe('planted');
    expect(round.plantProgress01).toBe(0);
    expect(events).toContainEqual({ kind: 'planted' });
    expect(events).toContainEqual({ kind: 'phase', phase: 'planted' });
    expect(round.phaseTimeLeft).toBeLessThanOrEqual(SND_FUSE_S);
  });

  it('cancelPlant で進捗が0に戻り、やり直すと再度フルホールドが必要', () => {
    const round = new SndRound(PLAYER_TEAM);
    toLive(round);
    round.beginPlant();
    tick(round, 0.1, Math.floor((SND_PLANT_HOLD_S / 2) * 10));
    expect(round.plantProgress01).toBeGreaterThan(0);
    round.cancelPlant();
    expect(round.plantProgress01).toBe(0);
    expect(round.phase).toBe('live');
    // 再開: 半分では終わらない
    round.beginPlant();
    tick(round, 0.1, Math.floor((SND_PLANT_HOLD_S / 2) * 10));
    expect(round.phase).toBe('live');
  });

  it('onPlanted() を直接呼んでも live→planted へ遷移する', () => {
    const round = new SndRound(PLAYER_TEAM);
    toLive(round);
    round.onPlanted();
    expect(round.phase).toBe('planted');
    expect(round.phaseTimeLeft).toBeCloseTo(SND_FUSE_S);
  });

  it('onPlanted() は live 以外(buy)では無視される', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.onPlanted();
    expect(round.phase).toBe('buy');
  });
});

describe('SndRound: ヒューズ→detonate', () => {
  function toPlanted(round: SndRound): void {
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    round.onPlanted();
  }

  it('ヒューズが尽きると detonate で攻撃側勝利', () => {
    const round = new SndRound(PLAYER_TEAM);
    toPlanted(round);
    const events = tick(round, 0.5, Math.ceil((SND_FUSE_S + 1) * 2));
    expect(round.phase).toBe('roundEnd');
    expect(round.winner).toBe(PLAYER_TEAM);
    expect(events).toContainEqual({ kind: 'detonate' });
    expect(events).toContainEqual({ kind: 'round-win', winner: PLAYER_TEAM, reason: 'detonate' });
  });
});

describe('SndRound: 解除(defuse)', () => {
  function toPlanted(round: SndRound): void {
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    round.onPlanted();
  }

  it('beginDefuse は planted フェーズ以外では無視される', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.beginDefuse();
    round.update(1);
    expect(round.defuseProgress01).toBe(0);
  });

  it('beginDefuse→SND_DEFUSE_HOLD_S 秒のホールドで解除完了し守備側勝利', () => {
    const round = new SndRound(PLAYER_TEAM);
    toPlanted(round);
    round.beginDefuse();
    const events = tick(round, 0.1, Math.ceil(SND_DEFUSE_HOLD_S * 10) + 1);
    expect(round.phase).toBe('roundEnd');
    expect(round.winner).toBe(ENEMY_TEAM);
    expect(events).toContainEqual({ kind: 'defused' });
    expect(events).toContainEqual({ kind: 'round-win', winner: ENEMY_TEAM, reason: 'defuse' });
  });

  it('cancelDefuse で進捗が0に戻る', () => {
    const round = new SndRound(PLAYER_TEAM);
    toPlanted(round);
    round.beginDefuse();
    tick(round, 0.1, Math.floor((SND_DEFUSE_HOLD_S / 2) * 10));
    expect(round.defuseProgress01).toBeGreaterThan(0);
    round.cancelDefuse();
    expect(round.defuseProgress01).toBe(0);
    expect(round.phase).toBe('planted');
  });

  it('解除完了とヒューズ切れが同フレームで競合しても解除が優先される', () => {
    const round = new SndRound(PLAYER_TEAM);
    toPlanted(round);
    // フューズをほぼ使い切る直前まで小刻みに進める(解除はまだ開始しない)
    tick(round, 0.1, Math.floor((SND_FUSE_S - 0.05) * 10));
    expect(round.phase).toBe('planted');
    round.beginDefuse();
    // 残りフューズ・解除ホールドの双方を一気に超える大きな dt を1回だけ与える
    round.update(SND_FUSE_S);
    expect(round.phase).toBe('roundEnd');
    expect(round.winner).toBe(ENEMY_TEAM);
  });
});

describe('SndRound: resolveRound の明示呼び出し', () => {
  it("attackers-dead は live フェーズでは守備側勝利", () => {
    const round = new SndRound(PLAYER_TEAM);
    const winner = round.resolveRound('attackers-dead');
    expect(winner).toBe(ENEMY_TEAM);
    expect(round.phase).toBe('roundEnd');
  });

  it('attackers-dead は planted フェーズではラウンド継続(BO2仕様)', () => {
    const round = new SndRound(PLAYER_TEAM);
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    round.onPlanted();
    const winner = round.resolveRound('attackers-dead');
    expect(winner).toBeNull();
    expect(round.phase).toBe('planted');
    expect(round.isResolved).toBe(false);
  });

  it('defenders-dead は攻撃側勝利(フェーズを問わない)', () => {
    const live = new SndRound(PLAYER_TEAM);
    expect(live.resolveRound('defenders-dead')).toBe(PLAYER_TEAM);

    const planted = new SndRound(PLAYER_TEAM);
    tick(planted, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    planted.onPlanted();
    expect(planted.resolveRound('defenders-dead')).toBe(PLAYER_TEAM);
  });

  it('timeout の明示呼び出しは守備側勝利', () => {
    const round = new SndRound(ENEMY_TEAM);
    const winner = round.resolveRound('timeout');
    expect(winner).toBe(PLAYER_TEAM);
  });

  it('二重に resolveRound を呼んでも最初の結果を保持する(idempotent)', () => {
    const round = new SndRound(PLAYER_TEAM);
    const first = round.resolveRound('detonate');
    const second = round.resolveRound('timeout'); // 通常なら逆勝者になるはずの理由でも無視される
    expect(second).toBe(first);
    expect(round.winner).toBe(PLAYER_TEAM);
  });

  it('resolveRound で決着すると設置/解除の進行状態もリセットされる', () => {
    const round = new SndRound(PLAYER_TEAM);
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    round.beginPlant();
    tick(round, 0.1, Math.floor((SND_PLANT_HOLD_S / 2) * 10));
    round.resolveRound('defenders-dead');
    expect(round.plantProgress01).toBe(0);
    expect(round.isPlanting).toBe(false);
  });
});

describe('SndRound: ボムキャリア', () => {
  it('初期状態は carrierUid が null', () => {
    const round = new SndRound(PLAYER_TEAM);
    expect(round.carrierUid).toBeNull();
  });

  it('pickupBomb で carrierUid が設定される', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.pickupBomb(42);
    expect(round.carrierUid).toBe(42);
  });

  it('dropBomb で carrierUid が null に戻り、設置ホールド中なら中断される', () => {
    const round = new SndRound(PLAYER_TEAM);
    tick(round, 0.1, Math.ceil(SND_BUY_S * 10) + 1);
    round.pickupBomb(7);
    round.beginPlant();
    tick(round, 0.1, Math.floor((SND_PLANT_HOLD_S / 2) * 10));
    expect(round.plantProgress01).toBeGreaterThan(0);

    round.dropBomb();
    expect(round.carrierUid).toBeNull();
    expect(round.plantProgress01).toBe(0);
    expect(round.isPlanting).toBe(false);
  });
});

describe('SndRound: snapshot', () => {
  it('主要フィールドを反映する', () => {
    const round = new SndRound(PLAYER_TEAM);
    round.pickupBomb(3);
    const snap = round.snapshot();
    expect(snap.phase).toBe('buy');
    expect(snap.attackTeam).toBe(PLAYER_TEAM);
    expect(snap.carrierUid).toBe(3);
    expect(snap.winner).toBeNull();
  });
});

describe('SndSite / isWithinSndSite', () => {
  it('サイト中心から半径内は true', () => {
    const [siteA] = makeSndSites({ x: 0, z: 0 }, { x: 100, z: 100 }, 5);
    expect(isWithinSndSite(siteA, { x: 2, z: 2 })).toBe(true);
  });

  it('サイト半径外は false', () => {
    const [siteA] = makeSndSites({ x: 0, z: 0 }, { x: 100, z: 100 }, 5);
    expect(isWithinSndSite(siteA, { x: 20, z: 0 })).toBe(false);
  });

  it('makeSndSites は id A/B を持つ2サイトを返す', () => {
    const sites = makeSndSites({ x: 0, z: 0 }, { x: 50, z: 50 });
    expect(sites.map((s) => s.id)).toEqual(['A', 'B']);
  });
});

describe('SndMatch', () => {
  it('初期スコアは0-0、currentAttackTeamはconstructor引数', () => {
    const match = new SndMatch(ENEMY_TEAM);
    expect(match.scoreOf(PLAYER_TEAM)).toBe(0);
    expect(match.scoreOf(ENEMY_TEAM)).toBe(0);
    expect(match.currentAttackTeam).toBe(ENEMY_TEAM);
  });

  it('recordRound でスコアが加算される', () => {
    const match = new SndMatch(PLAYER_TEAM);
    match.recordRound(PLAYER_TEAM);
    expect(match.scoreOf(PLAYER_TEAM)).toBe(1);
    expect(match.roundsPlayed).toBe(1);
  });

  it(`先取${SND_ROUNDS_TO_WIN}で matchWinner が確定する`, () => {
    const match = new SndMatch(PLAYER_TEAM);
    for (let i = 0; i < SND_ROUNDS_TO_WIN - 1; i += 1) match.recordRound(PLAYER_TEAM);
    expect(match.matchWinner()).toBeNull();
    match.recordRound(PLAYER_TEAM);
    expect(match.matchWinner()).toBe(PLAYER_TEAM);
  });

  it(`${SND_SIDE_SWAP_EVERY}ラウンドごとに攻守交替する(スコアは維持される)`, () => {
    const match = new SndMatch(PLAYER_TEAM);
    // 2-2で決着させず、ちょうどSND_SIDE_SWAP_EVERYラウンド消化させる
    for (let i = 0; i < SND_SIDE_SWAP_EVERY; i += 1) {
      match.recordRound(i % 2 === 0 ? PLAYER_TEAM : ENEMY_TEAM);
    }
    expect(match.matchWinner()).toBeNull();
    expect(match.currentAttackTeam).toBe(ENEMY_TEAM); // PLAYER_TEAM から交替
    expect(match.scoreOf(PLAYER_TEAM)).toBe(Math.ceil(SND_SIDE_SWAP_EVERY / 2));
    expect(match.scoreOf(ENEMY_TEAM)).toBe(Math.floor(SND_SIDE_SWAP_EVERY / 2));
  });

  it('試合が決した後は recordRound を呼んでもスコア・交替が変化しない', () => {
    const match = new SndMatch(PLAYER_TEAM);
    for (let i = 0; i < SND_ROUNDS_TO_WIN; i += 1) match.recordRound(PLAYER_TEAM);
    expect(match.matchWinner()).toBe(PLAYER_TEAM);
    const attackBefore = match.currentAttackTeam;
    match.recordRound(ENEMY_TEAM);
    expect(match.scoreOf(ENEMY_TEAM)).toBe(0);
    expect(match.currentAttackTeam).toBe(attackBefore);
    expect(match.roundsPlayed).toBe(SND_ROUNDS_TO_WIN);
  });
});
