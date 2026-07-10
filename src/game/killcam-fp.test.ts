// R55 ④: ラストキルカム一人称化(killer=プレイヤー)の回帰テスト。
// (1) fkFirstPersonCam: 純粋関数の契約ピン(rotation/fov が入力どおりに素通しされること)。
// (2) KillcamController 統合: 録画済みバッファから一人称カメラ姿勢が正しく組まれ、
//     武器viewmodelの可視制御(setViewmodelVisible)が killer 種別で正しく呼び分けられること。
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KillcamController, fkFirstPersonCam, type KillcamDeps } from './killcam';
import type { Player } from './player';

describe('fkFirstPersonCam(純粋関数)', () => {
  it('position/rotation.y/rotation.x/rotation.z/fov が入力どおりに素通しされる', () => {
    const pose = fkFirstPersonCam(1.5, 1.7, -3.2, 0.42, -0.13, 68);
    expect(pose.x).toBe(1.5);
    expect(pose.y).toBe(1.7);
    expect(pose.z).toBe(-3.2);
    expect(pose.rotY).toBe(0.42); // yaw
    expect(pose.rotX).toBe(-0.13); // pitch
    expect(pose.rotZ).toBe(0); // 微小leanは無視(設計合意)
    expect(pose.fov).toBe(68);
  });

  it('ckFovAt 等の人工ランプを一切足さない(fov=録画値そのまま、範囲外の値でも素通し)', () => {
    // 録画fovがCK基準(50)から外れていても、そのまま返す(演出的な補正はしない契約)
    expect(fkFirstPersonCam(0, 0, 0, 0, 0, 30).fov).toBe(30);
    expect(fkFirstPersonCam(0, 0, 0, 0, 0, 90).fov).toBe(90);
  });

  it('yaw/pitchが0でもrotZは常に0を返す', () => {
    expect(fkFirstPersonCam(0, 0, 0, 0, 0, 60).rotZ).toBe(0);
  });
});

// ─── KillcamController 統合(録画バッファ→一人称カメラ姿勢の配線検証) ─────────────
function makeMockDeps(): {
  deps: KillcamDeps;
  camera: THREE.PerspectiveCamera;
  player: { eyePosition: THREE.Vector3; yaw: number; pitch: number; alive: boolean };
  visibleCalls: boolean[];
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 800);
  camera.rotation.order = 'YXZ';
  const player = { eyePosition: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 0, alive: true };
  const visibleCalls: boolean[] = [];
  const deps: KillcamDeps = {
    getScene: () => scene,
    getCamera: () => camera,
    getAllyColor: () => 0xffffff,
    getPlayer: () => player as unknown as Player,
    getBots: () => [],
    getAdsProgress: () => 0,
    isZombie: () => false,
    playHit: () => {},
    reduceMotion: () => false,
    updateEffects: () => {},
    updateAtmosphere: () => {},
    tracer: () => {},
    blockedToMid: () => false,
    setViewmodelVisible: (v: boolean) => { visibleCalls.push(v); },
  };
  return { deps, camera, player, visibleCalls };
}

describe('KillcamController 一人称パス(fkKillerIsPlayer=true)', () => {
  it('録画済みの眼位置/yaw/pitch/fovへカメラ姿勢が一致し、setViewmodelVisible(true)が呼ばれる', () => {
    const { deps, camera, player, visibleCalls } = makeMockDeps();
    const controller = new KillcamController(deps);

    // 過去フレームを複数記録(canStart のバッファ窓ガードを満たすため)
    for (let e = 0; e <= 4.75; e += 0.25) {
      player.eyePosition.set(1, 2, 3);
      player.yaw = 0.1;
      player.pitch = -0.05;
      camera.fov = 50;
      controller.recordFrame(e);
    }
    // キル瞬間フレーム(elapsed=5.0)を既知の値で記録
    const killT = 5.0;
    player.eyePosition.set(10, 2, -4);
    player.yaw = 1.2;
    player.pitch = -0.3;
    camera.fov = 55;
    controller.recordFrame(killT);

    controller.noteKill(true, -1, 0, killT, 'TestGun', 12);
    expect(controller.canStart(killT)).toBe(true);
    // noteKill が即座に firstPerson を確定させる(begin() 前でも反映済み)
    expect(controller.firstPerson).toBe(true);

    controller.begin();
    expect(controller.firstPerson).toBe(true);
    expect(controller.playing).toBe(true);
    // begin() 時点で一人称=viewmodel表示のtrueが積まれている
    expect(visibleCalls).toContain(true);
    expect(camera.rotation.order).toBe('YXZ');

    // advance を1/60刻みで進め、カーソルが killT へ正確に着地するフレームを探す
    // (reduceMotion=false のため ckCursorStep がキル瞬間を跨ぐフレームで killT へ着地する)
    let landedAtKill = false;
    for (let i = 0; i < 600 && controller.playing; i++) {
      controller.advance(1 / 60);
      // 着地直後は t=0 補間(bestA=bestB=killTフレーム)になり録画値と厳密一致するはず
      if (Math.abs(camera.position.x - 10) < 1e-6 && Math.abs(camera.position.z - (-4)) < 1e-6) {
        landedAtKill = true;
        expect(camera.position.y).toBeCloseTo(2, 6);
        expect(camera.rotation.y).toBeCloseTo(1.2, 6);
        expect(camera.rotation.x).toBeCloseTo(-0.3, 6);
        expect(camera.rotation.z).toBe(0);
        expect(camera.fov).toBeCloseTo(55, 6);
        break;
      }
    }
    expect(landedAtKill).toBe(true);

    // アバターは一人称では一切生成されない(3人称専用の演出のため)
    expect(sceneHasAvatar(deps)).toBe(false);
  });

  it('killer=bot(三人称)は setViewmodelVisible(false) が呼ばれ、カメラはプレイヤー眼位置に一致しない', () => {
    const { deps, camera, player, visibleCalls } = makeMockDeps();
    const controller = new KillcamController(deps);

    for (let e = 0; e <= 5.0; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0);
      player.yaw = 0;
      player.pitch = 0;
      camera.fov = 50;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    controller.noteKill(false, -1, -1, killT, 'BotGun', 8); // bot killer, victim=プレイヤー(-1)
    expect(controller.canStart(killT)).toBe(true);

    controller.begin();
    expect(controller.firstPerson).toBe(false);
    expect(visibleCalls).toContain(false);
    expect(visibleCalls).not.toContain(true);

    controller.advance(1 / 60);
    // 三人称シネマカメラは lookAt ベース(rotation.order の 'YXZ' 個別代入ではない)なので
    // rotation.y が player.yaw(0)と厳密一致することは基本的にない(カメラは別位置にいる)
    expect(camera.position.equals(player.eyePosition)).toBe(false);
  });
});

