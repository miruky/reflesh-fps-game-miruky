import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 一人称専用の両腕リグ。
 *
 * 旧実装の BoxGeometry 4個を置き換えるための、軽量なプロシージャル SkinnedMesh。
 * 外部glTF腕モデルを導入した後も、低品質ティア／ロード失敗時の完全なフォールバックとして
 * 残せる構造にしている。ルート名は viewmodel.ts のクナイポーズ契約と一致させること。
 */

export interface FirstPersonArmMaterials {
  readonly sleeve: THREE.MeshStandardMaterial;
  readonly glove: THREE.MeshStandardMaterial;
}

export interface FirstPersonArmPose {
  readonly arm: readonly [x: number, y: number, z: number, rx: number, ry: number, rz: number];
  readonly hand: readonly [x: number, y: number, z: number, rx: number, ry: number, rz: number];
}

export interface FirstPersonArmsOptions {
  readonly right: FirstPersonArmPose;
  readonly left: FirstPersonArmPose;
  /** クナイ用。既存の FIST_POSES が参照する名前を付ける。 */
  readonly fists?: boolean;
}

function applyPose(group: THREE.Group, pose: FirstPersonArmPose['arm'] | FirstPersonArmPose['hand']): void {
  group.position.set(pose[0], pose[1], pose[2]);
  group.rotation.set(pose[3], pose[4], pose[5]);
}

function markFirstPersonMesh(mesh: THREE.Mesh): void {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // カメラ直付けモデルはワールドのfrustum判定と一致しない場合がある。
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.firstPersonArm = true;
}

function transformGeometry(
  geometry: THREE.BufferGeometry,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  scale = new THREE.Vector3(1, 1, 1),
): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromEuler(rotation);
  geometry.applyMatrix4(new THREE.Matrix4().compose(position, q, scale));
  return geometry;
}

/** 指・手のひらを1メッシュへまとめ、指を増やしても腕ごとのDCを増やさない。 */
function buildHandGeometry(side: -1 | 1, supportHand: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 掌は球を扁平化して角を完全に消す。FPSカメラ近接でも箱に見えない輪郭を優先。
  parts.push(
    transformGeometry(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.Vector3(0, 0, 0),
      new THREE.Euler(0, 0, 0),
      new THREE.Vector3(0.038, 0.031, 0.052),
    ),
  );

  // 4指をハンドガード／グリップへ巻く。各指は近位・遠位の2節にし、関節角を少しずつ変える。
  const xOffsets = [-0.0255, -0.0085, 0.0085, 0.0255];
  for (let i = 0; i < xOffsets.length; i += 1) {
    const x = (xOffsets[i] ?? 0) * side;
    const lengthBias = i === 0 || i === 3 ? 0.9 : 1;
    const curl = supportHand ? 1.02 : 1.18;
    const proximal = new THREE.CapsuleGeometry(0.0072, 0.027 * lengthBias, 3, 6);
    transformGeometry(
      proximal,
      new THREE.Vector3(x, -0.025, -0.028),
      new THREE.Euler(curl, 0, side * (i - 1.5) * 0.035),
    );
    parts.push(proximal);

    const distal = new THREE.CapsuleGeometry(0.0067, 0.022 * lengthBias, 3, 6);
    transformGeometry(
      distal,
      new THREE.Vector3(x, -0.037, -0.049),
      new THREE.Euler(curl + 0.42, 0, side * (i - 1.5) * 0.045),
    );
    parts.push(distal);
  }

  // 親指。左右で鏡像化し、銃の側面へ自然に添わせる。
  const thumb0 = new THREE.CapsuleGeometry(0.009, 0.026, 4, 7);
  transformGeometry(
    thumb0,
    new THREE.Vector3(0.035 * side, -0.004, -0.004),
    new THREE.Euler(0.56, 0.24 * side, -0.78 * side),
  );
  parts.push(thumb0);
  const thumb1 = new THREE.CapsuleGeometry(0.008, 0.019, 4, 7);
  transformGeometry(
    thumb1,
    new THREE.Vector3(0.042 * side, -0.018, -0.021),
    new THREE.Euler(0.92, 0.18 * side, -0.62 * side),
  );
  parts.push(thumb1);

  // ナックルガードを薄い楕円で追加。グローブの面密度とシルエットを両立する。
  const guard = new THREE.SphereGeometry(1, 10, 6);
  transformGeometry(
    guard,
    new THREE.Vector3(0, 0.021, -0.018),
    new THREE.Euler(-0.12, 0, 0),
    new THREE.Vector3(0.036, 0.011, 0.031),
  );
  parts.push(guard);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('failed to build first-person hand geometry');
  merged.computeVertexNormals();
  return merged;
}

