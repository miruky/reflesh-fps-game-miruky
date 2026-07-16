import * as THREE from 'three';
import {
  buildZombieCrowdGeometries,
  buildZombieCrowdLodGeometries,
  ZOMBIE_CROWD_STYLE,
  ZOMBIE_NODE_REST,
  type ZombieCrowdGeometries,
  type ZombieCrowdPose,
} from '../game/bot';

// ═══ R53-W3: ゾンビ群InstancedMeshレンダラ ═══════════════════════════════════
//
// 目的: 通常/精鋭ゾンビ(最大108体)の描画を「1体9メッシュ×108=972ドローコール」から
// 「近距離完全形状7本 + 後方軽量形状7本」へ畳む(R51監査の支配項=描画CPU/GPUの根治)。
// 後方形状も骨格・寸法・発光・アニメーションは同一で、曲面分割だけを削減する。見た目は
// bot.ts の syncMesh/updateDying と同一の式を composeZombieCrowdMatrices が
// CPU行列合成で再現する(等価性は zombie-crowd.test.ts が実Botとの行列比較で固定)。
//
// ── ハイブリッド協定(match配線者=M3への契約) ──────────────────────────────
// ・instanced対象: kind==='zombie' && tier!=='boss' && zombieVariant===null のみ。
//   boss(裂け目/rig.scale2.3)と変種(W2装飾)は従来のObject3D経路のまま。
// ・【推奨】hordeRank < ZOMBIE_CROWD_NEAR_EXCLUDE(8) の最近接個体はinstanced化しない:
//   - 既存の影システム(shadowLodFlagsの最近接8体のみcastShadow)と完全に一致し、
//     影専用proキシが不要になる(本レンダラのメッシュは全てcastShadow=false)。
//     最近接個体はObject3Dが実articulated影を落とし、遠い群は従来どおり影なし。
//   - 至近距離の見た目忠実度(per-botマテリアル等)も維持される。
//   - 両経路はジオメトリ/式が同一なので、rank境界を跨ぐ切替でポップは起きない。
// ・キルスイッチ: ZOMBIE_CROWD_INSTANCED=false で match は acquire を一切呼ばず、
//   全ゾンビが従来経路で描画される(Bot.crowdSlotは-1のまま)。出荷直前の退避手段。
//
// ── M3 配線ポイント ─────────────────────────────────────────────────────────
// 1) 生成/破棄: Match.buildStageScene(ゾンビモードのみ)で
//      this.zombieCrowd = new ZombieCrowdRenderer(this.scene);
//    Match.dispose() で this.zombieCrowd?.dispose(this.scene)。
// 2) スロット割当(spawnOneZombie 新規/プール再利用の両経路、variant決定の後):
//      const eligible = ZOMBIE_CROWD_INSTANCED && bot.tier !== 'boss' && bot.zombieVariant === null;
//      bot.setCrowdSlot(eligible ? crowd.acquire() : -1);   // acquireは満杯で-1
//    ※variantを付与する個体は必ず acquire しない(協定)。プール解放(cleanupDeadZombies)
//      では crowd.release(bot.crowdSlot); bot.setCrowdSlot(-1); を先に行う。
// 3) 毎フレーム(updateBots後、render前に1回):
//      for (const b of zombies) if (b.crowdSlot >= 0) { b.getCrowdPose(P); crowd.pose(b.crowdSlot, P); }
//      crowd.commit();
//    ※crowdSlot>=0 の個体は syncMesh() を呼ばない(getCrowdPoseが置き換え。二重コスト回避)。
//    ※P はモジュールスクラッチ(使い回し)でよい — pose()は値を読み切る。
// 4) 最近接の高忠実度維持(推奨): 0.25s毎のhordeRank更新時に、rank<8 かつ crowdSlot>=0 の
//    個体は release+setCrowdSlot(-1)、rank>=8 かつ eligible かつ slot<0 の個体は acquire。
// 5) 計測: ?perfhud=1 のDCカウンタで before/after を確認できる(W1導入済み)。
//
// ── 設計判断の記録 ──────────────────────────────────────────────────────────
// ・hitFlash(aFlash属性)は実装しない: 通常/精鋭ゾンビのarmorはemissive未指定(=黒)のため
//   hitFlashのemissiveIntensity操作は視覚上no-op(bot.ts buildZombieMesh参照)。可視な
//   フラッシュを追加すると逆にObject3D経路(最近接8体)との見た目差が生まれる。
// ・アニメLOD(animLod/animHalfLod)は再現しない: 108体×7行列合成は<0.5ms(sin ~650回)で、
//   スキップの必要がない。LODは「据え置きの古い姿勢」を残す仕組みなので、毎フレーム
//   計算する本経路は視覚的に等価以上。
// ・正準ジオメトリ/共有マテリアルはモジュール寿命(試合を跨いで保持、有界~数百KB)。
//   dispose()はインスタンス属性のみ解放する(getSharedZombieDarkMat等と同じ流儀)。

