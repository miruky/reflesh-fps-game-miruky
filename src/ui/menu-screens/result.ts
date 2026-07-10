// W-ENZA FB9: リザルト(戦闘詳報)— 焔座様式への全面移植。ロジック/データ源は不変で
// 表示のみ刷新(実データバインド: weaponKills=最多使用 / captures=確保 / medalCounts+medalXp=メダル帯 /
// unlockedMedals=図鑑)。契約維持: export名(menu-golden)/data-id(restart/menu/next-mission/
// retry-mission/to-campaign/xptotal/tsmine/tsenemy/aar-*)/.result-xp-list(staggerXpList)/
// .profile-xpbar/.result-stars(star-pop)/.aar-grade(評価シジル)/p2-*(ハイライト)/rogue-*(輪廻)。
import '../enza-result.css';
import { easeOutCubic } from '../../core/easing';
import type { MatchResult } from '../../game/match';
import { CAMPAIGN, missionById, nextMissionId } from '../../game/campaign';
import {
  isMissionUnlocked,
  levelRankUpgrade,
  rankNameFor,
  type CampaignProgress,
  type MatchProgress,
} from '../../game/progression';
import { ALWAYS_BADGE, medalRank, medalDisplay, MEDAL_TOTAL, type MedalId } from '../../game/medals';
import type { MenuScreenHost } from './host';
import {
  latestTitle,
  matchStoryMarkers,
  hexPoints,
  computeGrade,
  rankStampChar,
} from './shared';
import type { GradeInfo } from './shared';

// ── 焔座ヘルパ(表示のみ・純関数) ──────────────────────────────────

// メダルの表示名: MEDALS表の実名(FQA昇格)。未知IDのみ旧規約(ハイフン→空白の大文字化)へフォールバック
const medalLabel = (id: string): string =>
  medalDisplay(id)?.name ?? id.replace(/-/g, ' ').toUpperCase();
// 帝王系イベントの銘判定(タイムライン/メダル帯を紫電で飾る。表示のみの分類)
const EMPEROR_RE = /kokurai|raitei|kotei|emperor|黒雷帝|雷帝|黒帝/i;

// 統計カード1枚。valueへdata-idを渡すとcountUp対象になる
function statCard(
  label: string,
  value: string,
  opts: { sub?: string; mods?: string; dataId?: string; unit?: string } = {},
): string {
  const v = opts.dataId ? `<b data-id="${opts.dataId}">0</b>${opts.unit ?? ''}` : value;
  return `
    <div class="enza-plate ersl-stat${opts.mods ? ` ${opts.mods}` : ''}">
      <span class="ersl-stat-k">${label}</span>
      <span class="ersl-stat-v">${v}</span>
      <span class="ersl-stat-sub">${opts.sub ?? ''}</span>
    </div>`;
}

// 統計カード列: 通常(撃破/戦死/撃破比/命中率/最長連鎖/最多使用)+モード固有(確保/ゾンビ/輪廻)。
// export はテスト用(node環境=文字列検証。ゴールデン網はサブセット検査のため追加export可)
export function statCardsHtml(result: MatchResult, youKills: number, youDeaths: number): string {
  const kd = youDeaths > 0 ? youKills / youDeaths : youKills;
  const kdBest = result.won && kd >= 2 ? '<span class="up">▲ 好調</span>' : '';
  const topWeapon = Object.entries(result.summary.weaponKills).sort((a, b) => b[1] - a[1])[0];
  const cards: string[] = [
    statCard('撃破', '', { dataId: 'aar-kills' }),
    statCard('戦死', '', { dataId: 'aar-deaths' }),
    statCard('撃破比', kd.toFixed(2), { mods: 'ersl-stat--ember', sub: kdBest }),
    statCard('命中率', '', {
      dataId: 'aar-acc',
      unit: '<em class="ersl-stat-unit">%</em>',
      sub: `頭部命中 ${result.headshots}`,
    }),
    statCard('最長連鎖', '', { dataId: 'aar-streak' }),
  ];
  if (result.summary.captures > 0) cards.push(statCard('確保', String(result.summary.captures)));
  if (topWeapon && topWeapon[1] > 0) {
    cards.push(
      statCard('最多使用', topWeapon[0], {
        mods: 'ersl-stat--weapon',
        sub: `<span class="enza-diamond enza-diamond--gold" aria-hidden="true"></span><span class="gold">${topWeapon[1]}撃破</span>`,
      }),
    );
  }
  if (result.zombieRound !== undefined) cards.push(statCard('到達ラウンド', String(result.zombieRound)));
  if (result.zombiePoints !== undefined)
    cards.push(statCard('獲得PTS', result.zombiePoints.toLocaleString()));
  if (result.papTierMax !== undefined && result.papTierMax > 0)
    cards.push(statCard('鍛神改造', ['-', '改', '改二', '改三'][result.papTierMax] ?? `改${result.papTierMax}`));
  if (result.specialZombieKills !== undefined)
    cards.push(statCard('特異体討伐', String(result.specialZombieKills)));
  if (result.rogue !== undefined)
    cards.push(statCard('輪廻・供物', `${result.rogue.cards.length}<em class="ersl-stat-unit">枚</em>`));
  return cards.join('');
}

