// W-ENZA FB8: 武器庫(ARMORY) — 焔座様式(.earm-*)。武器リスト/カード/差分チップ/カモ/アタッチメント/グレネード。
// 様式はenza-armory.css、数値・進捗は全て実データ導出(モック文言のハードコード禁止)。
import '../enza-armory.css';
import { saveProfile } from '../../core/profile';
import { ATTACHMENT_SLOTS, attachmentsForSlot } from '../../game/attachments';
import { OPTIC_SPECS, fitsMagnified } from '../../game/optics';
import { GRENADE_KINDS, GRENADE_SPECS } from '../../game/grenades';
import { isUnlocked, unlockLevelOf } from '../../game/progression';
import {
  CAMO_CLASSES,
  CAMO_IDS,
  CAMO_TIERS,
  CAMO_VISUALS,
  CAMO_WEAPON_IDS,
  camoName,
  camoProgress,
  camoTierFor,
  darkMatterFor,
  diamondFor,
  goldForWeapon,
  isCamoUnlocked,
  isKnownCamoId,
  isKunaiCamoUnlocked,
  kunaiCamoProgress,
  KUNAI_CAMO_IDS,
  REWARD_CAMO_IDS,
  TOKOYAMI_CAMO,
  type CamoId,
} from '../../game/camo';
import type { Profile } from '../../game/progression';
// R53-W2: お守り(CHARMS)/ゾンビパーク(PERKS)は zombie-economy.ts が単一の真実。
// メニューは「継承の守り札」用のcarriedPerk解決(PERKS存在チェックのみ)にZombiePerkIdを使う
import {
  computeWeaponBars,
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  type WeaponClass,
  type WeaponDef,
} from '../../game/weapons';
import type { MenuScreenHost } from './host';
import {
  BAR_AXES,
  CLASS_LABELS,
  CLASS_ORDER,
  GRENADE_DESCS,
  CLASS_SHAPE,
  tracerHex,
  ensureCamoStyle,
  weaponSilSVG,
  computeDerivedStats,
  weaponDiffChips,
  EXOTIC_LORE,
} from './shared';

// ── 焔座の計器層: 実データ導出の純関数(node環境vitestでピン) ─────────────
export function modeLabel(def: WeaponDef): string {
  return def.mode === 'auto'
    ? 'フルオート'
    : def.mode === 'burst'
      ? `バースト${def.burstCount}`
      : '単発';
}

// 武器行のsubline: 発射モード/装弾 + 錬度(=カモ段位)・キル数(実績があるときのみ)
export function weaponSubline(def: WeaponDef, profile: Profile): string {
  const stats = profile.weaponStats[def.id];
  const base = `${modeLabel(def)} / 装弾 ${def.magazineSize}`;
  if (!stats || stats.kills <= 0) return base;
  const tier = camoTierFor(stats);
  const tierPart = tier > 0 ? `錬度${tier} ・ ` : '';
  return `${base} ・ ${tierPart}${stats.kills.toLocaleString('ja-JP')}キル`;
}

// 銘板下の計器kicker: 型番(=武器ID大文字) ・ クラス ・ 発射モード
export function weaponKicker(def: WeaponDef): string {
  return `${def.id.toUpperCase()} ・ ${CLASS_LABELS[def.class]} ・ ${modeLabel(def)}`;
}

// 銘板下の説明文。実スペックからの導出のみ(架空の口径・逸話を書かない)
export function weaponFlavor(def: WeaponDef): string {
  const d = computeDerivedStats(def);
  const head = `${def.name} — ${CLASS_LABELS[def.class]}。`;
  const body = `${modeLabel(def)}で装弾${def.magazineSize}発、有効連射${d.effRpm}rpm。`;
  const tail = `至近の確殺${d.shotsToKill}発、TTK ${d.ttk}ms。`;
  return head + body + tail;
}

