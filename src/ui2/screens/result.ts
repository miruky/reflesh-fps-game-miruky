// W-ENZA2 F8: リザルト(戦闘詳報) — mock06「06 リザルト.html」の1:1移植。
// 構図・色・寸法はモック原文のインラインstyleをそのまま持ち込み(正典)、
// 数値・名前・行数は全て実データ(MatchResult/MatchProgress/Profile)から差し込む。
// 架空値(照合ID/固定スコア等)は置かない。行数可変の領域はresult.css側でスクロール化。
import '../result.css';
import { easeOutCubic } from '../../core/easing';
import { MEDAL_TOTAL, medalDisplay } from '../../game/medals';
import { dailiesFor } from '../../game/dailies';
import { levelRankUpgrade, rankNameFor } from '../../game/progression';
import { WEAPON_DEFS } from '../../game/weapons';
import type { MatchProgress, MatchResult, Profile, ScreenMount } from '../types';

const MONO = 'font-family:ui-monospace,Consolas,monospace;';
const JP_SP = '　';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── マッチストーリー(旧menu.ts matchStoryMarkersの複製+メダル和名化。src/ui編集禁止のためコピー) ──
export type StoryTone = 'ember' | 'cyan' | 'violet' | 'ok' | 'gold' | 'steel';
export interface StoryMarker {
  kind: 'start' | 'medal' | 'pap' | 'round' | 'levelup' | 'end';
  label: string;
  tone: StoryTone;
}
const STORY_MEDAL_MAX = 6;
export function resultStoryMarkers(result: MatchResult, progress: MatchProgress): StoryMarker[] {
  const markers: StoryMarker[] = [{ kind: 'start', label: 'DROP', tone: 'steel' }];
  const counts = Object.entries(result.summary.medalCounts ?? {});
  counts.sort((a, b) => b[1] - a[1]);
  for (const [id, n] of counts.slice(0, STORY_MEDAL_MAX)) {
    const nice = medalDisplay(id)?.name ?? id.replace(/-/g, ' ').toUpperCase();
    const tone: StoryTone = /kokurai|raitei|kotei|emperor/.test(id) ? 'violet' : 'ember';
    markers.push({ kind: 'medal', label: n > 1 ? `${nice} ×${n}` : nice, tone });
  }
  const overflow = counts.length - STORY_MEDAL_MAX;
  if (overflow > 0) markers.push({ kind: 'medal', label: `+${overflow} MEDALS`, tone: 'ember' });
  if (result.papTierMax) {
    markers.push({
      kind: 'pap',
      label: `鍛神${['', '・壱', '・弐', '・参'][result.papTierMax] ?? `+${result.papTierMax}`}`,
      tone: 'violet',
    });
  }
  if (result.zombieRound !== undefined)
    markers.push({ kind: 'round', label: `ROUND ${result.zombieRound}`, tone: 'violet' });
  if (progress.levelAfter.level > progress.levelBefore.level)
    markers.push({ kind: 'levelup', label: `LV.${progress.levelAfter.level}`, tone: 'cyan' });
  markers.push({
    kind: 'end',
    label: result.won ? 'VICTORY' : 'DEFEAT',
    tone: result.won ? 'gold' : 'steel',
  });
  return markers;
}

// ── スコア行(勝敗題字の隣)。チーム戦=チームスコア/S&D=ラウンド/個人戦=自分の撃破 ──
export function scoreLine(result: MatchResult): {
  a: number;
  b: number | null;
  kind: 'team' | 'snd' | 'solo';
} {
  if (result.teamScores)
    return { a: result.teamScores.mine, b: result.teamScores.enemy, kind: 'team' };
  if (result.sndScore) return { a: result.sndScore[0], b: result.sndScore[1], kind: 'snd' };
  const you = result.rows.find((r) => r.isPlayer);
  return { a: you?.kills ?? result.summary.kills, b: null, kind: 'solo' };
}

