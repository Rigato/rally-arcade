/**
 * Validação do gerador procedural v3 (pistas por blocos com splits).
 *
 * Uso:
 *   npx --yes tsx scripts/proc-validate-v3.ts
 *   npx --yes tsx scripts/proc-validate-v3.ts --count 100 --start 1
 *   npx --yes tsx scripts/proc-validate-v3.ts --count 20 --svg /tmp/opencode/v3.svg
 *
 * Não integra no jogo e não altera arquivos de `src/`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TrackDef } from '../src/game/types';
import { Track } from '../src/track/Track';
import { generateProceduralTrackV3 } from '../src/track/procedural/ProceduralTrackV3';

const args = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const count = Math.max(1, Number.parseInt(readArg('--count') ?? '20', 10) || 20);
const startSeed = Number.parseInt(readArg('--start') ?? '1', 10) || 1;

interface Row {
  seed: number;
  def: TrackDef;
  track: Track;
  length: number;
  blocks: number;
  splitBlocks: number;
  routes: number;
  routeLengths: number[];
  routeMinWidths: number[];
  routeMaxSlopes: number[];
  routeMinRadii: number[];
  issues: string[];
  ms: number;
}

function minRadius(track: Track, pathId: number): number {
  const length = track.pathLength(pathId);
  let min = Infinity;
  let previous = track.sampleAtPath(pathId, 0);
  let previousHeading = Math.atan2(previous.tangent.x, previous.tangent.z);

  for (let s = 2; s <= length; s += 2) {
    const sample = track.sampleAtPath(pathId, s);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    let delta = heading - previousHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > 1e-5) {
      min = Math.min(min, 2 / Math.abs(delta));
    }
    previousHeading = heading;
    previous = sample;
  }

  return Number.isFinite(min) ? min : 999;
}

function minWidth(track: Track, pathId: number): number {
  const length = track.pathLength(pathId);
  let min = Infinity;
  for (let s = 0; s <= length; s += 2) {
    min = Math.min(min, track.widthAtPath(pathId, s));
  }
  return Number.isFinite(min) ? min : 0;
}

function maxSlope(track: Track, pathId: number): number {
  const length = track.pathLength(pathId);
  let max = 0;
  let previous = track.heightAtPath(pathId, 0, 0);
  for (let s = 2; s <= length; s += 2) {
    const height = track.heightAtPath(pathId, s, 0);
    max = Math.max(max, Math.abs(height - previous) / 2);
    previous = height;
  }
  return max;
}

function validateRow(row: Row): void {
  const { def, track, issues } = row;

  if (row.length < 2200 || row.length > 3800) {
    issues.push(`comprimento ${row.length.toFixed(0)} m fora de 2200..3800`);
  }
  if (row.splitBlocks < 1) {
    issues.push('sem bloco com split');
  }
  if (row.splitBlocks !== (def.forks?.length ?? 0)) {
    issues.push(
      `${row.splitBlocks} blocos split mas ${def.forks?.length ?? 0} forks`,
    );
  }

  for (const fork of def.forks ?? []) {
    for (const branch of fork.branches) {
      if (branch.kind !== 'route') {
        issues.push(`${branch.id}: kind != route`);
      }
      if (branch.length < 420 || branch.length > 980) {
        issues.push(`${branch.id}: comprimento ${branch.length.toFixed(0)} m`);
      }
      if (branch.width < 5.4) {
        issues.push(`${branch.id}: largura ${branch.width.toFixed(2)} m`);
      }
      if (!branch.zones || branch.zones.length === 0) {
        issues.push(`${branch.id}: sem zonas locais`);
      }
    }
  }

  for (let pathId = 0; pathId <= track.branches.length; pathId += 1) {
    const width = minWidth(track, pathId);
    const radius = minRadius(track, pathId);
    const slope = maxSlope(track, pathId);
    if (width < 4.4) {
      issues.push(`path ${pathId}: largura mínima ${width.toFixed(2)} m`);
    }
    if (radius < 9) {
      issues.push(`path ${pathId}: raio mínimo ${radius.toFixed(1)} m`);
    }
    if (slope > 1.2) {
      issues.push(`path ${pathId}: inclinação ${slope.toFixed(2)}`);
    }
  }

  if (
    def.zones.length > 1 &&
    def.zones.some((zone) => zone.end <= zone.start)
  ) {
    issues.push('zona com intervalo inválido');
  }
  if (def.splits.length !== 3) {
    issues.push(`${def.splits.length} parciais (esperado 3)`);
  }
  for (const split of def.splits) {
    const insideSplit = (def.blocks ?? []).some(
      (block) =>
        block.kind === 'split' &&
        split.s > block.startS + 1 &&
        split.s < block.endS - 1,
    );
    if (insideSplit) {
      issues.push(`parcial em s=${split.s.toFixed(0)} dentro de um split`);
    }
  }
}

const rows: Row[] = [];
const totalStart = performance.now();

for (let seed = startSeed; seed < startSeed + count; seed += 1) {
  const start = performance.now();
  try {
    const def = generateProceduralTrackV3(seed);
    const track = new Track(def);
    const blocks = def.blocks ?? [];
    const splitBlocks = blocks.filter((block) => block.kind === 'split').length;
    const routeLengths: number[] = [];
    const routeMinWidths: number[] = [];
    const routeMaxSlopes: number[] = [];
    const routeMinRadii: number[] = [];

    for (const fork of def.forks ?? []) {
      for (const branch of fork.branches) {
        routeLengths.push(branch.length);
        routeMinWidths.push(branch.width);
        routeMaxSlopes.push(0);
        routeMinRadii.push(0);
      }
    }

    for (let pathId = 1; pathId <= track.branches.length; pathId += 1) {
      routeMinWidths[pathId - 1] = minWidth(track, pathId);
      routeMaxSlopes[pathId - 1] = maxSlope(track, pathId);
      routeMinRadii[pathId - 1] = minRadius(track, pathId);
    }

    const row: Row = {
      seed,
      def,
      track,
      length: track.length,
      blocks: blocks.length,
      splitBlocks,
      routes: track.branches.length,
      routeLengths,
      routeMinWidths,
      routeMaxSlopes,
      routeMinRadii,
      issues: [],
      ms: performance.now() - start,
    };
    validateRow(row);
    rows.push(row);
  } catch (error) {
    rows.push({
      seed,
      def: { id: `proc-${seed}` } as TrackDef,
      track: null as unknown as Track,
      length: 0,
      blocks: 0,
      splitBlocks: 0,
      routes: 0,
      routeLengths: [],
      routeMinWidths: [],
      routeMaxSlopes: [],
      routeMinRadii: [],
      issues: [`throw: ${error instanceof Error ? error.message : String(error)}`],
      ms: performance.now() - start,
    });
  }
}

const totalMs = performance.now() - totalStart;
const valid = rows.filter((row) => row.issues.length === 0);
const splitCounts = new Map<number, number>();
for (const row of rows) {
  splitCounts.set(row.splitBlocks, (splitCounts.get(row.splitBlocks) ?? 0) + 1);
}

console.log('\nseed  comprimento  blocos  splits  rotas  rota(s) m       larg.min  raio.min  rampa  ms   ok');
for (const row of rows) {
  const routeLengths = row.routeLengths.map((value) => value.toFixed(0)).join('/');
  const widths = row.routeMinWidths
    .map((value) => value.toFixed(1))
    .join('/');
  const radii = row.routeMinRadii.map((value) => value.toFixed(0)).join('/');
  const slopes = row.routeMaxSlopes
    .map((value) => value.toFixed(2))
    .join('/');
  console.log(
    `${String(row.seed).padStart(4)}  ${row.length.toFixed(0).padStart(9)}  ` +
      `${String(row.blocks).padStart(6)}  ${String(row.splitBlocks).padStart(6)}  ` +
      `${String(row.routes).padStart(5)}  ${(routeLengths || '—').padEnd(14)}  ` +
      `${(widths || '—').padEnd(8)}  ${(radii || '—').padEnd(8)}  ` +
      `${(slopes || '—').padEnd(5)}  ${row.ms.toFixed(0).padStart(3)}  ` +
      `${row.issues.length === 0 ? 'sim' : 'NÃO'}`,
  );
  for (const issue of row.issues) {
    console.log(`        ! ${issue}`);
  }
}

const lengths = rows.filter((row) => row.length > 0).map((row) => row.length);
const allRoutes = rows.flatMap((row) => row.routeLengths);
const allWidths = rows.flatMap((row) => row.routeMinWidths);
const allRadii = rows.flatMap((row) => row.routeMinRadii);
const allSlopes = rows.flatMap((row) => row.routeMaxSlopes);

console.log(`\nGerador: v3`);
console.log(`Resultado: ${valid.length}/${rows.length} seeds válidas em ${totalMs.toFixed(0)} ms.`);
if (lengths.length > 0) {
  console.log(
    `Comprimento: ${Math.min(...lengths).toFixed(1)}..${Math.max(...lengths).toFixed(1)} m`,
  );
}
console.log(
  `Blocos por seed: ${Math.min(...rows.map((row) => row.blocks))}..${Math.max(...rows.map((row) => row.blocks))} | ` +
    `splits por seed: ${[...splitCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, value]) => `${key}:${value}`)
      .join(' ')}`,
);
if (allRoutes.length > 0) {
  console.log(
    `Rotas: ${Math.min(...allRoutes).toFixed(1)}..${Math.max(...allRoutes).toFixed(1)} m | ` +
      `largura mínima ${Math.min(...allWidths).toFixed(2)} m | ` +
      `raio mínimo ${Math.min(...allRadii).toFixed(1)} m | ` +
      `inclinação máxima ${Math.max(...allSlopes).toFixed(2)}`,
  );
}

const hairpinSeeds = rows.filter((row) =>
  (row.def.blocks ?? []).some((block) => block.hairpin),
).length;
const kickerCounts = rows
  .filter((row) => row.def.blocks?.length)
  .map((row) => row.def.kickers?.length ?? 0);
const hazardCounts = rows
  .filter((row) => row.def.blocks?.length)
  .map((row) => row.def.hazards?.length ?? 0);
const powerupCounts = rows
  .filter((row) => row.def.blocks?.length)
  .map((row) => row.def.powerups?.length ?? 0);
if (kickerCounts.length > 0) {
  console.log(
    `Hairpin: ${hairpinSeeds}/${kickerCounts.length} seeds | ` +
      `kickers: ${Math.min(...kickerCounts)}..${Math.max(...kickerCounts)} | ` +
      `hazards: ${Math.min(...hazardCounts)}..${Math.max(...hazardCounts)} | ` +
      `powerups: ${Math.min(...powerupCounts)}..${Math.max(...powerupCounts)}`,
  );
}

// SVG top-down da primeira seed com split.
const preview = rows.find((row) => row.def.forks?.length) ?? rows[0];
if (preview && preview.track) {
  const svg = buildSvg(preview);
  const svgPath = resolve(
    readArg('--svg') ?? `/tmp/opencode/proc-v3-seed-${preview.seed}.svg`,
  );
  mkdirSync(dirname(svgPath), { recursive: true });
  writeFileSync(svgPath, svg);
  console.log(`\nPreview SVG (seed ${preview.seed}): ${svgPath}`);
}

function buildSvg(row: Row): string {
  const points: Array<{ x: number; z: number }> = [];
  for (let s = 0; s <= row.track.length; s += 3) {
    const sample = row.track.sampleAt(s);
    points.push({ x: sample.position.x, z: sample.position.z });
  }
  for (const branch of row.track.branches) {
    for (let s = 0; s <= branch.length; s += 3) {
      const sample = branch.sampleAt(s);
      points.push({ x: sample.position.x, z: sample.position.z });
    }
  }

  const minX = Math.min(...points.map((p) => p.x)) - 40;
  const maxX = Math.max(...points.map((p) => p.x)) + 40;
  const minZ = Math.min(...points.map((p) => p.z)) - 40;
  const maxZ = Math.max(...points.map((p) => p.z)) + 40;
  const width = 1200;
  const scale = width / Math.max(1, maxX - minX);
  const height = Math.max(400, (maxZ - minZ) * scale);
  const tx = (x: number) => ((x - minX) * scale).toFixed(1);
  const tz = (z: number) => ((z - minZ) * scale).toFixed(1);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height.toFixed(0)}" viewBox="0 0 ${width} ${height.toFixed(0)}">`,
    `<rect width="100%" height="100%" fill="#101413"/>`,
  ];

  for (const block of row.def.blocks ?? []) {
    if (block.kind !== 'split') continue;
    const samples: string[] = [];
    for (let s = block.startS; s <= block.endS; s += 4) {
      const sample = row.track.sampleAt(s);
      samples.push(`${tx(sample.position.x)},${tz(sample.position.z)}`);
    }
    parts.push(
      `<polyline points="${samples.join(' ')}" fill="none" stroke="#7d6b4a" stroke-width="18" opacity="0.35" stroke-linecap="round"/>`,
    );
  }

  const trunk: string[] = [];
  for (let s = 0; s <= row.track.length; s += 3) {
    const sample = row.track.sampleAt(s);
    trunk.push(`${tx(sample.position.x)},${tz(sample.position.z)}`);
  }
  parts.push(
    `<polyline points="${trunk.join(' ')}" fill="none" stroke="#e8dcc4" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  for (const branch of row.track.branches) {
    const route: string[] = [];
    for (let s = 0; s <= branch.length; s += 3) {
      const sample = branch.sampleAt(s);
      route.push(`${tx(sample.position.x)},${tz(sample.position.z)}`);
    }
    parts.push(
      `<polyline points="${route.join(' ')}" fill="none" stroke="#e0573c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  for (const split of row.def.splits) {
    const sample = row.track.sampleAt(split.s);
    parts.push(
      `<circle cx="${tx(sample.position.x)}" cy="${tz(sample.position.z)}" r="6" fill="#f0c44a"/>`,
    );
  }

  parts.push(
    `<text x="16" y="24" fill="#f0ece0" font-family="monospace" font-size="16">Rally Arcade — v3 seed ${row.seed} · ${row.length.toFixed(0)} m · ${row.splitBlocks} split(s)</text>`,
    '</svg>',
  );
  return parts.join('\n');
}