export const ZOMBIE_CROWD_INSTANCED = true;
export const ZOMBIE_CROWD_CAPACITY = 128; // ZOMBIE_MAX_ALIVE.high(108)+マージン
export const ZOMBIE_CROWD_NEAR_EXCLUDE = 8; // 推奨: この順位未満はObject3D経路(影と一致)
export const ZOMBIE_CROWD_FAR_ENTER_RANK = 36;
export const ZOMBIE_CROWD_FAR_EXIT_RANK = 28;

// ── 正準ジオメトリ+共有マテリアル(モジュール1回) ──────────────────────────
let canonical: ZombieCrowdGeometries | null = null;
export function crowdGeometries(): ZombieCrowdGeometries {
  if (!canonical) canonical = buildZombieCrowdGeometries();
  return canonical;
}
let canonicalLod: ZombieCrowdGeometries | null = null;
export function crowdLodGeometries(): ZombieCrowdGeometries {
  if (!canonicalLod) canonicalLod = buildZombieCrowdLodGeometries();
  return canonicalLod;
}

interface CrowdMats {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}
let crowdMats: CrowdMats | null = null;
function sharedCrowdMats(): CrowdMats {
  if (!crowdMats) {
    // instanceColorはdiffuseにのみ乗るため、armor/darkは白ベース(スキン色はインスタンス側)。
    // 各パラメタは buildZombieMesh の実値(ZOMBIE_CROWD_STYLE)の鏡写し。
    const armor = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: ZOMBIE_CROWD_STYLE.armorRoughness,
      metalness: ZOMBIE_CROWD_STYLE.armorMetalness,
      vertexColors: true,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: ZOMBIE_CROWD_STYLE.darkRoughness,
      metalness: ZOMBIE_CROWD_STYLE.darkMetalness,
      vertexColors: true,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: ZOMBIE_CROWD_STYLE.glowColor,
      emissive: new THREE.Color(ZOMBIE_CROWD_STYLE.eyeColor),
      emissiveIntensity: ZOMBIE_CROWD_STYLE.eyeIntensity,
      roughness: ZOMBIE_CROWD_STYLE.glowRoughness,
    });
    armor.userData.shared = true;
    dark.userData.shared = true;
    glow.userData.shared = true;
    crowdMats = { armor, dark, glow };
  }
  return crowdMats;
}

// tier別のインスタンス色(diffuse乗算)。dark系はスキン×darkMul(getSharedZombieDarkMatと同値)
const SKIN_NORMAL = new THREE.Color(ZOMBIE_CROWD_STYLE.skinNormal);
const SKIN_ELITE = new THREE.Color(ZOMBIE_CROWD_STYLE.skinElite);
const DARK_NORMAL = SKIN_NORMAL.clone().multiplyScalar(ZOMBIE_CROWD_STYLE.darkMul);
const DARK_ELITE = SKIN_ELITE.clone().multiplyScalar(ZOMBIE_CROWD_STYLE.darkMul);

