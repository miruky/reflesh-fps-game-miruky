// W-ENZA2 トップメニューhub(F1所有) — mock02の1:1移植。
// 正典: scratchpad/ui2-refs/mock-02-doc.html + トップメニュー.png。
// モックの宇宙/地球はbase64 PNGだったため(scratchpad/hub-stars.png・hub-earth.png)、
// アセットレス鉄則に従い同構図をシード固定LCGの決定論的インラインSVGで再現している。
// 架空値(稼働ロビー214/PING 8ms/BETA等)は排し、全て実データをバインドする。
import '../hub.css';
import { CAMPAIGN } from '../../game/campaign';
import { dailiesFor, dateStringFromSeed, refreshDailiesDate, todayDateSeed } from '../../game/dailies';
import { MODE_IDS } from '../../game/modes';
import { levelFromXp, rankNameFor } from '../../game/progression';
import { STAGES } from '../../game/stages';
import { WEAPON_DEFS } from '../../game/weapons';
import { BUILD_LABEL } from '../../version';
import type { Profile } from '../types';
import type { ScreenMount } from '../types';

const MONO = "font-family:ui-monospace,'SF Mono','Cascadia Mono',Consolas,monospace;";
const COND = "font-family:'Bahnschrift','Arial Narrow','Avenir Next Condensed',Arial,sans-serif;";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// ── 実データのナビ副文(純関数=テスト対象) ─────────────────
export function hubSublines(profile: Profile): {
  sortie: string;
  armory: string;
  stages: string;
  campaign: string;
  campaignRatio: { cleared: number; total: number };
  zombie: string;
  zombieBest: string;
} {
  const pvp = MODE_IDS.filter((m) => m !== 'zombie' && m !== 'training').length;
  const weapons = Object.keys(WEAPON_DEFS).length;
  const exotics = Object.values(WEAPON_DEFS).filter((d) => d.class === 'exotic').length;
  const sizes = STAGES.map((s) => s.size);
  const total = CAMPAIGN.reduce((a, c) => a + c.missions.length, 0);
  const cleared = Math.min(total, profile.campaign.clearedMissions.length);
  const stageNames = STAGES.slice(0, 3)
    .map((s) => s.name)
    .join(' / ');
  return {
    sortie: `クイックマッチ · 対戦${pvp}モード · ローカルBot戦`,
    armory: `武器${weapons}種 · カモ · 特殊兵装EXOTIC ${exotics}種`,
    stages: `全${STAGES.length}面 · ${stageNames} · ${Math.min(...sizes)}–${Math.max(...sizes)}m`,
    campaign: `CINDER討伐編+帝王編 · ${total}任務`,
    campaignRatio: { cleared, total },
    zombie: '鍛神台 · ミステリーボックス · 無限ラウンド R999',
    zombieBest: `最高 R${profile.bestZombieRound ?? 0}`,
  };
}

