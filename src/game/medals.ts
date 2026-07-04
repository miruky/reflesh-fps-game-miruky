import type { WeaponClass } from './weapons';

// メダルの階級。バッジの形状に対応(bronze=盾/silver=六角/gold=星/platinum=八角)
export type MedalTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type MedalId =
  // 1-A 連続キル(ローリング窓・死亡リセット)
  | 'double-kill'
  | 'triple-kill'
  | 'fury-kill'
  | 'frenzy-kill'
  | 'super-kill'
  | 'mega-kill'
  | 'ultra-kill'
  | 'kill-chain'
  // 1-B キルストリーク(1ライフ連続・死亡で0)
  | 'bloodthirsty'
  | 'merciless'
  | 'ruthless'
  | 'relentless'
  | 'brutal'
  | 'unstoppable'
  | 'nuclear'
  // 1-C 状況・戦果
  | 'headshot'
  | 'longshot'
  | 'point-blank'
  | 'collateral'
  | 'revenge'
  | 'triple-feed'
  | 'quad-feed'
  | 'mega-feed'
  | 'qhsf'
  | 'one-shot'
  | 'kaboom'
  | 'scorched'
  | 'backstab'
  // 1-D hibana 機構連動
  | 'no-scope'
  | 'quickscope'
  | 'skyfall'
  | 'wall-hunter'
  | 'slide-kill'
  | 'overdrive'
  | 'gravity-slam'
  | 'ronin';

export interface MedalEvent {
  id: MedalId;
  name: string;
  tier: MedalTier;
  color: string;
  xp: number;
  firstUnlock: boolean; // 初取得=バッジ解放カード / それ以外=大文字表示
  combo: number; // 連続数(連続キル/ストリーク)。表示用、無ければ0
}

export interface KillCtx {
  victimName: string;
  victimId: number; // 被害BOTの一意ID(名前は8種を再利用するためリベンジ判定に使う)
  headshot: boolean;
  weaponName: string;
  weaponClass: WeaponClass;
  scopeWeapon: boolean;
  adsProgress: number;
  adsAgeMs: number; // ADS開始からの経過(クイックスコープ判定)
  distM: number;
  victimFullHp: boolean;
  bulletsThisShot: number;
  fromBehind: boolean;
  grounded: boolean;
  sliding: boolean;
  wallRunning: boolean;
  ultActive: boolean;
  streak: number; // player.streak(1ライフ連続キル)
}

interface MedalDef {
  name: string;
  tier: MedalTier;
  color: string;
  xp: number;
}