// 保有/マスタリーの実カウント(最下部の計器行)
export function masteryCounts(
  profile: Profile,
  level: number,
): { owned: number; total: number; gold: number; diamond: number; darkMatter: number } {
  const owned = PRIMARY_IDS.filter((id) => isUnlocked('weapon', id, level)).length;
  const gold = CAMO_WEAPON_IDS.filter((id) =>
    goldForWeapon(id, profile.weaponStats[id]),
  ).length;
  const diamond = CAMO_CLASSES.filter((cls) => diamondFor(cls, profile.weaponStats)).length;
  const darkMatter = darkMatterFor(profile.weaponStats) ? 1 : 0;
  return { owned, total: PRIMARY_IDS.length, gold, diamond, darkMatter };
}

// 次の錬成目標: 最初の未解除ティアの名前と進捗(全解除ならnull)
export function nextCamoGoal(
  def: WeaponDef,
  profile: Profile,
): { name: string; label: string; current: number; target: number } | null {
  if (!CAMO_WEAPON_IDS.includes(def.id)) return null;
  for (const tier of CAMO_TIERS) {
    if (!isCamoUnlocked(tier.id, def.id, profile.weaponStats, profile.unlockedRewardCamos)) {
      const p = camoProgress(tier.id, def.id, profile.weaponStats);
      return { name: camoName(tier.id), label: p.label, current: p.current, target: p.target };
    }
  }
  return null;
}

export function renderWeapons(mnu: MenuScreenHost): void {
  const list = mnu.query('weapons');
  const tabsHost = mnu.query('wclass-tabs');
  list.innerHTML = '';
  tabsHost.innerHTML = '';
  const level = mnu.playerLevel();
  // 保存されていた選択がロック中(記録の読み込み直後など)なら初期武器へ戻す
  if (!isUnlocked('weapon', mnu.selection.primaryId, level)) {
    mnu.selection.primaryId = 'kaede-ar';
  }
  // 武器を持つクラスだけタブ化(空クラスは出さない)
  const classes = CLASS_ORDER.filter((cls) =>
    PRIMARY_IDS.some((id) => WEAPON_DEFS[id]?.class === cls),
  );
  // 全28枚を1グリッドへ入れておき、タブで表示クラスだけ display させる
  // (data-cls=絞り込み用 / data-weapon=選択用。タブには data-weapon を付けない)
  for (const cls of classes) {
    for (const id of PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls)) {
      list.appendChild(mnu.weaponCard(id, 'primary'));
    }
  }
  mnu.stagger(list); // 入場アニメ(listitem-in)の--i付与
  for (const cls of classes) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = cls === 'exotic' ? 'wcls-tab wcls-tab--exotic' : 'wcls-tab';
    tab.dataset.cls = cls;
    tab.setAttribute('role', 'tab');
    // 焔座: クラス名+所属武器数の計器バッジ(実カウント)。EXOTICは菱紋を先頭に
    const count = PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls).length;
    const mark = cls === 'exotic' ? '<i class="earm-tab-diamond" aria-hidden="true"></i>' : '';
    tab.innerHTML = `${mark}<span>${CLASS_LABELS[cls]}</span><b class="enza-num">${count}</b>`;
    tab.addEventListener('click', () => mnu.showWeaponClass(cls));
    tabsHost.appendChild(tab);
  }
  // 既定タブ=選択中の主武器のクラス(初期は数枚のみペイント=28枚一括より軽い)
  const activeCls = WEAPON_DEFS[mnu.selection.primaryId]?.class ?? classes[0] ?? 'ar';
  mnu.showWeaponClass(activeCls);
  mnu.markSelected(list, 'weapon', mnu.selection.primaryId);
  mnu.refreshDiffChips('primary');
  mnu.previewWeapon(mnu.currentPrimaryDef());
}

