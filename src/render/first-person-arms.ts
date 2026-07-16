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
  readonly glovePalm: THREE.MeshStandardMaterial;
  readonly gloveArmor: THREE.MeshStandardMaterial;
  readonly gloveStitch: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;
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

type HandMaterialFamily = 'glove' | 'palm' | 'armor' | 'stitch' | 'skin';

function mergeHandParts(parts: THREE.BufferGeometry[], family: HandMaterialFamily): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`failed to build first-person hand ${family} geometry`);
  merged.computeVertexNormals();
  merged.userData.handMaterialFamily = family;
  return merged;
}

/**
 * 手を「暗い一塊」ではなく、手首・掌・5本指・関節・掌パッド・縫い目へ分ける。
 * 指先を露出したタクティカルグローブにすることで、どの武器色／迷彩でも銃の一部に見えない。
 * familyごとに結合するため、形状密度を増やしても片手5DCに固定される。
 */
function buildHandGeometries(
  side: -1 | 1,
  supportHand: boolean,
): Record<HandMaterialFamily, THREE.BufferGeometry> {
  const buckets: Record<HandMaterialFamily, THREE.BufferGeometry[]> = {
    glove: [],
    palm: [],
    armor: [],
    stitch: [],
    skin: [],
  };

  // 手首から掌までを連続させる。旧実装では掌だけが銃の下に浮き、黒い銃床に見えていた。
  buckets.glove.push(
    transformGeometry(
      new THREE.CylinderGeometry(0.027, 0.034, 0.062, 12, 2),
      new THREE.Vector3(0, 0, 0.067),
      new THREE.Euler(Math.PI / 2, 0, 0),
    ),
    transformGeometry(
      new THREE.SphereGeometry(1, 16, 10),
      new THREE.Vector3(0, 0.001, 0.005),
      new THREE.Euler(-0.08, 0, 0),
      new THREE.Vector3(0.043, 0.032, 0.059),
    ),
  );

  // 掌側の明るいスエードパッド。粗さと明度差で、金属レシーバとの境界を常に読ませる。
  buckets.palm.push(
    transformGeometry(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.Vector3(0, -0.028, -0.002),
      new THREE.Euler(0.08, 0, 0),
      new THREE.Vector3(0.034, 0.006, 0.043),
    ),
  );

  const xOffsets = [-0.027, -0.009, 0.009, 0.027];
  for (let i = 0; i < xOffsets.length; i += 1) {
    const x = (xOffsets[i] ?? 0) * side;
    const edge = i === 0 || i === 3;
    const lengthBias = edge ? 0.88 : 1;
    // 右人差し指だけ僅かに伸ばし、トリガーへ掛かる輪郭を作る。支持手は4指を均等に巻く。
    const triggerFinger = !supportHand && i === 0;
    const curl = triggerFinger ? 0.66 : supportHand ? 1.08 : 1.02;
    const spread = side * (i - 1.5) * 0.035;

    const proximal = new THREE.CapsuleGeometry(0.0083, 0.025 * lengthBias, 4, 7);
    transformGeometry(
      proximal,
      new THREE.Vector3(x, -0.013, -0.033),
      new THREE.Euler(curl, 0, spread),
    );
    buckets.glove.push(proximal);

    const middle = new THREE.CapsuleGeometry(0.0075, (triggerFinger ? 0.028 : 0.021) * lengthBias, 4, 7);
    transformGeometry(
      middle,
      new THREE.Vector3(x, triggerFinger ? -0.022 : -0.030, triggerFinger ? -0.059 : -0.055),
      new THREE.Euler(curl + (triggerFinger ? 0.18 : 0.34), 0, spread * 1.15),
    );
    // フルフィンガー軍用手袋。掌側の別素材で節を読み分け、肌色の棒には見せない。
    buckets.palm.push(middle);

    const tip = new THREE.CapsuleGeometry(0.0069, 0.013 * lengthBias, 4, 7);
    transformGeometry(
      tip,
      new THREE.Vector3(x, triggerFinger ? -0.031 : -0.044, triggerFinger ? -0.080 : -0.066),
      new THREE.Euler(curl + (triggerFinger ? 0.28 : 0.58), 0, spread * 1.25),
    );
    buckets.glove.push(tip);

    // 独立した4つのナックル。大きな一枚板を廃止し、指の始点を目で追えるようにする。
    const knuckle = new THREE.SphereGeometry(1, 9, 6);
    transformGeometry(
      knuckle,
      new THREE.Vector3(x, 0.029, -0.023),
      new THREE.Euler(-0.12, 0, spread),
      new THREE.Vector3(0.0092, 0.006, 0.0115),
    );
    buckets.armor.push(knuckle);
  }

  // 親指は掌の横から斜めに生える2節構造。フルフィンガー手袋として材質を統一する。
  const thumb0 = new THREE.CapsuleGeometry(0.0102, 0.027, 4, 8);
  transformGeometry(
    thumb0,
    new THREE.Vector3(0.037 * side, -0.002, 0.001),
    new THREE.Euler(0.52, 0.24 * side, -0.78 * side),
  );
  buckets.glove.push(thumb0);
  const thumb1 = new THREE.CapsuleGeometry(0.0086, 0.021, 4, 8);
  transformGeometry(
    thumb1,
    new THREE.Vector3(0.047 * side, -0.019, -0.023),
    new THREE.Euler(0.92, 0.2 * side, -0.62 * side),
  );
  buckets.palm.push(thumb1);

  // 手袋と袖口の間に見える細いインナー。露出指のような強い暖色面積を作らない。
  const innerCuff = new THREE.TorusGeometry(0.0285, 0.0018, 5, 18);
  innerCuff.translate(0, 0, 0.071);
  buckets.skin.push(innerCuff);

  // 分割型ナックルプレート、手首ストラップ、掌の縫製線。小さな陰影が距離感を作る。
  const backPlate = new THREE.SphereGeometry(1, 12, 7);
  transformGeometry(
    backPlate,
    new THREE.Vector3(0, 0.026, 0.008),
    new THREE.Euler(-0.08, 0, 0),
    new THREE.Vector3(0.031, 0.0065, 0.029),
  );
  buckets.armor.push(backPlate);
  const wristStrap = new THREE.TorusGeometry(0.031, 0.0032, 5, 18);
  wristStrap.translate(0, 0, 0.079);
  buckets.armor.push(wristStrap);
  const seam = new THREE.CapsuleGeometry(0.0014, 0.058, 2, 5);
  transformGeometry(
    seam,
    new THREE.Vector3(0, 0.0325, 0.012),
    new THREE.Euler(0, 0, Math.PI / 2),
  );
  buckets.stitch.push(seam);
  for (const sx of [-0.024, 0.024]) {
    const stitch = new THREE.CapsuleGeometry(0.0012, 0.042, 2, 5);
    transformGeometry(
      stitch,
      new THREE.Vector3(sx * side, 0.029, 0.014),
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
    buckets.stitch.push(stitch);
  }

  return {
    glove: mergeHandParts(buckets.glove, 'glove'),
    palm: mergeHandParts(buckets.palm, 'palm'),
    armor: mergeHandParts(buckets.armor, 'armor'),
    stitch: mergeHandParts(buckets.stitch, 'stitch'),
    skin: mergeHandParts(buckets.skin, 'skin'),
  };
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

function buildSleeve(materials: FirstPersonArmMaterials, side: -1 | 1): THREE.Group {
  const group = new THREE.Group();
  const length = 0.255;
  const geometry = new THREE.CylinderGeometry(0.032, 0.043, length, 14, 7, false);
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
  const sleeve = new THREE.SkinnedMesh(geometry, materials.sleeve);
  sleeve.name = side < 0 ? 'vm:leftSleeveSkin' : 'vm:rightSleeveSkin';
  sleeve.add(shoulder);
  sleeve.bind(skeleton);
  // 完全な直線を避けたごく小さな解剖学的カーブ。将来のglTFリグと同じ三関節構造。
  elbow.rotation.z = side * 0.035;
  wrist.rotation.x = -0.025;
  sleeve.rotation.x = Math.PI / 2;
  markFirstPersonMesh(sleeve);
  group.add(sleeve);

  // 袖口と布の皺を同素材でまとめ、滑らかな円柱ではなく布製前腕として読ませる。
  const cuff = new THREE.CylinderGeometry(0.038, 0.036, 0.022, 14);
  transformGeometry(cuff, new THREE.Vector3(0, 0, -length / 2), new THREE.Euler(Math.PI / 2, 0, 0));
  const clothParts: THREE.BufferGeometry[] = [cuff];
  for (const [z, radius, squash] of [
    [-length * 0.24, 0.034, 0.68],
    [length * 0.04, 0.038, 0.74],
    [length * 0.28, 0.041, 0.7],
  ] as const) {
    const fold = new THREE.TorusGeometry(radius, 0.0021, 5, 18);
    transformGeometry(
      fold,
      new THREE.Vector3(0, 0, z),
      new THREE.Euler(Math.PI / 2 + side * 0.035, 0, 0),
      new THREE.Vector3(1, squash, 1),
    );
    clothParts.push(fold);
  }
  const clothGeo = mergeGeometries(clothParts, false);
  for (const part of clothParts) part.dispose();
  if (clothGeo) {
    const cloth = new THREE.Mesh(clothGeo, materials.sleeve);
    cloth.name = side < 0 ? 'vm:leftSleeveFolds' : 'vm:rightSleeveFolds';
    markFirstPersonMesh(cloth);
    group.add(cloth);
  }

  // 肘側の薄い補強パッド。旧形状より小さくし、銃床のような黒い塊を作らない。
  const pad = new THREE.SphereGeometry(1, 10, 6);
  transformGeometry(
    pad,
    new THREE.Vector3(0, 0.032, length * 0.15),
    new THREE.Euler(0, 0, side * 0.08),
    new THREE.Vector3(0.034, 0.008, 0.05),
  );
  const armor = new THREE.Mesh(pad, materials.gloveArmor);
  armor.name = side < 0 ? 'vm:leftSleeveArmor' : 'vm:rightSleeveArmor';
  markFirstPersonMesh(armor);
  group.add(armor);
  return group;
}

function buildArmSide(
  side: -1 | 1,
  pose: FirstPersonArmPose,
  materials: FirstPersonArmMaterials,
  fists: boolean,
): { arm: THREE.Group; hand: THREE.Group } {
  const arm = buildSleeve(materials, side);
  arm.name = fists
    ? side < 0 ? 'vm:fistLArm' : 'vm:fistRArm'
    : side < 0 ? 'vm:leftArm' : 'vm:rightArm';
  applyPose(arm, pose.arm);

  const hand = new THREE.Group();
  hand.name = fists
    ? side < 0 ? 'vm:fistLHand' : 'vm:fistRHand'
    : side < 0 ? 'vm:leftHand' : 'vm:rightHand';
  applyPose(hand, pose.hand);
  const geometries = buildHandGeometries(side, side < 0);
  const handMeshes: Array<[HandMaterialFamily, THREE.MeshStandardMaterial]> = [
    ['glove', materials.glove],
    ['palm', materials.glovePalm],
    ['armor', materials.gloveArmor],
    ['stitch', materials.gloveStitch],
    ['skin', materials.skin],
  ];
  for (const [family, material] of handMeshes) {
    const handMesh = new THREE.Mesh(geometries[family], material);
    handMesh.name = family === 'glove'
      ? side < 0 ? 'vm:leftGloveSkin' : 'vm:rightGloveSkin'
      : `vm:${side < 0 ? 'left' : 'right'}Hand:${family}`;
    markFirstPersonMesh(handMesh);
    hand.add(handMesh);
  }
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
