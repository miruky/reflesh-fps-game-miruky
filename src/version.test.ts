import { describe, expect, it } from 'vitest';
import { BUILD_LABEL } from './version';

describe('BUILD_LABEL', () => {
  it('R+数字の形式である(menu.tsのBUILD表記が単一の真実源から出ることを保証)', () => {
    expect(BUILD_LABEL).toMatch(/^R\d+$/);
  });
});
