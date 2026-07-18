import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 一人称専用の両腕リグ。
 *
 * 手・手首・袖口・前腕を同じ hand Group の子として組む。手と袖を別ノードで動かすと、
 * 武器別ポーズやリロード中に必ず隙間が生じるため、接続はアニメーション調整ではなく
 * 階層構造で保証する。旧来の arm Group は viewmodel のポーズ名互換用の空制御ノードとして
 * 残すが、表示ジオメトリは一切持たない。
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
  /** クナイの空いた左手だけは銃支持手ではなく、指を畳んだ近接ガードにする。 */
  readonly leftGrip?: 'support' | 'guard';
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

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  startRadius: number,
  endRadius: number,
  radialSegments: number,
): THREE.BufferGeometry {
  const delta = new THREE.Vector3().subVectors(end, start);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const geometry = new THREE.CylinderGeometry(endRadius, startRadius, delta.length(), radialSegments, 2);
  // 人体の前腕断面は真円ではない。画面正対方向を少し潰し、均一な配管形状を避ける。
  geometry.scale(1.08, 1, 0.82);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  geometry.applyMatrix4(new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1)));
  return geometry;
}

function tintGeometry(geometry: THREE.BufferGeometry, value: number): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    colors[i * 3] = value;
    colors[i * 3 + 1] = value;
    colors[i * 3 + 2] = value;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

type HandMaterialFamily = 'glove' | 'palm' | 'armor' | 'stitch';

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
 * フルフィンガーのタクティカルグローブにすることで、どの武器色／迷彩でも銃の一部に見えない。
 * familyごとに結合するため、形状密度を増やしても片手4DCに固定される。
 */
