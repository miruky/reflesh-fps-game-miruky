import '../mk3-menu.css';
import '../mk3-phase2.css'; // R54-F7: ハイライトカード/フォトモード様式(p2-)
import { easeOutCubic } from '../core/easing';
import { BUILD_LABEL } from '../version';
import {
  GP_LAYOUTS,
  PRESETS,
  glyphFor,
  type GamepadBinding,
  type GamepadBindings,
  type PadAction,
} from '../core/gamepad';
import type { Input, UiNav } from '../core/input';
import { exportProfile, importProfile, saveProfile } from '../core/profile';
import {
  dailiesFor,
  dateStringFromSeed,
  refreshDailiesDate,
  todayDateSeed,
} from '../game/dailies';
import {
  DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  MATCH_LENGTHS,
  RETICLE_COLORS,
  RETICLE_STYLES,
  SETTING_BOUNDS,
  UI_ACCENTS,
  saveSettings,
  type GamepadResponseCurve,
  type GraphicsQuality,
  type Settings,
} from '../core/settings';
import {
  applyAttachments,
  ATTACHMENT_DEFS,
  ATTACHMENT_SLOTS,
  attachmentsForSlot,
  type AttachmentSlot,
} from '../game/attachments';
import { OPTIC_SPECS, fitsMagnified } from '../game/optics';
import type { Difficulty } from '../game/bot';
import { GRENADE_KINDS, GRENADE_SPECS, type GrenadeKind } from '../game/grenades';
import type { MatchResult } from '../game/match';
import { MODE_DEFS, MODE_IDS, type GameMode } from '../game/modes';
import { CAMPAIGN, missionById, nextMissionId, type MissionDef } from '../game/campaign';
import {
  CHALLENGES,
  CHARM_IDS,
  isMissionUnlocked,
  isUnlocked,
  levelFromXp,
  levelRankUpgrade,
  rankFromRating,
  rankNameFor,
  unlockLevelOf,
  type CampaignProgress,
  type CharmId,
  type MatchProgress,
  type Profile,
} from '../game/progression';
import {
  CAMO_IDS,
  CAMO_TIERS,
  CAMO_VISUALS,
  CAMO_WEAPON_IDS,
  camoName,
  camoProgress,
  isCamoId,
  isCamoUnlocked,
  isKunaiCamoUnlocked,
  kunaiCamoProgress,
  KUNAI_CAMO_IDS,
  REWARD_CAMO_IDS,
  TOKOYAMI_CAMO,
  type CamoId,
} from '../game/camo';
// R53-W2: お守り(CHARMS)/ゾンビパーク(PERKS)は zombie-economy.ts が単一の真実。
// メニューは「継承の守り札」用のcarriedPerk解決(PERKS存在チェックのみ)にZombiePerkIdを使う
import { CHARMS, PERKS, type ZombiePerkId } from '../game/zombie-economy';
import { STAGES, stagesForMode } from '../game/stages';
import { TEAM_PALETTES } from '../game/teamcolors';
import type { SpaceBg } from './menu-bg';
import { WeaponPreview } from '../render/weapon-preview';
import { requestStageThumb } from '../render/stage-thumbs';
import {
  computeWeaponBars,
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  type ViewModelShape,
  type WeaponClass,
  type WeaponDef,
} from '../game/weapons';

export interface MenuSelection {
  stageId: string;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
  secondaryId: string;
  // ゾンビモード専用: 開始ラウンド(1-50)。他モードでは無視される
  zombieStartRound?: number;
  hellMode?: boolean;
  allGiantMode?: boolean;
  // R54-F5 ゾンビ・ローグラン「輪廻」。ゾンビ選択時のみ有効。
  // 排他: charm/carriedPerk/zombieStartRound/hellMode/allGiantMode(純度優先v1)
  rogueRun?: boolean;
  // ── R53-W2: MatchConfigへ名前凍結で受け渡す拡張フィールド(match.ts側の消費はM2a/M2b) ──
  // ストーリーミッションの難易度上書き(ブリーフィング画面で選択)。既定=normal
  missionDifficulty?: Difficulty;
  // ゾンビモード: 装備中のお守り(profile.charms.equippedと同期)
  charm?: CharmId;
  // ゾンビモード: 「継承の守り札」装備時のみ、前試合から引き継ぐパーク1種
  carriedPerk?: ZombiePerkId;
}

export interface MenuCallbacks {
  onStart: (selection: MenuSelection) => void;
  // primaryId 省略時はミッションの支給武器で出撃する。missionDifficulty省略時はnormal相当
  onStartMission: (missionId: string, primaryId?: string, missionDifficulty?: Difficulty) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChanged: () => void;
  // R54-F7 フォトモード(ポーズ画面から遷移。main.ts が mode='photo' へ切り替える)
  onPhoto: () => void;
}

// 6軸ステータスバーの表示順とラベル(値は computeWeaponBars で WeaponDef から導出)
const BAR_AXES: ReadonlyArray<[keyof ReturnType<typeof computeWeaponBars>, string]> = [
  ['power', '威力'],
  ['rate', '連射'],
  ['control', '制御'],
  ['range', '射程'],
  ['mobility', '機動'],
  ['handling', '取回'],
];

// クラスの表示名(ARMORYのグループ見出し)
const CLASS_LABELS: Record<WeaponClass, string> = {
  ar: 'アサルトライフル',
  smg: 'サブマシンガン',
  marksman: 'マークスマン',
  sniper: 'スナイパー',
  shotgun: 'ショットガン',
  br: 'バトルライフル',
  lmg: 'ライトマシンガン',
  pistol: 'ハンドガン',
  launcher: 'ロケットランチャー',
  exotic: '特殊兵装',
};
const CLASS_ORDER: readonly WeaponClass[] = [
  'ar',
  'smg',
  'br',
  'marksman',
  'sniper',
  'shotgun',
  'lmg',
  'pistol',
  'launcher',
  'exotic', // 特殊兵装タブ(最後尾=視覚的に「別格」を表現)
];

const GRENADE_DESCS: Record<GrenadeKind, string> = {
  frag: '長押しでクッキング。爆発範囲ダメージ',
  smoke: '視線を遮る煙幕を張る',
  flash: '視界を白く焼く。正面で食らうと長い',
  incendiary: '着弾点に燃え続ける火災を残す',
};

const LOADOUT_KEY = 'hibana.loadout.v1';

const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: '新兵', desc: '反応が遅く、よく外す' },
  { id: 'normal', label: '兵士', desc: '標準的な腕前' },
  { id: 'hard', label: '精鋭', desc: '反応が速く、正確に当てる' },
];

// ── R53-W2: 戦役の合計ミッション/星満点を CAMPAIGN から算出する純関数 ──────────
// renderCampaign のヘッダー(「制圧 n/合計」「★ n/満点」)が48/144のハードコードに
// なっていた(ch9/ch10追加で60ミッション/★180点に着地済み)欠落の根治。章数が今後
// 増減しても自動追従する。星は1ミッションにつき最大3。
export function campaignTotals(campaign: readonly { missions: readonly unknown[] }[]): {
  missions: number;
  starsMax: number;
} {
  const missions = campaign.reduce((sum, c) => sum + c.missions.length, 0);
  return { missions, starsMax: missions * 3 };
}

// ── R53-W2: ミッション報酬(rewardId)の表示名解決。camo.tsの報酬カモ以外の
// rewardIdが将来増えても、未知IDはnullを返し安全に非表示化する(バッジを出さない) ──
export function missionRewardLabel(rewardId: string | undefined): string | null {
  if (!rewardId || !isCamoId(rewardId)) return null;
  return camoName(rewardId);
}

// ── R53-W2: お守り(charm)チップの表示状態。未解放/解放済み/装備中の3値に純化する ──
export function charmChipStatus(
  charms: { unlocked: readonly CharmId[]; equipped: CharmId | null } | undefined,
  id: CharmId,
): 'locked' | 'unlocked' | 'equipped' {
  const unlocked = charms?.unlocked.includes(id) ?? false;
  if (!unlocked) return 'locked';
  return charms?.equipped === id ? 'equipped' : 'unlocked';
}

// ── R53-W2: 「継承の守り札」(perkcarry)用、前試合最終パークの引き継ぎ ──────────
// 取得手段の調査結果: MatchResult/MatchSummary(match.ts/progression.ts)はゾンビの
// 最終パーク構成を保持しない(HUD用のMatchSnapshot.zombiePerksのみが試合中に存在し、
// 結果画面到達時点では失われる)。profile側にも該当フィールドは無い。そのため
// 「今試合で最初に購入したパークを次試合の開始時に引き継ぐ」方式のlocalStorage小物を
// ここに用意する(読み取り専用)。書き込み(初回パーク購入時にこのキーへ保存する処理)は
// match.ts側(ゾンビ経済オーナー)の担当であり、本ラウンドのmenu.ts担当スコープ外のため
// 未配線。キーが存在しない/不正値の間はcarriedPerkが常にundefinedになるだけで安全。
// W4D-NIT: キーの単一の真実は zombie-economy.ts(match側の書き込みと共有)。再exportで互換維持
export { LAST_ZOMBIE_PERK_KEY } from '../game/zombie-economy';
import { LAST_ZOMBIE_PERK_KEY } from '../game/zombie-economy';
export function readLastZombiePerk(
  storage: Pick<Storage, 'getItem'> = localStorage,
): ZombiePerkId | null {
  try {
    const raw = storage.getItem(LAST_ZOMBIE_PERK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' && Object.prototype.hasOwnProperty.call(PERKS, parsed)
      ? (parsed as ZombiePerkId)
      : null;
  } catch {
    return null;
  }
}

// charm==='perkcarry' のときのみ、直近の保存パークを carriedPerk として解決する純関数
export function resolveCarriedPerk(
  charm: CharmId | undefined,
  stored: ZombiePerkId | null,
): ZombiePerkId | undefined {
  return charm === 'perkcarry' ? (stored ?? undefined) : undefined;
}

// ── R53-W2: 称号(profile.titles)。表示順=解放順のため、最新は配列末尾 ──────────
export function latestTitle(titles: readonly string[] | undefined): string | null {
  return titles && titles.length > 0 ? (titles[titles.length - 1] ?? null) : null;
}

// セクションヘッダーは keys='' とし、renderControls で grid-column: 1/-1 のスパンセルとして描画
const CONTROLS: Array<[string, string]> = [
  // ── 基本操作 ──
  ['', '基本操作'],
  ['移動', 'W A S D'],
  ['視点', 'マウス'],
  ['射撃', '左クリック'],
  ['ADS(覗き込み)', '右クリック'],
  ['ジャンプ / よじ登り', 'Space(空中で前進)'],
  ['スラスト二段ジャンプ', '空中で Space'],
  ['しゃがみ', 'C / 左Ctrl'],
  ['スプリント', '左Shift'],
  ['スライディング', 'スプリント中に C'],
  ['スライドジャンプ', 'スライド中に Space'],
  ['ウォールラン', '壁沿いを空中で前進(自動)'],
  ['ウォールジャンプ', 'ウォールラン中に Space'],
  ['リーン', 'Q / E'],
  ['リロード', 'R'],
  ['武器切替', '1 / 2 / ホイール'],
  ['グレネード', 'G 長押しで構え、離して投擲'],
  ['投擲物切替', 'H'],
  ['近接攻撃', 'V'],
  ['息止め(スコープ)', 'Shift(覗き込み中に揺れを止める)'],
  ['スコアボード', 'Tab'],
  ['ポーズ', 'Esc'],
  // ── スコアストリーク ──
  ['', 'スコアストリーク'],
  ['ストリーク装備(3枠)', '3 / 4 / 5 キー(選択) → 試合中に発動'],
  ['ストリーク発動(スロット)', '3(1番) / 4(2番) / 5(3番)'],
  ['ケアパッケージ開封', 'E(投下されたクレートの前で押す)'], // W4C C-4: 展開(発動)と開封の混同を修正
  // ── 特殊兵装 / クナイ奥義 ──
  ['', 'クナイ奥義 (クナイ選択時)'],
  ['アルティメット(F技)', 'F — 衝撃波/シュヴァルツヴァルト(黒帝中)'],
  ['バック技(B技)', 'B — 藤神大手裏剣'],
  ['雷帝モード(N)', 'N — 常時雷帝ON(雷撃AoE+月花雷轟)'],
  ['黒帝モード(M)', 'M — シュヴァルツヴァルト/ゾンビ月落とし 等'],
  // ── ゾンビモード ──
  ['', 'ゾンビモード専用'],
  ['壁購入 / パーク購入', 'E(表示されたプロンプトを押す)'],
  ['ミステリーボックス', 'E(箱の前で押す)'],
  ['鍛神台(武器改造)', 'E — ゲート開放後に武器を強化(5000pt〜)'],
  ['ゲート開放', 'E — 封印ゲートを購入開放(1750pt)'],
  ['お守り', '出撃前のロードアウトで1個装備'],
  // ── ストーリー ──
  ['', 'ストーリー'],
  ['回収 / 目標操作', 'E — 目標アイテムに近づいて押す'],
  // ── サーチ&デストロイ ──
  ['', 'サーチ&デストロイ'],
  ['爆弾設置', 'サイト内で E 長押し(攻撃側・爆弾所持時)'],
  ['爆弾解除', '設置地点で E 長押し(守備側)'],
  // ── 特殊兵装(EXOTIC) ──
  ['', '特殊兵装(EXOTIC)'],
  ['溜め攻撃', '射撃 / ADS 長押し(武器別 — 武器庫の解説カード参照)'],
  ['専用アルティメット', 'M(ゲージ満タン時)'],
  // ── その他 ──
  ['', 'その他'],
  ['ゲームパッド', 'PS4等に対応 / 下の「設定」で配置変更'],
  ['ポーズ(パッド)', 'OPTIONS'],
];

// リバインド表に出すパッドアクションの順序と日本語名。weapon1/weapon2(数字直選択)は
// キーボード専用なので割愛。fire/ads はトリガー、それ以外はボタン既定。
const PAD_ACTION_ROWS: ReadonlyArray<[PadAction, string]> = [
  ['fire', '射撃'],
  ['ads', 'ADS(覗き込み)'],
  ['jump', 'ジャンプ'],
  ['crouch', 'しゃがみ / スライド'],
  ['sprint', 'スプリント'],
  ['reload', 'リロード'],
  ['melee', '近接攻撃'],
  ['weaponswitch', '武器切替'],
  ['grenade', 'グレネード'],
  ['grenadeswitch', '投擲物切替'],
  ['ultimate', 'アルティメット'],
  ['holdBreath', '息止め'],
  ['leanleft', '左リーン'],
  ['leanright', '右リーン'],
  ['scoreboard', 'スコアボード'],
];

const GRAPHICS_LABELS: Record<GraphicsQuality, string> = {
  low: '低(軽量・ポスト処理なし)',
  medium: '中(既定)',
  high: '高(高負荷・高解像度)',
};

const CURVE_LABELS: Record<GamepadResponseCurve, string> = {
  linear: 'リニア(等速)',
  exponential: '指数(中央が精密)',
  dynamic: 'ダイナミック(精密+機敏)',
};

// バインドの深いコピー。プリセットは共有オブジェクトなので、カスタム編集前に必ず複製する
function cloneBindings(b: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const key of Object.keys(b) as PadAction[]) out[key] = b[key].map((x) => ({ ...x }));
  return out;
}

// R10 IGNITION FRAME: 盾型ベゼル2層+十字計器+発光スパークの多層エンブレム。
// viewBox / role / aria-label / .spark クラスは旧ロゴと同一に保ち、CSSフックを壊さない
const LOGO_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="FPS-reFlesh Play Style- のロゴ">
  <title>FPS-reFlesh Play Style-</title>
  <defs>
    <linearGradient id="lg-ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#8a9299" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="lg-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M32 3 55 12v20c0 13-9 24-23 29C18 56 9 45 9 32V12z" fill="none" stroke="url(#lg-ring)" stroke-width="2" opacity="0.85"/>
  <path d="M32 8 50 15v16c0 10-7 19-18 23-11-4-18-13-18-23V15z" fill="rgba(255,255,255,0.04)" stroke="currentColor" stroke-width="1" opacity="0.5"/>
  <path d="M32 14v8M32 42v8M18 32h8M38 32h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
  <path class="spark" filter="url(#lg-glow)" d="M32 20l3.6 7.6L43 32l-7.4 3.4L32 44l-3.6-8.6L21 32l7.4-4.4z"/>
