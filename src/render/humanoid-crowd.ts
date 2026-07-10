import * as THREE from 'three';
import {
  buildHumanoidCrowdGeometries,
  HUMANOID_CROWD_STYLE,
  HUMANOID_NODE_REST,
  type HumanoidCrowdGeometries,
  type HumanoidCrowdPose,
} from '../game/bot';
import { makeCrowdMatrices, type ZombieCrowdMatrices } from './zombie-crowd';

// ═══ R54-W1(F4): humanoid群InstancedMeshレンダラ ═══════════════════════════════
//
// 目的: 生存中の normal/elite humanoid(PvP最大36体・ストーリー波)の描画を
// 「1体10メッシュ×36=360ドローコール」から「InstancedMesh 11本」へ畳む
// (R54計画#6 P0-a。zombie-crowd.tsで確立したパターンのhumanoid拡張)。
//
// ── ゾンビ版との差分(3つの壁の解法) ─────────────────────────────────────────
// 1. チーム色+tier発光+hitFlash: instanceColor=チーム色(diffuse)、aGlow属性=
//    「tierGlowBase + hitFlash項」で、シェーダが emissive += vInstColor×vGlow を加算。
//    個体経路の armor(emissive=チーム色×intensity)と同式。normal/eliteの
//    roughness/metalness差は armor系メッシュのtier分割(N/E)で吸収 → 計11本。
// 2. dissolve(死亡崩落): インスタンス内では実装しない(discard常時コンパイルは
//    early-Z破壊 — R11教訓)。死亡した瞬間にmatchがslotを解放し、個体rigへ
//    スワップバックする(rigは全個体が保持済み=メモリ増ゼロ。死亡FXがポップをマスク)。
// 3. ファイナルキルカム: FK開始でmatchが全humanoidをスワップアウト(シネマカット
//    境界=ポップ不可視)。FkPose APIは個体rig前提のまま無改修。
//
// ── match配線(feedHumanoidCrowd)への契約 ──────────────────────────────────
// ・instanced対象: kind==='humanoid' && (tier==='normal'||'elite') && alive
//   && !shadowCasting(最近接8体=影LODは個体経路でarticulated影を落とす)
//   && !killcam.playing。master/boss/giant/機械系/zombieは常にObject3D経路。
// ・スワップは毎フレームの自己修復ループ(eligible判定→acquire/release)で行う。
//   死亡・FK・影昇格のどの遷移でも同フレームで正しい経路に収束する。
// ・キルスイッチ: HUMANOID_CROWD_INSTANCED=false でmatchはレンダラを生成せず、
//   全humanoidが従来経路(crowdSlot=-1)。出荷直前の退避手段。
// ・計測: ?perfhud=1 のDCカウンタで before/after を確認(36体: 360→最近接8×10+11≈91DC)。
//
// ── 設計判断の記録 ──────────────────────────────────────────────────────────
// ・emissiveはvColor(=ジオメトリAO×instanceColor)ではなく専用varying vInstColor
//   (instanceColorそのもの)を使う — 個体経路のemissiveはAO非適用のため(等価性優先)。
// ・バイザー/胸帯(bodyGlow)はaGlow=0.9固定(個体経路のemissiveIntensity 0.9)。
//   glow材のdiffuse(0x0d0f13)はinstanceColorで微小にtintされるが、ほぼ黒のため不可視。
// ・gun(ライフル)は全クラス共通の1形状が既存仕様(buildMeshは武器クラス非依存)
//   → 追加判断は不要だった。固定色0x202227・instanceColorなし。

export const HUMANOID_CROWD_INSTANCED = true;
export const HUMANOID_CROWD_CAPACITY = 48; // PvP最大36+ストーリー波の余裕

// ── 正準ジオメトリ(モジュール1回)─────────────────────────────────────────────
let canonical: HumanoidCrowdGeometries | null = null;
export function humanoidCrowdGeometries(): HumanoidCrowdGeometries {
  if (!canonical) canonical = buildHumanoidCrowdGeometries();
  return canonical;
}

// ── 共有マテリアル(armor N/E + glow は aGlow パッチ付き)──────────────────────
function patchGlowShader(mat: THREE.MeshStandardMaterial, key: string): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vInstColor;',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vGlow = aGlow;',
          '#ifdef USE_INSTANCING_COLOR',
          'vInstColor = instanceColor.rgb;',
          '#else',
          'vInstColor = vec3(1.0);',
          '#endif',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlow;\nvarying vec3 vInstColor;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vInstColor * vGlow;',
      );
  };
  mat.customProgramCacheKey = () => key;
}

interface HumanoidCrowdMats {
  armorNormal: THREE.MeshStandardMaterial;
  armorElite: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  gun: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}
