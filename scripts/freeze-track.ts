/**
 * Congela a seed escolhida no formato do `TrackDef` fixo A→B.
 *
 * Estratégia: `generateProceduralTrack(91)` gera o traçado em serpentina com 4
 * zonas. O gerador sempre tem um hairpin de ~26,3–27,5 m de raio; uma escala
 * uniforme de 1.1102 leva o raio mínimo para ~30,2 m e o comprimento para
 * ~1097 m. Larguras, alturas de rampa, `u` dos powerups/obstáculos e o relevo
 * relativo ficam intactos (a escala é uniforme em x/y/z).
 *
 * Uso:
 *   node_modules/.bin/rolldown scripts/freeze-track.ts --format esm --platform node \
 *     --file /tmp/opencode/freeze-track.mjs && node /tmp/opencode/freeze-track.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Track } from '../src/track/Track';
import { generateProceduralTrack } from '../src/track/procedural/ProceduralTrack';
import { Obstacles } from '../src/track/Obstacles';
import type { TrackDef } from '../src/game/types';

const SEED = 91;
const MIN_RADIUS_TARGET = 30.55;
const ELEVATION_SCALE = 0.72;
const MAX_LENGTH = 1099.5;

const source = generateProceduralTrack(SEED);
const sourceTrack = new Track(source);

function minRadiusOf(track: Track): number {
  const sampleCount = Math.round(track.length);
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const s = (index / sampleCount) * track.length;
    const sample = track.sampleAt(s);
    return { s, x: sample.position.x, z: sample.position.z };
  });
  let minRadius = Infinity;
  for (let i = 5; i < samples.length - 5; i += 1) {
    const a = samples[i - 5];
    const b = samples[i];
    const c = samples[i + 5];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area =
      Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    const radius = area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
    minRadius = Math.min(minRadius, radius);
  }
  return minRadius;
}

const sourceRadius = minRadiusOf(sourceTrack);
const scale = Math.max(MIN_RADIUS_TARGET / sourceRadius, 1);

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}
function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

let points = source.points.map((point) => ({
  x: r2(point.x * scale),
  z: r2(point.z * scale),
  y: r2(point.y * scale * ELEVATION_SCALE),
  width: r2(point.width),
}));

const provisional: TrackDef = {
  id: `track01-v3`,
  points,
  zones: source.zones,
  kickers: source.kickers.map((kicker) => ({
    s: r1(kicker.s * scale),
    length: kicker.length,
    height: kicker.height,
  })),
  obstacles: source.obstacles.map((obstacle) => ({
    ...obstacle,
    s: r1(obstacle.s * scale),
  })),
  powerups: source.powerups.map((powerup) => ({
    ...powerup,
    s: r1(powerup.s * scale),
  })),
  splits: source.splits,
  medals: source.medals,
};

let length = new Track(provisional).length;
while (length > MAX_LENGTH && points.length > 20) {
  points.pop();
  length = new Track(provisional).length;
}
const zones = [0, 250, 500, 750, length].map((value, index) =>
  index === 4 ? r1(value) : value,
);

const def: TrackDef = {
  ...provisional,
  zones: [
    { start: zones[0], end: zones[1], id: 'forest', surface: 'gravel' },
    { start: zones[1], end: zones[2], id: 'desert', surface: 'sand' },
    { start: zones[2], end: zones[3], id: 'forest', surface: 'gravel' },
    { start: zones[3], end: zones[4], id: 'desert', surface: 'sand' },
  ],
  splits: [250, 500, 750].map((s, index) => ({
    s,
    name: `Parcial ${index + 1}`,
    target: r1(s / 18),
  })),
  medals: {
    gold: r1(length / 18.5),
    silver: r1((length / 18.5) * 1.14),
    bronze: r1((length / 18.5) * 1.3),
  },
};

const track = new Track(def);

let widthMin = Infinity;
let widthMax = -Infinity;
for (let s = 0; s <= track.length; s += 2) {
  const width = track.widthAt(s);
  widthMin = Math.min(widthMin, width);
  widthMax = Math.max(widthMax, width);
}

const sampleCount = Math.round(track.length);
const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
  const s = (index / sampleCount) * track.length;
  const sample = track.sampleAt(s);
  return { s, x: sample.position.x, z: sample.position.z };
});
let minRadius = Infinity;
for (let i = 5; i < samples.length - 5; i += 1) {
  const a = samples[i - 5];
  const b = samples[i];
  const c = samples[i + 5];
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area =
    Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  const radius = area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
  minRadius = Math.min(minRadius, radius);
}

const startSample = track.sampleAt(0);
const startX = startSample.position.x;
const startZ = startSample.position.z;
const finishSample = track.sampleAt(track.length);
const startToFinish = Math.hypot(
  startX - finishSample.position.x,
  startZ - finishSample.position.z,
);

const elevations = points.map((point) => point.y);
const reliefMin = Math.min(...elevations);
const reliefMax = Math.max(...elevations);

const stats = {
  sourceLength: sourceTrack.length,
  reliefMin,
  reliefMax,
  scale,
  length: track.length,
  startToFinish,
  widthMin,
  widthMax,
  minRadius,
  zones: def.zones,
  kickers: def.kickers,
  powerups: def.powerups,
  splits: def.splits,
  medals: def.medals,
  obstacles: new Obstacles(track).getCount(),
};

const lines: string[] = [];
lines.push(`  id: 'track01-v3',`);
lines.push(`  points: [`);
for (const point of points) {
  lines.push(
    `    { x: ${point.x}, z: ${point.z}, y: ${point.y}, width: ${point.width} },`,
  );
}
lines.push(`  ],`);
lines.push(`  zones: [`);
for (const zone of def.zones) {
  lines.push(
    `    { start: ${zone.start}, end: ${zone.end}, id: '${zone.id}', surface: '${zone.surface}' },`,
  );
}
lines.push(`  ],`);
lines.push(`  kickers: [`);
for (const kicker of def.kickers) {
  lines.push(
    `    { s: ${kicker.s}, length: ${kicker.length}, height: ${kicker.height} },`,
  );
}
lines.push(`  ],`);
lines.push(`  obstacles: [`);
for (const obstacle of def.obstacles) {
  lines.push(
    `    { type: '${obstacle.type}', s: ${obstacle.s}, u: ${r2(obstacle.u)}, radius: ${r2(obstacle.radius)} },`,
  );
}
lines.push(`  ],`);
lines.push(`  powerups: [`);
for (const powerup of def.powerups) {
  lines.push(
    `    { type: '${powerup.type}', s: ${powerup.s}, u: ${r2(powerup.u)} },`,
  );
}
lines.push(`  ],`);
lines.push(`  splits: [`);
for (const split of def.splits) {
  lines.push(
    `    { s: ${split.s}, name: '${split.name}', target: ${split.target} },`,
  );
}
lines.push(`  ],`);
lines.push(
  `  medals: { gold: ${def.medals.gold}, silver: ${def.medals.silver}, bronze: ${def.medals.bronze} },`,
);

const header = `import type { TrackDef } from '../game/types';

/**
 * Pista fixa v3 — A→B aberta, ~1,1 km, quatro setores intercalados
 * floresta/deserto. Congelada do gerador procedural (seed 91) com escala
 * uniforme de ${scale.toFixed(4)} em x/z para levar o raio mínimo a ~30 m,
 * com a elevação multiplicada por ${ELEVATION_SCALE} para respeitar o limite local
 * de inclinação de 13% do validador B1.
 *
 * Layout visto de cima (heading 0 = +Z, +X = direita). Serpentina de quatro
 * pernas paralelas ligadas por três hairpins de 180°; a pista NÃO fecha:
 * largada em s=22 e chegada na ponta oposta, a ~${stats.startToFinish.toFixed(0)} m em linha reta da
 * largada e a ${track.length.toFixed(1)} m percorridos.
 *
 *   leg 1 (+Z)  ↗ hairpin 1 ↘ leg 2 (−Z)  ↗ hairpin 2 ↘
 *   leg 3 (+Z)  ↗ hairpin 3 ↘ leg 4 (−Z) → CHEGADA
 *
 * - Pernas separadas por ~60 m; hairpins de ~${stats.minRadius.toFixed(1)}–${(34 * scale).toFixed(1)} m de raio.
 * - Relevo de ${stats.reliefMin.toFixed(1)} a ${stats.reliefMax.toFixed(1)} m (ondas longas de
 *   320–460 m + cristas curtas).
 * - Largura ${stats.widthMin.toFixed(1)}–${stats.widthMax.toFixed(1)} m, ombros largos (sistema multi-zona).
 * - Setor 1 (0–250 m): floresta, cascalho. Setor 2 (250–500 m): deserto, areia.
 *   Setor 3 (500–750 m): floresta, cascalho. Setor 4 (750–${track.length.toFixed(1)} m): deserto, areia.
 * - Rampas baixas em s=${def.kickers[0]?.s} (${def.kickers[0]?.height.toFixed(2)} m × ${def.kickers[0]?.length.toFixed(2)} m)
 *   e s=${def.kickers[1]?.s} (${def.kickers[1]?.height.toFixed(2)} m × ${def.kickers[1]?.length.toFixed(2)} m),
 *   ambas em trecho reto com 40 m+ de pouso.
 * - Powerups em s=${def.powerups.map((powerup) => powerup.s).join(', ')}; o gerador
 *   mantém 18 m antes e 20 m depois de cada rampa sem powerup, então nenhum
 *   turbo cai imediatamente antes de um salto.
 * - Obstáculos do def vêm da seed e servem de documentação; o sistema
 *   \`Obstacles\` do jogo gera a própria lista a partir de \`Track\`.
 *
 * Medidas (npm run validate:track): comprimento ${track.length.toFixed(1)} m,
 * raio mínimo ${stats.minRadius.toFixed(1)} m, 4 zonas, 3 parciais, 2 rampas,
 * ${def.powerups.length} powerups.
 */
