// 試合の公開型定義(MatchConfig / MatchSnapshot / MatchResult ほか)。
// R54-W1 F1 で match.ts から型のみ分割移動(挙動不変・ランタイムコードなし)。
// hud/main/テストは従来どおり match.ts の再エクスポート経由でも、本ファイル直でも参照可。
import type * as THREE from 'three';
import type { Difficulty } from './bot';
import type { MissionDef, RadioSpeaker } from './campaign';
import type { GrenadeKind } from './grenades';
import type { MedalEvent } from './medals';
import type { GameMode } from './modes';
import type { MatchSummary } from './progression';
import type { SndPhase } from './snd';
import type { StageDef } from './stage';
import type { CharmId, PowerUpKind, ZombiePerkId } from './zombie-economy';

export interface MatchConfig {
  stage: StageDef;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
  durationS: number;
  // ── R6 ストーリー/拡張(すべて任意。未指定なら従来の対戦として動く) ──
  mission?: MissionDef; // 注入するとストーリーモードとして目的/波/勝敗で進行する
  perks?: string[]; // パーク(将来拡張)
  wildcard?: 'gunfighter' | 'tactician' | null; // ワイルドカード
  secondaryId?: string; // 副武器の上書き
  scoreAttack?: boolean; // スコアアタック(自己ベスト記録)
  zombieStartRound?: number; // R27: ゾンビモードの開始ラウンド(1-50、未指定=1)
  hellMode?: boolean;
  allGiantMode?: boolean;
  // ── R53-W2 お守り(charm) ──────────────────────────────────────────────
  charm?: CharmId; // メニューが選択中のお守りを渡す(zombieモードのみ効果を持つ)
  carriedPerk?: ZombiePerkId; // perkcarryお守り用: 前試合から引き継ぐパーク種(menu側が決定)
  // ── R53-W2 M2b: ミッション難易度(MN2凍結契約。story=mission注入時のみ効果) ──
  missionDifficulty?: 'easy' | 'normal' | 'hard';
  // ── R53-W3 M3: 刀身雷脈(黒雷帝キル累計)。main.tsが profile.kokuraiKillsTotal
  // (=試合ごとの実キル数 summary.kokuraiKills を積算した生涯カウンタ)を渡す。
  // 試合中の追加キル(tracker.kokuraiKillCount)と合算して100到達で恒久雷脈 ──
  kokuraiKillsBase?: number;
}

export interface FeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
}

// R53-W3 M3: HUDモーメント(下1/3帯の統一演出)。medals と同じ「1回性イベントの
// ドレイン方式」— snapshot で渡し、次tick冒頭で消費済みとしてクリアする。
// hud.ts 側は構造的に同型のローカル定義で消費する(契約凍結)。
export interface MomentEvent {
  kind: 'round' | 'rankup' | 'perk' | 'emperor' | 'ggrank' | 'special';
  title: string;
  sub?: string;
  tone?: 'ember' | 'ice' | 'violet';
}

export interface DamageNumber {
  amount: number;
  world: THREE.Vector3;
  kind: 'body' | 'head' | 'kill' | 'limb'; // 色・大きさの段階分け
}

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
  // チーム戦でプレイヤー側ならtrue。FFAではプレイヤー本人のみtrue
  isAlly: boolean;
}

export interface ZoneView {
  id: string;
  owner: 'mine' | 'enemy' | null;
  progress: number;
  capturing: 'mine' | 'enemy' | null;
  contested: boolean;
}

export interface MatchResult {
  rows: ScoreRow[];
  won: boolean;
  accuracy: number;
  headshots: number;
  modeName: string;
  teamScores: { mine: number; enemy: number } | null;
  // 進行度(XP・チャレンジ)への入力
  summary: MatchSummary;
  // R45a: ゾンビモード結果
  zombieRound?: number;
  zombiePoints?: number;
  // R53-W2 M2b: ゾンビAAR用(menu側が行を追加する契約。ゾンビ時のみ)
  papTierMax?: number;
  specialZombieKills?: number;
  // R53-W2 M2b: S&D結果(mode==='snd'のみ)
  sndScore?: [number, number];
}