// ── 深宇宙(hub-stars.png の決定論的再現) ─────────────────
function starsSvg(): string {
  const rnd = lcg(0xe0a2);
  const stars: string[] = [];
  const palette = ['#EDF2FA', '#DDE5F2', '#F3E6D8', '#FFB98A'];
  for (let i = 0; i < 430; i++) {
    const x = (rnd() * 1920).toFixed(1);
    const y = (rnd() * 1080).toFixed(1);
    const r = (0.4 + rnd() * 1.2).toFixed(2);
    const c = palette[Math.floor(rnd() * palette.length) * 1] ?? '#EDF2FA';
    const o = (0.25 + rnd() * 0.65).toFixed(2);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`);
  }
  // 星団3つ(正典: 左上/中央下/右)
  const clusters: Array<[number, number]> = [
    [575, 240],
    [1060, 715],
    [1690, 590],
  ];
  for (const [cx, cy] of clusters) {
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * rnd() * 46;
      stars.push(
        `<circle cx="${(cx + Math.cos(a) * d * 1.3).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}" r="${(0.4 + rnd() * 0.9).toFixed(2)}" fill="#EDF2FA" opacity="${(0.3 + rnd() * 0.6).toFixed(2)}"/>`,
      );
    }
    stars.push(
      `<circle cx="${cx}" cy="${cy}" r="26" fill="#C9D2E4" opacity="0.06"/><circle cx="${cx}" cy="${cy}" r="13" fill="#DDE5F2" opacity="0.08"/>`,
    );
  }
  // 十字フレア星(正典の2つ+追加3つ=計5、amber/white混在)
  const crosses: Array<[number, number, number, string]> = [
    [412, 163, 1.0, '#FFFFFF'],
    [732, 391, 0.75, '#FFF4E8'],
    [944, 305, 1.15, '#F5D8A8'],
    [1128, 830, 0.9, '#FFF4E8'],
    [458, 872, 0.7, '#EDF2FA'],
  ];
  const crossSvg = crosses
    .map(([x, y, k, c], i) => {
      const v = 26 * k;
      const w = 1.5 * k;
      return `<g style="animation:enzaTwinkle2 ${5 + i}s ease-in-out infinite ${i * 0.9}s;">
      <rect x="${x - w / 2}" y="${y - v / 2}" width="${w}" height="${v}" fill="${c}" opacity="0.9"/>
      <rect x="${x - v / 2}" y="${y - w / 2}" width="${v}" height="${w}" fill="${c}" opacity="0.9"/>
      <circle cx="${x}" cy="${y}" r="${2.2 * k}" fill="${c}"/></g>`;
    })
    .join('');
  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;inset:0;" aria-hidden="true">
    <defs>
      <pattern id="u2h-st" width="390" height="390" patternUnits="userSpaceOnUse">
        <circle cx="50" cy="75" r="1.4" fill="#EDF2FA" opacity="0.85"/>
        <circle cx="250" cy="33" r="1.1" fill="#DDE5F2" opacity="0.7"/>
        <circle cx="341" cy="200" r="1.5" fill="#F3E6D8" opacity="0.8"/>
        <circle cx="141" cy="274" r="1.2" fill="#EDF2FA" opacity="0.65"/>
        <circle cx="274" cy="357" r="1.0" fill="#FFB98A" opacity="0.6"/>
      </pattern>
    </defs>
    <rect width="1920" height="1080" fill="url(#u2h-st)" style="animation:enzaTwinkle 8s ease-in-out infinite;"/>
    ${stars.join('')}
    ${crossSvg}
    <ellipse cx="1520" cy="1500" rx="1240" ry="1180" fill="none" stroke="rgba(143,181,255,0.10)" stroke-width="1" stroke-dasharray="3 9"/>
    <ellipse cx="1560" cy="1560" rx="1420" ry="1350" fill="none" stroke="rgba(143,181,255,0.06)" stroke-width="1"/>
  </svg>`;
}

// ── 地球(hub-earth.png の決定論的再現。520,420に1400×660で配置) ──
function earthSvg(): string {
  const rnd = lcg(0x7e42);
  const LIMB = 'M -20 760 C 340 470, 900 240, 1430 8';
  const SPHERE = `${LIMB} L 1430 760 Z`;
  // 雲: 緯度(リム接線)に沿う白ストリーク。浅い層に密集
  const bez = (t: number): { x: number; y: number; ang: number } => {
    const p = [
      [-20, 760],
      [340, 470],
      [900, 240],
      [1430, 8],
    ] as const;
    const u = 1 - t;
    const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
    const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
    const dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
    const dy = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
    return { x, y, ang: (Math.atan2(dy, dx) * 180) / Math.PI };
  };
  const clouds: string[] = [];
  for (let i = 0; i < 96; i++) {
    const t = 0.06 + rnd() * 0.9;
    const depth = 16 + 330 * rnd() * rnd();
    const b = bez(t);
    const rx = 26 + rnd() * 120;
    const ry = 3.5 + rnd() * 8;
    const o = 0.16 + rnd() * 0.5;
    clouds.push(
      `<ellipse cx="${b.x.toFixed(1)}" cy="${(b.y + depth).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${b.ang.toFixed(1)} ${b.x.toFixed(1)} ${(b.y + depth).toFixed(1)})" fill="${rnd() > 0.5 ? '#FFFFFF' : '#EDF4FF'}" opacity="${o.toFixed(2)}"/>`,
    );
  }
  // 大陸: オリーブ色のブロブ群
  const lands: string[] = [];
  for (let g = 0; g < 12; g++) {
    const t = 0.1 + rnd() * 0.84;
    const depth = 46 + 300 * rnd();
    const b = bez(t);
    const cx = b.x + (rnd() - 0.5) * 60;
    const cy = b.y + depth;
    const parts: string[] = [];
    const n = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const ex = cx + (rnd() - 0.5) * 90;
      const ey = cy + (rnd() - 0.5) * 46;
      parts.push(
        `<ellipse cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" rx="${(9 + rnd() * 34).toFixed(1)}" ry="${(6 + rnd() * 18).toFixed(1)}" transform="rotate(${(rnd() * 80 - 40).toFixed(0)} ${ex.toFixed(1)} ${ey.toFixed(1)})"/>`,
      );
    }
    lands.push(
      `<g fill="${rnd() > 0.5 ? '#6E7A40' : '#7E7C4A'}" opacity="0.85">${parts.join('')}</g>`,
    );
  }
  return `<svg width="1400" height="660" viewBox="0 0 1400 660" style="position:absolute;left:520px;top:420px;" aria-hidden="true">
    <defs>
      <radialGradient id="u2h-ocean" cx="72%" cy="18%" r="115%">
        <stop offset="0%" stop-color="#3B74D8"/>
        <stop offset="34%" stop-color="#2B63C8"/>
        <stop offset="62%" stop-color="#1E4FA8"/>
        <stop offset="100%" stop-color="#122C63"/>
      </radialGradient>
      <radialGradient id="u2h-sun" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FFE0B0"/>
        <stop offset="42%" stop-color="#F5A55C"/>
        <stop offset="78%" stop-color="#E88A3C"/>
        <stop offset="100%" stop-color="rgba(232,138,60,0)"/>
      </radialGradient>
      <radialGradient id="u2h-flarecore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FFF6E4"/>
        <stop offset="55%" stop-color="rgba(255,214,150,0.55)"/>
        <stop offset="100%" stop-color="rgba(255,214,150,0)"/>
      </radialGradient>
      <linearGradient id="u2h-flare" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgba(255,220,170,0)"/>
        <stop offset="72%" stop-color="rgba(255,224,176,0.85)"/>
        <stop offset="100%" stop-color="rgba(255,238,208,0.95)"/>
      </linearGradient>
      <linearGradient id="u2h-warm" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="rgba(232,201,160,0)"/>
        <stop offset="45%" stop-color="rgba(236,195,150,0.85)"/>
        <stop offset="100%" stop-color="rgba(244,206,158,0.95)"/>
      </linearGradient>
      <clipPath id="u2h-sphere"><path d="${SPHERE}"/></clipPath>
      <filter id="u2h-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
      <filter id="u2h-soft2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
    </defs>
    <!-- 太陽(リムの陰から) -->
    <circle cx="1180" cy="52" r="108" fill="url(#u2h-sun)"/>
    <rect x="720" y="126" width="700" height="3" fill="url(#u2h-flare)"/>
    <circle cx="1208" cy="146" r="64" fill="url(#u2h-flarecore)"/>
    <!-- 球体 -->
    <path d="${SPHERE}" fill="url(#u2h-ocean)"/>
    <g clip-path="url(#u2h-sphere)">
      ${lands.join('')}
      ${clouds.join('')}
      <path d="${SPHERE}" fill="none"/>
      <rect x="-20" y="0" width="1450" height="760" fill="url(#u2h-ocean)" opacity="0"/>
    </g>
    <!-- 大気リム(青)+日昇帯(暖) -->
    <path d="${LIMB}" fill="none" stroke="rgba(134,173,239,0.95)" stroke-width="7" filter="url(#u2h-soft)"/>
    <path d="${LIMB}" fill="none" stroke="rgba(150,190,250,0.4)" stroke-width="22" filter="url(#u2h-soft2)"/>
    <path d="M 700 352 C 1010 205, 1240 105, 1430 8" fill="none" stroke="url(#u2h-warm)" stroke-width="11" filter="url(#u2h-soft)"/>
    <!-- 下側減光(球の暗部) -->
    <g clip-path="url(#u2h-sphere)"><rect x="-20" y="0" width="1450" height="760" fill="url(#u2h-shade)"/></g>
    <radialGradient id="u2h-shade" cx="20%" cy="95%" r="110%">
      <stop offset="0%" stop-color="rgba(6,14,38,0.78)"/>
      <stop offset="45%" stop-color="rgba(6,14,38,0.32)"/>
      <stop offset="100%" stop-color="rgba(6,14,38,0)"/>
    </radialGradient>
  </svg>`;
}

