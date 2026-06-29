import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { airAccelerate, MOVE_SPEEDS, slideSpeedAt, softAirCap } from './player';

describe('slideSpeedAt', () => {
  it('開始が最速で終端へ単調に落ちる', () => {
    expect(slideSpeedAt(0)).toBeGreaterThan(slideSpeedAt(0.5));
    expect(slideSpeedAt(0.5)).toBeGreaterThan(slideSpeedAt(1));
    // 開始速度はスプリントより速い(パワースライドの加速)
    expect(slideSpeedAt(0)).toBeGreaterThan(MOVE_SPEEDS.sprint);
  });

  it('範囲外の入力はクランプされる', () => {
    expect(slideSpeedAt(-1)).toBe(slideSpeedAt(0));
    expect(slideSpeedAt(2)).toBe(slideSpeedAt(1));
  });
});

describe('airAccelerate(射影式エアアクセル)', () => {
  it('進行方向の速度は wishSpeed を超えない', () => {
    const v = new THREE.Vector3();
    for (let i = 0; i < 600; i += 1) airAccelerate(v, 1, 0, 6, 12, 1 / 60);
    expect(v.x).toBeLessThanOrEqual(6 + 1e-6);
    expect(v.x).toBeGreaterThan(5.9);
  });

  it('既に速い向きには加速も減速もしない(運動量保持)', () => {
    const v = new THREE.Vector3(9, 0, 0);
    airAccelerate(v, 1, 0, 6, 12, 1 / 60);
    expect(v.x).toBe(9);
  });

  it('直交方向へは運動量を保ったまま加速できる(ストレイフ)', () => {
    const v = new THREE.Vector3(9, 0, 0);
    airAccelerate(v, 0, 1, 6, 12, 1 / 60);
    expect(v.x).toBe(9); // 前方成分は維持
    expect(v.z).toBeGreaterThan(0); // 横方向に速度が乗る
  });

  it('入力が無ければ速度は変わらない', () => {
    const v = new THREE.Vector3(3, 0, 4);
    airAccelerate(v, 0, 0, 6, 12, 1 / 60);
    expect(v.x).toBe(3);
    expect(v.z).toBe(4);
  });
});

describe('softAirCap', () => {
  it('上限以下では何もしない', () => {
    const v = new THREE.Vector3(MOVE_SPEEDS.airMax - 1, 0, 0);
    softAirCap(v, 1 / 60);
    expect(v.x).toBe(MOVE_SPEEDS.airMax - 1);
  });

  it('上限超過分をゆるく引き戻すが、上限を下回らない', () => {
    const v = new THREE.Vector3(20, 0, 0);
    softAirCap(v, 1 / 60);
    const sp = Math.hypot(v.x, v.z);
    expect(sp).toBeLessThan(20);
    expect(sp).toBeGreaterThanOrEqual(MOVE_SPEEDS.airMax);
  });
});
