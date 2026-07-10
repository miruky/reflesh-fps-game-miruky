// R30 動的天候のロール(match.tsから分割抽出 — R54-W1 F1)。実装は移動のみ・挙動不変。
// ── R30 動的天候 ────────────────────────────────────────────────────
// configシード(stage.seed)から決定論的にロール: 晴60% / 濃霧20% / 雨20%。
// 日付やDate.now()は使わない=同じステージ選択なら常に同じ天候(リプレイ性/テスト安定)。
export type WeatherKind = 'clear' | 'fog' | 'rain';
export function rollWeather(seed: number): WeatherKind {
  // 整数ハッシュ(xorshift-乗算)。Math.imul で32bit演算を保証し、浮動小数の桁落ちを避ける
  let v = (seed ^ (seed >>> 16)) >>> 0;
  v = Math.imul(v, 0x45d9f3b) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  const r01 = v / 0x100000000;
  if (r01 < 0.6) return 'clear';
  return r01 < 0.8 ? 'fog' : 'rain';
}
