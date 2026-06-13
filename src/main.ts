import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SoundKit } from './core/audio';
import { Input } from './core/input';
import { GameLoop } from './core/loop';
import { loadSettings } from './core/settings';
import { Match, type MatchConfig } from './game/match';
import { stageById } from './game/stages';
import { Hud } from './ui/hud';
import { Menu, type MenuSelection } from './ui/menu';

await RAPIER.init();

const appRoot = document.getElementById('app');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
if (!appRoot || !hudRoot || !menuRoot) throw new Error('マウント先の要素が見つからない');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appRoot.appendChild(renderer.domElement);

const settings = loadSettings();
const sounds = new SoundKit();
sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi);
const input = new Input();
input.attach(renderer.domElement);

const hud = new Hud(hudRoot);
let match: Match | null = null;
let mode: 'menu' | 'playing' | 'paused' | 'result' = 'menu';
let lastSelection: MenuSelection | null = null;

function startMatch(selection: MenuSelection): void {
  sounds.ensure();
  lastSelection = selection;
  match?.dispose();
  const config: MatchConfig = {
    stage: stageById(selection.stageId),
    primaryId: selection.primaryId,
    attachments: selection.attachments,
    grenade: selection.grenade,
    difficulty: selection.difficulty,
    durationS: 300,
  };
  match = new Match(config, settings, input, sounds, window.innerWidth / window.innerHeight);
  hud.reset();
  hud.show();
  menu.hide();
  mode = 'playing';
  input.requestLock(renderer.domElement);
}

const menu = new Menu(menuRoot, settings, {
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
    menu.showMain();
  },
  onSettingsChanged: () => {
    sounds.setVolumes(settings.volMaster, settings.volSfx, settings.volUi);
  },
});

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
        hud.update(
          snap,
          window.innerWidth,
          window.innerHeight,
          (world) => match!.projectToScreen(world, window.innerWidth, window.innerHeight),
          input.isDown('scoreboard'),
        );
        if (match.over) {
          mode = 'result';
          input.exitLock();
          hud.hide();
          menu.showResult(match.result());
        }
      }
      renderer.render(match.scene, match.camera);
    }
    input.endFrame();
  },
);
loop.start();
