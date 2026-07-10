// R54-F7: リザルト・ハイライトカード選定(純粋関数)。
// リプレイ基盤は持たない — 試合中に既に集計済みの統計(メダル回数/最長連鎖/最長キル距離)
// だけから「その試合の見どころ」最大3枚を選ぶ。match.ts の result() が薄く配線し、
// menu.ts の showResult がマッチストーリー帯の直上にカードとして描画する。
export interface HighlightInput {
  bestStreak: number; // 最長連続キル(デス無し)
  maxKillDistM: number; // プレイヤーのキル最長水平距離(m, round済み。0=キル無し/未計測)
  headshots: number;
  kills: number;
  accuracy: number; // 0..1
  medalCounts: Readonly<Partial<Record<string, number>>>; // MedalTracker.counts(発火回数)
}

export interface HighlightCard {
  kind: 'multikill' | 'longshot' | 'moment';
  label: string;
  value: string;
}

// マルチキル・ラダー(上位から判定)。medals.ts の既存ID: 短時間連続キルの段位
const MULTIKILL_LADDER: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'frenzy-kill', label: 'フレンジキル' },
  { id: 'triple-kill', label: 'トリプルキル' },
  { id: 'double-kill', label: 'ダブルキル' },
];

/** ロングショット閾値(m)。BO2系の狙撃称賛ラインに合わせる。 */
export const LONGSHOT_MIN_M = 40;

/**
 * ハイライト最大3枚を [multikill, longshot, moment] の順で選ぶ。
 * 各カードは条件未達なら欠番(0〜3枚)。値は全て内部生成文字列(HTML安全)。
 */
export function selectHighlights(s: HighlightInput): HighlightCard[] {
  const cards: HighlightCard[] = [];

  // ① マルチキル: 最上位の達成メダル(発火回数付き)
  for (const rung of MULTIKILL_LADDER) {
    const n = s.medalCounts[rung.id] ?? 0;
    if (n > 0) {
      cards.push({ kind: 'multikill', label: rung.label, value: n > 1 ? `×${n}` : '達成' });
      break;
    }
  }

  // ② ロングショット: 最長キル距離が閾値以上
  if (s.maxKillDistM >= LONGSHOT_MIN_M) {
    cards.push({ kind: 'longshot', label: 'ロングショット', value: `${Math.round(s.maxKillDistM)}m` });
  }

  // ③ モーメント: 連鎖 > ヘッドショット > 精密 > 殲滅 の優先順で1枚
  if (s.bestStreak >= 8) {
    cards.push({ kind: 'moment', label: '連続撃破', value: `${s.bestStreak}連続` });
  } else if (s.headshots >= 5) {
    cards.push({ kind: 'moment', label: 'ヘッドハンター', value: `${s.headshots} HS` });
  } else if (s.accuracy >= 0.5 && s.kills >= 5) {
    cards.push({ kind: 'moment', label: '精密射撃', value: `${Math.round(s.accuracy * 100)}%` });
  } else if (s.kills >= 20) {
    cards.push({ kind: 'moment', label: '殲滅', value: `${s.kills}キル` });
  }

  return cards;
}
