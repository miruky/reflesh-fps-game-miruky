// match.ts の純関数ヘルパー群(R54-W1 F1でmatch.tsから分割抽出。実装は移動のみ・挙動不変)。
// Matchのthisに依存しない、スポーン/チューニング/ゾンビ経済/LOD/無線などの判定・計算関数。
// 公開面は match.ts の re-export シム経由でも従来どおり import できる。
import { ZOMBIE_CROWD_INSTANCED } from '../render/zombie-crowd';
import type { BotKind, BotTier, BotTuning } from './bot';
import type { RadioLine } from './campaign';
import type { GameMode } from './modes';
import type { PapTier } from './zombie-economy';
import type { WeaponDef } from './weapons';

/**
 * ② BO2式スポーンスコアリング(純関数・テスト可能)。
 * 敵から 40-70m を最高点(100)、<25m は大減点、遠すぎは緩く減点。
 * 既存の占有チェック(1.2m)と組み合わせて pickSpawn が最適地点を選ぶ。
 */
export function spawnDistScore(d: number): number {
  if (d < 25) return -200 + d * 4;            // 大減点: 0→-200, 25→-100
  if (d < 40) return (d - 25) * (100 / 15) - 100; // 線形: 25→-100, 40→0
  if (d <= 70) return 100;                     // 最高スコア帯
  if (d <= 120) return 100 - (d - 70) * 2;    // 70→100, 120→0
  return Math.max(-50, 100 - (d - 70) * 2);   // 120m超: 最低-50
}

/**
 * ① 戦闘引力ホットスポットのEMA更新(純関数・テスト可能)。
 * prev=null(初イベントまたは10秒減衰後)はイベント位置をそのまま採用、
 * 以降は α=0.35 の指数移動平均で直近の戦闘位置へ滑らかに寄せる。O(1)/イベント。
 */
export function hotspotEma(
  prev: { x: number; z: number } | null,
  event: { x: number; z: number },
  alpha = 0.35,
): { x: number; z: number } {
  if (!prev) return { x: event.x, z: event.z };
  return {
    x: prev.x + (event.x - prev.x) * alpha,
    z: prev.z + (event.z - prev.z) * alpha,
  };
}

// ── R33 特殊武器 純関数ヘルパー(テスト可能) ──

/** 月光弓チャージ乗数: 0s→0.5倍, 1.2s→1.3倍 の線形補間 */
export function bowChargeMultiplier(chargeS: number): number {
  const t = Math.max(0, Math.min(1, chargeS / 1.2));
  return 0.5 + t * 0.8;
}

/** 風神扇ペレット水平yaw角(rad): 垂直pitchはゼロ(純水平扇形) */
export function fanPelletYaw(i: number, total: number, halfSpanRad: number): number {
  if (total <= 1) return 0;
  return -halfSpanRad + (i / (total - 1)) * halfSpanRad * 2;
}

/** 修羅スピンアップ曲線: 1.5sで400→1800rpm, 0.5sでスピンダウン */
export function minigunNextRpm(currentRpm: number, dt: number, spinning: boolean): number {
  if (spinning) {
    const rate = (1800 - 400) / 1.5;
    return Math.min(1800, currentRpm + rate * dt);
  }
  const rate = 1800 / 0.5;
  return Math.max(0, currentRpm - rate * dt);
}

// 拡張マガジン(ext-mag)対象外の武器ID。fists(クナイ)は magazine.fire() を経由しない素手格闘で
// 弾薬概念自体が無い(999は「表示上の∞」を示すダミー値)ため、容量パークを適用する意味がない。
// テストから直接除外判定を検証できるよう export する。
export const EXT_MAG_EXCLUDED_IDS = new Set(['fists']);
// R53-W2: papTier(0-3)→def.papCamoの対応表。tier0はカモなし(undefined)。
// composeZombieWeaponDef自体はpapCamoに触れないため、recomposeWeapon/switchPrimaryWeapon側で
// このテーブルを介して明示的に設定する(viewmodel.setWeaponのキャッシュキー分離に必須)。
export const PAP_CAMO_BY_TIER: ReadonlyArray<WeaponDef['papCamo']> = [undefined, 'pap1', 'pap2', 'pap3'];
// 超鬼畜の敵チューニング倍率(純粋関数)。HP×3 / ダメージ×2.5 / 速度×1.3。
// spawnBot が KIND_TUNING 合成の「後」に適用する(合成前だと達人600/巨躯1500の
// maxHp が KIND_TUNING の後勝ちで倍率を打ち消してしまうため)
export function applyHellTuning(t: BotTuning): BotTuning {
  return {
    ...t,
    maxHp: Math.round(t.maxHp * 3),
    damage: Math.round(t.damage * 2.5),
    // ★7 1.75でcap(巨躯2.08→1.75)。高速化しすぎたKCCのsubstep増を抑える(監査確証)
    moveSpeedMul: Math.max(t.moveSpeedMul, Math.min(1.75, t.moveSpeedMul * 1.3)), // V36: capは基礎速度未満に落とさない(精鋭鈍足化の回帰防止。capの主対象=巨躯のKCC)
  };
}