export const TRACK_01: TrackDef = {
`;

const footer = `};
`;

const outputPath = resolve('src/track/track01.ts');
writeFileSync(outputPath, `${header}${lines.join('\n')}\n${footer}`);

// Preview top-down para conferir que a pista é A→B (não fecha).
const previewSamples: { x: number; z: number; zone: string }[] = [];
for (let s = 0; s <= track.length; s += 2) {
  const sample = track.sampleAt(s);
  previewSamples.push({
    x: sample.position.x,
    z: sample.position.z,
    zone: sample.zone,
  });
}
const xs = previewSamples.map((sample) => sample.x);
const zs = previewSamples.map((sample) => sample.z);
const margin = 40;
const minX = Math.min(...xs) - margin;
const maxX = Math.max(...xs) + margin;
const minZ = Math.min(...zs) - margin;
const maxZ = Math.max(...zs) + margin;
const startPoint = previewSamples[0];
const finishPoint = previewSamples[previewSamples.length - 1];
const zoneColor: Record<string, string> = {
  forest: '#3f7a4b',
  desert: '#c9a25e',
};
const preview: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}" width="900" height="${Math.round((900 * (maxZ - minZ)) / (maxX - minX))}">`,
  '<rect x="-10000" y="-10000" width="30000" height="30000" fill="#171b19"/>',
];
for (const zone of def.zones) {
  const points = previewSamples
    .filter((_, index) => {
      const s = index * 2;
      return s >= zone.start && s <= zone.end;
    })
    .map((sample) => `${sample.x.toFixed(1)},${sample.z.toFixed(1)}`)
    .join(' ');
  preview.push(
    `<polyline points="${points}" fill="none" stroke="${zoneColor[zone.id]}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>`,
  );
}
preview.push(
  `<circle cx="${startPoint.x.toFixed(1)}" cy="${startPoint.z.toFixed(1)}" r="6" fill="#7dff8a"/>`,
  `<text x="${(startPoint.x + 8).toFixed(1)}" y="${(startPoint.z + 3).toFixed(1)}" fill="#7dff8a" font-family="monospace" font-size="10">START</text>`,
  `<circle cx="${finishPoint.x.toFixed(1)}" cy="${finishPoint.z.toFixed(1)}" r="6" fill="#ffffff"/>`,
  `<text x="${(finishPoint.x - 8).toFixed(1)}" y="${(finishPoint.z + 3).toFixed(1)}" fill="#ffffff" font-family="monospace" font-size="10" text-anchor="end">FINISH</text>`,
  `<text x="${minX + 6}" y="${minZ + 14}" fill="#e8e4d8" font-family="monospace" font-size="9">${def.id} — ${track.length.toFixed(1)} m — A→B: ${startToFinish.toFixed(0)} m em linha reta</text>`,
  '</svg>',
);
writeFileSync(resolve('/tmp/opencode/track01-v3.svg'), `${preview.join('\n')}\n`);

console.log(JSON.stringify(stats, null, 2));
