// W-ENZA FB7: 出撃ロビー — ステージ/モード/難易度/ゾンビ各種/お守り/ブリーフィング/戦役/デイリー/チャレンジ。
// 焔座様式(.elby-): 大項目=ゴシック特大、計測=等幅、作戦名=明朝。ロジック/選択肢は不変。
import '../enza-lobby.css';
import { saveProfile } from '../../core/profile';
import { rankNameFor } from '../../game/progression';
import {
  dailiesFor,
  dateStringFromSeed,
  refreshDailiesDate,
  todayDateSeed,
} from '../../game/dailies';
import type { Difficulty } from '../../game/bot';
import { GRENADE_SPECS } from '../../game/grenades';
import { MODE_DEFS, MODE_IDS } from '../../game/modes';
import { CAMPAIGN, type MissionDef } from '../../game/campaign';
import {
  CHALLENGES,
  CHARM_IDS,
  isMissionUnlocked,
  isUnlocked,
  type CharmId,
} from '../../game/progression';
// R53-W2: お守り(CHARMS)/ゾンビパーク(PERKS)は zombie-economy.ts が単一の真実。
// メニューは「継承の守り札」用のcarriedPerk解決(PERKS存在チェックのみ)にZombiePerkIdを使う
import { CHARMS } from '../../game/zombie-economy';
import { STAGES, stagesForMode } from '../../game/stages';
import { requestStageThumb } from '../../render/stage-thumbs';
import { PRIMARY_IDS, WEAPON_DEFS } from '../../game/weapons';
import type { MenuScreenHost } from './host';
import { DIFFICULTIES, campaignTotals, missionRewardLabel, charmChipStatus } from './shared';

// ── W-ENZA 純関数ヘルパ(node環境でテスト可能なHTML文字列生成) ──────────
// 規定時間の計器表示 "PAR m:ss" 用
export function parLabel(parTimeS: number): string {
  return `${Math.floor(parTimeS / 60)}:${String(parTimeS % 60).padStart(2, '0')}`;
}

// モードカード内部(祭壇ナビの行 = 菱マーカー+大項目+説明subline)
export function modeCardHtml(name: string, desc: string): string {
  return `
      <span class="elby-mode-mark" aria-hidden="true"></span>
      <span class="elby-mode-body">
        <span class="elby-mode-name">${name}</span>
        <span class="elby-mode-desc">${desc}</span>
      </span>
    `;
}

// 分隊カード(実データのみ: 階級/Lv/ステージ定員。架空の回線msは出さない)
export function squadCardHtml(
  rank: string,
  level: number,
  botCount: number,
  solo: boolean,
): string {
  return `
    <div class="elby-squad">
      <div class="elby-squad-head">
        <span class="elby-squad-count">1人<small>(最大${botCount + 1}人)</small></span>
        <span class="elby-squad-net">回線良好 · ローカル</span>
      </div>
      <div class="elby-squad-row">
        <span class="elby-squad-mark" aria-hidden="true"></span>
        <span class="elby-squad-name">${rank}</span>
        <span class="elby-squad-rank">Lv ${level.toLocaleString()}</span>
        <span class="elby-squad-role">分隊長</span>
      </div>
      <div class="elby-squad-foot">${solo ? '訓練場 — 単独出撃' : `AIボット <b>${botCount}体</b> — 参戦準備完了`}</div>
    </div>
  `;
}

// 次のステージ帯(開始カウントは実機に無いため「出撃準備完了」の実状態表示)
export function stageBandHtml(stageName: string, modeName: string): string {
  return `
    <div class="elby-band">
      <div class="elby-band-main">
        <span class="elby-band-kicker">次のステージ</span>
        <span class="elby-band-stage">${stageName}</span>
        <span class="elby-band-dot" aria-hidden="true"></span>
        <span class="elby-band-mode">${modeName}</span>
      </div>
      <div class="elby-band-ready">出撃準備完了</div>
    </div>
  `;
}

