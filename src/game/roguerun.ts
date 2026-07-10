// R54-F5: ゾンビ・ローグラン「輪廻(りんね)」モードの純ロジック。
// - カード12種+レア度抽選(rollRogueOffer)
// - RogueMods: ラン内強化の単一集約オブジェクト(線形加算)。適用は既存の単一漏斗のみ:
//   武器系 → composeZombieWeaponDef の opts.rogue(基礎から再計算=複利構造的に不可能)
//   ポイント → ZombieDirector.addZombiePoints(合成上限×3ガード)
//   被ダメ → ZombieDirector 内のゾンビ被弾3点(近接/自爆/毒霧)
//   移速 → zombiePerkMoveMul ゲッター合成 / PaP割引 → zombiePapEffectiveCost
//   PU出現 → cleanupDeadZombies の補充抽選(rollPowerUpAt)
//   【禁止】分散乗算の新設(R53 compose教訓)
// - 恒久メタ進行(rogueTierFor + localStorage 'hibana.rogue.v1')
//   ※profile統合はS1(progression)完了後の統合パスへ申し送り — read/write はストレージ注入型
//     純関数なので、移行時は呼び出し側の storage 差し替えだけで済む。
import type { Rand } from '../core/rng';

export type RogueRarity = 'common' | 'rare' | 'epic';

export interface RogueCard {
  id: string;
  name: string;
  desc: string;
  rarity: RogueRarity;
  /** 即時効果カード('free-perk'/'revive')は RogueMods を変えず、ディレクタが直接実行する */
  instant?: 'free-perk' | 'revive';
}

/** ラン内強化の集約(全て線形加算。導出乗数は使用点で 1+add / 1-add に変換する) */
export interface RogueMods {
  dmgAdd: number; // 武器ダメージ +15% = 0.15
  moveAdd: number; // 移動速度
  reloadAdd: number; // リロード時間短縮(0.2 = -20%時間)
  magAdd: number; // マガジン容量
  dmgTakenAdd: number; // 被ダメージ(守りの札=-0.10 / 血の契約=+0.15)
  pointsAdd: number; // ポイント獲得
  papDiscount: number; // PaPコスト割引(0.2 = -20%)
  powerUpAdd: number; // パワーアップ出現率の追加倍率(+0.5 = 期待値×1.5相当)
}

export function emptyRogueMods(): RogueMods {
  return {
    dmgAdd: 0,
    moveAdd: 0,
    reloadAdd: 0,
    magAdd: 0,
    dmgTakenAdd: 0,
    pointsAdd: 0,
    papDiscount: 0,
    powerUpAdd: 0,
  };
}

// カードプール12種(計画#2の凍結値)。id は保存/スナップショットで使う安定キー。
export const ROGUE_CARDS: readonly RogueCard[] = [
  { id: 'gouka', name: '業火の弾丸', desc: '武器ダメージ +15%', rarity: 'common' },
  { id: 'shippu', name: '疾風', desc: '移動速度 +8%', rarity: 'common' },
  { id: 'hayagome', name: '早込め', desc: 'リロード時間 -20%', rarity: 'common' },
  { id: 'oobukuro', name: '大袋', desc: 'マガジン容量 +25%', rarity: 'common' },
  { id: 'mamori', name: '守りの札', desc: '被ダメージ -10%', rarity: 'common' },
  { id: 'shousai', name: '商才', desc: 'ポイント獲得 +15%', rarity: 'common' },
  { id: 'kouun', name: '幸運', desc: 'パワーアップ出現率 +50%', rarity: 'common' },
  { id: 'idaten', name: '韋駄天', desc: '移動速度 +5% / リロード時間 -10%', rarity: 'common' },
  { id: 'kaji', name: '鍛冶割引', desc: '鍛神台のコスト -20%', rarity: 'rare' },
  { id: 'muhai', name: '無料パーク', desc: 'ランダムなパークを1つ即時取得', rarity: 'rare', instant: 'free-perk' },
  { id: 'tomoshibi', name: '蘇りの灯', desc: '自己復活チャージ +1', rarity: 'rare', instant: 'revive' },
  { id: 'chikei', name: '血の契約', desc: 'ダメージ +30% / 被ダメージ +15%', rarity: 'epic' },
];

const CARD_BY_ID = new Map(ROGUE_CARDS.map((c) => [c.id, c]));

export function rogueCardById(id: string): RogueCard | null {
  return CARD_BY_ID.get(id) ?? null;
}

/**
 * カード効果を RogueMods へ適用した新しいオブジェクトを返す(純関数・線形加算)。
 * instant カード(free-perk/revive)は mods を変えない — 呼び出し側(ディレクタ)が
 * card.instant を見て即時効果を実行する。
 */
export function applyCardToMods(mods: Readonly<RogueMods>, cardId: string): RogueMods {
  const next: RogueMods = { ...mods };
  switch (cardId) {
    case 'gouka':
      next.dmgAdd += 0.15;
      break;
    case 'shippu':
      next.moveAdd += 0.08;
      break;
    case 'hayagome':
      next.reloadAdd += 0.2;
      break;
    case 'oobukuro':
      next.magAdd += 0.25;
      break;
    case 'mamori':
      next.dmgTakenAdd -= 0.1;
      break;
    case 'shousai':
      next.pointsAdd += 0.15;
      break;
    case 'kouun':
      next.powerUpAdd += 0.5;
      break;
    case 'idaten':
      next.moveAdd += 0.05;
      next.reloadAdd += 0.1;
      break;
    case 'kaji':
      next.papDiscount += 0.2;
      break;
    case 'chikei':
      next.dmgAdd += 0.3;
      next.dmgTakenAdd += 0.15;
      break;
    default:
      break; // instant カード('muhai'/'tomoshibi')および未知idは mods 不変
  }
  return next;
}