// 表示クラスの切替。該当クラス以外のカードを display:none(.off)にし、タブの選択状態を更新する
export function showWeaponClass(mnu: MenuScreenHost, cls: WeaponClass): void {
  const list = mnu.query('weapons');
  list.querySelectorAll<HTMLElement>('.weapon-card').forEach((card) => {
    card.classList.toggle('off', card.dataset.cls !== cls);
  });
  const tabs = mnu.query('wclass-tabs');
  tabs.querySelectorAll<HTMLElement>('.wcls-tab').forEach((tab) => {
    const on = tab.dataset.cls === cls;
    tab.classList.toggle('selected', on);
    tab.setAttribute('aria-selected', String(on));
  });
  // R53 MK.III: EXOTICタブ選択中は神殿(紫金)モードへ(グリッド+プレビュー祭壇の両方)
  const shrine = cls === 'exotic';
  list.classList.toggle('mk3m-exotic-shrine', shrine);
  mnu.root.querySelector('.armory-preview')?.classList.toggle('mk3m-exotic-shrine', shrine);
}

export function renderSecondaries(mnu: MenuScreenHost): void {
  const list = mnu.query('secondaries');
  list.innerHTML = '';
  const level = mnu.playerLevel();
  if (!isUnlocked('weapon', mnu.selection.secondaryId, level)) mnu.selection.secondaryId = 'suzume';
  // 副武器はハンドガン1クラスのためタブ無しでグリッド直描画
  for (const id of SECONDARY_IDS) list.appendChild(mnu.weaponCard(id, 'secondary'));
  mnu.stagger(list);
  mnu.markSelected(list, 'weapon2', mnu.selection.secondaryId);
  mnu.refreshDiffChips('secondary');
}

// 主/副共通の武器カード。クリックで選択し3Dプレビュー+ステータスを更新する
export function weaponCard(
  mnu: MenuScreenHost,
  id: string,
  slot: 'primary' | 'secondary',
): HTMLButtonElement {
  const def = WEAPON_DEFS[id] ?? WEAPON_DEFS['kaede-ar']!;
  const level = mnu.playerLevel();
  const unlocked = isUnlocked('weapon', id, level);
  const isExotic = def.class === 'exotic';
  const card = document.createElement('button');
  card.type = 'button';
  const baseClass = unlocked ? 'weapon-card' : 'weapon-card locked';
  card.className = isExotic ? `${baseClass} exotic` : baseClass;
  const key = slot === 'primary' ? 'weapon' : 'weapon2';
  card.dataset[key] = id;
  card.dataset.cls = def.class; // タブ絞り込み用(副武器グリッドでは未使用=無害)
  const lockNote = unlocked
    ? ''
    : `<span class="locked-note">Lv ${unlockLevelOf('weapon', id)} で解放</span>`;
  const shape = def.shape ?? CLASS_SHAPE[def.class] ?? 'rifle';
  const exoticBadge = isExotic
    ? `<span class="exotic-badge" aria-label="特殊兵装">EXOTIC</span>`
    : '';
  // 焔座: シルエット左+銘/計器sublineの行構成(選択=片刃切りの熾火面)。既存クラス名は
  // markSelected('selected')と差分チップ('.mk3m-diff')の互換のため温存する
  card.innerHTML =
    `<span class="weapon-sil" aria-hidden="true">${weaponSilSVG(shape, def.tracerColor)}</span>` +
    `<span class="earm-wtext">` +
    `<span class="weapon-name">${def.name}</span>` +
    `<span class="weapon-mode enza-num">${weaponSubline(def, mnu.profile)}</span>` +
    `</span>` +
    `<span class="mk3m-diff" aria-hidden="true"></span>${exoticBadge}${lockNote}`;
  if (!unlocked) {
    card.disabled = true;
    return card;
  }
  card.addEventListener('click', () => {
    if (slot === 'primary') {
      mnu.selection.primaryId = id;
      mnu.markSelected(mnu.query('weapons'), 'weapon', id);
      // R14: 先に光学の適合ゲートを再評価して不適合な倍率光学を外し(syncAttachmentsで
      // selection.attachmentsも更新)、その確定ロードアウトでプレビュー/数値を描く(順序重要)
      mnu.renderAttachments();
      mnu.previewWeapon(mnu.currentPrimaryDef());
      mnu.renderBriefing();
    } else {
      mnu.selection.secondaryId = id;
      mnu.markSelected(mnu.query('secondaries'), 'weapon2', id);
      mnu.previewWeapon(def);
    }
    // MK.III: 装備が変わったので全カードの差分チップを引き直す
    mnu.refreshDiffChips(slot);
  });
  return card;
}

