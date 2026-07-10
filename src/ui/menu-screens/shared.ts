// W-ENZA FA2: menu.ts 分割 — 画面モジュール共有のモジュールレベル定数/純関数(機械的移送)。
// 出所: src/ui/menu.ts(様式変更なし)。menu.ts が公開名を再exportして互換維持する。
import { type GamepadBindings, type PadAction } from '../../core/gamepad';
import { type GamepadResponseCurve, type GraphicsQuality } from '../../core/settings';
import type { Difficulty } from '../../game/bot';
import { type GrenadeKind } from '../../game/grenades';
import type { MatchResult } from '../../game/match';
import { type GameMode } from '../../game/modes';
import { type CharmId, type MatchProgress } from '../../game/progression';
import { camoName, isCamoId } from '../../game/camo';
// R53-W2: お守り(CHARMS)/ゾンビパーク(PERKS)は zombie-economy.ts が単一の真実。
// メニューは「継承の守り札」用のcarriedPerk解決(PERKS存在チェックのみ)にZombiePerkIdを使う
import { PERKS, type ZombiePerkId } from '../../game/zombie-economy';
import {
  computeWeaponBars,
  type ViewModelShape,
  type WeaponClass,
  type WeaponDef,
} from '../../game/weapons';

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
export const BAR_AXES: ReadonlyArray<[keyof ReturnType<typeof computeWeaponBars>, string]> = [
  ['power', '威力'],
  ['rate', '連射'],
  ['control', '制御'],
  ['range', '射程'],
  ['mobility', '機動'],
  ['handling', '取回'],
];

// クラスの表示名(ARMORYのグループ見出し)
export const CLASS_LABELS: Record<WeaponClass, string> = {
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
export const CLASS_ORDER: readonly WeaponClass[] = [
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

export const GRENADE_DESCS: Record<GrenadeKind, string> = {
  frag: '長押しでクッキング。爆発範囲ダメージ',
  smoke: '視線を遮る煙幕を張る',
  flash: '視界を白く焼く。正面で食らうと長い',
  incendiary: '着弾点に燃え続ける火災を残す',
};

export const LOADOUT_KEY = 'hibana.loadout.v1';

export const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
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
export { LAST_ZOMBIE_PERK_KEY } from '../../game/zombie-economy';
import { LAST_ZOMBIE_PERK_KEY } from '../../game/zombie-economy';
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
export const CONTROLS: Array<[string, string]> = [
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
export const PAD_ACTION_ROWS: ReadonlyArray<[PadAction, string]> = [
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

export const GRAPHICS_LABELS: Record<GraphicsQuality, string> = {
  low: '低(軽量・ポスト処理なし)',
  medium: '中(既定)',
  high: '高(高負荷・高解像度)',
};

export const CURVE_LABELS: Record<GamepadResponseCurve, string> = {
  linear: 'リニア(等速)',
  exponential: '指数(中央が精密)',
  dynamic: 'ダイナミック(精密+機敏)',
};

// バインドの深いコピー。プリセットは共有オブジェクトなので、カスタム編集前に必ず複製する
export function cloneBindings(b: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const key of Object.keys(b) as PadAction[]) out[key] = b[key].map((x) => ({ ...x }));
  return out;
}

// R10 IGNITION FRAME: 盾型ベゼル2層+十字計器+発光スパークの多層エンブレム。
// viewBox / role / aria-label / .spark クラスは旧ロゴと同一に保ち、CSSフックを壊さない
export const LOGO_SVG = `
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
export const silCache = new Map<string, string>();

// shape 未指定の武器(=一部の副武器)用のクラス既定シルエット。
export const CLASS_SHAPE: Record<WeaponClass, ViewModelShape> = {
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

export interface SilSpec {
  arch:
    | 'ar'
    | 'bullpup'
    | 'smg'
    | 'dmr'
    | 'sniper'
    | 'shotgun'
    | 'lmg'
    | 'pistol'
    | 'revolver'
    | 'fists';
  barrel?: number; // 銃口X(viewBox 0..128)
  mag?: 'curved' | 'straight' | 'box' | 'drum' | 'tube' | 'twin' | 'none';
  optic?: 'iron' | 'red' | 'scope' | 'long';
  stock?: 'full' | 'skel' | 'none' | 'bull';
}

export const SHAPE_SIL: Record<ViewModelShape, SilSpec> = {
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

export function tracerHex(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}

// ── 武器カモUIのスコープドCSS(初回のみheadへ注入。IGNITION FRAME: カーボン+琥珀) ──
// filter/backdrop-filter/box-shadowグローは使わない(白飛び・重描画の再発禁止)。
export const CAMO_STYLE_ID = 'hibana-camo-style';
export function ensureCamoStyle(): void {
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

export const rc = (x: number, y: number, w: number, h: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
export const pg = (pts: string): string => `<polygon points="${pts}"/>`;
export const ci = (x: number, y: number, r: number): string =>
  `<circle cx="${x}" cy="${y}" r="${r}"/>`;

// 光学(照準器)を上面へ。iron/red/scope/long で長さと発光レンズが変わる
export function silOptic(kind: string | undefined, barrel: number, b: string[], a: string[]): void {
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
export function silMag(kind: string | undefined, b: string[]): void {
  if (kind === 'curved') b.push(pg('53,27 64,27 68,43 57,43'));
  else if (kind === 'straight') b.push(pg('53,27 63,27 64,42 55,42'));
  else if (kind === 'box') b.push(rc(52, 27, 13, 15));
  else if (kind === 'drum') b.push(rc(54, 27, 8, 4), ci(58, 35, 8.5));
}

export function silInner(spec: SilSpec, tracer: string): string {
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
    a.push(
      `<rect x="89" y="19" width="3.5" height="3.4" fill="${tracer}"/>`,
      `<circle cx="58" cy="24" r="2.4" fill="${tracer}"/>`,
    );
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
      else if (spec.stock === 'skel')
        b.push(pg('10,16 34,16 34,18.5 16,19 16,24 34,24 34,27 10,27'));
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
export function weaponSilSVG(shape: ViewModelShape, tracerColor: number): string {
  const key = `${shape}|${tracerColor}`;
  const hit = silCache.get(key);
  if (hit !== undefined) return hit;
  const spec = SHAPE_SIL[shape] ?? SHAPE_SIL.rifle;
  const svg = `<svg class="wsil" viewBox="0 0 128 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${silInner(spec, tracerHex(tracerColor))}</svg>`;
  silCache.set(key, svg);
  return svg;
}

// 兵装カードの派生スタット(横バーの副次表示)。DPS/確殺弾数/実効RPM/TTKを WeaponDef から導出。
export function computeDerivedStats(def: WeaponDef): {
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
export interface ExoticLore {
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
export const STORY_MEDAL_MAX = 6;
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
export type GradeTier = 'gold' | 'plat' | 'cyan' | 'violet' | 'steel';
export interface GradeInfo {
  letter: string;
  tier: GradeTier;
  score: number; // 0..100(下部の PTS カウントアップ用)
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 面取り六角形の頂点(真上向き)。hud.ts の ngonPoints と同型(menu へ複製)
export function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export function computeGrade(result: MatchResult): GradeInfo {
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
