import type { WeaponClass } from './weapons';
import type { BotKind } from './bot';

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
  | 'ronin'
  // ── 新メダル 180種 ──────────────────────────────────────────────────────
  // A: 移動系 (12)
  | 'crouch-kill'
  | 'sprint-kill'
  | 'blink-kill'
  | 'blink-double'
  | 'blink-triple'
  | 'slide-double'
  | 'slide-triple'
  | 'air-double'
  | 'air-triple'
  | 'wall-double'
  | 'wall-triple'
  | 'ronin-chain'
  // B: 距離 (18)
  | 'close-extreme'
  | 'ar-longshot-b'
  | 'smg-longshot-b'
  | 'br-longshot-b'
  | 'lmg-longshot-b'
  | 'pistol-longshot-b'
  | 'marksman-longshot-b'
  | 'exotic-longshot-b'
  | 'sniper-200m'
  | 'sniper-400m'
  | 'sniper-600m'
  | 'sniper-800m'
  | 'sniper-999m'
  | 'qs-200m'
  | 'qs-400m'
  | 'qs-600m'
  | 'qs-800m'
  | 'qs-999m'
  // C: HS連続 (8) [6秒窓]
  | 'hs-streak-2'
  | 'hs-streak-3'
  | 'hs-streak-4'
  | 'hs-streak-5'
  | 'hs-streak-6'
  | 'hs-streak-7'
  | 'hs-streak-8'
  | 'hs-streak-10'
  // D: 武器クラス (16)
  | 'ar-specialist'
  | 'smg-specialist'
  | 'sniper-specialist'
  | 'shotgun-specialist'
  | 'br-specialist'
  | 'lmg-specialist'
  | 'pistol-specialist'
  | 'marksman-specialist'
  | 'launcher-specialist'
  | 'exotic-specialist'
  | 'shotgun-double'
  | 'shotgun-triple'
  | 'pistol-rampage'
  | 'all-class-kills'
  | 'pistol-chain'
  | 'exotic-rampage'
  // E: 状況 (20)
  | 'first-blood'
  | 'reload-kill'
  | 'low-hp-kill'
  | 'last-bullet'
  | 'master-kill'
  | 'giant-melee'
  | 'no-damage-5'
  | 'no-damage-10'
  | 'speed-opener'
  | 'tank-kill'
  | 'drone-kill'
  | 'turret-kill'
  | 'zombie-kill'
  | 'no-scope-hs'
  | 'qs-hs'
  | 'clutch-kill'
  | 'nemesis-kill'
  | 'giant-kill'
  | 'low-hp-20'
  | 'combat-master'
  // F: フィード拡張 (8)
  | 'penta-feed'
  | 'hexa-feed'
  | 'septa-feed'
  | 'octa-feed'
  | 'rampage-feed'
  | 'hs-feed-2'
  | 'hs-feed-3'
  | 'hs-feed-5'
  // G: ストリーク延長 (6)
  | 'streak-35'
  | 'streak-40'
  | 'streak-50'
  | 'streak-60'
  | 'streak-75'
  | 'streak-100'
  // H: マガジン (10)
  | 'mag-2'
  | 'mag-3'
  | 'mag-4'
  | 'mag-5'
  | 'mag-6'
  | 'mag-7'
  | 'mag-8'
  | 'mag-10'
  | 'mag-all-hs'
  | 'reload-3'
  // I: スライド空中特化 (8)
  | 'slide-snipe'
  | 'slide-qs'
  | 'slide-hs'
  | 'air-snipe'
  | 'air-qs'
  | 'air-hs'
  | 'slide-air-kill'
  | 'air-slam-kill'
  // J: 特殊モード (30)
  | 'dark-emperor-kill'
  | 'dark-emperor-5'
  | 'dark-emperor-10'
  | 'dark-emperor-20'
  | 'dark-emperor-50'
  | 'dark-emperor-nodmg'
  | 'raitei-kill'
  | 'raitei-5'
  | 'raitei-10'
  | 'raitei-20'
  | 'raitei-50'
  | 'raitei-nodmg'
  | 'kokurai-kill'
  | 'kokurai-5'
  | 'kokurai-10'
  | 'kokurai-20'
  | 'kokurai-50'
  | 'kokurai-nodmg'
  | 'ult-kill'
  | 'ult-5'
  | 'ult-10'
  | 'hell-kill'
  | 'hell-5'
  | 'hell-10'
  | 'hell-20'
  | 'hell-50'
  | 'hell-nodmg'
  | 'de-activation-kill'
  | 'raitei-activation-kill'
  | 'kokurai-activation-kill'
  // K: 超難度 (30)
  | 'perfect-life-5'
  | 'perfect-life-10'
  | 'perfect-life-20'
  | 'perfect-life-30'
  | 'all-hs-life-5'
  | 'all-hs-life-10'
  | 'boss-slayer'
  | 'nemesis-mark'
  | 'nemesis-revenge'
  | 'immortal-15'
  | 'immortal-25'
  | 'undying-20'
  | 'undying-30'
  | 'sharpshooter-25'
  | 'executioner-50'
  | 'executioner-100'
  | 'one-shot-5'
  | 'backstab-5'
  | 'flawless-combat'
  | 'ghost-25'
  | 'perfect-mag-3'
  | 'multi-style-5'
  | 'survivor-10'
  | 'survivor-20'
  | 'wave-clean-5'
  | 'zombie-master-100'
  | 'no-scope-10'
  | 'qs-master-10'
  | 'stealth-5'
  | 'legend-run'
  // L: チェーン拡張 (14)
  | 'chain-10'
  | 'chain-12'
  | 'chain-15'
  | 'chain-18'
  | 'chain-20'
  | 'chain-25'
  | 'chain-30'
  | 'chain-35'
  | 'chain-40'
  | 'chain-45'
  | 'chain-50'
  | 'chain-comeback'
  | 'chain-saver'
  | 'chain-god';

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
  // ── 新オプションフィールド(全てoptional: match側が未配線でも安全) ──
  crouching?: boolean;          // A: しゃがみキル
  sprinting?: boolean;          // A: スプリントキル
  blinkAgeMs?: number;          // A: 最後のブリンクからの経過ms
  reloadKillBit?: boolean;      // E/H: リロード直後キル
  magAmmoBeforeKill?: number;   // H: 撃つ前の残弾数
  darkEmperorActive?: boolean;  // J: 黒帝モード中
  raiteiActive?: boolean;       // J: 雷帝モード中
  kokuraiteiActive?: boolean;   // J: 黒雷帝モード中
  hellMode?: boolean;           // J: 超鬼畜モード中
  botKind?: BotKind;            // E: ボット種類
  matchKillCount?: number;      // E: 試合全体のキル数(1=ファーストブラッド)
  matchElapsed?: number;        // E: 試合開始からの経過秒
  playerHpRatio?: number;       // E: プレイヤーHP比率(0-1)
}

interface MedalDef {
  name: string;
  tier: MedalTier;
  color: string;
  xp: number;
}