// R53 MK.III: 各武器カードの「装備中との差分」チップを更新する。
// 基礎def同士(アタッチメント無し)の比較=カードの表示条件と揃える。装備中カードは空。
export function refreshDiffChips(mnu: MenuScreenHost, slot: 'primary' | 'secondary'): void {
  const listId = slot === 'primary' ? 'weapons' : 'secondaries';
  const equippedId = slot === 'primary' ? mnu.selection.primaryId : mnu.selection.secondaryId;
  const equipped = WEAPON_DEFS[equippedId];
  if (!equipped) return;
  const key = slot === 'primary' ? 'weapon' : 'weapon2';
  mnu
    .query(listId)
    .querySelectorAll<HTMLElement>('.weapon-card')
    .forEach((card) => {
      const host = card.querySelector<HTMLElement>('.mk3m-diff');
      if (!host) return;
      const id = card.dataset[key];
      const def = id ? WEAPON_DEFS[id] : undefined;
      if (!def || card.classList.contains('locked')) {
        host.innerHTML = '';
        return;
      }
      host.innerHTML = weaponDiffChips(def, equipped)
        .map(
          (c) =>
            `<i class="${c.better ? 'up' : 'down'}">${c.label}${c.delta > 0 ? '+' : ''}${c.delta}</i>`,
        )
        .join('');
    });
}

// 3Dプレビューとステータス読み出しを更新する(プレビュー未生成なら読み出しのみ)
export function previewWeapon(mnu: MenuScreenHost, def: WeaponDef): void {
  mnu.weaponPreview?.setWeapon(def);
  mnu.renderArmoryReadout(def);
}

