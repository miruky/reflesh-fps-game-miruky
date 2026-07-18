#!/usr/bin/env node

/**
 * Deterministically apply EXT_meshopt_compression to Blender stage exports.
 *
 * Blender remains the artistic source.  This final delivery pass preserves
 * geometry/material semantics and extras while quantizing attributes at a
 * game-safe precision.  Hibana's GLTFLoader already installs Three.js'
 * MeshoptDecoder before loading any stage GLB.
 */
import { mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = process.argv.slice(2).map((file) => resolve(file));
if (files.length === 0) throw new Error('usage: optimize-glbs.mjs <stage.glb> [...]');

const workDir = resolve('tools/blender/work/meshopt');
mkdirSync(workDir, { recursive: true });
const cli = resolve('node_modules/@gltf-transform/cli/bin/cli.js');
const reports = [];

for (const input of files) {
  if (!input.endsWith('.glb')) throw new Error(`not a GLB: ${input}`);
  const before = statSync(input).size;
  const output = resolve(workDir, `${basename(input, '.glb')}.meshopt.glb`);
  try { unlinkSync(output); } catch { /* first run */ }
  const result = spawnSync(process.execPath, [
    cli,
    'meshopt',
    input,
    output,
    '--level', 'high',
    '--quantization-volume', 'mesh',
    '--quantize-position', '16',
    '--quantize-normal', '12',
    '--quantize-texcoord', '14',
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Meshopt failed (${result.status}): ${input}`);
  const after = statSync(output).size;
  if (after >= before) throw new Error(`Meshopt did not reduce ${input}: ${before} -> ${after}`);
  renameSync(output, input);
  reports.push({
    file: basename(input),
    before,
    after,
    reductionPercent: Number(((1 - after / before) * 100).toFixed(2)),
  });
}

console.log(JSON.stringify({ optimized: reports.length, reports }, null, 2));