</svg>`;

// ── ARMORY 兵装カードの2D武器シルエット(アセットレス・純関数+メモ化) ──
// 本体は currentColor(CSSの --ink 系)、銃口/光学の発光アクセントのみ tracerColor を焼く。
// メモ化キーは `${shape}|${tracerColor}`(shape単独だとトレーサ色を無視するバグになる)。
const silCache = new Map<string, string>();

// shape 未指定の武器(=一部の副武器)用のクラス既定シルエット。
const CLASS_SHAPE: Record<WeaponClass, ViewModelShape> = {
  ar: 'rifle',
  smg: 'smg',
  marksman: 'dmr',
  sniper: 'sniper-bolt',
  shotgun: 'shotgun-pump',
  br: 'rifle',
  lmg: 'lmg-belt',
  pistol: 'pistol',
  launcher: 'launcher',
  exotic: 'rifle', // 特殊兵装は個別shapeを必ず持つ。fallbackは汎用ライフル
};

interface SilSpec {
  arch: 'ar' | 'bullpup' | 'smg' | 'dmr' | 'sniper' | 'shotgun' | 'lmg' | 'pistol' | 'revolver' | 'fists';
  barrel?: number; // 銃口X(viewBox 0..128)
  mag?: 'curved' | 'straight' | 'box' | 'drum' | 'tube' | 'twin' | 'none';
  optic?: 'iron' | 'red' | 'scope' | 'long';
  stock?: 'full' | 'skel' | 'none' | 'bull';
}

const SHAPE_SIL: Record<ViewModelShape, SilSpec> = {
  rifle: { arch: 'ar', barrel: 118, mag: 'curved', optic: 'red', stock: 'full' },
  carbine: { arch: 'ar', barrel: 106, mag: 'curved', optic: 'red', stock: 'skel' },
  bullpup: { arch: 'bullpup', barrel: 116, mag: 'curved', optic: 'red', stock: 'full' },
  smg: { arch: 'smg', barrel: 98, mag: 'straight', optic: 'red', stock: 'skel' },
  pdw: { arch: 'smg', barrel: 92, mag: 'straight', optic: 'iron', stock: 'skel' },
  'machine-pistol': { arch: 'smg', barrel: 82, mag: 'straight', optic: 'iron', stock: 'none' },
  dmr: { arch: 'dmr', barrel: 120, mag: 'straight', optic: 'scope', stock: 'full' },
  'sniper-bolt': { arch: 'sniper', barrel: 124, mag: 'straight', optic: 'long', stock: 'full' },
  'dsr-bp': { arch: 'sniper', barrel: 126, mag: 'box', optic: 'long', stock: 'bull' },
  fists: { arch: 'fists' },
  'shotgun-pump': { arch: 'shotgun', barrel: 116, mag: 'tube', optic: 'iron', stock: 'full' },
  'shotgun-auto': { arch: 'shotgun', barrel: 112, mag: 'box', optic: 'iron', stock: 'full' },
  'shotgun-double': { arch: 'shotgun', barrel: 120, mag: 'twin', optic: 'iron', stock: 'full' },
  'lmg-belt': { arch: 'lmg', barrel: 122, mag: 'box', optic: 'red', stock: 'full' },
  'lmg-drum': { arch: 'lmg', barrel: 118, mag: 'drum', optic: 'red', stock: 'full' },
  pistol: { arch: 'pistol' },
  revolver: { arch: 'revolver' },
  // ロケットランチャー: LMG アーチで太い筒シルエットに近似
  launcher: { arch: 'lmg', barrel: 120, mag: 'tube', optic: 'iron', stock: 'none' },
  // R33 新shape 8種 — ARMORY SVGシルエット近似(既存archで最も近いものを流用)
  'sniper-semi': { arch: 'sniper', barrel: 122, mag: 'straight', optic: 'scope', stock: 'full' },
  antimateriel: { arch: 'sniper', barrel: 126, mag: 'straight', optic: 'long', stock: 'skel' },
  'shuriken-hand': { arch: 'fists' },
  'bow-japanese': { arch: 'sniper', barrel: 120, mag: 'none', optic: 'iron', stock: 'none' },
  'war-fan': { arch: 'fists' },
  musket: { arch: 'sniper', barrel: 128, mag: 'none', optic: 'iron', stock: 'full' },
  'lightning-staff': { arch: 'smg', barrel: 122, mag: 'none', optic: 'iron', stock: 'none' },
  minigun: { arch: 'lmg', barrel: 124, mag: 'drum', optic: 'iron', stock: 'none' },
};

function tracerHex(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}

// ── 武器カモUIのスコープドCSS(初回のみheadへ注入。IGNITION FRAME: カーボン+琥珀) ──
// filter/backdrop-filter/box-shadowグローは使わない(白飛び・重描画の再発禁止)。
const CAMO_STYLE_ID = 'hibana-camo-style';
function ensureCamoStyle(): void {
  if (document.getElementById(CAMO_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CAMO_STYLE_ID;
  style.textContent = `
