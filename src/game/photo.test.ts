// R54-F7: フォトモードの純関数テスト(AABB/高度クランプ・フィルタ定義)。
// PhotoMode 本体はDOM/pointer-lock依存のためここでは扱わない(クランプが座標系の核)。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PHOTO_ALT_MAX,
  PHOTO_ALT_MIN,
  PHOTO_FILTERS,
  PHOTO_MARGIN,
  photoClampPos,
} from './photo';

describe('photoClampPos', () => {
  it('ステージAABB+余白のXZへクランプする(一辺300m→±154m)', () => {
    const half = 300 / 2 + PHOTO_MARGIN;
    const p = photoClampPos(new THREE.Vector3(999, 10, -999), 300);
    expect(p.x).toBe(half);
    expect(p.z).toBe(-half);
  });

  it('高度は 0.3..80m にクランプする', () => {
    expect(photoClampPos(new THREE.Vector3(0, 500, 0), 300).y).toBe(PHOTO_ALT_MAX);
    expect(photoClampPos(new THREE.Vector3(0, -50, 0), 300).y).toBe(PHOTO_ALT_MIN);
  });

  it('範囲内の座標は不変(同一インスタンスを返すin-place設計)', () => {
    const v = new THREE.Vector3(12, 5, -30);
    const r = photoClampPos(v, 300);
    expect(r).toBe(v);
    expect(r.x).toBe(12);
    expect(r.y).toBe(5);
    expect(r.z).toBe(-30);
  });
});

describe('PHOTO_FILTERS', () => {
  it('uPhoto 0-3 に対応する4種(ノーマル/ノワール/ビビッド/帝王)', () => {
    expect(PHOTO_FILTERS).toEqual(['ノーマル', 'ノワール', 'ビビッド', '帝王']);
  });
});