function buildHandGeometries(
  side: -1 | 1,
  grip: 'trigger' | 'support' | 'guard',
): Record<HandMaterialFamily, THREE.BufferGeometry> {
  // 支持手は掌を銃側(+local Y)へ向ける。単純に左手を右手と同じ向きで置くと、
  // 手の甲がハンドガードへ貼り付き「銃の部品」に見える。いったん反対側の手型を作って
  // Z軸で180°返すことで、親指の左右は正しいまま掌・4指だけを銃へ巻き付ける。
  const supportHand = grip !== 'trigger';
  const guardHand = grip === 'guard';
  const geometrySide: -1 | 1 = supportHand ? (side === -1 ? 1 : -1) : side;
  const buckets: Record<HandMaterialFamily, THREE.BufferGeometry[]> = {
    glove: [],
    palm: [],
    armor: [],
    stitch: [],
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
      new THREE.Vector3(0, -0.027, guardHand ? 0.004 : -0.002),
      new THREE.Euler(0.08, 0, 0),
      new THREE.Vector3(0.032, 0.005, guardHand ? 0.036 : 0.043),
    ),
  );

  const xOffsets = [-0.027, -0.009, 0.009, 0.027];
  for (let i = 0; i < xOffsets.length; i += 1) {
    const x = (xOffsets[i] ?? 0) * geometrySide;
    const edge = i === 0 || i === 3;
    const lengthBias = edge ? 0.88 : 1;
    // 右人差し指だけ僅かに伸ばし、トリガーへ掛かる輪郭を作る。支持手は4指を均等に巻く。
    const triggerFinger = !supportHand && i === 0;
    const curl = triggerFinger ? 0.66 : guardHand ? 1.9 : supportHand ? 1.52 : 1.02;
    const spread = geometrySide * (i - 1.5) * 0.035;

    const proximal = new THREE.CapsuleGeometry(
      0.0083,
      (supportHand && !guardHand ? 0.022 : 0.025) * lengthBias,
      4,
      7,
    );
    transformGeometry(
      proximal,
      new THREE.Vector3(
        x,
        guardHand ? 0 : supportHand ? -0.004 : -0.013,
        guardHand ? -0.022 : supportHand ? -0.026 : -0.033,
      ),
      new THREE.Euler(curl, 0, spread),
    );
    buckets.glove.push(proximal);

    const middle = new THREE.CapsuleGeometry(
      0.0075,
      (triggerFinger ? 0.028 : supportHand && !guardHand ? 0.0185 : 0.021) * lengthBias,
      4,
      7,
    );
    transformGeometry(
      middle,
      new THREE.Vector3(
        x,
        triggerFinger ? -0.022 : guardHand ? -0.01 : supportHand ? -0.012 : -0.030,
        triggerFinger ? -0.059 : guardHand ? -0.034 : supportHand ? -0.043 : -0.055,
      ),
      new THREE.Euler(curl + (triggerFinger ? 0.18 : 0.34), 0, spread * 1.15),
    );
    // フルフィンガー軍用手袋。掌側の別素材で節を読み分け、肌色の棒には見せない。
    buckets.palm.push(middle);

    const tip = new THREE.CapsuleGeometry(
      0.0069,
      (supportHand && !guardHand ? 0.011 : 0.013) * lengthBias,
      4,
      7,
    );
    transformGeometry(
      tip,
      new THREE.Vector3(
        x,
        triggerFinger ? -0.031 : guardHand ? 0.004 : supportHand ? 0.003 : -0.044,
        triggerFinger ? -0.080 : guardHand ? -0.025 : supportHand ? -0.05 : -0.066,
      ),
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
    new THREE.Vector3((guardHand ? 0.033 : 0.037) * geometrySide, -0.002, guardHand ? 0.008 : 0.001),
    new THREE.Euler(0.52, 0.24 * geometrySide, -0.78 * geometrySide),
  );
  buckets.glove.push(thumb0);
  const thumb1 = new THREE.CapsuleGeometry(0.0086, 0.021, 4, 8);
  transformGeometry(
    thumb1,
    new THREE.Vector3((guardHand ? 0.041 : 0.047) * geometrySide, guardHand ? -0.014 : -0.019, guardHand ? -0.012 : -0.023),
    new THREE.Euler(0.92, 0.2 * geometrySide, -0.62 * geometrySide),
  );
  buckets.palm.push(thumb1);

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
      new THREE.Vector3(sx * geometrySide, 0.029, 0.014),
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
    buckets.stitch.push(stitch);
  }

  const merged = {
    glove: mergeHandParts(buckets.glove, 'glove'),
    palm: mergeHandParts(buckets.palm, 'palm'),
    armor: mergeHandParts(buckets.armor, 'armor'),
    stitch: mergeHandParts(buckets.stitch, 'stitch'),
  };
  if (supportHand) {
    for (const geometry of Object.values(merged)) {
      geometry.rotateZ(Math.PI);
      geometry.computeBoundingBox();
      geometry.userData.palmFacesWeapon = true;
    }
  }
  return merged;
}