let crowdMats: HumanoidCrowdMats | null = null;
function sharedHumanoidCrowdMats(): HumanoidCrowdMats {
  if (!crowdMats) {
    const S = HUMANOID_CROWD_STYLE;
    // armor: 白ベース(diffuse=instanceColor×頂点AO)。emissiveはシェーダパッチが
    // vInstColor×aGlow を加算(個体経路の emissive=チーム色×intensity と同式)。
    const armorNormal = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: S.armorRoughnessNormal,
      metalness: S.armorMetalnessNormal,
      vertexColors: true,
    });
    patchGlowShader(armorNormal, 'hibana-hcrowd-armor-n');
    const armorElite = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: S.armorRoughnessElite,
      metalness: S.armorMetalnessElite,
      vertexColors: true,
    });
    patchGlowShader(armorElite, 'hibana-hcrowd-armor-e');
    const dark = new THREE.MeshStandardMaterial({
      color: 0xffffff, // instanceColor = チーム色×darkMul
      roughness: S.darkRoughness,
      metalness: S.darkMetalness,
      vertexColors: true,
    });
    const gun = new THREE.MeshStandardMaterial({
      color: S.gunColor,
      roughness: S.gunRoughness,
      metalness: S.gunMetalness,
      vertexColors: true,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: S.glowColor,
      roughness: S.glowRoughness,
    });
    patchGlowShader(glow, 'hibana-hcrowd-glow');
    for (const m of [armorNormal, armorElite, dark, gun, glow]) m.userData.shared = true;
    crowdMats = { armorNormal, armorElite, dark, gun, glow };
  }
  return crowdMats;
}

// ── 行列合成(syncMesh humanoid生存分岐の鏡写し。純関数・アロケゼロ)──────────
// 式を変更する場合は必ず bot.ts syncMesh 側と同時に変更すること
// (humanoid-crowd.test.ts が実Botとの行列比較で検知する)。
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _eul = new THREE.Euler();
const _qua = new THREE.Quaternion();
const _mGroup = new THREE.Matrix4();
const _mNode = new THREE.Matrix4();

function mulNode(
  out: THREE.Matrix4,
  parent: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotZ: number,
): void {
  _eul.set(rotX, 0, rotZ);
  _qua.setFromEuler(_eul);
  _mNode.compose(_pos.set(x, y, z), _qua, _scl.set(1, 1, 1));
  out.multiplyMatrices(parent, _mNode);
}

export function composeHumanoidCrowdMatrices(
  p: HumanoidCrowdPose,
  out: ZombieCrowdMatrices,
): void {
  // ── group(位置+heading。humanoidはvisualLift/scale非対象=normal・elite限定)──
  _eul.set(0, p.heading, 0);
  _qua.setFromEuler(_eul);
  _mGroup.compose(_pos.set(p.x, p.y, p.z), _qua, _scl.set(1, 1, 1));
  // ── rig(歩行ボブ+呼吸+被弾のけぞり)──
  const s = Math.sin(p.walkPhase);
  const swing = s * p.walkAmp * 0.8;
  const idle = 1 - Math.min(1, p.walkAmp);
  const breath = Math.sin(p.anim * 2.1) * 0.012 * idle;
  const rigY = p.rigLiftY + Math.abs(Math.cos(p.walkPhase)) * p.walkAmp * 0.04 + breath;
  const rigRotX = -(p.flinch / 0.14) * 0.18;
  _eul.set(rigRotX, 0, 0);
  _qua.setFromEuler(_eul);
  _mNode.compose(_pos.set(0, rigY, 0), _qua, _scl.set(1, 1, 1));
  out.body.multiplyMatrices(_mGroup, _mNode);
  // ── armRig(把持ポーズの微スウェイ)──
  const armRotX = Math.sin(p.anim * 1.5) * 0.05 * idle - swing * 0.12;
  const armRotZ = Math.sin(p.anim * 0.9 + 1.1) * 0.03 * idle;
  mulNode(out.arm, out.body, 0, HUMANOID_NODE_REST.armRigY, 0, armRotX, armRotZ);
  // ── 脚(逆位相スイング+接地側の膝曲げ)──
  mulNode(out.thighL, out.body, -HUMANOID_NODE_REST.legX, HUMANOID_NODE_REST.legY, 0, swing, 0);
  mulNode(out.thighR, out.body, HUMANOID_NODE_REST.legX, HUMANOID_NODE_REST.legY, 0, -swing, 0);
  const kneeL = Math.max(0, -s) * p.walkAmp;
  const kneeR = Math.max(0, s) * p.walkAmp;
  mulNode(out.shinL, out.thighL, 0, HUMANOID_NODE_REST.kneeY, 0, kneeL, 0);
  mulNode(out.shinR, out.thighR, 0, HUMANOID_NODE_REST.kneeY, 0, kneeR, 0);
}

