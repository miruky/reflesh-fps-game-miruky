import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from './input';

describe('DEFAULT_BINDINGS', () => {
  it('操作キーEと右リーンを競合させない', () => {
    expect(DEFAULT_BINDINGS.interact).toContain('KeyE');
    expect(DEFAULT_BINDINGS.leanright).toContain('KeyX');
    expect(DEFAULT_BINDINGS.leanright).not.toContain('KeyE');
  });

  it('説明書に掲載する投擲物切替キーをHに保つ', () => {
    expect(DEFAULT_BINDINGS.grenadeswitch).toEqual(['KeyH']);
  });
});