export const mountHub: ScreenMount = (host, root) => {
  root.setAttribute('data-id', 'hub-root');
  if (host.reducedMotion()) root.classList.add('u2h-reduce');
  const p = host.profile;
  const lv = levelFromXp(p.xp);
  const rank = rankNameFor(lv.level).name;
  const xpPct = Math.max(0, Math.min(100, Math.round((lv.intoLevel / Math.max(1, lv.intoLevel + lv.toNext)) * 100)));
  const sub = hubSublines(p);
  // 旧menu.tsのrankStampChar/latestTitle互換(単純関数のためローカル再実装)
  const stamp = [...rank][0] ?? '兵';
  const title = p.titles && p.titles.length > 0 ? (p.titles[p.titles.length - 1] ?? null) : null;
  const camp = sub.campaignRatio;
  const campPct = camp.total > 0 ? Math.round((camp.cleared / camp.total) * 100) : 0;

  // 作戦継続カード: 次の未制圧ミッション(実データ)
  const clearedSet = new Set(p.campaign.clearedMissions);
  let nextMission: { id: string; name: string; chapter: string; index: number } | null = null;
  let missionIndex = 0;
  outer: for (const ch of CAMPAIGN) {
    for (const m of ch.missions) {
      missionIndex += 1;
      if (!clearedSet.has(m.id)) {
        nextMission = { id: m.id, name: m.title, chapter: ch.title, index: missionIndex };
        break outer;
      }
    }
  }

  // 本日の試練(実データ: dailiesFor+profile.daily)
  const dailySeed = todayDateSeed();
  const dailyDefs = dailiesFor(dailySeed);
  // 台帳§4-1: 描画前の日跨ぎリフレッシュ必須(昨日の進捗が今日の課題へ合成されるのを防ぐ)
  refreshDailiesDate(p.daily, dateStringFromSeed(dailySeed));
  const dailyProg = p.daily.progress;
  let dailyIdx = dailyDefs.findIndex((d, i) => (dailyProg[i] ?? 0) < d.target);
  if (dailyIdx < 0) dailyIdx = 2;
  const daily = dailyDefs[dailyIdx];
  const dailyDone = Math.min(dailyProg[dailyIdx] ?? 0, daily?.target ?? 0);

  // INTELティッカー(全て実データ)
  const streakNow = p.records.currentWinStreak >= 2 ? ` · 現在${p.records.currentWinStreak}連勝中` : '';
  const ticker = [
    `1試合最多キル ${p.records.mostKills} · 最高連勝 ${p.records.bestWinStreak}${streakNow}`,
    `生涯撃破 ${fmtInt(p.stats.kills)} · 戦役制圧 ${camp.cleared}/${camp.total}`,
    `ゾンビ最高到達 R${p.bestZombieRound ?? 0} · メダル図鑑 ${p.unlockedMedals.length}種`,
  ];
  const tickerHtml = [...ticker, ...ticker]
    .map((t) => `<span style="font-size:12.5px;color:#A79F90;">${t}</span>`)
    .join('');

  root.innerHTML = `
  <div style="position:absolute;inset:0;background:radial-gradient(130% 100% at 74% 8%, #151129 0%, #0D0B1D 30%, #070610 55%, #030308 80%, #020207 100%);"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(60% 50% at 82% 18%, rgba(83,68,140,0.20) 0%, rgba(83,68,140,0) 70%);"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(46% 40% at 12% 78%, rgba(140,70,52,0.10) 0%, rgba(140,70,52,0) 70%);"></div>
  ${starsSvg()}
  <svg width="560" height="560" viewBox="0 0 560 560" style="position:absolute;left:920px;top:30px;animation:enzaOrbit 180s linear infinite;" aria-hidden="true">
    <circle cx="280" cy="280" r="262" fill="none" stroke="rgba(255,150,80,0.05)" stroke-width="1"/>
    <circle cx="280" cy="280" r="262" fill="none" stroke="rgba(255,150,80,0.07)" stroke-width="10" stroke-dasharray="2 42"/>
    <circle cx="280" cy="280" r="216" fill="none" stroke="rgba(232,227,216,0.05)" stroke-width="1" stroke-dasharray="120 34"/>
    <rect x="118" y="118" width="324" height="324" fill="none" stroke="rgba(255,150,80,0.06)" stroke-width="1" transform="rotate(45 280 280)"/>
    <circle cx="280" cy="280" r="130" fill="none" stroke="rgba(255,150,80,0.05)" stroke-width="1"/>
  </svg>
  <div style="position:absolute;left:1490px;top:120px;width:170px;height:2px;background:linear-gradient(90deg, rgba(237,242,250,0) 0%, rgba(237,242,250,0.9) 85%, #FFFFFF 100%);animation:enzaShoot 11s ease-out infinite;"></div>
  ${earthSvg()}
  <div style="position:absolute;left:1622px;top:488px;width:220px;height:130px;background:radial-gradient(50% 50% at 50% 55%, rgba(255,170,90,0.30) 0%, rgba(255,130,60,0.10) 50%, rgba(255,130,60,0) 78%);animation:enzaPulse 7s ease-in-out infinite;"></div>
  <div style="position:absolute;left:1722px;top:545px;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle, #FFF6E8 0%, #FFC98F 40%, rgba(255,150,80,0) 74%);animation:enzaTwinkle2 4s ease-in-out infinite;"></div>
  <div style="position:absolute;left:1424px;top:328px;display:flex;flex-direction:column;align-items:center;animation:enzaFloat 9s ease-in-out infinite;">
    <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" style="animation:enzaOrbit 40s linear infinite;">
      <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(255,150,80,0.4)" stroke-width="1" stroke-dasharray="4 7"/>
    </svg>
    <div style="position:absolute;top:15px;width:22px;height:22px;background:rgba(20,16,14,0.9);border:1.5px solid #FFB98A;transform:rotate(45deg);box-shadow:0 0 18px rgba(255,150,80,0.5);"></div>
  </div>
  <div style="position:absolute;left:1476px;top:328px;width:150px;height:1px;background:linear-gradient(90deg, rgba(255,185,138,0.7), rgba(255,185,138,0));"></div>
  <div style="position:absolute;left:1492px;top:306px;${MONO}font-size:11px;letter-spacing:0.18em;color:#C9A288;white-space:nowrap;">軌道拠点「焔座」<br><span style="color:#77705F;">高度 408km · 同期中</span></div>
  <div style="position:absolute;inset:0;background:radial-gradient(120% 100% at 50% 46%, rgba(0,0,0,0) 58%, rgba(2,2,7,0.42) 88%, rgba(2,2,7,0.72) 100%);pointer-events:none;"></div>
  <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 4px);pointer-events:none;"></div>
  <div style="position:absolute;left:56px;top:95px;width:1808px;height:1px;background:linear-gradient(90deg, rgba(255,107,43,0.55) 0%, rgba(232,227,216,0.16) 22%, rgba(232,227,216,0.16) 78%, rgba(124,84,220,0.4) 100%);"></div>

  <div style="position:absolute;left:56px;top:0;right:56px;height:95px;display:flex;align-items:center;justify-content:space-between;white-space:nowrap;">
    <div style="display:flex;align-items:center;gap:18px;">
      <svg width="50" height="50" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="25" fill="none" stroke="#FF6B2B" stroke-width="1.6"/>
        <circle cx="28" cy="28" r="25" fill="none" stroke="rgba(255,107,43,0.25)" stroke-width="5" stroke-dasharray="2 10"/>
        <rect x="18.5" y="18.5" width="19" height="19" fill="rgba(255,107,43,0.10)" stroke="#E8E3D8" stroke-width="1.1" transform="rotate(45 28 28)"/>
        <circle cx="28" cy="28" r="3.6" fill="#FF6B2B"/>
      </svg>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:baseline;gap:12px;">
          <span style="${COND}font-weight:800;font-size:31px;line-height:1;letter-spacing:0.02em;"><span style="color:#F4F6F8;">FPS-RE</span><span style="color:#FF6B2B;text-shadow:0 0 26px rgba(255,107,43,0.45);">FLESH</span></span>
          <span style="font-weight:800;font-size:13px;color:#FFB98A;letter-spacing:0.28em;border-left:1px solid rgba(255,107,43,0.5);padding-left:12px;">焔座</span>
        </div>
        <span style="${MONO}font-size:10px;letter-spacing:0.22em;color:#77705F;">ENZA INTERFACE 2.0 · BUILD ${BUILD_LABEL} · 60FPS</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:26px;">
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
        <span style="${MONO}font-size:12px;color:#A79F90;">ローカル実行 · <span style="color:#9FE39F;">安定 60Hz</span></span>
        <span data-id="hub-clock" style="${MONO}font-size:11px;color:#5E594F;"></span>
      </div>
      <div style="position:relative;display:flex;align-items:center;gap:16px;background:linear-gradient(180deg, rgba(22,20,18,0.94), rgba(11,10,9,0.96));border:1px solid rgba(232,227,216,0.18);box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 28px rgba(0,0,0,0.5);padding:10px 20px 10px 16px;">
        <svg width="44" height="44" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" fill="none" stroke="#FF6B2B" stroke-width="1.3"/>
          <rect x="15" y="15" width="22" height="22" fill="rgba(255,107,43,0.14)" stroke="#E8E3D8" stroke-width="1" transform="rotate(45 26 26)"/>
          <text x="26" y="31" text-anchor="middle" font-size="14" font-weight="800" fill="#FFD9BC">${stamp}</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;font-weight:800;color:#F5F0E6;">${rank}</span>
            ${title ? `<span style="font-weight:800;font-size:12px;color:#FFD9BC;background:linear-gradient(90deg, rgba(255,107,43,0.22), rgba(255,107,43,0.06));border:1px solid rgba(255,107,43,0.55);padding:2px 10px;letter-spacing:0.05em;">${title}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="${MONO}font-size:14px;color:#E8E3D8;">Lv <span style="color:#FFB98A;">${fmtInt(lv.level)}</span></span>
            <div style="position:relative;width:150px;height:5px;background:rgba(232,227,216,0.12);">
              <div style="width:${xpPct}%;height:5px;background:linear-gradient(90deg,#B23E14,#FF6B2B 70%,#FFA061);box-shadow:0 0 10px rgba(255,107,43,0.6);"></div>
              <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg, transparent 0 14px, rgba(4,4,8,0.9) 14px 15.5px);"></div>
            </div>
            <span style="${MONO}font-size:10px;color:#77705F;">${xpPct}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <nav style="position:absolute;left:56px;top:158px;width:660px;display:flex;flex-direction:column;white-space:nowrap;">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
      <div style="width:34px;height:2px;background:#FF6B2B;box-shadow:0 0 12px rgba(255,107,43,0.8);"></div>
      <span style="${MONO}font-size:11.5px;letter-spacing:0.3em;color:#A79F90;">作戦選択\u3000OPERATIONS</span>
      <div style="flex:1;height:1px;background:linear-gradient(90deg, rgba(232,227,216,0.2), rgba(232,227,216,0));"></div>
    </div>
    <button class="u2h-cta" data-nav="deploy" data-id="hub-nav-deploy" style="position:relative;display:flex;align-items:center;gap:20px;height:104px;padding:0 26px 0 22px;margin-bottom:10px;color:#1A0B04;">
      <span style="display:flex;flex-direction:column;gap:6px;flex:1;">
        <span style="display:flex;align-items:baseline;gap:16px;">
          <span style="font-weight:800;font-size:38px;line-height:1;letter-spacing:0.08em;">出撃</span>
          <span style="${COND}font-weight:700;font-size:12px;letter-spacing:0.3em;color:#5A2408;">SORTIE</span>
        </span>
        <span style="font-size:13px;font-weight:700;color:#4A1D06;">${sub.sortie}</span>
      </span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <span style="${COND}font-weight:800;font-size:16px;color:#3A1505;letter-spacing:0.1em;">01</span>
        <span style="display:inline-flex;width:22px;height:22px;border-radius:50%;border:1.5px solid #3A1505;color:#3A1505;align-items:center;justify-content:center;font-size:10px;font-weight:800;">A</span>
      </span>
      <span style="position:absolute;right:-9px;top:50%;width:18px;height:18px;background:#D14C16;transform:translateY(-50%) rotate(45deg);box-shadow:inset 1px -1px 0 rgba(255,220,190,0.4);"></span>
    </button>
    <button class="u2h-row" data-nav="armory" data-id="hub-nav-armory" style="display:flex;align-items:center;gap:20px;padding:17px 20px 17px 4px;">
      <span style="display:flex;flex-direction:column;gap:5px;flex:1;">
        <span style="display:flex;align-items:baseline;gap:14px;">
          <span style="font-weight:800;font-size:27px;line-height:1;letter-spacing:0.06em;text-shadow:0 2px 12px rgba(0,0,0,0.8);">武器庫</span>
          <span style="${COND}font-weight:700;font-size:11px;letter-spacing:0.26em;color:#8F8778;">ARMORY</span>
        </span>
        <span style="font-size:12.5px;color:#8F8778;">${sub.armory}</span>
      </span>
      <span style="${COND}font-weight:700;font-size:14px;color:#5E594F;letter-spacing:0.1em;">02</span>
    </button>
    <button class="u2h-row" data-nav="stages" data-id="hub-nav-stages" style="display:flex;align-items:center;gap:20px;padding:17px 20px 17px 4px;">
      <span style="display:flex;flex-direction:column;gap:5px;flex:1;">
        <span style="display:flex;align-items:baseline;gap:14px;">
          <span style="font-weight:800;font-size:27px;line-height:1;letter-spacing:0.06em;text-shadow:0 2px 12px rgba(0,0,0,0.8);">ステージ</span>
          <span style="${COND}font-weight:700;font-size:11px;letter-spacing:0.26em;color:#8F8778;">STAGES</span>
        </span>
        <span style="font-size:12.5px;color:#8F8778;">${sub.stages}</span>
      </span>
      <span style="${COND}font-weight:700;font-size:14px;color:#5E594F;letter-spacing:0.1em;">03</span>
    </button>
    <button class="u2h-row" data-nav="campaign" data-id="hub-nav-campaign" style="display:flex;align-items:center;gap:20px;padding:17px 20px 17px 4px;">
      <span style="display:flex;flex-direction:column;gap:5px;flex:1;">
        <span style="display:flex;align-items:baseline;gap:14px;">
          <span style="font-weight:800;font-size:27px;line-height:1;letter-spacing:0.06em;text-shadow:0 2px 12px rgba(0,0,0,0.8);">キャンペーン</span>
          <span style="${COND}font-weight:700;font-size:11px;letter-spacing:0.26em;color:#8F8778;">CAMPAIGN</span>
        </span>
        <span style="font-size:12.5px;color:#8F8778;">${sub.campaign}</span>
      </span>
      <span style="display:flex;align-items:center;gap:9px;margin-right:6px;"><span style="position:relative;width:84px;height:3px;background:rgba(232,227,216,0.14);"><span style="position:absolute;left:0;top:0;width:${campPct}%;height:3px;background:#FF6B2B;"></span></span><span style="${MONO}font-size:10.5px;color:#C9865C;">${camp.cleared}/${camp.total}</span></span>
      <span style="${COND}font-weight:700;font-size:14px;color:#5E594F;letter-spacing:0.1em;">04</span>
    </button>
    <button class="u2h-row" data-nav="zombie" data-id="hub-nav-zombie" style="display:flex;align-items:center;gap:20px;padding:17px 20px 17px 4px;">
      <span style="display:flex;flex-direction:column;gap:5px;flex:1;">
        <span style="display:flex;align-items:baseline;gap:14px;">
          <span style="font-weight:800;font-size:27px;line-height:1;letter-spacing:0.06em;text-shadow:0 2px 12px rgba(0,0,0,0.8);">ゾンビ</span>
          <span style="${COND}font-weight:700;font-size:11px;letter-spacing:0.26em;color:#8F8778;">UNDEAD</span>
        </span>
        <span style="font-size:12.5px;color:#8F8778;">${sub.zombie}</span>
      </span>
      <span style="${MONO}font-size:10.5px;color:#C9865C;margin-right:6px;">${sub.zombieBest}</span>
      <span style="${COND}font-weight:700;font-size:14px;color:#5E594F;letter-spacing:0.1em;">05</span>
    </button>
    <button class="u2h-row u2h-row--sys" data-nav="options" data-id="hub-nav-options" style="display:flex;align-items:center;gap:20px;padding:15px 20px 15px 4px;">
      <span style="display:flex;align-items:baseline;gap:14px;flex:1;">
        <span style="font-weight:800;font-size:22px;line-height:1;letter-spacing:0.06em;">システム</span>
        <span style="font-size:12px;color:#77705F;">設定 · 操作 / ゲームパッド · 記録</span>
      </span>
      <span style="${COND}font-weight:700;font-size:14px;color:#5E594F;letter-spacing:0.1em;">06</span>
    </button>
  </nav>

  <div style="position:absolute;right:56px;bottom:120px;width:430px;display:flex;flex-direction:column;gap:12px;white-space:nowrap;">
    ${
      nextMission
        ? `<button class="u2h-card" data-nav="campaign" style="position:relative;padding:18px 24px;display:flex;flex-direction:column;gap:10px;text-align:left;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="${MONO}font-size:10.5px;letter-spacing:0.24em;color:#77705F;">作戦継続\u3000CAMPAIGN</span>
        <span style="${MONO}font-size:10.5px;color:#C9865C;">第${nextMission.index}任務</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;">
        <span style="font-weight:800;font-size:20px;color:#F2EDE2;letter-spacing:0.05em;">「${nextMission.name}」</span>
        <span style="font-size:11.5px;color:#8F8778;">${nextMission.chapter}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="position:relative;flex:1;height:4px;background:rgba(232,227,216,0.12);">
          <div style="width:${campPct}%;height:4px;background:linear-gradient(90deg,#B23E14,#FF6B2B);box-shadow:0 0 10px rgba(255,107,43,0.5);"></div>
        </div>
        <span style="${MONO}font-size:12px;color:#E8E3D8;">${campPct}%</span>
      </div>
      <span style="position:absolute;right:8px;top:8px;width:12px;height:12px;border-right:1.5px solid rgba(255,107,43,0.6);border-top:1.5px solid rgba(255,107,43,0.6);"></span>
    </button>`
        : ''
    }
    ${
      daily
        ? `<div class="u2h-card" style="position:relative;padding:18px 24px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="${MONO}font-size:10.5px;letter-spacing:0.24em;color:#77705F;">本日の試練\u3000DAILY</span>
        <span data-id="hub-daily-left" style="${MONO}font-size:10.5px;color:#FF8B4D;"></span>
      </div>
      <span style="font-size:14.5px;font-weight:700;color:#E4DECF;">${daily.label}\u3000<span style="color:#9FE39F;${MONO}font-size:12px;font-weight:400;">報酬 +${fmtInt(daily.rewardXp)} XP</span></span>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="position:relative;flex:1;height:4px;background:rgba(232,227,216,0.12);">
          <div style="width:${Math.round((dailyDone / Math.max(1, daily.target)) * 100)}%;height:4px;background:#FF6B2B;"></div>
          ${daily.target > 1 ? `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg, transparent 0 calc(${(100 / daily.target).toFixed(2)}% - 2px), rgba(4,4,8,0.9) calc(${(100 / daily.target).toFixed(2)}% - 2px) ${(100 / daily.target).toFixed(2)}%);"></div>` : ''}
        </div>
        <span style="${MONO}font-size:12px;color:#E8E3D8;">${dailyDone} / ${daily.target}</span>
      </div>
    </div>`
        : ''
    }
  </div>

  <div style="position:absolute;left:0;bottom:0;width:1920px;height:64px;background:linear-gradient(0deg, rgba(3,3,7,0.96) 0%, rgba(3,3,7,0.78) 70%, rgba(3,3,7,0) 100%);border-top:1px solid rgba(232,227,216,0.12);display:flex;align-items:center;justify-content:space-between;padding:0 56px;box-sizing:border-box;">
    <div style="display:flex;align-items:center;gap:18px;overflow:hidden;width:900px;">
      <span style="flex:none;${MONO}font-size:10.5px;letter-spacing:0.22em;color:#FF8B4D;border:1px solid rgba(255,107,43,0.5);padding:3px 10px;">報\u3000INTEL</span>
      <div style="overflow:hidden;flex:1;">
        <div style="display:flex;gap:64px;white-space:nowrap;animation:enzaTicker 26s linear infinite;width:max-content;">${tickerHtml}</div>
      </div>
    </div>
    <div style="display:flex;gap:30px;font-size:13px;color:#A79F90;flex:none;white-space:nowrap;">
      <span style="display:flex;align-items:center;gap:7px;"><span style="color:#77705F;">▲▼</span> 選択</span>
      <span style="display:flex;align-items:center;gap:7px;"><span style="width:22px;height:22px;border-radius:50%;border:1.5px solid #FF6B2B;color:#FFB98A;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;">A</span> 決定</span>
    </div>
  </div>`;

  // ── 配線(全ボタン実動) ──────────────────────────────
  const nav = (id: string): void => {
    if (id === 'deploy') host.open('deploy');
    else if (id === 'armory') host.open('armory');
    else if (id === 'stages') host.open('deploy', { section: 'stages' });
    else if (id === 'campaign') host.open('campaign');
    else if (id === 'zombie') host.open('deploy', { section: 'zombie' });
    else if (id === 'options') host.open('options');
  };
  root.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => nav(btn.dataset.nav ?? ''));
  });

  // 実時刻(JST表記)+デイリー残り時間。1秒間隔・disposeで確実に停止
  const clockEl = root.querySelector<HTMLElement>('[data-id="hub-clock"]');
  const dailyLeftEl = root.querySelector<HTMLElement>('[data-id="hub-daily-left"]');
  const tick = (): void => {
    const now = new Date();
    if (clockEl) {
      const pad = (n: number): string => String(n).padStart(2, '0');
      clockEl.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} · ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    if (dailyLeftEl) {
      const mid = new Date(now);
      mid.setHours(24, 0, 0, 0);
      const left = Math.max(0, mid.getTime() - now.getTime());
      const h = Math.floor(left / 3600000);
      const m = Math.floor((left % 3600000) / 60000);
      const s = Math.floor((left % 60000) / 1000);
      dailyLeftEl.textContent = `残り ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  };
  tick();
  const timer = window.setInterval(tick, 1000);

  return {
    dispose: () => {
      window.clearInterval(timer);
      root.removeAttribute('data-id');
      root.innerHTML = '';
    },
  };
};
