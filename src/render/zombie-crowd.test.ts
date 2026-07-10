import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bot,
  DIFFICULTY,
  buildZombieCrowdGeometries,
  type BotContext,
  type ZombieCrowdPose,
} from '../game/bot';
import {
  ZOMBIE_CROWD_CAPACITY,
  ZombieCrowdRenderer,
  composeZombieCrowdMatrices,
  crowdGeometries,
  makeCrowdMatrices,
} from './zombie-crowd';

// R53-W3 ゾンビ群InstancedMesh化の受け入れゲート:
// 「実Bot(Object3D経路: syncMesh/updateDying)の各部位メッシュの matrixWorld」と
// 「composeZombieCrowdMatrices(行列合成経路)の出力」が全要素 1e-5(5桁)で一致すること。
// 歩行(walkPhase各位相)/よろめき/死亡buckle/転倒/visualLift(allGiant)/rigLiftYを網羅する。

beforeAll(async () => {
  await RAPIER.init();
});

function makeFlatWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0), floorBody);
  return world;
}

function makeZombie(world: RAPIER.World, scale = 1): Bot {
  return new Bot(
    world,
    'ゾンビ',
    new THREE.Vector3(0, 0, 0),
    0x39d465,
    { ...DIFFICULTY.normal, scale },
    2,
    'normal',
    'zombie',
  );
}

function walkCtx(): BotContext {
  return {
    targetEye: new THREE.Vector3(0, 1.5, -30),
    objective: null,
    tuning: DIFFICULTY.normal,
    rand: () => 0.5,
    onShoot: () => {},
    onMelee: () => {},
  };
}

const emptyPose = (): ZombieCrowdPose => ({
  x: 0,
  y: 0,
  z: 0,
  visualLift: 0,
  rigLiftY: 0,
  scale: 1,
  heading: 0,
  walkPhase: 0,
  walkAmp: 0,
  anim: 0,
  bobPhase: 0,
  dying01: 0,
  deathTilt: 0,
  visible: true,
  elite: false,
});

// 実Botのマージ済み部位メッシュを「親ノードの同一性」で分類する
// (body=rig直下 / arm=armRig直下 / thigh=legL・legR直下 / shin=kneeL・kneeR直下。
//  頂点数は家族間で一意でないため識別に使えない — 構造で分類するのが唯一確実)
interface BotRigInternals {
  rig: THREE.Group;
  armRig: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
}

interface FamilyWorld {
  body: THREE.Matrix4[]; // bodyArmor/bodyDark/bodyGlow(全てrig直下=同一行列のはず)
  arm: THREE.Matrix4[];
  thighL: THREE.Matrix4[];
  thighR: THREE.Matrix4[];
  shinL: THREE.Matrix4[];
  shinR: THREE.Matrix4[];
}

function collectFamilies(bot: Bot): FamilyWorld {
  const r = bot as unknown as BotRigInternals;
  const out: FamilyWorld = { body: [], arm: [], thighL: [], thighR: [], shinL: [], shinR: [] };
  bot.group.updateMatrixWorld(true);
  bot.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.parent === r.rig) out.body.push(o.matrixWorld.clone());
    else if (o.parent === r.armRig) out.arm.push(o.matrixWorld.clone());
    else if (o.parent === r.legL) out.thighL.push(o.matrixWorld.clone());
    else if (o.parent === r.legR) out.thighR.push(o.matrixWorld.clone());
    else if (o.parent === r.kneeL) out.shinL.push(o.matrixWorld.clone());
    else if (o.parent === r.kneeR) out.shinR.push(o.matrixWorld.clone());
  });
  return out;
}

function expectMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4, label: string): void {
  for (let i = 0; i < 16; i += 1) {
    expect(Math.abs(actual.elements[i]! - expected.elements[i]!), `${label}[${i}]`).toBeLessThan(1e-5);
  }
}

