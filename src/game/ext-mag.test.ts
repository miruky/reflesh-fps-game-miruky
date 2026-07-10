// ゾンビパーク「拡張マガジン」(ext-mag)のテスト。
// match.ts の Match クラス自体は THREE/Rapier のフル世界を要求するため直接ユニットテストしない
// (このリポジトリの既存方針。match.test.ts は存在せず、代わりに match.ts が export する
// 純関数/定数と、weapons.ts/zombie-economy.ts の純ロジックを組み合わせて検証する)。
//
// R53-W2以降: match.ts の applyZombiePerk('ext-mag'/'double-tap'/'speed-cola', ...) と
// switchPrimaryWeapon() は「現在値への直接変異」を撤去し、composeZombieWeaponDef() 一本化へ
// 移行した(recomposeWeapon/recomposeAllWeapons、常にWEAPON_DEFSの基礎値から再計算)。
// ここでは match.ts が実際に行っている新手順(applyAttachments でクローン →
// composeZombieWeaponDef でPaP/パーク合成 → new Weapon() で Magazine を再構築、または
// 既存WeaponのdefフィールドをcomposeZombieWeaponDefの出力へコピー)を再現し、
// ext-mag単体の数値がcompose移行の前後で不変であることを回帰確認する
// (詳細な網羅テストは zombie-compose-wiring.test.ts 参照)。
import { describe, expect, it } from 'vitest';
import { EXT_MAG_EXCLUDED_IDS } from './match';
import { applyExtMagCapacity, composeZombieWeaponDef, PERKS } from './zombie-economy';
import { applyAttachments } from './attachments';
import { WEAPON_DEFS, Weapon } from './weapons';

