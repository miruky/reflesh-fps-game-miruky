// W-ENZA2 キャンペーン/ブリーフィング/戦役リザルト — F6所有。
// 正典: mock03(祭壇ナビ/プレート/下帯)+mock06(詳報言語/統計カード/儀式見出し)。
// データ配線の正典: 旧 src/ui/menu.ts renderCampaign/missionChip/showBriefing/showMissionResult(読み取りのみ)。
// 旧menu.tsはimportしない(CSS副作用を避ける)ため、微小ヘルパはここへ複製している。
import '../campaign.css';
import { easeOutCubic } from '../../core/easing';
import {
  CAMPAIGN,
  missionById,
  nextMissionId,
  type MissionDef,
  type RadioSpeaker,
} from '../../game/campaign';
import { camoName, isCamoId } from '../../game/camo';
import type { Difficulty } from '../../game/bot';
import {
  isMissionUnlocked,
  isUnlocked,
  levelFromXp,
  levelRankUpgrade,
  rankNameFor,
} from '../../game/progression';
import { PRIMARY_IDS, WEAPON_DEFS } from '../../game/weapons';
import type { MatchProgress, ScreenMount, Ui2Host } from '../types';

// ── 純関数(テスト対象) ────────────────────────────────────────────────────

// 「CH1-2」形式のミッション符号
export function missionCode(m: Pick<MissionDef, 'chapterId' | 'index'>): string {
  return `${m.chapterId.toUpperCase()}-${m.index + 1}`;
}

// PAR秒 → 「m:ss」
export function fmtPar(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.round(s - m * 60));
  return `${m}:${String(r).padStart(2, '0')}`;
}

// 戦役合計(旧menu.ts campaignTotalsの複製 — 章増減に自動追従)
export function campaignTotals(campaign: readonly { missions: readonly unknown[] }[]): {
  missions: number;
  starsMax: number;
} {
  const missions = campaign.reduce((sum, c) => sum + c.missions.length, 0);
  return { missions, starsMax: missions * 3 };
}

// 報酬id → 表示名(未知idはnull=非表示。旧menu.tsの複製)
export function missionRewardLabel(rewardId: string | undefined): string | null {
  if (!rewardId || !isCamoId(rewardId)) return null;
  return camoName(rewardId);
}

// 星3つ分の on/off 配列
export function starRow(stars: number): boolean[] {
  return [0, 1, 2].map((i) => i < stars);
}

// 出演者(無線劇)の重複除去
export function radioCast(radio: readonly { speaker: RadioSpeaker }[] | undefined): RadioSpeaker[] {
  const seen: RadioSpeaker[] = [];
  for (const line of radio ?? []) {
    if (!seen.includes(line.speaker)) seen.push(line.speaker);
  }
  return seen;
}

const DIFFICULTIES: Array<{ id: Difficulty; label: string }> = [
  { id: 'easy', label: '新兵' },
  { id: 'normal', label: '兵士' },
  { id: 'hard', label: '精鋭' },
];

const MOD_LABELS: Record<string, string> = {
  'one-life': '一機限り',
  'low-gravity': '低重力',
  'no-regen': '自然回復なし',
  'dense-fog': '濃霧',
  'elite-swarm': '精鋭過多',
};

