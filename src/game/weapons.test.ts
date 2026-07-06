import { describe, expect, it } from 'vitest';
import { BODY, HEAD, LIMB, partMultiplier } from './ballistics';
import {
  computeWeaponBars,
  PRIMARY_IDS,
  SECONDARY_IDS,
  Weapon,
  WEAPON_DEFS,
  type SoundProfile,
  type WeaponClass,
} from './weapons';
import { bowChargeMultiplier, fanPelletYaw, minigunNextRpm } from './match';

// 不変条件で参照するクラス/音プロファイルの全集合(型定義と同期)
const WEAPON_CLASSES: WeaponClass[] = [
  'ar',
  'smg',
  'sniper',
  'shotgun',
  'br',
  'lmg',
  'pistol',
  'marksman',
  'launcher',
];
const SOUND_PROFILES: SoundProfile[] = [
  'ar',
  'smg',
  'dmr',
  'shotgun',
  'lmg',
  'pistol',
  'br',
  'marksman',
];

const DEG = Math.PI / 180;
const CTX = { moveFactor: 0, airborne: false, crouched: false };

function makeWeapon(id: string): Weapon {
  const def = WEAPON_DEFS[id];
  if (!def) throw new Error(`unknown weapon: ${id}`);
  return new Weapon(def);
}

function settle(weapon: Weapon, ms: number): void {
  weapon.update(ms, { trigger: false, ads: false, reloadPressed: false }, CTX);
}

