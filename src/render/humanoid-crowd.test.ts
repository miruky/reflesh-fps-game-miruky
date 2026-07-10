import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bot,
  DIFFICULTY,
  HUMANOID_CROWD_STYLE,
  buildHumanoidCrowdGeometries,
  type BotContext,
  type BotTier,
  type HumanoidCrowdPose,
} from '../game/bot';
import { makeCrowdMatrices } from './zombie-crowd';
import {
  HUMANOID_CROWD_CAPACITY,
  HumanoidCrowdRenderer,
  composeHumanoidCrowdMatrices,
  humanoidCrowdGeometries,
} from './humanoid-crowd';

// R54-W1(F4) humanoid群InstancedMesh化の受け入れゲート:
// 「実Bot(Object3D経路: syncMeshのhumanoid生存分岐)の各部位メッシュのmatrixWorld」と
// 「composeHumanoidCrowdMatrices(行列合成経路)の出力」が全要素 1e-5(5桁)で一致すること。
// 静止(呼吸)/歩行各位相/被弾のけぞり(flinch)/elite を網羅する。
// 死亡・FK・最近接8体(影)はslot解放でObject3D経路へ戻す設計のため、dying系の等価性は対象外。

beforeAll(async () => {
  await RAPIER.init();
});

function makeFlatWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0), floorBody);
  return world;
}

