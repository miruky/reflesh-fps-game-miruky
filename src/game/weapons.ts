import type { Falloff } from './ballistics';
import { Magazine } from './magazine';
import { RecoilTracker, type RecoilStep } from './recoil';

export type FireMode = 'auto' | 'semi' | 'burst';
export type WeaponSlot = 'primary' | 'secondary';
// 発砲音の合成プロファイル。audio.tsのSHOT_PROFILESと対応する
export type SoundProfile = 'ar' | 'smg' | 'dmr' | 'shotgun' | 'lmg' | 'pistol' | 'br';
// 武器カテゴリ。メダル判定(LONGSHOT閾値・距離系)とエイムアシストの分岐に使う
export type WeaponClass = 'ar' | 'smg' | 'sniper' | 'shotgun' | 'br' | 'lmg' | 'pistol';

export interface WeaponDef {
  id: string;
  name: string;
  slot: WeaponSlot;
  damage: number;
  headshotMultiplier: number;
  rpm: number;
  magazineSize: number;
  reloadTacticalMs: number;
  reloadEmptyMs: number;
  spreadHipDeg: number;
  spreadAdsDeg: number;
  bloomPerShotDeg: number;
  bloomMaxDeg: number;
  bloomRecoveryDegPerS: number;
  movementSpreadDeg: number;
  falloff: Falloff;
  mode: FireMode;
  burstCount: number;
  adsFovScale: number;
  adsTimeMs: number;
  switchMs: number;
  recoilPattern: RecoilStep[];
  recoilRecoveryPerS: number;
  range: number;
  tracerColor: number;
  // 1発で飛ぶ弾の数。ショットガンは複数
  pellets: number;
  // ペレット同士の固有拡散。照準精度とは別にかかる
  pelletSpreadDeg: number;
  // 貫通できる壁の最大厚(m)。0は貫通不可
  penetrationM: number;
  // サプレッサー装着時にtrue。発砲音とBOTへの警戒範囲が変わる
  suppressed?: boolean;
  // applyAttachmentsが適用済みIDを記録する
  attachmentIds?: string[];
  // スナイパー用フルスクリーンスコープを出す武器(ヤマセミDMRのみ)
  scope?: boolean;
  // エイムアシストの対象武器(スコープ覗き込み時に微吸着)
  aimAssist?: boolean;
  // 発砲音の合成プロファイル
  soundProfile: SoundProfile;
  // 武器カテゴリ(メダル/エイムアシスト用)
  class: WeaponClass;
  // ADS時に動的拡散(ブルーム/移動/空中)を打ち消す割合(0..1)。
  // スナイパーは高くして覗けばほぼ無拡散、自動火器は低めに留める
  adsMoveSuppression: number;
  // 空中での追加拡散(度)。従来の一律+2.5を武器別に置き換える
  airSpreadDeg: number;
}

const DEG = Math.PI / 180;

// 立ち上がりは縦に跳ね、弾倉後半で横へ流れるパターン
function risingPattern(steps: number, pitchDeg: number, driftDeg: number): RecoilStep[] {
  const pattern: RecoilStep[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    pattern.push({
      pitch: pitchDeg * DEG * (1 - t * 0.45),
      yaw: driftDeg * DEG * t,
    });
  }
  return pattern;
}