// 全メダル定義。color は style.css の :root に定義する CSS 変数を参照する
const MEDALS: Record<MedalId, MedalDef> = {
  // ── 既存46種 ──
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
  'triple-feed': { name: 'TRIPLE FEED', tier: 'bronze', color: 'var(--medal-orange)', xp: 150 },
  'quad-feed': { name: 'QUAD FEED', tier: 'bronze', color: 'var(--medal-gold)', xp: 250 },
  'mega-feed': { name: 'MEGA FEED', tier: 'gold', color: 'var(--medal-gold)', xp: 400 },
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
  // ── A: 移動系 (12) ──
  'crouch-kill': { name: 'しゃがみキル', tier: 'bronze', color: 'var(--medal-white)', xp: 50 },
  'sprint-kill': { name: 'スプリントキル', tier: 'bronze', color: 'var(--medal-white)', xp: 50 },
  'blink-kill': { name: 'ブリンクキル', tier: 'silver', color: 'var(--medal-cyan)', xp: 100 },
  'blink-double': { name: 'ブリンク2連キル', tier: 'gold', color: 'var(--medal-cyan)', xp: 250 },
  'blink-triple': { name: 'ブリンク3連キル', tier: 'platinum', color: 'var(--medal-cyan)', xp: 600 },
  'slide-double': { name: 'スライド2連キル', tier: 'silver', color: 'var(--medal-cyan)', xp: 200 },
  'slide-triple': { name: 'スライド3連キル', tier: 'gold', color: 'var(--medal-cyan)', xp: 400 },
  'air-double': { name: '空中2連キル', tier: 'silver', color: 'var(--medal-cyan)', xp: 200 },
  'air-triple': { name: '空中3連キル', tier: 'gold', color: 'var(--medal-cyan)', xp: 400 },
  'wall-double': { name: '壁走り2連キル', tier: 'gold', color: 'var(--medal-cyan)', xp: 300 },
  'wall-triple': { name: '壁走り3連キル', tier: 'platinum', color: 'var(--medal-cyan)', xp: 700 },
  'ronin-chain': { name: 'RONIN連鎖', tier: 'platinum', color: 'var(--medal-violet)', xp: 800 },
  // ── B: 距離 (18) ──
  'close-extreme': { name: '超密着', tier: 'bronze', color: 'var(--medal-red)', xp: 100 },
  'ar-longshot-b': { name: 'AR遠距離', tier: 'bronze', color: 'var(--medal-blue)', xp: 100 },
  'smg-longshot-b': { name: 'SMG遠距離', tier: 'bronze', color: 'var(--medal-blue)', xp: 100 },
  'br-longshot-b': { name: 'BR遠距離', tier: 'bronze', color: 'var(--medal-blue)', xp: 100 },
  'lmg-longshot-b': { name: 'LMG遠距離', tier: 'bronze', color: 'var(--medal-blue)', xp: 100 },
  'pistol-longshot-b': { name: 'ピストル遠距離', tier: 'bronze', color: 'var(--medal-blue)', xp: 150 },
  'marksman-longshot-b': { name: 'マークスマン遠距離', tier: 'silver', color: 'var(--medal-blue)', xp: 200 },
  'exotic-longshot-b': { name: 'エキゾチック遠距離', tier: 'silver', color: 'var(--medal-blue)', xp: 200 },
  'sniper-200m': { name: 'スナイパー200M', tier: 'silver', color: 'var(--medal-gold)', xp: 400 },
  'sniper-400m': { name: 'スナイパー400M', tier: 'gold', color: 'var(--medal-gold)', xp: 700 },
  'sniper-600m': { name: 'スナイパー600M', tier: 'gold', color: 'var(--medal-gold)', xp: 1200 },
  'sniper-800m': { name: 'スナイパー800M', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'sniper-999m': { name: 'スナイパー999M', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'qs-200m': { name: 'QS200M', tier: 'silver', color: 'var(--medal-cyan)', xp: 500 },
  'qs-400m': { name: 'QS400M', tier: 'gold', color: 'var(--medal-cyan)', xp: 900 },
  'qs-600m': { name: 'QS600M', tier: 'gold', color: 'var(--medal-cyan)', xp: 1500 },
  'qs-800m': { name: 'QS800M', tier: 'platinum', color: 'var(--medal-plat)', xp: 2500 },
  'qs-999m': { name: 'QS999M', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  // ── C: HS連続 (8) ──
  'hs-streak-2': { name: 'ダブルHS', tier: 'bronze', color: 'var(--medal-orange)', xp: 80 },
  'hs-streak-3': { name: 'トリプルHS', tier: 'silver', color: 'var(--medal-orange)', xp: 150 },
  'hs-streak-4': { name: 'クアッドHS', tier: 'silver', color: 'var(--medal-orange)', xp: 250 },
  'hs-streak-5': { name: 'クインタプルHS', tier: 'gold', color: 'var(--medal-orange)', xp: 400 },
  'hs-streak-6': { name: 'セクスタプルHS', tier: 'gold', color: 'var(--medal-orange)', xp: 600 },
  'hs-streak-7': { name: 'セプタプルHS', tier: 'platinum', color: 'var(--medal-gold)', xp: 900 },
  'hs-streak-8': { name: 'オクタプルHS', tier: 'platinum', color: 'var(--medal-gold)', xp: 1300 },
  'hs-streak-10': { name: 'デカプルHS', tier: 'platinum', color: 'var(--medal-plat)', xp: 2500 },
  // ── D: 武器クラス (16) ──
  'ar-specialist': { name: 'ARスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'smg-specialist': { name: 'SMGスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'sniper-specialist': { name: 'スナイパースペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'shotgun-specialist': { name: 'SGスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'br-specialist': { name: 'BRスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'lmg-specialist': { name: 'LMGスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'pistol-specialist': { name: 'ピストルスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'marksman-specialist': { name: 'マークスマンスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'launcher-specialist': { name: 'ランチャースペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'exotic-specialist': { name: 'エキゾチックスペシャリスト', tier: 'bronze', color: 'var(--medal-white)', xp: 30 },
  'shotgun-double': { name: 'SGダブルキル', tier: 'silver', color: 'var(--medal-orange)', xp: 200 },
  'shotgun-triple': { name: 'SGトリプルキル', tier: 'gold', color: 'var(--medal-orange)', xp: 600 },
  'pistol-rampage': { name: 'ピストル5連', tier: 'gold', color: 'var(--medal-gold)', xp: 600 },
  'all-class-kills': { name: '全クラス制覇', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'pistol-chain': { name: 'ピストル3連', tier: 'silver', color: 'var(--medal-gold)', xp: 300 },
  'exotic-rampage': { name: 'エキゾチック3連', tier: 'gold', color: 'var(--medal-violet)', xp: 500 },
  // ── E: 状況 (20) ──
  'first-blood': { name: 'ファーストブラッド', tier: 'silver', color: 'var(--medal-red)', xp: 200 },
  'reload-kill': { name: 'リロードキル', tier: 'silver', color: 'var(--medal-blue)', xp: 150 },
  'low-hp-kill': { name: '瀕死キル', tier: 'gold', color: 'var(--medal-red)', xp: 250 },
  'last-bullet': { name: 'ラストバレット', tier: 'gold', color: 'var(--medal-gold)', xp: 350 },
  'master-kill': { name: '達人撃破', tier: 'gold', color: 'var(--medal-gold)', xp: 500 },
  'giant-melee': { name: '巨躯近接', tier: 'platinum', color: 'var(--medal-plat)', xp: 1000 },
  'no-damage-5': { name: '無被弾5連', tier: 'gold', color: 'var(--medal-gold)', xp: 600 },
  'no-damage-10': { name: '無被弾10連', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'speed-opener': { name: 'スピードオープナー', tier: 'silver', color: 'var(--medal-orange)', xp: 250 },
  'tank-kill': { name: 'タンク破壊', tier: 'gold', color: 'var(--medal-gold)', xp: 600 },
  'drone-kill': { name: 'ドローン撃墜', tier: 'bronze', color: 'var(--medal-blue)', xp: 75 },
  'turret-kill': { name: 'タレット破壊', tier: 'bronze', color: 'var(--medal-white)', xp: 75 },
  'zombie-kill': { name: 'ゾンビキル', tier: 'bronze', color: 'var(--medal-white)', xp: 20 },
  'no-scope-hs': { name: 'ノースコープHS', tier: 'platinum', color: 'var(--medal-cyan)', xp: 600 },
  'qs-hs': { name: 'QSヘッドショット', tier: 'platinum', color: 'var(--medal-cyan)', xp: 400 },
  'clutch-kill': { name: 'クラッチキル', tier: 'gold', color: 'var(--medal-red)', xp: 400 },
  'nemesis-kill': { name: '宿敵討ち', tier: 'gold', color: 'var(--medal-red)', xp: 500 },
  'giant-kill': { name: '巨躯撃破', tier: 'gold', color: 'var(--medal-orange)', xp: 700 },
  'low-hp-20': { name: '不死20キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'combat-master': { name: 'コンバットマスター', tier: 'platinum', color: 'var(--medal-plat)', xp: 1500 },
  // ── F: フィード拡張 (8) ──
  'penta-feed': { name: 'PENTA FEED', tier: 'gold', color: 'var(--medal-gold)', xp: 700 },
  'hexa-feed': { name: 'HEXA FEED', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  'septa-feed': { name: 'SEPTA FEED', tier: 'platinum', color: 'var(--medal-plat)', xp: 1500 },
  'octa-feed': { name: 'OCTA FEED', tier: 'platinum', color: 'var(--medal-plat)', xp: 2500 },
  'rampage-feed': { name: 'RAMPAGE', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'hs-feed-2': { name: 'HS DOUBLE FEED', tier: 'silver', color: 'var(--medal-orange)', xp: 200 },
  'hs-feed-3': { name: 'HS TRIPLE FEED', tier: 'gold', color: 'var(--medal-orange)', xp: 400 },
  'hs-feed-5': { name: 'HS PENTA FEED', tier: 'platinum', color: 'var(--medal-plat)', xp: 1200 },
  // ── G: ストリーク延長 (6) ──
  'streak-35': { name: 'TENACIOUS', tier: 'gold', color: 'var(--medal-gold)', xp: 2500 },
  'streak-40': { name: 'STALWART', tier: 'gold', color: 'var(--medal-gold)', xp: 3500 },
  'streak-50': { name: 'INVINCIBLE', tier: 'platinum', color: 'var(--medal-plat)', xp: 6000 },
  'streak-60': { name: 'GODLIKE', tier: 'platinum', color: 'var(--medal-plat)', xp: 10000 },
  'streak-75': { name: 'TRANSCENDENT', tier: 'platinum', color: 'var(--medal-plat)', xp: 16000 },
  'streak-100': { name: 'LEGEND', tier: 'platinum', color: 'var(--medal-plat)', xp: 25000 },
  // ── H: マガジン (10) ──
  'mag-2': { name: 'マガジン2キル', tier: 'bronze', color: 'var(--medal-white)', xp: 80 },
  'mag-3': { name: 'マガジン3キル', tier: 'silver', color: 'var(--medal-blue)', xp: 200 },
  'mag-4': { name: 'マガジン4キル', tier: 'silver', color: 'var(--medal-blue)', xp: 300 },
  'mag-5': { name: 'マガジン5キル', tier: 'gold', color: 'var(--medal-gold)', xp: 500 },
  'mag-6': { name: 'マガジン6キル', tier: 'gold', color: 'var(--medal-gold)', xp: 700 },
  'mag-7': { name: 'マガジン7キル', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  'mag-8': { name: 'マガジン8キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 1500 },
  'mag-10': { name: 'マガジン10キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'mag-all-hs': { name: 'マガジン全弾HS', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'reload-3': { name: 'リロード直後3連', tier: 'gold', color: 'var(--medal-blue)', xp: 400 },
  // ── I: スライド空中特化 (8) ──
  'slide-snipe': { name: 'スライドスナイプ', tier: 'platinum', color: 'var(--medal-cyan)', xp: 700 },
  'slide-qs': { name: 'スライドQS', tier: 'platinum', color: 'var(--medal-cyan)', xp: 600 },
  'slide-hs': { name: 'スライドHS', tier: 'gold', color: 'var(--medal-cyan)', xp: 250 },
  'air-snipe': { name: '空中スナイプ', tier: 'platinum', color: 'var(--medal-cyan)', xp: 700 },
  'air-qs': { name: '空中QS', tier: 'platinum', color: 'var(--medal-cyan)', xp: 600 },
  'air-hs': { name: '空中HS', tier: 'gold', color: 'var(--medal-cyan)', xp: 250 },
  'slide-air-kill': { name: 'スライド→空中キル', tier: 'platinum', color: 'var(--medal-violet)', xp: 900 },
  'air-slam-kill': { name: '空中グラビティスラム', tier: 'platinum', color: 'var(--medal-violet)', xp: 500 },
  // ── J: 特殊モード (30) ──
  'dark-emperor-kill': { name: '黒帝キル', tier: 'bronze', color: 'var(--medal-violet)', xp: 50 },
  'dark-emperor-5': { name: '黒帝5連キル', tier: 'silver', color: 'var(--medal-violet)', xp: 300 },
  'dark-emperor-10': { name: '黒帝10連キル', tier: 'gold', color: 'var(--medal-violet)', xp: 800 },
  'dark-emperor-20': { name: '黒帝20連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'dark-emperor-50': { name: '黒帝50連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'dark-emperor-nodmg': { name: '黒帝無被弾', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'raitei-kill': { name: '雷帝キル', tier: 'bronze', color: 'var(--medal-gold)', xp: 50 },
  'raitei-5': { name: '雷帝5連キル', tier: 'silver', color: 'var(--medal-gold)', xp: 300 },
  'raitei-10': { name: '雷帝10連キル', tier: 'gold', color: 'var(--medal-gold)', xp: 800 },
  'raitei-20': { name: '雷帝20連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'raitei-50': { name: '雷帝50連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'raitei-nodmg': { name: '雷帝無被弾', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'kokurai-kill': { name: '黒雷帝キル', tier: 'bronze', color: 'var(--medal-plat)', xp: 100 },
  'kokurai-5': { name: '黒雷帝5連キル', tier: 'silver', color: 'var(--medal-plat)', xp: 500 },
  'kokurai-10': { name: '黒雷帝10連キル', tier: 'gold', color: 'var(--medal-plat)', xp: 1500 },
  'kokurai-20': { name: '黒雷帝20連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'kokurai-50': { name: '黒雷帝50連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 12000 },
  'kokurai-nodmg': { name: '黒雷帝無被弾', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'ult-kill': { name: 'ウルトキル', tier: 'bronze', color: 'var(--medal-violet)', xp: 50 },
  'ult-5': { name: 'ウルト5連キル', tier: 'gold', color: 'var(--medal-violet)', xp: 600 },
  'ult-10': { name: 'ウルト10連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'hell-kill': { name: '超鬼畜キル', tier: 'bronze', color: 'var(--medal-red)', xp: 100 },
  'hell-5': { name: '超鬼畜5連キル', tier: 'silver', color: 'var(--medal-red)', xp: 500 },
  'hell-10': { name: '超鬼畜10連キル', tier: 'gold', color: 'var(--medal-red)', xp: 1500 },
  'hell-20': { name: '超鬼畜20連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'hell-50': { name: '超鬼畜50連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 12000 },
  'hell-nodmg': { name: '超鬼畜無被弾', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'de-activation-kill': { name: '黒帝発動キル', tier: 'silver', color: 'var(--medal-violet)', xp: 300 },
  'raitei-activation-kill': { name: '雷帝発動キル', tier: 'silver', color: 'var(--medal-gold)', xp: 300 },
  'kokurai-activation-kill': { name: '黒雷帝発動キル', tier: 'gold', color: 'var(--medal-plat)', xp: 800 },
  // ── K: 超難度 (30) ──
  'perfect-life-5': { name: '完璧な5連', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  'perfect-life-10': { name: '完璧な10連', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'perfect-life-20': { name: '完璧な20連', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'perfect-life-30': { name: '完璧な30連', tier: 'platinum', color: 'var(--medal-plat)', xp: 15000 },
  'all-hs-life-5': { name: 'HS5連一命', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'all-hs-life-10': { name: 'HS10連一命', tier: 'platinum', color: 'var(--medal-plat)', xp: 6000 },
  'boss-slayer': { name: 'ボス討伐', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  'nemesis-mark': { name: '宿敵認定', tier: 'bronze', color: 'var(--medal-red)', xp: 0 },
  'nemesis-revenge': { name: '宿敵打倒', tier: 'gold', color: 'var(--medal-red)', xp: 800 },
  'immortal-15': { name: '不死15キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'immortal-25': { name: '不死25キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'undying-20': { name: '20連キル', tier: 'gold', color: 'var(--medal-gold)', xp: 2000 },
  'undying-30': { name: '30連キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'sharpshooter-25': { name: 'HS25連続', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'executioner-50': { name: '試合50キル', tier: 'gold', color: 'var(--medal-gold)', xp: 3000 },
  'executioner-100': { name: '試合100キル', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'one-shot-5': { name: '一撃必殺5回', tier: 'gold', color: 'var(--medal-gold)', xp: 1500 },
  'backstab-5': { name: '背面5回', tier: 'gold', color: 'var(--medal-red)', xp: 1000 },
  'flawless-combat': { name: '無被弾10連', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'ghost-25': { name: '無被弾25連', tier: 'platinum', color: 'var(--medal-plat)', xp: 8000 },
  'perfect-mag-3': { name: '完璧マガジン3回', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'multi-style-5': { name: 'マルチスタイル', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'survivor-10': { name: 'ゾンビ10ラウンド', tier: 'gold', color: 'var(--medal-gold)', xp: 2000 },
  'survivor-20': { name: 'ゾンビ20ラウンド', tier: 'platinum', color: 'var(--medal-plat)', xp: 6000 },
  'wave-clean-5': { name: '5ウェーブ無被弾', tier: 'platinum', color: 'var(--medal-plat)', xp: 5000 },
  'zombie-master-100': { name: 'ゾンビ100キル', tier: 'gold', color: 'var(--medal-gold)', xp: 2500 },
  'no-scope-10': { name: 'ノースコープ10回', tier: 'gold', color: 'var(--medal-cyan)', xp: 1500 },
  'qs-master-10': { name: 'QSマスター10回', tier: 'gold', color: 'var(--medal-cyan)', xp: 1500 },
  'stealth-5': { name: 'ステルス5回', tier: 'gold', color: 'var(--medal-red)', xp: 1000 },
  'legend-run': { name: '伝説の連鎖', tier: 'platinum', color: 'var(--medal-plat)', xp: 10000 },
  // ── L: チェーン拡張 (14) ──
  'chain-10': { name: 'DOMINATION', tier: 'gold', color: 'var(--medal-gold)', xp: 1000 },
  'chain-12': { name: 'DECIMATION', tier: 'gold', color: 'var(--medal-gold)', xp: 1300 },
  'chain-15': { name: 'ANNIHILATION', tier: 'platinum', color: 'var(--medal-plat)', xp: 2000 },
  'chain-18': { name: 'DEVASTATION', tier: 'platinum', color: 'var(--medal-plat)', xp: 3000 },
  'chain-20': { name: 'OBLITERATION', tier: 'platinum', color: 'var(--medal-plat)', xp: 4000 },
  'chain-25': { name: 'EXTINCTION', tier: 'platinum', color: 'var(--medal-plat)', xp: 6000 },
  'chain-30': { name: 'ARMAGEDDON', tier: 'platinum', color: 'var(--medal-plat)', xp: 9000 },
  'chain-35': { name: 'APOCALYPSE', tier: 'platinum', color: 'var(--medal-plat)', xp: 12000 },
  'chain-40': { name: 'RAGNAROK', tier: 'platinum', color: 'var(--medal-plat)', xp: 16000 },
  'chain-45': { name: 'CATACLYSM', tier: 'platinum', color: 'var(--medal-plat)', xp: 20000 },
  'chain-50': { name: 'SINGULARITY', tier: 'platinum', color: 'var(--medal-plat)', xp: 30000 },
  'chain-comeback': { name: 'CHAIN COMEBACK', tier: 'silver', color: 'var(--medal-gold)', xp: 200 },
  'chain-saver': { name: 'CHAIN SAVER', tier: 'gold', color: 'var(--medal-gold)', xp: 500 },
  'chain-god': { name: 'CHAIN GOD', tier: 'platinum', color: 'var(--medal-plat)', xp: 15000 },
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
  marksman: 48,
  launcher: Infinity,
  exotic: 40,
};

// バッジ表示しない(killfeed のアイコンのみに降格する)メダル。HUDが参照
// 頻出bronze14件: 毎キルで出るためバッジを出すとHUDが埋まる
export const SUPPRESS_BADGE: ReadonlySet<MedalId> = new Set<MedalId>([
  'headshot',
  'ar-specialist', 'smg-specialist', 'sniper-specialist', 'shotgun-specialist',
  'br-specialist', 'lmg-specialist', 'pistol-specialist', 'marksman-specialist',
  'launcher-specialist', 'exotic-specialist',
  'zombie-kill', 'drone-kill', 'turret-kill',
]);

// 取得済みでも毎回バッジを出す「レベルの高い実績」
export const ALWAYS_BADGE: ReadonlySet<MedalId> = new Set<MedalId>([
  // 既存
  'bloodthirsty', 'merciless', 'ruthless', 'relentless', 'brutal', 'unstoppable', 'nuclear', 'qhsf',
  // A: gold/platinum
  'blink-double', 'blink-triple', 'slide-triple', 'air-triple', 'wall-double', 'wall-triple', 'ronin-chain',
  // B: gold/platinum
  'sniper-400m', 'sniper-600m', 'sniper-800m', 'sniper-999m',
  'qs-400m', 'qs-600m', 'qs-800m', 'qs-999m',
  // C: gold/platinum
  'hs-streak-5', 'hs-streak-6', 'hs-streak-7', 'hs-streak-8', 'hs-streak-10',
  // D: gold/platinum
  'shotgun-triple', 'pistol-rampage', 'all-class-kills', 'exotic-rampage',
  // E: gold/platinum
  'low-hp-kill', 'last-bullet', 'master-kill', 'giant-melee', 'no-damage-5', 'no-damage-10',
  'tank-kill', 'no-scope-hs', 'qs-hs', 'clutch-kill', 'nemesis-kill', 'giant-kill', 'low-hp-20', 'combat-master',
  // F: all
  'penta-feed', 'hexa-feed', 'septa-feed', 'octa-feed', 'rampage-feed', 'hs-feed-3', 'hs-feed-5',
  // G: all
  'streak-35', 'streak-40', 'streak-50', 'streak-60', 'streak-75', 'streak-100',
  // H: gold/platinum
  'mag-5', 'mag-6', 'mag-7', 'mag-8', 'mag-10', 'mag-all-hs', 'reload-3',
  // I: all
  'slide-snipe', 'slide-qs', 'slide-hs', 'air-snipe', 'air-qs', 'air-hs', 'slide-air-kill', 'air-slam-kill',
  // J: silver+
  'dark-emperor-5', 'dark-emperor-10', 'dark-emperor-20', 'dark-emperor-50', 'dark-emperor-nodmg',
  'raitei-5', 'raitei-10', 'raitei-20', 'raitei-50', 'raitei-nodmg',
  'kokurai-5', 'kokurai-10', 'kokurai-20', 'kokurai-50', 'kokurai-nodmg',
  'ult-5', 'ult-10',
  'hell-5', 'hell-10', 'hell-20', 'hell-50', 'hell-nodmg',
  'de-activation-kill', 'raitei-activation-kill', 'kokurai-activation-kill',
  // K: gold/platinum
  'perfect-life-5', 'perfect-life-10', 'perfect-life-20', 'perfect-life-30',
  'all-hs-life-5', 'all-hs-life-10',
  'boss-slayer', 'nemesis-revenge',
  'immortal-15', 'immortal-25', 'undying-20', 'undying-30',
  'sharpshooter-25', 'executioner-50', 'executioner-100',
  'one-shot-5', 'backstab-5', 'flawless-combat', 'ghost-25', 'perfect-mag-3', 'multi-style-5',
  'survivor-10', 'survivor-20', 'wave-clean-5', 'zombie-master-100',
  'no-scope-10', 'qs-master-10', 'stealth-5', 'legend-run',
  // L: gold/platinum
  'chain-10', 'chain-12', 'chain-15', 'chain-18', 'chain-20', 'chain-25',
  'chain-30', 'chain-35', 'chain-40', 'chain-45', 'chain-50', 'chain-saver', 'chain-god',
]);

// アナウンサー音声の読み上げ優先度(大きいほど優先)。1キルで複数取得時に最上位を1件だけ読む
export function medalRank(id: MedalId): number {
  // L: 超高チェーン
  if (id === 'chain-50' || id === 'chain-god') return 103;
  if (id === 'chain-40' || id === 'chain-45') return 102;
  if (id === 'chain-35') return 101;
  // G: 超高ストリーク
  if (id === 'streak-100') return 100;
  if (id === 'streak-75') return 99;
  if (id === 'nuclear') return 98;
  if (id === 'streak-60') return 97;
  if (id === 'streak-50') return 96;
  if (id === 'chain-30') return 95;
  if (id === 'chain-25') return 94;
  if (id === 'streak-40' || id === 'streak-35') return 93;
  if (id === 'qhsf') return 92;
  if (id === 'chain-20' || id === 'chain-18') return 91;
  if (id === 'chain-15') return 90;
  if (id === 'rampage-feed' || id === 'octa-feed') return 89;
  if (id === 'septa-feed') return 88;
  if (id === 'chain-12' || id === 'chain-10') return 87;
  if (id === 'mega-feed') return 86;
  if (id === 'penta-feed' || id === 'hexa-feed') return 85;
  if (id === 'quad-feed') return 84;
  if (id === 'legend-run') return 83;
  if (id === 'kill-chain') return 82;
  if (id === 'triple-feed') return 62;
  if (MEDALS[id].tier === 'gold') return 80;
  if (id === 'ronin') return 70;
  if (MEDALS[id].tier === 'silver') return 60;
  if (MEDALS[id].tier === 'platinum') return 50;
  return 30;
}

// 連続キル数 → メダルID
function rapidMedal(chain: number): MedalId | null {
  switch (chain) {
    case 2: return 'double-kill';
    case 3: return 'triple-kill';
    case 4: return 'fury-kill';
    case 5: return 'frenzy-kill';
    case 6: return 'super-kill';
    case 7: return 'mega-kill';
    case 8: return 'ultra-kill';
    default: return chain >= 9 ? 'kill-chain' : null;
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

// G: ストリーク延長閾値
const EXT_STREAK_MEDALS: Record<number, MedalId> = {
  35: 'streak-35', 40: 'streak-40', 50: 'streak-50',
  60: 'streak-60', 75: 'streak-75', 100: 'streak-100',
};

// L: チェーン拡張閾値
const CHAIN_EXT_MEDALS: Record<number, MedalId> = {
  10: 'chain-10', 12: 'chain-12', 15: 'chain-15', 18: 'chain-18',
  20: 'chain-20', 25: 'chain-25', 30: 'chain-30', 35: 'chain-35',
  40: 'chain-40', 45: 'chain-45', 50: 'chain-50',
};

// C: HS連続閾値 (6秒窓)
const HS_STREAK_MEDALS: Record<number, MedalId> = {
  2: 'hs-streak-2', 3: 'hs-streak-3', 4: 'hs-streak-4', 5: 'hs-streak-5',
  6: 'hs-streak-6', 7: 'hs-streak-7', 8: 'hs-streak-8', 10: 'hs-streak-10',
};

// H: マガジンキル閾値
const MAG_MEDALS: Record<number, MedalId> = {
  2: 'mag-2', 3: 'mag-3', 4: 'mag-4', 5: 'mag-5',
  6: 'mag-6', 7: 'mag-7', 8: 'mag-8', 10: 'mag-10',
};

// D: クラス別スペシャリスト
const CLASS_SPECIALIST: Partial<Record<WeaponClass, MedalId>> = {
  ar: 'ar-specialist', smg: 'smg-specialist', sniper: 'sniper-specialist',
  shotgun: 'shotgun-specialist', br: 'br-specialist', lmg: 'lmg-specialist',
  pistol: 'pistol-specialist', marksman: 'marksman-specialist',
  launcher: 'launcher-specialist', exotic: 'exotic-specialist',
};

// B: クラス別ロングショット
const CLASS_LONGSHOT_MEDAL: Partial<Record<WeaponClass, MedalId>> = {
  ar: 'ar-longshot-b', smg: 'smg-longshot-b', br: 'br-longshot-b',
  lmg: 'lmg-longshot-b', pistol: 'pistol-longshot-b',
  marksman: 'marksman-longshot-b', exotic: 'exotic-longshot-b',
};

// J: 黒帝/雷帝/黒雷帝/超鬼畜 連続キル閾値
const DE_MILESTONES: Record<number, MedalId> = { 5: 'dark-emperor-5', 10: 'dark-emperor-10', 20: 'dark-emperor-20', 50: 'dark-emperor-50' };
const RT_MILESTONES: Record<number, MedalId> = { 5: 'raitei-5', 10: 'raitei-10', 20: 'raitei-20', 50: 'raitei-50' };
const KK_MILESTONES: Record<number, MedalId> = { 5: 'kokurai-5', 10: 'kokurai-10', 20: 'kokurai-20', 50: 'kokurai-50' };
const HELL_MILESTONES: Record<number, MedalId> = { 5: 'hell-5', 10: 'hell-10', 20: 'hell-20', 50: 'hell-50' };

// K: 完璧な1ライフ閾値
const PERFECT_LIFE_MEDALS: Record<number, MedalId> = { 5: 'perfect-life-5', 10: 'perfect-life-10', 20: 'perfect-life-20', 30: 'perfect-life-30' };
const HS_LIFE_MEDALS: Record<number, MedalId> = { 5: 'all-hs-life-5', 10: 'all-hs-life-10' };

// SVGの星(killstreakバッジ)の頂点列
export function starPoints(cx: number, cy: number, n: number, outer: number, inner: number): string {
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

  private readonly known: Set<string>;
  private now = 0;
  private chain = 0;
  private chainExpire = 0;
  private lastChainExpiredTs = -999; // L: chain-comeback用
  private feedTimes: number[] = [];
  private feedHeads: boolean[] = [];
  private feedQuadBase = 0;
  private feedTriBase = 0;
  private feedMegaBase = 0;
  private revengeTarget: number | null = null;

  // ── A: 移動系連続 ──
  private slideKillSeq = 0;
  private slideKillExpire = 0;
  private airKillSeq = 0;
  private airKillExpire = 0;
  private wallKillSeq = 0;
  private wallKillExpire = 0;
  private blinkKillSeq = 0;
  private blinkKillExpire = 0;
  private roninKillSeq = 0;
  private roninKillExpire = 0;

  // ── C: HS連続 ──
  private hsStreak = 0;
  private hsStreakExpire = 0;

  // ── D: 武器クラス ──
  private weaponClassesUsed = new Set<WeaponClass>();
  private pistolKillSeq = 0;
  private pistolKillExpire = 0;
  private exoticKillSeq = 0;
  private exoticKillExpire = 0;

  // ── E: 状況 ──
  private noDmgKillStreak = 0;
  private matchLowHpKills = 0;
  private firstBloodFired = false;

  // ── F: フィード拡張 ──
  private feedPentaBase = 0;
  private feedHexaBase = 0;
  private feedSeptaBase = 0;
  private feedOctaBase = 0;
  private feedRampageBase = 0;
  private feedHsSeq = 0;
  private feedHsExpire = 0;

  // ── H: マガジン ──
  private magKillSeq = 0;
  private magKillHsOnly = true;
  private magHsKillCount = 0;
  private consecutivePerfectMags = 0;
  private reloadKillAfterReload = 0; // reload直後キル数

  // ── J: 特殊モード ──
  private darkKills = 0;
  private darkNoDmg = true;
  private darkActivated = false;
  private raiteiKills = 0;
  private raiteiNoDmg = true;
  private raiteiActivated = false;
  private kokuraiKills = 0;
  private kokuraiNoDmg = true;
  private kokuraiActivated = false;
  private ultKills = 0;
  private hellKills = 0;
  private hellNoDmg = true;

  // ── K: 超難度 ──
  private lifeKillCount = 0;
  private lifeNoDamage = true;
  private lifeHsCount = 0;
  private lifeHsOnly = true;
  private matchOneShots = 0;
  private matchBackstabs = 0;
  private matchNoScopes = 0;
  private matchQsKills = 0;
  private matchZombieKills = 0;
  private matchZombieRounds = 0;
  private matchZombieCleanWaves = 0;
  private currentWaveNoDmg = true;
  private nemesisKillCounts = new Map<number, number>();
  private nemesisUid: number | null = null;
  private matchMedalCategories = new Set<string>();

  constructor(known: Set<string>) {
    this.known = known;
  }

  tick(dt: number): void {
    const wasChain = this.chain;
    this.now += dt;
    if (wasChain > 0 && this.now > this.chainExpire) {
      this.chain = 0;
      this.lastChainExpiredTs = this.now;
    }
  }

  private emit(id: MedalId, out: MedalEvent[], combo = 0): void {
    const def = MEDALS[id];
    const first = !this.known.has(id);
    if (first) {
      this.known.add(id);
      this.newlyUnlocked.add(id);
    }
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    out.push({ id, name: def.name, tier: def.tier, color: def.color, xp: def.xp, firstUnlock: first, combo });
    // K: マルチスタイル追跡 (カテゴリ別)
    const cat = this.medalCategory(id);
    if (cat) this.matchMedalCategories.add(cat);
  }

  private medalCategory(id: MedalId): string | null {
    if (['crouch-kill','sprint-kill','blink-kill','blink-double','blink-triple','slide-double','slide-triple','air-double','air-triple','wall-double','wall-triple','ronin-chain'].includes(id)) return 'A';
    if (['close-extreme','ar-longshot-b','smg-longshot-b','br-longshot-b','lmg-longshot-b','pistol-longshot-b','marksman-longshot-b','exotic-longshot-b','sniper-200m','sniper-400m','sniper-600m','sniper-800m','sniper-999m','qs-200m','qs-400m','qs-600m','qs-800m','qs-999m','longshot'].includes(id)) return 'B';
    if (id.startsWith('hs-streak-')) return 'C';
    if (id.endsWith('-specialist') || ['shotgun-double','shotgun-triple','pistol-rampage','all-class-kills','pistol-chain','exotic-rampage'].includes(id)) return 'D';
    if (['first-blood','reload-kill','low-hp-kill','last-bullet','master-kill','giant-melee','no-damage-5','no-damage-10','speed-opener','tank-kill','no-scope-hs','qs-hs','clutch-kill','nemesis-kill','giant-kill'].includes(id)) return 'E';
    if (id.endsWith('-feed') || id === 'hs-feed-2' || id === 'hs-feed-3' || id === 'hs-feed-5') return 'F';
    if (id.startsWith('streak-')) return 'G';
    if (id.startsWith('mag-') || id === 'reload-3') return 'H';
    if (['slide-snipe','slide-qs','slide-hs','air-snipe','air-qs','air-hs','slide-air-kill','air-slam-kill'].includes(id)) return 'I';
    if (id.startsWith('dark-') || id.startsWith('raitei-') || id.startsWith('kokurai-') || id.startsWith('ult-') || id.startsWith('hell-') || id.startsWith('de-') ) return 'J';
    if (id.startsWith('chain-')) return 'L';
    return null;
  }

  onKill(ctx: KillCtx, out: MedalEvent[]): void {
    // ── L: チェーン近接期限・カムバック判定 ──
    const wasNearExpiry = this.chain > 0 && (this.chainExpire - this.now) < 1.0;
    const justExpired = this.chain === 0 && (this.now - this.lastChainExpiredTs) < 1.0;

    // ── 連続キル(ローリング窓) ──
    if (this.now > this.chainExpire) this.chain = 0;
    this.chain += 1;
    this.chainExpire = this.now + Math.min(5.0, 4.0 + this.chain * 0.25);
    const rapid = rapidMedal(this.chain);
    if (rapid) this.emit(rapid, out, this.chain);

    // L: チェーンカムバック/セーバー
    if (justExpired && this.chain === 1) this.emit('chain-comeback', out);
    if (wasNearExpiry && this.chain >= 9) this.emit('chain-saver', out, this.chain);

    // L: チェーン拡張メダル
    const chainExt = CHAIN_EXT_MEDALS[this.chain];
    if (chainExt) this.emit(chainExt, out, this.chain);
    // chain-god: 50連かつhellMode
    if (this.chain >= 50 && ctx.hellMode) this.emit('chain-god', out, this.chain);

    // ── キルストリーク(1ライフ) ──
    const streakMedal = STREAK_MEDALS[ctx.streak];
    if (streakMedal) this.emit(streakMedal, out, ctx.streak);
    if (ctx.streak === 30) this.emit('nuclear', out, ctx.streak);
    // G: ストリーク延長
    const extStreak = EXT_STREAK_MEDALS[ctx.streak];
    if (extStreak) this.emit(extStreak, out, ctx.streak);
    // K: undying
    if (ctx.streak === 20) this.emit('undying-20', out, 20);
    if (ctx.streak === 30) this.emit('undying-30', out, 30);

    // ── フィード系 ──
    this.feedTimes.push(this.now);
    this.feedHeads.push(ctx.headshot);
    const ft = this.feedTimes;
    const fl = ft.length;
    if (fl - this.feedTriBase >= 3 && this.now - ft[fl - 3]! <= 1.4) {
      this.emit('triple-feed', out, 3);
      this.feedTriBase = fl;
    }
    if (fl - this.feedQuadBase >= 4 && this.now - ft[fl - 4]! <= 2.0) {
      this.emit('quad-feed', out, 4);
      this.feedQuadBase = fl;
      if (this.feedHeads.slice(-4).every(Boolean)) this.emit('qhsf', out, 4);
    }
    if (fl - this.feedMegaBase >= 5 && this.now - ft[fl - 5]! <= 3.0) {
      this.emit('mega-feed', out, 5);
      this.feedMegaBase = fl;
    }
    // F: 拡張フィード
    if (fl - this.feedPentaBase >= 5 && this.now - ft[fl - 5]! <= 2.5) {
      this.emit('penta-feed', out, 5); this.feedPentaBase = fl;
    }
    if (fl - this.feedHexaBase >= 6 && this.now - ft[fl - 6]! <= 4.0) {
      this.emit('hexa-feed', out, 6); this.feedHexaBase = fl;
    }
    if (fl - this.feedSeptaBase >= 7 && this.now - ft[fl - 7]! <= 5.0) {
      this.emit('septa-feed', out, 7); this.feedSeptaBase = fl;
    }
    if (fl - this.feedOctaBase >= 8 && this.now - ft[fl - 8]! <= 6.0) {
      this.emit('octa-feed', out, 8); this.feedOctaBase = fl;
    }
    if (fl - this.feedRampageBase >= 10 && this.now - ft[fl - 10]! <= 8.0) {
      this.emit('rampage-feed', out, 10); this.feedRampageBase = fl;
    }
    // F: HSフィード連続
    if (ctx.headshot) {
      if (this.now > this.feedHsExpire) this.feedHsSeq = 0;
      this.feedHsSeq += 1;
      this.feedHsExpire = this.now + 4.0;
      if (this.feedHsSeq === 2) this.emit('hs-feed-2', out, 2);
      if (this.feedHsSeq === 3) this.emit('hs-feed-3', out, 3);
      if (this.feedHsSeq === 5) this.emit('hs-feed-5', out, 5);
    } else {
      this.feedHsSeq = 0;
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
    const isRonin = noScope && (airborne || ctx.wallRunning);
    if (isRonin) this.emit('ronin', out);
    else if (noScope) this.emit('no-scope', out);
    if (ctx.scopeWeapon && ctx.adsProgress > 0.85 && ctx.adsAgeMs <= 350) {
      this.emit('quickscope', out);
    }
    if (ctx.wallRunning) this.emit('wall-hunter', out);
    else if (ctx.sliding) this.emit('slide-kill', out);
    else if (airborne) this.emit('skyfall', out);
    if (ctx.ultActive) this.emit('overdrive', out);
    if (ctx.weaponName === 'グラビティスラム') this.emit('gravity-slam', out);

    // ════════════════════════════════════════════════════════════════
    // ── A: 移動系連続 ──
    // ════════════════════════════════════════════════════════════════
    const SEQ_WIN = 4.0;
    // ブリンクキル
    if (ctx.blinkAgeMs !== undefined && ctx.blinkAgeMs <= 800) {
      if (this.now > this.blinkKillExpire) this.blinkKillSeq = 0;
      this.blinkKillSeq += 1;
      this.blinkKillExpire = this.now + SEQ_WIN;
      if (this.blinkKillSeq === 1) this.emit('blink-kill', out);
      else if (this.blinkKillSeq === 2) this.emit('blink-double', out, 2);
      else if (this.blinkKillSeq >= 3) this.emit('blink-triple', out, this.blinkKillSeq);
    } else if (this.now > this.blinkKillExpire) {
      this.blinkKillSeq = 0;
    }
    // スライド連続
    if (ctx.sliding) {
      if (this.now > this.slideKillExpire) this.slideKillSeq = 0;
      this.slideKillSeq += 1;
      this.slideKillExpire = this.now + SEQ_WIN;
      if (this.slideKillSeq === 2) this.emit('slide-double', out, 2);
      else if (this.slideKillSeq >= 3) this.emit('slide-triple', out, this.slideKillSeq);
    } else if (this.now > this.slideKillExpire) {
      this.slideKillSeq = 0;
    }
    // 空中連続
    if (airborne && !ctx.sliding) {
      if (this.now > this.airKillExpire) this.airKillSeq = 0;
      this.airKillSeq += 1;
      this.airKillExpire = this.now + SEQ_WIN;
      if (this.airKillSeq === 2) this.emit('air-double', out, 2);
      else if (this.airKillSeq >= 3) this.emit('air-triple', out, this.airKillSeq);
    } else if (this.now > this.airKillExpire) {
      this.airKillSeq = 0;
    }
    // 壁走り連続
    if (ctx.wallRunning) {
      if (this.now > this.wallKillExpire) this.wallKillSeq = 0;
      this.wallKillSeq += 1;
      this.wallKillExpire = this.now + SEQ_WIN;
      if (this.wallKillSeq === 2) this.emit('wall-double', out, 2);
      else if (this.wallKillSeq >= 3) this.emit('wall-triple', out, this.wallKillSeq);
    } else if (this.now > this.wallKillExpire) {
      this.wallKillSeq = 0;
    }
    // しゃがみ/スプリント
    if (ctx.crouching) this.emit('crouch-kill', out);
    if (ctx.sprinting) this.emit('sprint-kill', out);
    // RONIN連鎖
    if (isRonin) {
      if (this.now > this.roninKillExpire) this.roninKillSeq = 0;
      this.roninKillSeq += 1;
      this.roninKillExpire = this.now + 5.0;
      if (this.roninKillSeq >= 3) this.emit('ronin-chain', out, this.roninKillSeq);
    } else if (this.now > this.roninKillExpire) {
      this.roninKillSeq = 0;
    }

    // ════════════════════════════════════════════════════════════════
    // ── B: 距離拡張 ──
    // ════════════════════════════════════════════════════════════════
    if (ctx.distM <= 1.0) this.emit('close-extreme', out);
    // クラス別ロングショット
    const clsLs = CLASS_LONGSHOT_MEDAL[ctx.weaponClass];
    if (clsLs && ctx.distM >= LONGSHOT[ctx.weaponClass]) this.emit(clsLs, out);
    // スナイパー距離
    if (ctx.weaponClass === 'sniper') {
      if (ctx.distM >= 999) this.emit('sniper-999m', out);
      else if (ctx.distM >= 800) this.emit('sniper-800m', out);
      else if (ctx.distM >= 600) this.emit('sniper-600m', out);
      else if (ctx.distM >= 400) this.emit('sniper-400m', out);
      else if (ctx.distM >= 200) this.emit('sniper-200m', out);
    }
    // QS距離
    const isQs = ctx.scopeWeapon && ctx.adsProgress > 0.85 && ctx.adsAgeMs <= 350;
    if (isQs) {
      if (ctx.distM >= 999) this.emit('qs-999m', out);
      else if (ctx.distM >= 800) this.emit('qs-800m', out);
      else if (ctx.distM >= 600) this.emit('qs-600m', out);
      else if (ctx.distM >= 400) this.emit('qs-400m', out);
      else if (ctx.distM >= 200) this.emit('qs-200m', out);
    }

    // ════════════════════════════════════════════════════════════════
    // ── C: HS連続 (6秒窓) ──
    // ════════════════════════════════════════════════════════════════
    if (this.now > this.hsStreakExpire) this.hsStreak = 0;
    if (ctx.headshot) {
      this.hsStreak += 1;
      this.hsStreakExpire = this.now + 6.0;
      const hsMedal = HS_STREAK_MEDALS[this.hsStreak];
      if (hsMedal) this.emit(hsMedal, out, this.hsStreak);
      // K: sharpshooter-25
      if (this.hsStreak >= 25 && this.hsStreak === 25) this.emit('sharpshooter-25', out, this.hsStreak);
    }

    // ════════════════════════════════════════════════════════════════
    // ── D: 武器クラス ──
    // ════════════════════════════════════════════════════════════════
    const spec = CLASS_SPECIALIST[ctx.weaponClass];
    if (spec) this.emit(spec, out);
    this.weaponClassesUsed.add(ctx.weaponClass);
    if (this.weaponClassesUsed.size >= 10) this.emit('all-class-kills', out);
    // ピストル連続
    if (ctx.weaponClass === 'pistol') {
      if (this.now > this.pistolKillExpire) this.pistolKillSeq = 0;
      this.pistolKillSeq += 1;
      this.pistolKillExpire = this.now + 5.0;
      if (this.pistolKillSeq === 3) this.emit('pistol-chain', out, 3);
      if (this.pistolKillSeq === 5) this.emit('pistol-rampage', out, 5);
    } else {
      this.pistolKillSeq = 0;
    }
    // エキゾチック3連
    if (ctx.weaponClass === 'exotic') {
      if (this.now > this.exoticKillExpire) this.exoticKillSeq = 0;
      this.exoticKillSeq += 1;
      this.exoticKillExpire = this.now + 5.0;
      if (this.exoticKillSeq >= 3) this.emit('exotic-rampage', out, this.exoticKillSeq);
    } else {
      this.exoticKillSeq = 0;
    }

    // ════════════════════════════════════════════════════════════════
    // ── E: 状況 ──
    // ════════════════════════════════════════════════════════════════
    if (ctx.matchKillCount === 1 && !this.firstBloodFired) {
      this.emit('first-blood', out);
      this.firstBloodFired = true;
    }
    if (ctx.matchElapsed !== undefined && ctx.matchElapsed <= 5) this.emit('speed-opener', out);
    if (ctx.reloadKillBit) this.emit('reload-kill', out);
    if (ctx.playerHpRatio !== undefined) {
      if (ctx.playerHpRatio < 0.1) this.emit('clutch-kill', out);
      else if (ctx.playerHpRatio < 0.2) this.emit('low-hp-kill', out);
      if (ctx.playerHpRatio < 0.3) {
        this.matchLowHpKills += 1;
        if (this.matchLowHpKills === 15) this.emit('immortal-15', out);
        if (this.matchLowHpKills === 20) this.emit('low-hp-20', out);
        if (this.matchLowHpKills === 25) this.emit('immortal-25', out);
      }
    }
    if (ctx.magAmmoBeforeKill === 1) this.emit('last-bullet', out);
    // ボット種類
    if (ctx.botKind === 'master') this.emit('master-kill', out);
    if (ctx.botKind === 'giant') {
      this.emit('giant-kill', out);
      const isMelee = ctx.weaponName === '近接' || ctx.weaponName === 'クナイ' || ctx.weaponName === '黒刀';
      if (isMelee) this.emit('giant-melee', out);
    }
    if (ctx.botKind === 'tank') this.emit('tank-kill', out);
    if (ctx.botKind === 'drone') this.emit('drone-kill', out);
    if (ctx.botKind === 'turret') this.emit('turret-kill', out);
    if (ctx.botKind === 'zombie') {
      this.emit('zombie-kill', out);
      this.matchZombieKills += 1;
      if (this.matchZombieKills === 100) this.emit('zombie-master-100', out);
    }
    // ボス系
    if (ctx.botKind === 'master' || ctx.botKind === 'giant' || ctx.botKind === 'tank') {
      this.emit('boss-slayer', out);
    }
    // ノースコープHS
    if (noScope && ctx.headshot) this.emit('no-scope-hs', out);
    // QSHS
    if (isQs && ctx.headshot) this.emit('qs-hs', out);
    // 宿敵討ち
    if (this.nemesisUid !== null && ctx.victimId === this.nemesisUid) {
      this.emit('nemesis-kill', out);
      this.emit('nemesis-revenge', out);
      this.nemesisUid = null;
    }
    // 無被弾連続
    this.noDmgKillStreak += 1;
    if (this.noDmgKillStreak === 5) this.emit('no-damage-5', out, 5);
    if (this.noDmgKillStreak === 10) { this.emit('no-damage-10', out, 10); this.emit('flawless-combat', out, 10); }
    if (this.noDmgKillStreak === 25) this.emit('ghost-25', out, 25);
    // コンバットマスター(5クラスを1ライフで)
    if (this.weaponClassesUsed.size === 5) this.emit('combat-master', out);

    // ════════════════════════════════════════════════════════════════
    // ── H: マガジン連続キル ──
    // ════════════════════════════════════════════════════════════════
    this.magKillSeq += 1;
    if (!ctx.headshot) this.magKillHsOnly = false;
    else this.magHsKillCount += 1;
    const magMedal = MAG_MEDALS[this.magKillSeq];
    if (magMedal) this.emit(magMedal, out, this.magKillSeq);
    // マガジン全弾HS (3以上HS連続)
    if (this.magKillHsOnly && this.magHsKillCount >= 3 && this.magHsKillCount === 3) {
      this.emit('mag-all-hs', out);
    }
    // reload-3: リロード直後3キル
    if (ctx.reloadKillBit) {
      this.reloadKillAfterReload += 1;
      if (this.reloadKillAfterReload === 3) this.emit('reload-3', out, 3);
    } else if (this.magKillSeq === 1) {
      // 新しいマガジン開始時リセット(reloadKillBitが来なくなった)
      this.reloadKillAfterReload = 0;
    }

    // ════════════════════════════════════════════════════════════════
    // ── I: スライド/空中特化 ──
    // ════════════════════════════════════════════════════════════════
    if (ctx.sliding && ctx.headshot) this.emit('slide-hs', out);
    if (airborne && !ctx.sliding && ctx.headshot) this.emit('air-hs', out);
    if (ctx.sliding && ctx.weaponClass === 'sniper') this.emit('slide-snipe', out);
    if (airborne && !ctx.sliding && ctx.weaponClass === 'sniper') this.emit('air-snipe', out);
    if (ctx.sliding && isQs) this.emit('slide-qs', out);
    if (airborne && !ctx.sliding && isQs) this.emit('air-qs', out);
    // slide-air-kill: スライドシーケンス継続中で空中キル
    if (airborne && !ctx.sliding && this.slideKillSeq > 0) this.emit('slide-air-kill', out);
    // air-slam-kill: 空中でgravity-slam
    if (airborne && ctx.weaponName === 'グラビティスラム') this.emit('air-slam-kill', out);

    // ════════════════════════════════════════════════════════════════
    // ── J: 特殊モード ──
    // ════════════════════════════════════════════════════════════════
    if (ctx.darkEmperorActive) {
      this.darkKills += 1;
      if (this.darkKills === 1) {
        if (!this.darkActivated) { this.emit('de-activation-kill', out); this.darkActivated = true; }
        this.emit('dark-emperor-kill', out);
      }
      const dem = DE_MILESTONES[this.darkKills];
      if (dem) this.emit(dem, out, this.darkKills);
      if (this.darkNoDmg && this.darkKills === 10) this.emit('dark-emperor-nodmg', out);
    }
    if (ctx.raiteiActive) {
      this.raiteiKills += 1;
      if (this.raiteiKills === 1) {
        if (!this.raiteiActivated) { this.emit('raitei-activation-kill', out); this.raiteiActivated = true; }
        this.emit('raitei-kill', out);
      }
      const rm = RT_MILESTONES[this.raiteiKills];
      if (rm) this.emit(rm, out, this.raiteiKills);
      if (this.raiteiNoDmg && this.raiteiKills === 10) this.emit('raitei-nodmg', out);
    }
    if (ctx.kokuraiteiActive) {
      this.kokuraiKills += 1;
      if (this.kokuraiKills === 1) {
        if (!this.kokuraiActivated) { this.emit('kokurai-activation-kill', out); this.kokuraiActivated = true; }
        this.emit('kokurai-kill', out);
      }
      const km = KK_MILESTONES[this.kokuraiKills];
      if (km) this.emit(km, out, this.kokuraiKills);
      if (this.kokuraiNoDmg && this.kokuraiKills === 10) this.emit('kokurai-nodmg', out);
    }
    if (ctx.ultActive) {
      this.ultKills += 1;
      if (this.ultKills === 1) this.emit('ult-kill', out);
      if (this.ultKills === 5) this.emit('ult-5', out, 5);
      if (this.ultKills === 10) this.emit('ult-10', out, 10);
    }
    if (ctx.hellMode) {
      this.hellKills += 1;
      if (this.hellKills === 1) this.emit('hell-kill', out);
      const hm = HELL_MILESTONES[this.hellKills];
      if (hm) this.emit(hm, out, this.hellKills);
      if (this.hellNoDmg && this.hellKills === 10) this.emit('hell-nodmg', out);
    }

    // ════════════════════════════════════════════════════════════════
    // ── K: 超難度 ──
    // ════════════════════════════════════════════════════════════════
    this.lifeKillCount += 1;
    if (!ctx.headshot) this.lifeHsOnly = false;
    else this.lifeHsCount += 1;
    // 1ライフ無被弾
    if (this.lifeNoDamage) {
      const pm = PERFECT_LIFE_MEDALS[this.lifeKillCount];
      if (pm) this.emit(pm, out, this.lifeKillCount);
    }
    // 1ライフ全HS
    if (this.lifeHsOnly && this.lifeHsCount > 0) {
      const hlm = HS_LIFE_MEDALS[this.lifeHsCount];
      if (hlm) this.emit(hlm, out, this.lifeHsCount);
    }
    // 試合累積キル
    if (ctx.matchKillCount) {
      if (ctx.matchKillCount === 50) this.emit('executioner-50', out);
      if (ctx.matchKillCount === 100) this.emit('executioner-100', out);
    }
    // ノースコープ累積
    if (noScope) {
      this.matchNoScopes += 1;
      if (this.matchNoScopes === 10) this.emit('no-scope-10', out);
    }
    // QS累積
    if (isQs) {
      this.matchQsKills += 1;
      if (this.matchQsKills === 10) this.emit('qs-master-10', out);
    }
    // ワンショット累積
    if (ctx.weaponClass === 'sniper' && ctx.victimFullHp) {
      this.matchOneShots += 1;
      if (this.matchOneShots === 5) this.emit('one-shot-5', out);
    }
    // バックスタブ累積
    if (ctx.weaponName === '近接' && ctx.fromBehind) {
      this.matchBackstabs += 1;
      if (this.matchBackstabs === 5) { this.emit('backstab-5', out); this.emit('stealth-5', out); }
    }
    // legend-run: chain>=30 かつ noDmg>=20
    if (this.chain >= 30 && this.noDmgKillStreak >= 20) this.emit('legend-run', out);
    // multi-style-5: 5カテゴリ達成
    if (this.matchMedalCategories.size === 5) this.emit('multi-style-5', out);
  }

  // 同一トリガーで2体以上
  onCollateral(n: number, out: MedalEvent[]): void {
    if (n >= 2) this.emit('collateral', out, n);
    if (n >= 2) this.emit('shotgun-double', out, n);
    if (n >= 3) this.emit('shotgun-triple', out, n);
  }

  // プレイヤー死亡
  onPlayerDeath(killerId: number | null): void {
    this.chain = 0;
    this.resetFeed();
    this.revengeTarget = killerId;
    // 宿敵追跡
    if (killerId !== null) {
      const prev = this.nemesisKillCounts.get(killerId) ?? 0;
      const next = prev + 1;
      this.nemesisKillCounts.set(killerId, next);
      if (next >= 3 && this.nemesisUid === null) {
        this.nemesisUid = killerId;
      }
    }
    // 1ライフリセット
    this.lifeKillCount = 0;
    this.lifeNoDamage = true;
    this.lifeHsOnly = true;
    this.lifeHsCount = 0;
    this.noDmgKillStreak = 0;
    this.weaponClassesUsed = new Set<WeaponClass>();
  }

  // killfeed への追加通知
  onFeed(killerIsPlayer: boolean): void {
    if (!killerIsPlayer) this.resetFeed();
  }

  // ── 新コールバック(match側が配線する。未配線でも安全) ──

  /** プレイヤーが被ダメージを受けた */
  onPlayerDamaged(): void {
    this.noDmgKillStreak = 0;
    this.lifeNoDamage = false;
    this.darkNoDmg = false;
    this.raiteiNoDmg = false;
    this.kokuraiNoDmg = false;
    this.hellNoDmg = false;
    this.currentWaveNoDmg = false;
  }

  /** リロード完了 */
  onReloadDone(): void {
    // perfect-mag判定: 3+キルかつ全HS
    if (this.magKillSeq >= 3 && this.magKillHsOnly && this.magHsKillCount >= 3) {
      this.consecutivePerfectMags += 1;
    } else {
      this.consecutivePerfectMags = 0;
    }
    // マガジン追跡リセット
    this.magKillSeq = 0;
    this.magKillHsOnly = true;
    this.magHsKillCount = 0;
    this.reloadKillAfterReload = 0;
    // perfect-mag-3
    if (this.consecutivePerfectMags >= 3) {
      // emitはonKill文脈なしなのでoutは空配列 → 実際にはonKill内で発火するため
      // ここでは consecutivePerfectMags をリセットしない(次のキルで確認)
    }
  }

  /** ブリンク(テレポート)実行 */
  onBlink(): void {
    this.blinkKillSeq = 0;
    this.blinkKillExpire = this.now + 0.8;
  }

  /** ウルト発動 */
  onUltActivate(_type: string): void {
    this.ultKills = 0;
  }

  /** スライド終了 */
  onSlideEnd(): void {
    // slideKillSeqは窓ベースで自動管理
  }

  /** 着地 */
  onLand(): void {
    // airKillSeqは窓ベースで自動管理
  }

  /** 壁走り終了 */
  onWallRunEnd(): void {
    this.wallKillSeq = 0;
  }

  /** Moonfallキル(グラビティスラム範囲キル) */
  onMoonfallKill(_count: number, _out: MedalEvent[]): void {
    // 将来実装: 範囲キル数に応じたメダル
  }

  /** ゾンビラウンド開始 */
  onZombieRoundStart(): void {
    this.currentWaveNoDmg = true;
  }

  /** ゾンビラウンド終了 */
  onZombieRoundEnd(out: MedalEvent[]): void {
    this.matchZombieRounds += 1;
    if (this.currentWaveNoDmg) {
      this.matchZombieCleanWaves += 1;
      if (this.matchZombieCleanWaves === 5) this.emit('wave-clean-5', out);
    }
    if (this.matchZombieRounds === 10) this.emit('survivor-10', out);
    if (this.matchZombieRounds === 20) this.emit('survivor-20', out);
  }

  private resetFeed(): void {
    this.feedTimes = [];
    this.feedHeads = [];
    this.feedQuadBase = 0;
    this.feedTriBase = 0;
    this.feedMegaBase = 0;
    this.feedPentaBase = 0;
    this.feedHexaBase = 0;
    this.feedSeptaBase = 0;
    this.feedOctaBase = 0;
    this.feedRampageBase = 0;
    this.feedHsSeq = 0;
  }
}
