import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyCinematicDetailScale,
  markCinematicDetail,
  maxCinematicDetailPriority,
} from './cinematic-detail';

describe('cinematic detail LOD', () => {
  it('解像度スケール低下に合わせて微細物から段階的に落とす', () => {
    expect(maxCinematicDetailPriority(1)).toBe(3);
    expect(maxCinematicDetailPriority(0.9)).toBe(2);
    expect(maxCinematicDetailPriority(0.8)).toBe(1);
    expect(maxCinematicDetailPriority(0.6)).toBe(0);
  });

  it('visibilityだけを変更し、重要レイヤを常に残す', () => {
    const root = new THREE.Group();
    const hero = new THREE.Object3D();
    const facade = new THREE.Object3D();
    const rubble = new THREE.Object3D();
    const paper = new THREE.Object3D();
    markCinematicDetail(hero, 0);
    markCinematicDetail(facade, 1);
    markCinematicDetail(rubble, 2);
    markCinematicDetail(paper, 3);
    root.add(hero, facade, rubble, paper);

    applyCinematicDetailScale([root], 0.72);
    expect(hero.visible).toBe(true);
    expect(facade.visible).toBe(true);
    expect(rubble.visible).toBe(false);
    expect(paper.visible).toBe(false);

    applyCinematicDetailScale([root], 1);
    expect(root.children.every((child) => child.visible)).toBe(true);
  });
});
