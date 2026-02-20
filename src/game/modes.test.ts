import { describe, expect, it } from 'vitest';
import { DominationState, ScoreBoard, Zone } from './modes';

function counts(entries: Array<[number, number]>): Map<number, number> {
  return new Map(entries);
}

function advance(zone: Zone, dt: number, c: Map<number, number>, steps: number): string[] {
  const events: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const event = zone.update(dt, c);
    if (event) events.push(event);
  }
  return events;
}

describe('Zone', () => {
  it('単独チームが居続けると制圧できる', () => {
    const zone = new Zone('A');
    zone.capturingTeam = 0;
    const events = advance(zone, 0.1, counts([[0, 1]]), 40);
    expect(events).toContain('captured');
    expect(zone.owner).toBe(0);
  });

  it('人数が多いほど早く制圧が進む(上限つき)', () => {
    const solo = new Zone('A');
    solo.capturingTeam = 0;
    solo.update(0.5, counts([[0, 1]]));
    const trio = new Zone('B');
    trio.capturingTeam = 0;
    trio.update(0.5, counts([[0, 3]]));
    const five = new Zone('C');
    five.capturingTeam = 0;
    five.update(0.5, counts([[0, 5]]));
    expect(trio.progress).toBeGreaterThan(solo.progress);
    expect(five.progress).toBeCloseTo(trio.progress);
  });

  it('両チームが居ると拮抗して進まない', () => {
    const zone = new Zone('A');
    zone.capturingTeam = 0;
    advance(zone, 0.1, counts([[0, 1]]), 10);
    const before = zone.progress;
    zone.update(
      0.5,
      counts([
        [0, 1],
        [1, 1],
      ]),
    );
    expect(zone.contested).toBe(true);
    expect(zone.progress).toBeLessThanOrEqual(before);
  });

  it('所有拠点は敵の進捗1でまず中立化され、居続ければ奪取される', () => {
    const zone = new Zone('A');
    zone.owner = 0;
    zone.capturingTeam = 1;
    const c = counts([[1, 2]]);
    let neutralizedAt = -1;
    for (let i = 0; i < 60; i += 1) {
      const event = zone.update(0.1, c);
      if (event === 'neutralized') {
        neutralizedAt = i;
        expect(zone.owner).toBeNull();
      }
      if (event === 'captured') {
        // 中立化を経てから奪取される
        expect(neutralizedAt).toBeGreaterThanOrEqual(0);
        expect(zone.owner).toBe(1);
        return;
      }
    }
    throw new Error('60回の更新で奪取まで到達しなかった');
  });

  it('所有チームが戻ると敵の進捗を消す', () => {
    const zone = new Zone('A');
    zone.owner = 0;
    zone.capturingTeam = 1;
    advance(zone, 0.1, counts([[1, 1]]), 10);
    expect(zone.progress).toBeGreaterThan(0);
    advance(zone, 0.1, counts([[0, 1]]), 30);
    expect(zone.progress).toBe(0);
    expect(zone.owner).toBe(0);
  });
});

describe('DominationState', () => {
  it('所有拠点の数だけ毎秒ポイントが入る', () => {
    const dom = new DominationState(['A', 'B', 'C']);
    dom.zones[0]!.owner = 0;
    dom.zones[1]!.owner = 0;
    dom.zones[2]!.owner = 1;
    const empty = new Map<string, Map<number, number>>();
    let team0 = 0;
    let team1 = 0;
    // dtは2進数で正確に表せる値にして、5.0秒ちょうどを刻む
    for (let i = 0; i < 20; i += 1) {
      const points = dom.update(0.25, empty);
      team0 += points.get(0) ?? 0;
      team1 += points.get(1) ?? 0;
    }
    // 5秒で 2拠点x5 と 1拠点x5
    expect(team0).toBe(10);
    expect(team1).toBe(5);
  });

  it('制圧イベントがコールバックに届く', () => {
    const dom = new DominationState(['A']);
    dom.zones[0]!.capturingTeam = 1;
    const presence = new Map([['A', counts([[1, 3]])]]);
    const seen: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      dom.update(0.1, presence, (zone, event) => seen.push(`${zone.id}:${event}`));
    }
    expect(seen).toContain('A:captured');
  });
});

describe('ScoreBoard', () => {
  it('先取スコアで勝者が決まる', () => {
    const board = new ScoreBoard(5);
    board.add(0, 4);
    expect(board.winner()).toBeNull();
    board.add(0, 1);
    expect(board.winner()).toBe(0);
  });

  it('同点のリーダーはnull', () => {
    const board = new ScoreBoard(100);
    board.add(0, 3);
    board.add(1, 3);
    expect(board.leader()).toBeNull();
    board.add(1, 1);
    expect(board.leader()).toBe(1);
  });
});