.armory-camo{margin-top:10px;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px}
.camo-head{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(220,228,240,.72);margin-bottom:6px}
.camo-head b{color:var(--warn);font-size:12px;letter-spacing:.06em}
.camo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px}
.camo-grid--mastery{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(159,208,255,.25)}
.camo-chip{display:flex;flex-direction:column;align-items:stretch;gap:3px;padding:6px 7px;background:rgba(14,18,25,.85);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#dce4f0;cursor:pointer;text-align:left;font:inherit;min-width:0}
.camo-chip:hover:not(:disabled){border-color:color-mix(in srgb,var(--warn) 65%,transparent)}
.camo-chip:focus-visible{outline:1px solid var(--warn);outline-offset:1px}
.camo-chip.selected{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,transparent)}
.camo-chip.locked{opacity:.55;cursor:default}
.camo-chip.mastery{border-color:rgba(159,208,255,.4)}
.camo-chip.mastery.selected{border-color:var(--warn)}
.camo-swatch{display:block;height:14px;border-radius:2px;border:1px solid rgba(0,0,0,.55)}
.camo-none .camo-swatch{background:linear-gradient(135deg,#2c3340,#181b22)}
.camo-name{font-size:11px;font-weight:700;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.camo-sub{font-size:10px;color:rgba(220,228,240,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.camo-bar{display:block;height:3px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
.camo-bar i{display:block;height:100%;background:var(--warn);transform-origin:left}
.camo-prog{color:var(--warn);opacity:.85}
`;
  document.head.appendChild(style);
}

const rc = (x: number, y: number, w: number, h: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const pg = (pts: string): string => `<polygon points="${pts}"/>`;
const ci = (x: number, y: number, r: number): string => `<circle cx="${x}" cy="${y}" r="${r}"/>`;

// 光学(照準器)を上面へ。iron/red/scope/long で長さと発光レンズが変わる
function silOptic(kind: string | undefined, barrel: number, b: string[], a: string[]): void {
  if (kind === 'red') {
    b.push(rc(44, 10, 15, 6));
    a.push(`<rect x="46" y="11" width="4.5" height="4" fill="__T__"/>`);
  } else if (kind === 'scope') {
    b.push(rc(40, 9, 28, 6), rc(44, 15, 2, 2), rc(60, 15, 2, 2));
    a.push(`<rect x="64" y="9.5" width="3.4" height="5" fill="__T__"/>`);
  } else if (kind === 'long') {
    b.push(rc(34, 7, 42, 6), pg('76,7 82,9 82,11 76,13'), rc(44, 13, 2, 3), rc(64, 13, 2, 3));
    a.push(`<rect x="79.5" y="8.6" width="3" height="4.8" fill="__T__"/>`);
  } else {
    // iron: 前後サイトポスト
    b.push(rc(barrel - 14, 13.5, 2, 4), rc(41, 13, 2, 4));
  }
}

// 弾倉(受け下)。curved/straight/box/drum、tube/twin は銃身系(別処理)
function silMag(kind: string | undefined, b: string[]): void {
  if (kind === 'curved') b.push(pg('53,27 64,27 68,43 57,43'));
  else if (kind === 'straight') b.push(pg('53,27 63,27 64,42 55,42'));
  else if (kind === 'box') b.push(rc(52, 27, 13, 15));
  else if (kind === 'drum') b.push(rc(54, 27, 8, 4), ci(58, 35, 8.5));
}

function silInner(spec: SilSpec, tracer: string): string {
  const b: string[] = [];
  const a: string[] = [];
  const barrel = spec.barrel ?? 116;

  if (spec.arch === 'fists') {
    b.push(
      pg('46,16 70,16 76,20 76,32 70,36 46,36 42,32 42,20'),
      rc(50, 12, 4, 6),
      rc(57, 11, 4, 7),
      rc(64, 12, 4, 6),
      pg('42,24 36,28 40,34 46,32'),
    );
    a.push(`<rect x="70" y="22" width="6" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'pistol') {
    b.push(
      rc(44, 17, 40, 8),
      pg('48,25 62,25 58,42 44,41'),
      rc(60, 15, 3, 2),
      rc(46, 15, 3, 2),
      rc(60, 25, 10, 3),
    );
    a.push(`<rect x="82" y="18.5" width="4" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'revolver') {
    b.push(
      rc(48, 17, 22, 9),
      rc(70, 19, 22, 3),
      ci(58, 24, 7.2),
      pg('48,26 60,26 55,42 45,40'),
      pg('46,15 52,14 52,18 46,18'),
    );
    a.push(`<rect x="89" y="19" width="3.5" height="3.4" fill="${tracer}"/>`, `<circle cx="58" cy="24" r="2.4" fill="${tracer}"/>`);
  } else {
    // ── 長物: 受け / 銃身 / ハンドガード / ストック / グリップ / 弾倉 / 光学 ──
    const bull = spec.arch === 'bullpup' || spec.stock === 'bull';
    b.push(bull ? rc(8, 16, 64, 11) : rc(34, 16, 36, 11));
    b.push(rc(64, 17, 10, 9)); // チャンバーブロック
    b.push(rc(72, 18.5, Math.max(4, barrel - 82), 6.5)); // ハンドガード
    b.push(rc(74, 20.2, barrel - 74, 2.6)); // 銃身
    // ストック
    if (!bull) {
      if (spec.stock === 'full') b.push(pg('8,17 22,15 34,16 34,27 8,28'));
      else if (spec.stock === 'skel') b.push(pg('10,16 34,16 34,18.5 16,19 16,24 34,24 34,27 10,27'));
    }
    // グリップ+トリガーガード
    b.push(pg('42,27 51,27 48,41 40,41'), rc(50, 27.5, 11, 3));
    // 弾倉
    if (spec.mag === 'tube') {
      b.push(rc(74, 24.4, barrel - 82, 2.6)); // 銃身下チューブ弾倉(ポンプ/オート散弾)
      b.push(rc(78, 22.6, 12, 2.2)); // ポンプフォアグリップ
    } else if (spec.mag === 'twin') {
      b.push(rc(74, 24.2, barrel - 74, 2.6)); // 二連の下銃身
    } else if (bull) {
      b.push(pg('20,27 31,27 33,42 22,42')); // ブルパップ弾倉(グリップ後方)
    } else {
      silMag(spec.mag, b);
    }
    // 光学
    silOptic(spec.optic, barrel, b, a);
    // 銃口アクセント(+短いマズルフラッシュ)
    a.push(
      `<rect x="${barrel - 5}" y="19.4" width="5" height="3.4" fill="${tracer}"/>`,
      `<polygon points="${barrel},20.4 ${barrel + 4},21.6 ${barrel},22.8" fill="${tracer}" opacity="0.75"/>`,
    );
  }

  const body = b.join('');
  const accent = a.join('').replace(/__T__/g, tracer);
  return `<g fill="currentColor">${body}</g><g>${accent}</g>`;
}

// 武器シルエットSVG(メモ化)。shape 別+tracer色別にキャッシュする。
function weaponSilSVG(shape: ViewModelShape, tracerColor: number): string {
  const key = `${shape}|${tracerColor}`;
  const hit = silCache.get(key);
  if (hit !== undefined) return hit;
  const spec = SHAPE_SIL[shape] ?? SHAPE_SIL.rifle;
  const svg = `<svg class="wsil" viewBox="0 0 128 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${silInner(spec, tracerHex(tracerColor))}</svg>`;
  silCache.set(key, svg);
  return svg;
}

// 兵装カードの派生スタット(横バーの副次表示)。DPS/確殺弾数/実効RPM/TTKを WeaponDef から導出。
function computeDerivedStats(def: WeaponDef): {
  dps: number;
  shotsToKill: number;
  effRpm: number;
  ttk: number;
} {
  const perShot = def.damage * def.pellets;
  const rps = def.rpm / 60;
  const dps = Math.round(perShot * rps);
  const shotsToKill = Math.max(1, Math.ceil(100 / Math.max(1, perShot)));
  const ttk = Math.round(((shotsToKill - 1) * 60000) / Math.max(1, def.rpm));
  return { dps, shotsToKill, effRpm: def.rpm, ttk };
}

// ── R53 MK.III: ARMORY 装備差分チップ ─────────────────────────────────
// 候補武器と装備中武器の派生スタット差分(4軸)。基礎def同士の比較(カード表示は
// アタッチメント無しの素の武器なので、比較も素同士で公平にする)。
export interface DiffChip {
  label: string;
  delta: number;
  better: boolean;
}
export function weaponDiffChips(candidate: WeaponDef, equipped: WeaponDef): DiffChip[] {
  if (candidate.id === equipped.id) return [];
  const a = computeDerivedStats(candidate);
  const b = computeDerivedStats(equipped);
  const chips: DiffChip[] = [];
  const push = (label: string, delta: number, lowerIsBetter = false): void => {
    if (delta !== 0) chips.push({ label, delta, better: lowerIsBetter ? delta < 0 : delta > 0 });
  };
  push('DPS', a.dps - b.dps);
  push('TTK', a.ttk - b.ttk, true); // ms: 低いほど良い
  push('RPM', a.effRpm - b.effRpm);
  push('装弾', candidate.magazineSize - equipped.magazineSize);
  return chips;
}

// ── R53 MK.III: ワードマーク背後の超越階級判子(先頭1文字) ─────────────
export function rankStampChar(rankName: string): string {
  return [...rankName][0] ?? '兵';
}

// ── R53 MK.III: EXOTIC神殿の奥義解説(R37実装の技名・発動方法) ─────────
// 数値は誇張せず、発動方法(コードで検証済みのトリガ)+技の性格を短文で伝える。
interface ExoticLore {
  charge: string;
  chargeHow: string;
  chargeDesc: string;
  ult: string;
  ultDesc: string;
}
export const EXOTIC_LORE: Record<string, ExoticLore> = {
  'banjin-smg': {
    charge: '千刃嵐',
    chargeHow: '射撃長押し 1.2秒',
    chargeDesc: '±45°へ16枚の貫通刃を扇状に一斉射出する。',
    ult: '影分身・万刃繚乱',
    ultDesc: '8体の影分身が現れ、周囲へ手裏剣の嵐を放ち続ける。',
  },
  'gekkou-bow': {
    charge: '満月の矢',
    chargeHow: 'ADS長押し(満充填で自動発射)',
    chargeDesc: '全てを貫く三連の光矢を一直線に放つ。',
    ult: '月落とし',
    ultDesc: '天から月光の巨弾を呼び、着弾点を広範囲ごと消し飛ばす。',
  },
  'fujin-fan': {
    charge: '大颶風',
    chargeHow: '射撃長押し 1.2秒',
    chargeDesc: '前進する巨大な風の壁で敵をまとめて打ち上げ、足止めする。',
    ult: '神風・天空舞',
    ultDesc: '敵一体ごとに竜巻を生み、まとめて天へ巻き上げる。',
  },
  'gouen-musket': {
    charge: '大業火弾',
    chargeHow: '射撃長押し 1.2秒',
    chargeDesc: '着弾点に大爆発と、燃え広がる火床を残す業火の弾。',
    ult: '業火滅世',
    ultDesc: '前方を焼き尽くす炎の回廊を現出させる。',
  },
  'tenrai-staff': {
    charge: '天罰',
    chargeHow: 'ADS長押し(満充填で自動発射)',
    chargeDesc: '照準地点へ天雷を降らせ、広範囲の敵を打ち据えて痺れさせる。',
    ult: '神鳴八雷',
    ultDesc: '八方の雷が、戦場の全ての敵を同時に打つ。',
  },
  'shinkirou-sniper': {
    charge: '千里眼閃',
    chargeHow: '射撃長押し 1.2秒',
    chargeDesc: '壁をも貫く光線を扇状に薙ぎ払う七連斉射。',
    ult: '虚像世界',
    ultDesc: '敵だけが遅れる蜃気楼の世界へ引きずり込む。',
  },
  'shura-lmg': {
    charge: '阿修羅連撃',
    chargeHow: 'ADS+射撃を1秒維持',
    chargeDesc: '数秒間、修羅の連撃が途切れぬ弾幕と化す。',
    ult: '阿修羅降臨',
    ultDesc: '阿修羅の巨影を降ろし、自動追撃と共に戦場を蹂躙する。',
  },
};

// ── R53 MK.III: リザルト「マッチストーリー」──────────────────────────
// MatchResult/MatchProgress に時系列データは無いため、実在イベント(メダル/改造/
// 到達ラウンド/レベルアップ/勝敗)を「時系列風の帯」に等間隔で並べる意匠として成立させる。
export type StoryTone = 'ember' | 'cyan' | 'violet' | 'ok' | 'gold' | 'steel';
export interface StoryMarker {
  kind: 'start' | 'medal' | 'pap' | 'round' | 'levelup' | 'end';
  label: string;
  tone: StoryTone;
}
const STORY_MEDAL_MAX = 6;
export function matchStoryMarkers(result: MatchResult, progress: MatchProgress): StoryMarker[] {
  const markers: StoryMarker[] = [{ kind: 'start', label: 'DROP', tone: 'steel' }];
  const counts = Object.entries(result.summary.medalCounts ?? {});
  counts.sort((a, b) => b[1] - a[1]);
  for (const [id, n] of counts.slice(0, STORY_MEDAL_MAX)) {
    const nice = id.replace(/-/g, ' ').toUpperCase();
    markers.push({ kind: 'medal', label: n > 1 ? `${nice} ×${n}` : nice, tone: 'ember' });
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

// ── R20 戦闘評価(After-Action Report のシジル)──────────────────────
// 命中率 / K・D / ヘッドショット / 勝敗 /(モード別)連鎖から純算術で S〜D を算出。
// ティア色は既存メダルパレット(--medal-gold/plat/cyan/violet)、最下位Dは無彩スチール。
type GradeTier = 'gold' | 'plat' | 'cyan' | 'violet' | 'steel';
interface GradeInfo {
  letter: string;
  tier: GradeTier;
  score: number; // 0..100(下部の PTS カウントアップ用)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 面取り六角形の頂点(真上向き)。hud.ts の ngonPoints と同型(menu へ複製)
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function computeGrade(result: MatchResult): GradeInfo {
  const you = result.rows.find((r) => r.isPlayer);
  const kills = you?.kills ?? result.summary.kills;
  const deaths = you?.deaths ?? result.summary.deaths;
  const kd = deaths > 0 ? kills / deaths : kills; // 0デスはキル数をそのまま比とみなす
  // 配点は満点100(勝敗22 / K・D26 / 命中20 / キル数18 / HS8 / 連鎖6)。全て純算術・決定論。
  const score =
    (result.won ? 22 : 0) +
    clamp01(kd / 2) * 26 +
    clamp01(result.accuracy / 0.45) * 20 +
    clamp01(kills / 18) * 18 +
    clamp01(result.headshots / 8) * 8 +
    clamp01(result.summary.bestStreak / 6) * 6;
  if (score >= 86) return { letter: 'S', tier: 'gold', score };
  if (score >= 70) return { letter: 'A', tier: 'plat', score };
  if (score >= 54) return { letter: 'B', tier: 'cyan', score };
  if (score >= 38) return { letter: 'C', tier: 'violet', score };
  return { letter: 'D', tier: 'steel', score };
}

export class Menu {
  private selection: MenuSelection = {
    stageId: STAGES[0]?.id ?? 'kunren',
    mode: 'ffa',
    primaryId: 'kaede-ar',
    attachments: [],
    grenade: 'frag',
    difficulty: 'normal',
    secondaryId: 'suzume',
    hellMode: false,
    allGiantMode: false,
    rogueRun: false,
    missionDifficulty: 'normal',
  };
  private weaponPreview: WeaponPreview | null = null; // ARMORYの3Dプレビュー(遅延生成)
  private readonly attachmentBySlot: Record<AttachmentSlot, string | null> = {
    sight: null,
    muzzle: null,
    grip: null,
    mag: null,
  };
  private activePage = 'deploy'; // 現在表示中のMFDページ
  private capturingAction: PadAction | null = null; // リバインド捕捉中のアクション
  private bindNote = ''; // 競合解消などの通知文(リバインド表の下に表示)
  private captureCleanup: (() => void) | null = null; // 捕捉中の keydown リスナ等の後始末
  private bg: SpaceBg | null = null; // メニュー背景の宇宙(ページ連動カメラ)。attachBgで注入
  private wipeTimer = 0; // 画面遷移ワイプのフォールバックタイマ(animationend不発でも畳む)
  private mfdWiped = false; // 初回マウントはワイプ抑止(ベゼル入場と二重演出にしない)
  private gradeSeq = 0; // 戦闘評価シジルの一意ID用カウンタ(gradient/filterのid衝突回避)

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly profile: Profile,
    private readonly callbacks: MenuCallbacks,
    private readonly input: Input,
  ) {
    this.loadLoadout();
    this.showMain();
  }

  private playerLevel(): number {
    return levelFromXp(this.profile.xp).level;
  }

  // 前回のロードアウトを復元する。存在しないIDは黙って捨てる
  private loadLoadout(): void {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MenuSelection>;
      if (saved.stageId && STAGES.some((s) => s.id === saved.stageId)) {
        this.selection.stageId = saved.stageId;
      }
      if (saved.primaryId && PRIMARY_IDS.includes(saved.primaryId)) {
        this.selection.primaryId = saved.primaryId;
      }
      if (saved.secondaryId && SECONDARY_IDS.includes(saved.secondaryId)) {
        this.selection.secondaryId = saved.secondaryId;
      }
      if (saved.mode && MODE_IDS.includes(saved.mode)) {
        this.selection.mode = saved.mode;
      }
      if (saved.grenade && GRENADE_KINDS.includes(saved.grenade)) {
        this.selection.grenade = saved.grenade;
      }
      if (saved.difficulty && ['easy', 'normal', 'hard'].includes(saved.difficulty)) {
        this.selection.difficulty = saved.difficulty;
      }
      // R53-W2: ストーリーミッション難易度(既定normal)。既存のdifficulty永続化と同じ流儀
      if (saved.missionDifficulty && ['easy', 'normal', 'hard'].includes(saved.missionDifficulty)) {
        this.selection.missionDifficulty = saved.missionDifficulty;
      }
      // V27修正: 保存はされるが復元されていなかった(往復の非対称)。クランプして復元
      if (typeof saved.zombieStartRound === 'number') {
        this.selection.zombieStartRound = Math.max(1, Math.min(999, Math.round(saved.zombieStartRound)));
      }
      if (typeof saved.hellMode === 'boolean') this.selection.hellMode = saved.hellMode;
      if (typeof saved.allGiantMode === 'boolean') this.selection.allGiantMode = saved.allGiantMode;
      if (typeof saved.rogueRun === 'boolean') this.selection.rogueRun = saved.rogueRun;
      for (const id of saved.attachments ?? []) {
        const def = ATTACHMENT_DEFS[id];
        if (def) this.attachmentBySlot[def.slot] = id;
      }
    } catch {
      // 壊れた保存値は初期値で開く
    }
  }

  private syncAttachments(): void {
    this.selection.attachments = Object.values(this.attachmentBySlot).filter(
      (id): id is string => id !== null,
    );
  }

  private saveLoadout(): void {
    this.syncAttachments();
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.selection));
  }

  // main.ts から宇宙背景を注入する。初回フォーカスを即送出して画角を現在ページへ一致させる
  attachBg(bg: SpaceBg): void {
    this.bg = bg;
    bg.setFocus(this.activePage);
  }

  // 背景の遷移状態(recede/soft/killcam)を一括で解除し、宇宙背景のDoFも戻す。
  // hide()とshowMain()冒頭で呼び、モーダル由来の暗転やワイプがメニューに残らないようにする
  private clearBgTransition(): void {
    document.body.classList.remove('bg-recede', 'bg-soft', 'killcam-active');
    this.bg?.setModalDim(0);
    if (this.wipeTimer !== 0) {
      window.clearTimeout(this.wipeTimer);
      this.wipeTimer = 0;
    }
  }

  hide(): void {
    // メニューを隠す瞬間に必ずリバインド捕捉を畳む。捕捉中のまま試合へ復帰すると
    // 最初のパッド入力がリバインドに食われ、設定が静かに書き換わるのを防ぐ
    this.endCapture();
    this.teardownPreview();
    this.clearBgTransition();
    this.root.hidden = true;
  }

  // ── コントローラだけでのメニュー操作(トップページ含む全画面) ──
  // D-pad/左スティック=フォーカス移動, ×=決定, ○=戻る, L1/R1=MFDタブ切替,
  // セレクト/スライダーに合わせている時は左右で値を増減する。
  handleGamepad(nav: UiNav): void {
    if (this.root.hidden || this.capturingAction) return; // リバインド捕捉中は介入しない
    const list = this.focusables();
    if (list.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    // まだ何も選んでいなければ最初の要素を選ぶだけ(初回の方向入力でハイライト)
    if (idx < 0) {
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm) {
        list[0]?.focus();
        list[0]?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    if (nav.tabPrev || nav.tabNext) {
      this.cycleMfdPage(nav.tabNext ? 1 : -1);
      return;
    }

    // セレクト/スライダーは左右で値を変える(上下はフォーカス移動)
    const cur = list[idx];
    if (cur instanceof HTMLSelectElement && (nav.left || nav.right)) {
      const n = cur.options.length;
      cur.selectedIndex = Math.max(0, Math.min(n - 1, cur.selectedIndex + (nav.right ? 1 : -1)));
      cur.dispatchEvent(new Event('change'));
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range' && (nav.left || nav.right)) {
      const step = Number(cur.step) || 1;
      const v = Number(cur.value) + (nav.right ? step : -step);
      cur.value = String(Math.max(Number(cur.min), Math.min(Number(cur.max), v)));
      cur.dispatchEvent(new Event('input'));
      return;
    }

    if (nav.up || (nav.left && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx - 1);
      return;
    }
    if (nav.down || (nav.right && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx + 1);
      return;
    }
    if (nav.confirm) {
      const el = list[idx];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.click();
      else el?.click();
      return;
    }
    if (nav.back) this.gamepadBack();
  }

  // 現在の画面で見えている操作可能要素(ボタン/セレクト/入力)
  private focusables(): HTMLElement[] {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  private focusAt(list: HTMLElement[], i: number): void {
    const n = list.length;
    const idx = ((i % n) + n) % n;
    const el = list[idx];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  private cycleMfdPage(dir: number): void {
    const tabs = ['campaign', 'deploy', 'armory', 'intel', 'system'];
    const i = tabs.indexOf(this.activePage);
    if (i < 0) return; // メインMFD以外(ポーズ/結果)ではタブ切替しない
    const next = tabs[(i + dir + tabs.length) % tabs.length] ?? 'deploy';
    this.setMfdPage(next);
    this.focusables()[0]?.focus({ preventScroll: true });
  }

  // ○ボタン: 画面ごとの「戻る/再開」相当を押す
  private gamepadBack(): void {
    for (const id of ['brief-back', 'to-campaign', 'menu', 'quit', 'resume', 'retry-mission']) {
      const el = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el && el.offsetParent !== null) {
        el.click();
        return;
      }
    }
  }

  // リバインド捕捉の後始末を一箇所に集約する。Input側のコールバック解除・
  // keydownリスナ除去・捕捉状態クリアを冪等に行う
  private endCapture(): void {
    this.input.cancelCapture();
    if (this.captureCleanup) {
      this.captureCleanup();
      this.captureCleanup = null;
    }
    this.capturingAction = null;
  }

  showMain(): void {
    this.clearBgTransition();
    this.mfdWiped = false; // 再マウント: 最初の setMfdPage はワイプせず即時
    this.teardownPreview();
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-main">
        <div class="console-bezel">
          <i class="bezel-grain" aria-hidden="true"></i>
          <header class="menu-header telemetry-rail">
            <span class="sys-lamps" aria-hidden="true">
              <i data-sys="O2"><b></b>O2</i><i data-sys="PWR"><b></b>PWR</i>
              <i data-sys="NAV"><b></b>NAV</i><i data-sys="LINK"><b></b>LINK</i>
            </span>
            <span class="menu-logo">${LOGO_SVG}</span>
            <div class="wordmark">
              <span class="mk3m-rank-stamp" aria-hidden="true">${rankStampChar(rankNameFor(this.playerLevel()).name)}</span>
              <h1 class="brand-wm" aria-label="FPS-reFlesh Play Style-">
                <span class="wm-kicker" aria-hidden="true">FPS-</span>
                <span class="wm-hero" aria-hidden="true">re<em>F</em>lesh</span>
                <span class="wm-style" aria-hidden="true">Play Style-</span>
              </h1>
              <p class="menu-tagline"><span lang="en">Orbital Dropdeck</span><span lang="ja">軌道降下管制盤</span></p>
            </div>
            <div class="nav-readout" aria-hidden="true">
              <span class="nav-opr">OPR <b>LV.${this.playerLevel()} ${rankNameFor(this.playerLevel()).name}</b></span><span>STRK <b>${this.profile.records.bestWinStreak}</b></span><span>KILLS <b>${this.profile.stats.kills}</b></span><span class="nav-eta">DROP WINDOW <b>T-00:43</b></span>
            </div>
          </header>
          <p class="menu-touchnote">この作品はキーボードとマウスで操作します。スマートフォンやタブレットでは遊べません。PCで開いてください。</p>
          <section class="deployment-briefing ig-scan" aria-label="出撃構成">
            <div class="briefing-heading">
              <span>Deployment briefing</span>
              <strong>出撃構成</strong>
            </div>
            <dl class="briefing-loadout">
              <div><dt>Stage</dt><dd data-id="brief-stage"></dd></div>
              <div><dt>Mode</dt><dd data-id="brief-mode"></dd></div>
              <div><dt>Primary</dt><dd data-id="brief-weapon"></dd></div>
              <div><dt>Utility</dt><dd data-id="brief-grenade"></dd></div>
              <div><dt>Threat</dt><dd data-id="brief-difficulty"></dd></div>
              <div data-id="brief-zombie-round" hidden><dt>開始R</dt><dd data-id="brief-zombie-round-val"></dd></div>
            </dl>
            <div class="deploy-lever">
              <span class="lever-beacon" aria-hidden="true"></span>
              <button class="menu-start" data-id="start">
                <i class="mk3m-hold-fill" aria-hidden="true"></i>
                <span>出撃する</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h13m-5-5 5 5-5 5M19 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span class="lever-eta" aria-hidden="true">長押しで降下 · LOCKED · 1G</span>
            </div>
          </section>
          <section class="daily-panel ig-panel ig-scan" aria-label="本日のチャレンジ" data-id="daily-panel"></section>
          <div class="console-body">
            <nav class="mfd-rail" role="tablist" aria-label="管制ページ">
              <button class="mfd-tab mfd-tab-campaign" type="button" role="tab" data-page="campaign" id="mfd-tab-campaign" aria-controls="mfd-panel-campaign"><b>★</b><span>CAMPAIGN</span><small>戦役</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="deploy" id="mfd-tab-deploy" aria-controls="mfd-panel-deploy"><b>01</b><span>DEPLOY</span><small>降下管制</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="armory" id="mfd-tab-armory" aria-controls="mfd-panel-armory"><b>02</b><span>ARMORY</span><small>兵装</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="intel" id="mfd-tab-intel" aria-controls="mfd-panel-intel"><b>03</b><span>INTEL</span><small>戦況</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="system" id="mfd-tab-system" aria-controls="mfd-panel-system"><b>04</b><span>SYSTEM</span><small>系統</small></button>
              <i class="mfd-ink" aria-hidden="true"></i>
            </nav>
            <div class="mfd-deck">
              <section class="mfd-page" data-page="campaign" role="tabpanel" id="mfd-panel-campaign" aria-labelledby="mfd-tab-campaign" hidden>
                <div class="campaign-screen" data-id="campaign"></div>
              </section>
              <section class="mfd-page" data-page="deploy" role="tabpanel" id="mfd-panel-deploy" aria-labelledby="mfd-tab-deploy">
                <div class="mfd-hero ig-scan--live" aria-hidden="true">
                  <div class="hero-limb"></div>
                  <div class="hero-readout"><span>ORBIT <b>412</b>KM</span><span>ATMO <b>1.0</b>G</span><span>LZ <b>SECURE</b></span></div>
                  <div class="hero-grid"></div>
                </div>
                <div class="mfd-cols mfd-cols--deploy">
                  <section class="menu-section">
                    <h2>降下目標</h2>
                    <div class="stage-grid" data-id="stages"></div>
                  </section>
                  <section class="menu-section">
                    <h2>交戦規定</h2>
                    <div class="mode-list" data-id="modes"></div>
                  </section>
                  <section class="menu-section zombie-round-section" data-id="rogue-wrap" hidden>
                    <h2>輪廻(ローグラン)</h2>
                    <label class="menu-toggle"><input type="checkbox" data-id="rogueRun"><span>輪廻で出撃<small class="toggle-desc"> — ミサゴ拳銃のみ・R1固定で開始し、ラウンドクリアごとに供物カードで強化を積む。累計到達で恒久の加護が解放。お守り/開始ラウンド/超鬼畜/全巨躯とは排他</small></span></label>
                  </section>
                  <section class="menu-section zombie-round-section" data-id="zombie-round-wrap" hidden>
                    <h2>開始ラウンド</h2>
                    <div class="zombie-round-selector" data-id="zombie-round-selector"></div>
                  </section>
                  <section class="menu-section">
                    <h2>脅威レベル</h2>
                    <div class="difficulty-list" data-id="difficulties"></div>
                  </section>
                  <section class="menu-section">
                    <h2>特殊オプション</h2>
                    <label class="menu-toggle"><input type="checkbox" data-id="hellMode"><span>超鬼畜モード<small class="toggle-desc"> — 全敵HP/攻撃力/速度が大幅強化。達人向け高難度(ゾンビにも適用)</small></span></label>
                    <label class="menu-toggle"><input type="checkbox" data-id="allGiantMode"><span>全巨躯モード<small class="toggle-desc"> — 全敵がエリートサイズ。視認困難+追尾射撃(ゾンビにも適用)</small></span></label>
                  </section>
                  <section class="menu-section zombie-round-section" data-id="charm-wrap" hidden>
                    <h2>お守り</h2>
                    <div class="charm-grid" data-id="charm-grid"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="armory" role="tabpanel" id="mfd-panel-armory" aria-labelledby="mfd-tab-armory" hidden>
                <div class="armory-layout">
                  <div class="armory-list">
                    <section class="menu-section">
                      <h2>メイン武器</h2>
                      <div class="wclass-tabs" data-id="wclass-tabs" role="tablist" aria-label="武器クラス"></div>
                      <div class="weapon-grid" data-id="weapons"></div>
                    </section>
                    <section class="menu-section">
                      <h2>副武器</h2>
                      <div class="weapon-grid weapon-grid--sec" data-id="secondaries"></div>
                    </section>
                    <section class="menu-section">
                      <h2>アタッチメント</h2>
                      <div class="attach-panel" data-id="attachments"></div>
                    </section>
                    <section class="menu-section">
                      <h2>投擲物</h2>
                      <div class="grenade-list" data-id="grenades"></div>
                    </section>
                  </div>
                  <aside class="armory-preview ig-panel ig-scan">
                    <canvas class="weapon-canvas" data-id="weapon-canvas"></canvas>
                    <div class="armory-readout">
                      <div class="armory-wname" data-id="armory-wname"></div>
                      <div class="armory-bars" data-id="armory-bars"></div>
                      <div class="armory-stats" data-id="armory-stats"></div>
                      <div class="armory-camo" data-id="armory-camo" hidden></div>
                      <div class="mk3m-exotic-lore" data-id="armory-exotic" hidden></div>
                      <p class="armory-hint">ドラッグで回転・クリックで空撃ち・武器をクリックで選択</p>
                    </div>
                  </aside>
                </div>
              </section>
              <section class="mfd-page" data-page="intel" role="tabpanel" id="mfd-panel-intel" aria-labelledby="mfd-tab-intel" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>戦績</h2>
                    <div class="menu-profile" data-id="profile"></div>
                  </section>
                  <section class="menu-section">
                    <h2>任務</h2>
                    <div class="challenge-list" data-id="challenges"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="system" role="tabpanel" id="mfd-panel-system" aria-labelledby="mfd-tab-system" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>設定</h2>
                    <div data-id="settings"></div>
                  </section>
                  <section class="menu-section menu-controls">
                    <h2>操作</h2>
                    <div class="controls-grid" data-id="controls"></div>
                  </section>
                </div>
              </section>
            </div>
          </div>
          <footer class="console-status" aria-hidden="true">
            <span class="status-dot"></span><span>SYS NOMINAL</span><span class="status-fill"></span><span class="status-opr">OPR <b>LV.${this.playerLevel()} ${rankNameFor(this.playerLevel()).name}</b></span><span class="status-fill"></span><span>reFlesh // tactical sim · BUILD ${BUILD_LABEL}</span>
          </footer>
        </div>
      </div>
    `;
    this.renderProfile();
    this.renderChallenges();
    this.renderDailies();
    this.renderStages();
    this.renderModes();
    this.renderZombieRoundSelector();
    this.renderCharmSelector();
    this.renderRogueToggle();
    this.renderWeapons();
    this.renderSecondaries();
    this.renderAttachments();
    this.renderGrenades();
    this.renderDifficulties();
    this.renderSpecialOptions();
    this.renderSettings(this.query('settings'));
    this.renderControls();
    this.renderCampaign();
    this.renderBriefing();
    this.wireMfd();
    this.wireHeroParallax();
    // R53 MK.III: 出撃レバーは hold-to-launch(ポインタ300ms長押し)。キーボード/
    // ゲームパッド(el.click()=detail 0)は従来どおり即時発火(パッドの長押し入力経路が
    // 無いため — 判断は実装報告に記載)
    this.wireHoldToLaunch(this.query('start'), () => {
      this.saveLoadout();
      // R53-W2: 「継承の守り札」装備時のみ、前試合の最終パークをlocalStorageから解決する
      // (書き込み側はmatch.ts担当で今回未配線。未設定なら常にundefinedの無害なノーオペ)
      this.selection.carriedPerk = resolveCarriedPerk(this.selection.charm, readLastZombiePerk());
      this.callbacks.onStart(this.selection);
    });
  }

  // R53 MK.III: hold-to-launch。ポインタは300ms長押しで発火(離すとキャンセル+フィル巻き戻し)。
  // detail===0 のclick(キーボードEnter/Space・ゲームパッドの el.click())は即時発火を維持する。
  // ポインタ由来のclick(detail>0)は hold 完了側で発火済みのため握りつぶす(二重発火防止)。
  private wireHoldToLaunch(btn: HTMLElement, fire: () => void): void {
    let timer = 0;
    const clear = (): void => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      btn.classList.remove('mk3m-holding');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.classList.add('mk3m-holding');
      timer = window.setTimeout(() => {
        timer = 0;
        btn.classList.remove('mk3m-holding');
        fire();
      }, 300);
    });
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('pointercancel', clear);
    // ★V-D修正: 押下保持中に alt-tab / タブ非表示になっても300msタイマーが発火しないよう
    // フォーカス喪失系でもキャンセルする(意図しない出撃の防止)
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') clear();
    });
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) {
        clear();
        fire();
      }
    });
  }

  // R53 MK.III: DEPLOYヒーローの2層視差(hero-limb=遅layer / hero-grid=速layer)。
  // transformのみ(再レイアウト無し)・rAFスロットル・省モーション時は接続しない。
  private wireHeroParallax(): void {
    if (this.prefersReducedMotion) return;
    const hero = this.root.querySelector<HTMLElement>('.mfd-hero');
    const limb = hero?.querySelector<HTMLElement>('.hero-limb');
    const grid = hero?.querySelector<HTMLElement>('.hero-grid');
    if (!hero || !limb || !grid) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      px = (e.clientX - r.left) / Math.max(1, r.width) - 0.5;
      py = (e.clientY - r.top) / Math.max(1, r.height) - 0.5;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          limb.style.transform = `translate3d(${(px * -6).toFixed(1)}px, ${(py * -4).toFixed(1)}px, 0)`;
          grid.style.transform = `translate3d(${(px * 10).toFixed(1)}px, ${(py * 7).toFixed(1)}px, 0)`;
        });
      }
    });
    hero.addEventListener('pointerleave', () => {
      limb.style.transform = '';
      grid.style.transform = '';
    });
  }

  // ── キャンペーン(戦役)画面 ────────────────────────────────────
  private renderCampaign(): void {
    const host = this.query('campaign');
    const camp = this.profile.campaign;
    const totalStars = Object.values(camp.missionBests).reduce((s, b) => s + b.stars, 0);
    const cleared = camp.clearedMissions.length;
    // R55 W-C5[LOW-17]: chapterVisible(隠し章chBの可視性判定)をcampaignTotals()より前に
    // 定義し、campaignTotals(CAMPAIGN.filter(chapterVisible))として可視章のみを集計する。
    // 従来はCAMPAIGN全体(chB含む)を無条件集計していたため、ch10クリア前でも戦績ヘッダーの
    // 合計ミッション数/★上限にchBの1ミッション/★3点が常時漏れていた(ui2/campaign.tsは
    // R55 W-C4で修正済み・classic側のみ未修正だった回帰)。判定はui2と同型。
    const chapterVisible = (chapter: (typeof CAMPAIGN)[number]): boolean =>
      chapter.missions.some(
        (m) => isMissionUnlocked(this.profile, m.id) || camp.clearedMissions.includes(m.id),
      );
    // R53-W2: 48/144のハードコードをCAMPAIGN駆動へ根治(ch9/ch10追加で60ミッション/★180点)
    const { missions: totalMissions, starsMax } = campaignTotals(CAMPAIGN.filter(chapterVisible));
    host.innerHTML = `
      <div class="campaign-head">
        <div class="campaign-title"><em class="campaign-op">OPERATION <i>//</i> CINDER</em><strong>軌道に灯る火種</strong><span>CINDER 鎮圧作戦</span></div>
        <div class="campaign-stat">制圧 <b>${cleared}</b>/${totalMissions} ・ ★<b>${totalStars}</b>/${starsMax}<span class="campaign-bar ig-bar" aria-hidden="true"><i style="transform:scaleX(${(cleared / totalMissions).toFixed(3)})"></i></span></div>
      </div>
      <div class="chapter-list" data-id="chapter-list"></div>
    `;
    const list = host.querySelector<HTMLElement>('[data-id="chapter-list"]');
    if (!list) return;
    // R55-W-C: ★/前章制圧を条件にした「章まるごとLOCKED」表示を撤廃し、ui2と同方針へ揃える。
    // 全章を常にmission-grid付きで描画し、ロック判定はmissionChip内のisMissionUnlockedのみに
    // 委譲する(隠し章chBの解放待ちもmissionChip側のLOCKED表示で自動的に反映される)。
    //
    // R55-W-C2[MEDIUM確証finding]: 上記のmissionChip委譲だけでは不十分だった — chBが未解放でも
    // chapter-card-head(章名/サブタイトル)とmissionChip自体(ミッション名/サブタイトル)は
    // 常にDOMへ出力されており、LOCKEDバッジは★欄を差し替えるだけなのでネタバレ/実績先食いが
    // 破れていた。ui2/screens/campaign.ts の chapterVisible と同型の判定で、隠し章
    // (全ミッションが isMissionUnlocked=false かつ未クリア)はチャプター名義から丸ごとDOM
    // 描画をスキップする。通常章(ch1-ch10)はR55で全ミッション常時解放済みのため
    // chapterVisible は常にtrueで、可視性は変わらない。
    // (chapterVisible の定義はcampaignTotals呼び出しより前=関数冒頭側にある。R55 W-C5[LOW-17])
    for (const chapter of CAMPAIGN.filter(chapterVisible)) {
      const chClear = chapter.missions.filter((m) => camp.clearedMissions.includes(m.id)).length;
      const card = document.createElement('div');
      card.className = 'chapter-card';
      const head = document.createElement('div');
      head.className = 'chapter-card-head';
      head.innerHTML = `
        <span class="chapter-no">${chapter.title}</span>
        <span class="chapter-sub">${chapter.subtitle}</span>
        <span class="chapter-prog"><b>${chClear}</b>/${chapter.missions.length}<span class="chapter-prog-bar" aria-hidden="true"><i style="transform:scaleX(${(chClear / chapter.missions.length).toFixed(3)})"></i></span></span>
      `;
      card.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'mission-grid';
      for (const mission of chapter.missions) {
        grid.appendChild(this.missionChip(mission));
      }
      this.stagger(grid); // チップ入場(listitem-in)の--i付与
      card.appendChild(grid);
      list.appendChild(card);
    }
  }

  private missionChip(mission: MissionDef): HTMLElement {
    const camp = this.profile.campaign;
    const unlocked = isMissionUnlocked(this.profile, mission.id);
    const best = camp.missionBests[mission.id];
    const stars = best ? best.stars : 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = unlocked ? 'mission-chip' : 'mission-chip locked';
    btn.disabled = !unlocked;
    const starHtml = unlocked
      ? `<span class="mission-stars"><b>${'★'.repeat(stars)}</b>${'☆'.repeat(3 - stars)}</span>`
      : '<span class="mission-lock">LOCKED</span>';
    // R53-W2: rewardIdがあるミッション(ch10最終決戦等)に小さな報酬バッジを添える
    const rewardLabel = missionRewardLabel(mission.rewardId);
    const rewardHtml = rewardLabel
      ? `<span class="mission-reward" title="特別報酬: ${rewardLabel}">特別報酬 ${rewardLabel}</span>`
      : '';
    btn.innerHTML = `
      <span class="mission-idx">${mission.chapterId.toUpperCase()}-${mission.index + 1}</span>
      <span class="mission-name">${mission.title}</span>
      <span class="mission-sub">${mission.subtitle}</span>
      ${rewardHtml}
      ${starHtml}
    `;
    if (unlocked) btn.addEventListener('click', () => this.showBriefing(mission));
    return btn;
  }

  // ミッション・ブリーフィング。出撃で onStartMission を呼ぶ
  showBriefing(mission: MissionDef): void {
    this.endCapture(); // 画面差し替え前にリバインド捕捉を畳む(孤立リスナ防止)
    this.teardownPreview();
    // モーダル: 背景を後退させ、宇宙背景をDoFで沈めてブリーフィングを前面へ立てる
    // (menu-briefingは透過のため星野が見える)。showMain/hide が解除する
    document.body.classList.add('bg-recede');
    this.bg?.setModalDim(1);
    this.root.hidden = false;
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
    this.root.innerHTML = `
      <div class="menu-screen menu-briefing">
        <div class="brief-frame">
          <div class="brief-panel" role="dialog" aria-modal="true" aria-label="ミッションブリーフィング">
            <p class="brief-chapter">${mission.chapterId.toUpperCase()}-${mission.index + 1} // SORTIE ORDER</p>
            <h1>${mission.title}</h1>
            <p class="brief-subtitle">${mission.subtitle}</p>
            <div class="brief-map" aria-hidden="true"></div>
            <div class="brief-body">${briefLines}</div>
            <dl class="brief-meta">
              <div><dt>目的</dt><dd>${mission.objective.label}</dd></div>
              <div><dt>武器</dt><dd><select class="brief-weapon-select" data-id="brief-weapon-select" aria-label="出撃武器の選択"></select></dd></div>
              <div><dt>難易度</dt><dd><div class="attach-options" data-id="brief-mission-diff"></div></dd></div>
              <div><dt>特殊条件</dt><dd>${mods}</dd></div>
              ${rewardRow}
            </dl>
            ${intel}
            <div class="brief-buttons">
              <button class="menu-start" data-id="deploy-mission"><span>出撃する</span></button>
              <button class="menu-quiet" data-id="brief-back">戦役へ戻る</button>
            </div>
          </div>
        </div>
      </div>
    `;
    // 武器は自由選択(既定=支給武器)。解放済みの主武器から選べる
    const weaponSelect = this.query('brief-weapon-select') as HTMLSelectElement;
    const level = this.playerLevel();
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
    // (renderZombieRoundSelectorのR presetsと同じ流儀)を再利用し、選択はthis.selection
    // (LOADOUT_KEY永続化)へ即保存する
    const diffHost = this.query('brief-mission-diff');
    const renderMissionDiff = (): void => {
      const cur = this.selection.missionDifficulty ?? 'normal';
      diffHost.innerHTML = DIFFICULTIES.map(
        (d) =>
          `<button type="button" class="attach-btn${d.id === cur ? ' selected' : ''}" data-diff="${d.id}" aria-pressed="${d.id === cur}">${d.label}</button>`,
      ).join('');
      diffHost.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selection.missionDifficulty = btn.dataset.diff as Difficulty;
          this.saveLoadout();
          renderMissionDiff();
        });
      });
    };
    renderMissionDiff();
    this.query('deploy-mission').addEventListener('click', () => {
      this.callbacks.onStartMission(mission.id, weaponSelect.value, this.selection.missionDifficulty);
    });
    this.query('brief-back').addEventListener('click', () => {
      this.showMain();
      this.setMfdPage('campaign');
    });
    this.query('deploy-mission').focus({ preventScroll: true });
  }

  // ミッション結果。星評価・章解放・次ミッション導線を出す
  showMissionResult(result: MatchResult, progress: CampaignProgress): void {
    this.endCapture();
    this.teardownPreview();
    this.root.hidden = false;
    const mission = missionById(progress.missionId);
    const won = result.won;
    const stars = progress.stars;
    // 星は1個ずつspan分割し--iを付与(star-popの捺印stagger用)。読み上げはrole=imgに集約
    const starHtml = won
      ? `<div class="result-stars" role="img" aria-label="評価 ${stars} / 3">${[0, 1, 2]
          .map(
            (i) =>
              `<span class="${i < stars ? 'on' : 'off'}" style="--i:${i}" aria-hidden="true">${i < stars ? '★' : '☆'}</span>`,
          )
          .join('')}</div>`
      : '';
    const unlockNote = progress.chapterUnlocked
      ? `<p class="result-chapter-unlock">新章解放: ${CAMPAIGN.find((c) => c.id === progress.chapterUnlocked)?.title ?? ''}</p>`
      : '';
    const firstNote = progress.firstClear
      ? '<p class="result-firstclear">初制圧ボーナス +800 XP</p>'
      : '';
    const nextId = mission && won ? nextMissionId(mission.id) : null;
    const nextUnlocked = nextId ? isMissionUnlocked(this.profile, nextId) : false;
    const nextBtn =
      nextId && nextUnlocked
        ? '<button class="menu-start" data-id="next-mission">次のミッション</button>'
        : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-result${won ? ' result-won' : ''}">
        <div class="result-panel" role="dialog" aria-modal="true" aria-label="ミッション結果">
          <p class="result-mode">${mission?.title ?? 'ミッション'}</p>
          <h1 data-en="${won ? 'MISSION COMPLETE' : 'MISSION FAILED'}">${won ? 'ミッション達成' : 'ミッション失敗'}</h1>
          ${starHtml}
          ${unlockNote}
          ${firstNote}
          <p class="result-stats">
            <span class="stat-cell">BEST<b>${Math.floor(progress.missionBest?.bestTimeS ?? 0)}s</b></span>
            <span class="stat-cell">ACC<b>${(result.accuracy * 100).toFixed(1)}%</b></span>
            <span class="stat-cell">HS<b>${result.headshots}</b></span>
          </p>
          ${this.progressHtml(progress)}
          <div class="result-buttons">
            ${nextBtn}
            <button class="menu-quiet" data-id="retry-mission">もう一度</button>
            <button class="menu-quiet" data-id="to-campaign">戦役へ戻る</button>
          </div>
        </div>
      </div>
    `;
    this.countUp(this.query('xptotal'), progress.xpTotal);
    this.staggerXpList();
    if (nextId && nextUnlocked) {
      this.query('next-mission').addEventListener('click', () =>
        // ブリーフィングを経由しない直行導線でも、選択中のミッション難易度を引き継ぐ
        this.callbacks.onStartMission(nextId, undefined, this.selection.missionDifficulty),
      );
    }
    this.query('retry-mission').addEventListener('click', () => this.callbacks.onRestart());
    this.query('to-campaign').addEventListener('click', () => {
      // onQuit経由でmatch破棄+音の後始末(quiesce)を必ず通す(直接showMainだと鳴り残る)
      this.callbacks.onQuit();
      this.setMfdPage('campaign');
    });
    this.query(nextId && nextUnlocked ? 'next-mission' : 'to-campaign').focus({
      preventScroll: true,
    });
  }

  // MFDのタブ切替を結線する。クリック+矢印キー(roving tabindex)でページを行き来する
  private wireMfd(): void {
    const rail = this.root.querySelector<HTMLElement>('.mfd-rail');
    if (!rail) return;
    const tabs = Array.from(rail.querySelectorAll<HTMLButtonElement>('.mfd-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.setMfdPage(tab.dataset.page ?? 'deploy'));
    });
    rail.addEventListener('keydown', (e) => {
      const dir =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (dir === 0) return;
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.dataset.page === this.activePage);
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      if (next) {
        this.setMfdPage(next.dataset.page ?? 'deploy');
        next.focus();
      }
    });
    this.setMfdPage(this.activePage);
  }

  private setMfdPage(page: string): void {
    // 初回マウント(wireMfd末の同一ページ呼び)はワイプ無しで即時。以降はワイプ演出。
    // ワイプは swap を同期実行するためフォーカス/プレビュー/aria の挙動は従来どおり。
    if (!this.mfdWiped) {
      this.mfdWiped = true;
      this.applyMfdPage(page);
      return;
    }
    this.wipe(() => this.applyMfdPage(page));
  }

  // 実際のページ差し替え。ページ連動の宇宙背景フォーカスとMFDインク移動もここで駆動する
  private applyMfdPage(page: string): void {
    this.activePage = page;
    this.root.querySelectorAll<HTMLElement>('.mfd-page').forEach((p) => {
      const on = p.dataset.page === page;
      p.hidden = !on;
      p.classList.toggle('active', on);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.mfd-tab').forEach((t) => {
      const on = t.dataset.page === page;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    // ARMORY表示時のみ3Dプレビューを起動(遅延生成)。他ページでは止める
    if (page === 'armory') this.mountWeaponPreview();
    else this.weaponPreview?.suspend();
    // ページに応じて宇宙背景の画角を寄せ、MFDインクを現在タブへ滑らせる
    this.bg?.setFocus(page);
    this.updateMfdInk();
  }

  // MFDインク(選択タブへ滑るインジケータ)を現在タブの座標へ移す。
  // レイアウト確定後(rAF)に offset 系を読み、縦横どちらの表現にも使えるCSS変数で渡す
  private updateMfdInk(): void {
    const ink = this.root.querySelector<HTMLElement>('.mfd-ink');
    if (!ink) return;
    const page = this.activePage;
    requestAnimationFrame(() => {
      const tab = this.root.querySelector<HTMLElement>(`.mfd-tab[data-page="${page}"]`);
      if (!ink.isConnected || !tab) return;
      ink.style.setProperty('--ink-x', `${tab.offsetLeft}px`);
      ink.style.setProperty('--ink-y', `${tab.offsetTop}px`);
      ink.style.setProperty('--ink-w', `${tab.offsetWidth}px`);
      ink.style.setProperty('--ink-h', `${tab.offsetHeight}px`);
    });
  }

  // 画面遷移ワイプ。swap は同期実行(フォーカス/プレビュー/aria を既存どおり保つ)し、
  // 直後にデッキへ .wipe を一瞬載せて掃引で見せる。省モーションは swap のみで演出なし。
  // animationend 不発(タブ休止/GPU/CSS未適用)でも setTimeout フォールバックで確実に畳む。
  private wipe(swap: () => void): void {
    swap();
    if (this.prefersReducedMotion) return;
    const deck = this.root.querySelector<HTMLElement>('.mfd-deck');
    if (!deck) return;
    if (this.wipeTimer !== 0) window.clearTimeout(this.wipeTimer);
    deck.classList.remove('wipe');
    deck.getBoundingClientRect(); // reflowを強制し .wipe アニメを確実に再発火させる
    deck.classList.add('wipe');
    const clear = (): void => {
      if (this.wipeTimer !== 0) {
        window.clearTimeout(this.wipeTimer);
        this.wipeTimer = 0;
      }
      deck.classList.remove('wipe');
    };
    const onEnd = (e: AnimationEvent): void => {
      if (e.target !== deck) return; // 子ページの入場アニメのバブルは無視
      deck.removeEventListener('animationend', onEnd);
      clear();
    };
    deck.addEventListener('animationend', onEnd);
    // フォールバックは掃引アニメ長(mfd-wipe 0.36s)より確実に長く。短いとanimationend
    // 前に毎回打ち切ってしまい主経路が死ぬ。真の不発時のみ畳む保険にする
    this.wipeTimer = window.setTimeout(() => {
      deck.removeEventListener('animationend', onEnd);
      clear();
    }, 480);
  }

  // ARMORYの3D武器プレビューを必要時に生成・再開する
  private mountWeaponPreview(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-id="weapon-canvas"]');
    if (!canvas) return;
    if (!this.weaponPreview) {
      try {
        this.weaponPreview = new WeaponPreview(canvas);
        this.weaponPreview.setReduceMotion(this.prefersReducedMotion);
      } catch {
        // WebGLが使えない環境ではプレビュー無し(リスト/ステータスは従来通り出る)
        this.weaponPreview = null;
        return;
      }
    }
    this.weaponPreview.start();
    this.weaponPreview.resume();
    this.weaponPreview.resize();
    // 3Dとステータス読み出しを同じ武器へ同期(setWeaponだけだと読み出しが取り残される)
    this.previewWeapon(this.currentPrimaryDef());
  }

  // root.innerHTML を差し替える前に必ず呼ぶ。プレビューのGLコンテキストを確実に破棄する
  private teardownPreview(): void {
    if (this.weaponPreview) {
      this.weaponPreview.dispose();
      this.weaponPreview = null;
    }
  }

  showPause(): void {
    this.clearBgTransition();
    this.teardownPreview();
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-pause">
        <div class="pause-panel" role="dialog" aria-modal="true" aria-label="一時停止">
          <h1>一時停止</h1>
          <button class="menu-start" data-id="resume">再開する</button>
          <button class="menu-quiet" data-id="photo">フォトモード</button>
          <section class="menu-section">
            <h2>設定</h2>
            <div data-id="settings"></div>
          </section>
          <button class="menu-quiet" data-id="quit">メニューに戻る</button>
        </div>
      </div>
    `;
    this.renderSettings(this.query('settings'));
    this.query('resume').addEventListener('click', () => this.callbacks.onResume());
    this.query('photo').addEventListener('click', () => this.callbacks.onPhoto());
    this.query('quit').addEventListener('click', () => this.callbacks.onQuit());
    this.query('resume').focus({ preventScroll: true });
  }

  showResult(result: MatchResult, progress: MatchProgress): void {
    this.endCapture();
    this.teardownPreview();
    this.root.hidden = false;
    const mvp = result.rows[0];
    const you = result.rows.find((r) => r.isPlayer);
    const youKills = you?.kills ?? result.summary.kills;
    const grade = computeGrade(result);
    const rowsHtml = result.rows
      .map(
        (row) => `
        <tr class="${row.isPlayer ? 'score-you' : result.teamScores && row.isAlly ? 'score-ally' : ''}">
          <td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>
        </tr>`,
      )
      .join('');
    const teamScoreHtml = result.teamScores
      ? `<p class="result-teamscore"><span class="ts-mine" data-id="tsmine">0</span> - <span class="ts-enemy" data-id="tsenemy">0</span></p>`
      : '';
    // monoテレメトリ見出し: モード / OPR LV / 日付(所要時間はMatchResultに無いため計上しない)
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    this.root.innerHTML = `
      <div class="menu-screen menu-result${result.won ? ' result-won' : ''}">
        <div class="result-panel" role="dialog" aria-modal="true" aria-label="試合結果">
          <div class="aar-telemetry" aria-hidden="true">
            <span class="aar-tele-mode">${result.modeName}</span>
            <span class="aar-tele-item">OPR <b>LV.${progress.levelAfter.level} ${rankNameFor(progress.levelAfter.level).name}</b></span>
            <span class="aar-tele-item">${dateStr}</span>
            <span class="aar-tele-live">AFTER-ACTION</span>
          </div>
          <div class="aar-hero ig-scan">
            <div class="aar-verdict">
              <h1 data-en="${result.won ? 'VICTORY' : 'DEFEAT'}">${result.won ? '勝利' : '敗北'}</h1>
              <p class="result-mvp">MVP: ${mvp ? mvp.name : '-'}</p>
            </div>
            ${this.gradeSigilHtml(grade)}
          </div>
          ${teamScoreHtml}
          <div class="aar-grid">
            <div class="aar-cell"><span class="aar-k">命中率</span><span class="aar-v"><b data-id="aar-acc">0</b><em>%</em></span></div>
            <div class="aar-cell"><span class="aar-k">ヘッドショット</span><span class="aar-v"><b data-id="aar-hs">0</b></span></div>
            <div class="aar-cell"><span class="aar-k">キル</span><span class="aar-v"><b data-id="aar-kills">0</b></span></div>
            <div class="aar-cell"><span class="aar-k">最長連鎖</span><span class="aar-v"><b data-id="aar-streak">0</b></span></div>
            ${result.zombieRound !== undefined ? `<div class="aar-cell"><span class="aar-k">到達ラウンド</span><span class="aar-v"><b>${result.zombieRound}</b></span></div>` : ''}
            ${result.zombiePoints !== undefined ? `<div class="aar-cell"><span class="aar-k">獲得PTS</span><span class="aar-v"><b>${result.zombiePoints.toLocaleString()}</b></span></div>` : ''}
            ${result.papTierMax !== undefined && result.papTierMax > 0 ? `<div class="aar-cell"><span class="aar-k">鍛神改造</span><span class="aar-v"><b>${['-', '改', '改二', '改三'][result.papTierMax] ?? `改${result.papTierMax}`}</b></span></div>` : ''}
            ${result.specialZombieKills !== undefined ? `<div class="aar-cell"><span class="aar-k">特異体討伐</span><span class="aar-v"><b>${result.specialZombieKills}</b></span></div>` : ''}
            ${result.rogue !== undefined ? `<div class="aar-cell"><span class="aar-k">輪廻・供物</span><span class="aar-v"><b>${result.rogue.cards.length}</b><em>枚</em></span></div>` : ''}
          </div>
          ${result.rogue !== undefined && result.rogue.cards.length > 0 ? `<div class="rogue-aar-cards">${result.rogue.cards.map((c) => `<span class="rogue-chip">${c}</span>`).join('')}</div>` : ''}
          ${this.highlightsHtml(result)}
          ${this.matchStoryHtml(result, progress)}
          <table class="result-table">
            <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${this.progressHtml(progress)}
          <div class="result-buttons">
            <button class="menu-start" data-id="restart">もう一度</button>
            <button class="menu-quiet" data-id="menu">メニューに戻る</button>
          </div>
        </div>
      </div>
    `;
    this.query('restart').addEventListener('click', () => this.callbacks.onRestart());
    this.query('menu').addEventListener('click', () => this.callbacks.onQuit());
    this.countUp(this.query('xptotal'), progress.xpTotal);
    this.staggerXpList();
    if (result.teamScores) {
      this.countUp(this.query('tsmine'), result.teamScores.mine, 650);
      this.countUp(this.query('tsenemy'), result.teamScores.enemy, 650);
    }
    // 2×2計器 + 評価スコアのカウントアップ(reduce時はcountUp内で即値へ着地)
    this.countUp(this.query('aar-acc'), Math.round(result.accuracy * 100));
    this.countUp(this.query('aar-hs'), result.headshots);
    this.countUp(this.query('aar-kills'), youKills);
    this.countUp(this.query('aar-streak'), result.summary.bestStreak);
    this.countUp(this.query('aar-score'), Math.round(grade.score));
    this.query('restart').focus({ preventScroll: true });
  }

  // R54-F7: ハイライトカード(最大3枚)。マッチストーリー帯の直上に置く「その試合の見どころ」。
  // 値は全て match 側の内部生成文字列(ユーザー入力なし=HTML安全)。0枚なら帯ごと出さない
  private highlightsHtml(result: MatchResult): string {
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

  // R53 MK.III: マッチストーリー(時系列風イベント帯)。実タイムスタンプは存在しないため
  // 等間隔配置の意匠(matchStoryMarkersのコメント参照)。ラベルは上下交互で重なりを避ける。
  private matchStoryHtml(result: MatchResult, progress: MatchProgress): string {
    const markers = matchStoryMarkers(result, progress);
    if (markers.length <= 2) return ''; // DROP/勝敗のみ=帯にする情報がない
    const W = 600;
    const x0 = 22;
    const x1 = W - 22;
    const yLine = 24;
    const items = markers
      .map((m, i) => {
        const x = markers.length === 1 ? x0 : x0 + (i * (x1 - x0)) / (markers.length - 1);
        const above = i % 2 === 0;
        const label = m.label.length > 16 ? `${m.label.slice(0, 15)}…` : m.label;
        const d = m.kind === 'start' || m.kind === 'end' ? 6 : 4.4;
        return `<g class="mk3m-mk mk3m-mk--${m.tone}">
          <polygon points="${x},${yLine - d} ${x + d},${yLine} ${x},${yLine + d} ${x - d},${yLine}" fill="currentColor" opacity="${m.kind === 'start' || m.kind === 'end' ? 0.95 : 0.8}"/>
          <text x="${x}" y="${above ? yLine - 11 : yLine + 17}" text-anchor="middle">${label}</text>
        </g>`;
      })
      .join('');
    return `
      <div class="mk3m-story" aria-hidden="true">
        <span class="mk3m-story-cap">MATCH STORY</span>
        <svg viewBox="0 0 ${W} 48" preserveAspectRatio="none">
          <line class="mk3m-story-line" x1="${x0}" y1="${yLine}" x2="${x1}" y2="${yLine}" stroke-width="1"/>
          ${items}
        </svg>
      </div>`;
  }

  // 戦闘評価シジル: 面取り六角の刻印にティア色の大グレード1文字。ベベルはSVG内グラデ+
  // feDropShadowグロー(CSS filterはリング回転で毎フレーム再計算されるため使わない)。
  // 細いティックリングは別要素として回転(reduce時はCSS側でアニメごと停止=静止)。
  private gradeSigilHtml(grade: GradeInfo): string {
    const id = `aar${this.gradeSeq++}`;
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

  // リザルト下部の獲得XP・レベル・レート変動の表示
  private progressHtml(progress: MatchProgress): string {
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
    // レベルランク昇位検出(100レベルごとのtier変化を昇位演出として出す)
    const levelRankUp = levelRankUpgrade(progress.levelBefore, progress.levelAfter);
    const levelUp =
      level.level > progress.levelBefore.level
        ? `<p class="result-levelup">レベルアップ LV.${progress.levelBefore.level} → LV.${level.level}${levelRankUp ? ` / ${levelRankUp.name} へ昇位` : ''}</p>`
        : levelRankUp
          ? `<p class="result-levelup">${levelRankUp.name} へ昇位</p>`
          : '';
    const unlockRows = progress.newUnlocks
      .map((u) => `<li>${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${u.name}</li>`)
      .join('');
    // カモ解除!行(XP内訳とは別に、解放一覧としても目立たせる)
    const camoRows = progress.newCamos
      .map((c) => `<li class="result-camo-unlock">カモ解除: ${c.label}</li>`)
      .join('');
    const unlocks =
      unlockRows || camoRows ? `<ul class="result-unlocks">${unlockRows}${camoRows}</ul>` : '';
    const delta = progress.ratingAfter - progress.ratingBefore;
    // レーティング階級(SR数値)は補足として残す。主表示はレベルランク(result-level行)
    const rankNote =
      progress.rankAfter.name === progress.rankBefore.name
        ? `SR ${progress.ratingAfter}`
        : delta > 0
          ? `SR ${progress.ratingAfter} / ${progress.rankAfter.name} へ昇格`
          : `SR ${progress.ratingAfter} / ${progress.rankAfter.name} へ降格`;
    const rating =
      delta === 0
        ? `<p class="result-rating">${rankNote}</p>`
        : `<p class="result-rating">SR ${progress.ratingBefore} <span class="${delta > 0 ? 'rating-up' : 'rating-down'}">${delta > 0 ? '+' : ''}${delta}</span> → ${rankNote}</p>`;
    const recordsHtml = progress.newRecords.length
      ? `<p class="result-record">自己ベスト更新 ${progress.newRecords.join(' / ')}</p>`
      : '';
    // R53-W2: 称号(profile.titles)があれば階級表示の隣に最新のものを小さく出す
    const resultTitle = latestTitle(this.profile.titles);
    const titleHtml = resultTitle ? `<span class="profile-title-badge">${resultTitle}</span>` : '';
    return `
      <section class="result-progress">
        <ul class="result-xp-list">${xpRows}</ul>
        <p class="result-xp-total">獲得 <span data-id="xptotal">0</span> XP</p>
        <div class="result-levelrow">
          <span class="result-level">LV.${level.level} ${rankNameFor(level.level).name}</span>
          ${titleHtml}
          <span class="profile-xpbar"><i style="width:${xpRatio}%"></i></span>
        </div>
        ${levelUp}
        ${unlocks}
        ${recordsHtml}
        ${rating}
      </section>
    `;
  }

  private query(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!node) throw new Error(`menu element not found: ${id}`);
    return node;
  }

  // prefers-reduced-motionの利用者には演出を飛ばして即値を見せる。
  // R14: OSのメディアクエリだけでなくアプリ内設定(画面の揺れを軽減)も併用(JS/WebGL演出の二重ゲート)
  private get prefersReducedMotion(): boolean {
    return (
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
      this.settings.reduceMotion
    );
  }

  // 0から目標値まで数字を駆け上がらせる。画面差し替えで要素が外れたら止める
  private countUp(el: HTMLElement, to: number, durationMs = 750): void {
    if (this.prefersReducedMotion || to <= 0) {
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
  private stagger(container: HTMLElement): void {
    Array.from(container.children).forEach((child, i) => {
      (child as HTMLElement).style.setProperty('--i', String(i));
    });
  }

  // リザルトのXP内訳行に入場staggerを与える(listitem-inのanimation-delayが--iを参照)
  private staggerXpList(): void {
    const xpList = this.root.querySelector<HTMLElement>('.result-xp-list');
    if (xpList) this.stagger(xpList);
  }

  private renderStages(): void {
    const grid = this.query('stages');
    // R16: モード別のステージ一覧(ゾンビは z01〜z10 のみ)。モード切替で作り直す
    grid.replaceChildren();
    const list = stagesForMode(this.selection.mode);
    if (!list.some((s) => s.id === this.selection.stageId)) {
      this.selection.stageId = list[0]?.id ?? this.selection.stageId;
    }
    list.forEach((stage, idx) => {
      const card = document.createElement('button');
      card.className = 'stage-card';
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
        this.selection.stageId = stage.id;
        this.markSelected(grid, 'stage', stage.id);
        this.renderBriefing();
      });
      grid.appendChild(card);
    });
    this.stagger(grid);
    this.markSelected(grid, 'stage', this.selection.stageId);
  }


  private renderWeapons(): void {
    const list = this.query('weapons');
    const tabsHost = this.query('wclass-tabs');
    list.innerHTML = '';
    tabsHost.innerHTML = '';
    const level = this.playerLevel();
    // 保存されていた選択がロック中(記録の読み込み直後など)なら初期武器へ戻す
    if (!isUnlocked('weapon', this.selection.primaryId, level)) {
      this.selection.primaryId = 'kaede-ar';
    }
    // 武器を持つクラスだけタブ化(空クラスは出さない)
    const classes = CLASS_ORDER.filter((cls) =>
      PRIMARY_IDS.some((id) => WEAPON_DEFS[id]?.class === cls),
    );
    // 全28枚を1グリッドへ入れておき、タブで表示クラスだけ display させる
    // (data-cls=絞り込み用 / data-weapon=選択用。タブには data-weapon を付けない)
    for (const cls of classes) {
      for (const id of PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls)) {
        list.appendChild(this.weaponCard(id, 'primary'));
      }
    }
    this.stagger(list); // 入場アニメ(listitem-in)の--i付与
    for (const cls of classes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = cls === 'exotic' ? 'wcls-tab wcls-tab--exotic' : 'wcls-tab';
      tab.dataset.cls = cls;
      tab.setAttribute('role', 'tab');
      tab.textContent = CLASS_LABELS[cls];
      tab.addEventListener('click', () => this.showWeaponClass(cls));
      tabsHost.appendChild(tab);
    }
    // 既定タブ=選択中の主武器のクラス(初期は数枚のみペイント=28枚一括より軽い)
    const activeCls = WEAPON_DEFS[this.selection.primaryId]?.class ?? classes[0] ?? 'ar';
    this.showWeaponClass(activeCls);
    this.markSelected(list, 'weapon', this.selection.primaryId);
    this.refreshDiffChips('primary');
    this.previewWeapon(this.currentPrimaryDef());
  }

  // 表示クラスの切替。該当クラス以外のカードを display:none(.off)にし、タブの選択状態を更新する
  private showWeaponClass(cls: WeaponClass): void {
    const list = this.query('weapons');
    list.querySelectorAll<HTMLElement>('.weapon-card').forEach((card) => {
      card.classList.toggle('off', card.dataset.cls !== cls);
    });
    const tabs = this.query('wclass-tabs');
    tabs.querySelectorAll<HTMLElement>('.wcls-tab').forEach((tab) => {
      const on = tab.dataset.cls === cls;
      tab.classList.toggle('selected', on);
      tab.setAttribute('aria-selected', String(on));
    });
    // R53 MK.III: EXOTICタブ選択中は神殿(紫金)モードへ(グリッド+プレビュー祭壇の両方)
    const shrine = cls === 'exotic';
    list.classList.toggle('mk3m-exotic-shrine', shrine);
    this.root.querySelector('.armory-preview')?.classList.toggle('mk3m-exotic-shrine', shrine);
  }

  private renderSecondaries(): void {
    const list = this.query('secondaries');
    list.innerHTML = '';
    const level = this.playerLevel();
    if (!isUnlocked('weapon', this.selection.secondaryId, level))
      this.selection.secondaryId = 'suzume';
    // 副武器はハンドガン1クラスのためタブ無しでグリッド直描画
    for (const id of SECONDARY_IDS) list.appendChild(this.weaponCard(id, 'secondary'));
    this.stagger(list);
    this.markSelected(list, 'weapon2', this.selection.secondaryId);
    this.refreshDiffChips('secondary');
  }

  // 主/副共通の武器カード。クリックで選択し3Dプレビュー+ステータスを更新する
  private weaponCard(id: string, slot: 'primary' | 'secondary'): HTMLButtonElement {
    const def = WEAPON_DEFS[id] ?? WEAPON_DEFS['kaede-ar']!;
    const level = this.playerLevel();
    const unlocked = isUnlocked('weapon', id, level);
    const isExotic = def.class === 'exotic';
    const card = document.createElement('button');
    card.type = 'button';
    const baseClass = unlocked ? 'weapon-card' : 'weapon-card locked';
    card.className = isExotic ? `${baseClass} exotic` : baseClass;
    const key = slot === 'primary' ? 'weapon' : 'weapon2';
    card.dataset[key] = id;
    card.dataset.cls = def.class; // タブ絞り込み用(副武器グリッドでは未使用=無害)
    const mode =
      def.mode === 'auto'
        ? 'フルオート'
        : def.mode === 'burst'
          ? `バースト${def.burstCount}`
          : '単発';
    const lockNote = unlocked
      ? ''
      : `<span class="locked-note">Lv ${unlockLevelOf('weapon', id)} で解放</span>`;
    const shape = def.shape ?? CLASS_SHAPE[def.class] ?? 'rifle';
    const exoticBadge = isExotic
      ? `<span class="exotic-badge" aria-label="特殊兵装">EXOTIC</span>`
      : '';
    card.innerHTML =
      `<span class="weapon-sil" aria-hidden="true">${weaponSilSVG(shape, def.tracerColor)}</span>` +
      `<span class="weapon-name">${def.name}</span>` +
      `<span class="weapon-mode">${mode} / 装弾 ${def.magazineSize}</span>` +
      `<span class="mk3m-diff" aria-hidden="true"></span>${exoticBadge}${lockNote}`;
    if (!unlocked) {
      card.disabled = true;
      return card;
    }
    card.addEventListener('click', () => {
      if (slot === 'primary') {
        this.selection.primaryId = id;
        this.markSelected(this.query('weapons'), 'weapon', id);
        // R14: 先に光学の適合ゲートを再評価して不適合な倍率光学を外し(syncAttachmentsで
        // selection.attachmentsも更新)、その確定ロードアウトでプレビュー/数値を描く(順序重要)
        this.renderAttachments();
        this.previewWeapon(this.currentPrimaryDef());
        this.renderBriefing();
      } else {
        this.selection.secondaryId = id;
        this.markSelected(this.query('secondaries'), 'weapon2', id);
        this.previewWeapon(def);
      }
      // MK.III: 装備が変わったので全カードの差分チップを引き直す
      this.refreshDiffChips(slot);
    });
    return card;
  }

  // R53 MK.III: 各武器カードの「装備中との差分」チップを更新する。
  // 基礎def同士(アタッチメント無し)の比較=カードの表示条件と揃える。装備中カードは空。
  private refreshDiffChips(slot: 'primary' | 'secondary'): void {
    const listId = slot === 'primary' ? 'weapons' : 'secondaries';
    const equippedId = slot === 'primary' ? this.selection.primaryId : this.selection.secondaryId;
    const equipped = WEAPON_DEFS[equippedId];
    if (!equipped) return;
    const key = slot === 'primary' ? 'weapon' : 'weapon2';
    this.query(listId)
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

  // 選択中の主武器(アタッチメント適用済み)
  private currentPrimaryDef(): WeaponDef {
    const base = WEAPON_DEFS[this.selection.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    return applyAttachments(base, this.selection.attachments);
  }

  // 3Dプレビューとステータス読み出しを更新する(プレビュー未生成なら読み出しのみ)
  private previewWeapon(def: WeaponDef): void {
    this.weaponPreview?.setWeapon(def);
    this.renderArmoryReadout(def);
  }

  private renderArmoryReadout(def: WeaponDef): void {
    const name = this.root.querySelector<HTMLElement>('[data-id="armory-wname"]');
    const barsEl = this.root.querySelector<HTMLElement>('[data-id="armory-bars"]');
    const statsEl = this.root.querySelector<HTMLElement>('[data-id="armory-stats"]');
    if (!name || !barsEl || !statsEl) return;
    name.textContent = def.name;
    // 主ステータスはBO3語彙の横バー(10分割セグメント点火バー)を維持する
    const bars = computeWeaponBars(def);
    barsEl.innerHTML = BAR_AXES.map(([k, label]) => this.bar(label, bars[k])).join('');
    // 派生スタットは副次表示(DPS / 確殺弾数 / TTK / RPM)
    const d = computeDerivedStats(def);
    statsEl.innerHTML =
      `<span>DPS <b>${d.dps}</b></span><span>確殺 <b>${d.shotsToKill}</b></span>` +
      `<span>TTK <b>${d.ttk}</b><em>ms</em></span><span>RPM <b>${d.effRpm}</b></span>`;
    // R53 MK.III: EXOTIC神殿の奥義解説カード(溜め攻撃/Mウルト)
    const loreEl = this.root.querySelector<HTMLElement>('[data-id="armory-exotic"]');
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
    this.renderCamoSection(def);
  }

  // ── 武器カモ(BO2/BO3式チャレンジ)────────────────────────────────
  // 解除済みチップ=クリックで装備、未解除=ロック表示+条件と進捗。ダイヤ/ダークマターは
  // マスタリー特別枠。装備はプロファイルへ即保存し、3Dプレビューを作り直して反映する。
  private renderCamoSection(def: WeaponDef): void {
    const host = this.root.querySelector<HTMLElement>('[data-id="armory-camo"]');
    if (!host) return;
    if (def.id === 'fists') {
      this.renderKunaiCamoSection(def, host);
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
      isCamoUnlocked(id, def.id, this.profile.weaponStats, this.profile.unlockedRewardCamos),
    ).length;
    host.innerHTML = `
      <div class="camo-head"><span>カモフラージュ</span><b>${unlockedCount}/${CAMO_IDS.length}</b></div>
      <div class="camo-grid" data-id="camo-grid"></div>
      <div class="camo-grid camo-grid--mastery" data-id="camo-mastery"></div>
    `;
    const grid = host.querySelector<HTMLElement>('[data-id="camo-grid"]');
    const masteryGrid = host.querySelector<HTMLElement>('[data-id="camo-mastery"]');
    if (!grid || !masteryGrid) return;
    const equipped = this.profile.selectedCamos[def.id] ?? null;
    grid.appendChild(this.camoChip(def, null, equipped));
    for (const tier of CAMO_TIERS) grid.appendChild(this.camoChip(def, tier.id, equipped));
    masteryGrid.appendChild(this.camoChip(def, 'diamond', equipped, true));
    masteryGrid.appendChild(this.camoChip(def, 'dark-matter', equipped, true));
    // R53-W2: 報酬カモ(ストーリー章クリア報酬)。マスタリー枠に追加表示する
    for (const id of REWARD_CAMO_IDS) masteryGrid.appendChild(this.camoChip(def, id, equipped, true));
  }

  // クナイ(fists)専用カモセクション: 9段+常闇
  private renderKunaiCamoSection(def: WeaponDef, host: HTMLElement): void {
    ensureCamoStyle();
    host.hidden = false;
    const kunaiStats = this.profile.weaponStats['fists'];
    const unlockedCount = KUNAI_CAMO_IDS.filter((id) => isKunaiCamoUnlocked(id, kunaiStats)).length;
    host.innerHTML = `
      <div class="camo-head"><span>カモフラージュ</span><b>${unlockedCount}/${KUNAI_CAMO_IDS.length}</b></div>
      <div class="camo-grid" data-id="camo-grid"></div>
      <div class="camo-grid camo-grid--mastery" data-id="camo-mastery"></div>
    `;
    const grid = host.querySelector<HTMLElement>('[data-id="camo-grid"]');
    const masteryGrid = host.querySelector<HTMLElement>('[data-id="camo-mastery"]');
    if (!grid || !masteryGrid) return;
    const equipped = this.profile.selectedCamos[def.id] ?? null;
    grid.appendChild(this.camoChip(def, null, equipped));
    for (const tier of CAMO_TIERS) grid.appendChild(this.camoChip(def, tier.id, equipped, false, true));
    masteryGrid.appendChild(this.camoChip(def, TOKOYAMI_CAMO.id, equipped, true, true));
  }

  // カモチップ1枚。camoId=null は「なし(標準の質感)」。kunai=true はクナイ専用判定
  private camoChip(
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
      btn.addEventListener('click', () => this.equipCamo(def, null));
      return btn;
    }
    const v = CAMO_VISUALS[camoId];
    const unlocked = kunai
      ? isKunaiCamoUnlocked(camoId, this.profile.weaponStats['fists'])
      : isCamoUnlocked(camoId, def.id, this.profile.weaponStats, this.profile.unlockedRewardCamos);
    const on = unlocked && equipped === camoId;
    const swatch = `background:linear-gradient(135deg, ${tracerHex(v.colorA)} 0%, ${tracerHex(v.colorB)} 55%, ${tracerHex(v.colorC)} 100%)`;
    btn.className =
      `camo-chip${mastery ? ' mastery' : ''}${on ? ' selected' : ''}${unlocked ? '' : ' locked'}`;
    btn.setAttribute('aria-pressed', String(on));
    if (unlocked) {
      btn.innerHTML =
        `<i class="camo-swatch" style="${swatch}"></i>` +
        `<span class="camo-name">${camoName(camoId)}</span>` +
        `<span class="camo-sub">${on ? '装備中' : '解除済み'}</span>`;
      btn.addEventListener('click', () => this.equipCamo(def, camoId));
      return btn;
    }
    // 未解除: 条件テキスト + 進捗 n/条件(バー付き)。クリック不可
    const p = kunai
      ? kunaiCamoProgress(camoId, this.profile.weaponStats['fists'])
      : camoProgress(camoId, def.id, this.profile.weaponStats);
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
  private equipCamo(def: WeaponDef, camoId: CamoId | null): void {
    if (camoId === null) delete this.profile.selectedCamos[def.id];
    else this.profile.selectedCamos[def.id] = camoId;
    saveProfile(this.profile);
    // buildGunBody がプロファイルから装備カモを解決するので、作り直しだけで反映される
    this.previewWeapon(this.currentPrimaryDef());
  }

  // 10分割セグメント点火バー(0..10)。左から value 個を点灯。box-shadow glow は使わない。
  private bar(label: string, value: number): string {
    const v = Math.max(0, Math.min(10, Math.round(value)));
    let segs = '';
    for (let i = 0; i < 10; i += 1) segs += i < v ? '<i class="on"></i>' : '<i></i>';
    return (
      `<span class="stat-seg-row"><span class="stat-seg-label">${label}</span>` +
      `<span class="stat-bar--seg">${segs}</span>` +
      `<span class="stat-seg-num">${v}</span></span>`
    );
  }

  private renderProfile(): void {
    const panel = this.query('profile');
    const level = levelFromXp(this.profile.xp);
    const rank = rankFromRating(this.profile.rating);
    const stats = this.profile.stats;
    const winRate = stats.matches > 0 ? ((stats.wins / stats.matches) * 100).toFixed(0) : '-';
    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
    const accuracy =
      stats.shotsFired > 0 ? ((stats.shotsHit / stats.shotsFired) * 100).toFixed(1) : '-';
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const records = this.profile.records;
    const streakNow =
      records.currentWinStreak >= 2
        ? ` <span class="profile-streak">${records.currentWinStreak}連勝中</span>`
        : '';
    const recordsLine =
      records.mostKills > 0 || records.bestWinStreak > 0
        ? `<div class="profile-records">自己ベスト 最多キル <b>${records.mostKills}</b> / 最長連勝 <b>${records.bestWinStreak}</b>${streakNow}</div>`
        : '';
    // R53-W2: 称号(profile.titles)があれば階級表示の隣に最新のものを小さく出す
    const profileTitle = latestTitle(this.profile.titles);
    const titleHtml = profileTitle ? `<span class="profile-title-badge">${profileTitle}</span>` : '';
    panel.innerHTML = `
      <div class="profile-top">
        <span class="profile-rank">LV.${level.level} ${rankNameFor(level.level).name}</span>
        ${titleHtml}
        <span class="profile-rating">SR ${this.profile.rating} / ${rank.name}</span>
      </div>
      <div class="profile-xpbar"><i style="width:${xpRatio}%"></i></div>
      <div class="profile-stats">${stats.matches}戦 / 勝率 ${winRate}% / K/D ${kd} / 命中 ${accuracy}%</div>
      ${recordsLine}
      <div class="profile-actions">
        <button class="profile-btn" data-id="export">記録を書き出す</button>
        <button class="profile-btn" data-id="import">記録を読み込む</button>
      </div>
    `;
    this.query('export').addEventListener('click', () => exportProfile(this.profile));
    this.query('import').addEventListener('click', () => {
      importProfile((imported) => {
        Object.assign(this.profile, imported);
        saveProfile(this.profile);
        this.showMain();
      });
    });
  }

  private renderChallenges(): void {
    const list = this.query('challenges');
    for (const challenge of CHALLENGES) {
      const done = this.profile.completedChallenges.includes(challenge.id);
      const [current, goal] = challenge.progress(this.profile.stats, this.profile.weaponKills);
      const row = document.createElement('div');
      row.className = done ? 'challenge-row challenge-done' : 'challenge-row';
      row.innerHTML = `
        <span class="challenge-name">${challenge.name}</span>
        <span class="challenge-desc">${challenge.desc}</span>
        <span class="challenge-bar"><i style="width:${done ? 100 : (current / goal) * 100}%"></i></span>
        <span class="challenge-xp">${done ? '達成' : `${challenge.xp} XP`}</span>
      `;
      list.appendChild(row);
    }
    this.stagger(list);
  }

  // ── 本日のチャレンジパネル(IGNITION FRAME 意匠) ─────────────────────
  private renderDailies(): void {
    const panel = this.root.querySelector<HTMLElement>('[data-id="daily-panel"]');
    if (!panel) return;

    // 日付が変わっていたらステートをリフレッシュ(表示の一貫性)
    const dateSeed = todayDateSeed();
    const nowDate = dateStringFromSeed(dateSeed);
    refreshDailiesDate(this.profile.daily, nowDate);

    const challenges = dailiesFor(dateSeed);
    const daily = this.profile.daily;
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
      const progressText = claimed
        ? `${ch.target}/${ch.target}`
        : `${prog}/${ch.target}`;
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

  private renderModes(): void {
    const list = this.query('modes');
    for (const id of MODE_IDS) {
      const def = MODE_DEFS[id];
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.dataset.mode = id;
      card.innerHTML = `
        <span class="mode-name">${def.name}</span>
        <span class="mode-desc">${def.desc}</span>
      `;
      card.addEventListener('click', () => {
        this.selection.mode = id;
        this.markSelected(list, 'mode', id);
        // R16: モード別のステージ一覧を作り直す(ゾンビ⇔通常でステージ集合が変わる)
        this.renderStages();
        this.renderZombieRoundSelector();
        this.renderCharmSelector();
        this.renderRogueToggle();
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'mode', this.selection.mode);
  }

  private renderAttachments(): void {
    const panel = this.query('attachments');
    // R14: 冪等化。武器切替で再実行されるため、既存行をクリアしないとスロット行が重複増殖する
    panel.replaceChildren();
    const level = this.playerLevel();
    // R13: 光学の武器適合ゲート。内蔵スコープ機(狙撃/DMR)や拳銃系に倍率光学を出さない
    // (装着すると視覚はネイティブのまま・ズームだけ静かに書き換わる split-brain を防ぐ)。
    const primaryDef = this.currentPrimaryDef();
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
      const selected = this.attachmentBySlot[slot];
      if (
        selected &&
        (!isUnlocked('attachment', selected, level) ||
          (slot === 'sight' && !opticFits(selected)))
      ) {
        this.attachmentBySlot[slot] = null;
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
          this.attachmentBySlot[slot] = choice.id;
          this.syncAttachments();
          buttons.querySelectorAll('.attach-btn').forEach((node) => {
            const on = (node as HTMLElement).dataset.attach === (choice.id ?? 'none');
            node.classList.toggle('selected', on);
            node.setAttribute('aria-pressed', String(on));
          });
          // アタッチメント変更を3Dプレビュー/ステータスへ即反映
          this.previewWeapon(this.currentPrimaryDef());
          this.renderBriefing();
        });
        const active = (this.attachmentBySlot[slot] ?? 'none') === (choice.id ?? 'none');
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', String(active));
        buttons.appendChild(btn);
      }
      row.appendChild(buttons);
      panel.appendChild(row);
    }
    this.syncAttachments();
  }

  private renderGrenades(): void {
    const list = this.query('grenades');
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
        this.selection.grenade = kind;
        this.markSelected(list, 'grenade', kind);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'grenade', this.selection.grenade);
  }

  private renderDifficulties(): void {
    const list = this.query('difficulties');
    for (const item of DIFFICULTIES) {
      const card = document.createElement('button');
      card.className = 'difficulty-card';
      card.dataset.difficulty = item.id;
      card.innerHTML = `<span class="difficulty-name">${item.label}</span><span class="difficulty-desc">${item.desc}</span>`;
      card.addEventListener('click', () => {
        this.selection.difficulty = item.id;
        this.markSelected(list, 'difficulty', item.id);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'difficulty', this.selection.difficulty);
  }

  private renderSpecialOptions(): void {
    const wire = (id: string, key: 'hellMode' | 'allGiantMode'): void => {
      const el = this.root.querySelector<HTMLInputElement>(`input[data-id="${id}"]`);
      if (!el) return;
      el.checked = this.selection[key] ?? false;
      el.addEventListener('change', () => {
        this.selection[key] = el.checked;
      });
    };
    wire('hellMode', 'hellMode');
    wire('allGiantMode', 'allGiantMode');
  }

  // ── R54-F5 輪廻(ローグラン)トグル。ゾンビ選択時のみ表示 ────────────────────
  // ON中は排他対象(超鬼畜/全巨躯/開始ラウンド/お守り)をUIでも無効化する
  // (main.tsの転記段階でも構造的に落とすため二重の安全)
  private renderRogueToggle(): void {
    const wrap = this.root.querySelector<HTMLElement>('[data-id="rogue-wrap"]');
    if (!wrap) return;
    const isZombie = this.selection.mode === 'zombie';
    wrap.hidden = !isZombie;
    const el = wrap.querySelector<HTMLInputElement>('input[data-id="rogueRun"]');
    if (!el) return;
    el.checked = this.selection.rogueRun ?? false;
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('change', () => {
        this.selection.rogueRun = el.checked;
        this.applyRogueExclusivity();
      });
    }
    this.applyRogueExclusivity();
  }

  private applyRogueExclusivity(): void {
    const locked = this.selection.mode === 'zombie' && this.selection.rogueRun === true;
    for (const id of ['hellMode', 'allGiantMode']) {
      const input = this.root.querySelector<HTMLInputElement>(`input[data-id="${id}"]`);
      if (input) input.disabled = locked;
    }
    for (const wrapId of ['zombie-round-wrap', 'charm-wrap']) {
      this.root.querySelector<HTMLElement>(`[data-id="${wrapId}"]`)?.classList.toggle('rogue-locked', locked);
    }
  }

  // ── ゾンビモード専用: 開始ラウンドセレクタ ──────────────────────────
  // ゾンビ選択時のみ表示。ステッパー(±)とプリセットチップを並べる。
  // IGNITION FRAME 意匠: attach-btn チップ + ember アクセント。
  private renderZombieRoundSelector(): void {
    const wrap = this.root.querySelector<HTMLElement>('[data-id="zombie-round-wrap"]');
    if (!wrap) return;
    const isZombie = this.selection.mode === 'zombie';
    wrap.hidden = !isZombie;
    if (!isZombie) return;

    const sel = wrap.querySelector<HTMLElement>('[data-id="zombie-round-selector"]');
    if (!sel) return;

    const ZR_PRESETS = [1, 10, 25, 50, 100, 200, 300, 500, 999] as const;
    const cur = this.selection.zombieStartRound ?? 1;

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
      this.selection.zombieStartRound = Math.max(1, Math.min(999, v));
      this.renderZombieRoundSelector();
      this.renderBriefing();
      // V27修正: innerHTML全置換でフォーカスがbodyへ落ち、パッド/キーボードのナビが
      // ページ先頭へ吹き飛ぶ。再描画後に同じ操作ボタンへフォーカスを戻す(連打可能に)
      if (refocus) sel.querySelector<HTMLElement>(refocus)?.focus();
    };

    sel.querySelector<HTMLElement>('[data-id="zr-dec"]')?.addEventListener('click', () => setRound(cur - 1, '[data-id="zr-dec"]'));
    sel.querySelector<HTMLElement>('[data-id="zr-inc"]')?.addEventListener('click', () => setRound(cur + 1, '[data-id="zr-inc"]'));
    sel.querySelectorAll<HTMLElement>('[data-zr]').forEach((btn) => {
      btn.addEventListener('click', () => setRound(Number(btn.dataset.zr), `[data-zr="${btn.dataset.zr}"]`));
    });
  }

  // ── ゾンビモード専用: お守り(charm)ピッカー ─────────────────────────
  // 解放済みのみ選択可。装備は profile.charms.equipped へ即保存し(camoの装備保存と同じ
  // 流儀)、this.selection.charm を同期する(onStart時にそのままMatchConfigへ渡る)。
  private renderCharmSelector(): void {
    const wrap = this.root.querySelector<HTMLElement>('[data-id="charm-wrap"]');
    if (!wrap) return;
    const isZombie = this.selection.mode === 'zombie';
    wrap.hidden = !isZombie;
    if (!isZombie) return;

    const grid = wrap.querySelector<HTMLElement>('[data-id="charm-grid"]');
    if (!grid) return;
    if (!this.profile.charms) this.profile.charms = { unlocked: [], equipped: null };
    const charms = this.profile.charms;
    // 前回セッション/前試合で装備済みのcharmを選択へ同期する
    this.selection.charm = charms.equipped ?? undefined;

    grid.innerHTML = '';
    const noneOn = charms.equipped === null;
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = `charm-chip${noneOn ? ' selected' : ''}`;
    noneBtn.setAttribute('aria-pressed', String(noneOn));
    noneBtn.innerHTML =
      '<span class="charm-name">なし</span><span class="charm-desc">お守りを装備しない</span>';
    noneBtn.addEventListener('click', () => this.equipCharm(null));
    grid.appendChild(noneBtn);

    for (const id of CHARM_IDS) {
      const def = CHARMS[id];
      const status = charmChipStatus(charms, id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `charm-chip${status === 'equipped' ? ' selected' : ''}${status === 'locked' ? ' locked' : ''}`;
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
        btn.addEventListener('click', () => this.equipCharm(id));
      }
      grid.appendChild(btn);
    }
  }

  // charmを装備(null=外す)してプロファイルへ保存する(equipCamoと同じ即時保存の流儀)
  private equipCharm(id: CharmId | null): void {
    if (!this.profile.charms) this.profile.charms = { unlocked: [], equipped: null };
    if (id !== null && !this.profile.charms.unlocked.includes(id)) return; // 未解放は装備不可(UIも disabled で塞ぎ済み)
    this.profile.charms.equipped = id;
    saveProfile(this.profile);
    this.renderCharmSelector();
  }

  private renderBriefing(): void {
    const stage = STAGES.find((item) => item.id === this.selection.stageId) ?? STAGES[0];
    const mode = MODE_DEFS[this.selection.mode];
    const weapon = WEAPON_DEFS[this.selection.primaryId];
    const grenade = GRENADE_SPECS[this.selection.grenade];
    const difficulty = DIFFICULTIES.find((item) => item.id === this.selection.difficulty);
    this.query('brief-stage').textContent = stage?.name ?? '-';
    this.query('brief-mode').textContent = mode.name;
    this.query('brief-weapon').textContent = weapon?.name ?? '-';
    this.query('brief-grenade').textContent =
      this.selection.attachments.length > 0
        ? `${grenade.name} / Attach ${this.selection.attachments.length}`
        : grenade.name;
    this.query('brief-difficulty').textContent = difficulty?.label ?? '-';
    // ゾンビモード限定行: 開始ラウンド表示 (hidden属性はDOMで切り替え)
    const zombieRoundRow = this.root.querySelector<HTMLElement>('[data-id="brief-zombie-round"]');
    if (zombieRoundRow) {
      zombieRoundRow.hidden = this.selection.mode !== 'zombie';
      this.query('brief-zombie-round-val').textContent =
        `R${this.selection.zombieStartRound ?? 1}`;
    }
  }

  private markSelected(container: HTMLElement, key: string, value: string): void {
    container.querySelectorAll<HTMLElement>('[data-' + key + ']').forEach((node) => {
      const on = node.dataset[key] === value;
      node.classList.toggle('selected', on);
      // 選択トグルであることと現在の状態を支援技術へ伝える
      node.setAttribute('aria-pressed', String(on));
    });
  }

  private renderControls(): void {
    const grid = this.query('controls');
    for (const [label, keys] of CONTROLS) {
      // keys==='' はセクションヘッダー行: 両カラムをまたぐ見出しセルとして描画
      if (keys === '') {
        const hdr = document.createElement('span');
        hdr.className = 'control-section-header';
        hdr.style.cssText = 'grid-column:1/-1;font-size:0.7em;letter-spacing:0.12em;color:#ffc04b;text-transform:uppercase;padding:0.6em 0 0.1em;opacity:0.85;';
        hdr.textContent = label;
        grid.append(hdr);
        continue;
      }
      const action = document.createElement('span');
      action.className = 'control-action';
      action.textContent = label;
      const key = document.createElement('span');
      key.className = 'control-key';
      key.textContent = keys;
      grid.append(action, key);
    }
  }

  private renderSettings(container: HTMLElement): void {
    container.className = 'settings-panel';
    // 画面差し替えで捕捉中だったリバインドは無効化する(コールバック・keydownリスナを残さない)
    this.endCapture();
    container.innerHTML = '';
    // R10: 設定を系統別(F01照準/F02音響/F03表示/F04交戦規定/F05操縦)に分節する。
    // 見出しh3は非focusableなのでゲームパッドのフォーカス巡回順には影響しない
    container.append(
      this.subhead('照準 / AIM', 'F01'),
      this.slider('マウス感度', 0.2, 3, 0.05, this.settings.sensitivity, (v) => {
        this.settings.sensitivity = v;
      }),
      this.slider('ADS感度倍率', 0.3, 1.5, 0.05, this.settings.adsSensMul, (v) => {
        this.settings.adsSensMul = v;
      }),
      this.slider('視野角(FOV)', 60, 110, 1, this.settings.fov, (v) => {
        this.settings.fov = v;
      }),
      this.checkbox('Y軸を反転する', this.settings.invertY, (v) => {
        this.settings.invertY = v;
      }),
      this.checkbox('ADSをトグルにする', this.settings.adsToggle, (v) => {
        this.settings.adsToggle = v;
      }),
      this.checkbox('しゃがみをトグルにする', this.settings.crouchToggle, (v) => {
        this.settings.crouchToggle = v;
      }),
      this.checkbox('エイムアシスト', this.settings.aimAssist, (v) => {
        this.settings.aimAssist = v;
      }),
      this.slider('エイムアシスト強度', 0, 1, 0.05, this.settings.aimAssistStrength, (v) => {
        this.settings.aimAssistStrength = v;
      }),
      this.subhead('音響 / AUDIO', 'F02'),
      this.slider('全体音量', 0, 1, 0.05, this.settings.volMaster, (v) => {
        this.settings.volMaster = v;
      }),
      this.slider('効果音量', 0, 1, 0.05, this.settings.volSfx, (v) => {
        this.settings.volSfx = v;
      }),
      this.slider('UI音量', 0, 1, 0.05, this.settings.volUi, (v) => {
        this.settings.volUi = v;
      }),
      this.slider('アナウンサー音量', 0, 1, 0.05, this.settings.announcerVolume, (v) => {
        this.settings.announcerVolume = v;
      }),
      this.checkbox('戦闘BGM(動的)', this.settings.musicEnabled, (v) => {
        this.settings.musicEnabled = v;
      }),
      this.subhead('表示 / INTERFACE', 'F03'),
      this.slider('UIの大きさ', 0.8, 1.3, 0.05, this.settings.uiScale, (v) => {
        this.settings.uiScale = v;
      }),
      this.select(
        'UIのアクセント',
        UI_ACCENTS.map((a) => ({ value: a.id, label: a.name })),
        this.settings.uiAccent,
        (v) => {
          this.settings.uiAccent = v;
        },
      ),
      this.select(
        '敵味方の配色',
        TEAM_PALETTES.map((p) => ({ value: p.id, label: p.name })),
        this.settings.teamPaletteId,
        (v) => {
          this.settings.teamPaletteId = v;
        },
      ),
      this.select(
        'レティクル形状',
        RETICLE_STYLES.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleStyle,
        (v) => {
          this.settings.reticleStyle = v;
        },
      ),
      this.select(
        'レティクル色',
        RETICLE_COLORS.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleColor,
        (v) => {
          this.settings.reticleColor = v;
        },
      ),
      this.checkbox('簡易レーダーを表示', this.settings.radarEnabled, (v) => {
        this.settings.radarEnabled = v;
      }),
      this.slider('画面の揺れ', 0, 1, 0.05, this.settings.screenShake, (v) => {
        this.settings.screenShake = v;
      }),
      this.checkbox('画面の揺れを軽減する', this.settings.reduceMotion, (v) => {
        this.settings.reduceMotion = v;
      }),
      this.subhead('交戦規定 / MATCH', 'F04'),
      this.select(
        '試合時間',
        MATCH_LENGTHS.map((m) => ({ value: String(m.value), label: m.label })),
        String(this.settings.matchLengthS),
        (v) => {
          this.settings.matchLengthS = Number(v);
        },
      ),
    );

    // 画質ティア(再読み込みで完全反映)。レンダラ/ポスト処理は起動時に確定するため注記を添える
    const gfx = this.select(
      '画質',
      GRAPHICS_QUALITIES.map((q) => ({ value: q, label: GRAPHICS_LABELS[q] })),
      this.settings.graphicsQuality,
      (v) => {
        this.settings.graphicsQuality = v as GraphicsQuality;
      },
    );
    const gfxNote = document.createElement('p');
    gfxNote.className = 'setting-note';
    gfxNote.textContent = '※ 画質の変更はページの再読み込みで完全に反映されます';
    container.append(gfx, gfxNote);

    // ゲームパッド設定一式(感度/デッドゾーン/応答カーブ/反転/振動/プリセット/リバインド)
    container.appendChild(this.buildGamepadSettings());

    // 設定を既定へ戻すボタン
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'setting-reset';
    reset.textContent = '設定を既定に戻す';
    reset.addEventListener('click', () => {
      this.endCapture();
      this.bindNote = '';
      Object.assign(this.settings, DEFAULT_SETTINGS);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderSettings(container);
    });
    container.appendChild(reset);
  }

  // ── ゲームパッド設定セクション ────────────────────────────────────
  private buildGamepadSettings(): HTMLElement {
    const sb = SETTING_BOUNDS;
    const b = {
      sensX: sb.gamepadSensX,
      sensY: sb.gamepadSensY,
      deadzone: sb.gamepadDeadzone,
      exp: sb.gamepadResponseExp,
    };
    const section = document.createElement('section');
    section.className = 'gamepad-settings';
    const heading = document.createElement('h3');
    heading.className = 'settings-subhead';
    heading.textContent = '操縦系統 / GAMEPAD';
    heading.dataset.code = 'F05'; // 見出し右端の系統コード(CSSのattr()で描画)
    section.appendChild(heading);
    const intro = document.createElement('p');
    intro.className = 'setting-note';
    intro.textContent =
      'PS4 DualShock などの標準ゲームパッドに対応。既定はBO3標準配置。OPTIONSで一時停止。';
    section.appendChild(intro);

    section.append(
      this.slider('横感度', b.sensX.min, b.sensX.max, 0.1, this.settings.gamepadSensX, (v) => {
        this.settings.gamepadSensX = v;
      }),
      this.slider('縦感度', b.sensY.min, b.sensY.max, 0.1, this.settings.gamepadSensY, (v) => {
        this.settings.gamepadSensY = v;
      }),
      this.slider(
        'デッドゾーン',
        b.deadzone.min,
        b.deadzone.max,
        0.01,
        this.settings.gamepadDeadzone,
        (v) => {
          this.settings.gamepadDeadzone = v;
        },
      ),
      this.slider(
        '応答カーブ指数',
        b.exp.min,
        b.exp.max,
        0.05,
        this.settings.gamepadResponseExp,
        (v) => {
          this.settings.gamepadResponseExp = v;
        },
      ),
      this.select(
        '応答カーブ',
        (Object.keys(CURVE_LABELS) as GamepadResponseCurve[]).map((c) => ({
          value: c,
          label: CURVE_LABELS[c],
        })),
        this.settings.gamepadResponseCurve,
        (v) => {
          this.settings.gamepadResponseCurve = v as GamepadResponseCurve;
        },
      ),
      this.checkbox('Y軸を反転する(パッド)', this.settings.gamepadInvertY, (v) => {
        this.settings.gamepadInvertY = v;
      }),
      this.checkbox('振動(対応環境のみ)', this.settings.gamepadVibration, (v) => {
        this.settings.gamepadVibration = v;
      }),
    );

    // プリセット選択。binding表と相互参照するため手組みする
    const layoutRow = document.createElement('label');
    layoutRow.className = 'setting-row';
    const layoutText = document.createElement('span');
    layoutText.textContent = '配置プリセット';
    const layoutSelect = document.createElement('select');
    for (const layout of GP_LAYOUTS) {
      const opt = document.createElement('option');
      opt.value = layout.id;
      opt.textContent = layout.name;
      layoutSelect.appendChild(opt);
    }
    layoutSelect.value = this.settings.gamepadLayout;
    layoutRow.append(layoutText, layoutSelect);
    section.appendChild(layoutRow);

    const host = document.createElement('div');
    host.className = 'rebind-table';
    section.appendChild(host);

    layoutSelect.addEventListener('change', () => {
      const id = layoutSelect.value as (typeof GP_LAYOUTS)[number]['id'];
      this.settings.gamepadLayout = id;
      // プリセットへ切替: そのプリセットを複製して実バインドへ反映。customは現状維持(複製)
      this.settings.gamepadBindings =
        id === 'custom' ? cloneBindings(this.settings.gamepadBindings) : cloneBindings(PRESETS[id]);
      this.bindNote = '';
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderGamepadBindings(host, layoutSelect);
    });

    this.renderGamepadBindings(host, layoutSelect);
    return section;
  }

  // リバインド表を(再)描画する。各行=アクション名+現在のグリフ+「変更」ボタン
  private renderGamepadBindings(host: HTMLElement, layoutSelect: HTMLSelectElement): void {
    host.innerHTML = '';
    for (const [action, label] of PAD_ACTION_ROWS) {
      const row = document.createElement('div');
      row.className = 'rebind-row';
      const name = document.createElement('span');
      name.className = 'rebind-name';
      name.textContent = label;
      const glyphs = document.createElement('span');
      glyphs.className = 'rebind-glyph';
      const binds = this.settings.gamepadBindings[action];
      glyphs.textContent = binds.length > 0 ? binds.map(glyphFor).join(' / ') : '(なし)';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rebind-btn';
      const capturing = this.capturingAction === action;
      btn.textContent = capturing ? '…ボタンを押す(Escで取消)' : '変更';
      if (capturing) btn.classList.add('capturing');
      btn.addEventListener('click', () => this.startCapture(action, host, layoutSelect));
      row.append(name, glyphs, btn);
      host.appendChild(row);
    }
    if (this.bindNote) {
      const note = document.createElement('p');
      note.className = 'setting-note rebind-note';
      note.textContent = this.bindNote;
      host.appendChild(note);
    }
  }

  // 次に押されたパッドボタンを当該アクションへ割り当てる。プリセット中ならcustomへ移行する
  private startCapture(
    action: PadAction,
    host: HTMLElement,
    layoutSelect: HTMLSelectElement,
  ): void {
    // 別の捕捉が走っていたら確実に畳む(前回の keydown リスナも除去)
    this.endCapture();
    // プリセットは共有オブジェクト。編集前にcustomへ移行して複製する
    if (this.settings.gamepadLayout !== 'custom') {
      this.settings.gamepadLayout = 'custom';
      this.settings.gamepadBindings = cloneBindings(this.settings.gamepadBindings);
      layoutSelect.value = 'custom';
    }
    this.capturingAction = action;
    this.bindNote = '';

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.endCapture();
      this.renderGamepadBindings(host, layoutSelect);
    };
    document.addEventListener('keydown', onKey, true);
    // endCapture から呼ばれる後始末(Input側コールバック解除は endCapture が担う)
    this.captureCleanup = () => document.removeEventListener('keydown', onKey, true);
    this.renderGamepadBindings(host, layoutSelect);

    this.input.captureNextButton((binding) => {
      this.endCapture();
      this.assignBinding(action, binding);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderGamepadBindings(host, layoutSelect);
    });
  }

  // 物理ボタンは1アクションに対応させる。重複は他アクションから外し、通知文に残す
  private assignBinding(action: PadAction, binding: GamepadBinding): void {
    const bindings = this.settings.gamepadBindings;
    const moved: string[] = [];
    for (const [other, label] of PAD_ACTION_ROWS) {
      if (other === action) continue;
      if (bindings[other].some((x) => x.index === binding.index)) {
        bindings[other] = bindings[other].filter((x) => x.index !== binding.index);
        moved.push(label);
      }
    }
    bindings[action] = [binding];
    this.bindNote = moved.length
      ? `${glyphFor(binding)} を「${moved.join('、')}」から移動しました`
      : '';
  }

  // SYSTEM設定のグループ見出し。data-codeはCSSのattr()で右端に描く装飾コード
  private subhead(label: string, code: string): HTMLElement {
    const h = document.createElement('h3');
    h.className = 'settings-subhead';
    h.dataset.code = code;
    h.textContent = label;
    return h;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    // カスタムトラックの塗り比率(--fill)。CSS側はlinear-gradientの境界に使う
    const syncFill = (): void => {
      const ratio = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--fill', `${ratio.toFixed(1)}%`);
    };
    syncFill();
    const display = document.createElement('span');
    display.className = 'setting-value';
    display.textContent = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      apply(v);
      display.textContent = String(v);
      syncFill();
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input, display);
    return row;
  }

  // 汎用セレクト。反映タイミングは項目による(配色/試合時間は次の試合開始時、
  // アクセント色やレティクルは即時)
  private select(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    apply: (v: string) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      input.appendChild(node);
    }
    input.value = value;
    input.addEventListener('change', () => {
      apply(input.value);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input);
    return row;
  }

  private checkbox(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row setting-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    const text = document.createElement('span');
    text.textContent = label;
    input.addEventListener('change', () => {
      apply(input.checked);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(input, text);
    return row;
  }
}
