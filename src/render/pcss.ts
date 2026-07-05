/**
 * PCSS (Percentage-Closer Soft Shadows) シェーダチャンクパッチャー。
 *
 * ## 使い方
 * 1. `patchPcss()` をシーン生成 / マテリアル **初回コンパイル前** に呼ぶ。
 *    コンパイル後に呼んでも既存マテリアルには反映されない。
 * 2. 統合側の責務: `renderer.shadowMap.type = THREE.BasicShadowMap` を設定する。
 *    (このモジュールはチャンク文字列のみを操作し renderer には触れない)
 *
 * ## アルゴリズム
 * - Blocker search : 9-tap 自前 Poisson ディスク
 * - PCF フィルタ   : 13-tap 自前 Poisson ディスク
 * - ペナンブラ半径  : LIGHT_WORLD_SIZE 定数で調整
 *
 * ## 置換アンカー(THREE r170 で検証済み)
 * - A1: `#ifdef USE_SHADOWMAP\n`               ← PCSS 関数群を直後に注入
 * - A2: `\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n` ← 早期 return を直前に注入
 */

import * as THREE from 'three';

// ── モジュール定数 ──────────────────────────────────────────────────────────

/** ライトのワールドサイズ相当。大きいほどソフトな影になる(推奨: 0.3–1.2)。 */
export const LIGHT_WORLD_SIZE = 0.6;

// ── 内部状態 ────────────────────────────────────────────────────────────────

// モジュール読み込み時に元チャンクを保存する。
// patchPcss() より前にモジュールが import される前提で安全。
const _origChunk: string = THREE.ShaderChunk.shadowmap_pars_fragment;

let _patched = false;

// ── GLSL 注入文字列 ──────────────────────────────────────────────────────────

/**
 * `#ifdef USE_SHADOWMAP` 直後に挿入する PCSS ユーティリティ関数群。
 * LIGHT_WORLD_SIZE は TS 定数から埋め込む(GLSL #define 不要)。
 */
const _PCSS_GLSL = `
// ── PCSS soft shadows injected by pcss.ts ──
// blocker search: 9-tap  /  PCF filter: 13-tap  /  LightWorldSize=${LIGHT_WORLD_SIZE.toFixed(6)}

const vec2 _pcss_bd9[9] = vec2[9](
  vec2( 0.000,  0.000 ),
  vec2( 0.700,  0.000 ),
  vec2( 0.000,  0.700 ),
  vec2(-0.700,  0.000 ),
  vec2( 0.000, -0.700 ),
  vec2( 0.495,  0.495 ),
  vec2(-0.495,  0.495 ),
  vec2(-0.495, -0.495 ),
  vec2( 0.495, -0.495 )
);

const vec2 _pcss_pd13[13] = vec2[13](
  vec2( 0.0000,  0.0000 ),
  vec2( 0.5278, -0.0859 ),
  vec2(-0.0401,  0.5361 ),
  vec2(-0.6704, -0.1799 ),
  vec2(-0.4194, -0.6160 ),
  vec2( 0.4405, -0.6394 ),
  vec2(-0.7571,  0.3493 ),
  vec2( 0.5746,  0.6859 ),
  vec2( 0.0388,  0.9627 ),
  vec2(-0.2445, -0.9556 ),
  vec2( 0.9711, -0.1619 ),
  vec2(-0.9766,  0.6005 ),
  vec2( 0.1838, -0.5036 )
);

// ブロッカー探索: 9-tap。ブロッカーが見つからない場合は -1.0 を返す。
float _pcss_findBlocker( sampler2D smap, vec2 uv, float zRec, float searchR ) {
  float sum = 0.0;
  float cnt = 0.0;
  for ( int i = 0; i < 9; i++ ) {
    float d = unpackRGBAToDepth( texture2D( smap, uv + _pcss_bd9[i] * searchR ) );
    if ( d < zRec ) { sum += d; cnt += 1.0; }
  }
  return cnt > 0.0 ? sum / cnt : -1.0;
}

// 13-tap Poisson PCF フィルタ。
float _pcss_pcfFilter( sampler2D smap, vec2 uv, float zRec, float r ) {
  float s = 0.0;
  for ( int i = 0; i < 13; i++ ) {
    s += step( zRec, unpackRGBAToDepth( texture2D( smap, uv + _pcss_pd13[i] * r ) ) );
  }
  return s * ( 1.0 / 13.0 );
}

// PCSS シャドウ値 [0,1] を返す(1=完全照射)。
// shadowCoord は getShadow() 内で /w 正規化 + bias 適用済みの状態で受け取る。
float _pcss_getShadow(
  sampler2D shadowMap, vec2 shadowMapSize,
  float shadowBias, float shadowRadius, vec4 shadowCoord
) {
  vec2 ts = vec2( 1.0 ) / shadowMapSize;
  float searchR = ${LIGHT_WORLD_SIZE.toFixed(6)} * ts.x * max( shadowRadius, 1.0 );
  float avgBlk = _pcss_findBlocker( shadowMap, shadowCoord.xy, shadowCoord.z, searchR );
  if ( avgBlk < 0.0 ) return 1.0; // ブロッカーなし = 完全照射
  float pen = ( shadowCoord.z - avgBlk ) * ${LIGHT_WORLD_SIZE.toFixed(6)} / max( avgBlk, 0.0001 );
  float fr = clamp( pen * ts.x * max( shadowRadius, 1.0 ) * 6.0, ts.x, ts.x * 24.0 );
  return _pcss_pcfFilter( shadowMap, shadowCoord.xy, shadowCoord.z, fr );
}

// ── end PCSS ──
`;