function makeSoldier(world: RAPIER.World, tier: BotTier = 'normal', color = 0xff8844): Bot {
  return new Bot(
    world,
    '兵士',
    new THREE.Vector3(0, 0, 0),
    color,
    { ...DIFFICULTY.normal },
    2,
    tier,
    'humanoid',
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

const emptyPose = (): HumanoidCrowdPose => ({
  x: 0,
  y: 0,
  z: 0,
  rigLiftY: 0,
  heading: 0,
  walkPhase: 0,
  walkAmp: 0,
  anim: 0,
  flinch: 0,
  glow: 0,
  elite: false,
  colorHex: 0xffffff,
  visible: true,
});

// 実Botのマージ済み部位メッシュを「親ノードの同一性」で分類する
// (body=rig直下 / arm=armRig直下 / thigh=legL・legR直下 / shin=kneeL・kneeR直下)
interface BotRigInternals {
  rig: THREE.Group;
  armRig: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  rigLiftY: number;
  walkPhase: number;
  walkAmp: number;
  anim: number;
  flinch: number;
  hitFlash: number;
  armorMat: THREE.MeshStandardMaterial;
}

interface FamilyWorld {
  body: THREE.Matrix4[]; // bodyArmor/bodyDark/bodyGlow(全てrig直下=同一行列のはず)
  arm: THREE.Matrix4[]; // armArmor/armDark/armGun
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
  bot.getHumanoidCrowdPose(pose);
  expect(pose.visible, `${label}: visible`).toBe(true);
  const m = makeCrowdMatrices();
  composeHumanoidCrowdMatrices(pose, m);
  const fam = collectFamilies(bot);
  expect(fam.body.length, `${label}: body家族数`).toBe(3);
  expect(fam.arm.length, `${label}: arm家族数`).toBe(3);
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

describe('buildHumanoidCrowdGeometries(正準ジオメトリ)', () => {
  it('8家族すべて非空で、属性構成が統一(position/normal/uv/color itemSize3)', () => {
    const g = buildHumanoidCrowdGeometries();
    const all = [g.bodyArmor, g.bodyDark, g.bodyGlow, g.armArmor, g.armDark, g.armGun, g.thigh, g.shin];
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

  it('8家族の頂点数合計が個体経路の総頂点数と整合する(thigh/shinは左右で2回使用)', () => {
    const g = buildHumanoidCrowdGeometries();
    const countOf = (geo: THREE.BufferGeometry): number => geo.getAttribute('position').count;
    const canonicalTotal =
      countOf(g.bodyArmor) +
      countOf(g.bodyDark) +
      countOf(g.bodyGlow) +
      countOf(g.armArmor) +
      countOf(g.armDark) +
      countOf(g.armGun) +
      countOf(g.thigh) * 2 +
      countOf(g.shin) * 2;
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    let botTotal = 0;
    bot.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        botTotal += (o.geometry as THREE.BufferGeometry).getAttribute('position').count;
      }
    });
    expect(botTotal).toBe(canonicalTotal);
  });

  it('決定論: 2回ビルドで頂点数と先頭要素が一致する', () => {
    const a = buildHumanoidCrowdGeometries();
    const b = buildHumanoidCrowdGeometries();
    const pa = a.bodyArmor.getAttribute('position') as THREE.BufferAttribute;
    const pb = b.bodyArmor.getAttribute('position') as THREE.BufferAttribute;
    expect(pa.count).toBe(pb.count);
    for (let i = 0; i < 30; i += 1) {
      expect(pa.array[i]).toBeCloseTo(pb.array[i] as number, 10);
    }
  });

  it('個体Object3D経路(buildMesh)の部位メッシュ頂点数が正準と一致する(単一定義の等価性)', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    const canon = humanoidCrowdGeometries();
    const countOf = (g: THREE.BufferGeometry): number => g.getAttribute('position').count;
    const expected = [
      countOf(canon.bodyArmor),
      countOf(canon.bodyDark),
      countOf(canon.bodyGlow),
      countOf(canon.armArmor),
      countOf(canon.armDark),
      countOf(canon.armGun),
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

  it('boss humanoidは従来経路のまま肥大化(クレスト分の頂点増+rig.scale=1.12+rigLiftY)', () => {
    const world = makeFlatWorld();
    const boss = makeSoldier(world, 'boss');
    const normal = makeSoldier(world);
    const totalOf = (b: Bot): number => {
      let t = 0;
      b.group.traverse((o) => {
        if (o instanceof THREE.Mesh) t += (o.geometry as THREE.BufferGeometry).getAttribute('position').count;
      });
      return t;
    };
    expect(totalOf(boss)).toBeGreaterThan(totalOf(normal)); // クレスト+胸甲/パウルドロン肥大
    const r = boss as unknown as BotRigInternals;
    expect(r.rig.scale.x).toBeCloseTo(1.12, 10);
    expect(r.rigLiftY).toBeCloseTo(0.8 * 0.12, 10);
  });
});

describe('行列等価性(Object3D syncMesh vs composeHumanoidCrowdMatrices)', () => {
  const dt = 1 / 60;

  it('静止(呼吸のみ)+初期姿勢で一致する', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    world.step();
    bot.syncMesh();
    assertEquivalence(bot, 'rest');
  });

  it('実AI駆動の60フレームで全部位が一致する(5桁精度)', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    world.step();
    const ctx = walkCtx();
    for (let frame = 1; frame <= 60; frame += 1) {
      bot.update(dt, ctx);
      world.step();
      bot.syncMesh();
      if (frame % 12 === 0) assertEquivalence(bot, `ai-f${frame}`);
    }
  });

  it('合成姿勢(歩行各位相×うねり×のけぞり)でも一致する(決定論スイープ)', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    world.step();
    const r = bot as unknown as BotRigInternals;
    const cases: [number, number, number, number][] = [
      // [walkPhase, walkAmp, anim, flinch]
      [0.0, 0.0, 0.0, 0],
      [0.7, 0.4, 1.3, 0],
      [1.57, 1.0, 3.9, 0],
      [3.1, 0.8, 7.7, 0.14],
      [4.7, 0.6, 12.4, 0.05],
      [6.0, 0.2, 30.2, 0],
    ];
    for (const [walkPhase, walkAmp, anim, flinch] of cases) {
      r.walkPhase = walkPhase;
      r.walkAmp = walkAmp;
      r.anim = anim;
      r.flinch = flinch;
      bot.syncMesh();
      assertEquivalence(bot, `sweep-p${walkPhase}-a${walkAmp}-f${flinch}`);
    }
  });

  it('被弾(takeDamage)後のけぞり+発光係数が個体経路と一致する', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    world.step();
    const ctx = walkCtx();
    bot.update(dt, ctx);
    bot.takeDamage(10);
    expect(bot.alive).toBe(true);
    const r = bot as unknown as BotRigInternals;
    for (let frame = 1; frame <= 8; frame += 1) {
      bot.update(dt, ctx);
      world.step();
      bot.syncMesh();
      assertEquivalence(bot, `flinch-f${frame}`);
      // glow: update()がarmorMat.emissiveIntensityへ書く実値と、poseのglowが同一式
      const pose = emptyPose();
      bot.getHumanoidCrowdPose(pose);
      if (r.hitFlash > 0) {
        expect(pose.glow).toBeCloseTo(r.armorMat.emissiveIntensity, 10);
      }
    }
  });

  it('elite(tierGlow=0.28)のposeがelite=true+glow基底0.28になる', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world, 'elite');
    world.step();
    bot.syncMesh();
    assertEquivalence(bot, 'elite');
    const pose = emptyPose();
    bot.getHumanoidCrowdPose(pose);
    expect(pose.elite).toBe(true);
    expect(pose.glow).toBeCloseTo(HUMANOID_CROWD_STYLE.tierGlowElite, 10);
  });

  it('死亡でpose.visible=falseになる(match側はslot解放でObject3D経路へ戻す)', () => {
    const world = makeFlatWorld();
    const bot = makeSoldier(world);
    world.step();
    bot.takeDamage(99999);
    expect(bot.alive).toBe(false);
    const pose = emptyPose();
    bot.getHumanoidCrowdPose(pose);
    expect(pose.visible).toBe(false);
  });
});

