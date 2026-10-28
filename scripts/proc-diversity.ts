/**
 * Relatório de diversidade do gerador procedural novo.
 *
 * Gera N seeds e imprime, por seed: comprimento, raio mínimo medido, curvas
 * por categoria (longa/média/curta/cotovelo/hairpin), sweep total para cada
 * lado, caixa delimitadora, distância largada→chegada e separação mínima entre
 * trechos. Também escreve um contact sheet SVG top-down com as seeds.
 *
 * Uso:
 *   npx --yes tsx scripts/proc-diversity.ts
 *   npx --yes tsx scripts/proc-diversity.ts --count 16 --start 1
 *   npx --yes tsx scripts/proc-diversity.ts --svg /tmp/opencode/meu-sheet.svg
 *
 * PNG (opcional, se houver ImageMagick/Chromium):
 *   convert /tmp/opencode/proc-sheet.svg /tmp/opencode/proc-sheet.png
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TrackDef } from '../src/game/types';
import { Track } from '../src/track/Track';
import {
  generateProceduralTrack,
  getProceduralLayout,
  validateProceduralTrack,
  type CurveCategory,
  type ProceduralLayout,
} from '../src/track/procedural/ProceduralTrack';

const args = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const count = Math.max(1, Number.parseInt(readArg('--count') ?? '12', 10) || 12);
const startSeed = Number.parseInt(readArg('--start') ?? '1', 10) || 1;
const svgPath = resolve(readArg('--svg') ?? '/tmp/opencode/proc-sheet-v5.svg');

const CATEGORIES: readonly CurveCategory[] = [
  'long',
  'medium',
  'short',
  'elbow',
  'hairpin',
  'hairpin-extreme',
  'kink',
];

interface Row {
  seed: number;
  def: TrackDef;
  layout: ProceduralLayout;
  length: number;
  minRadius: number;
  counts: Record<CurveCategory, number>;
  leftSweep: number;
  rightSweep: number;
  bboxWidth: number;
  bboxHeight: number;
  startToFinish: number;
  minSectionDistance: number;
  flatFraction: number;
  chokes: number;
  longNarrow: number;
  wide: number;
  elapsedMs: number;
  ok: boolean;
}

const rows: Row[] = [];
const failures: string[] = [];
const startedAt = performance.now();

for (let index = 0; index < count; index += 1) {
  const seed = startSeed + index;
  const start = performance.now();

  try {
    const def = generateProceduralTrack(seed);
    const validation = validateProceduralTrack(def, {
      quiet: true,
      profile: 'v5',
    });
    const layout = getProceduralLayout(def);

    if (!layout) {
      failures.push(`seed ${seed}: sem metadados de layout`);
      continue;
    }

    const counts = Object.fromEntries(
      CATEGORIES.map((category) => [category, 0]),
    ) as Record<CurveCategory, number>;
    let leftSweep = 0;
    let rightSweep = 0;

    for (const curve of layout.curves) {
      counts[curve.category] += 1;
      if (curve.direction === 'left') {
        leftSweep += curve.sweepDeg;
      } else {
        rightSweep += curve.sweepDeg;
      }
    }

    rows.push({
      seed,
      def,
      layout,
      length: validation.stats.length,
      minRadius: validation.stats.minRadius,
      counts,
      leftSweep,
      rightSweep,
      bboxWidth: validation.stats.bboxWidth,
      bboxHeight: validation.stats.bboxHeight,
      startToFinish: validation.stats.startToFinish,
      minSectionDistance: validation.stats.minSectionDistance,
      flatFraction: validation.stats.flatFraction,
      chokes: validation.stats.features?.chokes ?? 0,
      longNarrow: validation.stats.features?.longNarrow ?? 0,
      wide: validation.stats.features?.wide ?? 0,
      elapsedMs: performance.now() - start,
      ok: validation.ok,
    });

    if (!validation.ok) {
      failures.push(`seed ${seed}: ${validation.errors.join(' | ')}`);
    }
  } catch (error) {
    failures.push(
      `seed ${seed}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

printTable(rows);
printSummary(rows, failures);
writeContactSheet(rows, svgPath);

console.log(`\nContact sheet SVG: ${svgPath}`);
console.log(
  `PNG: chromium --headless --no-sandbox --hide-scrollbars --window-size=1360,900 --screenshot=${svgPath.replace(/[.]svg$/, '.png')} file://${svgPath}`,
);

if (failures.length > 0) {
  process.exitCode = 1;
}

function printTable(items: readonly Row[]): void {
  console.log(
    [
      'seed'.padStart(4),
      'compr.'.padStart(8),
      'rmin'.padStart(6),
      'long'.padStart(4),
      'med'.padStart(4),
      'cur'.padStart(4),
      'elb'.padStart(4),
      'hair'.padStart(4),
      'ext'.padStart(4),
      'kink'.padStart(4),
      'L°'.padStart(5),
      'R°'.padStart(5),
      'chk'.padStart(3),
      'est'.padStart(3),
      'larg'.padStart(4),
      'plano'.padStart(5),
      'caixa'.padStart(9),
      'A→B'.padStart(6),
      'sep'.padStart(5),
      'ms'.padStart(5),
      'ok'.padStart(3),
    ].join(' '),
  );
  console.log('-'.repeat(105));

  for (const row of items) {
    console.log(
      [
        String(row.seed).padStart(4),
        `${row.length.toFixed(1)}m`.padStart(8),
        `${row.minRadius.toFixed(1)}m`.padStart(6),
        String(row.counts.long).padStart(4),
        String(row.counts.medium).padStart(4),
        String(row.counts.short).padStart(4),
        String(row.counts.elbow).padStart(4),
        String(row.counts.hairpin).padStart(4),
        String(row.counts['hairpin-extreme']).padStart(4),
        String(row.counts.kink).padStart(4),
        row.leftSweep.toFixed(0).padStart(5),
        row.rightSweep.toFixed(0).padStart(5),
        String(row.chokes).padStart(3),
        String(row.longNarrow).padStart(3),
        String(row.wide).padStart(4),
        `${(row.flatFraction * 100).toFixed(0)}%`.padStart(5),
        `${row.bboxWidth.toFixed(0)}×${row.bboxHeight.toFixed(0)}`.padStart(9),
        `${row.startToFinish.toFixed(0)}m`.padStart(6),
        `${row.minSectionDistance.toFixed(1)}`.padStart(5),
        row.elapsedMs.toFixed(0).padStart(5),
        row.ok ? 'yes' : 'NO',
      ].join(' '),
    );
  }
}

function printSummary(items: readonly Row[], errors: readonly string[]): void {
  const valid = items.filter((row) => row.ok);
  const totalMs = performance.now() - startedAt;

  console.log(`\nResultado: ${valid.length}/${items.length} seeds válidas em ${totalMs.toFixed(0)} ms.`);
  if (valid.length === 0) {
    return;
  }

  const categoryTotals = Object.fromEntries(
    CATEGORIES.map((category) => [category, 0]),
  ) as Record<CurveCategory, number>;
  for (const row of valid) {
    for (const category of CATEGORIES) {
      categoryTotals[category] += row.counts[category];
    }
  }

  const distinctPerSeed = valid.map(
    (row) => CATEGORIES.filter((category) => row.counts[category] > 0).length,
  );
  const leftRight = valid.map((row) => row.leftSweep / row.rightSweep);

  console.log(
    `Categorias (total de curvas): ${CATEGORIES.map(
      (category) => `${category}=${categoryTotals[category]}`,
    ).join(', ')}`,
  );
  console.log(
    `Categorias distintas por seed: ${range(distinctPerSeed.map((value) => value))} ` +
      `(mínimo ${Math.min(...distinctPerSeed)}) | ` +
      `balanço L/R: ${range(leftRight.map((value) => value * 100))}%`,
  );
  console.log(
    `Comprimento: ${range(valid.map((row) => row.length))} m | ` +
      `raio mínimo: ${range(valid.map((row) => row.minRadius))} m | ` +
      `A→B: ${range(valid.map((row) => row.startToFinish))} m`,
  );
  console.log(
    `Chokes: ${range(valid.map((row) => row.chokes))} | ` +
      `longos estreitos: ${range(valid.map((row) => row.longNarrow))} | ` +
      `largos: ${range(valid.map((row) => row.wide))} | ` +
      `faixas planas: ${range(valid.map((row) => row.flatFraction * 100))}%`,
  );
  console.log(
    `Caixa: até ${Math.max(
      ...valid.map((row) => Math.max(row.bboxWidth, row.bboxHeight)),
    ).toFixed(0)} m | ` +
      `separação mínima: ${Math.min(
        ...valid.map((row) => row.minSectionDistance),
      ).toFixed(1)} m | ` +
      `geração: ${range(valid.map((row) => row.elapsedMs))} ms/seed`,
  );

  if (errors.length > 0) {
    console.log('\nFalhas:');
    for (const error of errors) {
      console.log(`  ${error}`);
    }
  }
}

function range(values: readonly number[]): string {
  if (values.length === 0) {
    return '-';
  }
  return `${Math.min(...values).toFixed(1)}..${Math.max(...values).toFixed(1)}`;
}

function quietTrack(def: TrackDef): Track {
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    return new Track(def);
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

function writeContactSheet(items: readonly Row[], path: string): void {  const shown = items.slice(0, 20);
  const columns = shown.length <= 12 ? 4 : 5;
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const cellWidth = 340;
  const cellHeight = 280;
  const header = 54;
  const width = columns * cellWidth;
  const height = header + rows * cellHeight;
  const zoneColors: Record<string, string> = {
    forest: '#4f9a5d',
    desert: '#d3a95f',
  };
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#141816"/>`);
  parts.push(
    `<text x="16" y="24" fill="#f0ece0" font-family="monospace" font-size="16">Rally Arcade — diversidade procedural (${shown.length} seeds, ${columns}×${rows})</text>`,
  );
  parts.push(
    `<text x="16" y="42" fill="#9aa89c" font-family="monospace" font-size="10">verde = largada · branco = chegada · cores = setores floresta/deserto · escala independente por célula</text>`,
  );

  shown.forEach((row, index) => {
    const column = index % columns;
    const line = Math.floor(index / columns);
    const originX = column * cellWidth;
    const originY = header + line * cellHeight;
    const track = quietTrack(row.def);
    const step = 2;
    const samples: { x: number; z: number; s: number; zone: string }[] = [];

    for (let s = 0; s <= track.length; s += step) {
      const sample = track.sampleAt(Math.min(s, track.length));
      samples.push({
        x: sample.position.x,
        z: sample.position.z,
        s,
        zone: sample.zone,
      });
    }

    const xs = samples.map((sample) => sample.x);
    const zs = samples.map((sample) => sample.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const padding = 34;
    const scale = Math.min(
      (cellWidth - padding * 2) / Math.max(1, maxX - minX),
      (cellHeight - padding * 2 - 22) / Math.max(1, maxZ - minZ),
    );
    const offsetX =
      originX + (cellWidth - (maxX - minX) * scale) * 0.5;
    const offsetY =
      originY +
      26 +
      (cellHeight - 26 - (maxZ - minZ) * scale) * 0.5;
    const project = (x: number, z: number): string =>
      `${(offsetX + (x - minX) * scale).toFixed(1)},${(offsetY + (z - minZ) * scale).toFixed(1)}`;

    parts.push(
      `<rect x="${originX + 2}" y="${originY + 2}" width="${cellWidth - 4}" height="${cellHeight - 4}" rx="6" fill="#1b211d" stroke="#2c352e"/>`,
    );

    for (const zone of row.def.zones) {
      const points = samples
        .filter((sample) => sample.s >= zone.start && sample.s <= zone.end)
        .map((sample) => project(sample.x, sample.z))
        .join(' ');
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${zoneColors[zone.id]}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.78"/>`,
      );
    }

    parts.push(
      `<polyline points="${samples.map((sample) => project(sample.x, sample.z)).join(' ')}" fill="none" stroke="#0d100e" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`,
    );

    const start = samples[0];
    const finish = samples[samples.length - 1];
    const [sx, sy] = project(start.x, start.z).split(',');
    const [fx, fy] = project(finish.x, finish.z).split(',');
    parts.push(
      `<circle cx="${sx}" cy="${sy}" r="5" fill="#7dff8a"/>`,
      `<circle cx="${fx}" cy="${fy}" r="5" fill="#ffffff"/>`,
    );

    const label = `#${row.seed} ${row.length.toFixed(0)} m · r${row.minRadius.toFixed(0)} · A→B ${row.startToFinish.toFixed(0)} m`;
    const counts = `L${row.counts.long} M${row.counts.medium} C${row.counts.short} E${row.counts.elbow} H${row.counts.hairpin} X${row.counts['hairpin-extreme']} K${row.counts.kink}`;
    const balance = `chk ${row.chokes} · est ${row.longNarrow} · larg ${row.wide} · plano ${(row.flatFraction * 100).toFixed(0)}% · esq ${row.leftSweep.toFixed(0)}° / dir ${row.rightSweep.toFixed(0)}°`;
    parts.push(
      `<text x="${originX + 12}" y="${originY + 20}" fill="#f0ece0" font-family="monospace" font-size="11">${label}</text>`,
      `<text x="${originX + 12}" y="${originY + cellHeight - 28}" fill="#9fc9a8" font-family="monospace" font-size="10">${counts}</text>`,
      `<text x="${originX + 12}" y="${originY + cellHeight - 14}" fill="#7fa989" font-family="monospace" font-size="8.5">${balance}</text>`,
    );
  });

  parts.push('</svg>');

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${parts.join('\n')}\n`, 'utf8');
}