export function renderArmoryReadout(mnu: MenuScreenHost, def: WeaponDef): void {
  const name = mnu.root.querySelector<HTMLElement>('[data-id="armory-wname"]');
  const barsEl = mnu.root.querySelector<HTMLElement>('[data-id="armory-bars"]');
  const statsEl = mnu.root.querySelector<HTMLElement>('[data-id="armory-stats"]');
  if (!name || !barsEl || !statsEl) return;
  // 焔座の銘板: 白鋼面に黒銘+計器kicker+実スペック導出の説明文。右肩にカモ実績チップ
  const camoSupported = CAMO_WEAPON_IDS.includes(def.id) || def.id === 'fists';
  const camoChipHtml = ((): string => {
    if (!camoSupported) return '';
    const ids = def.id === 'fists' ? KUNAI_CAMO_IDS : CAMO_IDS;
    const unlocked =
      def.id === 'fists'
        ? ids.filter((id) => isKunaiCamoUnlocked(id, mnu.profile.weaponStats['fists'])).length
        : ids.filter((id) =>
            isCamoUnlocked(id, def.id, mnu.profile.weaponStats, mnu.profile.unlockedRewardCamos),
          ).length;
    const equippedId = mnu.profile.selectedCamos[def.id];
    const equippedChip =
      equippedId && isKnownCamoId(equippedId)
        ? `<span class="earm-chip earm-chip--on">${camoName(equippedId)}</span>`
        : '';
    return `${equippedChip}<span class="earm-chip enza-num">カモ ${unlocked}/${ids.length}</span>`;
  })();
  name.innerHTML =
    `<div class="earm-namerow">` +
    `<span class="earm-nameplate">${def.name}</span>` +
    `<span class="earm-name-chips">${camoChipHtml}</span>` +
    `</div>` +
    `<p class="earm-kicker enza-num">${weaponKicker(def)}</p>` +
    `<p class="earm-flavor">${weaponFlavor(def)}</p>`;
  // 主ステータスはBO3語彙の横バー(10分割セグメント点火バー)を維持する
  const bars = computeWeaponBars(def);
  barsEl.innerHTML = BAR_AXES.map(([k, label]) => mnu.bar(label, bars[k])).join('');
  // 派生スタットの計器行(TTK/RPM/確殺/DPS/装弾。予備弾は無限=+∞が実仕様)
  const d = computeDerivedStats(def);
  const vault = masteryCounts(mnu.profile, mnu.playerLevel());
  statsEl.innerHTML =
    `<span class="earm-inst enza-num">TTK <b>${d.ttk}</b><em>ms</em> ・ <b>${d.effRpm}</b><em>rpm</em> ・ <b>${def.magazineSize}</b><em>発+∞</em></span>` +
    `<span class="earm-inst enza-num">DPS <b>${d.dps}</b> ・ 確殺 <b>${d.shotsToKill}</b><em>発</em></span>` +
    `<span class="earm-vault enza-num">保有 <b>${vault.owned}/${vault.total}</b> ・ ゴールド<b>${vault.gold}</b> ・ ダイヤ<b>${vault.diamond}</b> ・ ダークマター<b>${vault.darkMatter}</b></span>`;
  // R53 MK.III: EXOTIC神殿の奥義解説カード(溜め攻撃/Mウルト)
  const loreEl = mnu.root.querySelector<HTMLElement>('[data-id="armory-exotic"]');
  if (loreEl) {
    const lore = def.class === 'exotic' ? EXOTIC_LORE[def.id] : undefined;
    loreEl.hidden = !lore;
    loreEl.innerHTML = lore
      ? `<div class="mk3m-lore-row">
           <div class="mk3m-lore-head"><span class="mk3m-lore-kind">溜メ攻撃</span><span class="mk3m-lore-name">${lore.charge}</span><span class="mk3m-lore-how">${lore.chargeHow}</span></div>
           <p class="mk3m-lore-desc">${lore.chargeDesc}</p>
         </div>
         <div class="mk3m-lore-row">
           <div class="mk3m-lore-head"><span class="mk3m-lore-kind">Mウルト</span><span class="mk3m-lore-name">${lore.ult}</span><span class="mk3m-lore-how">ゲージ満タン+M</span></div>
           <p class="mk3m-lore-desc">${lore.ultDesc}</p>
         </div>`
      : '';
  }
  mnu.renderCamoSection(def);
}

