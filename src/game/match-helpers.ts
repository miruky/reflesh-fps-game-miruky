// match.ts の純関数ヘルパー群(R54-W1 F1でmatch.tsから分割抽出。実装は移動のみ・挙動不変)。
// Matchのthisに依存しない、スポーン/チューニング/ゾンビ経済/LOD/無線などの判定・計算関数。
// 公開面は match.ts の re-export シム経由でも従来どおり import できる。
import { ZOMBIE_CROWD_INSTANCED } from '../render/zombie-crowd';
import { penetrationFactor } from './ballistics';
import type { BotKind, BotTier, BotTuning, Difficulty } from './bot';
import type { RadioLine } from './campaign';
import type { GameMode } from './modes';
import type { PapTier } from './zombie-economy';
import type { WeaponClass, WeaponDef } from './weapons';

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

/** 修羅スピンアップ曲線: 1.5sで400→1800rpm, 0.5sでスピンダウン。
 * R54-F8' E2: sinceReleasedS(トリガを離してからの経過秒)が MINIGUN_HOLD_GRACE_S 未満の間は
 * 減衰を保留する「スピン維持猶予」。省略時 Infinity=即減衰(従来挙動と完全互換)。
 * M-EMP配線: match側は「fireDownが偽になった時刻」からの経過を渡すだけ(状態1個)。 */
export const MINIGUN_HOLD_GRACE_S = 0.8;
export function minigunNextRpm(
  currentRpm: number,
  dt: number,
  spinning: boolean,
  sinceReleasedS = Infinity,
): number {
  if (spinning) {
    const rate = (1800 - 400) / 1.5;
    return Math.min(1800, currentRpm + rate * dt);
  }
  if (sinceReleasedS < MINIGUN_HOLD_GRACE_S) return currentRpm; // 猶予中は保留
  const rate = 1800 / 0.5;
  return Math.max(0, currentRpm - rate * dt);
}

// ── R54-F8' E2: 修羅の相(3段)。連続ヒット数で昇段、被弾 or 3s非発射で降格(降格判定はmatch側)。
// 段1(20hit)=拡散-15% / 段2(60hit)=RPM上限+10% / 段3(120hit)=バレル赤熱+移動ペナ半減。
// 数値の適用点はM-EMP配線(spread/rpm cap/moveMul)。viewmodelはsetShuraPhase(視覚)のみ。
export const SHURA_PHASE_HITS = [20, 60, 120] as const;
export function shuraPhaseFor(consecutiveHits: number): 0 | 1 | 2 | 3 {
  if (consecutiveHits >= SHURA_PHASE_HITS[2]) return 3;
  if (consecutiveHits >= SHURA_PHASE_HITS[1]) return 2;
  if (consecutiveHits >= SHURA_PHASE_HITS[0]) return 1;
  return 0;
}
export const SHURA_PHASE_SPREAD_MUL = [1, 0.85, 0.85, 0.85] as const; // 段1+
export const SHURA_PHASE_RPM_CAP_MUL = [1, 1, 1.1, 1.1] as const; // 段2+
export const SHURA_PHASE_MOVE_PENALTY_MUL = [1, 1, 1, 0.5] as const; // 段3=移動ペナ半減

// ── R54-F8' E1: 段2.5派生奥義(溜め段2リリース時のkit分岐)。段3天壊は黒雷帝専権のまま。
// M-EMP配線: 溜め段2でリリースした瞬間、activeKit()で分岐 —
//   雷帝: effects.raikinStrike(origin, aimYaw) + 3方向へ各RAIKIN_DMG(XZ扇、RAIKIN_RANGE_M内の
//         最近接botへ方向毎1体、occlusionレイあり)
//   黒帝: 通常斬撃に加え0.4s後(KAGEGA_DELAY_S)に同軌道へ追い斬撃(ダメージ=元×KAGEGA_MUL、
//         effects.kagegaSlash(pos, yaw)を発火時に呼ぶ)
//   黒雷帝: 既存どおり(段2=現行フル、段3=天壊)
export const RAIKIN_DMG = 120;
export const RAIKIN_DIRS = 3;
export const RAIKIN_SPREAD_RAD = 0.5; // 中央±0.5radの3方向
export const RAIKIN_RANGE_M = 14;
export const KAGEGA_MUL = 0.5;
export const KAGEGA_DELAY_S = 0.4;

// ── R54-F8' E1: 帝王アトモス定数(M-EMPがupdateKokuraiSkyTurn→updateEmperorAtmos一般化で消費)。
// 排他優先: kokuraitei > dark > raitei(activeKitと同順)。非発動時は可視空(0.16,0.5)の
// バイト同値デフォルトへ復帰(R53実証の退避/復元対称パターンを一般化するだけ)。
// skyScale/skyClamp=null は「可視空を触らない」(黒帝はfogのみ=空の変化は雷系の特権)。
// envSky/IBLは不可侵(鉄則)。reduceMotionは即時遷移。
export interface EmperorAtmosSpec {
  skyScale: number | null;
  skyClamp: number | null;
  fogTint: number; // scene.fog色をこの色へmix
  fogTintMix: number; // 0..1
  fogDensityMul: number;
}
export const EMPEROR_ATMOS: Record<'raitei' | 'dark' | 'kokuraitei', EmperorAtmosSpec> = {
  // 雷帝: 浅い帯電(空をわずかに沈め、fogを微青に) — 黒雷帝(世界が変わる)との格差を保つ
  raitei: { skyScale: 0.14, skyClamp: 0.46, fogTint: 0x0a1420, fogTintMix: 0.25, fogDensityMul: 1.0 },
  // 黒帝: 空は触らず、fogを紫黒へ+8%濃く(闇の気配のみ)
  dark: { skyScale: null, skyClamp: null, fogTint: 0x0d0114, fogTintMix: 0.3, fogDensityMul: 1.08 },
  // 黒雷帝: 既存R53実装値(0.06,0.3)+fog 0x0a0114/+15% — 参照の単一真実源をここへ
  kokuraitei: { skyScale: 0.06, skyClamp: 0.3, fogTint: 0x0a0114, fogTintMix: 1.0, fogDensityMul: 1.15 },
};

