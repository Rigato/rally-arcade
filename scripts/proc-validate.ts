/**
 * Teste do gerador procedural — gera N seeds, valida com o sampler real e
 * imprime estatísticas. Também escreve um preview top-down em SVG.
 *
 * Uso:
 *   npx --yes tsx scripts/proc-validate.ts
 *   npx --yes tsx scripts/proc-validate.ts --count 50 --start 100
 *   npx --yes tsx scripts/proc-validate.ts --svg /tmp/opencode/minha-pista.svg
 *
 * Não integra no jogo e não altera nenhum arquivo de `src/` compartilhado.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TrackDef } from '../src/game/types';
import { Track } from '../src/track/Track';
import {
  generateProceduralTrack,
  validateProceduralTrack,
  type ProceduralValidation,
} from '../src/track/procedural/ProceduralTrack';

const args = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const count = Math.max(1, Number.parseInt(readArg('--count') ?? '20', 10) || 20);
const startSeed = Number.parseInt(readArg('--start') ?? '1', 10) || 1;
const svgPath = resolve(
  readArg('--svg') ?? `/tmp/opencode/rally-proc-seed-${startSeed}.svg`,
);

interface Row {
  seed: number;
  validation: ProceduralValidation;
  elapsedMs: number;
}

const rows: Row[] = [];
const failures: string[] = [];

for (let i = 0; i < count; i += 1) {
  const seed = startSeed + i;
  const start = performance.now();

  try {
    const def = generateProceduralTrack(seed);
    const elapsedMs = performance.now() - start;
    const validation = validateProceduralTrack(def, { quiet: true });
    rows.push({ seed, validation, elapsedMs });

    if (!validation.ok) {
      failures.push(
        `seed ${seed}: ${validation.errors.join(' | ')}`,
      );
    }
  } catch (error) {
    rows.push({
      seed,
      validation: {
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        stats: {
          length: 0,
          points: 0,
          zones: 0,
          minRadius: 0,
          minRadiusS: 0,
          minWidth: 0,
          maxWidth: 0,
          maxGrade: 0,
          obstacles: 0,
          powerups: 0,
          kickers: 0,
          splits: 0,
          startToFinish: 0,
        },
      },
      elapsedMs: performance.now() - start,
    });
    failures.push(
      `seed ${seed}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

printTable(rows);
printSummary(rows, failures);

const previewSeed = rows[0]?.seed ?? startSeed;
const previewDef = generateProceduralTrack(previewSeed);
writePreview(previewDef, svgPath);
console.log(`\nPreview SVG (seed ${previewSeed}): ${svgPath}`);

if (failures.length > 0) {
  process.exitCode = 1;
}

function printTable(items: readonly Row[]): void {
  const header = [
    'seed',
    'compr.',
    'zonas',
    'raio min',
    'larg. min/max',
    'grade',
    'obst.',
    'pow.',
    'kicks',
    'splits',
    'larg→cheg',
    'ms',
    'ok',
  ];

  console.log(
    [
      header[0].padStart(4),
      header[1].padStart(7),
      header[2].padStart(5),
      header[3].padStart(8),
      header[4].padStart(12),
      header[5].padStart(6),
      header[6].padStart(5),
      header[7].padStart(5),
      header[8].padStart(5),
      header[9].padStart(6),
      header[10].padStart(9),
      header[11].padStart(6),
      header[12].padStart(3),
    ].join(' '),
  );
  console.log('-'.repeat(88));

  for (const row of items) {
    const s = row.validation.stats;
    console.log(
      [
        String(row.seed).padStart(4),
        `${s.length.toFixed(1)}m`.padStart(7),
        String(s.zones).padStart(5),
        `${s.minRadius.toFixed(1)}m`.padStart(8),
        `${s.minWidth.toFixed(1)}/${s.maxWidth.toFixed(1)}`.padStart(12),
        `${(s.maxGrade * 100).toFixed(0)}%`.padStart(6),
        String(s.obstacles).padStart(5),
        String(s.powerups).padStart(5),
        String(s.kickers).padStart(5),
        String(s.splits).padStart(6),
        `${s.startToFinish.toFixed(0)}m`.padStart(9),
        row.elapsedMs.toFixed(0).padStart(6),
        row.validation.ok ? 'yes' : 'NO',
      ].join(' '),
    );
  }
}

function printSummary(items: readonly Row[], errors: readonly string[]): void {
  const valid = items.filter((row) => row.validation.ok);
  const lengths = valid.map((row) => row.validation.stats.length);
  const radii = valid.map((row) => row.validation.stats.minRadius);
  const widthsMin = valid.map((row) => row.validation.stats.minWidth);
  const widthsMax = valid.map((row) => row.validation.stats.maxWidth);
  const grades = valid.map((row) => row.validation.stats.maxGrade);
  const times = items.map((row) => row.elapsedMs);

  console.log(`\nResultado: ${valid.length}/${items.length} seeds válidas.`);

  if (valid.length > 0) {
    console.log(
      `Comprimento: ${range(lengths)} m | ` +
        `raio mínimo: ${range(radii)} m | ` +
        `largura: ${Math.min(...widthsMin).toFixed(1)}..${Math.max(...widthsMax).toFixed(1)} m`,
    );
    console.log(
      `Grade máxima: ${range(grades.map((grade) => grade * 100))}% | ` +
        `tempo de geração: ${range(times)} ms`,
    );
    console.log(
      `Obstáculos: ${range(valid.map((row) => row.validation.stats.obstacles))} | ` +
        `powerups: ${range(valid.map((row) => row.validation.stats.powerups))} | ` +
        `kickers: ${range(valid.map((row) => row.validation.stats.kickers))}`,
    );
  }

  const warningCount = valid.reduce(
    (total, row) => total + row.validation.warnings.length,
    0,
  );
  if (warningCount > 0) {
    console.log(`\nAvisos (${warningCount}):`);
    for (const row of valid) {
      for (const warning of row.validation.warnings) {
        console.log(`  seed ${row.seed}: ${warning}`);
      }
    }
  }

  if (errors.length > 0) {
    console.log('\nFalhas:');
    for (const error of errors) {
      console.log(`  ${error}`);
    }
  }

  // Verificação explícita de determinismo: duas gerações da mesma seed devem
  // ser idênticas campo a campo.
  if (items.length > 0) {
    const seed = items[0].seed;
    const a = generateProceduralTrack(seed);
    const b = generateProceduralTrack(seed);
    const same = JSON.stringify(a) === JSON.stringify(b);
    console.log(`Determinismo (seed ${seed} duas vezes): ${same ? 'OK' : 'FALHOU'}`);
    if (!same) {
      errors.push(`seed ${seed} não é determinística`);
    }
  }
}

function range(values: readonly number[]): string {
  if (values.length === 0) {
    return '-';
  }
  return `${Math.min(...values).toFixed(1)}..${Math.max(...values).toFixed(1)}`;
}

function writePreview(def: TrackDef, path: string): void {
  const track = new Track(def);
  const step = 2;
  const samples: {
    s: number;
    x: number;
    z: number;
    width: number;
    zone: string;
  }[] = [];

  for (let s = 0; s <= track.length; s += step) {
    const sample = track.sampleAt(Math.min(s, track.length));
    samples.push({
      s: sample.s,
      x: sample.position.x,
      z: sample.position.z,
      width: sample.width,
      zone: sample.zone,
    });
  }

  const xs = samples.map((sample) => sample.x);
  const zs = samples.map((sample) => sample.z);
  const margin = 30;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minZ = Math.min(...zs) - margin;
  const maxZ = Math.max(...zs) + margin;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxZ - minZ);

  const zoneColors: Record<string, string> = {
    forest: '#3f7a4b',
    desert: '#c9a25e',
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minZ.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" width="1000" height="${Math.round((1000 * height) / width)}">`,
  );
  parts.push('<rect width="100%" height="100%" fill="#171b19"/>');
  parts.push(
    `<text x="${(minX + 4).toFixed(1)}" y="${(minZ + 12).toFixed(1)}" fill="#e8e4d8" font-family="monospace" font-size="7">${def.id} — ${track.length.toFixed(1)} m — ${def.zones.length} zonas</text>`,
  );

  // Faixa de pista (traço grosso) separada por zona.
  for (const zone of def.zones) {
    const points = samples
      .filter((sample) => sample.s >= zone.start && sample.s <= zone.end)
      .map((sample) => `${sample.x.toFixed(1)},${sample.z.toFixed(1)}`)
      .join(' ');
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${zoneColors[zone.id]}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`,
    );
  }

  parts.push(
    `<polyline points="${samples.map((sample) => `${sample.x.toFixed(1)},${sample.z.toFixed(1)}`).join(' ')}" fill="none" stroke="#101413" stroke-width="1.2" stroke-dasharray="2 3"/>`,
  );

  // Splits.
  for (const split of def.splits) {
    const sample = track.sampleAt(split.s);
    parts.push(
      `<circle cx="${sample.position.x.toFixed(1)}" cy="${sample.position.z.toFixed(1)}" r="3" fill="#66c7ff"/>`,
      `<text x="${(sample.position.x + 4).toFixed(1)}" y="${(sample.position.z - 3).toFixed(1)}" fill="#66c7ff" font-family="monospace" font-size="5">${split.name}</text>`,
    );
  }

  // Kickers.
  for (const kicker of def.kickers) {
    const sample = track.sampleAt(kicker.s);
    parts.push(
      `<circle cx="${sample.position.x.toFixed(1)}" cy="${sample.position.z.toFixed(1)}" r="2.6" fill="#ff9f43"/>`,
      `<text x="${(sample.position.x + 3.5).toFixed(1)}" y="${(sample.position.z + 6).toFixed(1)}" fill="#ff9f43" font-family="monospace" font-size="5">k${kicker.height.toFixed(1)}</text>`,
    );
  }

  // Obstáculos (posição aproximada a partir de s/u).
  for (const obstacle of def.obstacles) {
    const sample = track.sampleAt(obstacle.s);
    const x = sample.position.x + sample.right.x * obstacle.u;
    const z = sample.position.z + sample.right.z * obstacle.u;
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="1.1" fill="#a3aaa4" opacity="0.8"/>`,
    );
  }

  // Powerups.
  for (const powerup of def.powerups) {
    const sample = track.sampleAt(powerup.s);
    const x = sample.position.x + sample.right.x * powerup.u;
    const z = sample.position.z + sample.right.z * powerup.u;
    const color = powerup.type === 'turbo' ? '#ffb347' : '#38a9ff';
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="1.6" fill="${color}"/>`,
    );
  }

  const start = track.sampleAt(0);
  const startX = start.position.x;
  const startZ = start.position.z;
  const finish = track.sampleAt(track.length);
  const finishX = finish.position.x;
  const finishZ = finish.position.z;
  parts.push(
    `<circle cx="${startX.toFixed(1)}" cy="${startZ.toFixed(1)}" r="3" fill="#7dff8a"/>`,
    `<text x="${(startX + 4).toFixed(1)}" y="${(startZ + 2).toFixed(1)}" fill="#7dff8a" font-family="monospace" font-size="5">START</text>`,
    `<circle cx="${finishX.toFixed(1)}" cy="${finishZ.toFixed(1)}" r="3" fill="#ffffff"/>`,
    `<text x="${(finishX + 4).toFixed(1)}" y="${(finishZ + 2).toFixed(1)}" fill="#ffffff" font-family="monospace" font-size="5">FINISH</text>`,
  );

  parts.push('</svg>');

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${parts.join('\n')}\n`, 'utf8');
}