// Anchor 1: `#ifdef USE_SHADOWMAP` 直後に PCSS 関数群を注入
const _A1 = '#ifdef USE_SHADOWMAP\n';

// Anchor 2: `if (frustumTest)` ブロック内の PCF 判定直前に早期 return を注入。
// A2 は THREE r170 で1箇所のみ存在する(getPointShadow 内の別の PCF 分岐とは別文字列)。
const _A2 = '\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n';

// A2 の直前に挿入する早期 return。以降の #if defined PCF … は dead code になるが GLSL 上は合法。
const _RET =
  '\n\t\treturn mix( 1.0, _pcss_getShadow( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord ), shadowIntensity );';

// ── 公開 API ────────────────────────────────────────────────────────────────

/**
 * `THREE.ShaderChunk.shadowmap_pars_fragment` に PCSS を注入する。
 *
 * **マテリアル初回コンパイル前に呼ぶこと。**
 * 冪等: 2回呼んでも2重適用されない。
 */
export function patchPcss(): void {
  if (_patched) return;

  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;

  if (!chunk.includes(_A1)) {
    console.warn('[pcss] Anchor1 (#ifdef USE_SHADOWMAP) が見つかりません — パッチをスキップ');
    return;
  }
  if (!chunk.includes(_A2)) {
    console.warn('[pcss] Anchor2 (#if defined SHADOWMAP_TYPE_PCF) が見つかりません — パッチをスキップ');
    return;
  }

  // 注入1: PCSS 関数群を #ifdef USE_SHADOWMAP 直後に追加
  chunk = chunk.replace(_A1, _A1 + _PCSS_GLSL);
  // 注入2: 早期 return を PCF ブロックの直前に追加
  chunk = chunk.replace(_A2, _RET + _A2);

  THREE.ShaderChunk.shadowmap_pars_fragment = chunk;
  _patched = true;
}

/**
 * `shadowmap_pars_fragment` を元のチャンク文字列に復元する。
 */
export function unpatchPcss(): void {
  THREE.ShaderChunk.shadowmap_pars_fragment = _origChunk;
  _patched = false;
}

/**
 * PCSS パッチが現在適用されているかどうかを返す。
 */
export function isPcssPatched(): boolean {
  return _patched;
}
