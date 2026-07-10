import './style.css';
import { cancelPendingThumbs } from './render/stage-thumbs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { deriveReverbPreset, SoundKit, type BgmProfileKey } from './core/audio';
import { resolveMood } from './render/atmosphere';
import { gamepadCfg } from './core/gamepad';
import { Input } from './core/input';
import { GameLoop } from './core/loop';
import { loadProfile, saveProfile } from './core/profile';
import { loadSettings, resolveGraphicsTier } from './core/settings';
import { missionById } from './game/campaign';
import { Match, type MatchConfig } from './game/match';
import { PhotoMode } from './game/photo';
import { applyCampaignMission, applyMatch, applyScoreRecord, XP_MUL_NORMAL, XP_MUL_ZOMBIE } from './game/progression';
import { stageDefFromId } from './game/biomes';
import { stageById } from './game/stages';
import { motifWeightForMission } from './game/story-engine';
import { Hud } from './ui/hud';
import { Hud2 } from './ui2/hud2';
import { Menu, type MenuCallbacks, type MenuSelection } from './ui/menu';
import { Menu2 } from './ui2/menu2';
import type { MenuApi } from './ui2/types';
import { SpaceBg } from './ui/menu-bg';

const appRoot = document.getElementById('app');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const spaceCanvas = document.getElementById('space-bg') as HTMLCanvasElement | null;
if (!appRoot || !hudRoot || !menuRoot) throw new Error('マウント先の要素が見つからない');

// W-ENZA2: ?ui2 で新UI層(モック正典)を使用。検証完了後に既定反転+?classicフォールバック予定
// W-ENZA2: 焔座v2(Claude Designモック1:1移植)を既定UIへ。旧UI(src/ui)は ?classic でフォールバック。
const USE_UI2 = !new URLSearchParams(location.search).has('classic');

// WebGLも物理エンジンも無い環境では黒画面で詰まらせず、理由を示して止める。
function showFatal(message: string): void {
  menuRoot!.hidden = false;
  menuRoot!.innerHTML =
    '<div class="menu-screen menu-fatal"><div class="fatal-panel">' +
    `<h1>起動できません</h1><p>${message}</p></div></div>`;
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  showFatal(
    'このブラウザではWebGLが使えません。設定でWebGLを有効にするか、対応ブラウザで開いてください。',
  );
  throw new Error('WebGL を初期化できない');
}

try {
  await RAPIER.init();
} catch {
  showFatal('物理エンジンの読み込みに失敗しました。通信環境を確認して再読み込みしてください。');
  throw new Error('物理エンジンを初期化できない');
}

const settings = loadSettings();
const profile = loadProfile();

// 画質ティアを起動時に確定。low(=WebGL1含む)は EffectComposer を作らず素のMSAAを使う。
const hasWebGL2 = Boolean(document.createElement('canvas').getContext('webgl2'));
const graphicsTier = resolveGraphicsTier(settings.graphicsQuality, hasWebGL2);

const renderer = new THREE.WebGLRenderer({ antialias: graphicsTier === 'low' });
renderer.setSize(window.innerWidth, window.innerHeight);
// 適応DPRの基準pixelRatio。試合開始時にここへ戻すことで前試合の低下段を持ち越さない
const BASE_DPR = Math.min(window.devicePixelRatio, graphicsTier === 'high' ? 2 : 1.5);
renderer.setPixelRatio(BASE_DPR);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// R15: 白飛び解消 — AgXは明部を白へ脱色させ「色が際立たない/白飛び」の主因だった。
// Khronos PBR Neutral は明部でも色相・彩度を保ちつつ緩やかにHDRロールオフするため、
// 色が際立ち白飛びしない。線形→sRGB の物理ベース出力。
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appRoot.appendChild(renderer.domElement);
const sounds = new SoundKit();
sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi, settings.musicVolume, settings.voVolume);
const input = new Input();
input.attach(renderer.domElement);
input.setGamepadBindings(settings.gamepadBindings);
input.setVibration(settings.gamepadVibration);
sounds.setMusicEnabled(settings.musicEnabled);

const hud = USE_UI2 ? new Hud2(hudRoot) : new Hud(hudRoot); // W-ENZA2: 同時生成禁止(FKカム/data-emperor二重化防止)