// ── 成績カード(実データのみから構成。モックの装飾スパークラインは時系列データが無いため移植しない=捏造回避) ──
export interface StatCard {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subColor?: string;
  variant?: 'ember';
  weaponStyle?: boolean;
  countUp?: number;
}
export function statCards(result: MatchResult, progress: MatchProgress): StatCard[] {
  const you = result.rows.find((r) => r.isPlayer);
  const kills = you?.kills ?? result.summary.kills;
  const deaths = you?.deaths ?? result.summary.deaths;
  const kd = deaths > 0 ? kills / deaths : kills;
  const recordSub = progress.newRecords.length > 0 ? '▲ 自己ベスト更新' : undefined;
  const zombie = result.zombieRound !== undefined;
  const cards: StatCard[] = [];
  if (zombie) {
    // ゾンビ戦: 主役=到達ラウンド(ember)。戦死/撃破比はPvE文脈で低情報のため7枚枠から外す
    cards.push(
      {
        label: '撃破',
        value: String(kills),
        countUp: kills,
        sub: `最長連鎖 ${result.summary.bestStreak}`,
      },
      {
        label: '到達ラウンド',
        value: String(result.zombieRound),
        variant: 'ember',
        sub: recordSub,
        subColor: '#9FE39F',
      },
    );
    if (result.zombiePoints !== undefined)
      cards.push({ label: '獲得PTS', value: result.zombiePoints.toLocaleString() });
    cards.push({
      label: '命中率',
      value: String(Math.round(result.accuracy * 100)),
      unit: '%',
      sub: `頭部 ${result.headshots}`,
    });
    if (result.papTierMax !== undefined && result.papTierMax > 0)
      cards.push({
        label: '鍛神改造',
        value: ['-', '改', '改二', '改三'][result.papTierMax] ?? `改${result.papTierMax}`,
      });
    if (result.specialZombieKills !== undefined)
      cards.push({ label: '特異体討伐', value: String(result.specialZombieKills) });
  } else {
    cards.push(
      {
        label: '撃破',
        value: String(kills),
        countUp: kills,
        sub: `最長連鎖 ${result.summary.bestStreak}`,
      },
      { label: '戦死', value: String(deaths), countUp: deaths },
      {
        label: '撃破比',
        value: kd.toFixed(2),
        variant: 'ember',
        sub: recordSub,
        subColor: '#9FE39F',
      },
      {
        label: '命中率',
        value: String(Math.round(result.accuracy * 100)),
        unit: '%',
        sub: `頭部 ${result.headshots}`,
      },
    );
    if (result.summary.captures > 0)
      cards.push({ label: '確保', value: String(result.summary.captures), unit: '回' });
  }
  if (result.rogue !== undefined) {
    const names = result.rogue.cards;
    cards.push({
      label: '輪廻・供物',
      value: String(names.length),
      unit: '枚',
      sub:
        names.length > 0
          ? names.slice(0, 2).join('・') + (names.length > 2 ? ' 他' : '')
          : undefined,
      subColor: '#DFA8FF',
    });
  }
  const weaponEntries = Object.entries(result.summary.weaponKills ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const top = weaponEntries[0];
  if (top && top[1] > 0) {
    cards.push({
      label: '最多使用',
      value: WEAPON_DEFS[top[0]]?.name ?? top[0],
      weaponStyle: true,
      sub: `${top[1]}撃破`,
      subColor: '#C9A25C',
    });
  }
  // ハイライト(R54-F7 selectHighlights)は専用帯ではなくカード列へ合流(mock06の6枚構図を維持)
  const kindCap = { multikill: 'MULTIKILL', longshot: 'LONGSHOT', moment: 'MOMENT' } as const;
  for (const h of result.highlights ?? []) {
    if (cards.length >= 7) break;
    cards.push({
      label: kindCap[h.kind],
      value: h.value,
      weaponStyle: true,
      sub: h.label,
      subColor: '#FFB98A',
    });
  }
  return cards.slice(0, 7);
}

// ── 獲得メダル帯(実medalCounts。総XP寄与降順で上位8+超過チップ) ──
export type MedalVariant = 'ember' | 'steel' | 'violet' | 'gold';
export interface MedalChip {
  name: string;
  xpLabel: string;
  variant: MedalVariant;
}
export function medalChips(counts: Record<string, number>): {
  chips: MedalChip[];
  overflow: number;
} {
  const entries = Object.entries(counts ?? {}).map(([id, count]) => {
    const d = medalDisplay(id);
    const xp = d?.xp ?? 0;
    const variant: MedalVariant = /kokurai|raitei|kotei|emperor/.test(id)
      ? 'violet'
      : xp >= 400
        ? 'gold'
        : xp >= 250
          ? 'ember'
          : 'steel';
    return {
      xp,
      count,
      chip: {
        name: d?.name ?? id.replace(/-/g, ' ').toUpperCase(),
        xpLabel:
          xp > 0
            ? `+${(xp * count).toLocaleString()} XP${count > 1 ? ` ×${count}` : ''}`
            : count > 1
              ? `×${count}`
              : '',
        variant,
      },
    };
  });
  entries.sort((a, b) => b.xp * b.count - a.xp * a.count || b.count - a.count);
  return {
    chips: entries.slice(0, 8).map((e) => e.chip),
    overflow: Math.max(0, entries.length - 8),
  };
}

// ── 次階級(超越階級カード)。L10万以上=十万位階(次の10万の位)、それ未満=階級表の次しきい値 ──
const RANK_THRESHOLDS: readonly number[] = [
  1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000,
  9000, 9999, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 99999, 100000,
];
export function nextRankInfo(level: number): {
  nextName: string;
  remain: number;
  progress01: number;
} {
  if (level >= 100000) {
    const cur = Math.floor(level / 100000) * 100000;
    const next = cur + 100000;
    return {
      nextName: rankNameFor(next).name,
      remain: next - level,
      progress01: (level - cur) / 100000,
    };
  }
  const next = RANK_THRESHOLDS.find((t) => t > level) ?? 100000;
  let cur = 0;
  for (const t of RANK_THRESHOLDS) if (t <= level) cur = t;
  const span = Math.max(1, next - cur);
  return {
    nextName: rankNameFor(next).name,
    remain: next - level,
    progress01: (level - cur) / span,
  };
}

// ── 「この試合の進行」カード(全て実データ: デイリー/生涯挑戦/カモ解除/メダル図鑑) ──
export interface ProgressRow {
  label: string;
  value: string;
  tone: 'ember' | 'ok' | 'steel';
}
export function progressRows(profile: Profile, progress: MatchProgress): ProgressRow[] {
  const rows: ProgressRow[] = [];
  const seed = Number(profile.daily?.currentDate || 0);
  if (seed > 0) {
    const defs = dailiesFor(seed);
    defs.forEach((def, i) => {
      const prog = Math.min(profile.daily.progress[i] ?? 0, def.target);
      const done = profile.daily.claimed[i] || prog >= def.target;
      rows.push({
        label: `本日の試練: ${def.label}`,
        value: done ? '達成済' : `${prog}/${def.target}`,
        tone: done ? 'ok' : 'ember',
      });
    });
  }
  for (const c of progress.completedChallenges.slice(0, 2))
    rows.push({ label: `生涯挑戦: ${c.name}`, value: '達成済', tone: 'ok' });
  for (const c of progress.newCamos.slice(0, 2))
    rows.push({ label: `カモ解除: ${c.label}`, value: '達成済', tone: 'ok' });
  rows.push({
    label: 'メダル図鑑',
    value: `${Object.keys(profile.medalCounts ?? {}).length}/${MEDAL_TOTAL}`,
    tone: 'steel',
  });
  return rows;
}

// ── XP内訳の下に出す補足行(昇位/解放/自己ベスト/SR変動。旧progressHtmlの機能を圧縮維持) ──
export function xpFootnotes(progress: MatchProgress): { label: string; color: string }[] {
  const out: { label: string; color: string }[] = [];
  const up = levelRankUpgrade(progress.levelBefore, progress.levelAfter);
  if (up) out.push({ label: `${up.name} へ昇位`, color: '#FFD9BC' });
  for (const u of progress.newUnlocks)
    out.push({
      label: `${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${u.name}`,
      color: '#9FE39F',
    });
  for (const r of progress.newRecords) out.push({ label: `自己ベスト: ${r}`, color: '#FFB98A' });
  const delta = progress.ratingAfter - progress.ratingBefore;
  if (delta !== 0) {
    const dir = delta > 0 ? '+' : '';
    const rankNote =
      progress.rankAfter.name === progress.rankBefore.name
        ? ''
        : ` / ${progress.rankAfter.name}へ${delta > 0 ? '昇格' : '降格'}`;
    out.push({
      label: `SR ${progress.ratingBefore} ${dir}${delta} → ${progress.ratingAfter}${rankNote}`,
      color: delta > 0 ? '#9FE39F' : '#C9865C',
    });
  }
  return out;
}

// ── マーカー描画スタイル(mock06のトーン別ノード様式) ──
const TONE_NODE: Record<StoryTone, { border: string; bg: string; text: string; glow?: string }> = {
  ember: { border: '#FFA061', bg: 'rgba(255,107,43,0.25)', text: '#A79F90' },
  violet: {
    border: '#C44DFF',
    bg: 'rgba(196,77,255,0.3)',
    text: '#DFA8FF',
    glow: 'rgba(196,77,255,0.8)',
  },
  gold: { border: '#FF6B2B', bg: '#FF6B2B', text: '#FFB98A', glow: 'rgba(255,107,43,0.8)' },
  steel: { border: '#7FA8C9', bg: 'rgba(127,168,201,0.2)', text: '#8F9FB0' },
  cyan: { border: '#8FDBFF', bg: 'rgba(143,219,255,0.22)', text: '#A8CFE8' },
  ok: { border: '#9FE39F', bg: 'rgba(159,227,159,0.2)', text: '#9FE39F' },
};

const CARD_PLATE =
  'position:relative;background:linear-gradient(180deg, rgba(20,17,14,0.94), rgba(11,10,9,0.95));border:1px solid rgba(232,227,216,0.13);box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);padding:16px 18px 14px 18px;display:flex;flex-direction:column;gap:8px;';
const CARD_PLATE_EMBER =
  'position:relative;background:linear-gradient(180deg, rgba(28,19,12,0.95), rgba(14,11,9,0.95));border:1px solid rgba(255,107,43,0.45);box-shadow:inset 0 1px 0 rgba(255,180,120,0.12), 0 0 22px rgba(255,107,43,0.12);clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);padding:16px 18px 14px 18px;display:flex;flex-direction:column;gap:8px;';

const MEDAL_ICON: Record<MedalVariant, string> = {
  ember:
    '<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="16" fill="none" stroke="rgba(255,160,97,0.4)" stroke-width="1"></circle><rect x="9" y="9" width="20" height="20" fill="rgba(255,107,43,0.16)" stroke="#FF6B2B" stroke-width="1.5" transform="rotate(45 19 19)"></rect><circle cx="19" cy="19" r="3.4" fill="#FFA061"></circle></svg>',
  steel:
    '<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="13" fill="none" stroke="#D8D1C2" stroke-width="1.5"></circle><circle cx="19" cy="19" r="6.5" fill="none" stroke="rgba(216,209,194,0.5)" stroke-width="1"></circle><circle cx="19" cy="19" r="2.8" fill="#D8D1C2"></circle></svg>',
  violet:
    '<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><rect x="10" y="10" width="18" height="18" fill="rgba(196,77,255,0.2)" stroke="#C44DFF" stroke-width="1.6" transform="rotate(45 19 19)"></rect><rect x="14.5" y="14.5" width="9" height="9" fill="#C44DFF" transform="rotate(45 19 19)"></rect></svg>',
  gold: '<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="13" fill="rgba(245,208,107,0.12)" stroke="#F5D06B" stroke-width="1.5"></circle><rect x="13.5" y="13.5" width="11" height="11" fill="none" stroke="#F5D06B" stroke-width="1.2" transform="rotate(45 19 19)"></rect></svg>',
};

const MEDAL_CHIP_STYLE: Record<MedalVariant, string> = {
  ember:
    'display:flex;align-items:center;gap:12px;background:linear-gradient(180deg, rgba(24,18,13,0.94), rgba(14,11,9,0.94));border:1px solid rgba(255,107,43,0.45);box-shadow:inset 0 1px 0 rgba(255,180,120,0.12);clip-path:polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px);padding:11px 20px 11px 14px;white-space:nowrap;flex:none;',
  steel:
    'display:flex;align-items:center;gap:12px;background:linear-gradient(180deg, rgba(20,18,15,0.94), rgba(12,11,10,0.94));border:1px solid rgba(232,227,216,0.2);clip-path:polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px);padding:11px 20px 11px 14px;white-space:nowrap;flex:none;',
  violet:
    'position:relative;display:flex;align-items:center;gap:12px;background:linear-gradient(180deg, rgba(30,12,42,0.96), rgba(16,7,22,0.95));border:1px solid rgba(196,77,255,0.6);box-shadow:0 0 24px rgba(196,77,255,0.2), inset 0 1px 0 rgba(223,168,255,0.14);clip-path:polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px);padding:11px 20px 11px 14px;white-space:nowrap;overflow:hidden;flex:none;',
  gold: 'display:flex;align-items:center;gap:12px;background:linear-gradient(180deg, rgba(26,22,11,0.94), rgba(14,12,8,0.94));border:1px solid rgba(245,208,107,0.45);clip-path:polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px);padding:11px 20px 11px 14px;white-space:nowrap;flex:none;',
};

function statCardHtml(c: StatCard): string {
  const plate = c.variant === 'ember' ? CARD_PLATE_EMBER : CARD_PLATE;
  const labelColor = c.variant === 'ember' ? '#C9865C' : '#77705F';
  const value = c.weaponStyle
    ? `<span style="font-weight:700;font-size:23px;line-height:1.15;color:#F5F0E6;">${esc(c.value)}</span>`
    : `<span style="${MONO}font-size:40px;line-height:1;color:${c.variant === 'ember' ? '#FFB98A;text-shadow:0 0 18px rgba(255,107,43,0.4)' : '#F5F0E6'};"${c.countUp !== undefined ? ` data-cu="${c.countUp}"` : ''}>${esc(c.value)}${c.unit ? `<span style="font-size:19px;color:#77705F;">${c.unit}</span>` : ''}</span>`;
  const subIcon = c.weaponStyle
    ? '<span style="width:11px;height:11px;background:linear-gradient(135deg,#F5D06B,#B8862E);transform:rotate(45deg);flex:none;"></span>'
    : '';
  const sub = c.sub
    ? `<span style="display:flex;align-items:center;gap:7px;">${subIcon}<span style="${MONO}font-size:10px;color:${c.subColor ?? '#8F8778'};">${esc(c.sub)}</span></span>`
    : '';
  return `<div style="${plate}"><span style="${MONO}font-size:10px;letter-spacing:0.2em;color:${labelColor};">${esc(c.label)}</span>${value}${sub}</div>`;
}

function markerHtml(m: StoryMarker, leftPct: number): string {
  const t = TONE_NODE[m.tone];
  const big = m.tone === 'violet' || m.kind === 'end';
  const size = big ? 15 : 11;
  const nodeStyle = `width:${size}px;height:${size}px;background:${t.bg};border:${big ? 2 : 1.5}px solid ${t.border};transform:rotate(45deg);${t.glow ? `box-shadow:0 0 ${big ? 18 : 12}px ${t.glow};` : ''}${m.tone === 'violet' ? 'animation:u2rPulse 2.4s ease-in-out infinite;' : ''}`;
  const label = m.label.length > 16 ? `${m.label.slice(0, 15)}…` : m.label;
  const labelStyle = big
    ? `font-weight:700;font-size:12.5px;color:${t.text};`
    : `font-size:11px;color:${t.text};`;
  return `<div style="position:absolute;left:${leftPct.toFixed(1)}%;top:${big ? 18 : 26}px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:${big ? 7 : 8}px;white-space:nowrap;"><span style="${nodeStyle}"></span><span style="${labelStyle}">${esc(label)}</span></div>`;
}

export const mountResult: ScreenMount = (host, root, opts) => {
  const result = opts?.result;
  const progress = opts?.progress;
  if (!result || !progress) {
    // 契約上showResultからのみ開かれる。ペイロード欠落時は空表示(クラッシュさせない)
    root.replaceChildren();
    return { dispose: (): void => {} };
  }
  const reduce = host.reducedMotion();
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  root.classList.add('u2-result');
  root.classList.toggle('u2r-reduce', reduce);

  const sl = scoreLine(result);
  const cards = statCards(result, progress);
  const markers = resultStoryMarkers(result, progress);
  const { chips, overflow } = medalChips(result.summary.medalCounts ?? {});
  const level = progress.levelAfter;
  const rank = rankNameFor(level.level);
  const nri = nextRankInfo(level.level);
  const gained = level.level - progress.levelBefore.level;
  const rows = progressRows(host.profile, progress);
  const foot = xpFootnotes(progress);
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const totalMedals = Object.values(result.summary.medalCounts ?? {}).reduce((a, b) => a + b, 0);
  const xpRatio = level.toNext > 0 ? Math.min(100, (level.intoLevel / level.toNext) * 100) : 100;

  // 勝敗クラスタ(チーム/S&D=2値、個人戦=撃破数)。チーム銘「焔隊 対 霜隊」はモック正典の固定ブランド
  const scorePair =
    sl.b !== null
      ? `<div style="display:flex;align-items:baseline;gap:14px;">
          <span style="${MONO}font-size:40px;line-height:1;color:${result.won ? '#FFB98A' : '#8FA8C4'};" data-cu="${sl.a}">0</span>
          <span style="${MONO}font-size:20px;color:#55503F;">—</span>
          <span style="${MONO}font-size:40px;line-height:1;color:${result.won ? '#8FA8C4' : '#FFB98A'};" data-cu="${sl.b}">0</span>
        </div>
        <span style="${MONO}font-size:11.5px;letter-spacing:0.2em;color:#8F8778;">焔隊${JP_SP}対${JP_SP}霜隊 · ${esc(result.modeName)}</span>`
      : `<div style="display:flex;align-items:baseline;gap:14px;">
          <span style="${MONO}font-size:40px;line-height:1;color:#FFB98A;" data-cu="${sl.a}">0</span>
          <span style="${MONO}font-size:20px;color:#55503F;">撃破</span>
        </div>
        <span style="${MONO}font-size:11.5px;letter-spacing:0.2em;color:#8F8778;">${esc(result.modeName)}</span>`;

  const hero = result.won
    ? `<div class="u2r-hero-in" style="position:relative;display:flex;align-items:flex-end;gap:30px;">
        <span style="font-weight:800;font-size:158px;line-height:0.94;letter-spacing:0.06em;color:#F7F2E8;text-shadow:0 0 80px rgba(255,107,43,0.5), 0 0 26px rgba(255,140,70,0.35), 0 4px 12px rgba(0,0,0,0.8);">勝利</span>
        <div style="display:flex;flex-direction:column;gap:8px;padding-bottom:16px;">${scorePair}</div>
      </div>`
    : `<div class="u2r-hero-in" style="position:relative;display:flex;align-items:flex-end;gap:30px;">
        <span style="font-weight:800;font-size:158px;line-height:0.94;letter-spacing:0.06em;color:#AEBDCE;text-shadow:0 0 60px rgba(110,140,180,0.4), 0 4px 12px rgba(0,0,0,0.8);">敗北</span>
        <div style="display:flex;flex-direction:column;gap:8px;padding-bottom:16px;">${scorePair}</div>
      </div>`;

  const bgLayers = result.won
    ? `<div style="position:absolute;inset:0;background:radial-gradient(64% 52% at 22% 26%, rgba(255,107,43,0.13) 0%, rgba(255,107,43,0) 70%);"></div>
       <div style="position:absolute;left:-260px;top:-140px;width:1500px;height:1500px;background:linear-gradient(90deg, rgba(255,107,43,0) 0%, rgba(255,107,43,0.07) 48%, rgba(255,107,43,0) 100%);transform:rotate(-24deg);"></div>
       <div style="position:absolute;right:-90px;top:-120px;font-weight:700;font-size:840px;line-height:1;color:rgba(255,107,43,0.045);pointer-events:none;">勝</div>`
    : `<div style="position:absolute;inset:0;background:radial-gradient(64% 52% at 22% 26%, rgba(110,140,180,0.10) 0%, rgba(110,140,180,0) 70%);"></div>
       <div style="position:absolute;right:-90px;top:-120px;font-weight:700;font-size:840px;line-height:1;color:rgba(150,170,200,0.045);pointer-events:none;">敗</div>`;

  const storyItems = markers
    .map((m, i) => markerHtml(m, markers.length <= 1 ? 50 : 5 + (i * 90) / (markers.length - 1)))
    .join('');
  const storyBlock =
    markers.length <= 2
      ? ''
      : `<div style="position:absolute;left:56px;top:342px;width:1310px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="${MONO}font-size:10.5px;letter-spacing:0.26em;color:#77705F;">マッチストーリー</span>
        <span style="${MONO}font-size:10px;color:#55503F;">${esc(result.modeName)}</span>
      </div>
      <div style="position:relative;height:86px;white-space:nowrap;background:linear-gradient(180deg, rgba(18,16,13,0.92), rgba(11,10,9,0.94));border:1px solid rgba(232,227,216,0.13);box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 30px rgba(0,0,0,0.45);clip-path:polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%);">
        <div style="position:absolute;left:30px;right:30px;top:43px;height:2px;background:rgba(232,227,216,0.13);"></div>
        <div style="position:absolute;left:30px;top:43px;width:1250px;height:2px;background:linear-gradient(90deg, #B23E14, #FF6B2B 45%, #C44DFF 48%, #FF6B2B 52%, #FFA061 100%);transform-origin:left;animation:u2rGrow 1.6s cubic-bezier(0.16,1,0.3,1);"></div>
        ${storyItems}
        <span style="position:absolute;left:10px;top:8px;${MONO}font-size:9px;color:#55503F;">確保 ${result.summary.captures} · 最長キルストリーク ${result.summary.bestStreak}</span>
      </div>
    </div>`;

  const boardRows = result.rows
    .map((r, i) => {
      if (r.isPlayer) {
        return `<div style="position:relative;display:grid;grid-template-columns:54px 1fr 110px 110px 110px;align-items:center;padding:0 18px;height:46px;background:linear-gradient(90deg, rgba(46,28,15,0.95), rgba(26,17,11,0.9));border:1px solid rgba(255,107,43,0.55);box-shadow:inset 0 1px 0 rgba(255,180,120,0.14), 0 0 20px rgba(255,107,43,0.12);clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);overflow:hidden;flex:none;">
          <span style="position:absolute;inset:0;background:linear-gradient(105deg, rgba(255,180,120,0) 0%, rgba(255,180,120,0.07) 45%, rgba(255,180,120,0) 60%);width:50%;animation:u2rScan 5s ease-in-out infinite;pointer-events:none;"></span>
          <span style="${MONO}font-size:14px;color:#FFB98A;">${String(i + 1).padStart(2, '0')}</span>
          <span style="display:flex;align-items:center;gap:11px;white-space:nowrap;"><span style="width:9px;height:9px;background:#FF6B2B;transform:rotate(45deg);box-shadow:0 0 8px rgba(255,107,43,0.8);flex:none;"></span><span style="font-size:15px;font-weight:700;color:#FFF4E6;">${esc(r.name)}</span><span style="font-weight:700;font-size:11px;color:#FFD9BC;border:1px solid rgba(255,107,43,0.5);padding:1px 9px;">${esc(rank.name)}</span></span>
          <span style="${MONO}font-size:14px;color:#F2EDE2;text-align:right;">${r.kills}</span>
          <span style="${MONO}font-size:14px;color:#D8D1C2;text-align:right;">${r.deaths}</span>
          <span style="${MONO}font-size:14px;color:#FFB98A;text-align:right;">${(r.deaths > 0 ? r.kills / r.deaths : r.kills).toFixed(2)}</span>
        </div>`;
      }
      const dot = r.isAlly
        ? '<span style="width:7px;height:7px;background:rgba(255,107,43,0.55);transform:rotate(45deg);flex:none;"></span>'
        : '<span style="width:7px;height:7px;background:rgba(127,168,201,0.5);transform:rotate(45deg);flex:none;"></span>';
      return `<div style="display:grid;grid-template-columns:54px 1fr 110px 110px 110px;align-items:center;padding:0 18px;height:38px;background:rgba(13,12,11,0.8);border:1px solid rgba(232,227,216,0.09);flex:none;">
        <span style="${MONO}font-size:12px;color:#77705F;">${String(i + 1).padStart(2, '0')}</span>
        <span style="display:flex;align-items:center;gap:9px;white-space:nowrap;">${dot}<span style="font-size:13.5px;color:#B9B1A0;">${esc(r.name)}</span></span>
        <span style="${MONO}font-size:13px;color:#A79F90;text-align:right;">${r.kills}</span>
        <span style="${MONO}font-size:13px;color:#A79F90;text-align:right;">${r.deaths}</span>
        <span style="${MONO}font-size:13px;color:#A79F90;text-align:right;">${(r.deaths > 0 ? r.kills / r.deaths : r.kills).toFixed(2)}</span>
      </div>`;
    })
    .join('');

  const medalStrip =
    chips.length === 0
      ? ''
      : `<div style="position:absolute;left:56px;bottom:56px;display:flex;flex-direction:column;gap:12px;max-width:1310px;">
      <span style="${MONO}font-size:10.5px;letter-spacing:0.26em;color:#77705F;">獲得メダル${JP_SP}${totalMedals}個 · 図鑑 ${Object.keys(host.profile.medalCounts ?? {}).length} / ${MEDAL_TOTAL}種</span>
      <div class="u2r-medals" style="display:flex;gap:12px;">
        ${chips
          .map(
            (c) => `<div style="${MEDAL_CHIP_STYLE[c.variant]}">
          ${c.variant === 'violet' ? '<span style="position:absolute;inset:0;background:linear-gradient(105deg, rgba(223,168,255,0) 0%, rgba(223,168,255,0.1) 45%, rgba(223,168,255,0) 60%);width:60%;animation:u2rScan 4s ease-in-out infinite;pointer-events:none;"></span>' : ''}
          ${MEDAL_ICON[c.variant]}
          <span style="display:flex;flex-direction:column;gap:2px;"><span style="${c.variant === 'violet' ? 'font-weight:700;' : ''}font-size:14px;color:${c.variant === 'violet' ? '#E9C2FF' : '#F5F0E6'};">${esc(c.name)}</span>${c.xpLabel ? `<span style="${MONO}font-size:10px;color:${c.variant === 'violet' ? '#9B7FB5' : '#8F8778'};">${esc(c.xpLabel)}</span>` : ''}</span>
        </div>`,
          )
          .join('')}
        ${overflow > 0 ? `<div style="${MEDAL_CHIP_STYLE.steel}align-self:stretch;"><span style="${MONO}font-size:13px;color:#A79F90;">+${overflow}種</span></div>` : ''}
      </div>
    </div>`;

  const xpRows = progress.xpBreakdown
    .map((e) => {
      // デイリー達成行は特別様式(旧progressHtmlのxp-daily踏襲=達成の緑)
      const daily = e.label.startsWith('デイリー達成！');
      return `<span${daily ? ' style="color:#9FE39F;"' : ''}>${esc(e.label)}</span><span style="color:${daily ? '#9FE39F' : '#D8D1C2'};text-align:right;">+${e.xp.toLocaleString()}</span>`;
    })
    .join('');
  const footRows = foot
    .map((f) => `<span style="color:${f.color};grid-column:1 / -1;">${esc(f.label)}</span>`)
    .join('');

  const progressCardRows = rows
    .map((r) => {
      const color = r.tone === 'ok' ? '#9FE39F' : r.tone === 'ember' ? '#FFB98A' : '#D8D1C2';
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <span style="font-size:12.5px;color:#C4BBA8;">${esc(r.label)}</span>
        <span style="${MONO}font-size:11.5px;color:${color};flex:none;">${esc(r.value)}</span>
      </div>`;
    })
    .join('');

  const stage = document.createElement('div');
  stage.className = 'u2-result-stage';
  stage.dataset.id = 'scr-result'; // F10スモークの画面到達検証用(scr-*規約)
  stage.innerHTML = `
    ${bgLayers}
    <svg width="1920" height="1700" viewBox="0 0 1920 1700" style="position:absolute;left:0;top:0;animation:u2rSpark 16s linear infinite;" aria-hidden="true">
      <defs><pattern id="u2r-sp" width="340" height="340" patternUnits="userSpaceOnUse">
        <circle cx="40" cy="70" r="1.6" fill="#FFA061" opacity="0.5"></circle>
        <circle cx="200" cy="30" r="1.1" fill="#FF6B2B" opacity="0.4"></circle>
        <circle cx="290" cy="180" r="1.8" fill="#FFC98F" opacity="0.45"></circle>
        <circle cx="120" cy="250" r="1.2" fill="#FF6B2B" opacity="0.35"></circle>
        <circle cx="250" cy="310" r="1.4" fill="#FFA061" opacity="0.4"></circle>
      </pattern></defs>
      <rect width="1920" height="1700" fill="url(#u2r-sp)"></rect>
    </svg>
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 4px);pointer-events:none;"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(130% 100% at 50% 45%, rgba(0,0,0,0) 60%, rgba(2,2,7,0.5) 100%);pointer-events:none;"></div>

    <div style="position:absolute;left:56px;top:34px;right:56px;display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:34px;height:2px;background:#FF6B2B;box-shadow:0 0 12px rgba(255,107,43,0.8);"></div>
        <span style="${MONO}font-size:12px;letter-spacing:0.3em;color:#A79F90;">戦闘詳報${JP_SP}AFTER ACTION REPORT</span>
      </div>
      <span style="${MONO}font-size:11px;letter-spacing:0.16em;color:#5E594F;white-space:nowrap;">${esc(result.modeName)} · LV.${level.level.toLocaleString()} ${esc(rank.name)} · ${dateStr}</span>
    </div>
    <div style="position:absolute;left:56px;top:76px;width:1808px;height:1px;background:linear-gradient(90deg, rgba(255,107,43,0.5), rgba(232,227,216,0.13) 30%, rgba(232,227,216,0.13) 100%);"></div>

    <div style="position:absolute;left:56px;top:104px;display:flex;align-items:flex-end;gap:44px;">${hero}</div>
    ${storyBlock}

    <div style="position:absolute;left:56px;top:492px;width:1310px;display:grid;grid-template-columns:repeat(${cards.length},1fr);gap:10px;">
      ${cards.map(statCardHtml).join('')}
    </div>

    <div style="position:absolute;left:56px;top:668px;width:1310px;display:flex;flex-direction:column;gap:9px;">
      <span style="${MONO}font-size:10.5px;letter-spacing:0.26em;color:#77705F;">スコアボード</span>
      <div style="display:grid;grid-template-columns:54px 1fr 110px 110px 110px;align-items:center;padding:0 18px;height:26px;${MONO}font-size:10px;letter-spacing:0.14em;color:#55503F;">
        <span>順位</span><span>隊員</span><span style="text-align:right;">撃破</span><span style="text-align:right;">戦死</span><span style="text-align:right;">K/D</span>
      </div>
      <div class="u2r-board-rows" style="display:flex;flex-direction:column;gap:4px;">${boardRows}</div>
    </div>

    ${medalStrip}

    <div style="position:absolute;right:56px;top:104px;width:452px;display:flex;flex-direction:column;gap:12px;">
      <div style="position:relative;background:linear-gradient(180deg, rgba(22,19,16,0.95), rgba(12,11,9,0.96));border:1px solid rgba(232,227,216,0.15);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 34px rgba(0,0,0,0.5);clip-path:polygon(22px 0, 100% 0, 100% 100%, 0 100%, 0 22px);padding:22px 28px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="${MONO}font-size:11px;letter-spacing:0.26em;color:#A79F90;">経験${JP_SP}EXPERIENCE</span>
          <span style="${MONO}font-size:11px;color:#9FE39F;">+<span data-cu="${progress.xpTotal}">0</span> XP</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:9px;">
          <div style="display:flex;align-items:baseline;gap:12px;white-space:nowrap;">
            <span style="${MONO}font-size:28px;line-height:1;color:#F5F0E6;">Lv ${level.level.toLocaleString()}</span>
            ${gained > 0 ? `<span style="${MONO}font-size:12.5px;color:#9FE39F;">▲ +${gained.toLocaleString()}</span>` : ''}
          </div>
          <div style="position:relative;height:9px;background:rgba(232,227,216,0.1);box-shadow:inset 0 1px 2px rgba(0,0,0,0.7);">
            <div style="width:${xpRatio.toFixed(1)}%;height:9px;background:linear-gradient(90deg,#B23E14,#FF6B2B 70%,#FFA061);box-shadow:0 0 14px rgba(255,107,43,0.55);transform-origin:left;animation:u2rGrow 1.4s cubic-bezier(0.16,1,0.3,1);"></div>
            <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 38px,rgba(4,4,8,0.95) 38px 40px);"></div>
          </div>
          <div class="u2r-xp-rows" style="display:grid;grid-template-columns:1fr auto;row-gap:5px;${MONO}font-size:11px;color:#8F8778;">
            ${xpRows}${footRows}
          </div>
        </div>
        <div style="border-top:1px solid rgba(232,227,216,0.1);padding-top:16px;display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:11.5px;color:#8F8778;">超越階級</span>
            ${level.level >= 100000 ? `<span style="${MONO}font-size:10px;color:#77705F;">十万位階の伝承</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <span style="position:relative;width:56px;height:56px;flex:none;display:flex;align-items:center;justify-content:center;">
              <span style="position:absolute;inset:0;border:1.5px solid rgba(255,160,97,0.7);transform:rotate(45deg);box-shadow:0 0 18px rgba(255,107,43,0.3);"></span>
              <span style="position:absolute;inset:7px;border:1px solid rgba(255,180,120,0.3);transform:rotate(45deg);"></span>
              <span style="font-weight:700;font-size:25px;color:#FFB98A;">${esc([...rank.name][0] ?? '兵')}</span>
            </span>
            <span style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-weight:700;font-size:25px;letter-spacing:0.1em;color:#FFD9BC;text-shadow:0 0 20px rgba(255,107,43,0.35);">${esc(rank.name)}</span>
              <span style="${MONO}font-size:11px;color:#8F8778;">次階級「${esc(nri.nextName)}」まで <span style="color:#FFB98A;">${nri.remain.toLocaleString()}</span></span>
            </span>
          </div>
          <div style="position:relative;height:4px;background:rgba(232,227,216,0.1);">
            <div style="width:${(nri.progress01 * 100).toFixed(1)}%;height:4px;background:linear-gradient(90deg,#B23E14,#FF6B2B);"></div>
          </div>
        </div>
        <span style="position:absolute;right:8px;top:8px;width:13px;height:13px;border-right:1.5px solid rgba(255,107,43,0.6);border-top:1.5px solid rgba(255,107,43,0.6);"></span>
      </div>

      <div style="background:linear-gradient(180deg, rgba(22,19,16,0.94), rgba(12,11,9,0.95));border:1px solid rgba(232,227,216,0.13);box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);clip-path:polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);padding:16px 24px;display:flex;flex-direction:column;gap:11px;">
        <span style="${MONO}font-size:10.5px;letter-spacing:0.24em;color:#77705F;">この試合の進行</span>
        ${progressCardRows}
      </div>

      <button type="button" class="u2r-cta" data-id="restart">
        <span style="position:absolute;inset:0;background:linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0) 60%);width:40%;animation:u2rScan 3.6s ease-in-out infinite;pointer-events:none;"></span>
        再出撃<span style="${MONO}font-size:12px;font-weight:700;">Ⓐ</span>
      </button>
      <div style="display:flex;gap:10px;">
        <button type="button" class="u2r-btn u2r-btn--l" data-id="to-armory">武器庫</button>
        <button type="button" class="u2r-btn u2r-btn--r" data-id="menu">メニューへ</button>
      </div>
    </div>

    <div style="position:absolute;right:56px;bottom:56px;display:flex;gap:28px;font-size:12.5px;color:#A79F90;white-space:nowrap;">
      <span><span style="color:#FFB98A;">Ⓐ</span> 再出撃</span>
      <span><span style="color:#B9B1A0;">Ⓑ</span> メニュー</span>
    </div>
  `;
  root.replaceChildren(stage);

  // scale-to-fit(1920×1080コンポジションを画面へ等比フィット。v1教訓: レイアウト崩壊の根絶)
  const fit = (): void => {
    const s = Math.min(root.clientWidth / 1920, root.clientHeight / 1080);
    stage.style.setProperty('--u2s', String(s > 0 ? s : 1));
  };
  fit();
  window.addEventListener('resize', fit, sig);

  // countUp(実値へ駆け上がり。reduce時は即値)
  for (const el of Array.from(stage.querySelectorAll<HTMLElement>('[data-cu]'))) {
    const to = Number(el.dataset.cu ?? '0');
    if (reduce || to <= 0) {
      el.textContent = to.toLocaleString();
      continue;
    }
    const start = performance.now();
    const durationMs = 750;
    const tick = (nowT: number): void => {
      if (!el.isConnected) return;
      const p = Math.min(1, (nowT - start) / durationMs);
      el.textContent = Math.round(easeOutCubic(p) * to).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const restartBtn = stage.querySelector<HTMLButtonElement>('[data-id="restart"]');
  restartBtn?.addEventListener('click', () => host.callbacks.onRestart(), sig);
  stage
    .querySelector<HTMLButtonElement>('[data-id="menu"]')
    ?.addEventListener('click', () => host.callbacks.onQuit(), sig);
  stage
    .querySelector<HTMLButtonElement>('[data-id="to-armory"]')
    ?.addEventListener('click', () => host.open('armory'), sig);
  restartBtn?.focus({ preventScroll: true });

  return {
    dispose(): void {
      ac.abort();
      root.classList.remove('u2-result', 'u2r-reduce');
      root.replaceChildren();
    },
  };
};