// 獲得メダル帯: summary.medalCounts(この試合の実取得)をmedalRank降順で最大8チップ。
// ALWAYS_BADGE級=金縁、帝王系=紫電縁。合計XPはsummary.medalXp(実数)。exportはテスト用
export function medalStripHtml(result: MatchResult, codexCount: number): string {
  const entries = Object.entries(result.summary.medalCounts ?? {});
  if (entries.length === 0) return '';
  // 表示専用の防御: medalRankは未知IDで例外を投げるため(MEDALS表参照)、帯の並び替えでは0扱い
  const safeRank = (id: string): number => {
    try {
      return medalRank(id as MedalId);
    } catch {
      return 0;
    }
  };
  entries.sort((a, b) => safeRank(b[0]) - safeRank(a[0]) || b[1] - a[1]);
  const MAX = 8;
  const chips = entries.slice(0, MAX).map(([id, n]) => {
    const mod = EMPEROR_RE.test(id)
      ? ' ersl-medal-chip--emperor'
      : ALWAYS_BADGE.has(id as MedalId)
        ? ' ersl-medal-chip--gold'
        : '';
    const dia = EMPEROR_RE.test(id)
      ? 'enza-diamond enza-diamond--emperor'
      : ALWAYS_BADGE.has(id as MedalId)
        ? 'enza-diamond enza-diamond--gold'
        : 'enza-diamond';
    const perXp = medalDisplay(id);
    const xpTag = perXp ? `<span class="mxp">+${perXp.xp.toLocaleString()} XP</span>` : '';
    return `<div class="ersl-medal-chip${mod}"><span class="${dia}" aria-hidden="true"></span><span class="mname">${medalLabel(id)}</span>${n > 1 ? `<span class="mcount">×${n}</span>` : ''}${xpTag}</div>`;
  });
  const overflow = entries.length - MAX;
  if (overflow > 0)
    chips.push(`<div class="ersl-medal-chip"><span class="mname">+${overflow}</span></div>`);
  const xp = result.summary.medalXp > 0 ? `${'\u3000'}<span class="xp">+${result.summary.medalXp.toLocaleString()} XP</span>` : '';
  return `
    <footer class="ersl-medals">
      <span class="ersl-medals-cap">獲得メダル${'\u3000'}${entries.length}種${xp}${'\u3000'}·${'\u3000'}図鑑 ${codexCount}/${MEDAL_TOTAL}種</span>
      <div class="ersl-medal-chips">${chips.join('')}</div>
    </footer>`;
}

// この試合の進行(実データのみ: 達成チャレンジ/カモ解除/メダル図鑑)
function matchProgressCardHtml(mnu: MenuScreenHost, progress: MatchProgress): string {
  const rows: string[] = [];
  for (const c of progress.completedChallenges) {
    rows.push(
      `<div class="row"><span>${c.name}</span><span class="st">達成 +${c.xp} XP</span></div>`,
    );
  }
  for (const c of progress.newCamos) {
    rows.push(`<div class="row"><span>${c.label}</span><span class="st">カモ解除</span></div>`);
  }
  rows.push(
    `<div class="row"><span>メダル図鑑</span><span class="st dim">${mnu.profile.unlockedMedals.length}/${MEDAL_TOTAL}種 解禁</span></div>`,
  );
  return `
    <div class="ersl-plate-l">
      <div class="ersl-cardhead"><span class="enza-kicker">この試合の進行</span></div>
      <div class="ersl-progress-rows">${rows.join('')}</div>
    </div>`;
}

