// W-ENZA2 F2: タイトル画面(mock01の1:1移植)。
// 正典: scratchpad/enza-mock-01.html + タイトル画面.png。
// モックの情景レイヤは1920×1080のPNGアセットだったため、アセットレス鉄則に従い
// 同構図(光柱7本/目盛環+内接菱/輪鍔短剣/橙の地割れ/火の粉/雨条/ビネット)を
// シード固定の決定論的インラインSVGとして再現している。
//
// R56 W2: 焔座フルードステージ。コーディネータ(menu2.ts)は 'title' を
// FLUID_SCREENS に登録しており、.u2-stage は viewport全面(黒帯なし)まで
// 引き伸ばされ、もう scale-to-fit しない(transform:none)。よってこの画面自身が
// var(--u2s)(=min(vw/1920,vh/1080)、menu2.tsが常時更新)で各グループを
// 個別に端アンカーtransform:scaleする責務を持つ(hub.tsと同型のアンカーグループ方式、
// 詳細はtitle.css)。情景SVG背景は独自にcover-fit(--u2-cover、title.css内でCSSのみ
// で算出)し、霧/火の粉もそれと同じ倍率で追随させてクナイ根元とのズレを防ぐ。
// モックの座標(left/top/paddingのpx値)そのものは1px足りとも書き換えていない。
import '../title.css';
import { BUILD_LABEL } from '../../version';

// ── F1(types.ts)着地までの暫定構造型。メンバー名はENZA_SPEC_V2の Ui2Host 案に一致させてある。
//    F1への要求: openScreen('options', { section?: 'controls' }) を Ui2Host に含めること。
export interface TitleHost {
  settings: { reduceMotion: boolean };
  openScreen?: (id: string, opts?: { section?: string }) => void;
}
export interface TitleHandle {
  dispose(): void;
  onGamepad?(nav: {
    up: boolean;
    down: boolean;
    confirm: boolean;
    back: boolean;
  }): boolean;
}

export type TitleAction = 'start' | 'options' | 'guide' | 'credits';
export interface TitleNavItem {
  action: TitleAction;
  label: string;
  dim?: boolean;
}

// モック34-47行のナビ4項(順序・減光まで正典どおり)
export const TITLE_NAV: readonly TitleNavItem[] = [
  { action: 'start', label: 'ゲームスタート' },
  { action: 'options', label: 'オプション' },
  { action: 'guide', label: '操作ガイド' },
  { action: 'credits', label: 'クレジット', dim: true },
];

export function nextTitleIndex(current: number, dir: 1 | -1, len: number): number {
  return (current + dir + len) % len;
}

// 右上ビルド表記(モック15行)。架空の「BETA 2.0-J / 2026.07.10」は使わず実データのみ:
// ENZA INTERFACE 2.0 はデザイン言語自体の実名称、BUILD_LABEL は version.ts の単一真実源、
// 60FPS は固定60Hzロジックの実仕様。
export function titleBuildLines(build: string): readonly [string, string] {
  return ['ENZA INTERFACE 2.0', `BUILD ${build} · 60FPS`];
}