describe('HumanoidCrowdRenderer(スロット管理とGPUバッファ)', () => {
  interface RendererInternals {
    bodyArmorN: THREE.InstancedMesh;
    bodyArmorE: THREE.InstancedMesh;
    bodyDark: THREE.InstancedMesh;
    bodyGlow: THREE.InstancedMesh;
    armGun: THREE.InstancedMesh;
    thighN: THREE.InstancedMesh;
    thighE: THREE.InstancedMesh;
    shin: THREE.InstancedMesh;
    glowAttrs: Map<THREE.InstancedMesh, THREE.InstancedBufferAttribute>;
  }

  it('acquire/releaseとcapacity満杯時の-1', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slots: number[] = [];
    for (let i = 0; i < HUMANOID_CROWD_CAPACITY; i += 1) {
      const s = crowd.acquire();
      expect(s).toBeGreaterThanOrEqual(0);
      slots.push(s);
    }
    expect(new Set(slots).size).toBe(HUMANOID_CROWD_CAPACITY);
    expect(crowd.acquire()).toBe(-1); // 満杯
    crowd.release(slots[3]!);
    expect(crowd.acquire()).toBe(slots[3]); // 解放スロットの再利用
    expect(crowd.activeCount()).toBe(HUMANOID_CROWD_CAPACITY);
    crowd.dispose(scene);
  });

  it('poseが正しいインスタンス位置へ行列を書き、commitがcount/needsUpdateを立てる', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    p.x = 3;
    p.y = 1;
    p.z = -2;
    crowd.pose(slot, p);
    crowd.commit();
    const internal = crowd as unknown as RendererInternals;
    const m = new THREE.Matrix4();
    internal.bodyArmorN.getMatrixAt(slot, m);
    // 位置成分(elements[12..14])がgroup位置+rig(ボブ0で rigY≈0)に一致
    expect(m.elements[12]).toBeCloseTo(3, 5);
    expect(m.elements[14]).toBeCloseTo(-2, 5);
    expect(internal.bodyArmorN.count).toBe(slot + 1);
    expect(internal.thighN.count).toBe((slot + 1) * 2);
    expect(internal.shin.count).toBe((slot + 1) * 2);
    expect(internal.bodyArmorN.instanceMatrix.version).toBeGreaterThan(0);
    crowd.dispose(scene);
  });

  it('tier切替: normalはN側へ行列+E側スケール0、eliteはその逆', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    p.x = 5;
    crowd.pose(slot, p);
    const internal = crowd as unknown as RendererInternals;
    const m = new THREE.Matrix4();
    internal.bodyArmorN.getMatrixAt(slot, m);
    expect(m.elements[12]).toBeCloseTo(5, 5);
    internal.bodyArmorE.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0); // 反対tierはスケール0
    p.elite = true;
    crowd.pose(slot, p);
    internal.bodyArmorE.getMatrixAt(slot, m);
    expect(m.elements[12]).toBeCloseTo(5, 5);
    internal.bodyArmorN.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0);
    internal.thighE.getMatrixAt(slot * 2, m);
    expect(m.elements[12]).not.toBe(0);
    internal.thighN.getMatrixAt(slot * 2, m);
    expect(m.elements[0]).toBe(0);
    crowd.dispose(scene);
  });

  it('チーム色がinstanceColorへ反映される(armor=原色/dark=×0.34)', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    p.colorHex = 0xff8844;
    crowd.pose(slot, p);
    const internal = crowd as unknown as RendererInternals;
    const c = new THREE.Color();
    internal.bodyArmorN.getColorAt(slot, c);
    expect(c.getHex()).toBe(0xff8844);
    internal.bodyGlow.getColorAt(slot, c);
    expect(c.getHex()).toBe(0xff8844);
    internal.bodyDark.getColorAt(slot, c);
    const expected = new THREE.Color(0xff8844).multiplyScalar(HUMANOID_CROWD_STYLE.darkMul);
    expect(c.r).toBeCloseTo(expected.r, 5);
    expect(c.g).toBeCloseTo(expected.g, 5);
    expect(c.b).toBeCloseTo(expected.b, 5);
    crowd.dispose(scene);
  });

  it('aGlow: armor系へpose.glowが書かれ、バイザー(bodyGlow)は常時0.9', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    p.glow = 0.55;
    crowd.pose(slot, p);
    crowd.commit();
    const internal = crowd as unknown as RendererInternals;
    const armorAttr = internal.glowAttrs.get(internal.bodyArmorN)!;
    expect(armorAttr.getX(slot)).toBeCloseTo(0.55, 5); // Float32格納のため5桁
    const thighAttr = internal.glowAttrs.get(internal.thighN)!;
    expect(thighAttr.getX(slot * 2)).toBeCloseTo(0.55, 5);
    expect(thighAttr.getX(slot * 2 + 1)).toBeCloseTo(0.55, 5);
    const visorAttr = internal.glowAttrs.get(internal.bodyGlow)!;
    expect(visorAttr.getX(slot)).toBeCloseTo(HUMANOID_CROWD_STYLE.visorGlow, 5);
    expect(internal.glowAttrs.get(internal.bodyDark)).toBeUndefined(); // dark/gunは非発光
    expect(internal.glowAttrs.get(internal.armGun)).toBeUndefined();
    crowd.dispose(scene);
  });

  it('release/非visibleでスケール0行列になる(描画されない)', () => {
    const scene = new THREE.Scene();
    const crowd = new HumanoidCrowdRenderer(scene);
    const slot = crowd.acquire();
    const p = emptyPose();
    crowd.pose(slot, p);
    p.visible = false;
    crowd.pose(slot, p);
    const internal = crowd as unknown as RendererInternals;
    const m = new THREE.Matrix4();
    internal.bodyArmorN.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0);
    expect(m.elements[5]).toBe(0);
    expect(m.elements[10]).toBe(0);
    p.visible = true;
    crowd.pose(slot, p);
    internal.bodyArmorN.getMatrixAt(slot, m);
    expect(m.elements[0]).not.toBe(0);
    crowd.release(slot);
    internal.bodyArmorN.getMatrixAt(slot, m);
    expect(m.elements[0]).toBe(0);
    crowd.dispose(scene);
  });

  it('disposeでシーンから11本すべて外れ、群メッシュは影を落とさない', () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;
    const crowd = new HumanoidCrowdRenderer(scene);
    expect(scene.children.length).toBe(before + 11);
    for (const child of scene.children) {
      if (child instanceof THREE.InstancedMesh) {
        expect(child.castShadow).toBe(false);
        expect(child.frustumCulled).toBe(false);
      }
    }
    crowd.dispose(scene);
    expect(scene.children.length).toBe(before);
  });
});
