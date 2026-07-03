import './style.css';
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
import { applyCampaignMission, applyMatch, applyScoreRecord } from './game/progression';
import { stageDefFromId } from './game/biomes';
import { stageById } from './game/stages';
import { Hud } from './ui/hud';
import { Menu, type MenuSelection } from './ui/menu';
import { SpaceBg } from './ui/menu-bg';

const appRoot = document.getElementById('app');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const spaceCanvas = document.getElementById('space-bg') as HTMLCanvasElement | null;
if (!appRoot || !hudRoot || !menuRoot) throw new Error('マウント先の要素が見つからない');

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
// AgX(ACESより ember/neon の色相を保つ)+ 線形→sRGB の物理ベース出力
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appRoot.appendChild(renderer.domElement);
const sounds = new SoundKit();
sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi);
const input = new Input();
input.attach(renderer.domElement);
input.setGamepadBindings(settings.gamepadBindings);
input.setVibration(settings.gamepadVibration);
sounds.setMusicEnabled(settings.musicEnabled);

const hud = new Hud(hudRoot);

// メニュー背景の宇宙(独立レンダラ)。WebGLが使えない環境では生成しない
const spaceBg = spaceCanvas ? new SpaceBg(spaceCanvas) : null;

// UIスケールはzoomで反映する。投影座標(ダメージ数値など)は
// ズーム後の座標系で算出するため、HUDへ渡す画面サイズも同じ倍率で割る
function applyUiScale(): void {
  hudRoot!.style.setProperty('zoom', String(settings.uiScale));
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
let mode: 'menu' | 'playing' | 'paused' | 'result' = 'menu';
let lastSelection: MenuSelection | null = null;
let activeMissionId: string | null = null; // ストーリー進行中のミッションID(なければ通常戦)

// 共通の出撃処理。configを組んでMatchを起動しHUD/ロックへ遷移する
function launch(config: MatchConfig): void {
  sounds.ensure();
  // reduceMotionは共有settingsを書き換えない(保存設定/SYSTEMチェックボックスの汚染防止)。
  // MatchはこれまでどおりsettingsのreduceMotion(アプリ設定)を参照する。OSのprefers-
  // reduced-motionはCSS(@media)側で尊重される
  // リスタート経路の二重起動防止→ステージの空間残響→環境音ベッドの順に音場を用意
  sounds.stopAmbience();
  // 適応DPRの状態を初期化(前試合の解像度スケール段を持ち越さない)。共有rendererの
  // pixelRatioも基準へ戻す(これを怠ると新試合のcomposerが低下値を継承し複利で劣化する)
  frameEma = 0.0166;
  bestFrame = 0.0166;
  dprStep = 0;
  renderer.setPixelRatio(BASE_DPR);
  sounds.setReverb(deriveReverbPreset(config.stage));
  // BGMをステージのムード別プロファイルへ(夜市yoichiのみネオン特化)。かっこいい軍事エレクトロニカ
  const bgmMood = resolveMood(config.stage.palette);
  const bgmKey: BgmProfileKey =
    bgmMood === 'night' && config.stage.id === 'yoichi' ? 'night-neon' : bgmMood;
  sounds.setMusicProfile(bgmKey);
  sounds.startAmbience(config.stage);
  match?.dispose();
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
  launch({
    stage,
    mode: selection.mode,
    primaryId: selection.primaryId,
    attachments: selection.attachments,
    grenade: selection.grenade,
    difficulty: selection.difficulty,
    durationS: settings.matchLengthS,
    scoreAttack: selection.mode === 'score',
    secondaryId: selection.secondaryId,
  });
}

// ストーリー・ミッションを起動する。武器は自由選択(省略時=支給武器)
let activeMissionPrimary: string | null = null; // リトライ時に選択武器を引き継ぐ
function startMission(missionId: string, primaryId?: string): void {
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
  });
}

const menu = new Menu(menuRoot, settings, profile, {
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
  onSettingsChanged: () => {
    sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi);
    applyUiScale();
    applyAccent();
    applyMotion();
    input.setGamepadBindings(settings.gamepadBindings);
    input.setVibration(settings.gamepadVibration);
    sounds.setMusicEnabled(settings.musicEnabled);
  },
}, input);

// 初回はメニュー表示なので宇宙背景を起動する
spaceBg?.start();
// メニューへ宇宙背景を渡す(ページ連動カメラ/DoF風/初回focus即送出はattachBg内で駆動)
if (spaceBg) menu.attachBg(spaceBg);

input.onLockChange((locked) => {
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
  if (document.hidden) sounds.pauseAmbience(true);
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

const loop = new GameLoop(
  (dt) => {
    if (mode === 'playing' && match) match.update(dt);
  },
  (dt) => {
    // Options(ゲームパッド)で一時停止/再開。pointer lock のジェスチャ制約で
    // 再開はベストエフォート(失敗時はクリックで再開できる)
    if (input.consumePausePressed()) {
      if (mode === 'playing') input.exitLock();
      else if (mode === 'paused') input.requestLock(renderer.domElement);
    }
    // メニュー(トップページ含む)をコントローラだけで操作する
    const nav = input.consumeUiNav();
    if (mode !== 'playing') menu.handleGamepad(nav);
    if (match) {
      match.frame(dt, mode === 'playing');
      // 動的BGM/環境音: プレイ中だけ進める。ポーズは環境音を沈め、離脱で拍をリセット
      if (mode === 'playing') {
        sounds.tickBgm();
        sounds.tickAmbience();
        sounds.pauseAmbience(false);
      } else {
        sounds.stopBgm();
        if (mode === 'paused') sounds.pauseAmbience(true);
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
        if (match.over) {
          mode = 'result';
          input.exitLock();
          sounds.stopAmbience(); // リザルト画面で戦場の環境音が鳴り続けないように
          hud.hide();
          const result = match.result();
          if (activeMissionId) {
            // ストーリー: ミッション進行を反映し、星・章解放つきの結果を出す
            const ms = match.missionSummary();
            if (ms) {
              const cp = applyCampaignMission(profile, ms);
              saveProfile(profile);
              menu.showMissionResult(result, cp);
            } else {
              menu.showResult(result, applyMatch(profile, result.summary));
            }
          } else {
            const isScore = lastSelection?.mode === 'score';
            // スコアアタックは自己ベスト用途。競技レートは動かさない(rated=false)
            const summary = isScore ? { ...result.summary, rated: false } : result.summary;
            const progress = applyMatch(profile, summary);
            if (isScore && lastSelection) {
              applyScoreRecord(profile, `score:${lastSelection.stageId}`, result.summary.kills);
            }
            saveProfile(profile);
            menu.showResult(result, progress);
          }
        }
      }
      adaptResolution(dt, performance.now());
      match.render();
    }
    input.endFrame();
  },
  (dt) => input.pollGamepad(dt, gamepadCfg(settings)),
);
loop.start();