export function renderStages(mnu: MenuScreenHost): void {
  const grid = mnu.query('stages');
  // R16: モード別のステージ一覧(ゾンビは z01〜z10 のみ)。モード切替で作り直す
  grid.replaceChildren();
  const list = stagesForMode(mnu.selection.mode);
  if (!list.some((s) => s.id === mnu.selection.stageId)) {
    mnu.selection.stageId = list[0]?.id ?? mnu.selection.stageId;
  }
  list.forEach((stage, idx) => {
    const card = document.createElement('button');
    card.className = 'stage-card elby-stage';
    card.dataset.stage = stage.id;
    const palette = stage.palette;
    // プレースホルダ背景: 空→床のグラデで即座に「ステージの雰囲気」を伝える。
    // img.src が WebGL サムネで埋まった時点でプレースホルダは img に隠れる。
    card.innerHTML = `
      <span class="stage-preview" style="background:linear-gradient(160deg,${palette.sky} 0%,${palette.floor} 100%)">
        <img class="stage-thumb" alt="" aria-hidden="true">
        <span class="stage-no" aria-hidden="true">LZ ${String(idx + 1).padStart(2, '0')}</span>
      </span>
      <span class="stage-card-body">
        <span class="stage-swatch" aria-hidden="true">
          <i style="background:${palette.floor}"></i><i style="background:${palette.wall}"></i>
          <i style="background:${palette.obstacle}"></i><i style="background:${palette.accent}"></i>
        </span>
        <span class="stage-name">${stage.name}</span>
        <span class="stage-sub">${stage.subtitle}</span>
        <span class="stage-meta"><span class="stage-seed">SEED ${stage.seed}</span>${stage.size}m 四方 / BOT 最大${stage.botCount}体 / 障害物 ${stage.obstacleCount}</span>
      </span>
    `;
    const img = card.querySelector<HTMLImageElement>('.stage-thumb');
    if (img !== null) {
      requestStageThumb(stage, (url) => {
        img.src = url;
      });
    }
    card.addEventListener('click', () => {
      mnu.selection.stageId = stage.id;
      mnu.markSelected(grid, 'stage', stage.id);
      mnu.renderBriefing();
    });
    grid.appendChild(card);
  });
  mnu.stagger(grid);
  mnu.markSelected(grid, 'stage', mnu.selection.stageId);
}

export function renderModes(mnu: MenuScreenHost): void {
  const list = mnu.query('modes');
  for (const id of MODE_IDS) {
    const def = MODE_DEFS[id];
    const card = document.createElement('button');
    card.className = 'mode-card elby-mode';
    card.dataset.mode = id;
    card.innerHTML = modeCardHtml(def.name, def.desc);
    card.addEventListener('click', () => {
      mnu.selection.mode = id;
      mnu.markSelected(list, 'mode', id);
      // R16: モード別のステージ一覧を作り直す(ゾンビ⇔通常でステージ集合が変わる)
      mnu.renderStages();
      mnu.renderZombieRoundSelector();
      mnu.renderCharmSelector();
      mnu.renderRogueToggle();
      mnu.renderBriefing();
    });
    list.appendChild(card);
  }
  mnu.stagger(list);
  mnu.markSelected(list, 'mode', mnu.selection.mode);
}

export function renderDifficulties(mnu: MenuScreenHost): void {
  const list = mnu.query('difficulties');
  for (const item of DIFFICULTIES) {
    const card = document.createElement('button');
    card.className = 'difficulty-card elby-diff';
    card.dataset.difficulty = item.id;
    card.innerHTML = `<span class="elby-diff-name">${item.label}</span><span class="elby-diff-desc">${item.desc}</span>`;
    card.addEventListener('click', () => {
      mnu.selection.difficulty = item.id;
      mnu.markSelected(list, 'difficulty', item.id);
      mnu.renderBriefing();
    });
    list.appendChild(card);
  }
  mnu.stagger(list);
  mnu.markSelected(list, 'difficulty', mnu.selection.difficulty);
}

export function renderSpecialOptions(mnu: MenuScreenHost): void {
  const wire = (id: string, key: 'hellMode' | 'allGiantMode'): void => {
    const el = mnu.root.querySelector<HTMLInputElement>(`input[data-id="${id}"]`);
    if (!el) return;
    el.checked = mnu.selection[key] ?? false;
    el.addEventListener('change', () => {
      mnu.selection[key] = el.checked;
    });
  };
  wire('hellMode', 'hellMode');
  wire('allGiantMode', 'allGiantMode');
}