function buildConnectedSleeve(
  side: -1 | 1,
  material: THREE.MeshStandardMaterial,
  pose: FirstPersonArmPose,
): THREE.Mesh {
  // 手首を始点、武器別 arm.position を画面下側の肘／肩アンカーとして使う。
  // 以前は全武器で hand local +Z へ固定生成していたため、手を内側へ回すほど袖まで
  // 画面右へ捻れ、両腕が一本化して見えていた。アンカーを hand local へ逆変換すれば、
  // 掌の回転と「腕が身体へ帰る方向」を独立させつつ、接続自体は hand 階層で保証できる。
  const wrist = new THREE.Vector3(0, 0, 0.073);
  const handPosition = new THREE.Vector3(pose.hand[0], pose.hand[1], pose.hand[2]);
  const handRotation = new THREE.Euler(pose.hand[3], pose.hand[4], pose.hand[5]);
  const inverseHandRotation = new THREE.Quaternion().setFromEuler(handRotation).invert();
  const elbow = new THREE.Vector3(pose.arm[0], pose.arm[1], pose.arm[2])
    .sub(handPosition)
    .applyQuaternion(inverseHandRotation);
  // 肘までの直線を二度だけ穏やかに曲げる。曲げ量はアンカー距離に比例し、拳銃から
  // 重火器まで同じ解像度／同じ5DCのまま、配管ではなく自然な前腕シルエットにする。
  const reach = wrist.distanceTo(elbow);
  const bend = new THREE.Vector3(0.018 * side, -0.014, Math.min(0.026, reach * 0.08));
  const fore = wrist.clone().lerp(elbow, 0.3).addScaledVector(bend, 0.75);
  const mid = wrist.clone().lerp(elbow, 0.64).add(bend);
  const parts: THREE.BufferGeometry[] = [
    cylinderBetween(wrist, fore, 0.031, 0.036, 16),
    cylinderBetween(fore, mid, 0.036, 0.044, 16),
    cylinderBetween(mid, elbow, 0.044, 0.056, 16),
  ];
  tintGeometry(parts[0]!, 0.96);
  tintGeometry(parts[1]!, 0.9);
  tintGeometry(parts[2]!, 0.8);

  // 袖口と皺は同一ジオメトリへ結合。追加ドローコール無しで布らしい輪郭を残す。
  const cuff = new THREE.CylinderGeometry(0.037, 0.034, 0.026, 10, 1);
  transformGeometry(cuff, new THREE.Vector3(0, 0, 0.084), new THREE.Euler(Math.PI / 2, 0, 0));
  tintGeometry(cuff, 0.7);
  parts.push(cuff);
  for (const [x, y, z, radius] of [
    [0.006 * side, -0.005, 0.13, 0.035],
    [0.022 * side, -0.021, 0.205, 0.041],
    [0.043 * side, -0.054, 0.292, 0.05],
  ] as const) {
    const fold = new THREE.TorusGeometry(radius, 0.0019, 4, 14);
    transformGeometry(
      fold,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(Math.PI / 2 + 0.12, side * 0.04, 0),
      new THREE.Vector3(1, 0.8, 1),
    );
    tintGeometry(fold, 1.08);
    parts.push(fold);
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('failed to build connected first-person sleeve geometry');
  geometry.computeVertexNormals();
  const sleeve = new THREE.Mesh(geometry, material);
  sleeve.name = side < 0 ? 'vm:leftSleeveConnected' : 'vm:rightSleeveConnected';
  sleeve.userData.connectedToHand = true;
  markFirstPersonMesh(sleeve);
  return sleeve;
}

function buildArmSide(
  side: -1 | 1,
  pose: FirstPersonArmPose,
  materials: FirstPersonArmMaterials,
  fists: boolean,
  grip: 'trigger' | 'support' | 'guard',
): { arm: THREE.Group; hand: THREE.Group } {
  // viewmodel の既存名/FIST_POSES互換を守る空制御ノード。表示物を持たせないことで
  // hand と別々に動かされても腕だけが浮く状態を構造的に排除する。
  const arm = new THREE.Group();
  arm.name = fists
    ? side < 0 ? 'vm:fistLArm' : 'vm:fistRArm'
    : side < 0 ? 'vm:leftArm' : 'vm:rightArm';
  arm.userData.poseControlOnly = true;
  applyPose(arm, pose.arm);

  const hand = new THREE.Group();
  hand.name = fists
    ? side < 0 ? 'vm:fistLHand' : 'vm:fistRHand'
    : side < 0 ? 'vm:leftHand' : 'vm:rightHand';
  applyPose(hand, pose.hand);
  hand.userData.connectedLimb = true;
  hand.userData.palmFacesWeapon = side < 0;
  hand.add(buildConnectedSleeve(side, materials.sleeve, pose));
  const geometries = buildHandGeometries(side, grip);
  const handMeshes: Array<[HandMaterialFamily, THREE.MeshStandardMaterial]> = [
    ['glove', materials.glove],
    ['palm', materials.glovePalm],
    ['armor', materials.gloveArmor],
    ['stitch', materials.gloveStitch],
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
  const right = buildArmSide(1, options.right, materials, options.fists === true, 'trigger');
  const left = buildArmSide(
    -1,
    options.left,
    materials,
    options.fists === true,
    options.leftGrip ?? (options.fists === true ? 'guard' : 'support'),
  );
  rig.add(right.arm, right.hand, left.arm, left.hand);
  return rig;
}

/** ViewModel.dispose から呼ぶ。旧キャッシュにSkinnedMeshが残る場合も安全に解放する。 */
export function disposeFirstPersonArmSkeletons(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
}
