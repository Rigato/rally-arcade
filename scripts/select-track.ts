/**
 * Seleção da seed da pista fixa A→B — compara as seeds com as mesmas regras do
 * `validate-track.ts` (B1), sem alterar nenhum arquivo compartilhado.
 *
 * O gerador sempre tem um hairpin de 26,3–27,5 m, então congelamos a seed com
 * uma escala uniforme que leve o raio mínimo para >= 30,1 m (mantendo o
 * comprimento <= 1100 m). Este script calcula a escala, projeta as medidas e
 * imprime as seeds viáveis.
 *
 * Uso:
 *   node_modules/.bin/rolldown scripts/select-track.ts --format esm --platform node \
 *     --file /tmp/opencode/select-track.mjs && node /tmp/opencode/select-track.mjs
 */
import { Track } from '../src/track/Track';
import {
  generateProceduralTrack,
  validateProceduralTrack,
} from '../src/track/procedural/ProceduralTrack';
import type { TrackDef } from '../src/game/types';

interface Row {
  seed: number;
  length: number;
  minRadius: number;
  kickers: number;
  powerups: number;
  scale: number;
  scaledLength: number;
  scaledRadius: number;
  scaledPowerupRadius: number;
  startToFinish: number;
  kickerHeights: string;
  valid: boolean;
}

function b1Radius(def: TrackDef): { radius: number; s: number } {
  const track = new Track(def);
  const sampleCount = Math.round(track.length);
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const s = (index / sampleCount) * track.length;
    const sample = track.sampleAt(s);
    return { s, x: sample.position.x, z: sample.position.z };
  });

  const radiusAt = (index: number): number => {
    const from = Math.max(0, index - 5);
    const to = Math.min(samples.length - 1, index + 5);
    const a = samples[from];
    const b = samples[index];
    const c = samples[to];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area =
      Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    return area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
  };

  let radius = Infinity;
  let s = 0;
  for (let i = 5; i < samples.length - 5; i += 1) {
    const value = radiusAt(i);
    if (value < radius) {
      radius = value;
      s = samples[i].s;
    }
  }
  return { radius, s };
}

function powerupRadius(def: TrackDef, s: number): number {
  const track = new Track(def);
  const index = Math.round((s / track.length) * track.sampleCount);
  const samples = [
    Math.max(0, index - 5),
    index,
    Math.min(track.sampleCount, index + 5),
  ].map((i) => {
    const sample = track.sampleAt(i * track.step);
    return { s: sample.s, x: sample.position.x, z: sample.position.z };
  });
  const [a, b, c] = samples;
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area =
    Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  return area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
}

const MIN_RADIUS = 30.1;
const rows: Row[] = [];

for (let seed = 1; seed <= 100; seed += 1) {
  const def = generateProceduralTrack(seed);
  const track = new Track(def);
  const length = track.length;
  const { radius } = b1Radius(def);
  const scale = Math.max(MIN_RADIUS / radius, 1);
  const scaledLength = length * scale;
  const powerupRadii = def.powerups.map((powerup) => powerupRadius(def, powerup.s));
  const scaledPowerupRadius = Math.min(...powerupRadii) * scale;

  const start = track.sampleAt(0);
  const sx = start.position.x;
  const sz = start.position.z;
  const finish = track.sampleAt(length);
  const fx = finish.position.x;
  const fz = finish.position.z;
  const validation = validateProceduralTrack(def, { quiet: true });

  rows.push({
    seed,
    length,
    minRadius: radius,
    kickers: def.kickers.length,
    powerups: def.powerups.length,
    scale,
    scaledLength,
    scaledRadius: radius * scale,
    scaledPowerupRadius,
    startToFinish: Math.hypot(sx - fx, sz - fz),
    kickerHeights: def.kickers.map((k) => `${k.height.toFixed(1)}x${k.length.toFixed(1)}`).join(','),
    valid: validation.ok,
  });
}

const viable = rows
  .filter(
    (row) =>
      row.valid &&
      row.kickers === 2 &&
      row.scaledLength >= 950 &&
      row.scaledLength <= 1100 &&
      row.scaledPowerupRadius >= 80.5 &&
      row.startToFinish >= 60,
  )
  .sort((a, b) => b.startToFinish - a.startToFinish);

console.log(
  [
    'seed',
    'L0',
    'raio0',
    'k',
    'Lfix',
    'raioFix',
    'powR',
    'A-B',
    'kicks',
    'pows',
    'alturas',
    'ok',
  ].join('\t'),
);
for (const row of viable.slice(0, 30)) {
  console.log(
    [
      row.seed,
      row.length.toFixed(1),
      row.minRadius.toFixed(1),
      row.scale.toFixed(4),
      row.scaledLength.toFixed(1),
      row.scaledRadius.toFixed(1),
      row.scaledPowerupRadius.toFixed(0),
      row.startToFinish.toFixed(0),
      row.kickers,
      row.powerups,
      row.kickerHeights,
      row.valid ? 'yes' : 'NO',
    ].join('\t'),
  );
}
console.log(`\n${viable.length} seeds viáveis.`);