// ── 画面: 対戦リザルト ────────────────────────────────────────────
export function showResult(
  mnu: MenuScreenHost,
  result: MatchResult,
  progress: MatchProgress,
): void {
  mnu.endCapture();
  mnu.teardownPreview();
  mnu.root.hidden = false;
  mnu.bg?.setScene('result');
  const mvp = result.rows[0];
  const you = result.rows.find((r) => r.isPlayer);
  const youKills = you?.kills ?? result.summary.kills;
  const youDeaths = you?.deaths ?? result.summary.deaths;
  const grade = computeGrade(result);
  const rank = rankNameFor(progress.levelAfter.level);

  // スコアボード(実データ: name/kills/deaths。1位=自分行は橙罫)
  const boardRows = result.rows
    .map((row, i) => {
      const rkd = row.deaths > 0 ? (row.kills / row.deaths).toFixed(2) : row.kills.toFixed(2);
      const cls = row.isPlayer
        ? ' ersl-brow--you'
        : result.teamScores && row.isAlly
          ? ' ersl-brow--ally'
          : '';
      const chip = row.isPlayer ? `<span class="rankchip">${rank.name}</span>` : '';
      return `
      <div class="ersl-brow${cls}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="who"><span class="name">${row.name}</span>${chip}</span>
        <span class="num">${row.kills}</span>
        <span class="num">${row.deaths}</span>
        <span class="num">${rkd}</span>
      </div>`;
    })
    .join('');

  // スコア行(チーム戦=countUp、S&D=先取スコア)
  const scoreHtml = result.teamScores
    ? `<div class="ersl-score"><b data-id="tsmine">0</b><i>—</i><b class="ersl-score-enemy" data-id="tsenemy">0</b></div>`
    : result.sndScore
      ? `<div class="ersl-score"><b>${result.sndScore[0]}</b><i>—</i><b class="ersl-score-enemy">${result.sndScore[1]}</b></div>`
      : '';
  const sublineParts = [
    result.teamScores || result.sndScore ? '焔隊\u3000対\u3000霜隊' : null,
    `MVP: ${mvp ? mvp.name : '-'}`,
  ].filter(Boolean);

  // マッチストーリー/付帯(輪廻チップ+ハイライトは既存様式のまま収容)
  const extras = [
    result.rogue !== undefined && result.rogue.cards.length > 0
      ? `<div class="rogue-aar-cards">${result.rogue.cards.map((c) => `<span class="rogue-chip">${c}</span>`).join('')}</div>`
      : '',
    mnu.highlightsHtml(result),
  ]
    .filter((s) => s !== '')
    .join('');

  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

  mnu.root.innerHTML = `
    <div class="menu-screen ersl-screen${result.won ? ' ersl-won result-won' : ' ersl-lost'}">
      <div class="ersl-wrap" role="dialog" aria-modal="true" aria-label="試合結果">
        <header class="ersl-head">
          <div class="ersl-head-l"><i class="ersl-dash" aria-hidden="true"></i><span class="enza-kicker">戦闘詳報${'\u3000'}AFTER ACTION REPORT</span></div>
          <span class="ersl-meta">${result.modeName}${'\u3000'}·${'\u3000'}LV.${progress.levelAfter.level} ${rank.name}${'\u3000'}·${'\u3000'}${dateStr}</span>
        </header>
        <div class="ersl-rule" aria-hidden="true"></div>
        <section class="ersl-hero">
          <h1 class="enza-ritual ersl-verdict" data-en="${result.won ? 'VICTORY' : 'DEFEAT'}">${result.won ? '勝利' : '敗北'}</h1>
          <div class="ersl-scoreline">
            ${scoreHtml}
            <p class="ersl-subline">${sublineParts.join('\u3000·\u3000')}</p>
          </div>
          ${mnu.gradeSigilHtml(grade)}
        </section>
        ${mnu.matchStoryHtml(result, progress)}
        <section class="ersl-stats">${statCardsHtml(result, youKills, youDeaths)}</section>
        <div class="ersl-extra">${extras}</div>
        <section class="ersl-board">
          <span class="ersl-medals-cap">${result.teamScores ? '焔隊\u3000' : ''}スコアボード</span>
          <div class="ersl-board-grid">
            <div class="ersl-brow ersl-brow--head">
              <span>順位</span><span>隊員</span><span style="text-align:right">撃破</span><span style="text-align:right">戦死</span><span style="text-align:right">K/D</span>
            </div>
            ${boardRows}
          </div>
        </section>
        <aside class="ersl-side">
          ${mnu.progressHtml(progress)}
          ${matchProgressCardHtml(mnu, progress)}
          <div class="ersl-actions">
            <button class="enza-cta" data-id="restart">再出撃<span class="ersl-cta-scan" aria-hidden="true"></span></button>
            <div class="ersl-actions-row">
              <button class="enza-btn" data-id="to-armory">武器庫</button>
              <button class="enza-btn" data-id="menu">メニューへ</button>
            </div>
          </div>
        </aside>
        ${medalStripHtml(result, mnu.profile.unlockedMedals.length)}
        <div class="enza-hintbar ersl-hint" aria-hidden="true"><span><kbd>A</kbd>再出撃</span><span><kbd>B</kbd>メニューへ</span></div>
      </div>
    </div>
  `;
  const wrap = mnu.root.querySelector<HTMLElement>('.ersl-wrap');
  if (wrap) mnu.stagger(wrap);
  mnu.query('restart').addEventListener('click', () => mnu.callbacks.onRestart());
  mnu.query('menu').addEventListener('click', () => mnu.callbacks.onQuit());
  mnu.query('to-armory').addEventListener('click', () => {
    // onQuit経由でmatch破棄+音の後始末を必ず通してから武器庫ページへ(直接遷移だと鳴り残る)
    mnu.callbacks.onQuit();
    mnu.setMfdPage('armory');
  });
  mnu.countUp(mnu.query('xptotal'), progress.xpTotal);
  mnu.staggerXpList();
  if (result.teamScores) {
    mnu.countUp(mnu.query('tsmine'), result.teamScores.mine, 650);
    mnu.countUp(mnu.query('tsenemy'), result.teamScores.enemy, 650);
  }
  mnu.countUp(mnu.query('aar-kills'), youKills);
  mnu.countUp(mnu.query('aar-deaths'), youDeaths);
  mnu.countUp(mnu.query('aar-acc'), Math.round(result.accuracy * 100));
  mnu.countUp(mnu.query('aar-streak'), result.summary.bestStreak);
  mnu.countUp(mnu.query('aar-score'), Math.round(grade.score));
  mnu.query('restart').focus({ preventScroll: true });
}

