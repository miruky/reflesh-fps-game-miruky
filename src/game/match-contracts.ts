// Match / ZombieDirector / StoryEngine 間で共有する最小契約。
// 実行時は数値定数と純関数のみで、シーンやサブシステムをimportしない。
// この層を挟むことで ZombieDirector -> Match -> ZombieDirector の循環を禁止する。

import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { HitPart } from './ballistics';
import type { Bot } from './bot';

export const ULT_ON_DAMAGE_PER_HP = 0.0015;
export const PLAYER_FEET_OFFSET = 0.95;

export interface RayHitLike {
  collider: RAPIER.Collider;
  toi?: number;
  timeOfImpact?: number;
}

export function hitToi(hit: RayHitLike): number {
  return hit.toi ?? hit.timeOfImpact ?? 0;
}

// 訓練場ターゲット。ColliderTagの参照型とMatch本体の保持型を同一にし、
// tagの絞り込み後も型アサーションを必要としない。
export interface TrainingTarget {
  group: THREE.Group;
  body: RAPIER.RigidBody;
  bodyCollider: RAPIER.Collider;
  headCollider: RAPIER.Collider;
  hp: number;
  isDown: boolean;
  downTimer: number;
  kind: 'static' | 'moving' | 'popup';
  moveDir: number;
  moveSpeed: number;
  moveRange: number;
  moveOriginX: number;
  moveOriginZ: number;
  moveRightX: number;
  moveRightZ: number;
}

export type ColliderTag =
  | { kind: 'world' }
  | { kind: 'boundary' }
  | { kind: 'player' }
  | { kind: 'bot'; bot: Bot; part: HitPart }
  | { kind: 'trainingTarget'; target: TrainingTarget; part: 'head' | 'body' };

export interface DarkSlashWave {
  group: THREE.Group;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  traveled: number;
  hitSet: Set<number>;
  smokeTimer: number;
  chargeScale?: number;
  hitRadius: number;
  dmgOverride?: number;
  hostile?: boolean;
  hitPlayer?: boolean;
  hostileOwnerName?: string;
}