// ── 行列合成(syncMesh/updateDyingのゾンビ式の鏡写し。純関数・アロケゼロ) ──────
export interface ZombieCrowdMatrices {
  body: THREE.Matrix4;
  arm: THREE.Matrix4;
  thighL: THREE.Matrix4;
  thighR: THREE.Matrix4;
  shinL: THREE.Matrix4;
  shinR: THREE.Matrix4;
}

export function makeCrowdMatrices(): ZombieCrowdMatrices {
  return {
    body: new THREE.Matrix4(),
    arm: new THREE.Matrix4(),
    thighL: new THREE.Matrix4(),
    thighR: new THREE.Matrix4(),
    shinL: new THREE.Matrix4(),
    shinR: new THREE.Matrix4(),
  };
}

const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _eul = new THREE.Euler();
const _qua = new THREE.Quaternion();
const _mGroup = new THREE.Matrix4();
const _mNode = new THREE.Matrix4();

// out.parent(親行列)× ローカル(pos+rotX/rotZ) を out へ
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

// bot.ts syncMesh(zombie分岐)+updateDying(humanoid/zombie分岐)の完全な鏡写し。
// 式を変更する場合は必ず両側を同時に変更すること(zombie-crowd.test.tsが検知する)。
export function composeZombieCrowdMatrices(p: ZombieCrowdPose, out: ZombieCrowdMatrices): void {
  const t = p.dying01;
  // ── group(位置+heading。死亡後段は前傾横倒し) ──
  let groupRotX = 0;
  let groupRotZ = 0;
  let buckle = 0;
  if (t > 0) {
    buckle = THREE.MathUtils.clamp(t / 0.45, 0, 1);
    const fall = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
    const ease = fall * fall * (3 - 2 * fall); // smoothstep
    groupRotX = ease * (Math.PI / 2) * 0.95;
    groupRotZ = ease * p.deathTilt;
  }
  _eul.set(groupRotX, p.heading, groupRotZ);
  _qua.setFromEuler(_eul);
  _mGroup.compose(
    _pos.set(p.x, p.y + p.visualLift, p.z),
    _qua,
    _scl.set(p.scale, p.scale, p.scale),
  );
  // ── rig(前傾+よろめき+ボブ / 死亡前段は膝崩れ沈み) ──
  // 死亡中の回転の実挙動(bot.ts takeDamage/updateDyingの鏡写し):
  //  ・rig.rotation.x は死亡フレームで明示的に 0 へリセットされる(takeDamageの
  //    「flinch/被弾発光の消し込み」ブロック。前傾0.26も一緒に消えるのが現行の見た目)。
  //  ・rig.rotation.z はリセットされず、最後の生存フレームの値で凍結される。
  //    anim/walkPhase は死亡後進まない(update早期return)ため、aliveと同じ式が
  //    凍結値を厳密に再現する。
  const rigRotX = t > 0 ? 0 : -(0.26 + Math.sin(p.anim * 3.1) * 0.045); // ★HF: syncMeshの符号反転(真の前傾)と同時更新
  const rigRotZ = Math.sin(p.anim * 1.7 + p.bobPhase) * 0.07;
  const rigY =
    t > 0
      ? p.rigLiftY - buckle * 0.22
      : p.rigLiftY + Math.abs(Math.cos(p.walkPhase)) * p.walkAmp * 0.03;
  _eul.set(rigRotX, 0, rigRotZ);
  _qua.setFromEuler(_eul);
  _mNode.compose(_pos.set(0, rigY, 0), _qua, _scl.set(1, 1, 1));
  out.body.multiplyMatrices(_mGroup, _mNode);
  // ── armRig(前へ垂らした腕の揺れ。死亡中は凍結=同式) ──
  const armRotX = Math.sin(p.anim * 2.3) * 0.12;
  const armRotZ = Math.sin(p.anim * 1.3 + p.bobPhase) * 0.05;
  mulNode(out.arm, out.body, 0, ZOMBIE_NODE_REST.armRigY, 0, armRotX, armRotZ);
  // ── 脚(逆位相スイング / 死亡前段は膝崩れ) ──
  const zs = Math.sin(p.walkPhase);
  const zswing = zs * p.walkAmp * 0.65;
  const legLrx = t > 0 ? buckle * 0.3 : zswing;
  const legRrx = t > 0 ? buckle * 0.3 : -zswing;
  const kneeLrx = t > 0 ? buckle * 1.4 : Math.max(0, -zs) * p.walkAmp * 0.9;
  const kneeRrx = t > 0 ? buckle * 1.4 : Math.max(0, zs) * p.walkAmp * 0.9;
  mulNode(out.thighL, out.body, -ZOMBIE_NODE_REST.legX, ZOMBIE_NODE_REST.legY, 0, legLrx, 0);
  mulNode(out.thighR, out.body, ZOMBIE_NODE_REST.legX, ZOMBIE_NODE_REST.legY, 0, legRrx, 0);
  mulNode(out.shinL, out.thighL, 0, ZOMBIE_NODE_REST.kneeY, 0, kneeLrx, 0);
  mulNode(out.shinR, out.thighR, 0, ZOMBIE_NODE_REST.kneeY, 0, kneeRrx, 0);
}

