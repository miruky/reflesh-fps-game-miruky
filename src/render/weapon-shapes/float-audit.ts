// R59 MODEL-FLOAT: 全武器「浮遊パーツ」機械監査。
// buildGunBody の構造系ジオメトリ(頂点カラー材 = metal/polish/poly バケツ + 可動 vm:* ノード)を
// プリミティブ単位へ再分解し(厳密一致頂点の union-find)、パーツAABBを ε 膨張して重畳グラフ →
// 連結成分に分解する。最大質量成分=本体クラスタ、本体に連結しない成分=浮遊クラスタ。
// サイト系(耳/ドット=viewmodel 所有。R59時点の耳は基部が浮いており、SIGHT-CORE が並行して
// 基部接続+プロポーション調整で維持する)と意匠上の浮遊(手裏剣の浮遊星など早期分岐=
// viewmodel 所有)は ALLOWED_FLOATS(除外リスト)で管理する。
// 発光帯(accent)/レンズ/加算ドットは頂点カラー材ではないため監査対象外(装飾)。
import * as THREE from 'three';
import type { WeaponDef } from '../../game/weapons';
import { buildGunBody } from '../viewmodel';

// パーツ(=1プリミティブ)の世界AABB。
interface PartBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  vol: number;
}

export interface FloatCluster {
  parts: number;
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  // Σ パーツAABB体積(m³)。本体クラスタ判定(最大質量)に使う
  mass: number;
}

export interface FloatReport {
  weaponId: string;
  // 全連結クラスタ数(本体含む)
  clusters: number;
  // 除外リスト適用後も残る「未許容の浮遊クラスタ」= 修正対象
  floating: FloatCluster[];
  // 除外リスト該当(サイト系/意匠上の浮遊)
  allowed: Array<{ cluster: FloatCluster; reason: string }>;
}

// パーツ間の連結許容ギャップ(m)。各AABBを半分ずつ膨らませ、隙間がこの値以下なら連結とみなす。
export const FLOAT_GAP_TOLERANCE = 0.004;