// 実Botの現在姿勢に対して compose を実行し、Object3D側の matrixWorld と比較する
function assertEquivalence(bot: Bot, label: string): void {
  const pose = emptyPose();
  bot.getCrowdPose(pose);
  expect(pose.visible, `${label}: visible`).toBe(true);
  const m = makeCrowdMatrices();
  composeZombieCrowdMatrices(pose, m);
  const fam = collectFamilies(bot);
  expect(fam.body.length, `${label}: body家族数`).toBe(3);
  expect(fam.arm.length, `${label}: arm家族数`).toBe(2);
  expect(fam.thighL.length, `${label}: thighL家族数`).toBe(1);
  expect(fam.thighR.length, `${label}: thighR家族数`).toBe(1);
  expect(fam.shinL.length, `${label}: shinL家族数`).toBe(1);
  expect(fam.shinR.length, `${label}: shinR家族数`).toBe(1);
  for (const bm of fam.body) expectMatrixClose(bm, m.body, `${label}:body`);
  for (const am of fam.arm) expectMatrixClose(am, m.arm, `${label}:arm`);
  expectMatrixClose(fam.thighL[0]!, m.thighL, `${label}:thighL`);
  expectMatrixClose(fam.thighR[0]!, m.thighR, `${label}:thighR`);
  expectMatrixClose(fam.shinL[0]!, m.shinL, `${label}:shinL`);
  expectMatrixClose(fam.shinR[0]!, m.shinR, `${label}:shinR`);
}

describe('buildZombieCrowdGeometries(正準ジオメトリ)', () => {
  it('7家族すべて非空で、属性構成が統一(position/normal/uv/color itemSize3)', () => {
    const g = buildZombieCrowdGeometries();
    const all = [g.bodyArmor, g.bodyDark, g.bodyGlow, g.armArmor, g.armDark, g.thigh, g.shin];
    for (const geo of all) {
      expect(geo.getAttribute('position').count).toBeGreaterThan(0);
      expect(geo.getAttribute('normal')).toBeDefined();
      expect(geo.getAttribute('uv')).toBeDefined();
      const color = geo.getAttribute('color') as THREE.BufferAttribute;
      expect(color).toBeDefined();
      expect(color.itemSize).toBe(3);
      expect(geo.index).toBeNull(); // mergeByMaterialはnon-indexedへ正規化する
    }
  });

  it('7家族の頂点数合計が個体経路の総頂点数と整合する(thigh/shinは左右で2回使用)', () => {
    const g = buildZombieCrowdGeometries();
    const countOf = (geo: THREE.BufferGeometry): number => geo.getAttribute('position').count;
    const canonicalTotal =
      countOf(g.bodyArmor) +
      countOf(g.bodyDark) +
      countOf(g.bodyGlow) +
      countOf(g.armArmor) +
      countOf(g.armDark) +
      countOf(g.thigh) * 2 +
      countOf(g.shin) * 2;
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    let botTotal = 0;
    bot.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        botTotal += (o.geometry as THREE.BufferGeometry).getAttribute('position').count;
      }
    });
    expect(botTotal).toBe(canonicalTotal);
  });

  it('決定論: 2回ビルドで頂点数と先頭要素が一致する', () => {
    const a = buildZombieCrowdGeometries();
    const b = buildZombieCrowdGeometries();
    const pa = a.bodyArmor.getAttribute('position') as THREE.BufferAttribute;
    const pb = b.bodyArmor.getAttribute('position') as THREE.BufferAttribute;
    expect(pa.count).toBe(pb.count);
    for (let i = 0; i < 30; i += 1) {
      expect(pa.array[i]).toBeCloseTo(pb.array[i] as number, 10);
    }
  });

  it('個体Object3D経路(buildZombieMesh)の部位メッシュ頂点数が正準と一致する(抽出の等価性)', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    const canon = crowdGeometries();
    const countOf = (g: THREE.BufferGeometry): number => g.getAttribute('position').count;
    const expected = [
      countOf(canon.bodyArmor),
      countOf(canon.bodyDark),
      countOf(canon.bodyGlow),
      countOf(canon.armArmor),
      countOf(canon.armDark),
      countOf(canon.thigh),
      countOf(canon.thigh),
      countOf(canon.shin),
      countOf(canon.shin),
    ].sort((x, y) => x - y);
    const actual: number[] = [];
    bot.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        actual.push((o.geometry as THREE.BufferGeometry).getAttribute('position').count);
      }
    });
    expect(actual.sort((x, y) => x - y)).toEqual(expected);
  });

  it('ボスゾンビは従来経路のまま(裂け目3枚が追加され、rig.scale=2.3が維持される)', () => {
    const world = makeFlatWorld();
    const boss = new Bot(
      world,
      'ボス',
      new THREE.Vector3(0, 0, 0),
      0xff2200,
      { ...DIFFICULTY.normal, maxHp: 3000 },
      1,
      'boss',
      'zombie',
    );
    let meshCount = 0;
    boss.group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBe(9 + 3); // 部位9 + 裂け目3
    const rig = (boss as unknown as { rig: THREE.Group }).rig;
    expect(rig.scale.x).toBeCloseTo(2.3, 10);
  });
});