const ZERO_M4 = new THREE.Matrix4().makeScale(0, 0, 0);
const _matScratch = makeCrowdMatrices();

// ── 群レンダラ本体 ───────────────────────────────────────────────────────────
interface CrowdMeshSet {
  bodyArmor: THREE.InstancedMesh;
  bodyDark: THREE.InstancedMesh;
  bodyGlow: THREE.InstancedMesh;
  armArmor: THREE.InstancedMesh;
  armDark: THREE.InstancedMesh;
  thigh: THREE.InstancedMesh;
  shin: THREE.InstancedMesh;
  all: THREE.InstancedMesh[];
  matrixDirty: boolean;
  colorDirty: boolean;
  writeCount: number;
  drawElite: Int8Array;
}

export class ZombieCrowdRenderer {
  private readonly full: CrowdMeshSet;
  private readonly far: CrowdMeshSet;
  private readonly all: THREE.InstancedMesh[];
  private readonly freeSlots: number[] = [];
  private readonly farFreeSlots: number[] = [];
  private readonly usedSlots: boolean[] = [];
  private readonly farUsedSlots: boolean[] = [];
  private activeSlots = 0;
  private prewarmGroup: THREE.Group | null = null;
  private readonly viewProjection = new THREE.Matrix4();
  private readonly viewFrustum = new THREE.Frustum();
  private readonly cullSphere = new THREE.Sphere();
  private frustumReady = false;