// ── 武器カモ(BO2/BO3式チャレンジ)────────────────────────────────
// 解除済みチップ=クリックで装備、未解除=ロック表示+条件と進捗。ダイヤ/ダークマターは
// マスタリー特別枠。装備はプロファイルへ即保存し、3Dプレビューを作り直して反映する。
export function renderCamoSection(mnu: MenuScreenHost, def: WeaponDef): void {
  const host = mnu.root.querySelector<HTMLElement>('[data-id="armory-camo"]');
  if (!host) return;
  if (def.id === 'fists') {
    mnu.renderKunaiCamoSection(def, host);
    return;
  }
  if (!CAMO_WEAPON_IDS.includes(def.id)) {
    // 副武器はカモ非対応 — セクションを完全に隠さず注記を表示する
    host.hidden = false;
    host.innerHTML = '<p class="camo-unsupported">副武器はカモ非対応</p>';
    return;
  }
  ensureCamoStyle();
  host.hidden = false;
  // R53-W2: 報酬カモ(jingai/shinrai)はunlockedRewardCamosを渡さないと常に未解放判定
  // になる(CAMO_IDSには含まれるため、渡し忘れると分母だけ増えて数が合わなくなる)
  const unlockedCount = CAMO_IDS.filter((id) =>
    isCamoUnlocked(id, def.id, mnu.profile.weaponStats, mnu.profile.unlockedRewardCamos),
  ).length;
  // 焔座: 装備中カモ名+次の錬成目標(実進捗)をヘッダへ
  const equippedCamoId = mnu.profile.selectedCamos[def.id];
  const goal = nextCamoGoal(def, mnu.profile);
  const goalLine = goal
    ? `<p class="earm-camo-next enza-num">次の錬成: ${goal.name} — ${goal.label} <b>${goal.current}/${goal.target}</b></p>`
    : '';
  host.innerHTML = `
    <div class="camo-head"><span>カモフラージュ</span><span class="earm-camo-equip">装備中: <b>${equippedCamoId && isKnownCamoId(equippedCamoId) ? camoName(equippedCamoId) : 'なし'}</b></span><b class="enza-num">${unlockedCount}/${CAMO_IDS.length}</b></div>
    ${goalLine}
    <div class="camo-grid" data-id="camo-grid"></div>
    <div class="camo-grid camo-grid--mastery" data-id="camo-mastery"></div>
  `;
  const grid = host.querySelector<HTMLElement>('[data-id="camo-grid"]');
  const masteryGrid = host.querySelector<HTMLElement>('[data-id="camo-mastery"]');
  if (!grid || !masteryGrid) return;
  const equipped = mnu.profile.selectedCamos[def.id] ?? null;
  grid.appendChild(mnu.camoChip(def, null, equipped));
  for (const tier of CAMO_TIERS) grid.appendChild(mnu.camoChip(def, tier.id, equipped));
  masteryGrid.appendChild(mnu.camoChip(def, 'diamond', equipped, true));
  masteryGrid.appendChild(mnu.camoChip(def, 'dark-matter', equipped, true));
  // R53-W2: 報酬カモ(ストーリー章クリア報酬)。マスタリー枠に追加表示する
  for (const id of REWARD_CAMO_IDS) masteryGrid.appendChild(mnu.camoChip(def, id, equipped, true));
}

// クナイ(fists)専用カモセクション: 9段+常闇
export function renderKunaiCamoSection(
  mnu: MenuScreenHost,
  def: WeaponDef,
  host: HTMLElement,
): void {
  ensureCamoStyle();
  host.hidden = false;
  const kunaiStats = mnu.profile.weaponStats['fists'];
  const unlockedCount = KUNAI_CAMO_IDS.filter((id) => isKunaiCamoUnlocked(id, kunaiStats)).length;
  const kunaiEquipped = mnu.profile.selectedCamos[def.id];
  host.innerHTML = `
    <div class="camo-head"><span>カモフラージュ</span><span class="earm-camo-equip">装備中: <b>${kunaiEquipped && isKnownCamoId(kunaiEquipped) ? camoName(kunaiEquipped) : 'なし'}</b></span><b class="enza-num">${unlockedCount}/${KUNAI_CAMO_IDS.length}</b></div>
    <div class="camo-grid" data-id="camo-grid"></div>
    <div class="camo-grid camo-grid--mastery" data-id="camo-mastery"></div>
  `;
  const grid = host.querySelector<HTMLElement>('[data-id="camo-grid"]');
  const masteryGrid = host.querySelector<HTMLElement>('[data-id="camo-mastery"]');
  if (!grid || !masteryGrid) return;
  const equipped = mnu.profile.selectedCamos[def.id] ?? null;
  grid.appendChild(mnu.camoChip(def, null, equipped));
  for (const tier of CAMO_TIERS)
    grid.appendChild(mnu.camoChip(def, tier.id, equipped, false, true));
  masteryGrid.appendChild(mnu.camoChip(def, TOKOYAMI_CAMO.id, equipped, true, true));
}

