import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGunBody } from './viewmodel';
import { collectInspectNodes, loadoutAttachmentsFor } from './weapon-preview';
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

  it('実銃: FAMAS-G4(カエデAR) は可動ノードを1つ以上持つ(インスペクトが空にならない)', () => {
    const { gun } = buildGunBody(WEAPON_DEFS['kaede-ar']!);
    expect(collectInspectNodes(gun).length).toBeGreaterThan(0);
  });
});

// ── R57⑦ ARMORYプレビューのアタッチメント解決(menu2=ベースdef経路の見た目反映) ──
// menu2 の previewWeaponId は WEAPON_DEFS[id](attachmentIds未設定)を渡すため、setWeapon は
// 永続ロードアウト(localStorage 単一ソース)から現在装備アタッチメントを解決してプレビューへ
// 反映する。ここではその解決ロジック(プライマリ限定ゲート/破損耐性)を検証する。
describe('loadoutAttachmentsFor(ARMORYプレビューのアタッチ解決)', () => {
  const KEY = 'hibana.loadout.v1';
  const original = (globalThis as { localStorage?: Storage }).localStorage;

  function installStore(initial: Record<string, string> = {}): void {
    const store = new Map<string, string>(Object.entries(initial));
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }

  afterEach(() => {
    if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else (globalThis as { localStorage?: Storage }).localStorage = original;
  });

  it('localStorage 不在(node既定)では安全に [] を返す', () => {
    if (original === undefined) {
      expect(loadoutAttachmentsFor('kaede-ar')).toEqual([]);
    }
  });

  it('プライマリ武器が一致すれば装備アタッチメントを返す', () => {
    installStore({ [KEY]: JSON.stringify({ primaryId: 'kaede-ar', attachments: ['reflex', 'extended'] }) });
    expect(loadoutAttachmentsFor('kaede-ar')).toEqual(['reflex', 'extended']);
  });

  it('プライマリ武器が一致しない(副武器/他武器)プレビューには適用しない=[]', () => {
    installStore({ [KEY]: JSON.stringify({ primaryId: 'kaede-ar', attachments: ['reflex'] }) });
    expect(loadoutAttachmentsFor('suzume')).toEqual([]);
  });

  it('保存が無い/破損JSON/型不正でも例外なく [] を返す', () => {
    installStore({});
    expect(loadoutAttachmentsFor('kaede-ar')).toEqual([]);
    installStore({ [KEY]: '{ this is : not json' });
    expect(loadoutAttachmentsFor('kaede-ar')).toEqual([]);
    installStore({ [KEY]: JSON.stringify({ primaryId: 'kaede-ar', attachments: 'not-an-array' }) });
    expect(loadoutAttachmentsFor('kaede-ar')).toEqual([]);
    installStore({ [KEY]: JSON.stringify({ primaryId: 'kaede-ar', attachments: ['ok', 3, null, 'ok2'] }) });
    expect(loadoutAttachmentsFor('kaede-ar')).toEqual(['ok', 'ok2']); // 非文字列は除去
  });
});