export const WEAPON_DEFS: Record<string, WeaponDef> = {
  'kaede-ar': {
    id: 'kaede-ar',
    name: 'カエデAR',
    slot: 'primary',
    damage: 26,
    headshotMultiplier: 1.6,
    rpm: 700,
    magazineSize: 30,
    reloadTacticalMs: 1700,
    reloadEmptyMs: 2300,
    spreadHipDeg: 2.2,
    spreadAdsDeg: 0.25,
    bloomPerShotDeg: 0.16,
    bloomMaxDeg: 1.3,
    bloomRecoveryDegPerS: 1.4,
    movementSpreadDeg: 0.9,
    falloff: { start: 22, end: 48, minFactor: 0.65 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.72,
    adsTimeMs: 220,
    switchMs: 450,
    recoilPattern: risingPattern(10, 0.34, 0.08),
    recoilRecoveryPerS: 6,
    range: 220,
    tracerColor: 0xffc46b,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.35,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
  },
  'tsubaki-smg': {
    id: 'tsubaki-smg',
    name: 'ツバキSMG',
    slot: 'primary',
    damage: 19,
    headshotMultiplier: 1.4,
    rpm: 900,
    magazineSize: 35,
    reloadTacticalMs: 1500,
    reloadEmptyMs: 2000,
    spreadHipDeg: 2.6,
    spreadAdsDeg: 0.55,
    bloomPerShotDeg: 0.14,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.6,
    falloff: { start: 12, end: 30, minFactor: 0.55 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.8,
    adsTimeMs: 160,
    switchMs: 350,
    recoilPattern: risingPattern(8, 0.26, -0.12),
    recoilRecoveryPerS: 7,
    range: 160,
    tracerColor: 0xff8d6b,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.15,
    soundProfile: 'smg',
    class: 'smg',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 1.6,
  },
  'yamasemi-dmr': {
    id: 'yamasemi-dmr',
    name: 'DSR',
    slot: 'primary',
    // DSR系の一撃: 胴・頭はOSK、脚だけ生存。falloffは全域でOSKを維持
    damage: 110,
    headshotMultiplier: 1.9, // 頭=209、脚(0.8)=88で非キル
    rpm: 75, // BO2 DSR-50のボルト操作リズム(=800msサイクル)。重い一撃感
    magazineSize: 7, // BO2 DSR-50(拡張)準拠。リザーブ∞+自動リロードなので過酷にならない
    reloadTacticalMs: 1900,
    reloadEmptyMs: 2600,
    spreadHipDeg: 3.6, // 腰だめは悪いまま(noscopeは運ゲー=クイックスコープの価値を際立たせる)
    spreadAdsDeg: 0.02, // 覗けばピンポイント
    bloomPerShotDeg: 0.12,
    bloomMaxDeg: 0.6,
    bloomRecoveryDegPerS: 2.5,
    movementSpreadDeg: 0.8,
    falloff: { start: 80, end: 140, minFactor: 0.92 }, // 胴は全域>=101
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.32, // 約3.1倍ズーム
    adsTimeMs: 380, // BO2の重い覗き込み(実測400ms級)へ。0.85スナップで約323ms=QSスイートスポット
    switchMs: 550,
    // 実反動は小さく保つ: fireShotは反動加算後のplayer.pitchで弾道を出すため、ここを
    // 大きくすると初弾がクロスヘアから上振れする。重い一撃の手応えはviewModelキック・
    // 画面シェイク(0.12)・ボルト音の演出層で出す。
    recoilPattern: risingPattern(4, 0.5, 0.08),
    recoilRecoveryPerS: 7, // やや遅い収束で重量感(視覚のキック側に効く)
    range: 300,
    tracerColor: 0x9bd1ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.6,
    scope: true,
    aimAssist: true,
    soundProfile: 'dmr',
    class: 'sniper',
    adsMoveSuppression: 0.95,
    airSpreadDeg: 2.2,
  },
  'hiiragi-sg': {
    id: 'hiiragi-sg',
    name: 'ヒイラギSG',
    slot: 'primary',
    damage: 11,
    headshotMultiplier: 1.3,
    rpm: 75,
    magazineSize: 6,
    reloadTacticalMs: 2400,
    reloadEmptyMs: 2900,
    spreadHipDeg: 1.6,
    spreadAdsDeg: 0.8,
    bloomPerShotDeg: 0.5,
    bloomMaxDeg: 2.0,
    bloomRecoveryDegPerS: 1.8,
    movementSpreadDeg: 0.7,
    falloff: { start: 7, end: 20, minFactor: 0.25 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.82,
    adsTimeMs: 240,
    switchMs: 500,
    recoilPattern: risingPattern(3, 1.6, 0.1),
    recoilRecoveryPerS: 4,
    range: 60,
    tracerColor: 0xffe08a,
    pellets: 8,
    pelletSpreadDeg: 2.6,
    penetrationM: 0,
    soundProfile: 'shotgun',
    class: 'shotgun',
    adsMoveSuppression: 0.25,
    airSpreadDeg: 2.0,
  },
  'miyama-br': {
    id: 'miyama-br',
    name: 'ミヤマBR',
    slot: 'primary',
    damage: 31,
    headshotMultiplier: 1.7,
    rpm: 650,
    magazineSize: 24,
    reloadTacticalMs: 1800,
    reloadEmptyMs: 2400,
    spreadHipDeg: 2.8,
    spreadAdsDeg: 0.15,
    bloomPerShotDeg: 0.2,
    bloomMaxDeg: 1.2,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 1.1,
    falloff: { start: 28, end: 60, minFactor: 0.7 },
    mode: 'burst',
    burstCount: 3,
    adsFovScale: 0.65,
    adsTimeMs: 260,
    switchMs: 500,
    recoilPattern: risingPattern(6, 0.5, 0.1),
    recoilRecoveryPerS: 5.5,
    range: 260,
    tracerColor: 0xb8ffd1,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.4,
    soundProfile: 'br',
    class: 'br',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 2.0,
  },
  'kumagera-lmg': {
    id: 'kumagera-lmg',
    name: 'クマゲラLMG',
    slot: 'primary',
    damage: 24,
    headshotMultiplier: 1.5,
    rpm: 600,
    magazineSize: 75,
    reloadTacticalMs: 3600,
    reloadEmptyMs: 4300,
    spreadHipDeg: 3.4,
    spreadAdsDeg: 0.5,
    bloomPerShotDeg: 0.1,
    bloomMaxDeg: 1.4,
    bloomRecoveryDegPerS: 1.2,
    movementSpreadDeg: 1.8,
    falloff: { start: 26, end: 58, minFactor: 0.7 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.7,
    adsTimeMs: 340,
    switchMs: 700,
    recoilPattern: risingPattern(14, 0.4, -0.14),
    recoilRecoveryPerS: 5,
    range: 240,
    tracerColor: 0xffa3e0,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.8,
    soundProfile: 'lmg',
    class: 'lmg',
    adsMoveSuppression: 0.2,
    airSpreadDeg: 3.0,
  },
  suzume: {
    id: 'suzume',
    name: 'スズメ',
    slot: 'secondary',
    damage: 30,
    headshotMultiplier: 1.7,
    rpm: 380,
    magazineSize: 12,
    reloadTacticalMs: 1300,
    reloadEmptyMs: 1800,
    spreadHipDeg: 2.4,
    spreadAdsDeg: 0.45,
    bloomPerShotDeg: 0.22,
    bloomMaxDeg: 1.5,
    bloomRecoveryDegPerS: 1.1,
    movementSpreadDeg: 0.8,
    falloff: { start: 15, end: 35, minFactor: 0.6 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.85,
    adsTimeMs: 140,
    switchMs: 250,
    recoilPattern: risingPattern(4, 0.55, 0.0),
    recoilRecoveryPerS: 7,
    range: 140,
    tracerColor: 0xfff0a8,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.1,
    soundProfile: 'pistol',
    class: 'pistol',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 1.8,
  },
};

export const PRIMARY_IDS = [
  'kaede-ar',
  'tsubaki-smg',
  'yamasemi-dmr',
  'hiiragi-sg',
  'miyama-br',
  'kumagera-lmg',
] as const;

export interface WeaponInput {
  trigger: boolean;
  ads: boolean;
  reloadPressed: boolean;
}

export type WeaponEvent =
  | { type: 'fired'; spreadRad: number; recoil: RecoilStep }
  | { type: 'dryfire' }
  | { type: 'reload-start'; kind: 'tactical' | 'empty'; durationMs: number }
  | { type: 'reload-finish' };

export interface SpreadContext {
  moveFactor: number; // 0(静止)..1(全力移動)
  airborne: boolean;
  crouched: boolean;
  sliding?: boolean; // スライド中は移動拡散を半減
  wallRunning?: boolean; // ウォールラン中は移動拡散をやや軽減
}

export class Weapon {
  readonly magazine: Magazine;
  readonly recoil: RecoilTracker;
  adsProgress = 0;
  bloomDeg = 0;
  raiseRemainingMs = 0;

  private cooldownMs = 0;
  private reloadRemainingMs = 0;
  private reloadDurationMs = 1;
  private reloadingKind: 'tactical' | 'empty' | null = null;
  private burstLeft = 0;
  private triggerWasDown = false;
  private sinceLastShotMs = 0;

  constructor(readonly def: WeaponDef) {
    // リザーブ弾は全武器共通で無限。リロード操作自体は必須のままだが、
    // 弾薬切れで撃てなくなることはない(分母は ∞ 表示)
    this.magazine = new Magazine(def.magazineSize, Infinity);
    this.recoil = new RecoilTracker(def.recoilPattern, def.recoilRecoveryPerS);
    // 取り出した直後は構え時間がかかる
    this.raiseRemainingMs = def.switchMs;
  }

  get reloading(): boolean {
    return this.reloadingKind !== null;
  }

  get ready(): boolean {
    return this.raiseRemainingMs <= 0 && !this.reloading;
  }

  // 0(開始)から1(完了)。ビューモデルのリロード動作用
  get reloadRatio(): number {
    if (this.reloadingKind === null) return 0;
    return 1 - Math.max(0, this.reloadRemainingMs) / this.reloadDurationMs;
  }

  // 1(構え直し開始)から0(構え完了)
  get raiseRatio(): number {
    return this.def.switchMs > 0 ? this.raiseRemainingMs / this.def.switchMs : 0;
  }

  // 武器切替で構え直す。前回しまった時の照準状態を持ち越さない
  raise(): void {
    this.raiseRemainingMs = this.def.switchMs;
    this.cancelReload();
    this.burstLeft = 0;
    this.adsProgress = 0;
    this.bloomDeg = 0;
    this.recoil.reset();
  }

  cancelReload(): void {
    this.reloadingKind = null;
    this.reloadRemainingMs = 0;
  }

  // リスポーン時などに弾薬と射撃状態を満タン・初期状態へ戻す。
  // すぐに撃てるよう構え直しは別途 raise() 側で扱う
  resupply(): void {
    this.magazine.rounds = this.magazine.capacity;
    this.cancelReload();
    this.burstLeft = 0;
    this.bloomDeg = 0;
    this.recoil.reset();
  }

  currentSpreadRad(ctx: SpreadContext): number {
    const ads = this.def.spreadAdsDeg;
    const hip = this.def.spreadHipDeg;
    // クイックスコープ: スコープ武器は85%覗き込めば完全ADS扱い(決まれば必ず当たる)。
    // 非スコープ武器は従来どおり滑らかなADS曲線を保つ
    const adsP = this.def.scope === true && this.adsProgress >= 0.85 ? 1 : this.adsProgress;
    let deg = hip + (ads - hip) * adsP;
    // 動的拡散(ブルーム/移動/空中)はADSの度合いに応じて打ち消す。
    // これが無いと覗いても移動・空中・ブルームの誤差が残り「当たらない」
    const cancel = 1 - adsP * this.def.adsMoveSuppression;
    deg += this.bloomDeg * cancel;
    let moveTerm = this.def.movementSpreadDeg * ctx.moveFactor;
    if (ctx.airborne) moveTerm += this.def.airSpreadDeg;
    if (ctx.sliding) moveTerm *= 0.5;
    else if (ctx.wallRunning) moveTerm *= 0.7;
    deg += moveTerm * cancel;
    if (ctx.crouched) deg *= 0.8;
    return deg * DEG;
  }

  update(dtMs: number, input: WeaponInput, ctx: SpreadContext): WeaponEvent[] {
    const events: WeaponEvent[] = [];
    this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    this.raiseRemainingMs = Math.max(0, this.raiseRemainingMs - dtMs);
    this.sinceLastShotMs += dtMs;
    this.bloomDeg = Math.max(0, this.bloomDeg - (this.def.bloomRecoveryDegPerS * dtMs) / 1000);

    const adsTarget = input.ads && !this.reloading ? 1 : 0;
    const adsStep = dtMs / this.def.adsTimeMs;
    this.adsProgress += Math.sign(adsTarget - this.adsProgress) * adsStep;
    this.adsProgress = Math.min(1, Math.max(0, this.adsProgress));

    if (this.sinceLastShotMs > 350) this.recoil.reset();

    if (this.reloadingKind !== null) {
      this.reloadRemainingMs -= dtMs;
      if (this.reloadRemainingMs <= 0) {
        this.magazine.finishReload();
        this.reloadingKind = null;
        events.push({ type: 'reload-finish' });
      }
      this.triggerWasDown = input.trigger;
      return events;
    }

    if (input.reloadPressed && this.magazine.canReload && this.raiseRemainingMs <= 0) {
      const kind = this.magazine.reloadKind();
      const durationMs = kind === 'tactical' ? this.def.reloadTacticalMs : this.def.reloadEmptyMs;
      this.reloadingKind = kind;
      this.reloadRemainingMs = durationMs;
      this.reloadDurationMs = durationMs;
      this.burstLeft = 0;
      events.push({ type: 'reload-start', kind, durationMs });
      this.triggerWasDown = input.trigger;
      return events;
    }

    const triggerPressed = input.trigger && !this.triggerWasDown;
    const wantsShot =
      this.def.mode === 'auto'
        ? input.trigger
        : this.def.mode === 'semi'
          ? triggerPressed
          : this.burstLeft > 0 || triggerPressed;

    if (this.def.mode === 'burst' && triggerPressed && this.burstLeft === 0) {
      this.burstLeft = this.def.burstCount;
    }

    if (wantsShot && this.cooldownMs <= 0 && this.raiseRemainingMs <= 0) {
      if (this.magazine.fire()) {
        this.cooldownMs = 60000 / this.def.rpm;
        this.sinceLastShotMs = 0;
        this.bloomDeg = Math.min(this.def.bloomMaxDeg, this.bloomDeg + this.def.bloomPerShotDeg);
        const recoil = this.recoil.kick();
        events.push({ type: 'fired', spreadRad: this.currentSpreadRad(ctx), recoil });
        if (this.def.mode === 'burst') this.burstLeft -= 1;
        // 空マガジンになったら自動リロード
        if (this.magazine.isEmpty && this.magazine.canReload) {
          this.reloadingKind = 'empty';
          this.reloadRemainingMs = this.def.reloadEmptyMs;
          this.reloadDurationMs = this.def.reloadEmptyMs;
          events.push({ type: 'reload-start', kind: 'empty', durationMs: this.def.reloadEmptyMs });
        }
      } else if (triggerPressed) {
        events.push({ type: 'dryfire' });
      }
    }

    this.triggerWasDown = input.trigger;
    return events;
  }
}