// カモチップ1枚。camoId=null は「なし(標準の質感)」。kunai=true はクナイ専用判定
export function camoChip(
  mnu: MenuScreenHost,
  def: WeaponDef,
  camoId: CamoId | null,
  equipped: string | null,
  mastery = false,
  kunai = false,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (camoId === null) {
    const on = equipped === null;
    btn.className = `camo-chip camo-none${on ? ' selected' : ''}`;
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML =
      '<i class="camo-swatch"></i><span class="camo-name">なし</span><span class="camo-sub">標準の質感</span>';
    btn.addEventListener('click', () => mnu.equipCamo(def, null));
    return btn;
  }
  const v = CAMO_VISUALS[camoId];
  const unlocked = kunai
    ? isKunaiCamoUnlocked(camoId, mnu.profile.weaponStats['fists'])
    : isCamoUnlocked(camoId, def.id, mnu.profile.weaponStats, mnu.profile.unlockedRewardCamos);
  const on = unlocked && equipped === camoId;
  const swatch = `background:linear-gradient(135deg, ${tracerHex(v.colorA)} 0%, ${tracerHex(v.colorB)} 55%, ${tracerHex(v.colorC)} 100%)`;
  btn.className = `camo-chip${mastery ? ' mastery' : ''}${on ? ' selected' : ''}${unlocked ? '' : ' locked'}`;
  btn.setAttribute('aria-pressed', String(on));
  if (unlocked) {
    btn.innerHTML =
      `<i class="camo-swatch" style="${swatch}"></i>` +
      `<span class="camo-name">${camoName(camoId)}</span>` +
      `<span class="camo-sub">${on ? '装備中' : '解除済み'}</span>`;
    btn.addEventListener('click', () => mnu.equipCamo(def, camoId));
    return btn;
  }
  // 未解除: 条件テキスト + 進捗 n/条件(バー付き)。クリック不可
  const p = kunai
    ? kunaiCamoProgress(camoId, mnu.profile.weaponStats['fists'])
    : camoProgress(camoId, def.id, mnu.profile.weaponStats);
  const ratio = p.target > 0 ? Math.min(1, p.current / p.target) : 0;
  btn.disabled = true;
  btn.title = p.label;
  btn.innerHTML =
    `<i class="camo-swatch" style="${swatch}"></i>` +
    `<span class="camo-name">${camoName(camoId)}</span>` +
    `<span class="camo-sub">${p.label}</span>` +
    `<span class="camo-bar"><i style="transform:scaleX(${ratio.toFixed(3)})"></i></span>` +
    `<span class="camo-sub camo-prog">${p.current}/${p.target}</span>`;
  return btn;
}

// カモを装備(null=外す)してプロファイルへ保存し、プレビューを再構築する
export function equipCamo(mnu: MenuScreenHost, def: WeaponDef, camoId: CamoId | null): void {
  if (camoId === null) delete mnu.profile.selectedCamos[def.id];
  else mnu.profile.selectedCamos[def.id] = camoId;
  saveProfile(mnu.profile);
  // buildGunBody がプロファイルから装備カモを解決するので、作り直しだけで反映される
  mnu.previewWeapon(mnu.currentPrimaryDef());
}

// 10分割セグメント点火バー(0..10)。左から value 個を点灯。box-shadow glow は使わない。
export function bar(_mnu: MenuScreenHost, label: string, value: number): string {
  const v = Math.max(0, Math.min(10, Math.round(value)));
  let segs = '';
  for (let i = 0; i < 10; i += 1) segs += i < v ? '<i class="on"></i>' : '<i></i>';
  return (
    `<span class="stat-seg-row"><span class="stat-seg-label">${label}</span>` +
    `<span class="stat-bar--seg">${segs}</span>` +
    `<span class="stat-seg-num">${v}</span></span>`
  );
}