// シネマティックキルカム用レターボックス(canvas上・HUD下)
const letterboxEl = document.createElement('div');
letterboxEl.id = 'ck-letterbox';
Object.assign(letterboxEl.style, {
  position: 'fixed', inset: '0', pointerEvents: 'none',
  zIndex: '5', opacity: '0', transition: 'opacity 0.1s',
});
const lbBarStyle = 'position:absolute;left:0;right:0;background:#000;height:10%;';
const lbTop = document.createElement('div'); lbTop.setAttribute('style', lbBarStyle + 'top:0');
const lbBot = document.createElement('div'); lbBot.setAttribute('style', lbBarStyle + 'bottom:0');
letterboxEl.appendChild(lbTop); letterboxEl.appendChild(lbBot);
document.body.appendChild(letterboxEl);

// メニュー背景の宇宙(独立レンダラ)。WebGLが使えない環境では生成しない
const spaceBg = spaceCanvas && !USE_UI2 ? new SpaceBg(spaceCanvas) : null;

// UIスケールはzoomで反映する。投影座標(ダメージ数値など)は
// ズーム後の座標系で算出するため、HUDへ渡す画面サイズも同じ倍率で割る
function applyUiScale(): void {
  hudRoot!.style.setProperty('zoom', String(settings.uiScale));
  // R14: 全面オーバーレイ(被弾/フラッシュ/死亡幕)は zoom で縮むと視界を覆いきれず
  // uiScale<1 で端からゲームが透けるため、CSS 側で 100%/--ui-scale に逆補正して常に全画面を覆う
  hudRoot!.style.setProperty('--ui-scale', String(settings.uiScale));
}
applyUiScale();

// UIのアクセント色は :root の data-accent で切り替える。既定の ember は
// 素の :root が持つので属性を外す
function applyAccent(): void {
  const root = document.documentElement;
  if (settings.uiAccent === 'ember') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', settings.uiAccent);
}
applyAccent();