// ── ジオメトリ → プリミティブパーツ分解 ─────────────────────────────────
// merge 済みバケツは非indexed連結バッファ。同一プリミティブ内の頂点は座標が厳密一致
// (同じ入力座標×同じ行列)するため、量子化キーの union-find で復元できる。
const Q = 2e5; // 5e-6 m 格子(意図的な隙間より4桁小さい)
function partsFromMesh(mesh: THREE.Mesh, out: PartBox[]): void {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  if (!(pos instanceof THREE.BufferAttribute)) return;
  const n = pos.count;
  if (n === 0) return;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    // 経路圧縮
    let c = i;
    while (parent[c] !== r) {
      const nx = parent[c] as number;
      parent[c] = r;
      c = nx;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // 同一座標頂点を束ねる(ローカル座標で厳密。行列適用前=数値誤差なし)
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const key = `${Math.round(pos.getX(i) * Q)}_${Math.round(pos.getY(i) * Q)}_${Math.round(pos.getZ(i) * Q)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else union(i, first);
  }
  // 三角形の3頂点を束ねる(indexed/非indexed両対応)
  const index = geo.getIndex();
  if (index) {
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      union(a, b);
      union(b, c);
    }
  } else {
    for (let v = 0; v + 2 < n; v += 3) {
      union(v, v + 1);
      union(v + 1, v + 2);
    }
  }
  // ルートごとに世界AABBを集計
  const boxes = new Map<number, PartBox>();
  const w = new THREE.Vector3();
  for (let i = 0; i < n; i += 1) {
    w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    const r = find(i);
    let b = boxes.get(r);
    if (!b) {
      b = { minX: w.x, minY: w.y, minZ: w.z, maxX: w.x, maxY: w.y, maxZ: w.z, vol: 0 };
      boxes.set(r, b);
    } else {
      if (w.x < b.minX) b.minX = w.x;
      if (w.y < b.minY) b.minY = w.y;
      if (w.z < b.minZ) b.minZ = w.z;
      if (w.x > b.maxX) b.maxX = w.x;
      if (w.y > b.maxY) b.maxY = w.y;
      if (w.z > b.maxZ) b.maxZ = w.z;
    }
  }
  for (const b of boxes.values()) {
    b.vol = Math.max(1e-12, (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ));
    out.push(b);
  }
}

// 構造系メッシュ(頂点カラー材 = metal/polish/poly + vm:* 可動)だけを分解する。
// accent(発光帯)/レンズ/加算ドットは vertexColors:false なので対象外(装飾=除外リスト管理)。
export function collectStructuralParts(root: THREE.Object3D): PartBox[] {
  root.updateMatrixWorld(true);
  const parts: PartBox[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!(mat instanceof THREE.MeshStandardMaterial) || mat.vertexColors !== true) return;
    partsFromMesh(o, parts);
  });
  return parts;
}

// パーツAABBを tol/2 ずつ膨らませた重畳グラフの連結成分(質量降順)。
export function clusterParts(parts: PartBox[], tol: number): FloatCluster[] {
  const n = parts.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    let c = i;
    while (parent[c] !== r) {
      const nx = parent[c] as number;
      parent[c] = r;
      c = nx;
    }
    return r;
  };
  const half = tol / 2;
  for (let i = 0; i < n; i += 1) {
    const a = parts[i] as PartBox;
    for (let j = i + 1; j < n; j += 1) {
      const b = parts[j] as PartBox;
      if (
        a.minX - half <= b.maxX + half &&
        a.maxX + half >= b.minX - half &&
        a.minY - half <= b.maxY + half &&
        a.maxY + half >= b.minY - half &&
        a.minZ - half <= b.maxZ + half &&
        a.maxZ + half >= b.minZ - half
      ) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const acc = new Map<number, { box: PartBox; parts: number; mass: number }>();
  for (let i = 0; i < n; i += 1) {
    const p = parts[i] as PartBox;
    const r = find(i);
    const cur = acc.get(r);
    if (!cur) {
      acc.set(r, { box: { ...p }, parts: 1, mass: p.vol });
    } else {
      cur.parts += 1;
      cur.mass += p.vol;
      if (p.minX < cur.box.minX) cur.box.minX = p.minX;
      if (p.minY < cur.box.minY) cur.box.minY = p.minY;
      if (p.minZ < cur.box.minZ) cur.box.minZ = p.minZ;
      if (p.maxX > cur.box.maxX) cur.box.maxX = p.maxX;
      if (p.maxY > cur.box.maxY) cur.box.maxY = p.maxY;
      if (p.maxZ > cur.box.maxZ) cur.box.maxZ = p.maxZ;
    }
  }
  const clusters: FloatCluster[] = [];
  for (const { box, parts: pc, mass } of acc.values()) {
    clusters.push({
      parts: pc,
      center: {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
        z: (box.minZ + box.maxZ) / 2,
      },
      size: { x: box.maxX - box.minX, y: box.maxY - box.minY, z: box.maxZ - box.minZ },
      mass,
    });
  }
  clusters.sort((a, b) => b.mass - a.mass);
  return clusters;
}

// ── 除外リスト(サイト系/viewmodel 所有の意匠浮遊)──────────────────────────
// 「許容」であって「必須」ではない: SIGHT-CORE が耳を全廃しても本テストは緑のまま
// (並行作業と衝突しない)。座標±tol で照合し、理由を報告に残す。
interface AllowRule {
  // 照合: クラスタ中心が (x,y,z)±tol に入り、サイズが maxSize 以下
  x: number;
  y: number;
  z: number;
  tol: number;
  maxSize: { x: number; y: number; z: number };
  reason: string;
}

// アイアンサイト「耳」(+基部ポスト)ペア: viewmodel 所有(SIGHT-CORE が基部接続を並行修正)。
// R59時点: x=±0.038 の細長い縦板はバレルと x 方向に重ならず構造的に浮く(接続後も許容のまま
// =SIGHT-CORE がどちらの状態でも本テストは緑)。
function isIronEar(c: FloatCluster): boolean {
  const ax = Math.abs(c.center.x);
  return (
    ax >= 0.025 &&
    ax <= 0.06 &&
    c.size.x <= 0.03 &&
    c.size.z <= 0.03 &&
    c.size.y <= 0.14 &&
    c.center.y >= 0.02 &&
    c.center.y <= 0.11 &&
    c.mass <= 3e-5
  );
}

// weaponId ごとの明示除外(意匠上の浮遊=早期分岐など viewmodel 所有)。
const ALLOWED_FLOATS: Record<string, AllowRule[]> = {
  // 手裏剣ホルダー: 浮遊十字手裏剣3枚は意匠(ホルダーハブ上の反重力スタック)。
  'banjin-smg': [
    {
      x: 0,
      y: 0.01,
      z: -0.11,
      tol: 0.08,
      maxSize: { x: 0.2, y: 0.06, z: 0.15 },
      reason: '浮遊手裏剣スタック(意匠・viewmodel早期分岐)',
    },
  ],
  // 和弓: 上リム先端セグメント(湾曲チェーンの1節が5mm弱の継ぎ目ギャップ)。
  // viewmodel 早期分岐所有=painter からは接続不可。至近で継ぎ目は読めない(要 viewmodel 側修正)。
  'gekkou-bow': [
    {
      x: 0,
      y: 0.38,
      z: -0.06,
      tol: 0.05,
      maxSize: { x: 0.05, y: 0.15, z: 0.1 },
      reason: '弓上リム節の継ぎ目ギャップ(viewmodel早期分岐所有)',
    },
  ],
  // 鉄扇: 柄/房アセンブリが扇骨ピボットと数mmの継ぎ目ギャップ。
  // viewmodel 早期分岐所有=painter からは接続不可(要 viewmodel 側修正)。
  'fujin-fan': [
    {
      x: 0,
      y: -0.073,
      z: 0.04,
      tol: 0.06,
      maxSize: { x: 0.08, y: 0.25, z: 0.1 },
      reason: '扇の柄/房と骨ピボットの継ぎ目ギャップ(viewmodel早期分岐所有)',
    },
  ],
};

// 1挺を監査する。カモは明示 null(プロファイル非依存=決定的)。
export function auditWeaponFloat(def: WeaponDef): FloatReport {
  const built = buildGunBody({ ...def, attachmentIds: def.attachmentIds ?? [] }, null);
  const parts = collectStructuralParts(built.gun);
  const clusters = clusterParts(parts, FLOAT_GAP_TOLERANCE);
  // この銃専有のジオメトリを破棄(材質は共有シングルトンなので触らない)
  built.gun.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  const floating: FloatCluster[] = [];
  const allowed: Array<{ cluster: FloatCluster; reason: string }> = [];
  const rules = ALLOWED_FLOATS[def.id] ?? [];
  // clusters[0]=最大質量=本体。以降を分類する。
  for (let i = 1; i < clusters.length; i += 1) {
    const c = clusters[i] as FloatCluster;
    if (isIronEar(c)) {
      allowed.push({ cluster: c, reason: 'アイアン耳/基部ポスト(サイト系=SIGHT-CORE所有・維持)' });
      continue;
    }
    const rule = rules.find(
      (r) =>
        Math.abs(c.center.x - r.x) <= r.tol &&
        Math.abs(c.center.y - r.y) <= r.tol &&
        Math.abs(c.center.z - r.z) <= r.tol &&
        c.size.x <= r.maxSize.x &&
        c.size.y <= r.maxSize.y &&
        c.size.z <= r.maxSize.z,
    );
    if (rule) {
      allowed.push({ cluster: c, reason: rule.reason });
      continue;
    }
    floating.push(c);
  }
  return { weaponId: def.id, clusters: clusters.length, floating, allowed };
}

// 監査表の1行(デバッグ/レポート用)。
export function formatCluster(c: FloatCluster): string {
  const f = (v: number): string => v.toFixed(3);
  return `parts=${c.parts} c=(${f(c.center.x)},${f(c.center.y)},${f(c.center.z)}) s=(${f(c.size.x)},${f(c.size.y)},${f(c.size.z)}) m=${c.mass.toExponential(1)}`;
}
