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

// ─── R55 W-C5 [6]: 決着キル瞬間が非FPS視点(RC-XD操縦中等)だった場合の三人称フォールバック ───
describe('KillcamController: 決着キル瞬間が非FPS視点だった場合(killer=プレイヤーでも三人称へフォールバック)', () => {
  it('RC-XD操縦中に決着キルが発生(killer=プレイヤー)すると、凍結された一人称値ではなく三人称シネマへフォールバックする', () => {
    const { deps, camera, player, visibleCalls } = makeMockDeps();
    let fpsView = true;
    const depsFallback: KillcamDeps = {
      ...deps,
      isFpsView: () => fpsView,
    };
    const controller = new KillcamController(depsFallback);

    // 通常プレイ(一人称視点)の履歴を記録
    for (let e = 0; e <= 4.0; e += 0.25) {
      fpsView = true;
      player.eyePosition.set(5, 2, 1);
      player.yaw = 0.2; player.pitch = -0.1; camera.fov = 60;
      controller.recordFrame(e);
    }
    // キル直前~キル瞬間はRC-XD操縦中(カメラは別システム所有=非FPS視点)。
    // recordFrameはこの間 fkLast*(凍結保持値)のまま記録する。
    const killT = 5.0;
    for (let e = 4.25; e <= killT; e += 0.25) {
      fpsView = false;
      // 生カメラ値は変えても記録には反映されない(recordFrameのゲートで凍結保持されるはず)
      player.eyePosition.set(99, 99, 99);
      player.yaw = 3.0; player.pitch = 1.0; camera.fov = 80;
      controller.recordFrame(e);
    }

    controller.noteKill(true, -1, 0, killT, 'RcxdBlast', 20);
    expect(controller.canStart(killT)).toBe(true);
    // noteKill直後は生のkillerIsPlayer値を即時反映する(begin()前の既存契約)
    expect(controller.firstPerson).toBe(true);

    controller.begin();

    // begin()がキル瞬間フレームの非FPS視点を検出し、一人称ではなく三人称シネマへ確定する
    expect(controller.firstPerson).toBe(false);
    expect(controller.playing).toBe(true);
    // 三人称パス: viewmodel非表示 + プレイヤーアバターがsceneへ追加される
    expect(visibleCalls).toContain(false);
    expect(sceneHasAvatar(deps)).toBe(true);

    controller.advance(1 / 60);
    // 三人称シネマカメラは凍結された一人称眼位置(99,99,99)には一致しない
    expect(camera.position.x).not.toBeCloseTo(99, 3);
  });

  it('RC-XDフォールバック時は resetViewmodelAdsPose を呼ばない(一人称専用フックのため)', () => {
    const { deps, camera, player } = makeMockDeps();
    let fpsView = true;
    const resetCalls: unknown[] = [];
    const depsFallback: KillcamDeps = {
      ...deps,
      isFpsView: () => fpsView,
      resetViewmodelAdsPose: (r?: number) => { resetCalls.push(r); },
    };
    const controller = new KillcamController(depsFallback);
    for (let e = 0; e <= 4.0; e += 0.25) {
      fpsView = true;
      player.eyePosition.set(1, 2, 3); player.yaw = 0; player.pitch = 0; camera.fov = 50;
      controller.recordFrame(e);
    }
    const killT = 4.5;
    for (let e = 4.25; e <= killT; e += 0.25) {
      fpsView = false;
      controller.recordFrame(e);
    }
    controller.noteKill(true, -1, 0, killT, 'RcxdBlast', 15);
    expect(controller.canStart(killT)).toBe(true);

    controller.begin();

    expect(controller.firstPerson).toBe(false);
    expect(resetCalls.length).toBe(0);
  });

  it('RC-XDがキル前に終了し、キル瞬間フレームは一人称視点に復帰していれば一人称のまま再生する', () => {
    const { deps, camera, player, visibleCalls } = makeMockDeps();
    let fpsView = true;
    const depsFallback: KillcamDeps = {
      ...deps,
      isFpsView: () => fpsView,
    };
    const controller = new KillcamController(depsFallback);

    for (let e = 0; e <= 2.0; e += 0.25) {
      fpsView = true;
      player.eyePosition.set(1, 2, 3); player.yaw = 0; player.pitch = 0; camera.fov = 50;
      controller.recordFrame(e);
    }
    // 2.25〜3.0だけ一時的にRC-XD(非FPS視点)、その後キルまでに一人称へ復帰
    for (let e = 2.25; e <= 3.0; e += 0.25) {
      fpsView = false;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    for (let e = 3.25; e <= killT; e += 0.25) {
      fpsView = true;
      player.eyePosition.set(7, 2, -2); player.yaw = 0.4; player.pitch = -0.2; camera.fov = 45;
      controller.recordFrame(e);
    }

    controller.noteKill(true, -1, 0, killT, 'BackToFps', 10);
    expect(controller.canStart(killT)).toBe(true);
    controller.begin();

    // キル瞬間フレームは一人称視点に復帰済みのため、一人称パスが確定する
    expect(controller.firstPerson).toBe(true);
    expect(visibleCalls).toContain(true);
    expect(sceneHasAvatar(deps)).toBe(false);
  });
});

// ─── 一人称キルカメラ: 録画ADSを毎フレーム再生し、決着時スコープ固定を根絶 ───
describe('KillcamController: 一人称キルカメラのADS率を時間軸どおり再生する', () => {
  it('再生窓先頭はヒップから始まり、決着キル瞬間には録画済みADS率へ到達する', () => {
    const { deps, camera, player } = makeMockDeps();
    let ads = 0;
    const replayCalls: number[] = [];
    const depsWithAds: KillcamDeps = {
      ...deps,
      getAdsProgress: () => ads,
      updateViewmodelReplayPose: (r: number) => { replayCalls.push(r); },
    };
    const controller = new KillcamController(depsWithAds);

    for (let e = 0; e <= 4.75; e += 0.25) {
      ads = 0; // ヒップ撃ちの履歴
      player.eyePosition.set(5, 2, 1); player.yaw = 0.2; player.pitch = -0.1; camera.fov = 60;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    ads = 0.75; // 決着キル瞬間はスコープADS中(FOVもズームしている想定)
    player.eyePosition.set(5, 2, 1); player.yaw = 0.2; player.pitch = -0.1; camera.fov = 25;
    controller.recordFrame(killT);

    controller.noteKill(true, -1, 0, killT, 'ScopeGun', 40);
    expect(controller.canStart(killT)).toBe(true);
    controller.begin();

    expect(controller.firstPerson).toBe(true);
    // 再生窓の先頭(キル約2.5秒前)は録画どおりヒップ。キル瞬間の値で固定開始しない。
    expect(replayCalls[0]).toBeCloseTo(0, 6);
    let landedAtKill = false;
    for (let i = 0; i < 600 && controller.playing; i += 1) {
      controller.advance(1 / 60);
      if (Math.abs(camera.fov - 25) < 1e-6) {
        landedAtKill = true;
        break;
      }
    }
    expect(landedAtKill).toBe(true);
    expect(replayCalls.some((value) => Math.abs(value - 0.75) < 1e-6)).toBe(true);
  });

  it('ADS率0(ヒップ撃ち)の再生では全フレーム0のまま', () => {
    const { deps, camera, player } = makeMockDeps();
    const replayCalls: number[] = [];
    const depsWithAds: KillcamDeps = {
      ...deps,
      getAdsProgress: () => 0,
      updateViewmodelReplayPose: (r: number) => { replayCalls.push(r); },
    };
    const controller = new KillcamController(depsWithAds);
    for (let e = 0; e <= 5.0; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0); player.yaw = 0; player.pitch = 0; camera.fov = 50;
      controller.recordFrame(e);
    }
    const killT = 5.0;
    controller.noteKill(true, -1, 0, killT, 'HipGun', 3);
    expect(controller.canStart(killT)).toBe(true);
    controller.begin();
    for (let i = 0; i < 30; i += 1) controller.advance(1 / 60);

    expect(replayCalls.length).toBeGreaterThan(1);
    expect(replayCalls.every((value) => value === 0)).toBe(true);
  });
});

// ─── R56 W3 #4: begin() 直後の初回 advance() が再生窓開始(fkCursor)より前の
// ショットまで一斉再発火してしまうバグの回帰テスト ───────────────────────────
describe('KillcamController: begin()直後の初回advance()は再生窓開始より前のショットを再発火しない(#4)', () => {
  it('fkPrevCursorがfkCursor(再生窓開始)で初期化され、窓外の古いショットは初回advanceで発火しない', () => {
    const { deps, camera, player } = makeMockDeps();
    const tracerColors: number[] = [];
    const depsWithTracer: KillcamDeps = {
      ...deps,
      tracer: (_from, _to, color) => { tracerColors.push(color); },
    };
    const controller = new KillcamController(depsWithTracer);

    // killT=10, CK_WIN_PRE=2.5 なので再生窓は fkCursor=7.5 から始まる(oldest=0 のため)。
    for (let e = 0; e <= 10; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0); player.yaw = 0; player.pitch = 0; camera.fov = 50;
      controller.recordFrame(e);
    }
    // 再生窓(7.5以降)より大幅に前、バッファ先頭近くの古いショット。
    // 修正前(fkPrevCursor=-Infinity初期化)は初回advanceで一斉再発火していた。
    controller.recordShot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0xff0000, 1.0);
    // 再生窓の直後(将来 cursor が到達したときに初めて発火すべき)ショット。
    controller.recordShot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0x00ff00, 9.9);

    const killT = 10;
    controller.noteKill(false, -1, -1, killT, 'Gun', 5); // 三人称(killer=bot)経路
    expect(controller.canStart(killT)).toBe(true);

    controller.begin();
    // begin() 直後、fkPrevCursor は再生窓開始カーソル(fkCursor)に一致していること
    // (=-Infinity のままではないこと)を外側から検証する材料として、初回 advance の
    // 発火範囲で間接的に確認する。
    controller.advance(1 / 60);

    // 窓外の古いショット(t=1.0)は初回advanceで再発火してはいけない
    expect(tracerColors).not.toContain(0xff0000);
    // 窓開始直後まだ到達していない未来のショット(t=9.9)もまだ発火しない
    expect(tracerColors).not.toContain(0x00ff00);
  });

  it('再生窓開始(fkCursor)直後にあるショットはcursorが到達した時点で正しく発火する(回帰確認)', () => {
    const { deps, camera, player } = makeMockDeps();
    const tracerColors: number[] = [];
    const depsWithTracer: KillcamDeps = {
      ...deps,
      tracer: (_from, _to, color) => { tracerColors.push(color); },
    };
    const controller = new KillcamController(depsWithTracer);

    for (let e = 0; e <= 10; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0); player.yaw = 0; player.pitch = 0; camera.fov = 50;
      controller.recordFrame(e);
    }
    // fkCursor(=7.5)のわずか後。数フレームのadvanceでcursorが到達し、発火するはず。
    controller.recordShot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0x1234ff, 7.52);

    const killT = 10;
    controller.noteKill(false, -1, -1, killT, 'Gun', 5);
    expect(controller.canStart(killT)).toBe(true);
    controller.begin();

    let fired = false;
    for (let i = 0; i < 60 && !fired; i++) {
      controller.advance(1 / 60);
      if (tracerColors.includes(0x1234ff)) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('プレイヤー射撃だけが一人称viewmodelの発砲を再生し、bot射撃はトレーサーだけ再生する', () => {
    const { deps, camera, player } = makeMockDeps();
    let replayedShots = 0;
    const depsWithReplay: KillcamDeps = {
      ...deps,
      replayViewmodelShot: () => { replayedShots += 1; },
    };
    const controller = new KillcamController(depsWithReplay);
    for (let e = 0; e <= 10; e += 0.25) {
      player.eyePosition.set(0, 1.6, 0);
      player.yaw = 0;
      player.pitch = 0;
      camera.fov = 50;
      controller.recordFrame(e);
    }
    controller.recordShot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0xff0000, 7.52, false);
    controller.recordShot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0x00ff00, 7.54, true);
    controller.noteKill(true, -1, 0, 10, 'PlayerGun', 5);
    expect(controller.canStart(10)).toBe(true);
    controller.begin();
    for (let i = 0; i < 60 && replayedShots === 0; i += 1) controller.advance(1 / 60);
    expect(replayedShots).toBe(1);
  });
});