// ── R54-F5 輪廻(ローグラン)トグル。ゾンビ選択時のみ表示 ────────────────────
// ON中は排他対象(超鬼畜/全巨躯/開始ラウンド/お守り)をUIでも無効化する
// (main.tsの転記段階でも構造的に落とすため二重の安全)
export function renderRogueToggle(mnu: MenuScreenHost): void {
  const wrap = mnu.root.querySelector<HTMLElement>('[data-id="rogue-wrap"]');
  if (!wrap) return;
  const isZombie = mnu.selection.mode === 'zombie';
  wrap.hidden = !isZombie;
  const el = wrap.querySelector<HTMLInputElement>('input[data-id="rogueRun"]');
  if (!el) return;
  el.checked = mnu.selection.rogueRun ?? false;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('change', () => {
      mnu.selection.rogueRun = el.checked;
      mnu.applyRogueExclusivity();
    });
  }
  mnu.applyRogueExclusivity();
}

export function applyRogueExclusivity(mnu: MenuScreenHost): void {
  const locked = mnu.selection.mode === 'zombie' && mnu.selection.rogueRun === true;
  for (const id of ['hellMode', 'allGiantMode']) {
    const input = mnu.root.querySelector<HTMLInputElement>(`input[data-id="${id}"]`);
    if (input) input.disabled = locked;
  }
  for (const wrapId of ['zombie-round-wrap', 'charm-wrap']) {
    mnu.root
      .querySelector<HTMLElement>(`[data-id="${wrapId}"]`)
      ?.classList.toggle('rogue-locked', locked);
  }
}

// ── ゾンビモード専用: 開始ラウンドセレクタ ──────────────────────────
// ゾンビ選択時のみ表示。ステッパー(±)とプリセットチップを並べる。
// IGNITION FRAME 意匠: attach-btn チップ + ember アクセント。
export function renderZombieRoundSelector(mnu: MenuScreenHost): void {
  const wrap = mnu.root.querySelector<HTMLElement>('[data-id="zombie-round-wrap"]');
  if (!wrap) return;
  const isZombie = mnu.selection.mode === 'zombie';
  wrap.hidden = !isZombie;
  if (!isZombie) return;

  const sel = wrap.querySelector<HTMLElement>('[data-id="zombie-round-selector"]');
  if (!sel) return;
  sel.classList.add('elby-zr'); // 焔座計器ステッパー様式(冪等)

  const ZR_PRESETS = [1, 10, 25, 50, 100, 200, 300, 500, 999] as const;
  const cur = mnu.selection.zombieStartRound ?? 1;

  sel.innerHTML = `
    <div class="zr-stepper">
      <button class="zr-step" data-id="zr-dec" aria-label="開始ラウンドを下げる"${cur <= 1 ? ' disabled' : ''}>−</button>
      <span class="zr-val" aria-live="polite" aria-label="開始ラウンド ${cur}"><b>${cur}</b><small>/ 999</small></span>
      <button class="zr-step" data-id="zr-inc" aria-label="開始ラウンドを上げる"${cur >= 999 ? ' disabled' : ''}>+</button>
    </div>
    <div class="attach-options zr-presets">
      ${ZR_PRESETS.map((r) => `<button class="attach-btn${r === cur ? ' selected' : ''}" data-zr="${r}" aria-pressed="${r === cur}">R${r}</button>`).join('')}
    </div>
  `;

  const setRound = (v: number, refocus?: string): void => {
    mnu.selection.zombieStartRound = Math.max(1, Math.min(999, v));
    mnu.renderZombieRoundSelector();
    mnu.renderBriefing();
    // V27修正: innerHTML全置換でフォーカスがbodyへ落ち、パッド/キーボードのナビが
    // ページ先頭へ吹き飛ぶ。再描画後に同じ操作ボタンへフォーカスを戻す(連打可能に)
    if (refocus) sel.querySelector<HTMLElement>(refocus)?.focus();
  };

  sel
    .querySelector<HTMLElement>('[data-id="zr-dec"]')
    ?.addEventListener('click', () => setRound(cur - 1, '[data-id="zr-dec"]'));
  sel
    .querySelector<HTMLElement>('[data-id="zr-inc"]')
    ?.addEventListener('click', () => setRound(cur + 1, '[data-id="zr-inc"]'));
  sel.querySelectorAll<HTMLElement>('[data-zr]').forEach((btn) => {
    btn.addEventListener('click', () =>
      setRound(Number(btn.dataset.zr), `[data-zr="${btn.dataset.zr}"]`),
    );
  });
}

