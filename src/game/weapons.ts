import type { Falloff } from './ballistics';
import { Magazine } from './magazine';
import { RecoilTracker, type RecoilStep } from './recoil';

export type FireMode = 'auto' | 'semi' | 'burst';
export type WeaponSlot = 'primary' | 'secondary';
// 発砲音の合成プロファイル。audio.tsのshot()と対応する
export type SoundProfile = 'ar' | 'smg' | 'dmr' | 'shotgun' | 'lmg' | 'pistol' | 'br' | 'marksman';
// 武器カテゴリ。メダル判定(LONGSHOT閾値・距離系)とエイムアシストの分岐に使う。
// 'marksman'=セミオート精密射手(boltの'sniper'と区別)
// 'launcher'=ロケットランチャー(爆発物。ヒットスキャンを使わず弾体を飛ばす)
export type WeaponClass =
  | 'ar'
  | 'smg'
  | 'sniper'
  | 'shotgun'
  | 'br'
  | 'lmg'
  | 'pistol'
  | 'marksman'
  | 'launcher';

// procedural な銃シルエットの形状キー(viewmodel が SHAPE_SPECS で解決)。
// 同クラスでも別シルエットに振り分けて見分けを付ける。
export type ViewModelShape =
  | 'rifle'
  | 'carbine'
  | 'bullpup'
  | 'smg'
  | 'pdw'
  | 'machine-pistol'
  | 'dmr'
  | 'sniper-bolt'
  | 'dsr-bp' // BO2 DSR-50風ブルパップ・スナイパー(大型ブレーキ+ベンチレーテッドシュラウド)
  | 'fists' // 素手(拳のみ。銃は描かない)
  | 'shotgun-pump'
  | 'shotgun-auto'
  | 'shotgun-double'
  | 'lmg-belt'
  | 'lmg-drum'
  | 'pistol'
  | 'revolver'
  | 'launcher'; // ロケットランチャー(肩担ぎ発射筒)

// 兵装画面のステータスバー(6軸・0..10)。computeWeaponBars で WeaponDef から導出する
export interface WeaponBars {
  power: number;
  rate: number;
  control: number;
  range: number;
  mobility: number;
  handling: number;
}

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
  // ── R7 任意フィールド(未指定で従来挙動) ──
  // procedural シルエット形状。未指定なら viewmodel がクラス既定へフォールバック
  shape?: ViewModelShape;
  // 銃身長などの全体スケール。未指定なら viewmodel のクラス既定値
  bodyScale?: number;
}

const DEG = Math.PI / 180;

// 一般化リコイル生成。pitch=縦跳ね(先頭強・末尾減衰 decay), yaw=横流れ drift + ジグザグ。
// frontLoad>0 で初弾側をさらに強める(スナイパー/SGのドカン)。steps<=1 はNaN回避でt=0。
interface RecoilOpts {
  steps: number;
  pitchDeg: number;
  driftDeg: number;
  decay?: number;
  zigzagDeg?: number;
  frontLoad?: number;
}
export function buildRecoil(o: RecoilOpts): RecoilStep[] {
  const decay = o.decay ?? 0.45;
  const zig = o.zigzagDeg ?? 0;
  const front = o.frontLoad ?? 0;
  const pattern: RecoilStep[] = [];
  for (let i = 0; i < o.steps; i += 1) {
    const t = o.steps <= 1 ? 0 : i / (o.steps - 1);
    const pitch = o.pitchDeg * DEG * (1 - t * decay) * (1 + front * (1 - t));
    const yaw = o.driftDeg * DEG * t + (zig ? zig * DEG * (i % 2 ? 1 : -1) : 0);
    pattern.push({ pitch, yaw });
  }
  return pattern;
}