// KillcamController 内部で fkAvatarGroup を scene.add しているかを外側から確認するヘルパー。
function sceneHasAvatar(deps: KillcamDeps): boolean {
  return deps.getScene().children.length > 0;
}

// ─── R55 W-C4 [3]: 一人称キルカムのスコープADS退避ポーズ露出根治(回帰テスト) ─────────────
// begin() の一人称分岐が resetViewmodelAdsPose を setViewmodelVisible(true) より先に呼ぶこと、
// および未提供(undefined)でも例外を投げず安全にフォールバックすることをピン留めする。
describe('KillcamController 一人称パス: resetViewmodelAdsPose(スコープ退避ポーズ根治)', () => {
  function recordMinimalHistory(controller: KillcamController, player: { eyePosition: THREE.Vector3; yaw: number; pitch: number }, camera: THREE.PerspectiveCamera): number {
    for (let e = 0; e <= 5.0; e += 0.25) {
      player.eyePosition.set(1, 2, 3);
      player.yaw = 0;
      player.pitch = 0;
      camera.fov = 50;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    controller.noteKill(true, -1, 0, killT, 'ScopeGun', 30);
    return killT;
  }

  it('一人称begin()は resetViewmodelAdsPose を setViewmodelVisible(true) より前に呼ぶ', () => {
    const { deps, camera, player } = makeMockDeps();
    const callOrder: string[] = [];
    const depsWithReset: KillcamDeps = {
      ...deps,
      resetViewmodelAdsPose: () => { callOrder.push('reset'); },
      setViewmodelVisible: (v: boolean) => { callOrder.push(v ? 'visible:true' : 'visible:false'); },
    };
    const controller = new KillcamController(depsWithReset);
    const killT = recordMinimalHistory(controller, player, camera);
    expect(controller.canStart(killT)).toBe(true);

    controller.begin();

    expect(callOrder).toContain('reset');
    expect(callOrder).toContain('visible:true');
    expect(callOrder.indexOf('reset')).toBeLessThan(callOrder.indexOf('visible:true'));
  });

  it('resetViewmodelAdsPose が未提供(undefined)でも begin() は例外を投げず setViewmodelVisible(true) は呼ばれる', () => {
    const { deps, camera, player, visibleCalls } = makeMockDeps(); // resetViewmodelAdsPose 未定義
    const controller = new KillcamController(deps);
    const killT = recordMinimalHistory(controller, player, camera);
    expect(controller.canStart(killT)).toBe(true);

    expect(() => controller.begin()).not.toThrow();
    expect(visibleCalls).toContain(true);
    expect(controller.playing).toBe(true);
  });

  it('killer=bot(三人称)では resetViewmodelAdsPose は呼ばれない(setViewmodelVisible(false)経路)', () => {
    const { deps, camera, player } = makeMockDeps();
    const resetCalls: number[] = [];
    const depsWithReset: KillcamDeps = {
      ...deps,
      resetViewmodelAdsPose: () => { resetCalls.push(1); },
    };
    const controller = new KillcamController(depsWithReset);
    for (let e = 0; e <= 5.0; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0);
      player.yaw = 0;
      player.pitch = 0;
      camera.fov = 50;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    controller.noteKill(false, -1, -1, killT, 'BotGun', 8);
    expect(controller.canStart(killT)).toBe(true);

    controller.begin();

    expect(controller.firstPerson).toBe(false);
    expect(resetCalls.length).toBe(0);
  });
});