// アプリ内の揺れ軽減設定をルートクラスへ反映し、CSSアニメも止める
// 実効reduceMotion = アプリ内設定 OR OSの prefers-reduced-motion。
// CSSは@mediaでOSを見るが、JS/WebGL駆動の演出(宇宙背景・被弾クロマ)はここで統合する
function effectiveReduceMotion(): boolean {
  return (
    settings.reduceMotion ||
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}
function applyMotion(): void {
  const rm = effectiveReduceMotion();
  document.documentElement.classList.toggle('reduce-motion', rm);
  spaceBg?.setReduceMotion(rm);
}
applyMotion();

let match: Match | null = null;
let chromaTimer = 0; // 被弾クロマアベの後始末タイマー(連続被弾で積み重ねない)
let mode: 'menu' | 'playing' | 'paused' | 'result' | 'finalkillcam' | 'photo' = 'menu';
let photoMode: PhotoMode | null = null; // R54-F7: フォトモード(mode==='photo' 中のみ非null)
let combatLoopsPaused = false; // 戦闘ループ音の一時停止状態(遷移時のみAPIを叩く)
let lastSelection: MenuSelection | null = null;
let activeMissionId: string | null = null; // ストーリー進行中のミッションID(なければ通常戦)

// 共通の出撃処理。configを組んでMatchを起動しHUD/ロックへ遷移する
function launch(config: MatchConfig): void {
  cancelPendingThumbs(); // V32: 試合中のサムネ生成ヒッチ防止(メニュー復帰時に自動再キュー)
  sounds.ensure();
  // reduceMotionは共有settingsを書き換えない(保存設定/SYSTEMチェックボックスの汚染防止)。
  // MatchはこれまでどおりsettingsのreduceMotion(アプリ設定)を参照する。OSのprefers-
  // reduced-motionはCSS(@media)側で尊重される
  // リスタート経路の二重起動防止→ステージの空間残響→環境音ベッドの順に音場を用意
  sounds.stopAmbience();
  // ★V-D MEDIUM修正: 前試合のdisposeは音場セットアップの「前」に行う。前試合が黒雷帝で
  // 終わっていると dispose→setEmperorBgm(null) が退避プロファイル(前ステージ曲)を復元する
  // ため、後置きだと新ステージの setMusicProfile を上書きして曲を取り違える(「次のミッション」経路)
  match?.dispose();
  // 適応DPRの状態を初期化(前試合の解像度スケール段を持ち越さない)。共有rendererの
  // pixelRatioも基準へ戻す(これを怠ると新試合のcomposerが低下値を継承し複利で劣化する)
  frameEma = 0.0166;
  bestFrame = 0.0166;
  dprStep = 0;
  renderer.setPixelRatio(BASE_DPR);
  sounds.setReverb(deriveReverbPreset(config.stage));
  // BGMをステージのムード別プロファイルへ。ゾンビは専用の不穏→高揚プロファイル、
  // 夜市yoichiのみネオン特化。それ以外はステージのムード。かっこいい軍事エレクトロニカ
  const bgmMood = resolveMood(config.stage.palette);
  const bgmKey: BgmProfileKey =
    config.mode === 'zombie'
      ? 'zombie'
      : bgmMood === 'night' && config.stage.id === 'yoichi'
        ? 'night-neon'
        : bgmMood;
  sounds.setMusicProfile(bgmKey, motifWeightForMission(config.mission));
  sounds.startAmbience(config.stage);
  match = new Match(
    config,
    settings,
    input,
    sounds,
    window.innerWidth / window.innerHeight,
    renderer,
    new Set<string>(profile.unlockedMedals),
  );
  hud.reset();
  // BO2 ミニマップ: 試合ごとにステージのボックスデータをセットアップ
  hud.setupMinimap(match.minimapBoxes(), config.stage.size);
  hud.show();
  spaceBg?.stop(); // 出撃中はメニュー背景の宇宙レンダラを止める(RAF/GPU圧迫防止)
  menu.hide();
  mode = 'playing';
  input.requestLock(renderer.domElement);
}

function startMatch(selection: MenuSelection): void {
  lastSelection = selection;
  activeMissionId = null;
  // gen-* のプロシージャルIDも解決できるようフォールバックさせる
  const stage = stageDefFromId(selection.stageId) ?? stageById(selection.stageId);
  // R54-F5 輪廻(ローグラン): ミサゴ拳銃のみ・R1固定・救済系オプション無効(純度優先v1)。
  // 排他はUI(menu)でも無効化するが、転記段階でも構造的に落とす(二重の安全)
  const rogue = selection.mode === 'zombie' && selection.rogueRun === true;
  launch({
    stage,
    mode: selection.mode,
    primaryId: rogue ? 'misago-pistol' : selection.primaryId,
    attachments: rogue ? [] : selection.attachments,
    grenade: selection.grenade,
    difficulty: selection.difficulty,
    durationS: settings.matchLengthS,
    scoreAttack: selection.mode === 'score',
    secondaryId: rogue ? 'misago-pistol' : selection.secondaryId,
    rogueRun: rogue,
    zombieStartRound: rogue ? undefined : selection.zombieStartRound,
    hellMode: rogue ? false : (selection.hellMode ?? false),
    allGiantMode: rogue ? false : (selection.allGiantMode ?? false),
    // R53-W2 M2b: MN2凍結契約の転記(お守り/継承パーク。ゾンビモードのみ効果)
    charm: rogue ? undefined : selection.charm,
    carriedPerk: rogue ? undefined : selection.carriedPerk,
    // ★V-D HIGH修正: medalCounts['kokurai-kill']は「初キルメダルの発火回数≒試合数」で
    // キル数ではない。刀身雷脈(黒雷百殺=100キル)の基底は生涯キル累計を使う
    kokuraiKillsBase: profile.kokuraiKillsTotal ?? 0,
  });
}

// ストーリー・ミッションを起動する。武器は自由選択(省略時=支給武器)
let activeMissionPrimary: string | null = null; // リトライ時に選択武器を引き継ぐ
function startMission(missionId: string, primaryId?: string, missionDifficulty?: 'easy' | 'normal' | 'hard'): void {
  const mission = missionById(missionId);
  if (!mission) return;
  // 別ミッションへ移る時は前回の選択武器を持ち越さない(支給武器を黙って上書きしない)。
  // 同一ミッションのリトライのみ選択を引き継ぐ
  if (missionId !== activeMissionId) activeMissionPrimary = null;
  activeMissionId = missionId;
  activeMissionPrimary = primaryId ?? activeMissionPrimary ?? mission.primaryId;
  lastSelection = null;
  const stage = stageDefFromId(mission.stageId) ?? stageById(mission.stageId);
  launch({
    stage,
    mode: 'story',
    primaryId: activeMissionPrimary,
    attachments: [],
    grenade: 'frag',
    difficulty: mission.difficulty,
    durationS: mission.durationS,
    mission,
    // R53-W2 M2b: ブリーフィング難易度(MN2凍結契約。undefined=normal扱い)
    missionDifficulty,
    // ★V一括修正: 帝王システムはストーリーでも発動する(c10はfists支給)ため、
    // 刀身雷脈の生涯累計はミッション経路にも供給する
    kokuraiKillsBase: profile.kokuraiKillsTotal ?? 0,
  });
}

// ── R54-F7 フォトモード遷移 ─────────────────────────────────────────
// 入場はポーズ画面のボタンのみ。試合は main が update()/frame() を呼ばないことで
// 「構造的に」凍結する(物理/AI/弾は進まない)。render() だけ再開して自由カメラで映す。
function enterPhoto(): void {
  if (!match || mode !== 'paused') return;
  mode = 'photo';
  menu.hide();
  hud.hide(); // HUDルートを非表示(ポーズ復帰時に exitPhoto が戻す)
  photoMode = new PhotoMode({
    camera: match.camera,
    input,
    stageSize: match.stageSize,
    canvas: renderer.domElement,
    filterAvailable: match.photoFilterAvailable,
    setFilter: (m) => match?.setPhotoFilter(m),
    reduceMotion: effectiveReduceMotion(),
  });
  photoMode.enter();
  input.requestLock(renderer.domElement);
}

function exitPhoto(): void {
  if (!photoMode) return;
  photoMode.dispose(); // フィルタ0復帰+DOM解除+fov復元(姿勢は次のsyncCameraが取り戻す)
  photoMode = null;
  // フォト中に押されたキーの立ち上がり残骸(SPACE=jump等)を再開後の試合へ漏らさない
  for (const a of ['jump', 'crouch', 'sprint', 'forward', 'back', 'left', 'right',
    'weapon1', 'weapon2', 'grenade', 'streak1', 'streak2', 'interact'] as const) {
    input.wasPressed(a);
  }
  hud.show();
  mode = 'paused';
  menu.showPause();
}

const menuCallbacks: MenuCallbacks = {
  onStart: startMatch,
  onStartMission: startMission,
  onResume: () => {
    sounds.ensure();
    input.requestLock(renderer.domElement);
  },
  onRestart: () => {
    if (activeMissionId) startMission(activeMissionId);
    else if (lastSelection) startMatch(lastSelection);
  },
  onQuit: () => {
    match?.dispose();
    match = null;
    sounds.quiesce(); // 音の後始末を単一路に集約(残響テール/BGM/環境音/瀕死こもり)
    hud.hide();
    mode = 'menu';
    spaceBg?.start(); // メニューへ戻ったら宇宙背景を再開
    menu.showMain();
  },
  onPhoto: () => enterPhoto(),
  onSettingsChanged: () => {
    sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi, settings.musicVolume, settings.voVolume);
    applyUiScale();
    applyAccent();
    applyMotion();
    input.setGamepadBindings(settings.gamepadBindings);
    input.setVibration(settings.gamepadVibration);
    sounds.setMusicEnabled(settings.musicEnabled);
  },
};
const menu: MenuApi = USE_UI2
  ? new Menu2(menuRoot, settings, profile, menuCallbacks, input)
  : new Menu(menuRoot, settings, profile, menuCallbacks, input);

