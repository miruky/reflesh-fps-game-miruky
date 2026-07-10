import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isBehindListener } from './match';

// R54 音響2 (M-AU): match.ts の enemyFootstep/enemyShot「背後判定」配線から抽出した純関数。
// Match本体はWebGL依存のため単体化できない(story-snd-wiring.test.tsと同じ方針)。

describe('isBehindListener(音源方位と視線の内積<0=背後)', () => {
  it('正面(視線と同じ向き)は false', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dirToSource = new THREE.Vector3(0, 0, -1); // 真正面
    expect(isBehindListener(forward, dirToSource)).toBe(false);
  });

  it('真後ろは true', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dirToSource = new THREE.Vector3(0, 0, 1); // 真後ろ
    expect(isBehindListener(forward, dirToSource)).toBe(true);
  });

  it('真横(内積0)は false(閾値は<0の狭義不等号)', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dirToSource = new THREE.Vector3(1, 0, 0); // 真横
    expect(isBehindListener(forward, dirToSource)).toBe(false);
  });

  it('正規化されていないdirToSourceでも符号だけで判定される', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dirToSource = new THREE.Vector3(0, 0, 50); // 未正規化・後方
    expect(isBehindListener(forward, dirToSource)).toBe(true);
  });

  it('斜め後方(内積がわずかに負)も true', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dirToSource = new THREE.Vector3(1, 0, 0.1); // ほぼ真横、ごく僅かに後方寄り
    expect(isBehindListener(forward, dirToSource)).toBe(true);
  });
});
