// W-ENZA2 F3: 出撃ロビー(mock03「公開マッチ」の1:1移植+実機能全結線)。
// 正典: scratchpad/enza-mock-03.html(1920×1080固定ステージ+インラインstyle)。
// 実装方針:
//   - 構図・寸法・色はモック実測値(deploy.css参照)。scale-to-fitはF1基盤(.u2-stage)が担う
//   - モックの架空要素(マッチ検索/回線8ms/開始タイマー00:12/NATタイプ/ソーシャル)は置かず、
//     同じ視覚言語で実機能(左ナビ=設定セクション、タイマーブロック=出撃CTA)を構成する
//   - データ源・挙動は旧 src/ui/menu.ts の render* が正典(コピー移植。旧ファイルは不変)
//   - 背景はモックがPNGビットマップのため、シード固定LCGの手続きSVG情景で決定論再現
import '../deploy.css';

import { saveProfile } from '../../core/profile';
import { resolveGraphicsTier } from '../../core/settings';
import { CHARM_IDS, levelFromXp, rankNameFor, type CharmId } from '../../game/progression';
import { CHARMS } from '../../game/zombie-economy';
import { MODE_DEFS, MODE_IDS } from '../../game/modes';
import { STAGES, stagesForMode } from '../../game/stages';
import { ZOMBIE_MAX_ALIVE, zombieTotal } from '../../game/zombie';
import { requestStageThumb } from '../../render/stage-thumbs';
import { readLastZombiePerk, resolveCarriedPerk } from '../../ui/menu';
import type { Difficulty, GameMode, ScreenMount, Ui2Host } from '../types';

// R55 W-C4[6]: match.ts(renderer.capabilities.isWebGL2)が行う実効グラフィックスtier降格を
// この画面でも再現するため、main.tsと同じWebGL2検出をモジュールロード時に1回だけ行う
// (ブラウザのWebGL2対応はセッション中不変。renderLobbyCard等の頻繁な再描画のたびに
// canvas/contextを生成するとGLコンテキスト数の上限に触れうるため、1回きりに固定する)。
const DEPLOY_HAS_WEBGL2: boolean = (() => {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
})();

// 旧menu.tsのDIFFICULTIES(モジュール私有のため転記。ラベル・説明は同一)
const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: '新兵', desc: '反応が遅く、よく外す' },
  { id: 'normal', label: '兵士', desc: '標準的な腕前' },
  { id: 'hard', label: '精鋭', desc: '反応が速く、正確に当てる' },
];

// 旧menu.tsのlatestTitle/charmChipStatus(小純関数の転記。旧UIへのruntime依存を最小化)
function latestTitle(titles: readonly string[] | undefined): string | null {
  return titles && titles.length > 0 ? (titles[titles.length - 1] ?? null) : null;
}
function charmStatus(
  charms: { unlocked: readonly CharmId[]; equipped: CharmId | null } | undefined,
  id: CharmId,
): 'locked' | 'unlocked' | 'equipped' {
  const unlocked = charms?.unlocked.includes(id) ?? false;
  if (!unlocked) return 'locked';
  return charms?.equipped === id ? 'equipped' : 'unlocked';
}

type SectionId = 'mode' | 'stage' | 'difficulty' | 'special' | 'zombie';
const SECTIONS: Array<{ id: SectionId; label: string; kicker: string; zombieOnly?: boolean }> = [
  { id: 'mode', label: 'モード選択', kicker: 'GAME MODE' },
  { id: 'stage', label: 'ステージ選択', kicker: 'LANDING ZONE' },
  { id: 'difficulty', label: '難易度', kicker: 'BOT SKILL' },
  { id: 'special', label: '特殊設定', kicker: 'MUTATION' },
  { id: 'zombie', label: 'ゾンビ設定', kicker: 'UNDEAD PROTOCOL', zombieOnly: true },
];

// シード固定LCG(F2 title.tsと同方式)。情景が毎回同じ=決定論(テスト可能・再現可能)
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 背景の火の粉(旧FA4 emberFieldHtmlをpx座標系+LCGへ移植。負のdelayで場が満ちている)
const EMBER_PALETTE = ['#ffb98a', '#ffd9bc', '#f5d06b', '#ffa061'] as const;
function emberFieldHtml(rnd: () => number, n: number): string {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    const x = 2 + rnd() * 96;
    const d = 14 + rnd() * 10;
    const s = 1.1 + rnd() * 1.1;
    const op = 0.4 * (0.45 + rnd() * 0.55);
    const dx = (rnd() * 2 - 1) * 110;
    const c = EMBER_PALETTE[i % EMBER_PALETTE.length];
    out +=
      `<i class="u2d-ember" style="--x:${x.toFixed(1)}%;--d:${d.toFixed(1)}s;` +
      `--delay:-${(rnd() * d).toFixed(1)}s;--s:${s.toFixed(1)}px;--o:${op.toFixed(2)};` +
      `--dx:${dx.toFixed(0)}px;--ty:-760px;--c:${c}"></i>`;
  }
  return out;
}