// 無線劇話者(識別色は試合内無線と同一 — src/ui/hud.ts RADIO_SPEAKER_COLORS と同値を保つ)
export const SPEAKERS: Record<RadioSpeaker, { name: string; color: string }> = {
  kagerou: { name: '司令・カゲロウ', color: '#9fb8c9' },
  homura: { name: 'ホムラ', color: '#19e6ff' },
  hibana: { name: 'ヒバナ', color: '#ff817b' },
  kurogane: { name: 'クロガネ', color: '#b07cff' },
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 0→目標値のカウントアップ(旧menu.ts countUpの複製。要素が外れたら止まる)
function countUp(host: Ui2Host, el: HTMLElement, to: number, durationMs = 750): void {
  if (host.reducedMotion() || to <= 0) {
    el.textContent = to.toLocaleString('en-US');
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - start) / durationMs);
    el.textContent = Math.round(easeOutCubic(p) * to).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function starsHtml(stars: number, big: boolean): string {
  const cells = starRow(stars)
    .map((on, i) => `<span class="u2c-star${on ? ' on' : ''}" style="--i:${i}"></span>`)
    .join('');
  return `<span class="${big ? 'u2c-stars-big' : 'u2c-stars'}" role="img" aria-label="評価 ${stars} / 3">${cells}</span>`;
}

// 下帯(mock03逐語)。Bキー側のボタンが data-id="back-to-hub" 契約
function hintbarHtml(note: string, backLabel: string): string {
  return `
    <div class="u2c-hintbar">
      <div class="u2c-hints">
        <span><span class="u2c-key accent">A</span> 選択</span>
        <button type="button" data-id="back-to-hub"><span class="u2c-key">B</span> ${esc(backLabel)}</button>
      </div>
      <span class="u2c-hint-note">${esc(note)}</span>
      <div class="u2c-hints"><span>OPERATION <span style="color:#b08a66">//</span> CINDER</span></div>
    </div>`;
}

function backdropHtml(): string {
  return `
    <div class="u2c-fog" aria-hidden="true"></div>
    <div class="u2c-scanline" aria-hidden="true"></div>
    <div class="u2c-vignette" aria-hidden="true"></div>`;
}

// ── 戦役(章・ミッション一覧) ──────────────────────────────────────────────
export const mountCampaign: ScreenMount = (host, root) => {
  root.classList.add('u2-campaign');
  const camp = host.profile.campaign;
  const totalStars = Object.values(camp.missionBests).reduce((s, b) => s + b.stars, 0);
  const cleared = camp.clearedMissions.length;
  const { missions: totalMissions, starsMax } = campaignTotals(CAMPAIGN);

  // 次の任務 = 解放済みの最初の未制圧ミッション
  let nextMission: MissionDef | null = null;
  for (const ch of CAMPAIGN) {
    for (const m of ch.missions) {
      if (!camp.clearedMissions.includes(m.id) && isMissionUnlocked(host.profile, m.id)) {
        nextMission = m;
        break;
      }
    }
    if (nextMission) break;
  }

  const chaptersHtml = CAMPAIGN.map((chapter, ci) => {
    const unlocked = camp.unlockedChapters.includes(chapter.id);
    const chClear = chapter.missions.filter((m) => camp.clearedMissions.includes(m.id)).length;
    const rows = unlocked
      ? chapter.missions
          .map((mission) => {
            const mUnlocked = isMissionUnlocked(host.profile, mission.id);
            const best = camp.missionBests[mission.id];
            const stars = best ? best.stars : 0;
            const reward = missionRewardLabel(mission.rewardId);
            const tail = mUnlocked
              ? `${reward ? `<span class="u2c-mission-reward">特別報酬 ${esc(reward)}</span>` : ''}${starsHtml(stars, false)}`
              : '<span class="u2c-mission-lock">LOCKED</span>';
            return `
              <button type="button" class="u2c-mission" data-mission="${esc(mission.id)}" ${mUnlocked ? '' : 'disabled'}>
                <span class="u2c-mission-code">${missionCode(mission)}</span>
                <span class="u2c-mission-name">${esc(mission.title)}<small>${esc(mission.subtitle)}</small></span>
                ${tail}
              </button>`;
          })
          .join('')
      : '';
    return `
      <section class="u2c-chapter${unlocked ? '' : ' locked'}" style="--i:${ci}">
        <div class="u2c-chapter-head">
          <span class="u2c-chapter-no">${esc(chapter.id.toUpperCase())}</span>
          <span class="u2c-chapter-title">${esc(chapter.title)}</span>
          <span class="u2c-chapter-sub">${unlocked ? esc(chapter.subtitle) : '機密 — 前章の制圧で解放'}</span>
          <span class="u2c-chapter-prog"><b>${chClear}</b>/${chapter.missions.length}
            <span class="u2c-growbar"><i style="transform:scaleX(${(chClear / Math.max(1, chapter.missions.length)).toFixed(3)})"></i></span>
          </span>
        </div>
        ${unlocked ? `<div class="u2c-missions">${rows}</div>` : ''}
      </section>`;
  }).join('');

  const railHtml = `
    <div class="u2c-rail">
      ${
        nextMission
          ? `
        <div class="u2c-plate">
          <span class="u2c-plate-kicker">次の任務\u3000NEXT SORTIE</span>
          <span class="u2c-next-name">${esc(nextMission.title)}</span>
          <span class="u2c-next-sub">${missionCode(nextMission)}\u3000·\u3000${esc(nextMission.subtitle)}\u3000·\u3000規定 ${fmtPar(nextMission.parTimeS)}</span>
          <button type="button" class="u2c-cta" data-id="next-briefing">ブリーフィングへ<span class="u2c-spur"></span><span class="u2c-shine"></span></button>
        </div>`
          : `
        <div class="u2c-plate">
          <span class="u2c-plate-kicker">戦役完遂\u3000ALL CLEAR</span>
          <p>全ミッションを制圧済み。★の取りこぼしを狩りに行こう。</p>
        </div>`
      }
      <div class="u2c-plate">
        <span class="u2c-plate-kicker">作戦概要\u3000OPERATION</span>
        <p>${esc(CAMPAIGN[0]?.lore ?? '')}</p>
      </div>
    </div>`;

  root.innerHTML = `
    ${backdropHtml()}
    <div class="u2c-head">
      <span class="u2c-kicker">戦役\u3000/\u3000OPERATION CINDER</span>
      <span class="u2c-title">軌道に灯る火種</span>
      <div class="u2c-rule"></div>
      <div class="u2c-progressline">制圧 <b>${cleared}</b>/${totalMissions}\u3000·\u3000★ <b>${totalStars}</b>/${starsMax}
        <span class="u2c-growbar"><i style="transform:scaleX(${(cleared / Math.max(1, totalMissions)).toFixed(3)})"></i></span>
      </div>
    </div>
    <div class="u2c-chapters" data-id="chapter-list">${chaptersHtml}</div>
    ${railHtml}
    ${hintbarHtml(`CINDER 鎮圧作戦 · 制圧率 ${Math.round((cleared / Math.max(1, totalMissions)) * 100)}%`, '戻る')}
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = missionById(btn.dataset.mission ?? '');
      if (m) host.open('briefing', { mission: m });
    });
  });
  root
    .querySelector<HTMLButtonElement>('[data-id="next-briefing"]')
    ?.addEventListener('click', () => {
      if (nextMission) host.open('briefing', { mission: nextMission });
    });
  root
    .querySelector<HTMLButtonElement>('[data-id="back-to-hub"]')
    ?.addEventListener('click', () => host.back());

  return {
    dispose: () => {
      root.classList.remove('u2-campaign');
      root.innerHTML = '';
    },
  };
};

// ── ブリーフィング ────────────────────────────────────────────────────────
export const mountBriefing: ScreenMount = (host, root, opts) => {
  const mission = opts?.mission;
  if (!mission) {
    // 契約違反ペイロードは戦役へ退避(ハングさせない)
    host.open('campaign');
    return { dispose: () => undefined };
  }
  root.classList.add('u2-campaign');

  const mods = mission.modifiers.map((m) => MOD_LABELS[m] ?? m).join(' / ') || 'なし';
  const briefLines = mission.brief.map((b, i) => `<p style="--i:${i}">${esc(b)}</p>`).join('');
  const intel = mission.intel?.length
    ? `<div class="u2c-intel"><h3>インテル\u3000INTEL</h3>${mission.intel.map((i) => `<p>${esc(i)}</p>`).join('')}</div>`
    : '';
  const cast = radioCast(mission.radio);
  const castHtml = cast.length
    ? `<div class="u2c-cast"><span class="u2c-plate-kicker" style="margin:0">無線劇\u3000${mission.radio?.length ?? 0}本</span>${cast
        .map(
          (s) =>
            `<span><i style="background:${SPEAKERS[s].color}"></i>${esc(SPEAKERS[s].name)}</span>`,
        )
        .join('')}</div>`
    : '';
  const reward = missionRewardLabel(mission.rewardId);

  root.innerHTML = `
    ${backdropHtml()}
    <div class="u2c-head">
      <span class="u2c-kicker">${missionCode(mission)}\u3000/\u3000出撃命令\u3000SORTIE ORDER</span>
      <span class="u2c-title">${esc(mission.title)}</span>
      <div class="u2c-rule"></div>
      <div class="u2c-progressline">${esc(mission.subtitle)}</div>
    </div>
    <div class="u2c-brief-body">
      ${briefLines}
      ${intel}
      ${castHtml}
    </div>
    <dl class="u2c-meta">
      <div class="u2c-meta-row"><dt>目的</dt><dd>${esc(mission.objective.label)}</dd></div>
      <div class="u2c-meta-row"><dt>武器</dt><dd style="flex:1"><select class="u2c-select" data-id="brief-weapon-select" aria-label="出撃武器の選択"></select></dd></div>
      <div class="u2c-meta-row"><dt>難易度</dt><dd style="display:flex;gap:8px" data-id="brief-mission-diff"></dd></div>
      <div class="u2c-meta-row"><dt>特殊条件</dt><dd>${esc(mods)}</dd></div>
      <div class="u2c-meta-row"><dt>規定時間</dt><dd class="num">${fmtPar(mission.parTimeS)}</dd></div>
      ${mission.challenge ? `<div class="u2c-meta-row"><dt>挑戦</dt><dd>${esc(mission.challenge.label)}</dd></div>` : ''}
      ${reward ? `<div class="u2c-meta-row"><dt>報酬</dt><dd style="color:#f5d06b">クリアで解放: ${esc(reward)}</dd></div>` : ''}
    </dl>
    <div class="u2c-brief-actions">
      <button type="button" class="u2c-quiet" data-id="brief-back">戦役へ戻る</button>
      <button type="button" class="u2c-cta" data-id="deploy-mission">出撃する<span class="u2c-spur"></span><span class="u2c-shine"></span></button>
    </div>
    ${hintbarHtml(`規定 ${fmtPar(mission.parTimeS)} · ${mission.objective.label}`, '戦役へ')}
  `;

  // 武器は自由選択(既定=支給武器)。解放済みの主武器から選べる(旧showBriefingと同一)
  const weaponSelect = root.querySelector<HTMLSelectElement>('[data-id="brief-weapon-select"]');
  if (weaponSelect) {
    const level = levelFromXp(host.profile.xp).level;
    const supplied = document.createElement('option');
    supplied.value = mission.primaryId;
    supplied.textContent = `${WEAPON_DEFS[mission.primaryId]?.name ?? mission.primaryId}(支給)`;
    weaponSelect.appendChild(supplied);
    for (const id of PRIMARY_IDS) {
      if (id === mission.primaryId || !isUnlocked('weapon', id, level)) continue;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = WEAPON_DEFS[id]?.name ?? id;
      weaponSelect.appendChild(opt);
    }
  }

  // ミッション難易度チップ(選択は loadout.missionDifficulty へ即保存 — 旧実装と同一の永続化)
  const diffHost = root.querySelector<HTMLElement>('[data-id="brief-mission-diff"]');
  const renderDiff = (): void => {
    if (!diffHost) return;
    const cur = host.loadout.missionDifficulty ?? 'normal';
    diffHost.innerHTML = DIFFICULTIES.map(
      (d) =>
        `<button type="button" class="u2c-chip${d.id === cur ? ' selected' : ''}" data-diff="${d.id}" aria-pressed="${d.id === cur}">${d.label}</button>`,
    ).join('');
    diffHost.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        host.loadout.missionDifficulty = btn.dataset.diff as Difficulty;
        host.saveLoadout();
        renderDiff();
      });
    });
  };
  renderDiff();

  root
    .querySelector<HTMLButtonElement>('[data-id="deploy-mission"]')
    ?.addEventListener('click', () => {
      host.callbacks.onStartMission(
        mission.id,
        weaponSelect?.value,
        host.loadout.missionDifficulty,
      );
    });
  const toCampaign = (): void => host.open('campaign');
  root
    .querySelector<HTMLButtonElement>('[data-id="brief-back"]')
    ?.addEventListener('click', toCampaign);
  root
    .querySelector<HTMLButtonElement>('[data-id="back-to-hub"]')
    ?.addEventListener('click', toCampaign);
  root
    .querySelector<HTMLButtonElement>('[data-id="deploy-mission"]')
    ?.focus({ preventScroll: true });

  return {
    dispose: () => {
      root.classList.remove('u2-campaign');
      root.innerHTML = '';
    },
  };
};

// ── 戦役リザルト ─────────────────────────────────────────────────────────
// 進行(XP/レベル/解放)節 — 旧menu.ts progressHtmlの移植(mock06右列の言語で再構成)
function progressCardHtml(host: Ui2Host, progress: MatchProgress): string {
  const xpRows = progress.xpBreakdown
    .map((entry, i) => {
      const daily = entry.label.startsWith('デイリー達成！');
      return `<li${daily ? ' class="daily"' : ''} style="--i:${i}"><span>${esc(entry.label)}</span><span class="xp">+${entry.xp}</span></li>`;
    })
    .join('');
  const level = progress.levelAfter;
  const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
  const rankUp = levelRankUpgrade(progress.levelBefore, progress.levelAfter);
  const levelUp =
    level.level > progress.levelBefore.level
      ? `<p class="u2c-progress-note up">レベルアップ LV.${progress.levelBefore.level} → LV.${level.level}${rankUp ? ` / ${esc(rankUp.name)} へ昇位` : ''}</p>`
      : rankUp
        ? `<p class="u2c-progress-note up">${esc(rankUp.name)} へ昇位</p>`
        : '';
  const unlockRows = progress.newUnlocks
    .map((u) => `<li>${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${esc(u.name)}</li>`)
    .join('');
  const camoRows = progress.newCamos.map((c) => `<li>カモ解除: ${esc(c.label)}</li>`).join('');
  const unlocks =
    unlockRows || camoRows ? `<ul class="u2c-unlocks">${unlockRows}${camoRows}</ul>` : '';
  const records = progress.newRecords.length
    ? `<p class="u2c-progress-note rec">自己ベスト更新 ${esc(progress.newRecords.join(' / '))}</p>`
    : '';
  const delta = progress.ratingAfter - progress.ratingBefore;
  const rankNote =
    progress.rankAfter.name === progress.rankBefore.name
      ? `SR ${progress.ratingAfter}`
      : `SR ${progress.ratingAfter} / ${progress.rankAfter.name} へ${delta > 0 ? '昇格' : '降格'}`;
  const rating =
    delta === 0
      ? `<p class="u2c-progress-note">${esc(rankNote)}</p>`
      : `<p class="u2c-progress-note">SR ${progress.ratingBefore} <span style="color:${delta > 0 ? '#9fe39f' : '#d24545'}">${delta > 0 ? '+' : ''}${delta}</span> → ${esc(rankNote)}</p>`;
  const titles = host.profile.titles;
  const title = titles && titles.length > 0 ? titles[titles.length - 1] : null;
  return `
    <div class="u2c-xpcard">
      <div class="u2c-xpcard-head"><span class="k">経験\u3000EXPERIENCE</span><span class="v">+${progress.xpTotal.toLocaleString('en-US')} XP</span></div>
      <ul class="u2c-xplist">${xpRows}</ul>
      <p class="u2c-xptotal">獲得<b data-id="xptotal">0</b>XP</p>
      <div class="u2c-levelrow">
        <span class="lv">LV.${level.level} ${esc(rankNameFor(level.level).name)}</span>
        ${title ? `<span class="u2c-title-badge">${esc(title)}</span>` : ''}
        <span class="u2c-xpbar"><i style="width:${xpRatio.toFixed(1)}%"></i></span>
      </div>
      ${levelUp}${unlocks}${records}${rating}
    </div>`;
}

export const mountMissionResult: ScreenMount = (host, root, opts) => {
  const result = opts?.result;
  const progress = opts?.campaignProgress;
  if (!result || !progress) {
    host.open('campaign');
    return { dispose: () => undefined };
  }
  root.classList.add('u2-campaign');
  const mission = missionById(progress.missionId);
  const won = result.won;
  const stars = progress.stars;

  const unlockNote = progress.chapterUnlocked
    ? `<p class="u2c-note unlock">新章解放: ${esc(CAMPAIGN.find((c) => c.id === progress.chapterUnlocked)?.title ?? '')}</p>`
    : '';
  const firstNote = progress.firstClear
    ? '<p class="u2c-note first">初制圧ボーナス +800 XP</p>'
    : '';
  const challengeNote =
    won && mission?.challenge
      ? `<p class="u2c-note challenge">${progress.challengeMet ? '挑戦達成！' : '挑戦未達'}\u3000${esc(mission.challenge.label)}</p>`
      : '';
  const nextId = mission && won ? nextMissionId(mission.id) : null;
  const nextUnlocked = nextId ? isMissionUnlocked(host.profile, nextId) : false;

  const statCards = `
    <div class="u2c-statcards">
      <div class="u2c-statcard${won ? ' ember' : ''}">
        <span class="label">記録</span>
        <span class="value">${Math.floor(progress.missionBest?.bestTimeS ?? 0)}s</span>
        <span class="sub">BEST TIME · 規定 ${mission ? fmtPar(mission.parTimeS) : '—'}</span>
      </div>
      <div class="u2c-statcard">
        <span class="label">命中率</span>
        <span class="value">${(result.accuracy * 100).toFixed(1)}<span style="font-size:16px">%</span></span>
        <span class="sub">ACCURACY</span>
      </div>
      <div class="u2c-statcard">
        <span class="label">頭部撃破</span>
        <span class="value">${result.headshots}</span>
        <span class="sub">HEADSHOTS</span>
      </div>
    </div>`;

  root.innerHTML = `
    ${backdropHtml()}
    <div class="u2c-band">
      <div class="u2c-band-left"><span class="u2c-dash"></span><span class="u2c-band-kicker">戦役詳報\u3000MISSION REPORT</span></div>
      <span class="u2c-band-meta">${mission ? `${missionCode(mission)} · ${esc(mission.title)} · 規定 ${fmtPar(mission.parTimeS)}` : 'MISSION'}</span>
    </div>
    <div class="u2c-band-rule"></div>
    <div class="u2c-mr-left">
      <span class="u2c-ritual${won ? '' : ' lost'}">${won ? '作戦完遂' : '作戦失敗'}</span>
      <p class="u2c-mr-mission"><b>${esc(mission?.title ?? 'ミッション')}</b>${esc(mission?.subtitle ?? '')}</p>
      ${won ? starsHtml(stars, true) : ''}
      ${unlockNote}${firstNote}${challengeNote}
      ${statCards}
      <div class="u2c-mr-actions">
        ${nextId && nextUnlocked ? '<button type="button" class="u2c-cta" data-id="next-mission">次のミッション<span class="u2c-spur"></span><span class="u2c-shine"></span></button>' : ''}
        <button type="button" class="u2c-quiet" data-id="retry-mission">もう一度</button>
        <button type="button" class="u2c-quiet" data-id="to-campaign">戦役へ戻る</button>
      </div>
    </div>
    <div class="u2c-mr-rail">${progressCardHtml(host, progress)}</div>
    ${hintbarHtml(won ? `評価 ★${stars}/3` : '再挑戦で雪辱を', '戦役へ')}
  `;

  const xptotal = root.querySelector<HTMLElement>('[data-id="xptotal"]');
  if (xptotal) countUp(host, xptotal, progress.xpTotal);

  if (nextId && nextUnlocked) {
    root
      .querySelector<HTMLButtonElement>('[data-id="next-mission"]')
      ?.addEventListener('click', () =>
        // ブリーフィングを経由しない直行導線でも、選択中のミッション難易度を引き継ぐ(旧実装と同一)
        host.callbacks.onStartMission(nextId, undefined, host.loadout.missionDifficulty),
      );
  }
  root
    .querySelector<HTMLButtonElement>('[data-id="retry-mission"]')
    ?.addEventListener('click', () => host.callbacks.onRestart());
  const quitToCampaign = (): void => {
    // onQuit経由でmatch破棄+音の後始末(quiesce)を必ず通す(旧実装の教訓)
    host.callbacks.onQuit();
    host.open('campaign');
  };
  root
    .querySelector<HTMLButtonElement>('[data-id="to-campaign"]')
    ?.addEventListener('click', quitToCampaign);
  root
    .querySelector<HTMLButtonElement>('[data-id="back-to-hub"]')
    ?.addEventListener('click', quitToCampaign);
  root
    .querySelector<HTMLButtonElement>(
      `[data-id="${nextId && nextUnlocked ? 'next-mission' : 'to-campaign'}"]`,
    )
    ?.focus({ preventScroll: true });

  return {
    dispose: () => {
      root.classList.remove('u2-campaign');
      root.innerHTML = '';
    },
  };
};