// 初回はメニュー表示なので宇宙背景を起動する(ui2ではspaceBg=nullのため自然に不使用)
spaceBg?.start();
// メニューへ宇宙背景を渡す(ページ連動カメラ/DoF風/初回focus即送出はattachBg内で駆動)
if (spaceBg) menu.attachBg(spaceBg);

input.onLockChange((locked) => {
  // R54-F7: フォトモード中のロック離脱(ESC)=フォト終了→ポーズへ復帰
  if (!locked && mode === 'photo') {
    exitPhoto();
    return;
  }
  // ファイナルキルカム中はロック離脱でもポーズしない(再生を継続させる)
  if (!locked && mode === 'playing' && match && !match.over) {
    mode = 'paused';
    menu.showPause();
  } else if (locked && mode === 'paused') {
    mode = 'playing';
    menu.hide();
  }
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (match) match.resize(window.innerWidth, window.innerHeight);
});

// タブ非表示中はRAFが止まりループ経由のpauseAmbienceが届かないため、ここで直接沈める。
// 復帰時はループの既存配線(playing中はpauseAmbience(false))が次フレームで戻す
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sounds.pauseAmbience(true); sounds.pauseCombatLoops(true); }
});

// R12軽量化(適応DPR): フレーム時間のEMAを取り、重い時に実解像度を段階的に下げてfps床を維持。
// 3段([1.0,0.85,0.72])・ヒステリシス・変更間隔≥1秒でRT再確保のバタつきを防ぐ
const DPR_STEPS = [1, 0.85, 0.72] as const;
let frameEma = 0.0166; // 秒(初期60fps相当)
let bestFrame = 0.0166; // 観測フロア(表示周期/GPU余力の推定)。速い時は素早く追従・遅い時は緩慢
let dprStep = 0; // DPR_STEPS のインデックス
let lastDprChangeMs = 0;
function adaptResolution(dt: number, nowMs: number): void {
  if (!match || mode !== 'playing') return;
  frameEma += (dt - frameEma) * 0.06; // ~0.5s平滑
  bestFrame += (dt - bestFrame) * (dt < bestFrame ? 0.3 : 0.002); // フロア追従(速く沈み遅く浮く)
  if (nowMs - lastDprChangeMs < 1000) return; // 再確保は1秒に1回まで
  // 降格は「絶対しきい(>18ms)」かつ「自身のフロア比1.35超(=GPU律速の悪化)」の両立時のみ。
  // 30Hzパネル/rAFスロットル(表示律速)では frameEma≈bestFrame で発火せず最小固定を回避
  if (frameEma > 0.018 && frameEma > bestFrame * 1.35 && dprStep < DPR_STEPS.length - 1) {
    dprStep += 1;
    lastDprChangeMs = nowMs;
    match.setResolutionScale(DPR_STEPS[dprStep]!);
  } else if (frameEma < 0.013 && dprStep > 0) {
    dprStep -= 1; // 十分軽い(<13ms)→1段戻す
    lastDprChangeMs = nowMs;
    match.setResolutionScale(DPR_STEPS[dprStep]!);
  }
}