// ── ゾンビモード専用: お守り(charm)ピッカー ─────────────────────────
// 解放済みのみ選択可。装備は profile.charms.equipped へ即保存し(camoの装備保存と同じ
// 流儀)、this.selection.charm を同期する(onStart時にそのままMatchConfigへ渡る)。
export function renderCharmSelector(mnu: MenuScreenHost): void {
  const wrap = mnu.root.querySelector<HTMLElement>('[data-id="charm-wrap"]');
  if (!wrap) return;
  const isZombie = mnu.selection.mode === 'zombie';
  wrap.hidden = !isZombie;
  if (!isZombie) return;

  const grid = wrap.querySelector<HTMLElement>('[data-id="charm-grid"]');
  if (!grid) return;
  if (!mnu.profile.charms) mnu.profile.charms = { unlocked: [], equipped: null };
  const charms = mnu.profile.charms;
  // 前回セッション/前試合で装備済みのcharmを選択へ同期する
  mnu.selection.charm = charms.equipped ?? undefined;

  grid.innerHTML = '';
  const noneOn = charms.equipped === null;
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = `charm-chip elby-charm${noneOn ? ' selected' : ''}`;
  noneBtn.setAttribute('aria-pressed', String(noneOn));
  noneBtn.innerHTML =
    '<span class="charm-name">なし</span><span class="charm-desc">お守りを装備しない</span>';
  noneBtn.addEventListener('click', () => mnu.equipCharm(null));
  grid.appendChild(noneBtn);

  for (const id of CHARM_IDS) {
    const def = CHARMS[id];
    const status = charmChipStatus(charms, id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `charm-chip elby-charm${status === 'equipped' ? ' selected' : ''}${status === 'locked' ? ' locked' : ''}`;
    btn.setAttribute('aria-pressed', String(status === 'equipped'));
    if (status === 'locked') {
      btn.disabled = true;
      btn.title = def.unlockCondition;
      btn.innerHTML =
        `<span class="charm-name">${def.name}</span>` +
        `<span class="charm-desc charm-locked-desc">未解放 — ${def.unlockCondition}</span>`;
    } else {
      btn.innerHTML =
        `<span class="charm-name">${def.name}</span>` +
        `<span class="charm-desc">${def.description}</span>` +
        `<span class="charm-sub">${status === 'equipped' ? '装備中' : '解除済み'}</span>`;
      btn.addEventListener('click', () => mnu.equipCharm(id));
    }
    grid.appendChild(btn);
  }
}

// charmを装備(null=外す)してプロファイルへ保存する(equipCamoと同じ即時保存の流儀)
export function equipCharm(mnu: MenuScreenHost, id: CharmId | null): void {
  if (!mnu.profile.charms) mnu.profile.charms = { unlocked: [], equipped: null };
  if (id !== null && !mnu.profile.charms.unlocked.includes(id)) return; // 未解放は装備不可(UIも disabled で塞ぎ済み)
  mnu.profile.charms.equipped = id;
  saveProfile(mnu.profile);
  mnu.renderCharmSelector();
}

export function renderBriefing(mnu: MenuScreenHost): void {
  const stage = STAGES.find((item) => item.id === mnu.selection.stageId) ?? STAGES[0];
  const mode = MODE_DEFS[mnu.selection.mode];
  const weapon = WEAPON_DEFS[mnu.selection.primaryId];
  const grenade = GRENADE_SPECS[mnu.selection.grenade];
  const difficulty = DIFFICULTIES.find((item) => item.id === mnu.selection.difficulty);
  mnu.query('brief-stage').textContent = stage?.name ?? '-';
  mnu.query('brief-mode').textContent = mode.name;
  mnu.query('brief-weapon').textContent = weapon?.name ?? '-';
  mnu.query('brief-grenade').textContent =
    mnu.selection.attachments.length > 0
      ? `${grenade.name} / Attach ${mnu.selection.attachments.length}`
      : grenade.name;
  mnu.query('brief-difficulty').textContent = difficulty?.label ?? '-';
  // ゾンビモード限定行: 開始ラウンド表示 (hidden属性はDOMで切り替え)
  const zombieRoundRow = mnu.root.querySelector<HTMLElement>('[data-id="brief-zombie-round"]');
  if (zombieRoundRow) {
    zombieRoundRow.hidden = mnu.selection.mode !== 'zombie';
    mnu.query('brief-zombie-round-val').textContent = `R${mnu.selection.zombieStartRound ?? 1}`;
  }
  // W-ENZA: 分隊カード/次のステージ帯(シェルにスロットがあれば描画。無ければno-op)
  updateSquadCard(mnu, stage?.botCount ?? 0);
  updateStageBand(mnu, stage?.name ?? '-', mode.name);
}

// ── W-ENZA 分隊カード(公開マッチ右上の文法)。実データのみ: 操縦者=階級名、AIボット=ステージ定員 ──
// シェル(FB6)が [data-id="squad-card"] スロットを置いた時だけ描画する疎結合。
function updateSquadCard(mnu: MenuScreenHost, botCount: number): void {
  const slot = mnu.root.querySelector<HTMLElement>('[data-id="squad-card"]');
  if (!slot) return;
  const level = mnu.playerLevel();
  slot.innerHTML = squadCardHtml(
    rankNameFor(level).name,
    level,
    botCount,
    mnu.selection.mode === 'training',
  );
}

// ── W-ENZA 次のステージ帯(下中央)。開始カウントは実機に無いため「出撃準備完了」の実状態表示 ──
function updateStageBand(mnu: MenuScreenHost, stageName: string, modeName: string): void {
  const slot = mnu.root.querySelector<HTMLElement>('[data-id="stage-band"]');
  if (!slot) return;
  slot.innerHTML = stageBandHtml(stageName, modeName);
}

// ミッション・ブリーフィング。出撃で onStartMission を呼ぶ
export function showBriefing(mnu: MenuScreenHost, mission: MissionDef): void {
  mnu.endCapture(); // 画面差し替え前にリバインド捕捉を畳む(孤立リスナ防止)
  mnu.teardownPreview();
  // モーダル: 背景を後退させ、宇宙背景をDoFで沈めてブリーフィングを前面へ立てる
  // (menu-briefingは透過のため星野が見える)。showMain/hide が解除する
  document.body.classList.add('bg-recede');
  mnu.bg?.setModalDim(1);
  mnu.root.hidden = false;
  const modLabels: Record<string, string> = {
    'one-life': '一機限り',
    'low-gravity': '低重力',
    'no-regen': '自然回復なし',
    'dense-fog': '濃霧',
    'elite-swarm': '精鋭過多',
  };
  const mods = mission.modifiers.map((m) => modLabels[m] ?? m).join(' / ') || 'なし';
  // --i はタイプライター(brief-type)のstagger用。reduce-motion時はCSS側で即着地する
  const briefLines = mission.brief.map((b, i) => `<p style="--i:${i}">${b}</p>`).join('');
  const intel = mission.intel?.length
    ? `<div class="brief-intel"><h3>インテル</h3>${mission.intel.map((i) => `<p>${i}</p>`).join('')}</div>`
    : '';
  // R53-W2: rewardId(ch10最終決戦「shinrai」等)があれば報酬行を出す(あれば良い程度)
  const rewardLabel = missionRewardLabel(mission.rewardId);
  const rewardRow = rewardLabel
    ? `<div><dt>報酬</dt><dd class="brief-reward">クリアで解放: ${rewardLabel}</dd></div>`
    : '';
  // W-ENZA: 作戦名=明朝の伝承層、計測(章番号/PAR/条件)=等幅の計器層、出撃=熾火CTA
  const parText = parLabel(mission.parTimeS);
  const challengeRow = mission.challenge
    ? `<div><dt>挑戦</dt><dd class="brief-challenge">${mission.challenge.label}</dd></div>`
    : '';
  mnu.root.innerHTML = `
    <div class="menu-screen menu-briefing">
      <div class="brief-frame">
        <div class="brief-panel elby-brief-panel enza-corners" role="dialog" aria-modal="true" aria-label="ミッションブリーフィング">
          <p class="brief-chapter elby-brief-kicker">${mission.chapterId.toUpperCase()}-${mission.index + 1} // 出撃命令 — SORTIE ORDER</p>
          <h1 class="elby-brief-title">${mission.title}</h1>
          <p class="brief-subtitle elby-brief-sub">${mission.subtitle}</p>
          <div class="elby-brief-rule" aria-hidden="true"></div>
          <div class="brief-map" aria-hidden="true"></div>
          <div class="brief-body">${briefLines}</div>
          <dl class="brief-meta elby-brief-meta">
            <div><dt>目的</dt><dd>${mission.objective.label}</dd></div>
            <div><dt>規定時間</dt><dd class="enza-num">PAR ${parText}</dd></div>
            ${challengeRow}
            <div><dt>武器</dt><dd><select class="brief-weapon-select" data-id="brief-weapon-select" aria-label="出撃武器の選択"></select></dd></div>
            <div><dt>難易度</dt><dd><div class="attach-options" data-id="brief-mission-diff"></div></dd></div>
            <div><dt>特殊条件</dt><dd>${mods}</dd></div>
            ${rewardRow}
          </dl>
          ${intel}
          <div class="brief-buttons">
            <button class="menu-start enza-cta elby-deploy" data-id="deploy-mission"><span>出撃する</span></button>
            <button class="menu-quiet enza-btn elby-back" data-id="brief-back">戦役へ戻る</button>
          </div>
        </div>
      </div>
    </div>
  `;
  // 武器は自由選択(既定=支給武器)。解放済みの主武器から選べる
  const weaponSelect = mnu.query('brief-weapon-select') as HTMLSelectElement;
  const level = mnu.playerLevel();
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
  // R53-W2: ミッション難易度(easy/normal/hard、既定normal)。既存のattach-btnチップ
  // (renderZombieRoundSelectorのR presetsと同じ流儀)を再利用し、選択はmnu.selection
  // (LOADOUT_KEY永続化)へ即保存する
  const diffHost = mnu.query('brief-mission-diff');
  const renderMissionDiff = (): void => {
    const cur = mnu.selection.missionDifficulty ?? 'normal';
    diffHost.innerHTML = DIFFICULTIES.map(
      (d) =>
        `<button type="button" class="attach-btn${d.id === cur ? ' selected' : ''}" data-diff="${d.id}" aria-pressed="${d.id === cur}">${d.label}</button>`,
    ).join('');
    diffHost.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mnu.selection.missionDifficulty = btn.dataset.diff as Difficulty;
        mnu.saveLoadout();
        renderMissionDiff();
      });
    });
  };
  renderMissionDiff();
  mnu.query('deploy-mission').addEventListener('click', () => {
    mnu.callbacks.onStartMission(mission.id, weaponSelect.value, mnu.selection.missionDifficulty);
  });
  mnu.query('brief-back').addEventListener('click', () => {
    mnu.showMain();
    mnu.setMfdPage('campaign');
  });
  mnu.query('deploy-mission').focus({ preventScroll: true });
}