// レア度の抽選確率(通常 / ボスラウンド後のrarityBoost)。C70/R25/E5 → boost時 R40/E15。
const RARITY_P = { epic: 0.05, rare: 0.25 } as const;
const RARITY_P_BOOST = { epic: 0.15, rare: 0.4 } as const;

function rollRarity(rand: Rand, boost: boolean): RogueRarity {
  const p = boost ? RARITY_P_BOOST : RARITY_P;
  const r = rand();
  if (r < p.epic) return 'epic';
  if (r < p.epic + p.rare) return 'rare';
  return 'common';
}

/**
 * 台座に並べるカードを count 枚、重複なしで抽選する(決定論: rand注入)。
 * スロットごとにレア度を振ってからそのレア度プール内で一様抽選。
 * 同レア度プールが尽きたら全体の未使用カードへフォールバック(count<=12保証)。
 */
export function rollRogueOffer(rand: Rand, rarityBoost: boolean, count = 3): RogueCard[] {
  const picked: RogueCard[] = [];
  const used = new Set<string>();
  const n = Math.min(count, ROGUE_CARDS.length);
  for (let i = 0; i < n; i += 1) {
    const rarity = rollRarity(rand, rarityBoost);
    let pool = ROGUE_CARDS.filter((c) => c.rarity === rarity && !used.has(c.id));
    if (pool.length === 0) pool = ROGUE_CARDS.filter((c) => !used.has(c.id));
    const card = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    if (!card) break;
    used.add(card.id);
    picked.push(card);
  }
  return picked;
}

// ── 恒久メタ進行(累計クリアラウンドで昇格) ─────────────────────────────────
// T1=10R: 開始+500pt / T2=30R: 開始時quick-reviveチャージ1 / T3=60R: レア提示率+10%
// T4=100R: 開始武器がPaP1 / T5=150R: 台座4基提示
export const ROGUE_TIER_ROUNDS = [10, 30, 60, 100, 150] as const;

export function rogueTierFor(totalRounds: number): number {
  let tier = 0;
  for (const need of ROGUE_TIER_ROUNDS) {
    if (totalRounds >= need) tier += 1;
    else break;
  }
  return tier;
}

/** T3(レア提示率+10%)を rollRarity の boost 抽選前に加える簡易版: rare確率を+0.10した独自ロール */
export function rollRogueOfferWithTier(rand: Rand, rarityBoost: boolean, tier: number, countOverride?: number): RogueCard[] {
  const count = countOverride ?? (tier >= 5 ? 4 : 3);
  if (tier < 3) return rollRogueOffer(rand, rarityBoost, count);
  // tier3+: rare下限を底上げ(common判定を10%分rareへ振り替え)
  const picked: RogueCard[] = [];
  const used = new Set<string>();
  for (let i = 0; i < Math.min(count, ROGUE_CARDS.length); i += 1) {
    let rarity = rollRarity(rand, rarityBoost);
    if (rarity === 'common' && rand() < 0.1) rarity = 'rare';
    let pool = ROGUE_CARDS.filter((c) => c.rarity === rarity && !used.has(c.id));
    if (pool.length === 0) pool = ROGUE_CARDS.filter((c) => !used.has(c.id));
    const card = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    if (!card) break;
    used.add(card.id);
    picked.push(card);
  }
  return picked;
}

// ── 恒久メタの保存(localStorage v1。profile統合はS1着地後の統合パスへ申し送り) ──
export const ROGUE_META_KEY = 'hibana.rogue.v1';

export interface RogueMeta {
  totalRounds: number; // 累計クリアラウンド数(恒久tierの入力)
  bestRound: number; // 到達ベストラウンド
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRogueMeta(storage: StorageLike): RogueMeta {
  try {
    const raw = storage.getItem(ROGUE_META_KEY);
    if (!raw) return { totalRounds: 0, bestRound: 0 };
    const parsed = JSON.parse(raw) as Partial<RogueMeta>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { totalRounds: num(parsed.totalRounds), bestRound: num(parsed.bestRound) };
  } catch {
    return { totalRounds: 0, bestRound: 0 };
  }
}

export function writeRogueMeta(storage: StorageLike, meta: RogueMeta): void {
  try {
    storage.setItem(ROGUE_META_KEY, JSON.stringify({ totalRounds: meta.totalRounds, bestRound: meta.bestRound }));
  } catch {
    /* localStorage不可(プライベートモード等)は静かに無視 */
  }
}

/** ラン終了時のメタ加算(純関数)。completedRounds = 到達ラウンド-1(進行中ラウンドは未クリア扱い) */
export function accumulateRogueMeta(meta: Readonly<RogueMeta>, reachedRound: number): RogueMeta {
  const completed = Math.max(0, Math.floor(reachedRound) - 1);
  return {
    totalRounds: meta.totalRounds + completed,
    bestRound: Math.max(meta.bestRound, completed),
  };
}
