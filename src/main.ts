import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from './core/audio';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphicsTier === 'high' ? 2 : 1.5));
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
  });
}

// ストーリー・ミッションを起動する
function startMission(missionId: string): void {
  const mission = missionById(missionId);
  if (!mission) return;
  activeMissionId = missionId;
  lastSelection = null;
  const stage = stageDefFromId(mission.stageId) ?? stageById(mission.stageId);
  launch({
    stage,
    mode: 'story',
    primaryId: mission.primaryId,
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
      // 動的BGM: プレイ中だけ先読みスケジュール。離脱/ポーズで拍をリセット
      if (mode === 'playing') sounds.tickBgm();
      else sounds.stopBgm();
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
      match.render();
    }
    input.endFrame();
  },
  (dt) => input.pollGamepad(dt, gamepadCfg(settings)),
);
loop.start();