// ── 画面: ミッションリザルト(戦役詳報) ──────────────────────────────
export function showMissionResult(
  mnu: MenuScreenHost,
  result: MatchResult,
  progress: CampaignProgress,
): void {
  mnu.endCapture();
  mnu.teardownPreview();
  mnu.root.hidden = false;
  mnu.bg?.setScene('result');
  const mission = missionById(progress.missionId);
  const won = result.won;
  const stars = progress.stars;
  // 星は1個ずつspan分割し--iを付与(star-popの捺印stagger用)。読み上げはrole=imgに集約
  const starHtml = won
    ? `<div class="result-stars" role="img" aria-label="評価 ${stars} / 3">${[0, 1, 2]
        .map(
          (i) =>
            `<span class="${i < stars ? 'on' : 'off'}" style="--i:${i}" aria-hidden="true">${i < stars ? '◆' : '◇'}</span>`,
        )
        .join('')}</div>`
    : '';
  const unlockNote = progress.chapterUnlocked
    ? `<p class="ersl-note gold result-chapter-unlock">新章解放: ${CAMPAIGN.find((c) => c.id === progress.chapterUnlocked)?.title ?? ''}</p>`
    : '';
  const firstNote = progress.firstClear
    ? '<p class="ersl-note up result-firstclear">初制圧ボーナス +800 XP</p>'
    : '';
  const nextId = mission && won ? nextMissionId(mission.id) : null;
  const nextUnlocked = nextId ? isMissionUnlocked(mnu.profile, nextId) : false;
  const nextBtn =
    nextId && nextUnlocked
      ? '<button class="enza-cta" data-id="next-mission">次のミッション<span class="ersl-cta-scan" aria-hidden="true"></span></button>'
      : '';
  mnu.root.innerHTML = `
    <div class="menu-screen ersl-screen${won ? ' ersl-won result-won' : ' ersl-lost'}">
      <div class="ersl-wrap ersl-wrap--mission" role="dialog" aria-modal="true" aria-label="ミッション結果">
        <header class="ersl-head">
          <div class="ersl-head-l"><i class="ersl-dash" aria-hidden="true"></i><span class="enza-kicker">戦役詳報${'\u3000'}CAMPAIGN REPORT</span></div>
          <span class="ersl-meta">${mission?.title ?? 'ミッション'}</span>
        </header>
        <div class="ersl-rule" aria-hidden="true"></div>
        <section class="ersl-hero">
          <h1 class="enza-ritual ersl-verdict" data-en="${won ? 'MISSION COMPLETE' : 'MISSION FAILED'}">${won ? 'ミッション達成' : 'ミッション失敗'}</h1>
        </section>
        ${starHtml}
        <div class="ersl-mission-notes">${unlockNote}${firstNote}</div>
        <section class="ersl-stats">
          ${statCard('自己ベスト', `${Math.floor(progress.missionBest?.bestTimeS ?? 0)}<em class="ersl-stat-unit">s</em>`)}
          ${statCard('命中率', `${(result.accuracy * 100).toFixed(1)}<em class="ersl-stat-unit">%</em>`)}
          ${statCard('頭部命中', String(result.headshots))}
        </section>
        <aside class="ersl-side">
          ${mnu.progressHtml(progress)}
          <div class="ersl-actions">
            ${nextBtn}
            <div class="ersl-actions-row">
              <button class="enza-btn" data-id="retry-mission">もう一度</button>
              <button class="enza-btn" data-id="to-campaign">戦役へ戻る</button>
            </div>
          </div>
        </aside>
        <div class="enza-hintbar ersl-hint" aria-hidden="true"><span><kbd>A</kbd>${nextId && nextUnlocked ? '次のミッション' : 'もう一度'}</span><span><kbd>B</kbd>戦役へ</span></div>
      </div>
    </div>
  `;
  const wrap = mnu.root.querySelector<HTMLElement>('.ersl-wrap');
  if (wrap) mnu.stagger(wrap);
  mnu.countUp(mnu.query('xptotal'), progress.xpTotal);
  mnu.staggerXpList();
  if (nextId && nextUnlocked) {
    mnu.query('next-mission').addEventListener('click', () =>
      // ブリーフィングを経由しない直行導線でも、選択中のミッション難易度を引き継ぐ
      mnu.callbacks.onStartMission(nextId, undefined, mnu.selection.missionDifficulty),
    );
  }
  mnu.query('retry-mission').addEventListener('click', () => mnu.callbacks.onRestart());
  mnu.query('to-campaign').addEventListener('click', () => {
    // onQuit経由でmatch破棄+音の後始末(quiesce)を必ず通す(直接showMainだと鳴り残る)
    mnu.callbacks.onQuit();
    mnu.setMfdPage('campaign');
  });
  mnu.query(nextId && nextUnlocked ? 'next-mission' : 'to-campaign').focus({
    preventScroll: true,
  });
}