// 残照の空の星(2群交代の瞬き。旧FA4 lobbyStarsSvg移植+LCG化)
function starsSvg(rnd: () => number): string {
  const gs: string[][] = [[], []];
  for (let i = 0; i < 40; i += 1) {
    const x = (rnd() * 100).toFixed(1);
    const y = (rnd() * 100).toFixed(1);
    const r = (0.3 + rnd() * 0.5).toFixed(2);
    const op = (0.3 + rnd() * 0.4).toFixed(2);
    gs[i % 2]!.push(`<circle cx="${x}" cy="${y}" r="${r}" opacity="${op}"/>`);
  }
  return (
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="#f7f2e8">' +
    `<g class="u2d-tw1">${gs[0]!.join('')}</g><g class="u2d-tw2">${gs[1]!.join('')}</g>` +
    '</svg>'
  );
}

// 残照の都市(旧FA4 lobbyCitySvg移植: 遠景帯+パゴダ+鋸壁タワー+電柱と垂線+稜線)
function citySvg(): string {
  return (
    '<svg viewBox="0 0 1200 500" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<g fill="#2c2233" opacity="0.5">' +
    '<rect x="250" y="215" width="95" height="285"/><rect x="415" y="185" width="70" height="315"/>' +
    '<rect x="640" y="240" width="120" height="260"/><rect x="905" y="205" width="80" height="295"/>' +
    '</g>' +
    '<g fill="#241b29">' +
    '<rect x="130" y="66" width="6" height="78" />' +
    '<path d="M33,150 Q70,118 133,112 Q196,118 233,150 L204,150 L204,196 L62,196 L62,150 Z"/>' +
    '<path d="M48,218 Q88,192 133,188 Q178,192 218,218 L192,218 L192,262 L74,262 L74,218 Z"/>' +
    '<path d="M60,284 Q96,262 133,258 Q170,262 206,284 L184,284 L184,330 L82,330 L82,284 Z"/>' +
    '<path d="M72,350 Q102,332 133,329 Q164,332 194,350 L176,350 L176,500 L90,500 L90,350 Z"/>' +
    '<path d="M560,500 V208 h12 v-14 h14 v14 h20 v-14 h14 v14 h20 v-14 h14 v14 h16 V500 Z"/>' +
    '<path d="M712,500 V150 h18 v-12 h16 v12 h26 v-20 h16 v20 h24 v-12 h14 v12 h16 V500 Z"/>' +
    '<path d="M868,500 V244 h14 v-10 h18 v10 h22 v-16 h14 v16 h30 V500 Z"/>' +
    '<path d="M994,500 V132 h22 v-14 h18 v14 h30 v-22 h16 v22 h26 v-14 h16 v14 h12 V500 Z"/>' +
    '<rect x="1140" y="268" width="60" height="232"/>' +
    '<line x1="1052" y1="132" x2="1052" y2="86" stroke="#241b29" stroke-width="3"/>' +
    '</g>' +
    '<g stroke="#191320" fill="none">' +
    '<rect x="338" y="222" width="5" height="278" fill="#191320" stroke="none"/>' +
    '<rect x="468" y="206" width="5" height="294" fill="#191320" stroke="none"/>' +
    '<rect x="320" y="230" width="40" height="4" fill="#191320" stroke="none"/>' +
    '<rect x="450" y="214" width="40" height="4" fill="#191320" stroke="none"/>' +
    '<path d="M341,234 Q405,266 470,219" stroke-width="2"/>' +
    '<path d="M341,242 Q405,276 470,227" stroke-width="1.6"/>' +
    '<path d="M470,219 Q580,268 712,296" stroke-width="2"/>' +
    '<path d="M341,234 Q250,270 150,300" stroke-width="1.6"/>' +
    '</g>' +
    '<path d="M0,432 Q210,398 430,424 Q640,446 850,428 Q1030,414 1200,424 L1200,500 L0,500 Z" fill="#140e15"/>' +
    '</svg>'
  );
}

// 菱紋の幟(旧FA4 lobbyBannerSvg移植。hasRing=同心円環つきの大紋)
function bannerSvg(hasRing: boolean): string {
  const rim = hasRing ? 'A' : 'B';
  return (
    '<svg viewBox="0 0 90 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    `<defs><linearGradient id="u2dLbRim${rim}" x1="0" y1="0" x2="1" y2="0">` +
    '<stop offset="0" stop-color="rgba(201,134,92,0)"/>' +
    '<stop offset="1" stop-color="rgba(201,134,92,0.3)"/></linearGradient></defs>' +
    '<rect x="6" y="0" width="4" height="420" fill="#0e0a0e"/>' +
    '<rect x="6" y="10" width="72" height="4" fill="#0e0a0e"/>' +
    '<path d="M18,16 h56 v332 q-15,15 -28,8 q-13,7 -28,-8 Z" fill="#120c12" stroke="#2a1f2c" stroke-width="1"/>' +
    `<rect x="66" y="16" width="8" height="330" fill="url(#u2dLbRim${rim})"/>` +
    (hasRing
      ? '<circle cx="46" cy="118" r="33" fill="none" stroke="#c9865c" stroke-width="2.5" opacity="0.9"/>'
      : '') +
    '<rect x="32" y="104" width="28" height="28" fill="none" stroke="#d99a66" stroke-width="3" transform="rotate(45 46 118)"/>' +
    '<rect x="39" y="111" width="14" height="14" fill="#e8956b" transform="rotate(45 46 118)"/>' +
    '<g fill="#d8d1c2" opacity="0.5">' +
    '<rect x="44" y="196" width="4" height="16"/><rect x="44" y="228" width="4" height="16"/>' +
    '<rect x="44" y="260" width="4" height="16"/><rect x="44" y="292" width="4" height="16"/>' +
    '<rect x="44" y="324" width="4" height="14"/>' +
    '</g>' +
    '</svg>'
  );
}

