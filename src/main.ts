import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from './core/audio';
import { Input } from './core/input';
import { GameLoop } from './core/loop';
import { loadProfile, saveProfile } from './core/profile';
import { loadSettings } from './core/settings';
import { Match, type MatchConfig } from './game/match';
import { applyMatch } from './game/progression';
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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appRoot.appendChild(renderer.domElement);

const settings = loadSettings();
const profile = loadProfile();
const sounds = new SoundKit();
sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi);
const input = new Input();
input.attach(renderer.domElement);

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

function startMatch(selection: MenuSelection): void {
  sounds.ensure();
  lastSelection = selection;
  match?.dispose();
  const config: MatchConfig = {
    stage: stageById(selection.stageId),
    mode: selection.mode,
    primaryId: selection.primaryId,
    attachments: selection.attachments,
    grenade: selection.grenade,
    difficulty: selection.difficulty,
    durationS: settings.matchLengthS,
  };
  match = new Match(config, settings, input, sounds, window.innerWidth / window.innerHeight);
  hud.reset();
  hud.show();
  spaceBg?.stop(); // 出撃中はメニュー背景の宇宙レンダラを止める(RAF/GPU圧迫防止)
  menu.hide();
  mode = 'playing';
  input.requestLock(renderer.domElement);
}

const menu = new Menu(menuRoot, settings, profile, {
  onStart: startMatch,
  onResume: () => {
    sounds.ensure();
    input.requestLock(renderer.domElement);
  },
  onRestart: () => {
    if (lastSelection) startMatch(lastSelection);
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
  },
});

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
  if (match) {
    match.camera.aspect = window.innerWidth / window.innerHeight;
    match.camera.updateProjectionMatrix();
  }
});

const loop = new GameLoop(
  (dt) => {
    if (mode === 'playing' && match) match.update(dt);
  },
  (dt) => {
    if (match) {
      match.frame(dt, mode === 'playing');
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
          const progress = applyMatch(profile, result.summary);
          saveProfile(profile);
          menu.showResult(result, progress);
        }
      }
      renderer.render(match.scene, match.camera);
    }
    input.endFrame();
  },
);
loop.start();