export interface MatchSnapshot {
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnIn: number;
  ammo: number;
  reserve: number;
  magSize: number; // 弾倉容量(HUDの弾ピップ正規化 ammo/magSize 用)
  weaponName: string;
  weaponSlot: string; // 'PRIMARY' / 'SECONDARY'
  fireMode: string;
  reloading: boolean;
  reloadRatio: number;
  spreadRad: number;
  adsProgress: number;
  kills: number;
  deaths: number;
  streak: number;
  timeLeft: number;
  yaw: number;
  fov: number;
  over: boolean;
  // 移動状態(HUDの速度計・状態チップ用)
  speed: number;
  sliding: boolean;
  wallRunning: boolean;
  airborne: boolean;
  reduceMotion: boolean;
  radarEnabled: boolean; // 簡易レーダーの表示設定
  ultCharge: number; // 0..1
  ultActive: boolean; // オーバードライブ発動中
  // スナイパースコープ/エイムアシスト関連
  scopedWeapon: boolean; // 現在の武器がスコープ持ちか(オーバーレイ表示の起点)
  opticId: string; // 現在の光学ID(optics.ts OPTIC_SPECS)。HUDレティクル/オーバーレイ駆動
  adsOpticActive: boolean; // 倍率光学をADS中(magnified && adsProgress>0.5)。def.scopeとは独立系統
  sightStyle: string; // = OpticSpec.reticleKind。HUDの data-reticle 駆動(全画面レティクルの種類)
  scope: { sway: { x: number; y: number }; steady: boolean; breath01: number }; // swayは度
  aimAssistEngaged: boolean; // 視認できる敵が吸着円錐内にいる
  rangeM: number; // スコープのレンジ表示(対象までの距離m、無ければ0)
  zoomX: number; // スコープ倍率(fov/adsFov)
  reticleStyle: string; // 設定のレティクル形状(腰だめクロスヘア用)
  reticleColor: string; // 設定のレティクル色
  weaponId: string; // 現在の武器ID
  grenadeName: string;
  grenadeCount: number;
  cookRatio: number; // 0=非クッキング、1=強制投擲直前
  whiteout: number; // フラッシュの白飛び 0..1
  modeName: string;
  teamBased: boolean;
  scoreMine: number;
  scoreEnemy: number; // FFAでは首位の敵スコア
  scoreTarget: number;
  zones: ZoneView[]; // ドミネーション以外は空
  announcements: string[];
  spectating: boolean;
  killcam: string | null; // キルカメラ中に映している相手の名前
  // ── R11 シネマティック・キルカメラ / ジュース(HUDは読むのみ) ──
  killcamRatio: number; // 0..1 = killcamTimer/KILLCAM_S(キルカメラ非該当時0)
  killcamWeapon: string | null; // キルした相手の武器/機種ラベル(非該当null)
  killcamDistM: number; // killer→player 水平距離(m, round)
  killcamFlash: number; // 0..1 キルカメラ突入の白フラッシュ(dt*5.5減衰)
  deathVeil: number; // 0..1 遷移黒幕(死亡/リスポーンの無条件減衰)
  killcamFinal: boolean; // 終盤(killcamTimer<0.7 && killer生存)の赤ビネット
  killcamCamActive: boolean; // カメラがシネマ姿勢を所有中(HUDシネマ枠の単一の真実)
  fkCinematicActive: boolean; // ファイナルキルカム再生中(main.tsのレターボックス制御用)
  lowHp01: number; // 0..1 低HP(juiceのDOMフォールバック用)
  postfxActive: boolean; // medium/high=true(PostFXシェーダ所有), low=false
  feed: FeedEntry[];
  hits: Array<'hit' | 'head' | 'kill' | 'snipe' | 'limb'>;
  hitExpandRad: number; // ヒットマーカーの一時拡大量(連続ヒットで広がる)
  damageNumbers: DamageNumber[];
  // ── R6 ストーリー(非ストーリーでは undefined) ──
  missionId?: string;
  objectiveText?: string; // 現在の目的の文言
  objectiveProgress01?: number; // 目的の進捗 0..1
  waveIndex?: number; // 現在の波(1始まり)
  waveTotal?: number; // 総波数
  bossHp01?: number; // ボスの残りHP割合(0..1)。ボス不在なら undefined
  // ── R16 ゾンビ(mode!=='zombie'では undefined。HUD/menuはこれで round HUD を分岐)──
  zombieRound?: number; // 現在のラウンド(1始まり。0=開始前)
  zombieKills?: number; // 累計撃破数
  zombiePoints?: number; // 累計ポイント(命中10/キル60/HSキル100)
  playerDowns?: number; // プレイヤーがダウンした回数(ゲームオーバー確定)
  // ── ゾンビ経済(shop/perks/floats) ──
  zombieShopPrompt?: { label: string; canAfford: boolean; cost: number };
  zombiePerks?: readonly ZombiePerkId[];
  zombiePerkStacks?: Readonly<Partial<Record<ZombiePerkId, number>>>; // パークのスタック数
  zombieQuickReviveCharges?: number; // V23: 所持中の自己復活チャージ(HUDチップ表示用)
  // ── R53-W2 Pack-a-Punch/パワーアップ/特殊ラウンド/毒霧(HUDビルダーH2契約、フィールド名凍結) ──
  papTier?: number; // 装備武器の現Pack-a-Punch tier(0-3)
  zombiePowerUps?: { kind: PowerUpKind; x: number; y: number; z: number }[]; // 地面ドロップ位置
  activePowerUps?: { kind: PowerUpKind; remainS: number }[]; // 発動中の時限効果(insta/double)
  specialRound?: 'rush' | null; // 現ラウンドの特殊種別
  poison01?: number; // 毒霧被曝 0..1(HUDビネット用)
  // ── R53-W2 M2b: ストーリー帝王編(story=mission時のみ。H2契約凍結名) ──
  radioLine?: { speaker: RadioSpeaker; text: string } | null; // 無線字幕(表示中のみ非null)
  detect01?: number; // infiltrate: 敵の最大発見メータ 0..1(SPOTTED=0.9+)
  bossPhase?: { idx: number; total: number } | null; // bossPhases進行(idx=現フェーズ1始まり)
  // ── R53-W2 M2b: S&D(mode==='snd'時のみ。H2契約凍結名) ──
  sndPhase?: SndPhase;
  sndScore?: [number, number]; // [自チーム, 敵チーム] 先取4
  sndBombTimer?: number; // planted中のヒューズ残秒
  sndProgress01?: number; // プレイヤー自身の設置/解除ホールド進捗
  sndProgressKind?: 'plant' | 'defuse';
  sndCarrierIsPlayer?: boolean;
  // ── R53-W3 M3: MK.III HUD契約(Fable#3消費) ──
  uiHeat?: number; // 0..1 戦闘熱(Adaptive HUDのcalm/combat判定)
  moments?: MomentEvent[]; // 1回性の演出イベント(medalsと同じドレイン方式)
  emperorState?: 'dark' | 'raitei' | 'kokuraitei' | null; // 帝王状態(activeKit由来)
  zombieBossFlash?: number; // ボス出現の赤フラッシュ 0..1
  zombiePointFloats?: Array<{ amount: number; world: THREE.Vector3 }>;
  zombieReviveFlash?: number; // 0..1
  darkEmperorS?: number; // 黒帝モードの残り秒(undefined=非発動またはfists以外)
  darkEmperorPermanent?: boolean; // 常闇カモによる永続黒帝(タイマー非表示)
  raiteiMode?: boolean;    // 雷帝モード発動中
  kokuraiteiMode?: boolean; // 黒雷帝モード発動中
  chargeRatio?: number;    // 溜め攻撃ゲージ 0..1(0=非溜め)
  minigunSpin01?: number;  // 修羅スピンアップRPM 0..1(minigun装備+スピン>0のみ。HUDゲージ用)
  // T7: minigun(修羅)/fan(風神扇)はADS中も通常のスコープ縮小ではなくブレース姿勢になるため、
  // viewmodel側のブレースポーズ化とHUD側のクロスヘア維持が消費するフラグ(フィールド名凍結)
  adsKeepsCrosshair?: boolean;
  incoming: number[]; // 被弾方向(カメラ基準の角度rad)
  tookDamage: boolean;
  scoreboard: ScoreRow[];
  scoreEvents: Array<{ label: string; xp: number }>; // スコア獲得トースト(キル/HS/制圧)
  enemyBearings: Array<{ angle: number; dist: number }>; // レーダー用: 自機yaw基準の相対角と水平距離
  medals: MedalEvent[]; // この描画フレームで取得したメダル(初回=バッジ/以降=大文字)
  // ── BO2 スコアストリーク ──
  streakProgress: number;        // 0..799
  streakBanked: readonly boolean[];  // 7ストリークのバンク状態
  streakUavActive: boolean;       // UAV 発動中か
  streakUavTimeLeft: number;      // UAV 残り秒(0=非活動)
  streakRcxdActive: boolean;      // RC-XD操縦中
  streakRcxdTimeLeft: number;     // RC-XD残り秒
  streakCauavActive: boolean;     // カウンターUAVアクティブ
  streakCauavTimeLeft: number;    // カウンターUAV残り秒
  // ── ミニマップ (UAV=敵ドット, 常時=味方ドット) ──
  minimapEnemies: ReadonlyArray<{ relX: number; relZ: number; opacity: number }>;
  minimapAllies: ReadonlyArray<{ relX: number; relZ: number }>;
  minimapStageSize: number;
  // ── ③ 発砲ブリップ(BO2本物仕様: 敵発砲位置1秒表示) ──
  fireBlips: ReadonlyArray<{ relX: number; relZ: number; age01: number }>;
  // ── ハードポイント ──
  hardpointZoneAngle?: number;       // プレイヤーヨー基準の方向角(rad)。undefined=非対象モード/死亡
  hardpointZoneRelX?: number;        // プレイヤーからの相対X (ミニマップ表示用)
  hardpointZoneRelZ?: number;        // プレイヤーからの相対Z
  hardpointOwner?: 'mine' | 'enemy' | null;
  hardpointContested?: boolean;
  hardpointTimeLeft?: number;        // 残り秒数(0-60)
  hardpointPreview?: boolean;        // true when ≤10s
  // ── キルコンファーム ──
  kcEvent?: 'confirmed' | 'denied' | null; // このフレームのタグ回収イベント
  kcTagPositions?: ReadonlyArray<{ relX: number; relZ: number; isEnemy: boolean }>; // ミニマップ用
  // ── ガンゲーム ──
  ggRank?: number;           // 現在のランク (1-20)。gungame以外では undefined
  ggWeaponName?: string;     // 現在のラダー武器名
  ggRankUpFlash?: boolean;   // このフレームにランクアップした(HUD演出トリガ)
  ggSetback?: boolean;       // このフレームに setback(ランクダウン)した
  ggTop3?: ReadonlyArray<{ name: string; rank: number; isPlayer: boolean }>; // トップ3
  // ── 訓練場 ──
  trainingStats?: {
    dps: number;
    accuracy: number;
    hsRate: number;
    streak: number;
  };
  // 破壊済み breakable プロップのコライダーハンドルセット(将来のミニマップ連携用)
  destroyedPropHandles: ReadonlySet<number>;
  hellMode?: boolean;
}
