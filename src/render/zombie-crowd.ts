import * as THREE from 'three';
import {
  buildZombieCrowdGeometries,
  ZOMBIE_CROWD_STYLE,
  ZOMBIE_NODE_REST,
  type ZombieCrowdGeometries,
  type ZombieCrowdPose,
} from '../game/bot';

// ═══ R53-W3: ゾンビ群InstancedMeshレンダラ ═══════════════════════════════════
//
// 目的: 通常/精鋭ゾンビ(最大108体)の描画を「1体9メッシュ×108=972ドローコール」から
// 「InstancedMesh 7本」へ畳む(R51監査の支配項=描画CPUの根治)。見た目は
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

// ── 正準ジオメトリ+共有マテリアル(モジュール1回) ──────────────────────────
let canonical: ZombieCrowdGeometries | null = null;
export function crowdGeometries(): ZombieCrowdGeometries {
  if (!canonical) canonical = buildZombieCrowdGeometries();
  return canonical;
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
  const rigRotX = t > 0 ? 0 : 0.26 + Math.sin(p.anim * 3.1) * 0.045;
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
export class ZombieCrowdRenderer {
  // 7本のInstancedMesh: body系3(スロット=そのまま)、arm系2(同)、thigh/shin(スロット×2+側)
  private readonly bodyArmor: THREE.InstancedMesh;
  private readonly bodyDark: THREE.InstancedMesh;
  private readonly bodyGlow: THREE.InstancedMesh;
  private readonly armArmor: THREE.InstancedMesh;
  private readonly armDark: THREE.InstancedMesh;
  private readonly thigh: THREE.InstancedMesh;
  private readonly shin: THREE.InstancedMesh;
  private readonly all: THREE.InstancedMesh[];
  private readonly freeSlots: number[] = [];
  private readonly usedSlots: boolean[] = [];
  private maxUsed = -1;

  constructor(scene: THREE.Scene) {
    const geo = crowdGeometries();
    const mats = sharedCrowdMats();
    const cap = ZOMBIE_CROWD_CAPACITY;
    const make = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      count: number,
      colored: boolean,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(g, m, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // 群全体で1つの描画単位のため個別カリング不能 → frustumCulled必須OFF(消失バグの定番)
      mesh.frustumCulled = false;
      mesh.castShadow = false; // 影は最近接8体のObject3D経路が担う(冒頭の協定参照)
      mesh.receiveShadow = false; // 個体経路(mergeByMaterial)と同じ
      // 全スロットをスケール0で初期化(未使用スロットは描画されない)
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, ZERO_M4);
      if (colored) {
        for (let i = 0; i < count; i += 1) mesh.setColorAt(i, SKIN_NORMAL);
      }
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.bodyArmor = make(geo.bodyArmor, mats.armor, cap, true);
    this.bodyDark = make(geo.bodyDark, mats.dark, cap, true);
    this.bodyGlow = make(geo.bodyGlow, mats.glow, cap, false); // 眼は固定emissive(色乗算なし)
    this.armArmor = make(geo.armArmor, mats.armor, cap, true);
    this.armDark = make(geo.armDark, mats.dark, cap, true);
    this.thigh = make(geo.thigh, mats.armor, cap * 2, true);
    this.shin = make(geo.shin, mats.dark, cap * 2, true);
    this.all = [
      this.bodyArmor,
      this.bodyDark,
      this.bodyGlow,
      this.armArmor,
      this.armDark,
      this.thigh,
      this.shin,
    ];
    for (let i = cap - 1; i >= 0; i -= 1) this.freeSlots.push(i);
    this.usedSlots.length = cap;
    this.usedSlots.fill(false);
  }

  /** 空きスロットを割り当てる(満杯なら-1 → 呼び出し側は従来Object3D経路のままにする) */
  acquire(): number {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return -1;
    this.usedSlots[slot] = true;
    if (slot > this.maxUsed) this.maxUsed = slot;
    return slot;
  }

  /** スロットを解放し、即座に非表示(スケール0)にする */
  release(slot: number): void {
    if (slot < 0 || slot >= ZOMBIE_CROWD_CAPACITY || !this.usedSlots[slot]) return;
    this.usedSlots[slot] = false;
    this.freeSlots.push(slot);
    this.writeZero(slot);
    if (slot === this.maxUsed) {
      let m = this.maxUsed - 1;
      while (m >= 0 && !this.usedSlots[m]) m -= 1;
      this.maxUsed = m;
    }
  }

  /** 1体分の姿勢を書き込む(毎フレーム、生存+死亡演出中の個体について呼ぶ) */
  pose(slot: number, p: ZombieCrowdPose): void {
    if (slot < 0 || !this.usedSlots[slot]) return;
    if (!p.visible) {
      this.writeZero(slot);
      return;
    }
    composeZombieCrowdMatrices(p, _matScratch);
    this.bodyArmor.setMatrixAt(slot, _matScratch.body);
    this.bodyDark.setMatrixAt(slot, _matScratch.body);
    // 眼光: Object3D経路は死亡フレームでglowMatsのemissiveを0に消灯する(takeDamage)。
    // 共有マテリアルでは個体別に消せないため、死亡演出中はglowインスタンスを
    // スケール0で非表示にする(0.6sの倒れ距離では消灯と視覚等価)
    this.bodyGlow.setMatrixAt(slot, p.dying01 > 0 ? ZERO_M4 : _matScratch.body);
    this.armArmor.setMatrixAt(slot, _matScratch.arm);
    this.armDark.setMatrixAt(slot, _matScratch.arm);
    const s2 = slot * 2;
    this.thigh.setMatrixAt(s2, _matScratch.thighL);
    this.thigh.setMatrixAt(s2 + 1, _matScratch.thighR);
    this.shin.setMatrixAt(s2, _matScratch.shinL);
    this.shin.setMatrixAt(s2 + 1, _matScratch.shinR);
    // tier色(diffuse乗算)。毎フレーム書いても単なる配列書込(≦7×108)で安価・常に正しい
    const skin = p.elite ? SKIN_ELITE : SKIN_NORMAL;
    const darkC = p.elite ? DARK_ELITE : DARK_NORMAL;
    this.bodyArmor.setColorAt(slot, skin);
    this.armArmor.setColorAt(slot, skin);
    this.thigh.setColorAt(s2, skin);
    this.thigh.setColorAt(s2 + 1, skin);
    this.bodyDark.setColorAt(slot, darkC);
    this.armDark.setColorAt(slot, darkC);
    this.shin.setColorAt(s2, darkC);
    this.shin.setColorAt(s2 + 1, darkC);
  }

  /** フレーム末に1回: GPU転送フラグ+描画カウント更新 */
  commit(): void {
    const n = this.maxUsed + 1;
    for (const mesh of this.all) {
      mesh.count = mesh === this.thigh || mesh === this.shin ? n * 2 : n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** 使用中スロット数(デバッグ/perfhud用) */
  activeCount(): number {
    let c = 0;
    for (const used of this.usedSlots) if (used) c += 1;
    return c;
  }

  /** 試合dispose: シーンから外しインスタンス属性を解放する。
   * 正準ジオメトリ/共有マテリアルはモジュール寿命(有界)なので解放しない
   * (getSharedZombieDarkMat等の既存の共有資産と同じ流儀)。 */
  dispose(scene: THREE.Scene): void {
    for (const mesh of this.all) {
      scene.remove(mesh);
      mesh.dispose(); // InstancedMesh.dispose = instanceMatrix/instanceColorの解放のみ
    }
  }

  private writeZero(slot: number): void {
    this.bodyArmor.setMatrixAt(slot, ZERO_M4);
    this.bodyDark.setMatrixAt(slot, ZERO_M4);
    this.bodyGlow.setMatrixAt(slot, ZERO_M4);
    this.armArmor.setMatrixAt(slot, ZERO_M4);
    this.armDark.setMatrixAt(slot, ZERO_M4);
    const s2 = slot * 2;
    this.thigh.setMatrixAt(s2, ZERO_M4);
    this.thigh.setMatrixAt(s2 + 1, ZERO_M4);
    this.shin.setMatrixAt(s2, ZERO_M4);
    this.shin.setMatrixAt(s2 + 1, ZERO_M4);
  }
}