// ── キャンペーン(戦役)画面 ────────────────────────────────────
export function renderCampaign(mnu: MenuScreenHost): void {
  const host = mnu.query('campaign');
  const camp = mnu.profile.campaign;
  const totalStars = Object.values(camp.missionBests).reduce((s, b) => s + b.stars, 0);
  const cleared = camp.clearedMissions.length;
  // R53-W2: 48/144のハードコードをCAMPAIGN駆動へ根治(ch9/ch10追加で60ミッション/★180点)
  const { missions: totalMissions, starsMax } = campaignTotals(CAMPAIGN);
  host.innerHTML = `
    <div class="campaign-head elby-camp-head">
      <div class="campaign-title"><em class="campaign-op">OPERATION <i>//</i> CINDER</em><strong>軌道に灯る火種</strong><span>CINDER 鎮圧作戦</span></div>
      <div class="campaign-stat elby-camp-stat">制圧 <b>${cleared}</b>/${totalMissions} ・ ★<b>${totalStars}</b>/${starsMax}<span class="campaign-bar ig-bar" aria-hidden="true"><i style="transform:scaleX(${(cleared / totalMissions).toFixed(3)})"></i></span></div>
    </div>
    <div class="chapter-list" data-id="chapter-list"></div>
  `;
  const list = host.querySelector<HTMLElement>('[data-id="chapter-list"]');
  if (!list) return;
  for (const chapter of CAMPAIGN) {
    const unlocked = mnu.profile.campaign.unlockedChapters.includes(chapter.id);
    const chClear = chapter.missions.filter((m) => camp.clearedMissions.includes(m.id)).length;
    const card = document.createElement('div');
    card.className = unlocked ? 'chapter-card elby-chapter' : 'chapter-card elby-chapter locked';
    const head = document.createElement('div');
    head.className = 'chapter-card-head';
    head.innerHTML = `
      <span class="chapter-no">${chapter.title}</span>
      <span class="chapter-sub">${unlocked ? chapter.subtitle : '機密 — 前章の制圧で解放'}</span>
      <span class="chapter-prog"><b>${chClear}</b>/${chapter.missions.length}<span class="chapter-prog-bar" aria-hidden="true"><i style="transform:scaleX(${(chClear / chapter.missions.length).toFixed(3)})"></i></span></span>
    `;
    card.appendChild(head);
    if (unlocked) {
      const grid = document.createElement('div');
      grid.className = 'mission-grid';
      for (const mission of chapter.missions) {
        grid.appendChild(mnu.missionChip(mission));
      }
      mnu.stagger(grid); // チップ入場(listitem-in)の--i付与
      card.appendChild(grid);
    }
    list.appendChild(card);
  }
}