// ── 決定論的な情景SVG(シード固定LCG。Date/Math.random不使用) ──────────────
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function titleSceneSvg(): string {
  const rnd = lcg(53);
  const p: string[] = [];
  // 光柱7本(上端から末広がり、中心960から僅かに発散)
  const tops = [30, 290, 555, 830, 1100, 1370, 1640];
  for (let i = 0; i < tops.length; i++) {
    const tx = tops[i] ?? 0;
    const tw = 118 + (i % 3) * 14;
    const spread = (tx + tw / 2 - 960) * 0.07;
    const bw = tw + 74;
    const op = i % 2 === 0 ? 0.05 : 0.034;
    p.push(
      `<polygon points="${tx},0 ${tx + tw},0 ${tx + tw + spread + bw - tw},1080 ${tx + spread},1080" fill="#AEB6C2" opacity="${op}"/>`,
    );
  }
  // 目盛環(中心1155,470 r330)+内接菱+外環
  const cx = 1155;
  const cy = 470;
  const r = 330;
  p.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#9AA0A8" stroke-width="1" opacity="0.1"/>`);
  p.push(`<circle cx="${cx}" cy="${cy}" r="505" fill="none" stroke="#9AA0A8" stroke-width="1" opacity="0.045"/>`);
  const dia = [
    `${cx},${cy - r}`,
    `${cx + r},${cy}`,
    `${cx},${cy + r}`,
    `${cx - r},${cy}`,
  ].join(' ');
  p.push(`<polygon points="${dia}" fill="none" stroke="#9AA0A8" stroke-width="1" opacity="0.07"/>`);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = r + 6;
    const r2 = r1 + (long ? 18 : 10);
    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    const x2 = cx + Math.cos(a) * r2;
    const y2 = cy + Math.sin(a) * r2;
    p.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9AA0A8" stroke-width="1" opacity="${long ? 0.14 : 0.09}"/>`,
    );
  }
  // 輪鍔短剣(刃先1193,1046を軸に8°傾け) — PNGのクナイ構図を再現
  p.push('<g transform="rotate(8 1193 1046)">');
  p.push('<circle cx="1193" cy="642" r="40" fill="none" stroke="#C9CFD6" stroke-width="9"/>');
  p.push(
    '<path d="M 1158 620 A 40 40 0 0 1 1215 606" fill="none" stroke="#6E747C" stroke-width="9" stroke-linecap="round" opacity="0.85"/>',
  );
  p.push('<rect x="1186" y="680" width="14" height="16" fill="#2A2E34"/>');
  p.push('<rect x="1177" y="694" width="32" height="142" rx="4" fill="#23272D"/>');
  for (let i = 0; i < 5; i++) {
    const y = 706 + i * 26;
    p.push(
      `<line x1="1177" y1="${y + 12}" x2="1209" y2="${y}" stroke="#3A414A" stroke-width="5"/>`,
    );
  }
  p.push('<rect x="1163" y="834" width="60" height="18" rx="2" fill="#14171B" stroke="#3A414A" stroke-width="1.5"/>');
  p.push('<polygon points="1180,852 1206,852 1196,1046" fill="#2E343B"/>');
  p.push('<polygon points="1193,852 1206,852 1196,1046" fill="#454D56"/>');
  p.push('<line x1="1193" y1="856" x2="1195" y2="1036" stroke="#5A626C" stroke-width="1.6" opacity="0.8"/>');
  p.push('</g>');
  // 突き立ち点の暖光+地割れ(橙)
  p.push('<ellipse cx="1196" cy="1040" rx="150" ry="46" fill="url(#u2ttlGlow)"/>');
  const cracks = [
    'M1196 1042 L1118 1052 L1058 1044 L1002 1058 L948 1050',
    'M1196 1042 L1268 1054 L1330 1046 L1392 1058',
    'M1196 1042 L1176 1066 L1128 1076',
    'M1196 1042 L1236 1064 L1282 1074',
    'M1196 1042 L1152 1036 L1096 1028',
    'M1196 1042 L1247 1032 L1300 1026',
  ];
  for (const d of cracks) {
    p.push(`<path d="${d}" fill="none" stroke="#FF6B2B" stroke-width="5" opacity="0.18" stroke-linecap="round"/>`);
    p.push(`<path d="${d}" fill="none" stroke="#E08A4A" stroke-width="2" opacity="0.85" stroke-linecap="round"/>`);
  }
  // 火の粉スペック(短剣周辺に暖色26+全域に鋼色12)
  for (let i = 0; i < 26; i++) {
    const x = 1040 + rnd() * 330;
    const y = 520 + rnd() * 470;
    const rr = 1.2 + rnd() * 2.2;
    const warm = rnd() > 0.35;
    p.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${warm ? '#FFB374' : '#FFD9AE'}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`,
    );
  }
  for (let i = 0; i < 12; i++) {
    const x = rnd() * 1920;
    const y = rnd() * 900;
    p.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.8 + rnd() * 1.4).toFixed(1)}" fill="#AEB6C2" opacity="${(0.1 + rnd() * 0.16).toFixed(2)}"/>`,
    );
  }
  // 雨条(微細な斜線)
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 1920;
    const y = rnd() * 1040;
    const len = 9 + rnd() * 9;
    p.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + len * 0.2).toFixed(1)}" y2="${(y + len).toFixed(1)}" stroke="#AEB6C2" stroke-width="1" opacity="0.05"/>`,
    );
  }
  return (
    '<svg class="u2-title__scene" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<defs>' +
    '<radialGradient id="u2ttlBg" cx="58%" cy="40%" r="75%">' +
    '<stop offset="0%" stop-color="#1B1E22"/><stop offset="55%" stop-color="#141619"/><stop offset="100%" stop-color="#0B0D10"/>' +
    '</radialGradient>' +
    '<radialGradient id="u2ttlGlow" cx="50%" cy="50%" r="50%">' +
    '<stop offset="0%" stop-color="rgba(255,140,60,0.26)"/><stop offset="60%" stop-color="rgba(255,120,50,0.1)"/><stop offset="100%" stop-color="rgba(255,120,50,0)"/>' +
    '</radialGradient>' +
    '<radialGradient id="u2ttlVig" cx="50%" cy="46%" r="72%">' +
    '<stop offset="0%" stop-color="rgba(0,0,0,0)"/><stop offset="74%" stop-color="rgba(0,0,0,0.1)"/><stop offset="100%" stop-color="rgba(0,0,0,0.52)"/>' +
    '</radialGradient>' +
    '<pattern id="u2ttlHatch" width="6" height="6" patternUnits="userSpaceOnUse">' +
    '<line x1="0" y1="6" x2="6" y2="6" stroke="#FFFFFF" stroke-width="1" opacity="0.015"/>' +
    '</pattern>' +
    '</defs>' +
    '<rect width="1920" height="1080" fill="url(#u2ttlBg)"/>' +
    p.join('') +
    '<rect width="1920" height="1080" fill="url(#u2ttlHatch)"/>' +
    '<rect width="1920" height="1080" fill="url(#u2ttlVig)"/>' +
    '</svg>'
  );
}