  constructor(private readonly scene: THREE.Scene) {
    const mats = sharedCrowdMats();
    const cap = ZOMBIE_CROWD_CAPACITY;
    const make = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      count: number,
      colored: boolean,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, ZERO_M4);
      if (colored) {
        for (let i = 0; i < count; i += 1) mesh.setColorAt(i, SKIN_NORMAL);
      }
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    const makeSet = (geo: ZombieCrowdGeometries): CrowdMeshSet => {
      const bodyArmor = make(geo.bodyArmor, mats.armor, cap, true);
      const bodyDark = make(geo.bodyDark, mats.dark, cap, true);
      const bodyGlow = make(geo.bodyGlow, mats.glow, cap, false);
      const armArmor = make(geo.armArmor, mats.armor, cap, true);
      const armDark = make(geo.armDark, mats.dark, cap, true);
      const thigh = make(geo.thigh, mats.armor, cap * 2, true);
      const shin = make(geo.shin, mats.dark, cap * 2, true);
      return {
        bodyArmor,
        bodyDark,
        bodyGlow,
        armArmor,
        armDark,
        thigh,
        shin,
        all: [bodyArmor, bodyDark, bodyGlow, armArmor, armDark, thigh, shin],
        matrixDirty: false,
        colorDirty: true,
        writeCount: 0,
        drawElite: new Int8Array(cap).fill(-1),
      };
    };
    this.full = makeSet(crowdGeometries());
    this.far = makeSet(crowdLodGeometries());
    this.all = [...this.full.all, ...this.far.all];
    for (let i = cap - 1; i >= 0; i -= 1) {
      this.freeSlots.push(i);
      this.farFreeSlots.push(i);
    }
    this.usedSlots.length = cap;
    this.usedSlots.fill(false);
    this.farUsedSlots.length = cap;
    this.farUsedSlots.fill(false);
  }

  /** far=trueは後方LODバンク。返値は一意なencoded slot。 */
  acquire(far = false): number {
    const free = far ? this.farFreeSlots : this.freeSlots;
    const used = far ? this.farUsedSlots : this.usedSlots;
    const raw = free.pop();
    if (raw === undefined) return -1;
    used[raw] = true;
    const encoded = far ? raw + ZOMBIE_CROWD_CAPACITY : raw;
    this.activeSlots += 1;
    return encoded;
  }

  isFarSlot(slot: number): boolean {
    return slot >= ZOMBIE_CROWD_CAPACITY;
  }

  release(slot: number): void {
    if (slot < 0) return;
    const far = this.isFarSlot(slot);
    const raw = far ? slot - ZOMBIE_CROWD_CAPACITY : slot;
    const used = far ? this.farUsedSlots : this.usedSlots;
    if (raw < 0 || raw >= ZOMBIE_CROWD_CAPACITY || !used[raw]) return;
    used[raw] = false;
    this.activeSlots -= 1;
    (far ? this.farFreeSlots : this.freeSlots).push(raw);
  }

  /**
   * 1描画フレームの開始。可視個体だけを0番から詰め直すため、論理slotの穴や
   * カメラ背面の個体はGPUのinstance countへ含まれない。
   */
  beginFrame(camera?: THREE.PerspectiveCamera): void {
    this.full.writeCount = 0;
    this.far.writeCount = 0;
    if (!camera) {
      this.frustumReady = false;
      return;
    }
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.viewFrustum.setFromProjectionMatrix(this.viewProjection);
    this.frustumReady = true;
  }

  pose(slot: number, p: ZombieCrowdPose): void {
    if (slot < 0) return;
    const far = this.isFarSlot(slot);
    const raw = far ? slot - ZOMBIE_CROWD_CAPACITY : slot;
    const used = far ? this.farUsedSlots : this.usedSlots;
    if (!used[raw]) return;
    if (!p.visible) return;
    if (this.frustumReady) {
      // 足元基準のposeを全身中心へ上げ、倒れ/腕/全巨体scaleまで入る余白半径で判定する。
      // 球が画面端へ少しでも交差する間は描画するため、部位だけが急に消えることはない。
      this.cullSphere.center.set(p.x, p.y + 0.75 * p.scale, p.z);
      this.cullSphere.radius = 2.1 * p.scale;
      if (!this.viewFrustum.intersectsSphere(this.cullSphere)) return;
    }
    const meshes = far ? this.far : this.full;
    const drawIndex = meshes.writeCount;
    meshes.writeCount += 1;
    composeZombieCrowdMatrices(p, _matScratch);
    meshes.bodyArmor.setMatrixAt(drawIndex, _matScratch.body);
    meshes.bodyDark.setMatrixAt(drawIndex, _matScratch.body);
    meshes.bodyGlow.setMatrixAt(drawIndex, p.dying01 > 0 ? ZERO_M4 : _matScratch.body);
    meshes.armArmor.setMatrixAt(drawIndex, _matScratch.arm);
    meshes.armDark.setMatrixAt(drawIndex, _matScratch.arm);
    const s2 = drawIndex * 2;
    meshes.thigh.setMatrixAt(s2, _matScratch.thighL);
    meshes.thigh.setMatrixAt(s2 + 1, _matScratch.thighR);
    meshes.shin.setMatrixAt(s2, _matScratch.shinL);
    meshes.shin.setMatrixAt(s2 + 1, _matScratch.shinR);
    meshes.matrixDirty = true;
    const elite = p.elite ? 1 : 0;
    if (meshes.drawElite[drawIndex] !== elite) {
      meshes.drawElite[drawIndex] = elite;
      const skin = p.elite ? SKIN_ELITE : SKIN_NORMAL;
      const darkC = p.elite ? DARK_ELITE : DARK_NORMAL;
      meshes.bodyArmor.setColorAt(drawIndex, skin);
      meshes.armArmor.setColorAt(drawIndex, skin);
      meshes.thigh.setColorAt(s2, skin);
      meshes.thigh.setColorAt(s2 + 1, skin);
      meshes.bodyDark.setColorAt(drawIndex, darkC);
      meshes.armDark.setColorAt(drawIndex, darkC);
      meshes.shin.setColorAt(s2, darkC);
      meshes.shin.setColorAt(s2 + 1, darkC);
      meshes.colorDirty = true;
    }
  }

  commit(): void {
    this.setDrawCount(this.full, this.full.writeCount);
    this.setDrawCount(this.far, this.far.writeCount);
    this.commitSet(this.full);
    this.commitSet(this.far);
    // 次の固定tickまでにbeginFrameが呼ばれない診断/テスト経路でも、同じ個体を
    // 末尾へ積み続けないようcommitをフレーム境界として扱う。
    this.full.writeCount = 0;
    this.far.writeCount = 0;
    this.frustumReady = false;
  }

  activeCount(): number {
    return this.activeSlots;
  }

  setPrewarm(enabled: boolean): void {
    if (enabled) {
      if (!this.prewarmGroup) {
        const geo = crowdGeometries();
        const mats = sharedCrowdMats();
        const group = new THREE.Group();
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material): void => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false;
          group.add(mesh);
        };
        add(geo.bodyArmor, mats.armor);
        add(geo.bodyDark, mats.dark);
        add(geo.bodyGlow, mats.glow);
        add(geo.armArmor, mats.armor);
        add(geo.armDark, mats.dark);
        add(geo.thigh, mats.armor);
        add(geo.shin, mats.dark);
        group.scale.setScalar(0);
        this.scene.add(group);
        this.prewarmGroup = group;
      }
      this.setDrawCount(this.full, 1);
      this.setDrawCount(this.far, 1);
      return;
    }
    if (this.prewarmGroup) {
      this.scene.remove(this.prewarmGroup);
      this.prewarmGroup = null;
    }
    this.setDrawCount(this.full, this.full.writeCount);
    this.setDrawCount(this.far, this.far.writeCount);
  }

  dispose(scene: THREE.Scene): void {
    this.setPrewarm(false);
    for (const mesh of this.all) {
      scene.remove(mesh);
      mesh.dispose();
    }
  }

  private setDrawCount(meshes: CrowdMeshSet, count: number): void {
    for (const mesh of meshes.all) {
      mesh.count = mesh === meshes.thigh || mesh === meshes.shin ? count * 2 : count;
    }
  }

  private commitSet(meshes: CrowdMeshSet): void {
    for (const mesh of meshes.all) {
      if (meshes.matrixDirty) mesh.instanceMatrix.needsUpdate = true;
      if (meshes.colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    meshes.matrixDirty = false;
    meshes.colorDirty = false;
  }

}