// 全メダル定義。color は style.css の :root に定義する CSS 変数を参照する
const MEDALS: Record<MedalId, MedalDef> = {
  'double-kill': { name: 'DOUBLE KILL', tier: 'silver', color: 'var(--medal-white)', xp: 50 },
  'triple-kill': { name: 'TRIPLE KILL', tier: 'silver', color: 'var(--medal-blue)', xp: 100 },
  'fury-kill': { name: 'FURY KILL', tier: 'silver', color: 'var(--medal-orange)', xp: 200 },
  'frenzy-kill': { name: 'FRENZY KILL', tier: 'silver', color: 'var(--medal-red)', xp: 300 },
  'super-kill': { name: 'SUPER KILL', tier: 'silver', color: 'var(--medal-red)', xp: 350 },
  'mega-kill': { name: 'MEGA KILL', tier: 'silver', color: 'var(--medal-gold)', xp: 400 },
  'ultra-kill': { name: 'ULTRA KILL', tier: 'silver', color: 'var(--medal-gold)', xp: 450 },
  'kill-chain': { name: 'KILL CHAIN', tier: 'silver', color: 'var(--medal-gold)', xp: 500 },
  bloodthirsty: { name: 'BLOODTHIRSTY', tier: 'gold', color: 'var(--medal-gold)', xp: 150 },
  merciless: { name: 'MERCILESS', tier: 'gold', color: 'var(--medal-gold)', xp: 250 },
  ruthless: { name: 'RUTHLESS', tier: 'gold', color: 'var(--medal-gold)', xp: 400 },
  relentless: { name: 'RELENTLESS', tier: 'gold', color: 'var(--medal-gold)', xp: 600 },
  brutal: { name: 'BRUTAL', tier: 'gold', color: 'var(--medal-gold)', xp: 800 },
  unstoppable: { name: 'UNSTOPPABLE', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  nuclear: { name: 'NUCLEAR', tier: 'platinum', color: 'var(--medal-plat)', xp: 1500 },
  headshot: { name: 'HEADSHOT', tier: 'bronze', color: 'var(--medal-orange)', xp: 25 },
  longshot: { name: 'LONGSHOT', tier: 'bronze', color: 'var(--medal-red)', xp: 100 },
  'point-blank': { name: 'POINT BLANK', tier: 'bronze', color: 'var(--medal-red)', xp: 75 },
  collateral: { name: 'COLLATERAL', tier: 'bronze', color: 'var(--medal-orange)', xp: 100 },
  revenge: { name: 'REVENGE', tier: 'bronze', color: 'var(--medal-red)', xp: 75 },
  // ── フィーダー御用達(killfeed連続系)──
  'triple-feed': { name: 'TRIPLE FEED', tier: 'bronze', color: 'var(--medal-orange)', xp: 150 },
  'quad-feed': { name: 'QUAD FEED', tier: 'bronze', color: 'var(--medal-gold)', xp: 250 },
  'mega-feed': { name: 'MEGA FEED', tier: 'gold', color: 'var(--medal-gold)', xp: 400 },
  // Quad HeadShot Feed: 4連フィードが全てヘッドショット。フィーダーの王冠
  qhsf: { name: 'QHSF', tier: 'platinum', color: 'var(--medal-plat)', xp: 500 },
  'one-shot': { name: 'ONE SHOT ONE KILL', tier: 'bronze', color: 'var(--medal-gold)', xp: 150 },
  kaboom: { name: 'KABOOM', tier: 'bronze', color: 'var(--medal-orange)', xp: 100 },
  scorched: { name: 'SCORCHED', tier: 'bronze', color: 'var(--medal-orange)', xp: 100 },
  backstab: { name: 'BACKSTAB', tier: 'bronze', color: 'var(--medal-red)', xp: 150 },
  'no-scope': { name: 'NO SCOPE', tier: 'platinum', color: 'var(--medal-cyan)', xp: 150 },
  quickscope: { name: 'QUICKSCOPE', tier: 'platinum', color: 'var(--medal-cyan)', xp: 150 },
  skyfall: { name: 'SKYFALL', tier: 'platinum', color: 'var(--medal-cyan)', xp: 100 },
  'wall-hunter': { name: 'WALL HUNTER', tier: 'platinum', color: 'var(--medal-cyan)', xp: 100 },
  'slide-kill': { name: 'SLIDE KILL', tier: 'platinum', color: 'var(--medal-cyan)', xp: 100 },
  overdrive: { name: 'OVERDRIVE', tier: 'platinum', color: 'var(--medal-violet)', xp: 150 },
  'gravity-slam': { name: 'GRAVITY SLAM', tier: 'platinum', color: 'var(--medal-violet)', xp: 200 },
  ronin: { name: 'RONIN', tier: 'platinum', color: 'var(--medal-violet)', xp: 400 },
};

// 武器クラス別のロングショット閾値(m)。sniper は常時 / shotgun は無効
export const LONGSHOT: Record<WeaponClass, number> = {
  ar: 38,
  smg: 26,
  br: 34,
  lmg: 36,
  pistol: 30,
  sniper: 0,
  shotgun: Infinity,
  // 精密射手は遠距離が本領。ARより遠くに閾値を置き「遠射」を特別化
  marksman: 48,
};

// バッジ表示しない(killfeed のアイコンのみに降格する)メダル。HUDが参照
export const SUPPRESS_BADGE: ReadonlySet<MedalId> = new Set<MedalId>(['headshot']);

// R18: 取得済みでも毎回バッジを出す「レベルの高い実績」。日常的に出る状況キル系
// (no-scope/quickscope/slide-kill/ronin 等)は除外し、キルストリークの大台と希少な偉業に限定する
// (毎キル乱発を避けつつ、達成の気持ち良さを再演出する)。
export const ALWAYS_BADGE: ReadonlySet<MedalId> = new Set<MedalId>([
  'bloodthirsty',
  'merciless',
  'ruthless',
  'relentless',
  'brutal',
  'unstoppable',
  'nuclear',
  'qhsf',
]);

// アナウンサー音声の読み上げ優先度(大きいほど優先)。1キルで複数取得時に最上位を1件だけ読む
export function medalRank(id: MedalId): number {
  if (id === 'nuclear') return 100;
  if (id === 'qhsf') return 96; // フィーダーの王冠はQUAD FEEDより優先して読む
  if (id === 'mega-feed') return 92;
  if (id === 'quad-feed') return 90;
  if (id === 'kill-chain') return 85;
  if (id === 'triple-feed') return 62;
  if (MEDALS[id].tier === 'gold') return 80; // killstreak
  if (id === 'ronin') return 70;
  // 連続キル(silver)
  if (MEDALS[id].tier === 'silver') return 60;
  if (MEDALS[id].tier === 'platinum') return 50; // 機構
  return 30; // combat
}

// 連続キル数 → メダルID
function rapidMedal(chain: number): MedalId | null {
  switch (chain) {
    case 2:
      return 'double-kill';
    case 3:
      return 'triple-kill';
    case 4:
      return 'fury-kill';
    case 5:
      return 'frenzy-kill';
    case 6:
      return 'super-kill';
    case 7:
      return 'mega-kill';
    case 8:
      return 'ultra-kill';
    default:
      return chain >= 9 ? 'kill-chain' : null;
  }
}

// キルストリーク閾値 → メダルID
const STREAK_MEDALS: Record<number, MedalId> = {
  5: 'bloodthirsty',
  10: 'merciless',
  15: 'ruthless',
  20: 'relentless',
  25: 'brutal',
  30: 'unstoppable',
};

// SVGの星(killstreakバッジ)の頂点列。cx,cy中心・n個の角・外径/内径
export function starPoints(
  cx: number,
  cy: number,
  n: number,
  outer: number,
  inner: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / n) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// メダル検出器。乱数・描画・時刻APIに依存しない純ロジック(tick(dt)で内部時計を進める)
export class MedalTracker {
  readonly newlyUnlocked = new Set<MedalId>();
  readonly counts: Record<string, number> = {};

  private readonly known: Set<string>; // profileは string[] 保存なので string で受ける
  private now = 0; // 秒。tick(dt)で進む
  private chain = 0; // 連続キル数(ローリング窓)
  private chainExpire = 0;
  // 自分のキルが他者キル/死で分断されず連続した時刻列(フィード系のローリング窓判定用)
  private feedTimes: number[] = [];
  private feedHeads: boolean[] = []; // 同・各キルがヘッドショットか(QHSF判定用)
  private feedQuadBase = 0; // 直近にQuadFeedを出した位置(再武装の基点)
  private feedTriBase = 0; // 同・TripleFeed
  private feedMegaBase = 0; // 同・MegaFeed
  private revengeTarget: number | null = null; // killer BOTのuid(名前でなくidで追跡)

  constructor(known: Set<string>) {
    this.known = known;
  }

  tick(dt: number): void {
    this.now += dt;
    if (this.now > this.chainExpire) this.chain = 0;
  }

  private emit(id: MedalId, out: MedalEvent[], combo = 0): void {
    const def = MEDALS[id];
    const first = !this.known.has(id);
    if (first) {
      this.known.add(id);
      this.newlyUnlocked.add(id);
    }
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    out.push({
      id,
      name: def.name,
      tier: def.tier,
      color: def.color,
      xp: def.xp,
      firstUnlock: first,
      combo,
    });
  }

  onKill(ctx: KillCtx, out: MedalEvent[]): void {
    // ── 連続キル(ローリング窓)──
    if (this.now > this.chainExpire) this.chain = 0;
    this.chain += 1;
    this.chainExpire = this.now + Math.min(5.0, 4.0 + this.chain * 0.25);
    const rapid = rapidMedal(this.chain);
    if (rapid) this.emit(rapid, out, this.chain);

    // ── キルストリーク(1ライフ)──
    const streakMedal = STREAK_MEDALS[ctx.streak];
    if (streakMedal) this.emit(streakMedal, out, ctx.streak);
    if (ctx.streak === 30) this.emit('nuclear', out, ctx.streak);

    // ── フィード系(分断されない連続キルのローリング窓判定+個別再武装)──
    // TRIPLE FEED: 直近3キルが1.4秒以内 / QUAD FEED: 直近4キルが2秒以内 /
    // QHSF: QuadFeedの4連が全てヘッドショット(フィーダーの王冠) /
    // MEGA FEED: 直近5キルが3秒以内
    this.feedTimes.push(this.now);
    this.feedHeads.push(ctx.headshot);
    const ft = this.feedTimes;
    if (ft.length - this.feedTriBase >= 3 && this.now - ft[ft.length - 3]! <= 1.4) {
      this.emit('triple-feed', out, 3);
      this.feedTriBase = ft.length;
    }
    if (ft.length - this.feedQuadBase >= 4 && this.now - ft[ft.length - 4]! <= 2.0) {
      this.emit('quad-feed', out, 4);
      this.feedQuadBase = ft.length;
      if (this.feedHeads.slice(-4).every(Boolean)) this.emit('qhsf', out, 4);
    }
    if (ft.length - this.feedMegaBase >= 5 && this.now - ft[ft.length - 5]! <= 3.0) {
      this.emit('mega-feed', out, 5);
      this.feedMegaBase = ft.length;
    }

    // ── 状況・戦果 ──
    if (ctx.headshot) this.emit('headshot', out);
    if (ctx.distM >= LONGSHOT[ctx.weaponClass]) this.emit('longshot', out);
    if (ctx.distM <= 3.5) this.emit('point-blank', out);
    if (this.revengeTarget !== null && ctx.victimId === this.revengeTarget) {
      this.emit('revenge', out);
      this.revengeTarget = null;
    }
    if (ctx.weaponClass === 'sniper' && ctx.victimFullHp) this.emit('one-shot', out);
    if (ctx.weaponName === 'フラグ') this.emit('kaboom', out);
    if (ctx.weaponName === '焼夷') this.emit('scorched', out);
    if (ctx.weaponName === '近接' && ctx.fromBehind) this.emit('backstab', out);

    // ── hibana 機構(no-scope/quickscope/移動排他/ult/slam/ronin)──
    const airborne = !ctx.grounded;
    const noScope = ctx.scopeWeapon && ctx.adsProgress < 0.5;
    const ronin = noScope && (airborne || ctx.wallRunning);
    if (ronin) this.emit('ronin', out);
    else if (noScope) this.emit('no-scope', out);
    if (ctx.scopeWeapon && ctx.adsProgress > 0.85 && ctx.adsAgeMs <= 350) {
      this.emit('quickscope', out);
    }
    // 移動メダルは排他(wall-hunter > slide-kill > skyfall)
    if (ctx.wallRunning) this.emit('wall-hunter', out);
    else if (ctx.sliding) this.emit('slide-kill', out);
    else if (airborne) this.emit('skyfall', out);
    if (ctx.ultActive) this.emit('overdrive', out);
    if (ctx.weaponName === 'グラビティスラム') this.emit('gravity-slam', out);
  }

  // 同一トリガーで2体以上(ショットガンのペレット拡散など)
  onCollateral(n: number, out: MedalEvent[]): void {
    if (n >= 2) this.emit('collateral', out, n);
  }

  // プレイヤー死亡: 連続系を全リセットし、復讐対象を記録する
  onPlayerDeath(killerId: number | null): void {
    this.chain = 0;
    this.resetFeed();
    this.revengeTarget = killerId;
  }

  // killfeed への追加通知。他者のキルは自分の連続フィードを分断する
  onFeed(killerIsPlayer: boolean): void {
    if (!killerIsPlayer) this.resetFeed();
  }

  private resetFeed(): void {
    this.feedTimes = [];
    this.feedHeads = [];
    this.feedQuadBase = 0;
    this.feedTriBase = 0;
    this.feedMegaBase = 0;
  }
}
