import type { Falloff } from './ballistics';
import { Magazine } from './magazine';
import { RecoilTracker, type RecoilStep } from './recoil';

export type FireMode = 'auto' | 'semi' | 'burst';
export type WeaponSlot = 'primary' | 'secondary';

export interface WeaponDef {
  id: string;
  name: string;
  slot: WeaponSlot;
  damage: number;
  headshotMultiplier: number;
  rpm: number;
  magazineSize: number;
  reserveAmmo: number;
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
    reserveAmmo: 120,
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
  },
  'tsubaki-smg': {
    id: 'tsubaki-smg',
    name: 'ツバキSMG',
    slot: 'primary',
    damage: 19,
    headshotMultiplier: 1.4,
    rpm: 900,
    magazineSize: 35,
    reserveAmmo: 140,
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
  },
  'yamasemi-dmr': {
    id: 'yamasemi-dmr',
    name: 'ヤマセミDMR',
    slot: 'primary',
    damage: 58,
    headshotMultiplier: 1.9,
    rpm: 240,
    magazineSize: 12,
    reserveAmmo: 48,
    reloadTacticalMs: 1900,
    reloadEmptyMs: 2600,
    spreadHipDeg: 3.2,
    spreadAdsDeg: 0.06,
    bloomPerShotDeg: 0.3,
    bloomMaxDeg: 1.8,
    bloomRecoveryDegPerS: 0.9,
    movementSpreadDeg: 1.4,
    falloff: { start: 35, end: 80, minFactor: 0.75 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.5,
    adsTimeMs: 300,
    switchMs: 550,
    recoilPattern: risingPattern(5, 0.95, 0.15),
    recoilRecoveryPerS: 5,
    range: 300,
    tracerColor: 0x9bd1ff,
  },
  suzume: {
    id: 'suzume',
    name: 'スズメ',
    slot: 'secondary',
    damage: 30,
    headshotMultiplier: 1.7,
    rpm: 380,
    magazineSize: 12,
    reserveAmmo: 60,
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
  },
};

export const PRIMARY_IDS = ['kaede-ar', 'tsubaki-smg', 'yamasemi-dmr'] as const;

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
    this.magazine = new Magazine(def.magazineSize, def.reserveAmmo);
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

  currentSpreadRad(ctx: SpreadContext): number {
    const ads = this.def.spreadAdsDeg;
    const hip = this.def.spreadHipDeg;
    let deg = hip + (ads - hip) * this.adsProgress;
    deg += this.bloomDeg;
    deg += this.def.movementSpreadDeg * ctx.moveFactor;
    if (ctx.airborne) deg += 2.5;
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