/** リザルト画面へ遷移する共通処理(通常終了 / ファイナルキルカム後のどちらからも呼ぶ) */
function showResult(): void {
  mode = 'result';
  hud.hide();
  const result = match!.result();
  if (activeMissionId) {
    const ms = match!.missionSummary();
    if (ms) {
      // ストーリーモードは常に非ゾンビ → XP_MUL_NORMAL
      const cp = applyCampaignMission(profile, ms, XP_MUL_NORMAL);
      saveProfile(profile);
      menu.showMissionResult(result, cp);
    } else {
      // ストーリー途中離脱のフォールバック(非ゾンビ → XP_MUL_NORMAL)
      menu.showResult(result, applyMatch(profile, result.summary, XP_MUL_NORMAL));
    }
  } else {
    const isZombie = lastSelection?.mode === 'zombie';
    // R35: ゾンビ×25 / 通常×500(progression.tsの定数)。超鬼畜モードはさらに×2
    // (旧spec「通常50→鬼畜100」の比率を新基礎値に対して維持)
    const isHell = lastSelection?.hellMode === true;
    const xpMul = (isZombie ? XP_MUL_ZOMBIE : XP_MUL_NORMAL) * (isHell ? 100 : 1);
    const isScore = lastSelection?.mode === 'score';
    const summary = isScore ? { ...result.summary, rated: false } : result.summary;
    const progress = applyMatch(profile, summary, xpMul, lastSelection?.mode);
    if (isScore && lastSelection) {
      applyScoreRecord(profile, `score:${lastSelection.stageId}`, result.summary.kills);
    }
    saveProfile(profile);
    menu.showResult(result, progress);
  }
}

