import { describe, expect, it } from 'vitest';
import { applyAttachments, ATTACHMENT_DEFS, attachmentsForSlot } from './attachments';
import { WEAPON_DEFS } from './weapons';

const base = WEAPON_DEFS['kaede-ar']!;

describe('applyAttachments', () => {
  it('ベース定義を変更しない', () => {
    const before = JSON.stringify(base);
    applyAttachments(base, ['suppressor', 'extended', 'vertical']);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('サプレッサーは抑音フラグを立てて射程を削る', () => {
    const def = applyAttachments(base, ['suppressor']);
    expect(def.suppressed).toBe(true);
    expect(def.falloff.start).toBeLessThan(base.falloff.start);
    expect(def.falloff.end).toBeLessThan(base.falloff.end);
  });

  it('拡張マガジンは装弾数を増やしリロードを遅くする', () => {
    const def = applyAttachments(base, ['extended']);
    expect(def.magazineSize).toBe(45);
    expect(def.reloadTacticalMs).toBeGreaterThan(base.reloadTacticalMs);
  });

  it('バーティカルグリップは反動パターンを縮める', () => {
    const def = applyAttachments(base, ['vertical']);
    const lastBase = base.recoilPattern.at(-1)!;
    const lastMod = def.recoilPattern.at(-1)!;
    expect(Math.abs(lastMod.yaw)).toBeLessThan(Math.abs(lastBase.yaw));
    expect(lastMod.pitch).toBeLessThan(lastBase.pitch);
  });

  it('同一スロットは最初の1つだけ適用する', () => {
    const def = applyAttachments(base, ['extended', 'quick']);
    expect(def.attachmentIds).toEqual(['extended']);
    expect(def.reserveAmmo).toBe(base.reserveAmmo);
  });

  it('未知のIDは無視して適用済み一覧に残さない', () => {
    const def = applyAttachments(base, ['unknown-id', 'reflex']);
    expect(def.attachmentIds).toEqual(['reflex']);
  });
});

describe('attachmentsForSlot', () => {
  it('全スロットに2つ以上の選択肢がある', () => {
    for (const slot of ['sight', 'muzzle', 'grip', 'mag'] as const) {
      expect(attachmentsForSlot(slot).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('定義のslotとIDが索引と一致する', () => {
    for (const [id, def] of Object.entries(ATTACHMENT_DEFS)) {
      expect(def.id).toBe(id);
    }
  });
});
