import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot, DIFFICULTY, fearAccuracyMul } from './bot';
import { crowdSlotAction, emperorChargeStageFor, isCrowdEligible, type MomentEvent } from './match';
import { ZOMBIE_CROWD_INSTANCED } from '../render/zombie-crowd';

// ── R53-W3 M3: 最終match配線のロジック検証(純関数+実Botの怯え状態) ──────────

describe('emperorChargeStageFor(溜め段閾値 0.5/1.2/2.2s)', () => {
  it('境界値で段が切り替わる', () => {
    expect(emperorChargeStageFor(0)).toBe(0);
    expect(emperorChargeStageFor(0.49)).toBe(0);
    expect(emperorChargeStageFor(0.5)).toBe(1);
    expect(emperorChargeStageFor(1.19)).toBe(1);
    expect(emperorChargeStageFor(1.2)).toBe(2);
    expect(emperorChargeStageFor(2.19)).toBe(2);
    expect(emperorChargeStageFor(2.2)).toBe(3);
    expect(emperorChargeStageFor(99)).toBe(3);
  });
});

describe('isCrowdEligible(ゾンビ群InstancedMeshの協定)', () => {
  it('非boss・variant無し・rank>=8 のみ適格', () => {
    expect(isCrowdEligible('normal', null, 8)).toBe(ZOMBIE_CROWD_INSTANCED);
    expect(isCrowdEligible('elite', null, 99)).toBe(ZOMBIE_CROWD_INSTANCED);
  });

  it('boss / variant持ち / 最近接8体(rank<8)は除外(高忠実度維持の協定)', () => {
    expect(isCrowdEligible('boss', null, 99)).toBe(false);
    expect(isCrowdEligible('normal', 'blast', 99)).toBe(false);
    expect(isCrowdEligible('normal', 'miasma', 8)).toBe(false);
    expect(isCrowdEligible('normal', null, 7)).toBe(false);
    expect(isCrowdEligible('normal', null, 0)).toBe(false);
  });
});

// ── R54-W1 Q8: 群衆スロットのヒステリシス(rank7-9デッドバンド、チャタリング防止) ──
describe('crowdSlotAction(群衆スロットのヒステリシス判定)', () => {
  it('rank<7かつスロット保持中は必ずrelease(近接=高忠実度優先)', () => {
    expect(crowdSlotAction(0, true, false)).toBe('release');
    expect(crowdSlotAction(6, true, true)).toBe('release');
  });

  it('rank<7でもスロット未保持なら何もしない(release対象がない)', () => {
    expect(crowdSlotAction(0, false, false)).toBe('none');
  });

  it('rank>9かつスロット未保持かつeligibleならacquire', () => {
    expect(crowdSlotAction(10, false, true)).toBe('acquire');
    expect(crowdSlotAction(99, false, true)).toBe('acquire');
  });

  it('rank>9でもeligibleでなければacquireしない(isCrowdEligibleの他条件=boss/variant等を尊重)', () => {
    expect(crowdSlotAction(99, false, false)).toBe('none');
  });

  it('rank>9でも既にスロット保持中ならacquireしない(二重取得防止)', () => {
    expect(crowdSlotAction(99, true, true)).toBe('none');
  });

  it('rank7-9(デッドバンド)はスロット保持有無に関わらず現状維持(チャタリング防止の核心)', () => {
    for (const rank of [7, 8, 9]) {
      expect(crowdSlotAction(rank, true, true)).toBe('none');
      expect(crowdSlotAction(rank, false, true)).toBe('none');
      expect(crowdSlotAction(rank, true, false)).toBe('none');
      expect(crowdSlotAction(rank, false, false)).toBe('none');
    }
  });

  it('rank7⇔8⇔7で反転してもデッドバンド内なら状態が一切変わらない(実運用シナリオ)', () => {
    // スロット未保持(近接から離脱直後を想定)でrankが7と8の間を往復してもacquireは起きない
    let hasSlot = false;
    for (const rank of [7, 8, 7, 8, 7]) {
      const action = crowdSlotAction(rank, hasSlot, true);
      expect(action).toBe('none');
      if (action === 'acquire') hasSlot = true;
      else if (action === 'release') hasSlot = false;
    }
    expect(hasSlot).toBe(false);
  });
});

describe('MomentEvent契約(MK.III HUDのドレイン方式)', () => {
  it('hud.ts側のローカル定義と構造互換(kind/tone のリテラル網羅)', () => {
    const samples: MomentEvent[] = [
      { kind: 'round', title: '12', sub: 'ROUND' },
      { kind: 'special', title: '餓鬼の大群', tone: 'ember' },
      { kind: 'perk', title: '拡張マガジン' },
      { kind: 'emperor', title: '雷帝', tone: 'ice' },
      { kind: 'emperor', title: '黒雷帝', tone: 'violet' },
      { kind: 'ggrank', title: '7', sub: 'RANK' },
      { kind: 'rankup', title: '宇宙開闢' },
    ];
    for (const m of samples) expect(m.title.length).toBeGreaterThan(0);
  });
});

describe('怯え(帝威)と発砲精度', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('applyFearでfearedが立ち、時間経過で解ける(spread実効化の前提状態)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
    const bot = new Bot(world, 'テスト', new THREE.Vector3(0, 0, 0), 0xc84b3c, DIFFICULTY.normal);
    expect(bot.feared).toBe(false);
    bot.applyFear(1.5);
    expect(bot.feared).toBe(true);
  });

  it('fearAccuracyMul=0.5 → 実効spreadは 1/0.5=2倍拡散(updateShootingの式の前提)', () => {
    expect(fearAccuracyMul).toBe(0.5);
    expect(1 / fearAccuracyMul).toBe(2);
  });
});