export function missionChip(mnu: MenuScreenHost, mission: MissionDef): HTMLElement {
  const camp = mnu.profile.campaign;
  const unlocked = isMissionUnlocked(mnu.profile, mission.id);
  const best = camp.missionBests[mission.id];
  const stars = best ? best.stars : 0;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = unlocked ? 'mission-chip elby-mission' : 'mission-chip elby-mission locked';
  btn.disabled = !unlocked;
  const starHtml = unlocked
    ? `<span class="mission-stars"><b>${'★'.repeat(stars)}</b>${'☆'.repeat(3 - stars)}</span>`
    : '<span class="mission-lock">LOCKED</span>';
  // R53-W2: rewardIdがあるミッション(ch10最終決戦等)に小さな報酬バッジを添える
  const rewardLabel = missionRewardLabel(mission.rewardId);
  const rewardHtml = rewardLabel
    ? `<span class="mission-reward" title="特別報酬: ${rewardLabel}">特別報酬 ${rewardLabel}</span>`
    : '';
  // W-ENZA: 計器行 = PAR(規定時間)+挑戦ラベル(あれば)。計測は等幅の計器層で刻む
  const instHtml = unlocked
    ? `<span class="elby-mission-inst">PAR ${parLabel(mission.parTimeS)}${
        mission.challenge ? `<em>挑戦</em>${mission.challenge.label}` : ''
      }</span>`
    : '';
  btn.innerHTML = `
    <span class="mission-idx">${mission.chapterId.toUpperCase()}-${mission.index + 1}</span>
    <span class="mission-name">${mission.title}</span>
    <span class="mission-sub">${mission.subtitle}</span>
    ${instHtml}
    ${rewardHtml}
    ${starHtml}
  `;
  if (unlocked) btn.addEventListener('click', () => mnu.showBriefing(mission));
  return btn;
}

