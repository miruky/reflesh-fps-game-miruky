/**
 * pcss.ts のユニットテスト。
 *
 * - THREE.ShaderChunk はモジュールシングルトンなので、
 *   各テスト後に必ず unpatchPcss() で元の状態に戻す。
 * - ゲート: 置換アンカーが r170 実チャンクに存在することを確認する。
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isPcssPatched, patchPcss, unpatchPcss } from './pcss';

// テスト開始時点の元チャンクを保存してアンカー検証に使う
const ORIG = THREE.ShaderChunk.shadowmap_pars_fragment;

afterEach(() => {
  unpatchPcss();
});

// ── アンカー検証 ─────────────────────────────────────────────────────────────

describe('anchor verification — THREE r170 shadowmap_pars_fragment', () => {
  it('A1: #ifdef USE_SHADOWMAP\\n が存在する', () => {
    expect(ORIG).toContain('#ifdef USE_SHADOWMAP\n');
  });

  it('A2: \\n\\t\\t#if defined( SHADOWMAP_TYPE_PCF )\\n が1箇所だけ存在する', () => {
    expect(ORIG).toContain('\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n');
    const count = (ORIG.match(/\n\t\t#if defined\( SHADOWMAP_TYPE_PCF \)\n/g) ?? []).length;
    expect(count).toBe(1);
  });
});

// ── patchPcss ────────────────────────────────────────────────────────────────

describe('patchPcss', () => {
  it('パッチ後に PCSS 関数群が注入される', () => {
    patchPcss();
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk).toContain('_pcss_getShadow');
    expect(chunk).toContain('_pcss_findBlocker');
    expect(chunk).toContain('_pcss_pcfFilter');
  });

  it('パッチ後に早期 return が注入される', () => {
    patchPcss();
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk).toContain('return mix( 1.0, _pcss_getShadow(');
  });

  it('パッチ後 isPcssPatched() が true を返す', () => {
    patchPcss();
    expect(isPcssPatched()).toBe(true);
  });

  it('2重 patch でも _pcss_getShadow は1回だけ現れる(冪等)', () => {
    patchPcss();
    patchPcss();
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    const count = (chunk.match(/_pcss_getShadow/g) ?? []).length;
    // 関数定義1回 + 呼び出し1回 = 2回が上限(2重適用なら4回になる)
    expect(count).toBeLessThanOrEqual(2);
    expect(isPcssPatched()).toBe(true);
  });
});

// ── unpatchPcss ──────────────────────────────────────────────────────────────

describe('unpatchPcss', () => {
  it('unpatch 後にチャンクが元文字列に完全一致する', () => {
    patchPcss();
    unpatchPcss();
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toBe(ORIG);
  });

  it('unpatch 後 isPcssPatched() が false を返す', () => {
    patchPcss();
    unpatchPcss();
    expect(isPcssPatched()).toBe(false);
  });

  it('unpatch 後に再 patch できる', () => {
    patchPcss();
    unpatchPcss();
    patchPcss();
    expect(isPcssPatched()).toBe(true);
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk).toContain('_pcss_getShadow');
  });
});