describe('Weapon 発射制御', () => {
  it('フルオートは発射間隔がRPMに従う', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000); // 構え完了
    const interval = 60000 / weapon.def.rpm;
    let fired = 0;
    // 10発分の時間+少しだけトリガーを引き続ける
    const steps = Math.ceil((interval * 9.5) / 5);
    for (let i = 0; i < steps; i += 1) {
      const events = weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(10);
  });

  it('単発はトリガーを引き直すまで次弾が出ない', () => {
    const weapon = makeWeapon('suzume');
    settle(weapon, 1000);
    let fired = 0;
    for (let i = 0; i < 100; i += 1) {
      const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(1);
    settle(weapon, 500);
    const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(events.some((e) => e.type === 'fired')).toBe(true);
  });

  it('構え直し中は撃てない', () => {
    const weapon = makeWeapon('kaede-ar');
    const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(events.some((e) => e.type === 'fired')).toBe(false);
  });

  it('マガジンが空になると自動で空リロードが始まる', () => {
    const weapon = makeWeapon('suzume');
    settle(weapon, 1000);
    let sawAutoReload = false;
    for (let i = 0; i < 12; i += 1) {
      // 単発なのでトリガーを離してから引き直す
      settle(weapon, 200);
      const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
      if (events.some((e) => e.type === 'reload-start' && e.kind === 'empty')) {
        sawAutoReload = true;
        break;
      }
    }
    expect(sawAutoReload).toBe(true);
    expect(weapon.reloading).toBe(true);
  });

  it('リロード完了で弾が戻る', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize - 1);
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    expect(weapon.reloading).toBe(true);
    settle(weapon, weapon.def.reloadTacticalMs + 50);
    expect(weapon.reloading).toBe(false);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize);
  });

  it('ADSはスプレッドを腰だめより狭める', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    const hip = weapon.currentSpreadRad(CTX);
    for (let i = 0; i < 100; i += 1) {
      weapon.update(10, { trigger: false, ads: true, reloadPressed: false }, CTX);
    }
    const ads = weapon.currentSpreadRad(CTX);
    expect(ads).toBeLessThan(hip);
    expect(weapon.adsProgress).toBe(1);
  });

  it('構え直しでADSとブルームを持ち越さない', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    for (let i = 0; i < 100; i += 1) {
      weapon.update(10, { trigger: true, ads: true, reloadPressed: false }, CTX);
    }
    expect(weapon.adsProgress).toBe(1);
    expect(weapon.bloomDeg).toBeGreaterThan(0);
    weapon.raise();
    expect(weapon.adsProgress).toBe(0);
    expect(weapon.bloomDeg).toBe(0);
    expect(weapon.recoil.stepIndex).toBe(0);
  });

  it('連射でブルームが乗り、時間経過で回復する', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    const before = weapon.currentSpreadRad(CTX);
    for (let i = 0; i < 60; i += 1) {
      weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    }
    const during = weapon.currentSpreadRad(CTX);
    expect(during).toBeGreaterThan(before);
    settle(weapon, 3000);
    expect(weapon.currentSpreadRad(CTX)).toBeCloseTo(before, 5);
  });

  it('バーストは1トリガーでburstCount発まとめて出る', () => {
    const weapon = makeWeapon('miyama-br');
    settle(weapon, 1000);
    let fired = 0;
    // 最初の1フレームだけトリガーを引き、あとは離して待つ
    for (let i = 0; i < 200; i += 1) {
      const events = weapon.update(5, { trigger: i === 0, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(weapon.def.burstCount);
  });
});

describe('武器定義の整合性', () => {
  it('全プライマリが定義表に存在しスロットが正しい', () => {
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id];
      expect(def).toBeDefined();
      expect(def!.slot).toBe('primary');
      expect(def!.id).toBe(id);
    }
  });

  it('複数ペレットはショットガンクラスだけが持つ', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.class === 'shotgun') {
        expect(def.pellets).toBeGreaterThanOrEqual(1);
      } else {
        expect(def.pellets).toBe(1);
      }
      // ペレットが複数なら固有拡散が必ず正
      if (def.pellets >= 2) expect(def.pelletSpreadDeg).toBeGreaterThan(0);
    }
  });

  it('貫通力は負にならない', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(def.penetrationM).toBeGreaterThanOrEqual(0);
    }
  });

  it('全武器が音プロファイルと拡散抑制/空中拡散を持つ', () => {
    const profiles = ['ar', 'smg', 'dmr', 'shotgun', 'lmg', 'pistol', 'br', 'marksman'];
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(profiles).toContain(def.soundProfile);
      expect(def.adsMoveSuppression).toBeGreaterThanOrEqual(0);
      expect(def.adsMoveSuppression).toBeLessThanOrEqual(1);
      expect(def.airSpreadDeg).toBeGreaterThanOrEqual(0);
    }
  });

  it('スコープ/エイムアシストはスナイパークラスだけが許される', () => {
    // 既存スナイパーは引き続き両方を持つ
    expect(WEAPON_DEFS['yamasemi-dmr']!.scope).toBe(true);
    expect(WEAPON_DEFS['yamasemi-dmr']!.aimAssist).toBe(true);
    for (const def of Object.values(WEAPON_DEFS)) {
      // scope:true / aimAssist:true は sniper クラスのみ(marksman は false)
      if (def.scope === true) expect(def.class).toBe('sniper');
      if (def.aimAssist === true) expect(def.class).toBe('sniper');
      if (def.class !== 'sniper') {
        expect(def.scope).not.toBe(true);
        expect(def.aimAssist).not.toBe(true);
      }
    }
  });

  it('DMRは胴・頭で一撃、脚だけ生存する', () => {
    const def = WEAPON_DEFS['yamasemi-dmr']!;
    expect(def.damage * partMultiplier(BODY, def.headshotMultiplier)).toBeGreaterThanOrEqual(100);
    expect(def.damage * partMultiplier(HEAD, def.headshotMultiplier)).toBeGreaterThanOrEqual(100);
    expect(def.damage * partMultiplier(LIMB, def.headshotMultiplier)).toBeLessThan(100);
  });

  it('DSRは表示名がDSRで、ボルトのリズム(低RPM)を持つ', () => {
    const def = WEAPON_DEFS['yamasemi-dmr']!;
    expect(def.id).toBe('yamasemi-dmr'); // 内部IDは不変
    expect(def.name).toBe('DSR');
    expect(def.rpm).toBeLessThanOrEqual(90); // ボルトアクション級の重い連射間隔
    expect(60000 / def.rpm).toBeGreaterThanOrEqual(600); // 1発あたり>=600ms
  });
});