describe('拡張マガジン(ext-mag)パーク', () => {
  it('PERKS定義: id=ext-mag, 価格1000, +50%/スタック', () => {
    const p = PERKS['ext-mag'];
    expect(p.id).toBe('ext-mag');
    expect(p.name).toBe('拡張マガジン');
    expect(p.price).toBe(1000);
    expect(p.effect.magCapacityBonusPerStack).toBe(0.5);
  });

  // ─── (a) 容量が基礎×1.5/×2.0/×2.5と線形にスタックする ──────────────────────

  it('装備中の武器(kaede-ar, 基礎30発)は1/2/3スタックで45/60/75発になる', () => {
    const base = WEAPON_DEFS['kaede-ar']!.magazineSize;
    expect(base).toBe(30);
    expect(applyExtMagCapacity(base, 1)).toBe(45);
    expect(applyExtMagCapacity(base, 2)).toBe(60);
    expect(applyExtMagCapacity(base, 3)).toBe(75);
  });

  // ─── (b) 共有WEAPON_DEFSが変異していない ───────────────────────────────────

  it('R53-W2: match.tsの新手順(applyAttachmentsクローン→composeZombieWeaponDef→def書換)は共有WEAPON_DEFSを変異させない', () => {
    const before = JSON.stringify(WEAPON_DEFS['kaede-ar']);

    // recomposeWeapon(w) が装備中武器へ行う手順の再現(papTier=0/ext-magのみ3スタック)
    const cloned = applyAttachments(WEAPON_DEFS['kaede-ar']!, []); // switchPrimaryWeaponと同じ空attachments
    const weapon = new Weapon(cloned);
    const composed = composeZombieWeaponDef(WEAPON_DEFS['kaede-ar']!, {
      papTier: 0,
      extMagStacks: 3,
      doubleTapStacks: 0,
      speedColaStacks: 0,
    });
    weapon.def.magazineSize = composed.magazineSize;
    weapon.magazine.setCapacity(composed.magazineSize, true);

    expect(weapon.magazine.capacity).toBe(75); // ext-mag単体の数値はcompose移行前後で不変(回帰確認)
    expect(JSON.stringify(WEAPON_DEFS['kaede-ar'])).toBe(before); // 共有defは無傷
    expect(WEAPON_DEFS['kaede-ar']!.magazineSize).toBe(30); // 個別フィールドでも確認
  });

  it('複数武器へ繰り返し適用しても共有WEAPON_DEFSは常に無傷', () => {
    const ids = ['tsubaki-smg', 'yamasemi-dmr', 'miyama-br', 'kumagera-lmg'] as const;
    const beforeSnapshots = Object.fromEntries(ids.map((id) => [id, JSON.stringify(WEAPON_DEFS[id])]));
    for (const id of ids) {
      const cloned = applyAttachments(WEAPON_DEFS[id]!, []);
      const composed = composeZombieWeaponDef(WEAPON_DEFS[id]!, {
        papTier: 0,
        extMagStacks: 2,
        doubleTapStacks: 0,
        speedColaStacks: 0,
      });
      cloned.magazineSize = composed.magazineSize;
      new Weapon(cloned); // 生成のみ(戻り値未使用でも副作用が無いことを確認する目的)
    }
    for (const id of ids) {
      expect(JSON.stringify(WEAPON_DEFS[id])).toBe(beforeSnapshots[id]);
    }
  });

  // ─── (c) 購入後に新規購入した武器にも適用される ────────────────────────────

  it('switchPrimaryWeapon相当: 既に2スタック所持の状態で新規武器(wall-buy/mystery-box)を取得すると容量倍加が適用される(compose経由でも同じ数値)', () => {
    const extMagStacks = 2; // 既存の zombiePerkStacks.get('ext-mag')
    for (const id of ['ginyanma-ar', 'hiiragi-sg', 'raicho-sniper']) {
      const baseDef = WEAPON_DEFS[id];
      if (!baseDef) continue; // ミステリーボックスプールに存在しない武器はスキップ
      const cloned = applyAttachments(baseDef, []);
      // switchPrimaryWeapon() と同じ手順: composeZombieWeaponDef(papTier=0固定、壁/箱は常に新品)
      const composed = composeZombieWeaponDef(cloned, {
        papTier: 0,
        extMagStacks,
        doubleTapStacks: 0,
        speedColaStacks: 0,
      });
      const weapon = new Weapon(composed);
      expect(weapon.magazine.capacity).toBe(Math.ceil(baseDef.magazineSize * 2.0));
      expect(weapon.magazine.rounds).toBe(weapon.magazine.capacity); // 新規取得時は満タン
    }
  });

  it('未購入(スタック0)なら新規武器は基礎容量のまま(compose経由)', () => {
    const baseDef = WEAPON_DEFS['kaede-ar']!;
    const cloned = applyAttachments(baseDef, []);
    const composed = composeZombieWeaponDef(cloned, {
      papTier: 0,
      extMagStacks: 0,
      doubleTapStacks: 0,
      speedColaStacks: 0,
    });
    const weapon = new Weapon(composed);
    expect(weapon.magazine.capacity).toBe(30);
  });

  // ─── (d) 除外武器が除外される ───────────────────────────────────────────────

  it('EXT_MAG_EXCLUDED_IDS は fists(クナイ)を含む', () => {
    expect(EXT_MAG_EXCLUDED_IDS.has('fists')).toBe(true);
  });

  it('EXT_MAG_EXCLUDED_IDS は通常武器・特殊兵装を含まない(容量変更で壊れないため対象内)', () => {
    const shouldNotBeExcluded = [
      'kaede-ar', 'tsubaki-smg', 'yamasemi-dmr', 'hiiragi-sg', 'miyama-br', 'kumagera-lmg',
      'gouka-rl',      // ロケットランチャー: 通常マガジン経路、増加は素直な弾数バフ
      'shura-lmg',     // ミニガン: refundRoundはcapacityを動的に読むため増加後も壊れない
      'gekkou-bow',    // 弓: チャージは magazine 消費と独立
      'tenrai-staff',  // 天雷杖: チャージは magazine 消費と独立
      'shinkirou-sniper', // ビーム貫通スナイパー: 通常マガジン経路
      'fujin-fan',     // 鉄扇: magazineSize=999(実質無限)だが増加は無害
      'gouen-musket',  // 火縄銃: magazineSize=1だが増加は素直なバフ
    ];
    for (const id of shouldNotBeExcluded) {
      expect(EXT_MAG_EXCLUDED_IDS.has(id)).toBe(false);
    }
  });

  it('fists は装備中でもパーク自体は他武器に適用され続ける(除外は武器単位、recomposeWeaponのガードで再現)', () => {
    // recomposeAllWeapons のループ相当: fistsのみEXT_MAG_EXCLUDED_IDSガードでスキップし、他武器は処理される
    const primary = applyAttachments(WEAPON_DEFS['kaede-ar']!, []);
    const secondary = applyAttachments(WEAPON_DEFS['fists']!, []);
    const weapons = [new Weapon(primary), new Weapon(secondary)];
    const opts = { papTier: 0 as const, extMagStacks: 1, doubleTapStacks: 0, speedColaStacks: 0 };
    for (const w of weapons) {
      if (EXT_MAG_EXCLUDED_IDS.has(w.def.id)) continue;
      const composed = composeZombieWeaponDef(WEAPON_DEFS[w.def.id]!, opts);
      w.def.magazineSize = composed.magazineSize;
      w.magazine.setCapacity(composed.magazineSize, true);
    }
    expect(weapons[0]!.magazine.capacity).toBe(45); // kaede-ar: 30→45
    expect(weapons[1]!.magazine.capacity).toBe(999); // fists: 変化なし
  });

  it('ミニガン(shura-lmg)は容量が増えても magazine.capacity 基準のrefundロジックと矛盾しない(compose経由)', () => {
    const cloned = applyAttachments(WEAPON_DEFS['shura-lmg']!, []);
    const composed = composeZombieWeaponDef(WEAPON_DEFS['shura-lmg']!, {
      papTier: 0,
      extMagStacks: 1, // 150 → 225
      doubleTapStacks: 0,
      speedColaStacks: 0,
    });
    cloned.magazineSize = composed.magazineSize;
    const weapon = new Weapon(cloned);
    weapon.magazine.setCapacity(composed.magazineSize, true);
    weapon.magazine.rounds = 10;
    // match.ts の refundRound(rounds, capacity) と同じ規約: capacityを超えて加算しない
    const refunded = Math.min(weapon.magazine.capacity, weapon.magazine.rounds + 1);
    expect(refunded).toBe(11);
    expect(weapon.magazine.capacity).toBe(225);
  });
});