// 拡張マガジン(ext-mag)対象外の武器ID。fists(クナイ)は magazine.fire() を経由しない素手格闘で
// 弾薬概念自体が無い(999は「表示上の∞」を示すダミー値)ため、容量パークを適用する意味がない。
// テストから直接除外判定を検証できるよう export する。
export const EXT_MAG_EXCLUDED_IDS = new Set(['fists']);
// R53-W2: papTier(0-3)→def.papCamoの対応表。tier0はカモなし(undefined)。
// composeZombieWeaponDef自体はpapCamoに触れないため、recomposeWeapon/switchPrimaryWeapon側で
// このテーブルを介して明示的に設定する(viewmodel.setWeaponのキャッシュキー分離に必須)。
export const PAP_CAMO_BY_TIER: ReadonlyArray<WeaponDef['papCamo']> = [undefined, 'pap1', 'pap2', 'pap3'];
// 超鬼畜の敵チューニング倍率(純粋関数)。HP×3 / ダメージ×2.5 / 速度×1.3。
// spawnBot が KIND_TUNING 合成の「後」に適用する(合成前だと達人200/巨躯1500の
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

// ── R59③: SR(sniperクラス)の無限貫通・連鎖 ────────────────────────────
// プレイヤーのSR弾道は何にヒットしても停止しない: 敵は減衰なしで貫通して後ろの敵へ連鎖、
// 壁は枚数無制限(減衰は累積するが下限0.35=遠くの敵にも致命傷が残る)。跳弾はなし。
// bot側の射撃レイは不変(プレイヤー専用の爽快感=理不尽回避)。marksman(scope無しDMR)は
// 対象外 — スコープSR(class==='sniper')だけの対物ライフル的ファンタジーとして差別化する。
export const SNIPER_PIERCE_MIN_FACTOR = 0.35; // 壁N枚後の累積ダメージ係数の下限
export const SNIPER_PIERCE_MAX_LEGS = 16; // 1弾道の最大レグ数(無限ループ防止)
export const SNIPER_WALL_PROBE_M = 4.5; // SRの壁厚計測上限(m)。これ以上の厚み=地形級は停止
export function sniperPiercesAll(cls: WeaponClass): boolean {
  return cls === 'sniper';
}
// 壁1枚抜けるごとの累積係数更新。通常武器の penetrationFactor(厚み≥貫通力で0=停止)と違い、
// SRは下限 SNIPER_PIERCE_MIN_FACTOR で必ず生き残る(=無限枚数貫通の数値保証)
export function sniperWallDamageFactor(
  prev: number,
  thicknessM: number,
  penetrationM: number,
): number {
  return Math.max(SNIPER_PIERCE_MIN_FACTOR, prev * penetrationFactor(thicknessM, penetrationM));
}

// ── R59④: SRの吸着部位選択 — “真の角度”最近接(頭バイアス排除) ─────────────
// rankAimPoints の eff(angle−headバイアス0.4°)は微プルのタイブレーク用。吸着(磁力/スナップ)を
// eff先頭で選ぶと遠距離(≈100m超)で頭が常勝になり自動HS化するため、吸着点だけは真の角度が
// 最小の部位を選ぶ=「頭が明確に近い時だけ頭」。候補は呼び出し側で可視部位に絞って渡す。
export function nearestPartByTrueAngle<T extends { angle: number }>(
  cands: readonly T[],
): T | null {
  let best: T | null = null;
  for (const c of cands) {
    if (best === null || c.angle < best.angle) best = c;
  }
  return best;
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
// R60①: 達人(master)は強すぎるため「精鋭(hard)」選択時のみ出現に制限する。巨躯(giant)は
//   従来どおり(帯 [0.08,0.13) / hell [0.30,0.35) を不変に保ち、頻度を上げない)。master の帯に
//   当たっても hard でなければ humanoid にフォールバック(=giant の頻度は難易度に依らず一定)。
export function resolveNaturalBotKind(
  rand: () => number,
  teamBased: boolean,
  hellMode: boolean,
  allGiantMode: boolean,
  difficulty: Difficulty = 'normal',
): BotKind {
  const masterAllowed = difficulty === 'hard';
  if (allGiantMode) return 'giant';
  if (hellMode) {
    const r = rand();
    if (r < 0.30) return masterAllowed ? 'master' : 'humanoid';
    if (r < 0.35) return 'giant';
    return 'humanoid';
  }
  if (!teamBased) return 'humanoid';
  const r = rand();
  if (r < 0.08) return masterAllowed ? 'master' : 'humanoid';
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

// ── R54-F3: match.ts と story-engine.ts が共有する定数(移設) ──
// 黒帝/敵対斬撃波のヒット半径・同時上限・敵対斬撃ダメージ基準値
export const DARK_SLASH_RADIUS = 5.0; // m ヒット円柱半径(②倍サイズ化)
export const DARK_SLASH_MAX = 8; // 同時存在上限
// 34=HP100の1/3で「2発は耐えるが3発目が致命」(帝王編ボスの敵対斬撃基準値)
export const HOSTILE_SLASH_DAMAGE = 34;
export const PLAYER_NAME = 'あなた';
