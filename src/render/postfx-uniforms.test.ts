import { describe, expect, it } from 'vitest';
// R54-HF: setCinema/setPhoto が uniforms レコード未登録の uCinema/uPhoto を触り
// 非nullアサーションで実行時throwしていた事故の再発防止。
// 「setterが this.uniforms['uX'] で触る全キーは、uniformsレコード宣言に存在する」を源泉テキストでピンする。
// (PostFXPassはWebGL依存でjsdomなし環境では実体化できないため、?raw源泉構造テストとする)
import src from './postfx.ts?raw';

describe('postfx uniforms registry', () => {
  const touched = [...src.matchAll(/this\.uniforms\['(u[A-Za-z0-9]+)'\]/g)].map((m) => m[1]!);
  const declared = new Set([...src.matchAll(/^\s*(u[A-Za-z0-9]+):\s*\{\s*value:/gm)].map((m) => m[1]!));

  it('setterが触る全uniformキーがレコード宣言に存在する', () => {
    expect(touched.length).toBeGreaterThan(0);
    const missing = [...new Set(touched)].filter((k) => !declared.has(k));
    expect(missing).toEqual([]);
  });

  it('uCinema/uPhoto が登録されている(R54-F7回帰)', () => {
    expect(declared.has('uCinema')).toBe(true);
    expect(declared.has('uPhoto')).toBe(true);
  });
});