const ZERO_M4 = new THREE.Matrix4().makeScale(0, 0, 0);
const _matScratch = makeCrowdMatrices();
const _skin = new THREE.Color();
const _dark = new THREE.Color();

// ── 群レンダラ本体(11本)────────────────────────────────────────────────────
export class HumanoidCrowdRenderer {
  private readonly bodyArmorN: THREE.InstancedMesh;
  private readonly bodyArmorE: THREE.InstancedMesh;
  private readonly bodyDark: THREE.InstancedMesh;
  private readonly bodyGlow: THREE.InstancedMesh;
  private readonly armArmorN: THREE.InstancedMesh;
  private readonly armArmorE: THREE.InstancedMesh;
  private readonly armDark: THREE.InstancedMesh;
  private readonly armGun: THREE.InstancedMesh;
  private readonly thighN: THREE.InstancedMesh;
  private readonly thighE: THREE.InstancedMesh;
  private readonly shin: THREE.InstancedMesh;
  private readonly all: THREE.InstancedMesh[];
  private readonly glowAttrs = new Map<THREE.InstancedMesh, THREE.InstancedBufferAttribute>();
  private readonly freeSlots: number[] = [];
  private readonly usedSlots: boolean[] = [];
  private maxUsed = -1;

  constructor(scene: THREE.Scene) {
    const geo = humanoidCrowdGeometries();
    const mats = sharedHumanoidCrowdMats();
    const cap = HUMANOID_CROWD_CAPACITY;
    const make = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      count: number,
      colored: boolean,
      glowAttr: boolean,
    ): THREE.InstancedMesh => {
      // aGlow属性はジオメトリに付くため、レンダラ専有のcloneへ付与する
      // (正準ジオメトリ本体は汚さない。cloneは属性を複製するのでモジュール寿命の
      // canonicalと独立 — disposeでclone側のみ解放する)
      const geom = glowAttr ? g.clone() : g;
      if (glowAttr) {
        const arr = new Float32Array(count);
        arr.fill(HUMANOID_CROWD_STYLE.visorGlow); // 既定=バイザー値(armor系はpose()が上書き)
        const attr = new THREE.InstancedBufferAttribute(arr, 1);
        attr.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('aGlow', attr);
      }
      const mesh = new THREE.InstancedMesh(geom, m, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // 群1描画単位=個別カリング不能(消失バグの定番)
      mesh.castShadow = false; // 影は最近接8体のObject3D経路が担う
      mesh.receiveShadow = false;
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, ZERO_M4);
      if (colored) {
        for (let i = 0; i < count; i += 1) mesh.setColorAt(i, _skin.setHex(0xffffff));
      }
      mesh.count = 0;
      scene.add(mesh);
      if (glowAttr) {
        this.glowAttrs.set(mesh, mesh.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute);
      }
      return mesh;
    };
    this.bodyArmorN = make(geo.bodyArmor, mats.armorNormal, cap, true, true);
    this.bodyArmorE = make(geo.bodyArmor, mats.armorElite, cap, true, true);
    this.bodyDark = make(geo.bodyDark, mats.dark, cap, true, false);
    this.bodyGlow = make(geo.bodyGlow, mats.glow, cap, true, true);
    this.armArmorN = make(geo.armArmor, mats.armorNormal, cap, true, true);
    this.armArmorE = make(geo.armArmor, mats.armorElite, cap, true, true);
    this.armDark = make(geo.armDark, mats.dark, cap, true, false);
    this.armGun = make(geo.armGun, mats.gun, cap, false, false);
    this.thighN = make(geo.thigh, mats.armorNormal, cap * 2, true, true);
    this.thighE = make(geo.thigh, mats.armorElite, cap * 2, true, true);
    this.shin = make(geo.shin, mats.dark, cap * 2, true, false);
    this.all = [
      this.bodyArmorN,
      this.bodyArmorE,
      this.bodyDark,
      this.bodyGlow,
      this.armArmorN,
      this.armArmorE,
      this.armDark,
      this.armGun,
      this.thighN,
      this.thighE,
      this.shin,
    ];
    for (let i = cap - 1; i >= 0; i -= 1) this.freeSlots.push(i);
    this.usedSlots.length = cap;
    this.usedSlots.fill(false);
  }

  acquire(): number {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return -1;
    this.usedSlots[slot] = true;
    if (slot > this.maxUsed) this.maxUsed = slot;
    return slot;
  }

  release(slot: number): void {
    if (slot < 0 || slot >= HUMANOID_CROWD_CAPACITY || !this.usedSlots[slot]) return;
    this.usedSlots[slot] = false;
    this.freeSlots.push(slot);
    this.writeZero(slot);
    if (slot === this.maxUsed) {
      let m = this.maxUsed - 1;
      while (m >= 0 && !this.usedSlots[m]) m -= 1;
      this.maxUsed = m;
    }
  }

  pose(slot: number, p: HumanoidCrowdPose): void {
    if (slot < 0 || !this.usedSlots[slot]) return;
    if (!p.visible) {
      this.writeZero(slot);
      return;
    }
    composeHumanoidCrowdMatrices(p, _matScratch);
    const s2 = slot * 2;
    // tier別メッシュ: 対象tier側へ行列、反対側はスケール0(スロットは両tierで共有)
    const bodyOn = p.elite ? this.bodyArmorE : this.bodyArmorN;
    const bodyOff = p.elite ? this.bodyArmorN : this.bodyArmorE;
    const armOn = p.elite ? this.armArmorE : this.armArmorN;
    const armOff = p.elite ? this.armArmorN : this.armArmorE;
    const thighOn = p.elite ? this.thighE : this.thighN;
    const thighOff = p.elite ? this.thighN : this.thighE;
    bodyOn.setMatrixAt(slot, _matScratch.body);
    bodyOff.setMatrixAt(slot, ZERO_M4);
    this.bodyDark.setMatrixAt(slot, _matScratch.body);
    this.bodyGlow.setMatrixAt(slot, _matScratch.body);
    armOn.setMatrixAt(slot, _matScratch.arm);
    armOff.setMatrixAt(slot, ZERO_M4);
    this.armDark.setMatrixAt(slot, _matScratch.arm);
    this.armGun.setMatrixAt(slot, _matScratch.arm);
    thighOn.setMatrixAt(s2, _matScratch.thighL);
    thighOn.setMatrixAt(s2 + 1, _matScratch.thighR);
    thighOff.setMatrixAt(s2, ZERO_M4);
    thighOff.setMatrixAt(s2 + 1, ZERO_M4);
    this.shin.setMatrixAt(s2, _matScratch.shinL);
    this.shin.setMatrixAt(s2 + 1, _matScratch.shinR);
    // 色: armor/glow=チーム色、dark=チーム色×darkMul(個体経路の実式)
    _skin.setHex(p.colorHex);
    _dark.copy(_skin).multiplyScalar(HUMANOID_CROWD_STYLE.darkMul);
    bodyOn.setColorAt(slot, _skin);
    this.bodyGlow.setColorAt(slot, _skin);
    armOn.setColorAt(slot, _skin);
    thighOn.setColorAt(s2, _skin);
    thighOn.setColorAt(s2 + 1, _skin);
    this.bodyDark.setColorAt(slot, _dark);
    this.armDark.setColorAt(slot, _dark);
    this.shin.setColorAt(s2, _dark);
    this.shin.setColorAt(s2 + 1, _dark);
    // aGlow: armor系=tierGlow+hitFlash項(個体経路のemissiveIntensityと同式)。
    // bodyGlow(バイザー)は固定0.9(既定値のまま=書き込み不要)
    this.writeGlow(bodyOn, slot, p.glow);
    this.writeGlow(armOn, slot, p.glow);
    this.writeGlow(thighOn, s2, p.glow);
    this.writeGlow(thighOn, s2 + 1, p.glow);
  }

  commit(): void {
    const n = this.maxUsed + 1;
    for (const mesh of this.all) {
      mesh.count = mesh === this.thighN || mesh === this.thighE || mesh === this.shin ? n * 2 : n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const glow = this.glowAttrs.get(mesh);
      if (glow) glow.needsUpdate = true;
    }
  }

  activeCount(): number {
    let c = 0;
    for (const used of this.usedSlots) if (used) c += 1;
    return c;
  }

  /** 試合dispose: シーンから外しインスタンス属性+aGlow用cloneジオメトリを解放。
   * 正準ジオメトリ/共有マテリアルはモジュール寿命(有界)なので解放しない。 */
  dispose(scene: THREE.Scene): void {
    for (const mesh of this.all) {
      scene.remove(mesh);
      mesh.dispose();
      // aGlow付きメッシュはclone専有ジオメトリ(canonicalとは別実体)なので解放する
      if (this.glowAttrs.has(mesh)) mesh.geometry.dispose();
    }
  }

  private writeGlow(mesh: THREE.InstancedMesh, index: number, value: number): void {
    const attr = this.glowAttrs.get(mesh);
    if (attr) attr.setX(index, value);
  }

  private writeZero(slot: number): void {
    const s2 = slot * 2;
    for (const mesh of this.all) {
      if (mesh === this.thighN || mesh === this.thighE || mesh === this.shin) {
        mesh.setMatrixAt(s2, ZERO_M4);
        mesh.setMatrixAt(s2 + 1, ZERO_M4);
      } else {
        mesh.setMatrixAt(slot, ZERO_M4);
      }
    }
  }
}