// R54-F7: ハイライトカード(最大3枚)。マッチストーリー帯の直上に置く「その試合の見どころ」。
// 値は全て match 側の内部生成文字列(ユーザー入力なし=HTML安全)。0枚なら帯ごと出さない
export function highlightsHtml(_mnu: MenuScreenHost, result: MatchResult): string {
  const cards = result.highlights ?? [];
  if (cards.length === 0) return '';
  const kindCap = { multikill: 'MULTIKILL', longshot: 'LONGSHOT', moment: 'MOMENT' } as const;
  return (
    '<div class="p2-highlights">' +
    cards
      .map(
        (c) => `
      <div class="p2-hl-card p2-hl-${c.kind}">
        <span class="p2-hl-kind">${kindCap[c.kind]}</span>
        <span class="p2-hl-label">${c.label}</span>
        <span class="p2-hl-value">${c.value}</span>
      </div>`,
      )
      .join('') +
    '</div>'
  );
}

// マッチストーリー: 実在イベント(matchStoryMarkers)を菱ノードの水平帯として等間隔配置。
// 帝王系の銘は紫電の大菱+彩色(表示のみの分類。マーカー生成は共有純関数のまま)
export function matchStoryHtml(
  _mnu: MenuScreenHost,
  result: MatchResult,
  progress: MatchProgress,
): string {
  const markers = matchStoryMarkers(result, progress);
  if (markers.length <= 2) return ''; // DROP/勝敗のみ=帯にする情報がない
  const nodes = markers
    .map((m, i) => {
      const x = 3 + (i * 94) / (markers.length - 1); // 3%..97%
      const emperor = EMPEROR_RE.test(m.label);
      const tone = emperor ? 'emperor' : m.tone;
      const dia = emperor
        ? 'enza-diamond enza-diamond--emperor'
        : m.kind === 'start' || m.kind === 'end'
          ? `enza-diamond${m.tone === 'gold' ? ' enza-diamond--gold' : ' enza-diamond--outline'}`
          : 'enza-diamond';
      return `<div class="ersl-tl-node ersl-tl--${tone}" style="left:${x.toFixed(1)}%">
        <span class="${dia}" aria-hidden="true"></span>
        <span class="ersl-tl-label">${m.label}</span>
      </div>`;
    })
    .join('');
  return `
    <div class="ersl-story" aria-hidden="true">
      <div class="ersl-story-head"><span class="enza-kicker">マッチストーリー</span><span class="ersl-meta">確保回数 ${result.summary.captures} · 最長キルストリーク ${result.summary.bestStreak}</span></div>
      <div class="ersl-story-band"><i class="ersl-story-line"></i>${nodes}</div>
    </div>`;
}