// ── 本日のチャレンジパネル(IGNITION FRAME 意匠) ─────────────────────
export function renderDailies(mnu: MenuScreenHost): void {
  const panel = mnu.root.querySelector<HTMLElement>('[data-id="daily-panel"]');
  if (!panel) return;

  // 日付が変わっていたらステートをリフレッシュ(表示の一貫性)
  const dateSeed = todayDateSeed();
  const nowDate = dateStringFromSeed(dateSeed);
  refreshDailiesDate(mnu.profile.daily, nowDate);

  const challenges = dailiesFor(dateSeed);
  const daily = mnu.profile.daily;
  const streak = daily.streakDays;

  // 炎アイコン(IGNITION FRAME のスパーク意匠)
  const flameSvg = `<svg class="daily-flame" viewBox="0 0 20 24" aria-hidden="true">
    <path d="M10 2c0 0-1 3.5 1 5.5S13 11 11 14c0 0 2-1 2.5-3.5 1 2 0.5 5-2.5 7C8 19.5 6 17 6 14c0-2.5 2-3.5 2-3.5C6 14 4 16 4 18.5 2.5 16 3 12 5 10 3.5 7.5 4 4 6 2c0 0 0.5 3 2 4 0.5-3 2-4 2-4z"
      fill="currentColor" opacity="0.9"/>
  </svg>`;

  const tiers = [0, 1, 2] as const;
  const rows = tiers.map((i) => {
    const ch = challenges[i];
    const prog = daily.progress[i];
    const claimed = daily.claimed[i];
    const ratio = claimed ? 1 : Math.min(1, prog / ch.target);
    const diffLabel = i === 0 ? 'EASY' : i === 1 ? 'MEDIUM' : 'HARD';
    const diffClass = i === 0 ? 'daily-easy' : i === 1 ? 'daily-medium' : 'daily-hard';
    const checkHtml = claimed
      ? `<span class="daily-check" aria-label="達成済み">✓</span>`
      : `<span class="daily-xp">${ch.rewardXp.toLocaleString()} XP</span>`;
    const progressText = claimed ? `${ch.target}/${ch.target}` : `${prog}/${ch.target}`;
    return `
      <div class="daily-row${claimed ? ' daily-row--done' : ''}">
        <span class="daily-diff ${diffClass}">${diffLabel}</span>
        <span class="daily-label">${ch.label}</span>
        <span class="daily-prog-wrap" aria-label="進捗 ${progressText}">
          <span class="daily-prog-bar"><i style="transform:scaleX(${ratio.toFixed(3)})"></i></span>
          <span class="daily-prog-txt">${progressText}</span>
        </span>
        ${checkHtml}
      </div>`;
  });

  panel.classList.add('elby-daily'); // 焔座様式(冪等)
  panel.innerHTML = `
    <div class="daily-head">
      <span class="daily-title">
        <svg class="daily-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 1L12.5 7H19L14 11.3 16 18 10 14 4 18l2-6.7L1 7h6.5z" fill="currentColor" opacity="0.85"/>
        </svg>
        本日のチャレンジ
      </span>
      <span class="daily-streak" aria-label="連続ログイン${streak}日">
        ${flameSvg}
        <b>${streak}</b><small>日</small>
      </span>
    </div>
    <div class="daily-rows">${rows.join('')}</div>
  `;
}

export function renderChallenges(mnu: MenuScreenHost): void {
  const list = mnu.query('challenges');
  for (const challenge of CHALLENGES) {
    const done = mnu.profile.completedChallenges.includes(challenge.id);
    const [current, goal] = challenge.progress(mnu.profile.stats, mnu.profile.weaponKills);
    const row = document.createElement('div');
    row.className = done ? 'challenge-row elby-chal challenge-done' : 'challenge-row elby-chal';
    row.innerHTML = `
      <span class="challenge-name">${challenge.name}</span>
      <span class="challenge-desc">${challenge.desc}</span>
      <span class="challenge-bar"><i style="width:${done ? 100 : (current / goal) * 100}%"></i></span>
      <span class="challenge-xp">${done ? '達成' : `${challenge.xp} XP`}</span>
    `;
    list.appendChild(row);
  }
  mnu.stagger(list);
}