// 背景一式(export=決定論の構造をテストでピン可能に)
export function deployBgHtml(seed = 0x51ab): string {
  const rnd = makeLcg(seed);
  const clouds = [
    { x: '4%', y: '9%', w: '999px', h: '119px', d: '120s', delay: '0s' },
    { x: '42%', y: '20%', w: '883px', h: '97px', d: '95s', delay: '-30s' },
    { x: '20%', y: '31%', w: '1114px', h: '130px', d: '140s', delay: '-70s' },
  ]
    .map(
      (c) =>
        `<div class="u2d-bg-cloud" style="--x:${c.x};--y:${c.y};--w:${c.w};--h:${c.h};--d:${c.d};--delay:${c.delay}"></div>`,
    )
    .join('');
  return (
    `<div class="u2d-bg" aria-hidden="true">${clouds}` +
    `<div class="u2d-bg-stars">${starsSvg(rnd)}</div>` +
    `<div class="u2d-bg-city">${citySvg()}</div>` +
    `<div class="u2d-bg-banner u2d-bg-banner-a">${bannerSvg(false)}</div>` +
    `<div class="u2d-bg-banner u2d-bg-banner-b">${bannerSvg(true)}</div>` +
    emberFieldHtml(rnd, 26) +
    '<div class="u2d-bg-ground"></div>' +
    '<div class="u2d-bg-fog"></div>' +
    '</div>'
  );
}