// 戦闘評価シジル: 面取り六角の刻印にティア色の大グレード1文字。ベベルはSVG内グラデ+
// feDropShadowグロー(CSS filterはリング回転で毎フレーム再計算されるため使わない)。
// 細いティックリングは別要素として回転(reduce時はCSS側でアニメごと停止=静止)。
export function gradeSigilHtml(mnu: MenuScreenHost, grade: GradeInfo): string {
  const id = `aar${mnu.gradeSeq++}`;
  return `
    <div class="aar-grade aar-grade--${grade.tier}" role="img" aria-label="戦闘評価 ${grade.letter}">
      <svg viewBox="0 0 120 120" class="aar-grade-svg" aria-hidden="true">
        <defs>
          <radialGradient id="${id}g" cx="50%" cy="38%" r="66%">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
            <stop offset="0.45" stop-color="currentColor" stop-opacity="0.82"/>
            <stop offset="1" stop-color="#080b0f" stop-opacity="0.96"/>
          </radialGradient>
          <filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="currentColor" flood-opacity="0.75"/>
          </filter>
        </defs>
        <circle class="aar-grade-ring" cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.6 6.6"/>
        <g filter="url(#${id}f)">
          <polygon class="aar-grade-bevel" points="${hexPoints(60, 60, 48)}" fill="url(#${id}g)" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
          <polygon class="aar-grade-inner" points="${hexPoints(60, 60, 39)}" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5"/>
          <text class="aar-grade-letter" x="60" y="62" text-anchor="middle" dominant-baseline="central">${grade.letter}</text>
        </g>
      </svg>
      <span class="aar-grade-cap">戦闘評価</span>
      <span class="aar-grade-score"><b data-id="aar-score">0</b><i>PTS</i></span>
    </div>`;
}