// ── マウント ────────────────────────────────────────────────────────────────
export function mountTitle(host: TitleHost, root: HTMLElement, onStart: () => void): TitleHandle {
  const el = document.createElement('div');
  el.className = 'u2-title';
  el.dataset.id = 'title-root';
  if (host.settings.reduceMotion) el.classList.add('u2-reduce');
  const [buildL1, buildL2] = titleBuildLines(BUILD_LABEL);

  const navHtml = TITLE_NAV.map(
    (item, i) =>
      `<button type="button" class="u2-title__nav-item${item.dim ? ' u2-title__nav-item--dim' : ''}${i === 0 ? ' sel' : ''}" data-action="${item.action}"${item.action === 'start' ? ' data-id="title-start"' : ''}>` +
      `<span class="u2-title__dia" aria-hidden="true"></span>${item.label}</button>`,
  ).join('');

  el.innerHTML =
    // 情景SVG背景(全画面cover-fill、titleSceneSvg自身がviewBox 0 0 1920 1080 +
    // preserveAspectRatio=xMidYMid sliceを持つ。title.css側でwidth/height:100%にして起動する)。
    titleSceneSvg() +
    // 流れる霧+クナイ根元の上昇火の粉(モック実値/実座標)。情景SVGと同じcover倍率
    // (--u2-cover)で追随する1920×1080アンカー層にまとめて座標は書き換えない。
    `<div class="u2-title__atmo" aria-hidden="true">` +
    `<div class="u2-title__fog u2-title__fog--a"></div>` +
    `<div class="u2-title__fog u2-title__fog--b"></div>` +
    `<div class="u2-title__ember u2-title__ember--1"></div>` +
    `<div class="u2-title__ember u2-title__ember--2"></div>` +
    `<div class="u2-title__ember u2-title__ember--3"></div>` +
    `</div>` +
    `<div class="u2-title__build">${buildL1}<br>${buildL2}</div>` +
    `<div class="u2-title__logo">` +
    `<div class="u2-title__kicker"><i></i><span>ブラウザFPS\u3000—\u3000熾火の系譜</span></div>` +
    `<div class="u2-title__word"><span class="u2-title__word-re">FPS-RE</span><span class="u2-title__word-flesh">FLESH</span></div>` +
    `<div class="u2-title__rule"><i></i><span></span></div>` +
    `</div>` +
    `<nav class="u2-title__nav">${navHtml}</nav>` +
    `<div class="u2-title__foot">` +
    `<span class="u2-title__copy">© 2026 MIRUKY WORKS · TypeScript + Three.js + Rapier · 完全ブラウザ動作</span>` +
    `<div class="u2-title__hints"><span><i class="u2-title__key">A</i> 決定</span><span>▲▼ 選択</span></div>` +
    `</div>` +
    `<div class="u2-title__credits" hidden>` +
    `<div class="u2-title__credits-panel" role="dialog" aria-modal="true" aria-label="クレジット">` +
    `<h2>クレジット</h2>` +
    `<p>FPS-reFlesh — 焔座 ENZA INTERFACE 2.0</p>` +
    `<p>© 2026 MIRUKY WORKS</p>` +
    `<p class="u2-title__credits-tech">TypeScript · Three.js · Rapier · WebAudio<br>バイナリアセットゼロ · 完全ブラウザ動作</p>` +
    `<button type="button" class="u2-title__credits-close" data-action="credits-close">閉じる</button>` +
    `</div>` +
    `</div>`;
  root.appendChild(el);

  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.u2-title__nav-item'));
  const credits = el.querySelector<HTMLElement>('.u2-title__credits');
  // W-C: クレジットモーダル表示中のフォーカストラップ用。credits以外の背景コンテナ。
  const backgroundInertTargets = Array.from(
    el.querySelectorAll<HTMLElement>('.u2-title__logo, .u2-title__nav, .u2-title__foot'),
  );
  let sel = 0;
  let lastFocused: HTMLElement | null = null;

  const applySel = (i: number, focus: boolean): void => {
    sel = i;
    buttons.forEach((b, bi) => b.classList.toggle('sel', bi === sel));
    const btn = buttons[sel];
    if (focus && btn) btn.focus({ preventScroll: true });
  };

  const creditsOpen = (): boolean => credits !== null && !credits.hidden;
  const openCredits = (): void => {
    if (!credits) return;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    credits.hidden = false;
    // W-C: 背景ナビへのTab到達を遮断(フォーカストラップ)。
    for (const t of backgroundInertTargets) t.inert = true;
    credits.querySelector<HTMLButtonElement>('.u2-title__credits-close')?.focus({ preventScroll: true });
  };
  const closeCredits = (): void => {
    if (!credits) return;
    credits.hidden = true;
    for (const t of backgroundInertTargets) t.inert = false;
    (lastFocused ?? buttons[sel])?.focus({ preventScroll: true });
  };

  const activate = (action: TitleAction): void => {
    // W-ENZA2 T1: クレジットモーダル表示中はTab到達した背後ナビの
    // ネイティブclick(Enter/Space)による無条件遷移を遮断(モーダル迂回防止)
    if (creditsOpen()) return;
    if (action === 'start') onStart();
    else if (action === 'options') host.openScreen?.('options');
    else if (action === 'guide') host.openScreen?.('options', { section: 'controls' });
    else openCredits();
  };

  buttons.forEach((btn, i) => {
    // W-C: ホバーもフォーカスを追従させ、sel(見た目)とdocument.activeElement(Enter/Space発火対象)を
    // 常に一致させる(矢印キーと同じ保証)。不一致だと「見た目で選択中の項目」と異なる項目が発火する。
    btn.addEventListener('mouseenter', () => applySel(i, true));
    btn.addEventListener('focus', () => applySel(i, false));
    btn.addEventListener('click', () => activate(TITLE_NAV[i]?.action ?? 'start'));
  });
  credits?.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === credits) closeCredits();
    if (t instanceof HTMLElement && t.dataset.action === 'credits-close') closeCredits();
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (creditsOpen()) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeCredits();
      }
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      applySel(nextTitleIndex(sel, 1, buttons.length), true);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      applySel(nextTitleIndex(sel, -1, buttons.length), true);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      // フォーカスがナビ上ならネイティブclickに任せる(二重発火防止)
      if (document.activeElement && buttons.includes(document.activeElement as HTMLButtonElement)) return;
      ev.preventDefault();
      activate(TITLE_NAV[sel]?.action ?? 'start');
    }
  };
  window.addEventListener('keydown', onKey);

  // 入場儀式(600ms、reduce時はCSS側で短絡)
  requestAnimationFrame(() => el.classList.add('u2-title--in'));
  const focusRaf = requestAnimationFrame(() => {
    if (el.isConnected) buttons[0]?.focus({ preventScroll: true });
  });

  let navHeld = false;
  return {
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(focusRaf);
      el.remove();
    },
    onGamepad(nav): boolean {
      if (creditsOpen()) {
        if (nav.back || nav.confirm) closeCredits();
        return true;
      }
      if (nav.up || nav.down) {
        if (!navHeld) applySel(nextTitleIndex(sel, nav.down ? 1 : -1, buttons.length), true);
        navHeld = true;
      } else {
        navHeld = false;
      }
      if (nav.confirm) activate(TITLE_NAV[sel]?.action ?? 'start');
      return true;
    },
  };
}