describe('行列等価性(Object3D syncMesh/updateDying vs composeZombieCrowdMatrices)', () => {
  const dt = 1 / 60;

  it('歩行中の各位相で全部位が一致する(5桁精度)', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    bot.hordeRank = 0; // KCC/アニメを毎フレームフル解決(決定論)
    world.step();
    const ctx = walkCtx();
    for (let frame = 1; frame <= 60; frame += 1) {
      bot.update(dt, ctx);
      world.step();
      bot.syncMesh();
      if (frame % 12 === 0) assertEquivalence(bot, `walk-f${frame}`);
    }
  });

  it('死亡演出(膝崩れ→前傾横倒し)の各段階で一致する', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    bot.hordeRank = 0;
    world.step();
    const ctx = walkCtx();
    for (let frame = 0; frame < 30; frame += 1) {
      bot.update(dt, ctx);
      world.step();
      bot.syncMesh();
    }
    bot.takeDamage(99999);
    expect(bot.alive).toBe(false);
    // KIND_DEATH_S.zombie=0.6s=36フレーム。buckle段階(t≈0.22)と転倒段階(t≈0.83)を採点
    for (let frame = 1; frame <= 34; frame += 1) {
      bot.update(dt, ctx);
      bot.syncMesh();
      if (frame === 8 || frame === 20 || frame === 30) {
        assertEquivalence(bot, `dying-f${frame}`);
      }
    }
    // 演出終了後は非表示(pose.visible=false → 呼び出し側がスケール0行列にする)
    for (let frame = 0; frame < 6; frame += 1) bot.update(dt, ctx);
    const pose = emptyPose();
    bot.getCrowdPose(pose);
    expect(pose.visible).toBe(false);
  });

  it('allGiant(scale=1.35 + visualLift)でも一致する', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world, 1.35);
    bot.hordeRank = 0;
    world.step();
    const ctx = walkCtx();
    for (let frame = 1; frame <= 36; frame += 1) {
      bot.update(dt, ctx);
      world.step();
      bot.syncMesh();
      if (frame % 12 === 0) assertEquivalence(bot, `giant-f${frame}`);
    }
  });

  it('静止(walkAmp≈0)+初期姿勢でも一致する', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    world.step();
    bot.syncMesh();
    assertEquivalence(bot, 'rest');
  });
});

describe('Bot.setCrowdSlot(描画経路の切替)', () => {
  it('slot>=0でrig非表示、-1で復帰する', () => {
    const world = makeFlatWorld();
    const bot = makeZombie(world);
    const rig = (bot as unknown as { rig: THREE.Group }).rig;
    expect(bot.crowdSlot).toBe(-1);
    expect(rig.visible).toBe(true);
    bot.setCrowdSlot(5);
    expect(bot.crowdSlot).toBe(5);
    expect(rig.visible).toBe(false);
    bot.setCrowdSlot(-1);
    expect(rig.visible).toBe(true);
  });
});