export function renderAttachments(mnu: MenuScreenHost): void {
  const panel = mnu.query('attachments');
  // R14: 冪等化。武器切替で再実行されるため、既存行をクリアしないとスロット行が重複増殖する
  panel.replaceChildren();
  const level = mnu.playerLevel();
  // R13: 光学の武器適合ゲート。内蔵スコープ機(狙撃/DMR)や拳銃系に倍率光学を出さない
  // (装着すると視覚はネイティブのまま・ズームだけ静かに書き換わる split-brain を防ぐ)。
  const primaryDef = mnu.currentPrimaryDef();
  const opticFits = (id: string): boolean => {
    const spec = OPTIC_SPECS[id];
    if (spec?.fits) return spec.fits(primaryDef);
    // R14: telescopic は OPTIC_SPECS 外の倍率サイト。内蔵スコープ機/拳銃系には付けない
    // (spec 未登録だと従来 opticFits が true に短絡しゲートを素通りしていた)
    if (id === 'telescopic') return fitsMagnified(primaryDef);
    return true;
  };
  for (const { slot, label } of ATTACHMENT_SLOTS) {
    // ロック中/この武器に適合しないアタッチメントが選択に残っていたら外す
    const selected = mnu.attachmentBySlot[slot];
    if (
      selected &&
      (!isUnlocked('attachment', selected, level) || (slot === 'sight' && !opticFits(selected)))
    ) {
      mnu.attachmentBySlot[slot] = null;
    }
    const row = document.createElement('div');
    row.className = 'attach-row';
    const name = document.createElement('span');
    name.className = 'attach-slot';
    name.textContent = label;
    row.appendChild(name);

    const buttons = document.createElement('div');
    buttons.className = 'attach-options';
    const choices: Array<{ id: string | null; text: string; title: string }> = [
      { id: null, text: 'なし', title: '' },
      ...attachmentsForSlot(slot)
        .filter((a) => slot !== 'sight' || opticFits(a.id))
        .map((a) => ({
          id: a.id,
          text: a.name,
          title: a.cons === 'なし' ? a.pros : `${a.pros} / ${a.cons}`,
        })),
    ];
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.className = 'attach-btn';
      btn.textContent = choice.text;
      if (choice.title) btn.title = choice.title;
      btn.dataset.attach = choice.id ?? 'none';
      if (choice.id && !isUnlocked('attachment', choice.id, level)) {
        btn.classList.add('locked');
        btn.disabled = true;
        btn.title = `Lv ${unlockLevelOf('attachment', choice.id)} で解放`;
        buttons.appendChild(btn);
        continue;
      }
      btn.addEventListener('click', () => {
        mnu.attachmentBySlot[slot] = choice.id;
        mnu.syncAttachments();
        buttons.querySelectorAll('.attach-btn').forEach((node) => {
          const on = (node as HTMLElement).dataset.attach === (choice.id ?? 'none');
          node.classList.toggle('selected', on);
          node.setAttribute('aria-pressed', String(on));
        });
        // アタッチメント変更を3Dプレビュー/ステータスへ即反映
        mnu.previewWeapon(mnu.currentPrimaryDef());
        mnu.renderBriefing();
      });
      const active = (mnu.attachmentBySlot[slot] ?? 'none') === (choice.id ?? 'none');
      btn.classList.toggle('selected', active);
      btn.setAttribute('aria-pressed', String(active));
      buttons.appendChild(btn);
    }
    row.appendChild(buttons);
    panel.appendChild(row);
  }
  mnu.syncAttachments();
}

export function renderGrenades(mnu: MenuScreenHost): void {
  const list = mnu.query('grenades');
  for (const kind of GRENADE_KINDS) {
    const spec = GRENADE_SPECS[kind];
    const card = document.createElement('button');
    card.className = 'grenade-card';
    card.dataset.grenade = kind;
    card.innerHTML = `
      <span class="grenade-name">${spec.name} <span class="grenade-carry">x ${spec.carry}</span></span>
      <span class="grenade-desc">${GRENADE_DESCS[kind]}</span>
    `;
    card.addEventListener('click', () => {
      mnu.selection.grenade = kind;
      mnu.markSelected(list, 'grenade', kind);
      mnu.renderBriefing();
    });
    list.appendChild(card);
  }
  mnu.stagger(list);
  mnu.markSelected(list, 'grenade', mnu.selection.grenade);
}