function addSkinAttributes(geometry: THREE.BufferGeometry, length: number): void {
  const pos = geometry.getAttribute('position');
  const indices = new Uint16Array(pos.count * 4);
  const weights = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + length / 2) / length, 0, 1);
    const pair = t < 0.56 ? 0 : 1;
    const local = pair === 0 ? t / 0.56 : (t - 0.56) / 0.44;
    indices[i * 4] = pair;
    indices[i * 4 + 1] = pair + 1;
    weights[i * 4] = 1 - local;
    weights[i * 4 + 1] = local;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
}

function buildSleeve(material: THREE.MeshStandardMaterial, side: -1 | 1): THREE.Group {
  const group = new THREE.Group();
  const length = 0.29;
  const geometry = new THREE.CylinderGeometry(0.036, 0.046, length, 12, 6, false);
  addSkinAttributes(geometry, length);

  const shoulder = new THREE.Bone();
  shoulder.name = side < 0 ? 'vm:leftForearmRoot' : 'vm:rightForearmRoot';
  shoulder.position.y = -length / 2;
  const elbow = new THREE.Bone();
  elbow.name = side < 0 ? 'vm:leftForearmMid' : 'vm:rightForearmMid';
  elbow.position.y = length * 0.56;
  const wrist = new THREE.Bone();
  wrist.name = side < 0 ? 'vm:leftWrist' : 'vm:rightWrist';
  wrist.position.y = length * 0.44;
  shoulder.add(elbow);
  elbow.add(wrist);

  const skeleton = new THREE.Skeleton([shoulder, elbow, wrist]);
  const sleeve = new THREE.SkinnedMesh(geometry, material);
  sleeve.name = side < 0 ? 'vm:leftSleeveSkin' : 'vm:rightSleeveSkin';
  sleeve.add(shoulder);
  sleeve.bind(skeleton);
  // 完全な直線を避けたごく小さな解剖学的カーブ。将来のglTFリグと同じ三関節構造。
  elbow.rotation.z = side * 0.035;
  wrist.rotation.x = -0.025;
  sleeve.rotation.x = Math.PI / 2;
  markFirstPersonMesh(sleeve);
  group.add(sleeve);

  // 袖口・補強パッドは非スキンだが、同じ腕ルートに追従する。1メッシュへ結合。
  const cuff = new THREE.CylinderGeometry(0.043, 0.041, 0.021, 12);
  transformGeometry(cuff, new THREE.Vector3(0, 0, -length / 2), new THREE.Euler(Math.PI / 2, 0, 0));
  const pad = new THREE.SphereGeometry(1, 10, 6);
  transformGeometry(
    pad,
    new THREE.Vector3(0, 0.035, length * 0.08),
    new THREE.Euler(0, 0, side * 0.08),
    new THREE.Vector3(0.041, 0.012, 0.064),
  );
  const armorGeo = mergeGeometries([cuff, pad], false);
  cuff.dispose();
  pad.dispose();
  if (armorGeo) {
    const armor = new THREE.Mesh(armorGeo, material);
    armor.name = side < 0 ? 'vm:leftSleeveArmor' : 'vm:rightSleeveArmor';
    markFirstPersonMesh(armor);
    group.add(armor);
  }
  return group;
}

function buildArmSide(
  side: -1 | 1,
  pose: FirstPersonArmPose,
  materials: FirstPersonArmMaterials,
  fists: boolean,
): { arm: THREE.Group; hand: THREE.Group } {
  const arm = buildSleeve(materials.sleeve, side);
  arm.name = fists
    ? side < 0 ? 'vm:fistLArm' : 'vm:fistRArm'
    : side < 0 ? 'vm:leftArm' : 'vm:rightArm';
  applyPose(arm, pose.arm);

  const hand = new THREE.Group();
  hand.name = fists
    ? side < 0 ? 'vm:fistLHand' : 'vm:fistRHand'
    : side < 0 ? 'vm:leftHand' : 'vm:rightHand';
  applyPose(hand, pose.hand);
  const handMesh = new THREE.Mesh(buildHandGeometry(side, side < 0), materials.glove);
  handMesh.name = side < 0 ? 'vm:leftGloveSkin' : 'vm:rightGloveSkin';
  markFirstPersonMesh(handMesh);
  hand.add(handMesh);
  return { arm, hand };
}

/** 両腕を同時生成する。右手=グリップ、左手=ハンドガード支持が既定。 */
export function buildFirstPersonArms(
  materials: FirstPersonArmMaterials,
  options: FirstPersonArmsOptions,
): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'vm:firstPersonArms';
  rig.userData.firstPersonArmsRig = true;
  const right = buildArmSide(1, options.right, materials, options.fists === true);
  const left = buildArmSide(-1, options.left, materials, options.fists === true);
  rig.add(right.arm, right.hand, left.arm, left.hand);
  return rig;
}

/** ViewModel.dispose から呼ぶ。SkinnedMesh固有のboneTextureを解放する。 */
export function disposeFirstPersonArmSkeletons(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
}