// ── ?perfhud=1: 軽量な自己計測オーバーレイ(既定OFF・出荷安全) ─────────────────
// R53 T5: 軽量化計画(perf work)の前提となるフレームタイム計測ハーネス。
// クエリが無ければ PERFHUD_ON=false のままで、リングバッファ書き込み含め
// 以下のperfhud関連コードは一切実行されない(DOM生成もされない)。
const PERFHUD_ON = new URLSearchParams(window.location.search).get('perfhud') === '1';
const PERFHUD_BUF_SIZE = 256;
const perfhudBuf = PERFHUD_ON ? new Float32Array(PERFHUD_BUF_SIZE) : null;
let perfhudIdx = 0;
let perfhudFilled = 0;
let perfhudAcc = 0;
// ゾンビ戦の参考値: レーダー可視(radarEnabled設定+射程+LOS)な敵数の概算。
// 真の総alive数はmatch.tsに専用アクセサが無いため未提供(-1=非対象/非表示)。
let perfhudZombieRound = -1;
let perfhudZombieVisible = -1;
let perfhudEl: HTMLDivElement | null = null;
if (PERFHUD_ON) {
  perfhudEl = document.createElement('div');
  perfhudEl.id = 'perfhud';
  document.body.appendChild(perfhudEl);
}

// rAF実dtをリングバッファへ積み、0.5秒ごとにp50/p95・draw call数・(ゾンビ戦なら)
// 参考alive数をDOMへ書き戻す。バッファ書き込み自体はO(1)で毎フレームのコストは無視できる。
function perfhudSample(realDtS: number): void {
  if (!perfhudBuf || !perfhudEl) return;
  perfhudBuf[perfhudIdx] = realDtS * 1000;
  perfhudIdx = (perfhudIdx + 1) % PERFHUD_BUF_SIZE;
  if (perfhudFilled < PERFHUD_BUF_SIZE) perfhudFilled++;
  perfhudAcc += realDtS;
  if (perfhudAcc < 0.5) return;
  perfhudAcc = 0;
  const n = perfhudFilled;
  const sorted = Array.from(perfhudBuf.subarray(0, n)).sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
  const calls = renderer.info.render.calls;
  const zLine = perfhudZombieRound >= 0 ? `\nZ R${perfhudZombieRound} VIS${perfhudZombieVisible}` : '';
  perfhudEl.textContent = `p50 ${pct(0.5).toFixed(2)}ms  p95 ${pct(0.95).toFixed(2)}ms\ncalls ${calls}${zLine}`;
}