// 立ち上がりは縦に跳ね、弾倉後半で横へ流れる(既存7武器と完全後方互換のラッパ)。
// 新武器用の kick/drift/zigzag/flat プリセットは buildRecoil を直接呼んで表現する。
function risingPattern(steps: number, pitchDeg: number, driftDeg: number): RecoilStep[] {
  return buildRecoil({ steps, pitchDeg, driftDeg });
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
    range: 360, // A2-4: 見えてるのに届かない空白域縮小(falloff不変=遠距離は最低dmgのまま)
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
    range: 220, // A2-4: SMG 150-160→220
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
    // BO2 DSR-50準拠のブルパップ・シルエット(大型ブレーキ/ベンチレーテッドシュラウド/大型スコープ)
    shape: 'dsr-bp',
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
    falloff: { start: 600, end: 999, minFactor: 0.9 }, // range999まで全域でOSK維持(end999=フォールオフ終端)
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.32, // 約3.1倍ズーム
    adsTimeMs: 330, // R8.2: 体感の重さを軽減。0.85スナップで約280ms=BO2のQSテンポ
    switchMs: 480, // 持ち替えも軽く(重さは一撃の反動/音で表現する)
    // 実反動は小さく保つ: fireShotは反動加算後のplayer.pitchで弾道を出すため、ここを
    // 大きくすると初弾がクロスヘアから上振れする。重い一撃の手応えはviewModelキック・
    // 画面シェイク(0.12)・ボルト音の演出層で出す。
    recoilPattern: risingPattern(4, 0.5, 0.08),
    recoilRecoveryPerS: 7, // やや遅い収束で重量感(視覚のキック側に効く)
    range: 999,
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
    damage: 13, // A2-1: 8ペレット×13=104>100で至近OSK成立(falloff/他SGは不変)
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
    range: 310, // A2-4: BR/MK +50
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
    range: 360, // A2-4
    tracerColor: 0xffa3e0,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.8,
    soundProfile: 'lmg',
    class: 'lmg',
    adsMoveSuppression: 0.2,
    airSpreadDeg: 3.0,
  },
  // ── R8 追加プライマリ(18) ────────────────────────────────────────
  'kasasagi-ar': {
    id: 'kasasagi-ar',
    name: 'カササギAR',
    slot: 'primary',
    damage: 34,
    headshotMultiplier: 1.6,
    // 3発キル(34x3)を残しつつ、近接TTKが全SMGを上回る支配を避けるため低rpm化
    rpm: 470,
    magazineSize: 30,
    reloadTacticalMs: 1800,
    reloadEmptyMs: 2400,
    spreadHipDeg: 2.4,
    spreadAdsDeg: 0.28,
    bloomPerShotDeg: 0.18,
    bloomMaxDeg: 1.4,
    bloomRecoveryDegPerS: 1.3,
    movementSpreadDeg: 1.0,
    falloff: { start: 26, end: 56, minFactor: 0.7 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.72,
    adsTimeMs: 235,
    switchMs: 470,
    // 高威力・高反動: 初弾から強く跳ねるドカン系AR
    recoilPattern: buildRecoil({ steps: 8, pitchDeg: 0.52, driftDeg: 0.16, decay: 0.4 }),
    recoilRecoveryPerS: 5.5,
    range: 360, // A2-4
    tracerColor: 0xff5a3c,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.35,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
    shape: 'rifle',
  },
  'ginyanma-ar': {
    id: 'ginyanma-ar',
    name: 'ギンヤンマAR',
    slot: 'primary',
    damage: 23,
    headshotMultiplier: 1.6,
    rpm: 820,
    magazineSize: 36,
    reloadTacticalMs: 1700,
    reloadEmptyMs: 2300,
    spreadHipDeg: 2.2,
    spreadAdsDeg: 0.22,
    bloomPerShotDeg: 0.13,
    bloomMaxDeg: 1.1,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.8,
    falloff: { start: 24, end: 52, minFactor: 0.68 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.72,
    adsTimeMs: 210,
    switchMs: 440,
    // 低反動レーザー: decay 0 で全弾ほぼ同じ小さな縦反動
    recoilPattern: buildRecoil({ steps: 10, pitchDeg: 0.22, driftDeg: 0.03, decay: 0 }),
    recoilRecoveryPerS: 6.5,
    range: 360, // A2-4
    tracerColor: 0x5affa0,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.35,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
    shape: 'carbine',
  },
  'akatsuki-ar': {
    id: 'akatsuki-ar',
    name: 'アカツキAR',
    slot: 'primary',
    damage: 29,
    headshotMultiplier: 1.6,
    rpm: 600,
    magazineSize: 30,
    reloadTacticalMs: 1700,
    reloadEmptyMs: 2300,
    spreadHipDeg: 2.2,
    spreadAdsDeg: 0.25,
    bloomPerShotDeg: 0.16,
    bloomMaxDeg: 1.3,
    bloomRecoveryDegPerS: 1.4,
    movementSpreadDeg: 0.9,
    falloff: { start: 30, end: 66, minFactor: 0.7 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.7,
    adsTimeMs: 220,
    switchMs: 450,
    recoilPattern: risingPattern(9, 0.34, 0.08),
    recoilRecoveryPerS: 6,
    range: 360, // A2-4
    tracerColor: 0x4db8ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.35,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
    shape: 'bullpup',
  },
  'tobikuma-ar': {
    id: 'tobikuma-ar',
    name: 'トビクモAR',
    slot: 'primary',
    damage: 31,
    headshotMultiplier: 1.6,
    rpm: 520,
    magazineSize: 30,
    reloadTacticalMs: 1850,
    reloadEmptyMs: 2450,
    spreadHipDeg: 2.4,
    spreadAdsDeg: 0.27,
    bloomPerShotDeg: 0.17,
    bloomMaxDeg: 1.4,
    bloomRecoveryDegPerS: 1.3,
    movementSpreadDeg: 1.1,
    falloff: { start: 32, end: 70, minFactor: 0.72 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.7,
    adsTimeMs: 245,
    switchMs: 480,
    // 重AR: frontLoad で初弾ドカン、貫通力高め
    recoilPattern: buildRecoil({ steps: 8, pitchDeg: 0.46, driftDeg: 0.1, frontLoad: 0.6 }),
    recoilRecoveryPerS: 5.5,
    range: 360, // A2-4
    tracerColor: 0xff9e2c,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.5,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
    shape: 'rifle',
  },
  'shinonome-ar': {
    id: 'shinonome-ar',
    name: 'シノノメAR',
    slot: 'primary',
    damage: 30,
    headshotMultiplier: 1.6,
    rpm: 540,
    magazineSize: 24,
    reloadTacticalMs: 1650,
    reloadEmptyMs: 2250,
    spreadHipDeg: 2.1,
    spreadAdsDeg: 0.24,
    bloomPerShotDeg: 0.16,
    bloomMaxDeg: 1.3,
    bloomRecoveryDegPerS: 1.5,
    movementSpreadDeg: 0.85,
    falloff: { start: 36, end: 72, minFactor: 0.78 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.7,
    adsTimeMs: 200,
    switchMs: 430,
    recoilPattern: risingPattern(8, 0.36, 0.07),
    recoilRecoveryPerS: 6,
    range: 360, // A2-4
    tracerColor: 0xb86bff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.35,
    soundProfile: 'ar',
    class: 'ar',
    adsMoveSuppression: 0.35,
    airSpreadDeg: 2.2,
    shape: 'carbine',
  },
  'hayabusa-smg': {
    id: 'hayabusa-smg',
    name: 'ハヤブサSMG',
    slot: 'primary',
    damage: 18,
    headshotMultiplier: 1.4,
    rpm: 1100,
    magazineSize: 30,
    reloadTacticalMs: 1500,
    reloadEmptyMs: 2000,
    spreadHipDeg: 2.6,
    spreadAdsDeg: 0.55,
    bloomPerShotDeg: 0.14,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.6,
    falloff: { start: 8, end: 20, minFactor: 0.45 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.8,
    adsTimeMs: 150,
    switchMs: 340,
    // 超速射: ジグザグ反動で左右に暴れる
    recoilPattern: buildRecoil({ steps: 8, pitchDeg: 0.24, driftDeg: 0.05, zigzagDeg: 0.1 }),
    recoilRecoveryPerS: 7,
    range: 220, // A2-4
    tracerColor: 0xff3d7a,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.15,
    soundProfile: 'smg',
    class: 'smg',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 1.6,
    shape: 'smg',
  },
  'sasameki-smg': {
    id: 'sasameki-smg',
    name: 'ササメキSMG',
    slot: 'primary',
    damage: 20,
    headshotMultiplier: 1.4,
    rpm: 820,
    magazineSize: 30,
    reloadTacticalMs: 1500,
    reloadEmptyMs: 2000,
    spreadHipDeg: 2.6,
    spreadAdsDeg: 0.5,
    bloomPerShotDeg: 0.14,
    bloomMaxDeg: 1.5,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.6,
    falloff: { start: 10, end: 24, minFactor: 0.5 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.8,
    adsTimeMs: 160,
    switchMs: 350,
    recoilPattern: risingPattern(8, 0.22, -0.1),
    recoilRecoveryPerS: 7,
    range: 220, // A2-4
    tracerColor: 0x7d7dff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.15,
    suppressed: true,
    soundProfile: 'smg',
    class: 'smg',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 1.6,
    shape: 'smg',
  },
  'enaga-pdw': {
    id: 'enaga-pdw',
    name: 'エナガPDW',
    slot: 'primary',
    damage: 24,
    headshotMultiplier: 1.4,
    rpm: 950,
    magazineSize: 40,
    reloadTacticalMs: 1400,
    reloadEmptyMs: 1900,
    spreadHipDeg: 2.7,
    spreadAdsDeg: 0.55,
    bloomPerShotDeg: 0.15,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.5,
    falloff: { start: 9, end: 22, minFactor: 0.48 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.82,
    adsTimeMs: 130,
    switchMs: 300,
    recoilPattern: buildRecoil({ steps: 8, pitchDeg: 0.26, driftDeg: -0.1 }),
    recoilRecoveryPerS: 7.5,
    range: 220, // A2-4
    tracerColor: 0x3dffc0,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.15,
    soundProfile: 'smg',
    class: 'smg',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 1.6,
    shape: 'pdw',
  },
  'mozu-smg': {
    id: 'mozu-smg',
    name: 'モズSMG',
    slot: 'primary',
    damage: 22,
    headshotMultiplier: 1.4,
    rpm: 880,
    magazineSize: 30,
    reloadTacticalMs: 1500,
    reloadEmptyMs: 2000,
    spreadHipDeg: 2.6,
    spreadAdsDeg: 0.52,
    bloomPerShotDeg: 0.14,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 0.6,
    falloff: { start: 11, end: 28, minFactor: 0.52 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.8,
    adsTimeMs: 160,
    switchMs: 350,
    recoilPattern: risingPattern(8, 0.25, -0.11),
    recoilRecoveryPerS: 7,
    range: 220, // A2-4
    tracerColor: 0xf5c542,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.15,
    soundProfile: 'smg',
    class: 'smg',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 1.6,
    shape: 'smg',
  },
  'kagerou-br': {
    id: 'kagerou-br',
    name: 'カゲロウBR',
    slot: 'primary',
    damage: 29,
    headshotMultiplier: 1.7,
    rpm: 700,
    magazineSize: 24,
    reloadTacticalMs: 1800,
    reloadEmptyMs: 2400,
    spreadHipDeg: 2.8,
    spreadAdsDeg: 0.15,
    bloomPerShotDeg: 0.2,
    bloomMaxDeg: 1.2,
    bloomRecoveryDegPerS: 1.6,
    movementSpreadDeg: 1.1,
    falloff: { start: 30, end: 64, minFactor: 0.72 },
    mode: 'burst',
    burstCount: 3,
    adsFovScale: 0.65,
    adsTimeMs: 250,
    switchMs: 490,
    recoilPattern: risingPattern(6, 0.48, 0.1),
    recoilRecoveryPerS: 5.5,
    range: 305, // A2-4: BR +50
    tracerColor: 0x9dff4d,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.4,
    soundProfile: 'br',
    class: 'br',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 2.0,
    shape: 'carbine',
  },
  'shirasagi-mk': {
    id: 'shirasagi-mk',
    name: 'シラサギMK',
    slot: 'primary',
    // 速射DMR: 頭1発(55*1.9=104.5)、胴は2発(<100で即死回避)
    damage: 55,
    headshotMultiplier: 1.9,
    rpm: 260,
    magazineSize: 12,
    reloadTacticalMs: 1900,
    reloadEmptyMs: 2600,
    spreadHipDeg: 3.0,
    spreadAdsDeg: 0.05,
    bloomPerShotDeg: 0.12,
    bloomMaxDeg: 0.6,
    bloomRecoveryDegPerS: 2.5,
    movementSpreadDeg: 0.8,
    falloff: { start: 60, end: 135, minFactor: 0.85 }, // marksman 1.5x 射程拡張
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.45,
    adsTimeMs: 280,
    switchMs: 520,
    recoilPattern: buildRecoil({ steps: 6, pitchDeg: 0.45, driftDeg: 0.08 }),
    recoilRecoveryPerS: 6.5,
    range: 620,
    tracerColor: 0x33e0ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.5,
    // marksman はスコープ/エイムアシスト無し(sniper と区別)
    scope: false,
    aimAssist: false,
    soundProfile: 'marksman',
    class: 'marksman',
    adsMoveSuppression: 0.6,
    airSpreadDeg: 2.2,
    shape: 'dmr',
  },
  'hibari-mk': {
    id: 'hibari-mk',
    name: 'ヒバリMK',
    slot: 'primary',
    // 重DMR: 頭1発(70*1.5=105)、胴は2発
    damage: 70,
    headshotMultiplier: 1.5,
    rpm: 180,
    magazineSize: 10,
    reloadTacticalMs: 2000,
    reloadEmptyMs: 2700,
    spreadHipDeg: 3.2,
    spreadAdsDeg: 0.05,
    bloomPerShotDeg: 0.12,
    bloomMaxDeg: 0.6,
    bloomRecoveryDegPerS: 2.5,
    movementSpreadDeg: 0.85,
    falloff: { start: 75, end: 165, minFactor: 0.9 }, // marksman 1.5x 射程拡張
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.42,
    adsTimeMs: 320,
    switchMs: 540,
    // 初弾はクロスヘア通り(<=0.5°)に保つ。重い手応えは画面シェイク/音で演出
    recoilPattern: buildRecoil({ steps: 5, pitchDeg: 0.48, driftDeg: 0.1 }),
    recoilRecoveryPerS: 6,
    range: 620,
    tracerColor: 0x00b3ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.5,
    scope: false,
    aimAssist: false,
    soundProfile: 'marksman',
    class: 'marksman',
    adsMoveSuppression: 0.6,
    airSpreadDeg: 2.2,
    shape: 'dmr',
  },
  'raicho-sniper': {
    id: 'raicho-sniper',
    name: 'ライチョウ',
    slot: 'primary',
    // 高速ボルト・クイックスコープ向き。base98<105 なので頭1発(98*1.9=186)で仕留める
    damage: 98,
    headshotMultiplier: 1.9,
    rpm: 70,
    magazineSize: 7,
    reloadTacticalMs: 1900,
    reloadEmptyMs: 2600,
    spreadHipDeg: 3.6,
    spreadAdsDeg: 0.02,
    bloomPerShotDeg: 0.12,
    bloomMaxDeg: 0.6,
    bloomRecoveryDegPerS: 2.5,
    movementSpreadDeg: 0.8,
    falloff: { start: 600, end: 999, minFactor: 0.9 }, // range999まで全域でOSK維持(end999=フォールオフ終端)
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.34,
    adsTimeMs: 300,
    switchMs: 540,
    // クイックスコープのドカン感: frontLoad で初弾を強く跳ねさせる
    recoilPattern: buildRecoil({ steps: 4, pitchDeg: 0.5, driftDeg: 0.08 }),
    recoilRecoveryPerS: 7,
    range: 999,
    tracerColor: 0xc8d8ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.6,
    scope: true,
    aimAssist: true,
    soundProfile: 'dmr',
    class: 'sniper',
    adsMoveSuppression: 0.95,
    airSpreadDeg: 2.2,
    shape: 'sniper-bolt',
  },
  'shirayuki-sniper': {
    id: 'shirayuki-sniper',
    name: 'シラユキ',
    slot: 'primary',
    // 最強ボルト(最後解放)。胴・頭ともOSK
    damage: 140,
    headshotMultiplier: 1.9,
    rpm: 45,
    magazineSize: 5,
    reloadTacticalMs: 2400,
    reloadEmptyMs: 3100,
    spreadHipDeg: 4.0,
    spreadAdsDeg: 0.02,
    bloomPerShotDeg: 0.12,
    bloomMaxDeg: 0.6,
    bloomRecoveryDegPerS: 2.5,
    movementSpreadDeg: 0.8,
    falloff: { start: 600, end: 999, minFactor: 0.9 }, // range999まで全域でOSK維持(end999=フォールオフ終端)
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.3,
    adsTimeMs: 460,
    switchMs: 560,
    recoilPattern: buildRecoil({ steps: 4, pitchDeg: 0.5, driftDeg: 0.08 }),
    recoilRecoveryPerS: 7,
    range: 999,
    tracerColor: 0xe8f4ff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.6,
    scope: true,
    aimAssist: true,
    soundProfile: 'dmr',
    class: 'sniper',
    adsMoveSuppression: 0.95,
    airSpreadDeg: 2.2,
    shape: 'sniper-bolt',
  },
  'fukurou-sg': {
    id: 'fukurou-sg',
    name: 'フクロウSG',
    slot: 'primary',
    damage: 9,
    headshotMultiplier: 1.3,
    rpm: 160,
    magazineSize: 8,
    reloadTacticalMs: 2300,
    reloadEmptyMs: 2800,
    spreadHipDeg: 1.8,
    spreadAdsDeg: 0.9,
    bloomPerShotDeg: 0.45,
    bloomMaxDeg: 2.0,
    bloomRecoveryDegPerS: 2.0,
    movementSpreadDeg: 0.8,
    falloff: { start: 7, end: 20, minFactor: 0.22 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.82,
    adsTimeMs: 240,
    switchMs: 480,
    recoilPattern: risingPattern(4, 0.9, 0.1),
    recoilRecoveryPerS: 4.5,
    range: 60,
    tracerColor: 0xffac5a,
    pellets: 8,
    pelletSpreadDeg: 4,
    penetrationM: 0,
    soundProfile: 'shotgun',
    class: 'shotgun',
    adsMoveSuppression: 0.25,
    airSpreadDeg: 2.0,
    shape: 'shotgun-auto',
  },
  'raijin-sg': {
    id: 'raijin-sg',
    name: 'ライジンSG',
    slot: 'primary',
    // 19x5=95。点射でも胴即死しない=ヒイラギ(至近OSK)と差別化した中距離2発SG
    damage: 19,
    headshotMultiplier: 1.3,
    rpm: 90,
    magazineSize: 6,
    reloadTacticalMs: 2400,
    reloadEmptyMs: 2900,
    spreadHipDeg: 1.6,
    spreadAdsDeg: 0.6,
    bloomPerShotDeg: 0.5,
    bloomMaxDeg: 2.0,
    bloomRecoveryDegPerS: 1.8,
    movementSpreadDeg: 0.7,
    falloff: { start: 10, end: 24, minFactor: 0.3 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.8,
    adsTimeMs: 250,
    switchMs: 500,
    // 密集中距離: 太い初弾キック
    recoilPattern: buildRecoil({ steps: 3, pitchDeg: 1.4, driftDeg: 0.1, frontLoad: 0.3 }),
    recoilRecoveryPerS: 4,
    range: 75,
    tracerColor: 0xfff04d,
    pellets: 5,
    pelletSpreadDeg: 1.5,
    penetrationM: 0,
    soundProfile: 'shotgun',
    class: 'shotgun',
    adsMoveSuppression: 0.25,
    airSpreadDeg: 2.0,
    shape: 'shotgun-double',
  },
  'tsuchigumo-lmg': {
    id: 'tsuchigumo-lmg',
    name: 'ツチグモLMG',
    slot: 'primary',
    damage: 30,
    headshotMultiplier: 1.5,
    rpm: 520,
    magazineSize: 60,
    reloadTacticalMs: 3800,
    reloadEmptyMs: 4500,
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
    adsTimeMs: 360,
    switchMs: 720,
    // 重LMG: frontLoad の初弾キック + 最大級の貫通
    recoilPattern: buildRecoil({ steps: 14, pitchDeg: 0.44, driftDeg: 0.14, frontLoad: 0.4 }),
    recoilRecoveryPerS: 5,
    range: 360, // A2-4
    tracerColor: 0xff6bd1,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 1.0,
    soundProfile: 'lmg',
    class: 'lmg',
    adsMoveSuppression: 0.2,
    airSpreadDeg: 3.0,
    shape: 'lmg-belt',
  },
  'raitei-lmg': {
    id: 'raitei-lmg',
    name: 'ライテイLMG',
    slot: 'primary',
    damage: 20,
    headshotMultiplier: 1.5,
    rpm: 750,
    magazineSize: 100,
    reloadTacticalMs: 4000,
    reloadEmptyMs: 4800,
    spreadHipDeg: 3.6,
    spreadAdsDeg: 0.5,
    bloomPerShotDeg: 0.1,
    bloomMaxDeg: 1.5,
    bloomRecoveryDegPerS: 1.2,
    movementSpreadDeg: 1.9,
    falloff: { start: 22, end: 50, minFactor: 0.65 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.7,
    adsTimeMs: 350,
    switchMs: 720,
    // ドラム弾幕: 横へ大きく流れる drift 反動
    recoilPattern: buildRecoil({ steps: 16, pitchDeg: 0.36, driftDeg: 0.22 }),
    recoilRecoveryPerS: 5,
    range: 360, // A2-4
    tracerColor: 0xd16bff,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.8,
    soundProfile: 'lmg',
    class: 'lmg',
    adsMoveSuppression: 0.2,
    airSpreadDeg: 3.0,
    shape: 'lmg-drum',
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
    range: 250, // A2-4: ピストル→250
    tracerColor: 0xfff0a8,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.1,
    soundProfile: 'pistol',
    class: 'pistol',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 1.8,
  },
  // ── R8 追加セカンダリ(3) ─────────────────────────────────────────
  'kawasemi-pistol': {
    id: 'kawasemi-pistol',
    name: 'カワセミ',
    slot: 'secondary',
    damage: 22,
    headshotMultiplier: 1.6,
    rpm: 480,
    magazineSize: 15,
    reloadTacticalMs: 1300,
    reloadEmptyMs: 1800,
    spreadHipDeg: 2.4,
    spreadAdsDeg: 0.45,
    bloomPerShotDeg: 0.2,
    bloomMaxDeg: 1.5,
    bloomRecoveryDegPerS: 1.2,
    movementSpreadDeg: 0.8,
    falloff: { start: 14, end: 32, minFactor: 0.6 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.85,
    adsTimeMs: 140,
    switchMs: 250,
    recoilPattern: risingPattern(4, 0.5, 0.0),
    recoilRecoveryPerS: 7,
    range: 250, // A2-4
    tracerColor: 0x6bffe0,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.1,
    soundProfile: 'pistol',
    class: 'pistol',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 1.8,
    shape: 'pistol',
  },
  'taka-revolver': {
    id: 'taka-revolver',
    name: 'タカ',
    slot: 'secondary',
    // ハンドキャノン: 頭1発(65*1.9=123.5)、胴は<100で即死回避
    damage: 65,
    headshotMultiplier: 1.9,
    rpm: 160,
    magazineSize: 6,
    reloadTacticalMs: 1600,
    reloadEmptyMs: 2100,
    spreadHipDeg: 2.6,
    spreadAdsDeg: 0.45,
    bloomPerShotDeg: 0.3,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.1,
    movementSpreadDeg: 0.9,
    falloff: { start: 16, end: 38, minFactor: 0.55 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.82,
    adsTimeMs: 180,
    switchMs: 300,
    // 大口径の初弾キック
    recoilPattern: buildRecoil({ steps: 4, pitchDeg: 0.5, driftDeg: 0.08 }),
    recoilRecoveryPerS: 6,
    range: 250, // A2-4
    tracerColor: 0xf4c430,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.1,
    soundProfile: 'pistol',
    class: 'pistol',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 1.8,
    shape: 'revolver',
  },
  kogarashi: {
    id: 'kogarashi',
    name: 'コガラシ',
    slot: 'secondary',
    damage: 18,
    headshotMultiplier: 1.4,
    rpm: 1000,
    magazineSize: 20,
    reloadTacticalMs: 1400,
    reloadEmptyMs: 1900,
    spreadHipDeg: 2.8,
    spreadAdsDeg: 0.6,
    bloomPerShotDeg: 0.16,
    bloomMaxDeg: 1.6,
    bloomRecoveryDegPerS: 1.4,
    movementSpreadDeg: 0.7,
    falloff: { start: 10, end: 24, minFactor: 0.5 },
    mode: 'auto',
    burstCount: 1,
    adsFovScale: 0.85,
    adsTimeMs: 130,
    switchMs: 240,
    // 機関拳銃: 小刻みなジグザグ反動
    recoilPattern: buildRecoil({ steps: 8, pitchDeg: 0.24, driftDeg: 0.06, zigzagDeg: 0.08 }),
    recoilRecoveryPerS: 7,
    range: 250, // A2-4
    tracerColor: 0xff8d3d,
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0.1,
    soundProfile: 'pistol',
    class: 'pistol',
    adsMoveSuppression: 0.45,
    airSpreadDeg: 1.8,
    shape: 'machine-pistol',
  },
  // ── クナイ(ニンジャ・ダガー)。近接特化のおふざけ枠 ──
  // id/shape は 'fists' のまま(match/viewmodel の近接分岐が全てこのキーで動く)。
  // 発砲イベントは match が「斬撃」へ差し替える(弾は出ない)。技:
  // 地上射撃=薙ぎ払いコンボ / 空中でしゃがみ=ダイブスラム(衝撃波) / スライド中射撃=スライドキック
  // 右クリック(ADS)構え中の左クリック=ブリンク斬撃(短距離テレポート斬り)
  // 装備時: プレイヤーHP=300 / ウルト(F)=接地でも大衝撃波
  fists: {
    id: 'fists',
    name: 'クナイ',
    slot: 'primary',
    damage: 45, // コンボ1段目。2段目x1.4 / 3段目x2 は match 側で乗算
    headshotMultiplier: 1.2,
    rpm: 480, // クナイ連撃のテンポ(480rpm=125ms/発)
    magazineSize: 999, // 弾は使わない(表示上も∞感を出す)
    reloadTacticalMs: 300,
    reloadEmptyMs: 300,
    spreadHipDeg: 0,
    spreadAdsDeg: 0,
    bloomPerShotDeg: 0,
    bloomMaxDeg: 0,
    bloomRecoveryDegPerS: 1,
    movementSpreadDeg: 0,
    falloff: { start: 2, end: 3, minFactor: 1 },
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 1.0,
    adsTimeMs: 120,
    switchMs: 200,
    // パンチはmatch側で差し替えられ反動加算が走らないため、反動はゼロにする
    // (非ゼロだとrecover()だけが働き照準が下へ恒久ドリフトする)
    recoilPattern: buildRecoil({ steps: 1, pitchDeg: 0, driftDeg: 0 }),
    recoilRecoveryPerS: 10,
    range: 3,
    tracerColor: 0x66e0ff, // 刃紋/柄巻きのエネルギー発光色(ブリンク斬撃の残像にも使う)
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0,
    soundProfile: 'pistol', // 未使用(matchが斬撃音へ差し替え)だが型上必須
    class: 'pistol',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 0,
    shape: 'fists',
  },
  // ── ゴウカRL(業火): ロケットランチャー。発砲イベントは match が弾体発射へ差し替える ──
  // damage=120 は直撃基準(実効は爆発ダメージ)。class='launcher' で爆発物扱い。
  // ヒットスキャン不使用: fireShot は呼ばず、match の 'launcher' 分岐でロケットを飛ばす。
  'gouka-rl': {
    id: 'gouka-rl',
    name: '業火RL',
    slot: 'primary',
    damage: 220, // A2-2: match.ts ROCKET_SPEC.maxDamage=220と同期。表示バー整合。
    // ※range(400)は表示専用(実弾は弾体)。ヒットスキャン非使用のため直撃基準damageのみ有効
    headshotMultiplier: 1.0, // 爆発物のため頭部乗算は無意味
    rpm: 48, // ≈1250ms/発。重い発射感
    magazineSize: 5,
    reloadTacticalMs: 3200,
    reloadEmptyMs: 3800,
    spreadHipDeg: 5.0, // ロケット=着弾爆発なので拡散は非本質
    spreadAdsDeg: 0.5,
    bloomPerShotDeg: 0.0,
    bloomMaxDeg: 0.0,
    bloomRecoveryDegPerS: 1.0,
    movementSpreadDeg: 1.0,
    falloff: { start: 300, end: 400, minFactor: 0.8 }, // hitscan 非使用だが start<end 制約
    mode: 'semi',
    burstCount: 1,
    adsFovScale: 0.85,
    adsTimeMs: 350,
    switchMs: 650,
    // 強い発射反動(frontLoad で初弾をドカン)
    recoilPattern: buildRecoil({ steps: 2, pitchDeg: 0.75, driftDeg: 0.0, frontLoad: 1.2 }),
    recoilRecoveryPerS: 3.5,
    range: 400,
    tracerColor: 0xff6a3c, // 炎色
    pellets: 1,
    pelletSpreadDeg: 0,
    penetrationM: 0,
    soundProfile: 'shotgun', // 発射音はaudioのrocketLaunch()で上書き済みだが型上必須
    class: 'launcher',
    adsMoveSuppression: 0.3,
    airSpreadDeg: 2.0,
    shape: 'launcher',
    bodyScale: 1.4,
  },
};

export const PRIMARY_IDS: readonly string[] = [
  // 既存6
  'kaede-ar',
  'tsubaki-smg',
  'yamasemi-dmr',
  'hiiragi-sg',
  'miyama-br',
  'kumagera-lmg',
  // 追加18(AR5 / SMG4 / BR1 / MK2 / SNIPER2 / SG2 / LMG2)
  'kasasagi-ar',
  'ginyanma-ar',
  'akatsuki-ar',
  'tobikuma-ar',
  'shinonome-ar',
  'hayabusa-smg',
  'sasameki-smg',
  'enaga-pdw',
  'mozu-smg',
  'kagerou-br',
  'shirasagi-mk',
  'hibari-mk',
  'raicho-sniper',
  'shirayuki-sniper',
  'fukurou-sg',
  'raijin-sg',
  'tsuchigumo-lmg',
  'raitei-lmg',
  // ロケットランチャー(業火RL)
  'gouka-rl',
  // おふざけ枠: 武器なし(格闘スタイル)。最初から解放
  'fists',
];

// 副武器ID。match の secondary ルックアップと兵装UIの副武器一覧に使う
export const SECONDARY_IDS: readonly string[] = [
  'suzume',
  'kawasemi-pistol',
  'taka-revolver',
  'kogarashi',
];

// 兵装画面の6軸ステータスを WeaponDef から導出する(手書きRecord廃止)。全て 0..10。
export function computeWeaponBars(def: WeaponDef): WeaponBars {
  const c10 = (v: number): number => Math.max(0, Math.min(10, Math.round(v)));
  const dps = def.damage * def.pellets;
  const climbDeg = def.recoilPattern.reduce((s, st) => s + Math.abs(st.pitch), 0) * (180 / Math.PI);
  return {
    power: c10(1 + (9 * (dps - 14)) / (146 - 14)),
    rate: c10((def.rpm - 80) / 102),
    control: c10(10 - climbDeg * 1.3),
    range: c10(1 + (9 * (def.falloff.end - 24)) / (160 - 24)),
    mobility: c10(11 - (def.adsTimeMs - 110) / 38),
    handling: c10(10 - def.spreadHipDeg * 1.8),
  };
}

export interface WeaponInput {
  trigger: boolean;
  ads: boolean;
  reloadPressed: boolean;
  // ── R7 任意フィールド(未指定で従来挙動) ──
  sprinting?: boolean;
  inspectPressed?: boolean;
  holdBreath?: boolean;
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
  // AddTime(BO7): リロード65%地点で弾倉を事前充填済みか。以降のキャンセルでも弾を保持。
  private reloadAmmoRestored = false;
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
    this.reloadAmmoRestored = false; // 次のリロードは新規扱い(弾は finishReload 済みで magazine に残る)
    this.burstLeft = 0;
    this.adsProgress = 0;
    this.bloomDeg = 0;
    this.recoil.hardReset(); // R14: 蓄積オフセットも消す(切替繰り越しの視点ガクつき防止)
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
    this.recoil.hardReset(); // R14: リスポーンで反動オフセットも完全リセット
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
      // AddTime(BO7式): リロード全体の65%地点で弾倉を先行充填する。
      // これ以降にスプリント/ADS/武器切替/スライドでキャンセルされても弾は残る。
      // 65%未満のキャンセルは従来どおり弾なし(マガジンは変化しない)。
      if (!this.reloadAmmoRestored && this.reloadRatio >= 0.65) {
        this.magazine.finishReload();
        this.reloadAmmoRestored = true;
      }
      if (this.reloadRemainingMs <= 0) {
        // 65%以降でキャンセルなく完走した場合: 既に充填済みなので二重充填しない
        if (!this.reloadAmmoRestored) {
          this.magazine.finishReload();
        }
        this.reloadAmmoRestored = false; // 次リロードのためリセット
        this.reloadingKind = null;
        events.push({ type: 'reload-finish' });
      }
      this.triggerWasDown = input.trigger;
      return events;
    }

    if (input.reloadPressed && this.magazine.canReload && this.raiseRemainingMs <= 0) {
      const kind = this.magazine.reloadKind();
      const durationMs = kind === 'tactical' ? this.def.reloadTacticalMs : this.def.reloadEmptyMs;
      this.reloadAmmoRestored = false; // 新規リロード開始: AddTimeフラグをリセット
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
      // R14: 素手(fists)は近接攻撃なので弾倉を消費しない(999発を消費し999回でロック、を回避)
      if (this.def.id === 'fists' || this.magazine.fire()) {
        this.cooldownMs = 60000 / this.def.rpm;
        this.sinceLastShotMs = 0;
        this.bloomDeg = Math.min(this.def.bloomMaxDeg, this.bloomDeg + this.def.bloomPerShotDeg);
        const recoil = this.recoil.kick();
        events.push({ type: 'fired', spreadRad: this.currentSpreadRad(ctx), recoil });
        if (this.def.mode === 'burst') this.burstLeft -= 1;
        // 空マガジンになったら自動リロード
        if (this.magazine.isEmpty && this.magazine.canReload) {
          this.burstLeft = 0; // R14: 空リロードでバースト残を消し、リロード後の幽霊発射を防ぐ
          this.reloadAmmoRestored = false; // 新規リロード開始
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