describe('拡張ロスターの不変条件', () => {
  it('レコードのキーと def.id が一致する', () => {
    for (const [id, def] of Object.entries(WEAPON_DEFS)) {
      expect(def.id).toBe(id);
    }
  });

  it('プライマリ36本(銃35+素手)・セカンダリ6本である', () => {
    expect(PRIMARY_IDS.length).toBe(36);
    expect(PRIMARY_IDS).toContain('fists');
    expect(SECONDARY_IDS.length).toBe(6);
    // ID重複なし
    expect(new Set(PRIMARY_IDS).size).toBe(PRIMARY_IDS.length);
    expect(new Set(SECONDARY_IDS).size).toBe(SECONDARY_IDS.length);
  });

  it('PRIMARY/SECONDARYの全IDが定義表に存在しスロットが一致する', () => {
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id];
      expect(def, id).toBeDefined();
      expect(def!.slot).toBe('primary');
      expect(def!.id).toBe(id);
    }
    for (const id of SECONDARY_IDS) {
      const def = WEAPON_DEFS[id];
      expect(def, id).toBeDefined();
      expect(def!.slot).toBe('secondary');
      expect(def!.id).toBe(id);
    }
  });

  it('全プライマリ定義が PRIMARY_IDS に、全セカンダリが SECONDARY_IDS に含まれる', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.slot === 'primary') expect(PRIMARY_IDS).toContain(def.id);
      else expect(SECONDARY_IDS).toContain(def.id);
    }
  });

  it('class/soundProfile は型の全集合に含まれる', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(WEAPON_CLASSES, def.id).toContain(def.class);
      expect(SOUND_PROFILES, def.id).toContain(def.soundProfile);
    }
  });

  it('バースト武器は burstCount>=2、それ以外は 1', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.mode === 'burst') expect(def.burstCount, def.id).toBeGreaterThanOrEqual(2);
      else expect(def.burstCount, def.id).toBe(1);
    }
  });

  it('adsMoveSuppression は 0..1、falloff は start<end', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(def.adsMoveSuppression, def.id).toBeGreaterThanOrEqual(0);
      expect(def.adsMoveSuppression, def.id).toBeLessThanOrEqual(1);
      expect(def.falloff.start, def.id).toBeLessThan(def.falloff.end);
    }
  });

  it('computeWeaponBars は全6軸が 0..10 に収まる', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      const bars = computeWeaponBars(def);
      for (const v of Object.values(bars)) {
        expect(v, def.id).toBeGreaterThanOrEqual(0);
        expect(v, def.id).toBeLessThanOrEqual(10);
      }
    }
  });

  it('スナイパー/ランチャー以外は素ダメージ<100(ヘッドショット無しの胴即死を回避)', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      // sniper は胴/頭OSK設計。launcher は爆発物で直撃damage=220だがhitscanを使わない
      if (def.class === 'sniper' || def.class === 'launcher') continue;
      expect(def.damage, def.id).toBeLessThan(100);
    }
  });

  it('スナイパー/ショットガン/ランチャー以外は1射の合計ダメージ<100(胴即死禁止)', () => {
    // ショットガンは至近の全弾命中で即死=設計どおり。ランチャーは爆発物で直撃damage≥100
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.class === 'sniper' || def.class === 'shotgun' || def.class === 'launcher') continue;
      expect(def.damage * def.pellets, def.id).toBeLessThan(100);
    }
  });
});