// 経験カード(焔座右列): XP合計/内訳(result-xp-list契約)/レベル/XPバー+超越階級ブロック。
// 対戦・ミッション両リザルトが共用する
export function progressHtml(mnu: MenuScreenHost, progress: MatchProgress): string {
  const xpRows = progress.xpBreakdown
    .map((entry) => {
      // デイリーチャレンジ達成エントリはラベルが 'デイリー達成！' で始まる
      const isDaily = entry.label.startsWith('デイリー達成！');
      const cls = isDaily ? 'xp-daily' : '';
      return `<li${cls ? ` class="${cls}"` : ''}><span class="xp-label">${entry.label}</span><span class="xp-value">+${entry.xp}</span></li>`;
    })
    .join('');
  const level = progress.levelAfter;
  const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
  const rank = rankNameFor(level.level);
  // レベルランク昇位検出(100レベルごとのtier変化を昇位演出として出す)
  const levelRankUp = levelRankUpgrade(progress.levelBefore, progress.levelAfter);
  const lvDelta = level.level - progress.levelBefore.level;
  const levelUp =
    lvDelta > 0
      ? `<p class="ersl-note up result-levelup">レベルアップ LV.${progress.levelBefore.level} → LV.${level.level}${levelRankUp ? ` / ${levelRankUp.name} へ昇位` : ''}</p>`
      : levelRankUp
        ? `<p class="ersl-note up result-levelup">${levelRankUp.name} へ昇位</p>`
        : '';
  const unlockRows = progress.newUnlocks
    .map((u) => `<li>${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${u.name}</li>`)
    .join('');
  // カモ解除!行(XP内訳とは別に、解放一覧としても目立たせる)
  const camoRows = progress.newCamos
    .map((c) => `<li class="result-camo-unlock">カモ解除: ${c.label}</li>`)
    .join('');
  const unlocks =
    unlockRows || camoRows ? `<ul class="ersl-unlocks result-unlocks">${unlockRows}${camoRows}</ul>` : '';
  const delta = progress.ratingAfter - progress.ratingBefore;
  // レーティング階級(SR数値)は補足として残す。主表示はレベルランク
  const rankNote =
    progress.rankAfter.name === progress.rankBefore.name
      ? `SR ${progress.ratingAfter}`
      : delta > 0
        ? `SR ${progress.ratingAfter} / ${progress.rankAfter.name} へ昇格`
        : `SR ${progress.ratingAfter} / ${progress.rankAfter.name} へ降格`;
  const rating =
    delta === 0
      ? `<p class="ersl-note result-rating">${rankNote}</p>`
      : `<p class="ersl-note result-rating">SR ${progress.ratingBefore} <span class="${delta > 0 ? 'rating-up' : 'rating-down'}">${delta > 0 ? '+' : ''}${delta}</span> → ${rankNote}</p>`;
  const recordsHtml = progress.newRecords.length
    ? `<p class="ersl-note gold result-record">自己ベスト更新 ${progress.newRecords.join(' / ')}</p>`
    : '';
  // R53-W2: 称号(profile.titles)があれば階級表示の隣に最新のものを小さく出す
  const resultTitle = latestTitle(mnu.profile.titles);
  const titleHtml = resultTitle ? `<span class="profile-title-badge">${resultTitle}</span>` : '';
  // 超越階級の伝承注記: 10万位階(森羅万象の先)はモック06の文言、以下は位階番号
  const rankNote2 = level.level >= 100000 ? '十万位階の伝承' : `位階 ${rank.tier}`;
  return `
    <section class="ersl-plate-l result-progress">
      <div class="ersl-cardhead">
        <span class="enza-kicker">経験${'\u3000'}EXPERIENCE</span>
        <span class="ersl-xp-gain">+<span data-id="xptotal">0</span> XP</span>
      </div>
      <div class="ersl-lv-row">
        <span class="lv">Lv ${level.level.toLocaleString()}</span>
        ${lvDelta > 0 ? `<span class="delta">▲ +${lvDelta}</span>` : ''}
        ${titleHtml}
      </div>
      <span class="profile-xpbar"><i style="width:${xpRatio}%"></i></span>
      <ul class="result-xp-list">${xpRows}</ul>
      <div class="ersl-divider">
        <div class="ersl-cardhead"><span class="enza-kicker">超越階級</span><span class="ersl-rank-note">${rankNote2}</span></div>
        <div class="ersl-rank-row">
          <span class="ersl-rank-sigil" aria-hidden="true"><span class="dia"></span><span class="stamp">${rankStampChar(rank.name)}</span></span>
          <span class="ersl-rank-name result-level">${rank.name}</span>
        </div>
        ${levelUp}
        ${unlocks}
        ${recordsHtml}
        ${rating}
      </div>
    </section>
  `;
}

// 0から目標値まで数字を駆け上がらせる。画面差し替えで要素が外れたら止める
export function countUp(mnu: MenuScreenHost, el: HTMLElement, to: number, durationMs = 750): void {
  if (mnu.prefersReducedMotion || to <= 0) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - start) / durationMs);
    el.textContent = String(Math.round(easeOutCubic(p) * to));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// 一覧の各行へ入場の段差(--i)を与える。CSS側でanimation-delayに使う
export function stagger(_mnu: MenuScreenHost, container: HTMLElement): void {
  Array.from(container.children).forEach((child, i) => {
    (child as HTMLElement).style.setProperty('--i', String(i));
  });
}

// リザルトのXP内訳行に入場staggerを与える(listitem-inのanimation-delayが--iを参照)
export function staggerXpList(mnu: MenuScreenHost): void {
  const xpList = mnu.root.querySelector<HTMLElement>('.result-xp-list');
  if (xpList) mnu.stagger(xpList);
}
