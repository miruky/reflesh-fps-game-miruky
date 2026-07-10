import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGunBody } from './viewmodel';
import { collectInspectNodes } from './weapon-preview';
import { WEAPON_DEFS } from '../game/weapons';

// R53 MK.III (Fable#4): ARMORYインスペクトループの可動ノード捕捉。
// WebGL本体はテスト不能のため、純粋な収集ロジックと実銃ジオメトリとの整合のみ検証する。

describe('collectInspectNodes', () => {
  it('vm:* の既知ノードを種類付きで捕捉し、未知名は無視する', () => {
    const root = new THREE.Group();
    const slide = new THREE.Group();
    slide.name = 'vm:slide';
    const mag = new THREE.Group();
    mag.name = 'vm:magazine';
    const barrel = new THREE.Group();
    barrel.name = 'vm:barrel';
    const other = new THREE.Group();
    other.name = 'vm:unknown-node';
    root.add(slide, mag, barrel, other);
    const nodes = collectInspectNodes(root);
    const kinds = Object.fromEntries(nodes.map((n) => [n.node.name, n.kind]));
    expect(kinds['vm:slide']).toBe('recip');
    expect(kinds['vm:magazine']).toBe('mag');
    expect(kinds['vm:barrel']).toBe('spin');
    expect(kinds['vm:unknown-node']).toBeUndefined();
    // 位相は個体ごとにずれる(全ノード同位相の機械的な揺れを避ける)
    expect(new Set(nodes.map((n) => n.phase)).size).toBe(nodes.length);
  });

  it('実銃: 修羅(minigun)は spin ノードを持つ', () => {
    const { gun } = buildGunBody(WEAPON_DEFS['shura-lmg']!);
    const nodes = collectInspectNodes(gun);
    expect(nodes.some((n) => n.kind === 'spin')).toBe(true);
  });

  it('実銃: カエデAR は可動ノードを1つ以上持つ(インスペクトが空にならない)', () => {
    const { gun } = buildGunBody(WEAPON_DEFS['kaede-ar']!);
    expect(collectInspectNodes(gun).length).toBeGreaterThan(0);
  });
});