describe('リロードキャンセル AddTime (BO7式)', () => {
  it('65%到達後のキャンセルでは弾倉が満タンになる', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000); // 構え完了
    // 1発撃って残弾を減らす
    settle(weapon, 200);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize - 1);
    // リロード開始
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    expect(weapon.reloading).toBe(true);
    // 66%(>65%)まで進める(tactical: 1700ms → 66% = 1122ms 経過 → remaining = 578ms)
    settle(weapon, weapon.def.reloadTacticalMs * 0.66);
    expect(weapon.reloading).toBe(true); // まだ完了していない
    // キャンセル(スプリント/ADS/武器切替/スライドを模倣)
    weapon.cancelReload();
    expect(weapon.reloading).toBe(false);
    // 弾が入っている
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize);
  });

  it('65%未満のキャンセルでは弾倉は変化しない', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    settle(weapon, 200);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    const roundsBefore = weapon.magazine.rounds; // magazineSize - 1
    // リロード開始 → 64%で止める
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(weapon, weapon.def.reloadTacticalMs * 0.64);
    weapon.cancelReload();
    // 弾倉は増えていない
    expect(weapon.magazine.rounds).toBe(roundsBefore);
  });

  it('リロード完了(100%)は従来どおり弾が入る', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(weapon, weapon.def.reloadTacticalMs + 50);
    expect(weapon.reloading).toBe(false);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize);
  });

  it('キャンセル後の次リロードも独立して65%ルールを適用する', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    // 1発撃って → 66%でキャンセル → 弾入り
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(weapon, weapon.def.reloadTacticalMs * 0.66);
    weapon.cancelReload();
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize); // 満タン

    // もう1発撃つ
    settle(weapon, 200);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    const roundsBefore = weapon.magazine.rounds;
    // 新リロード → 30%で止める(前回のフラグが引き継がれていないことを確認)
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(weapon, weapon.def.reloadTacticalMs * 0.30);
    weapon.cancelReload();
    expect(weapon.magazine.rounds).toBe(roundsBefore); // 増えていない
  });

  it('65%境界ジャスト付近の判定が正確(比較: reloadRatio >= 0.65)', () => {
    // 66%: 充填済み
    const w1 = makeWeapon('kaede-ar');
    settle(w1, 1000);
    settle(w1, 200);
    w1.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    w1.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(w1, w1.def.reloadTacticalMs * 0.66);
    w1.cancelReload();
    expect(w1.magazine.rounds).toBe(w1.def.magazineSize);

    // 64%: 未充填
    const w2 = makeWeapon('kaede-ar');
    settle(w2, 1000);
    settle(w2, 200);
    w2.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    const before = w2.magazine.rounds;
    w2.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    settle(w2, w2.def.reloadTacticalMs * 0.64);
    w2.cancelReload();
    expect(w2.magazine.rounds).toBe(before);
  });
});

describe('スコープ精度', () => {
  it('覗いて移動・空中でもDMRはほぼ無拡散、腰だめは大きく開く', () => {
    const weapon = new Weapon(WEAPON_DEFS['yamasemi-dmr']!);
    const ctx = { moveFactor: 1, airborne: true, crouched: false };
    weapon.adsProgress = 0; // 腰だめ
    expect(weapon.currentSpreadRad(ctx)).toBeGreaterThan(5 * DEG);
    weapon.adsProgress = 1; // 完全に覗いた状態
    expect(weapon.currentSpreadRad(ctx)).toBeLessThan(0.3 * DEG);
  });

  it('クイックスコープ: 85%覗けば完全ADSと同じ拡散になる', () => {
    const weapon = new Weapon(WEAPON_DEFS['yamasemi-dmr']!);
    const ctx = { moveFactor: 0.5, airborne: false, crouched: false };
    weapon.adsProgress = 0.85;
    const quick = weapon.currentSpreadRad(ctx);
    weapon.adsProgress = 1;
    const full = weapon.currentSpreadRad(ctx);
    expect(quick).toBeCloseTo(full, 6);
  });

  it('非スコープ武器はクイックスコープ・スナップを受けない', () => {
    const weapon = new Weapon(WEAPON_DEFS['kaede-ar']!);
    const ctx = { moveFactor: 0.5, airborne: false, crouched: false };
    weapon.adsProgress = 0.85;
    const partial = weapon.currentSpreadRad(ctx);
    weapon.adsProgress = 1;
    const full = weapon.currentSpreadRad(ctx);
    expect(partial).toBeGreaterThan(full); // 85%ではまだ完全ADSより拡散が大きい
  });
});