// T1: 超鬼畜(hellMode)を tier/kind 別に適用する境界(spawnBot の唯一の適用サイト)。
// 「ゾンビの」boss tier は zombieBossHp が既に80,000上限の「1体20分の壁を作らない」
// 設計曲線を持つため、ここへ HP×3 を重ねると240,000まで突破してしまう。
// damage×2.5/speed×1.3(脅威の底上げ)は維持したまま、HP倍率だけを除外する。
// V-W1レビュー: 除外は kind==='zombie' 限定 — 戦車/章ボス等の非ゾンビボスまで
// 除外すると hell で従来より柔らかくなる回帰(6600→2200)になるため。
// ★V-A MEDIUM修正: 鍛神台の封印判定(純関数)。ドアが存在し未開放の間、PaPは使用不可 —
// ドア(1750pt)に「鍛神台の解錠」という機能的意味を与える。ドアが無いレイアウト(将来)では
// 封印しない(恒久使用不能の防止)。
export function papInteractSealed(hasDoor: boolean, doorOpen: boolean): boolean {
  return hasDoor && !doorOpen;
}

// R54-W1 Q1: ニンジャ(クナイ)ロードアウトのHP300タンク化を適用してよいか(純関数)。
// ガンゲーム(ラダー武器強制)は既存どおり除外、S&D(ノーリスポーン戦術モード)も新たに除外する
// (HP300+黒雷帝キットの組み合わせが不公平に成立するのを防ぐ。permanentDarkEmperorEligibleと対称)。
export function ninjaHp300Eligible(primaryId: string, mode: GameMode): boolean {
  return primaryId === 'fists' && mode !== 'gungame' && mode !== 'snd';
}

// R54-W1 Q1: 常闇カモ装備時の黒帝モード試合開始時永続化を適用してよいか(純関数)。
// ninjaHp300Eligibleと対称のモード除外(gungame/training/snd)
export function permanentDarkEmperorEligible(mode: GameMode): boolean {
  return mode !== 'gungame' && mode !== 'training' && mode !== 'snd';
}

// ★V-A MEDIUM修正: インスタキルの適用判定(純関数)。ボス非適用=nukeのboss除外と対称
// (80k HPのボスが1発で消える事故防止。BO2でもインスタキルはボス級に効かないのが自然)
export function instaKillApplies(timerS: number, tier: BotTier): boolean {
  return timerS > 0 && tier !== 'boss';
}

// ★V-A修正: 壁(再)購入後のPaP tier(純関数)。「今まさに所持している改造済み武器」の
// 再購入は弾補給扱いでtier維持(BO2準拠)。非所持武器の取得=新品tier0
export function papTierAfterWallBuy(currentlyHeld: boolean, currentTier: PapTier): PapTier {
  return currentlyHeld && currentTier > 0 ? currentTier : 0;
}

export function applyHellTierTuning(merged: BotTuning, tier: BotTier, kind: BotKind): BotTuning {
  const hell = applyHellTuning(merged);
  return tier === 'boss' && kind === 'zombie' ? { ...hell, maxHp: merged.maxHp } : hell;
}

// R53-W3 M3: 帝王溜めの段判定(純関数)。0.5/1.2/2.2sの閾値、段3=黒雷・天壊(黒雷帝限定)
export function emperorChargeStageFor(timerS: number): 0 | 1 | 2 | 3 {
  if (timerS >= 2.2) return 3;
  if (timerS >= 1.2) return 2;
  if (timerS >= 0.5) return 1;
  return 0;
}

// R53-W3 M3: ゾンビ群InstancedMeshの適格判定(純関数、zombie-crowd.ts協定)。
// 非boss かつ variant無し かつ 最近接8体(rank<8)でない個体のみinstanced化する
export function isCrowdEligible(
  tier: BotTier,
  variant: string | null,
  hordeRank: number,
): boolean {
  return ZOMBIE_CROWD_INSTANCED && tier !== 'boss' && variant === null && hordeRank >= 8;
}

// R54-W1 Q8: 群衆スロットの取得/解放をヒステリシス付きで判定する(純関数)。
// isCrowdEligibleの単一閾値(rank>=8)をそのままacquire/release双方に使うと、rankが
// 7⇔8境界で揺れる個体が0.25s周期のupdateZombieHordeRankのたびslot着脱をチャタリングする。
// rank<7で確実にrelease/rank>9で確実にacquireし、7-9はデッドバンド(現状維持)にする。
export function crowdSlotAction(
  hordeRank: number,
  hasSlot: boolean,
  eligible: boolean,
): 'release' | 'acquire' | 'none' {
  if (hordeRank < 7 && hasSlot) return 'release';
  if (hordeRank > 9 && !hasSlot && eligible) return 'acquire';
  return 'none';
}