describe('ZombieCrowdRenderer(スロット管理とGPUバッファ)', () => {
  it('acquire/releaseとcapacity満杯時の-1', () => {
    const scene = new THREE.Scene();
    const crowd = new ZombieCrowdRenderer(scene);
    const slots: number[] = [];
    for (let i = 0; i < ZOMBIE_CROWD_CAPACITY; i += 1) {
      const s = crowd.acquire();
      expect(s).toBeGreaterThanOrEqual(0);
      slots.push(s);
    }
    expect(new Set(slots).size).toBe(ZOMBIE_CROWD_CAPACITY);
    expect(crowd.acquire()).toBe(-1); // 満杯
    crowd.release(slots[3]!);
    expect(crowd.acquire()).toBe(slots[3]); // 解放スロットの再利用
    expect(crowd.activeCount()).toBe(ZOMBIE_CROWD_CAPACITY);
    crowd.dispose(scene);
  });

  it('poseが正しいインスタンス位置へ行列を書き、commitがcount/needsUpdateを立てる', () => {
    const scene = new THREE.Scene();
    const crowd = new ZombieCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    p.x = 3;
    p.y = 1;
    p.z = -2;
    crowd.pose(slot, p);
    crowd.commit();
    const internal = crowd as unknown as {
      bodyArmor: THREE.InstancedMesh;
      thigh: THREE.InstancedMesh;
    };
    const m = new THREE.Matrix4();
    internal.bodyArmor.getMatrixAt(slot, m);
    // 位置成分(elements[12..14])がgroup位置+rig(ボブ0で rigY≈0)に一致
    expect(m.elements[12]).toBeCloseTo(3, 5);
    expect(m.elements[14]).toBeCloseTo(-2, 5);
    expect(internal.bodyArmor.count).toBe(slot + 1);
    expect(internal.thigh.count).toBe((slot + 1) * 2);
    // needsUpdate は書き込み専用セッター(versionをインクリメント)— version>0 で転送予約を確認
    expect(internal.bodyArmor.instanceMatrix.version).toBeGreaterThan(0);
    crowd.dispose(scene);
  });

  it('release/非visibleでスケール0行列になる(描画されない)', () => {
    const scene = new THREE.Scene();
    const crowd = new ZombieCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    crowd.pose(slot, p);
    p.visible = false;
    crowd.pose(slot, p);
    const internal = crowd as unknown as { bodyArmor: THREE.InstancedMesh };
    const m = new THREE.Matrix4();
    internal.bodyArmor.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0);
    expect(m.elements[5]).toBe(0);
    expect(m.elements[10]).toBe(0);
    p.visible = true;
    crowd.pose(slot, p);
    internal.bodyArmor.getMatrixAt(slot, m);
    expect(m.elements[0]).not.toBe(0);
    crowd.release(slot);
    internal.bodyArmor.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0);
    crowd.dispose(scene);
  });

  it('elite色がinstanceColorへ反映される(通常=蛍光緑/精鋭=明緑)', () => {
    const scene = new THREE.Scene();
    const crowd = new ZombieCrowdRenderer(scene);
    const a = crowd.acquire();
    const b = crowd.acquire();
    const pn = emptyPose();
    const pe = emptyPose();
    pe.elite = true;
    crowd.pose(a, pn);
    crowd.pose(b, pe);
    const internal = crowd as unknown as { bodyArmor: THREE.InstancedMesh };
    const cn = new THREE.Color();
    const ce = new THREE.Color();
    internal.bodyArmor.getColorAt(a, cn);
    internal.bodyArmor.getColorAt(b, ce);
    expect(cn.getHex()).toBe(0x39d465);
    expect(ce.getHex()).toBe(0x5cffa8);
    crowd.dispose(scene);
  });

  it('disposeでシーンから7本すべて外れる', () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;
    const crowd = new ZombieCrowdRenderer(scene);
    expect(scene.children.length).toBe(before + 7);
    crowd.dispose(scene);
    expect(scene.children.length).toBe(before);
  });
});

// ★HF(R54): シャンブルポーズの前方性回帰テスト。R53以前から「前=+Z」前提で
// ポーズが作られており、実際の前方(-Z=顔/移動方向)と反転していた(後傾+腕が背後
// =「地面を滑っている」「腕が後ろ向き」のユーザー報告の根本原因)。
// 腕ジオメトリが -Z 側へ伸び、前傾が -Z へ倒れることを恒久固定する。
describe('シャンブルポーズの前方性(HF回帰)', () => {
  it('腕ジオメトリは前方(-Z)へ伸びる', () => {
    const geo = buildZombieCrowdGeometries();
    geo.armDark.computeBoundingBox();
    const bb = geo.armDark.boundingBox!;
    // 前腕+手はarmDark家族。手先が体の前(-Z)へ届いていること
    expect(bb.min.z).toBeLessThan(-0.3);
    // 背後(+Z)へは肩幅程度しかはみ出さない
    expect(bb.max.z).toBeLessThan(0.15);
  });

  it('生存時の前傾(rigRotX)は前方(-Z=負)へ倒れる', () => {
    const p = emptyPose();
    p.anim = 0;
    p.dying01 = 0;
    const m = makeCrowdMatrices();
    composeZombieCrowdMatrices(p, m);
    const e = new THREE.Euler().setFromRotationMatrix(m.body);
    expect(e.x).toBeLessThan(-0.15); // -(0.26±0.045)域
  });
});