const loop = new GameLoop(
  (dt) => {
    if (mode === 'playing' && match) match.update(dt);
  },
  (dt) => {
    if (PERFHUD_ON) perfhudSample(dt);
    // Options(ゲームパッド)で一時停止/再開。pointer lock のジェスチャ制約で
    // 再開はベストエフォート(失敗時はクリックで再開できる)
    // finalkillcam 中は pause ボタンをスキップとして下のブロックで使うため、ここでは消費しない
    if (mode !== 'finalkillcam' && input.consumePausePressed()) {
      // R54-F7: フォト中のOptionsはロック解除=フォト終了(onLockChangeがポーズへ戻す)
      if (mode === 'playing' || mode === 'photo') input.exitLock();
      else if (mode === 'paused') input.requestLock(renderer.domElement);
    }
    // メニュー(トップページ含む)をコントローラだけで操作する
    const nav = input.consumeUiNav();
    if (mode !== 'playing' && mode !== 'photo') menu.handleGamepad(nav);
    if (match) {
      // match.over の検出を frame() より前に持ち上げ、突入フレームで frame() を呼ばないことで
      // effects.update の二重呼び出し(frame 内 + advanceFinalKillcam 内)を防ぐ。
      // match.over は前フレームの frame() 内で true になるため、次フレーム冒頭で確実に捕捉できる。
      if (mode === 'playing' && match.over) {
        input.exitLock();
        sounds.stopAmbience(); // リザルト画面で戦場の環境音が鳴り続けないように
        // R19: ファイナルキルカムが適用できる試合かを確認してから分岐する
        if (match.startFinalKillcam()) {
          mode = 'finalkillcam';
          // R54-F7: シネマ帯バナー(最終キルの武器名+距離)を供給
          hud.showFinalKillcam(match.fkWeaponName, match.fkKillDistM);
          letterboxEl.style.opacity = '1';
        } else {
          showResult();
        }
      }
      // finalkillcam 中は advanceFinalKillcam が effects/atmosphere を自分で進めるので
      // frame() を呼ばない(effects.update の二重呼び出しによるトレーサー早期消滅を防ぐ)。
      // photo 中も呼ばない(完全凍結の静止画をカメラだけ動かして眺める仕様)
      if (mode !== 'finalkillcam' && mode !== 'photo') match.frame(dt, mode === 'playing');
      // 動的BGM/環境音: プレイ中だけ進める。ポーズは環境音を沈め、離脱で拍をリセット
      if (mode === 'playing') {
        sounds.tickBgm();
        sounds.tickAmbience();
        sounds.pauseAmbience(false);
        if (combatLoopsPaused) { sounds.pauseCombatLoops(false); combatLoopsPaused = false; }
      } else {
        sounds.stopBgm();
        if ((mode === 'paused' || mode === 'finalkillcam' || mode === 'photo') && !combatLoopsPaused) {
          sounds.pauseAmbience(true);
          sounds.pauseCombatLoops(true);
          combatLoopsPaused = true;
        }
        // perfhud: プレイ中でなければ前試合のゾンビ参考値を持ち越さない
        if (PERFHUD_ON) {
          perfhudZombieRound = -1;
          perfhudZombieVisible = -1;
        }
      }
      if (mode === 'playing') {
        const snap = match.snapshot();
        const uiW = window.innerWidth / settings.uiScale;
        const uiH = window.innerHeight / settings.uiScale;
        hud.update(
          snap,
          uiW,
          uiH,
          (world) => match!.projectToScreen(world, uiW, uiH),
          input.isDown('scoreboard'),
        );
        if (PERFHUD_ON) {
          perfhudZombieRound = snap.zombieRound ?? -1;
          perfhudZombieVisible = snap.zombieRound !== undefined ? snap.enemyBearings.length : -1;
        }
        // 被弾時の一瞬のクロマアベ(色相シフト)。競技性に配慮し省モーション時はスキップ
        if (snap.tookDamage && !effectiveReduceMotion()) {
          const el = renderer.domElement;
          el.style.transition = 'filter 0.15s';
          el.style.filter = 'saturate(1.8) hue-rotate(8deg)';
          if (chromaTimer) clearTimeout(chromaTimer);
          chromaTimer = window.setTimeout(() => {
            el.style.filter = 'none';
            chromaTimer = 0;
          }, 150);
        }
      }
      // R19: ファイナルキルカム再生フェーズ
      if (mode === 'finalkillcam') {
        // スキップ: スペース / ゲームパッドの任意ボタン(クリックはロック解除中のため非対応)
        const skipPressed =
          input.wasPressed('jump') ||
          input.consumePausePressed();
        const done = match.advanceFinalKillcam(dt) || skipPressed;
        // R53: ファイナルキルカムは三人称固定(R48)のためスコープ表示経路は撤去済み
        // (旧 match.fkScopeInfo 消費 → hud.updateFinalKillcam(flash, adsRatio, isScope))。
        hud.updateFinalKillcam(match.fkFlash);
        if (done) {
          letterboxEl.style.opacity = '0';
          hud.hideFinalKillcam();
          showResult();
        }
      }
      // R17: ポーズ/リザルト中はゲームを再描画しない(直前フレームで画面が静止する)。
      // ライブなWebGLキャンバスの上にポーズ幕の backdrop-filter が載ると、明るい空の
      // ステージで白く破綻する既知の禁止パターン(=白飛びバグ)を根絶する。GPUも節約。
      // R19: ファイナルキルカム中も描画継続する(再生映像のため必須)。
      // R54-F7: photo は update/frame 停止のまま render のみ再開(R17ゲートへの意図的追加)
      if (mode === 'playing' || mode === 'finalkillcam' || mode === 'photo') {
        if (mode === 'playing') adaptResolution(dt, performance.now());
        if (mode === 'photo') photoMode?.frame(dt); // 自由飛行カメラ(移動+視点)
        match.render();
        // キャプチャは render と同一タスク内が絶対条件(photo.ts afterRender の規約コメント参照)
        if (mode === 'photo') photoMode?.afterRender();
      }
    }
    input.endFrame();
  },
  (dt) => input.pollGamepad(dt, gamepadCfg(settings)),
);
loop.start();