// R53-W2 M2b: ミッション難易度の敵チューニング乗算(純関数・spawnBot漏斗から呼ぶ)。
// easy 0.75/0.75=「初見でも詰まない」、hard 1.4/1.3=「hell(HP×3/dmg×2.5)未満の歯応え」。
// normal/未指定は恒等(参照そのまま=アロケなし)
export function applyMissionDifficultyTuning(
  t: BotTuning,
  difficulty?: 'easy' | 'normal' | 'hard',
): BotTuning {
  if (!difficulty || difficulty === 'normal') return t;
  const hard = difficulty === 'hard';
  return {
    ...t,
    maxHp: Math.round(t.maxHp * (hard ? 1.4 : 0.75)),
    damage: Math.round(t.damage * (hard ? 1.3 : 0.75)),
  };
}

// R53-W2 M2b: 無線劇スケジューラの振り分け(純関数)。発火条件(イベント一致 or 時刻到達)を
// 満たす行を fired へ、残りを rest へ(いずれもデータ順を維持)
export function splitRadioLines(
  lines: readonly RadioLine[],
  cond: { event?: 'start' | 'boss-hp50' | 'wave-clear' | 'objective-done'; timeS?: number },
): { fired: RadioLine[]; rest: RadioLine[] } {
  const fired: RadioLine[] = [];
  const rest: RadioLine[] = [];
  for (const line of lines) {
    const byEvent = cond.event !== undefined && line.at.event === cond.event;
    const byTime = cond.timeS !== undefined && line.at.s !== undefined && cond.timeS >= line.at.s;
    if (byEvent || byTime) fired.push(line);
    else rest.push(line);
  }
  return { fired, rest };
}

// R51 ユーザー⑥: 初期スポーンの敵種(達人/巨躯)選択(純関数)。
// - allGiantMode(トグル明示ON): 個人戦/チーム戦を問わず全員巨躯(従来どおり)
// - hellMode(トグル明示ON): 個人戦/チーム戦を問わず高確率(30%/35%)で自然湧き(従来どおり)
// - トグルOFFのデフォルト: チーム系モード(teamBased)でのみ低確率(8%/13%)の自然湧きを許可。
//   個人戦(FFA/ガンゲーム等)はデフォルトで達人/巨躯ゼロ(ユーザー要望)
export function resolveNaturalBotKind(
  rand: () => number,
  teamBased: boolean,
  hellMode: boolean,
  allGiantMode: boolean,
): BotKind {
  if (allGiantMode) return 'giant';
  if (hellMode) {
    const r = rand();
    if (r < 0.30) return 'master';
    if (r < 0.35) return 'giant';
    return 'humanoid';
  }
  if (!teamBased) return 'humanoid';
  const r = rand();
  if (r < 0.08) return 'master';
  if (r < 0.13) return 'giant';
  return 'humanoid';
}

// ★1 影LODバケット(純関数): 距離二乗の配列から「近い順にcap体だけtrue」のフラグ配列を返す。
// 同距離は先着(index昇順)で安定。cap以下なら全true
export function shadowLodFlags(d2: readonly number[], cap: number): boolean[] {
  if (d2.length <= cap) return d2.map(() => true);
  const order = d2.map((_, i) => i).sort((a, b) => d2[a]! - d2[b]! || a - b);
  const flags = new Array<boolean>(d2.length).fill(false);
  for (let i = 0; i < cap; i += 1) flags[order[i]!] = true;
  return flags;
}

// ★5 群衆ランク(純関数、R51-4e): 距離二乗の配列から「近い順の順位」を返す(0=最近接)。
// 同距離はindex昇順で安定。bot.ts の zombieKccSkipFactor が hordeRank>=ZOMBIE_HORDE_THIN_RANK
// (先頭集団の外)のKCC解決を間引くLODに使う
export function zombieHordeRanks(d2: readonly number[]): number[] {
  const order = d2.map((_, i) => i).sort((a, b) => d2[a]! - d2[b]! || a - b);
  const ranks = new Array<number>(d2.length);
  for (let i = 0; i < order.length; i += 1) ranks[order[i]!] = i;
  return ranks;
}

// F2 修羅スピンアップ(純関数): 発射しなかったfireイベントの弾をマガジンへ安全に返す
export function refundRound(rounds: number, capacity: number): number {
  return Math.min(capacity, rounds + 1);
}

// F8 手裏剣disc寿命(純関数): hitscan着弾距離で飛行時間をクランプ。未ヒット/不正速度は既定0.5s
export function shurikenDiscLife(hitDistM: number | null, speedMps: number, maxLifeS = 0.5): number {
  if (hitDistM === null || !(speedMps > 0) || !(hitDistM >= 0)) return maxLifeS;
  return Math.min(maxLifeS, hitDistM / speedMps);
}