// 選択トグルの共通処理(旧markSelected移植: selected+aria-pressed)
function markSelected(container: HTMLElement, key: string, value: string): void {
  container.querySelectorAll<HTMLElement>(`[data-${key}]`).forEach((node) => {
    const on = node.dataset[key] === value;
    node.classList.toggle('selected', on);
    node.setAttribute('aria-pressed', String(on));
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export const mountDeploy: ScreenMount = (host: Ui2Host, root: HTMLElement, opts) => {
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const sel = host.loadout;
  // R55 W-C2: ゾンビ設定タブ未訪問のまま出撃すると装備中お守りが未反映になるため、
  // 画面構築時に profile.charms.equipped を同期する(旧menu.tsのモード切替時同期の代替)
  sel.charm = host.profile.charms?.equipped ?? undefined;
  let active: SectionId = 'mode';
  // hubからの直行導線: ステージ選択/ゾンビ(=モードごと切替して開く)
  if (opts?.section === 'stages') active = 'stage';
  else if (opts?.section === 'zombie') {
    sel.mode = 'zombie';
    const list = stagesForMode('zombie');
    if (!list.some((s) => s.id === sel.stageId)) sel.stageId = list[0]?.id ?? sel.stageId;
    active = 'zombie';
  }

  root.dataset.id = 'scr-deploy'; // F10スモーク契約
  if (host.reducedMotion()) root.classList.add('u2d-reduce');
  // R56 焔座フルードステージ: 各トップレベル群を「固定すべき角/辺」でアンカーラッパーに包む。
  //   - u2d-fluid-tl : 左上寄せ群(見出し/左ナビ/分隊ノート)。子のモック座標は不変のまま
  //     transform:scale(var(--u2s))で左上角基準に一様スケール(歪みゼロ・黒帯なし)。
  //   - u2d-fluid-tr : 右上寄せ群(ロビーカード/中央パネル)。右上角基準スケール。パネルは
  //     16:9設計高(628px)固定=旧bottom:200相当で、スクロール本体はラッパー内で従来px高を保つ
  //     ため overflow:auto が生き続ける(scaleは見た目のみでスクロール可能高を潰さない)。
  //   - u2d-fluid-bc : 下中央群(次ステージ帯+出撃CTA)。下辺中央基準スケール。
  //   - u2d-foot     : 左右両端に跨る帯。transformとstretch併用不可のため transform不使用で
  //     left:0;right:0にstretchし、内部余白/寸法は calc(モックpx * var(--u2s)) で一様スケール。
  //   - 背景(u2d-bg)は既に position:absolute;inset:0 でフルードstage全面を占有=無改変で全面fill。
  // いずれも --u2s=1(16:9)では scale(1)/calc(px*1) に還元され旧デザインとピクセル完全一致。
  root.innerHTML = `
    ${deployBgHtml()}
    <div class="u2d-fluid u2d-fluid-tl">
    <div class="u2d-head">
      <span class="u2d-kicker">マルチプレイヤー\u3000/\u3000${MODE_IDS.length}モード</span>
      <span class="u2d-title">対戦モード</span>
      <div class="u2d-rule"></div>
    </div>
    <nav class="u2d-nav" data-id="deploy-nav" aria-label="出撃設定セクション"></nav>
    <div class="u2d-squadnote" data-id="squad-note"></div>
    </div>
    <div class="u2d-fluid u2d-fluid-tr">
    <div class="u2d-lobby" data-id="lobby-card"></div>
    <section class="u2d-panel" aria-live="polite">
      <div class="u2d-panel-head">
        <span class="u2d-panel-title" data-id="panel-title"></span>
        <span class="u2d-panel-kicker" data-id="panel-kicker"></span>
      </div>
      <div class="u2d-panel-body" data-id="panel-body"></div>
    </section>
    </div>
    <div class="u2d-fluid u2d-fluid-bc">
    <div class="u2d-band">
      <div class="u2d-band-info">
        <span class="u2d-band-label">次のステージ</span>
        <span class="u2d-band-value" data-id="band-value"></span>
      </div>
      <button type="button" class="u2d-band-armory" data-id="to-armory" aria-label="武器庫へ(装備を変更)">
        <span class="u2d-band-armory-label">装備変更</span>
        <span class="u2d-band-armory-main">武器庫 ▸</span>
      </button>
      <button type="button" class="u2d-launch" data-id="start" aria-label="出撃(長押し)">
        <span class="u2d-launch-label">準備完了</span>
        <span class="u2d-launch-main">出撃</span>
      </button>
    </div>
    </div>
    <div class="u2d-foot">
      <div class="u2d-hints">
        <span><span class="u2d-key accent">A</span> 選択</span>
        <span><span class="u2d-key">B</span> 戻る</span>
      </div>
      <span class="u2d-foot-mono">reFlesh · BUILD ${esc(host.buildLabel)}</span>
      <button type="button" class="u2d-foot-menu u2-menubtn" data-id="back-to-hub"><span class="u2-key-esc">Esc</span>メニューへ</button>
    </div>
  `;

  const q = <T extends HTMLElement = HTMLElement>(id: string): T =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  // ── 左ナビ(実セクション。ゾンビ設定はmode==='zombie'時のみ) ──────────────
  const renderNav = (): void => {
    const nav = q('deploy-nav');
    nav.replaceChildren();
    for (const s of SECTIONS) {
      if (s.zombieOnly && sel.mode !== 'zombie') continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `u2d-nav-item${s.id === active ? ' selected' : ''}`;
      b.dataset.section = s.id;
      b.textContent = s.label;
      b.setAttribute('aria-pressed', String(s.id === active));
      // R55 W-C3[5]: hub直行(opts.section)で初期activeがmode以外の時、menu2.open()の
      // [data-autofocus]最優先ロジックへ現在アクティブなナビ項目を宣言する
      // (未宣言だと先頭のモード選択ナビへフォーカスが落ちてしまう)。
      if (s.id === active) b.setAttribute('data-autofocus', '');
      b.addEventListener(
        'click',
        () => {
          // R55 W-C: 再構築でフォーカスが失われるため、選択前にフォーカスがあれば
          // 選択後の.selectedへ戻す(armory.tsのhadFocusパターンと同型)
          const hadFocus = nav.contains(document.activeElement);
          active = s.id;
          renderNav();
          renderPanel();
          if (hadFocus)
            nav.querySelector<HTMLElement>('.u2d-nav-item.selected')?.focus({ preventScroll: true });
        },
        sig,
      );
      nav.appendChild(b);
    }
  };

  // ── 右上ロビー情報(実データ: 定員=stage.botCount+1 / 階級・称号 / AIボット) ──
  const renderLobbyCard = (): void => {
    const stageDef = STAGES.find((s) => s.id === sel.stageId) ?? STAGES[0]!;
    const level = levelFromXp(host.profile.xp).level;
    const rank = rankNameFor(level).name;
    const title = latestTitle(host.profile.titles);
    const isZombie = sel.mode === 'zombie';
    // ゾンビ時はstageDef.botCount(通常対戦用BOT数)を流用せず、zombie.tsの実数値を使う。
    // 同時生存上限は描画tier依存のため、実効tier(WebGL2非対応ならlowへ強制降格。match.tsの
    // resolveGraphicsTier(settings.graphicsQuality, renderer.capabilities.isWebGL2)相当)で表示。
    // R55 W-C: 超鬼畜ONだとmatch.tsが実スポーンをMath.ceil(botCount*1.5)へ引き上げるため、
    // '最大'ラベルにのみ同じ上限を反映する(row3のAIボット表示は生値のまま=旧仕様維持)。
    const rawHellBotCount = sel.hellMode ? Math.ceil(stageDef.botCount * 1.5) : stageDef.botCount;
    // R55 W-C3[3]/W-C4[6]: match.tsは描画tier別に湧き数を頭打ちする(low16/medium28/high無制限)。
    // それを再現せずに表示すると、既定(medium)でも実際より多い架空人数が出てしまう。さらに
    // WebGL2非対応環境ではmatch.tsが設定値に関わらずlowへ実効降格するため、settings.graphicsQuality
    // をそのまま使わずresolveGraphicsTierで同じ降格を経てからクランプする(理想は共有定数だが、
    // 当面はここに複製する)。
    const effectiveTier = resolveGraphicsTier(host.settings.graphicsQuality, DEPLOY_HAS_WEBGL2);
    const tierCap = effectiveTier === 'high' ? Infinity : effectiveTier === 'medium' ? 28 : 16;
    const hellBotCount = Math.min(tierCap, rawHellBotCount);
    // R55 W-C5[2]: 実ランタイム(zombie-director)はtierごとに単一値(low40/medium84/high108)
    // であり範囲ではない。上で算出済みのeffectiveTierをそのまま流用して単一値表示に統一する。
    const capLabel = isZombie
      ? `同時生存上限 ${ZOMBIE_MAX_ALIVE[effectiveTier]}体`
      : `最大${hellBotCount + 1}人`;
    // R55 W-C2: 輪廻(ローグラン)はR1固定で始まるため、開始ラウンド設定値ではなく
    // 常にR1を表示する(rogueRun中はzrWrapもロックされ設定値は無視される)
    const zRound = sel.rogueRun ? 1 : (sel.zombieStartRound ?? 1);
    // R55 W-C6[3]: row1「最大N人」はhellBotCountでtierクランプ済みだが、row3が
    // クランプ前の生値(stageDef.botCount)を出すと超鬼畜ON/低tier時に両者が食い違う。
    // row3もクランプ後のhellBotCountへ揃える(実際にスポーンする実効値と一致させる)。
    const row3 = isZombie
      ? `ゾンビ ${zombieTotal(zRound)}体/R${zRound}\u3000—\u3000参戦準備完了`
      : `AIボット ${hellBotCount}体\u3000—\u3000参戦準備完了`;
    q('lobby-card').innerHTML = `
      <div class="u2d-lobby-row1">
        <span class="u2d-lobby-count">1人\u3000<small>(${capLabel})</small></span>
        <span class="u2d-lobby-net">ローカル実行 · 60Hz</span>
      </div>
      <div class="u2d-lobby-row2">
        <span class="u2d-lobby-dia" aria-hidden="true"></span>
        <span class="u2d-lobby-lv">${level}</span>
        <span class="u2d-lobby-name">${esc(rank)}</span>
        ${title ? `<span class="u2d-lobby-sub">${esc(title)}</span>` : ''}
        <span class="u2d-lobby-role">分隊長</span>
      </div>
      <div class="u2d-lobby-row3">${row3}</div>
    `;
    q('squad-note').innerHTML =
      '<span>あなたが分隊長です</span>' +
      `<span>難易度: ${esc(DIFFICULTIES.find((d) => d.id === sel.difficulty)?.label ?? '-')}\u3000·\u3000` +
      `${sel.mode === 'zombie' ? `開始ラウンド: R${zRound}` : `ステージ: ${esc(stageDef.name)}`}</span>`;
  };

  // ── 下帯: 次のステージ(実選択値) ──────────────────────────────────────
  const renderBand = (): void => {
    const stageDef = STAGES.find((s) => s.id === sel.stageId) ?? STAGES[0]!;
    q('band-value').textContent = `${stageDef.name}\u3000·\u3000${MODE_DEFS[sel.mode].name}`;
  };

  const refreshShared = (): void => {
    renderLobbyCard();
    renderBand();
  };

  // ── セクション別パネル(旧render*の移植) ─────────────────────────────────
  const renderModePanel = (body: HTMLElement): void => {
    for (const id of MODE_IDS) {
      const def = MODE_DEFS[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'u2d-opt';
      b.dataset.mode = id;
      b.innerHTML = `<span class="u2d-opt-name">${esc(def.name)}</span><span class="u2d-opt-desc">${esc(def.desc)}</span>`;
      b.addEventListener(
        'click',
        () => {
          setMode(id);
          markSelected(body, 'mode', id);
        },
        sig,
      );
      body.appendChild(b);
    }
    markSelected(body, 'mode', sel.mode);
  };

  const setMode = (id: GameMode): void => {
    sel.mode = id;
    // R16の流儀: モード別ステージ集合が変わるため選択の妥当性を回復する
    const list = stagesForMode(id);
    if (!list.some((s) => s.id === sel.stageId)) sel.stageId = list[0]?.id ?? sel.stageId;
    // R55 W-C2: ゾンビ設定タブを開かずにモードだけ切り替えても装備中お守りが
    // sel.charmへ反映されるよう、active判定に関わらず毎回同期する
    sel.charm = host.profile.charms?.equipped ?? undefined;
    if (active === 'zombie' && id !== 'zombie') active = 'mode';
    renderNav(); // ゾンビ設定項の出没
    refreshShared();
    host.saveLoadout();
  };

  const renderStagePanel = (body: HTMLElement): void => {
    const grid = document.createElement('div');
    grid.className = 'u2d-stages';
    const list = stagesForMode(sel.mode);
    if (!list.some((s) => s.id === sel.stageId)) sel.stageId = list[0]?.id ?? sel.stageId;
    list.forEach((stageDef, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'u2d-stagecard';
      card.dataset.stage = stageDef.id;
      const p = stageDef.palette;
      card.innerHTML = `
        <span class="u2d-stage-preview" style="background:linear-gradient(160deg,${p.sky} 0%,${p.floor} 100%)">
          <img alt="" aria-hidden="true">
          <span class="u2d-stage-no">LZ ${String(idx + 1).padStart(2, '0')}</span>
        </span>
        <span class="u2d-stage-name">${esc(stageDef.name)}</span>
        <span class="u2d-stage-meta">${esc(stageDef.subtitle)}</span>
        <span class="u2d-stage-meta">SEED ${stageDef.seed} · ${stageDef.size}m四方 · BOT 最大${stageDef.botCount}体 · 障害物 ${stageDef.obstacleCount}</span>
      `;
      const img = card.querySelector<HTMLImageElement>('img');
      if (img) {
        requestStageThumb(stageDef, (url) => {
          if (img.isConnected) img.src = url; // dispose後の遅着コールバックを無害化
        });
      }
      card.addEventListener(
        'click',
        () => {
          sel.stageId = stageDef.id;
          markSelected(grid, 'stage', stageDef.id);
          refreshShared();
          host.saveLoadout();
        },
        sig,
      );
      grid.appendChild(card);
    });
    markSelected(grid, 'stage', sel.stageId);
    body.appendChild(grid);
  };

  const renderDifficultyPanel = (body: HTMLElement): void => {
    for (const item of DIFFICULTIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'u2d-opt';
      b.dataset.difficulty = item.id;
      b.innerHTML = `<span class="u2d-opt-name">${esc(item.label)}</span><span class="u2d-opt-desc">${esc(item.desc)}</span>`;
      b.addEventListener(
        'click',
        () => {
          sel.difficulty = item.id;
          markSelected(body, 'difficulty', item.id);
          refreshShared();
          host.saveLoadout();
        },
        sig,
      );
      body.appendChild(b);
    }
    markSelected(body, 'difficulty', sel.difficulty);
  };

  const toggleRow = (
    body: HTMLElement,
    key: 'hellMode' | 'allGiantMode',
    name: string,
    desc: string,
  ): HTMLInputElement => {
    const row = document.createElement('label');
    row.className = 'u2d-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.id = key;
    input.checked = sel[key] ?? false;
    input.addEventListener(
      'change',
      () => {
        sel[key] = input.checked;
        host.saveLoadout();
        // R55 W-C2: 超鬼畜トグルは右上ロビーカードの「最大◯人」表示に影響するため、
        // トグル直後にロビーカード/次ステージ帯を再描画する
        refreshShared();
      },
      sig,
    );
    const text = document.createElement('span');
    text.className = 'u2d-toggle-text';
    text.innerHTML = `<span class="u2d-toggle-name">${esc(name)}</span><span class="u2d-toggle-desc">${esc(desc)}</span>`;
    row.append(input, text);
    body.appendChild(row);
    return input;
  };

  const renderSpecialPanel = (body: HTMLElement): void => {
    const hell = toggleRow(body, 'hellMode', '超鬼畜モード', '敵が最強化する代わりに獲得XP ×100');
    const giant = toggleRow(body, 'allGiantMode', '全巨躯モード', '出現する敵が全て巨躯になる');
    // 輪廻ON中は排他(旧applyRogueExclusivityの流儀)
    const locked = sel.mode === 'zombie' && sel.rogueRun === true;
    hell.disabled = locked;
    giant.disabled = locked;
  };

  const renderZombiePanel = (body: HTMLElement): void => {
    // 輪廻(ローグラン)トグル
    const rogueRow = document.createElement('label');
    rogueRow.className = 'u2d-toggle';
    const rogue = document.createElement('input');
    rogue.type = 'checkbox';
    rogue.dataset.id = 'rogueRun';
    rogue.checked = sel.rogueRun ?? false;
    rogue.addEventListener(
      'change',
      () => {
        // R55 W-C: 再構築でフォーカスが失われるため、変更前にフォーカスがあれば
        // 再構築後の同トグルへ戻す(armory.tsのhadFocusパターンと同型)
        const hadFocus = rogueRow.contains(document.activeElement);
        sel.rogueRun = rogue.checked;
        host.saveLoadout();
        renderPanel(); // 排他(開始R/お守り)の活性を作り直す
        // R55 W-C3[4]: 輪廻ONで開始R/体数が変わるため、右上ロビーカード/次ステージ帯も
        // トグル直後に同期する(hellMode/allGiantModeトグルと同じ流儀)
        refreshShared();
        if (hadFocus)
          q('panel-body')
            .querySelector<HTMLElement>('[data-id="rogueRun"]')
            ?.focus({ preventScroll: true });
      },
      sig,
    );
    const rogueText = document.createElement('span');
    rogueText.className = 'u2d-toggle-text';
    rogueText.innerHTML =
      '<span class="u2d-toggle-name">輪廻(ローグラン)</span>' +
      '<span class="u2d-toggle-desc">95R拳銃のみ・R1固定で始まる周回。供物の台座で力を拾う</span>';
    rogueRow.append(rogue, rogueText);
    body.appendChild(rogueRow);

    const locked = sel.rogueRun === true;
    const zone = document.createElement('div');
    if (locked) zone.className = 'u2d-rogue-locked';
    body.appendChild(zone);

    // 開始ラウンド(旧renderZombieRoundSelector移植: ステッパー+プリセット+フォーカス復元)
    const zrWrap = document.createElement('div');
    zone.appendChild(zrWrap);
    const ZR_PRESETS = [1, 10, 25, 50, 100, 200, 300, 500, 999] as const;
    // R55 W-C2: 輪廻ONの間はpointer-events:noneのみだとTab/gamepadで依然フォーカス可能
    // なため(hellMode/allGiantModeのdisabled属性方式と不一致)、lockedを明示的に受け取り
    // 配下の全button/inputへdisabledを設定する
    const renderZr = (locked: boolean, refocus?: string): void => {
      const cur = sel.zombieStartRound ?? 1;
      zrWrap.innerHTML = `
        <div class="u2d-zr-stepper">
          <button type="button" class="u2d-zr-step" data-id="zr-dec" aria-label="開始ラウンドを下げる"${cur <= 1 ? ' disabled' : ''}>−</button>
          <span class="u2d-zr-val" aria-live="polite" aria-label="開始ラウンド ${cur}">${cur}<small>/ 999</small></span>
          <button type="button" class="u2d-zr-step" data-id="zr-inc" aria-label="開始ラウンドを上げる"${cur >= 999 ? ' disabled' : ''}>+</button>
        </div>
        <div class="u2d-zr-presets">
          ${ZR_PRESETS.map((r) => `<button type="button" class="u2d-chip${r === cur ? ' selected' : ''}" data-zr="${r}" aria-pressed="${r === cur}">R${r}</button>`).join('')}
        </div>
      `;
      const setRound = (v: number, focusSel?: string): void => {
        const next = Math.max(1, Math.min(999, v));
        sel.zombieStartRound = next;
        host.saveLoadout();
        // R55 W-C6[4]: 境界(1/999)まで±すると押した側のボタンがdisabled化する。
        // disabled要素へfocus()してもフォーカスは移らずbodyへ落ちてしまうため、押した側が
        // 境界でdisabledになる場合は反対側の有効なボタンへ差し替える。
        let nextFocus = focusSel;
        if (nextFocus === '[data-id="zr-dec"]' && next <= 1) nextFocus = '[data-id="zr-inc"]';
        else if (nextFocus === '[data-id="zr-inc"]' && next >= 999) nextFocus = '[data-id="zr-dec"]';
        renderZr(locked, nextFocus);
        refreshShared();
      };
      zrWrap
        .querySelector<HTMLElement>('[data-id="zr-dec"]')
        ?.addEventListener(
          'click',
          () => setRound((sel.zombieStartRound ?? 1) - 1, '[data-id="zr-dec"]'),
          sig,
        );
      zrWrap
        .querySelector<HTMLElement>('[data-id="zr-inc"]')
        ?.addEventListener(
          'click',
          () => setRound((sel.zombieStartRound ?? 1) + 1, '[data-id="zr-inc"]'),
          sig,
        );
      zrWrap.querySelectorAll<HTMLElement>('[data-zr]').forEach((btn) => {
        btn.addEventListener(
          'click',
          () => setRound(Number(btn.dataset.zr), `[data-zr="${btn.dataset.zr}"]`),
          sig,
        );
      });
      if (locked) {
        zrWrap
          .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
          .forEach((el) => {
            el.disabled = true;
          });
      }
      // V27の教訓: innerHTML置換でフォーカスがbodyへ落ちるため同じ操作子へ戻す
      if (refocus) zrWrap.querySelector<HTMLElement>(refocus)?.focus();
    };
    renderZr(locked);

    // お守り(旧renderCharmSelector移植: profile.charms.equippedと同期・即保存)
    const charmHead = document.createElement('div');
    charmHead.className = 'u2d-panel-kicker';
    charmHead.style.margin = '6px 0 8px';
    charmHead.textContent = 'お守り';
    zone.appendChild(charmHead);
    const charmGrid = document.createElement('div');
    zone.appendChild(charmGrid);
    // R55 W-C2: renderZrと同様、輪廻ON時はlockedを受け取り配下の全button/inputを
    // disabled化してTab/gamepadフォーカスも遮断する
    const renderCharms = (locked: boolean): void => {
      if (!host.profile.charms) host.profile.charms = { unlocked: [], equipped: null };
      const charms = host.profile.charms;
      sel.charm = charms.equipped ?? undefined;
      charmGrid.replaceChildren();
      const equip = (id: CharmId | null): void => {
        if (id !== null && !charms.unlocked.includes(id)) return;
        // R55 W-C: 再構築でフォーカスが失われるため、選択前にフォーカスがあれば
        // 選択後の.selectedへ戻す(armory.tsのhadFocusパターンと同型)
        const hadFocus = charmGrid.contains(document.activeElement);
        charms.equipped = id;
        saveProfile(host.profile);
        renderCharms(locked);
        if (hadFocus)
          charmGrid.querySelector<HTMLElement>('.u2d-opt.selected')?.focus({ preventScroll: true });
      };
      const none = document.createElement('button');
      none.type = 'button';
      none.className = `u2d-opt${charms.equipped === null ? ' selected' : ''}`;
      none.setAttribute('aria-pressed', String(charms.equipped === null));
      none.innerHTML =
        '<span class="u2d-opt-name">なし</span><span class="u2d-opt-desc">お守りを装備しない</span>';
      none.addEventListener('click', () => equip(null), sig);
      charmGrid.appendChild(none);
      for (const id of CHARM_IDS) {
        const def = CHARMS[id];
        const status = charmStatus(charms, id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `u2d-opt${status === 'equipped' ? ' selected' : ''}${status === 'locked' ? ' locked' : ''}`;
        b.setAttribute('aria-pressed', String(status === 'equipped'));
        if (status === 'locked') {
          b.disabled = true;
          b.title = def.unlockCondition;
          b.innerHTML = `<span class="u2d-opt-name">${esc(def.name)}</span><span class="u2d-opt-desc">未解放 — ${esc(def.unlockCondition)}</span>`;
        } else {
          b.innerHTML =
            `<span class="u2d-opt-name">${esc(def.name)}</span>` +
            `<span class="u2d-opt-desc">${esc(def.description)}</span>` +
            `<span class="u2d-opt-desc">${status === 'equipped' ? '装備中' : '解除済み'}</span>`;
          b.addEventListener('click', () => equip(id), sig);
        }
        charmGrid.appendChild(b);
      }
      if (locked) {
        charmGrid
          .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
          .forEach((el) => {
            el.disabled = true;
          });
      }
    };
    renderCharms(locked);
  };

  const renderPanel = (): void => {
    const meta = SECTIONS.find((s) => s.id === active)!;
    q('panel-title').textContent = meta.label;
    q('panel-kicker').textContent = meta.kicker;
    const body = q('panel-body');
    body.replaceChildren();
    body.scrollTop = 0;
    if (active === 'mode') renderModePanel(body);
    else if (active === 'stage') renderStagePanel(body);
    else if (active === 'difficulty') renderDifficultyPanel(body);
    else if (active === 'special') renderSpecialPanel(body);
    else renderZombiePanel(body);
  };

  // ── 出撃CTA: hold-to-launch(旧wireHoldToLaunch移植。300ms/detail0即時/blur取消) ──
  // 発火順は旧menu.tsと同一: saveLoadout → carriedPerk解決(非永続) → onStart
  const startBtn = q<HTMLButtonElement>('start');
  let holdTimer = 0;
  const clearHold = (): void => {
    if (holdTimer) {
      window.clearTimeout(holdTimer);
      holdTimer = 0;
    }
    startBtn.classList.remove('holding');
  };
  const fire = (): void => {
    host.saveLoadout();
    sel.carriedPerk = resolveCarriedPerk(sel.charm, readLastZombiePerk());
    host.callbacks.onStart({ ...sel });
  };
  startBtn.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      startBtn.classList.add('holding');
      holdTimer = window.setTimeout(() => {
        holdTimer = 0;
        startBtn.classList.remove('holding');
        fire();
      }, 300);
    },
    sig,
  );
  startBtn.addEventListener('pointerup', clearHold, sig);
  startBtn.addEventListener('pointerleave', clearHold, sig);
  startBtn.addEventListener('pointercancel', clearHold, sig);
  window.addEventListener('blur', clearHold, sig);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState !== 'visible') clearHold();
    },
    sig,
  );
  startBtn.addEventListener(
    'click',
    (e) => {
      if (e.detail === 0) {
        clearHold();
        fire();
      }
    },
    sig,
  );

  // R56追加: 出撃前に装備(武器)を見直せる導線。既存の装備選択(loadout)は
  // host.saveLoadout()で共有・永続化されているため、単に武器庫へ遷移するだけでよい
  // (武器庫での変更もsel/host.loadoutを直接編集する同じ状態を指すため相互に同期済み)。
  q('to-armory').addEventListener('click', () => host.open('armory'), sig);
  q('back-to-hub').addEventListener('click', () => host.back(), sig);

  renderNav();
  renderPanel();
  refreshShared();

  return {
    dispose(): void {
      ac.abort();
      clearHold();
      root.classList.remove('u2d-reduce');
      if (root.dataset.id === 'scr-deploy') delete root.dataset.id;
      root.replaceChildren();
    },
  };
};
