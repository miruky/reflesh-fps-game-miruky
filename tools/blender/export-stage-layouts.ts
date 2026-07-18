import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateStage } from '../../src/game/stage.ts';
import { STAGES } from '../../src/game/stages.ts';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, 'generated/stage-layouts.json');
mkdirSync(dirname(output), { recursive: true });

const stages = STAGES.map((stage) => {
  const layout = generateStage(stage);
  return {
    ...stage,
    boxes: layout.boxes,
    playerSpawns: layout.playerSpawns,
    botSpawns: layout.botSpawns,
    propPlacements: layout.propPlacements,
    districtPlacements: layout.districtPlacements,
  };
});

writeFileSync(output, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), stages }, null, 2)}\n`);
console.log(JSON.stringify({ output, stages: stages.length, boxes: stages.reduce((sum, stage) => sum + stage.boxes.length, 0) }, null, 2));