// ── R33 特殊武器 純粋関数テスト ─────────────────────────────────────────────

describe('bowChargeMultiplier', () => {
  it('チャージ0sで0.5倍', () => {
    expect(bowChargeMultiplier(0)).toBeCloseTo(0.5, 5);
  });

  it('チャージ1.2sで1.3倍', () => {
    expect(bowChargeMultiplier(1.2)).toBeCloseTo(1.3, 5);
  });

  it('0.6s(中間)で線形補間の中点 0.9倍', () => {
    expect(bowChargeMultiplier(0.6)).toBeCloseTo(0.9, 5);
  });

  it('チャージが負値でも0s相当にクランプ', () => {
    expect(bowChargeMultiplier(-1)).toBeCloseTo(0.5, 5);
  });

  it('チャージが最大超でも1.3倍にクランプ', () => {
    expect(bowChargeMultiplier(9)).toBeCloseTo(1.3, 5);
  });
});

describe('fanPelletYaw', () => {
  it('ペレット1個の場合は常に0', () => {
    expect(fanPelletYaw(0, 1, 0.419)).toBe(0);
  });

  it('7ペレット: i=0 は -halfSpanRad', () => {
    const half = 24 * (Math.PI / 180);
    expect(fanPelletYaw(0, 7, half)).toBeCloseTo(-half, 10);
  });

  it('7ペレット: i=6(最後)は +halfSpanRad', () => {
    const half = 24 * (Math.PI / 180);
    expect(fanPelletYaw(6, 7, half)).toBeCloseTo(half, 10);
  });

  it('7ペレット: i=3(中央)はほぼ0', () => {
    const half = 24 * (Math.PI / 180);
    expect(fanPelletYaw(3, 7, half)).toBeCloseTo(0, 10);
  });

  it('7ペレット: 各ヨウは等間隔', () => {
    const half = 24 * (Math.PI / 180);
    const yaws = Array.from({ length: 7 }, (_, i) => fanPelletYaw(i, 7, half));
    for (let i = 1; i < yaws.length; i += 1) {
      expect(yaws[i]! - yaws[i - 1]!).toBeCloseTo(yaws[1]! - yaws[0]!, 10);
    }
  });
});

describe('minigunNextRpm', () => {
  it('spinning=true: 400 rpm(最低アイドル)から 1.5s で 1800 rpm に達する', () => {
    let rpm = 400;
    rpm = minigunNextRpm(rpm, 0.75, true);
    rpm = minigunNextRpm(rpm, 0.75, true);
    expect(rpm).toBeCloseTo(1800, 1);
  });

  it('spinning=true: 1800 rpm を超えない', () => {
    expect(minigunNextRpm(1800, 0.1, true)).toBeCloseTo(1800, 5);
  });

  it('spinning=false: 1800 rpm から 0.5s で 0 rpm へ', () => {
    let rpm = 1800;
    rpm = minigunNextRpm(rpm, 0.25, false);
    rpm = minigunNextRpm(rpm, 0.25, false);
    expect(rpm).toBeCloseTo(0, 1);
  });

  it('spinning=false: 0 rpm を下回らない', () => {
    expect(minigunNextRpm(0, 0.1, false)).toBeCloseTo(0, 5);
  });

  it('中間状態(900 rpm)から spinning=true でさらに上昇', () => {
    const next = minigunNextRpm(900, 0.1, true);
    expect(next).toBeGreaterThan(900);
  });
});
