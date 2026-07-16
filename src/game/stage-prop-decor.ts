import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StageDef, StageLayout } from './stage';

// ステージ障害物の装飾生成をMatchの進行制御から分離する。物理・ゲーム状態には触れず、
// 渡されたSceneへ決定論的な装飾メッシュだけを追加する。
function classifyArchetype(
  spec: { x: number; z: number; w: number; h: number; d: number; color: string; emissive: boolean },
  palette: StageDef['palette'],
): 'wall' | 'container' | 'blastBarrier' | 'ammoCrate' | 'drum' | 'sandbag' {
  const foot = Math.min(spec.w, spec.d);
  const aspect = Math.max(spec.w, spec.d) / Math.max(0.001, foot);
  const area = spec.w * spec.d;
  // 周壁ガード: generateStageが先に積む4枚の周壁(壁色・薄い・高い)を巨大バリア化させない
  if (spec.color === palette.wall && foot <= 1.5) return 'wall';
  if (spec.h >= 1.3) {
    if (foot <= 2.5 && aspect >= 2) return 'blastBarrier';
    return 'container';
  }
  if (aspect >= 2.2) return 'sandbag';
  if (area <= 9) return 'ammoCrate';
  return 'drum';
}

export function buildStagePropDecor(
  scene: THREE.Scene,
  boxes: StageLayout['boxes'],
  palette: StageDef['palette'],
): void {
  const clampN = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  const derive = (hex: string, dL: number, dS = 0): THREE.Color => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, clampN(hsl.s + dS, 0, 1), clampN(hsl.l + dL, 0, 1));
    return c;
  };

  // 系統別パーツ配列(ワールド座標に焼き込んだジオメトリ片)
  const reliefParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const shadowParts: THREE.BufferGeometry[] = [];
  const castingMatrices: THREE.Matrix4[] = [];
  const temps: THREE.BufferGeometry[] = [];

  // テンプレ(ループ外で1回)。最後にまとめて破棄する
  const slabTpl = new THREE.BoxGeometry(1, 1, 1);
  const capsuleTpl = new THREE.CapsuleGeometry(0.16, 0.34, 3, 6);
  const planeTpl = new THREE.PlaneGeometry(1, 1);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const vPos = new THREE.Vector3();
  const vScale = new THREE.Vector3();

  const setColor = (g: THREE.BufferGeometry, color: THREE.Color): void => {
    const n = (g.attributes.position as THREE.BufferAttribute).count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  };
  // family へ tpl を 位置・スケール・回転で焼いて push(頂点カラー付き)
  const part = (
    family: THREE.BufferGeometry[],
    tpl: THREE.BufferGeometry,
    color: THREE.Color,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void => {
    eul.set(rx, ry, rz);
    q.setFromEuler(eul);
    vPos.set(px, py, pz);
    vScale.set(sx, sy, sz);
    m4.compose(vPos, q, vScale);
    const g = tpl.clone();
    g.applyMatrix4(m4);
    setColor(g, color);
    family.push(g);
    temps.push(g);
  };

  for (const spec of boxes) {
    // T6: 環境プロップ(prop:true)はR38専用ビジュアル(幹/樹冠/構造材等)を既に持つため、
    // ここでの汎用装飾(コンテナ波板リブ/AABB輪郭線/接地影)は二重掛けで害しかない。
    // 例: 樹木の幹(0.5×3.5)が classifyArchetype で 'container' 誤判定され波板が生える。
    if (spec.prop) continue;
    const cx = spec.x;
    const cz = spec.z;
    const top = spec.y + spec.h / 2;
    const bottom = spec.y - spec.h / 2;
    const halfW = spec.w / 2;
    const halfD = spec.d / 2;
    const longX = spec.w >= spec.d; // 長手がX方向か
    const longLen = Math.max(spec.w, spec.d);
    const arche = classifyArchetype(spec, palette);

    // 床コンタクトシャドウ(周壁以外)
    if (arche !== 'wall') {
      part(
        shadowParts,
        planeTpl,
        new THREE.Color(0x000000),
        cx,
        0.03,
        cz,
        spec.w + 0.5,
        spec.d + 0.5,
        1,
        -Math.PI / 2,
        0,
        0,
      );
    }

    const rimColor = derive(palette.lightColor, 0);
    const rib = derive(palette.obstacle, 0.1);
    const groove = derive(palette.obstacle, -0.15);
    const hardware = derive(palette.wall, -0.1, -0.2);
    const accentCol = derive(palette.accent, palette.emissiveAccent ? 0 : -0.05);

    if (arche === 'container') {
      // 長手2面に縦の波板リブ
      const ribCount = clampN(Math.floor(longLen / 0.7), 3, 10);
      for (let i = 0; i < ribCount; i += 1) {
        const t = ribCount === 1 ? 0.5 : i / (ribCount - 1);
        const along = (t - 0.5) * longLen * 0.92;
        for (const side of [-1, 1] as const) {
          if (longX) {
            part(
              reliefParts,
              slabTpl,
              rib,
              cx + along,
              spec.y,
              cz + side * (halfD + 0.02),
              0.07,
              spec.h * 0.9,
              0.05,
            );
          } else {
            part(
              reliefParts,
              slabTpl,
              rib,
              cx + side * (halfW + 0.02),
              spec.y,
              cz + along,
              0.05,
              spec.h * 0.9,
              0.07,
            );
          }
        }
      }
      // 天面リムキャッチライト(金属)
      part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.04, 0.018, spec.d + 0.04);
      // 妻面のドア(片側のみ・暗色)+ ロックバー(金属)。原点対称ミラー(-x,-z)とは
      // 逆面に付くよう符号へ point-symmetry 係数を織り込み、装飾レベルでも対称を保つ
      const doorBase = (Math.abs(Math.round(spec.x * 31 + spec.z * 17)) % 2) * 2 - 1;
      const doorSign = doorBase * (cx + cz >= 0 ? 1 : -1);
      if (longX) {
        part(
          reliefParts,
          slabTpl,
          groove,
          cx + doorSign * (halfW + 0.012),
          spec.y,
          cz,
          0.02,
          spec.h * 0.82,
          spec.d * 0.82,
        );
        part(
          metalParts,
          slabTpl,
          hardware,
          cx + doorSign * (halfW + 0.03),
          spec.y,
          cz,
          0.04,
          0.05,
          spec.d * 0.5,
        );
      } else {
        part(
          reliefParts,
          slabTpl,
          groove,
          cx,
          spec.y,
          cz + doorSign * (halfD + 0.012),
          spec.w * 0.82,
          spec.h * 0.82,
          0.02,
        );
        part(
          metalParts,
          slabTpl,
          hardware,
          cx,
          spec.y,
          cz + doorSign * (halfD + 0.03),
          spec.w * 0.5,
          0.05,
          0.04,
        );
      }
      // ISOコーナーキャスティング(8隅・InstancedMesh行列)
      for (const sx of [-1, 1] as const) {
        for (const sy of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            eul.set(0, 0, 0);
            q.setFromEuler(eul);
            vPos.set(
              cx + sx * (halfW - 0.05),
              spec.y + sy * (spec.h / 2 - 0.06),
              cz + sz * (halfD - 0.05),
            );
            vScale.set(0.16, 0.18, 0.16);
            castingMatrices.push(
              new THREE.Matrix4().compose(vPos.clone(), q.clone(), vScale.clone()),
            );
          }
        }
      }
      // 発光箱はアクセントの帯を1本
      if (spec.emissive) {
        part(
          accentParts,
          slabTpl,
          accentCol,
          cx,
          top - spec.h * 0.28,
          cz,
          spec.w + 0.02,
          0.06,
          spec.d + 0.02,
        );
      }
    } else if (arche === 'blastBarrier') {
      const ribCount = clampN(Math.floor(longLen / 1.1), 2, 6);
      for (let i = 0; i < ribCount; i += 1) {
        const t = ribCount === 1 ? 0.5 : i / (ribCount - 1);
        const along = (t - 0.5) * longLen * 0.85;
        if (longX) {
          part(
            reliefParts,
            slabTpl,
            rib,
            cx + along,
            spec.y,
            cz,
            0.08,
            spec.h * 0.92,
            spec.d + 0.04,
          );
        } else {
          part(
            reliefParts,
            slabTpl,
            rib,
            cx,
            spec.y,
            cz + along,
            spec.w + 0.04,
            spec.h * 0.92,
            0.08,
          );
        }
      }
      // 中央のハザード帯(アクセント)+ 天端リム
      if (longX) {
        part(
          accentParts,
          slabTpl,
          accentCol,
          cx,
          spec.y + spec.h * 0.1,
          cz,
          spec.w + 0.03,
          0.12,
          spec.d + 0.03,
        );
      } else {
        part(
          accentParts,
          slabTpl,
          accentCol,
          cx,
          spec.y + spec.h * 0.1,
          cz,
          spec.w + 0.03,
          0.12,
          spec.d + 0.03,
        );
      }
      part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.05, 0.02, spec.d + 0.05);
    } else if (arche === 'ammoCrate') {
      // 天面寄りのフタ縁(溝)+ 四隅ストラップ(金属)+ ピーク端アクセント
      part(reliefParts, slabTpl, groove, cx, top - 0.04, cz, spec.w * 0.96, 0.05, spec.d * 0.96);
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          part(
            metalParts,
            slabTpl,
            hardware,
            cx + sx * halfW * 0.8,
            spec.y,
            cz + sz * halfD * 0.8,
            0.05,
            spec.h * 0.9,
            0.05,
          );
        }
      }
      part(accentParts, slabTpl, accentCol, cx, top + 0.012, cz, spec.w * 0.5, 0.02, spec.d * 0.5);
    } else if (arche === 'drum') {
      // 補強リング溝2本(横方向に張り出す薄スラブ)+ 天面リム
      for (const ry of [0.34, 0.66] as const) {
        part(
          reliefParts,
          slabTpl,
          groove,
          cx,
          bottom + spec.h * ry,
          cz,
          spec.w + 0.02,
          0.05,
          spec.d + 0.02,
        );
      }
      part(metalParts, slabTpl, rimColor, cx, top + 0.009, cz, spec.w + 0.02, 0.02, spec.d + 0.02);
    } else if (arche === 'sandbag') {
      // 上辺に横倒しのカプセルを並べる(土嚢の俵)
      const bagR = 0.16;
      const along = longLen - bagR;
      const bags = clampN(Math.floor(along / (bagR * 2)), 2, 8);
      for (let i = 0; i < bags; i += 1) {
        const t = bags === 1 ? 0.5 : i / (bags - 1);
        const off = (t - 0.5) * along;
        if (longX) {
          // 長手X: カプセル軸をX(Y軸→Z回転90°)
          part(
            reliefParts,
            capsuleTpl,
            rib,
            cx + off,
            top - 0.02,
            cz,
            1,
            Math.min(1, spec.d / 0.66),
            1,
            0,
            0,
            Math.PI / 2,
          );
        } else {
          // 長手Z: カプセル軸をZ(Y軸→X回転90°)
          part(
            reliefParts,
            capsuleTpl,
            rib,
            cx,
            top - 0.02,
            cz + off,
            Math.min(1, spec.w / 0.66),
            1,
            1,
            Math.PI / 2,
            0,
            0,
          );
        }
      }
    } else {
      // wall: 縦のパネル分割シーム(疎)+ 天端リムのみ
      const seamCount = clampN(Math.floor(longLen / 6), 2, 12);
      for (let i = 1; i < seamCount; i += 1) {
        const along = (i / seamCount - 0.5) * longLen;
        if (longX) {
          part(
            reliefParts,
            slabTpl,
            groove,
            cx + along,
            spec.y,
            cz,
            0.06,
            spec.h * 0.96,
            spec.d + 0.02,
          );
        } else {
          part(
            reliefParts,
            slabTpl,
            groove,
            cx,
            spec.y,
            cz + along,
            spec.w + 0.02,
            spec.h * 0.96,
            0.06,
          );
        }
      }
      part(metalParts, slabTpl, rimColor, cx, top - 0.02, cz, spec.w + 0.02, 0.03, spec.d + 0.02);
    }
  }

  // 系統別に1メッシュへ畳んでシーンへ追加
  const addMerged = (parts: THREE.BufferGeometry[], material: THREE.Material): void => {
    if (parts.length === 0) {
      material.dispose();
      return;
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) {
      material.dispose();
      return;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
  };

  addMerged(reliefParts, new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }));
  addMerged(
    metalParts,
    // metalness 0.8 だと頂点カラー(アルベド)で金属diffuseが黒く沈むため 0.6 に。IBLで空を映す
    new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.3, vertexColors: true }),
  );
  if (accentParts.length > 0) {
    const accentMat = new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true });
    if (palette.emissiveAccent) {
      accentMat.emissive = new THREE.Color(palette.accent);
      accentMat.emissiveIntensity = 0.9; // Neutral+Bloom前提
      accentMat.envMapIntensity = 0.35;
    }
    addMerged(accentParts, accentMat);
  }

  // ISOコーナーキャスティング(InstancedMesh・1ドローコール)
  if (castingMatrices.length > 0) {
    const castGeo = new THREE.BoxGeometry(1, 1, 1);
    const castMat = new THREE.MeshStandardMaterial({
      color: derive(palette.wall, -0.05, -0.25),
      metalness: 0.7,
      roughness: 0.4,
    });
    const inst = new THREE.InstancedMesh(castGeo, castMat, castingMatrices.length);
    for (let i = 0; i < castingMatrices.length; i += 1) inst.setMatrixAt(i, castingMatrices[i]!);
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // 床コンタクトシャドウ(全箱を1メッシュへ)
  if (shadowParts.length > 0) {
    const mergedShadow = mergeGeometries(shadowParts, false);
    if (mergedShadow) {
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        fog: false,
      });
      shadowMat.polygonOffset = true;
      shadowMat.polygonOffsetFactor = -1;
      shadowMat.polygonOffsetUnits = -1;
      scene.add(new THREE.Mesh(mergedShadow, shadowMat));
    }
  }

  // 焼き込みに使った一時ジオメトリとテンプレを破棄(merge後は不要・シーンに残らない)
  for (const g of temps) g.dispose();
  slabTpl.dispose();
  capsuleTpl.dispose();
  planeTpl.dispose();
}
