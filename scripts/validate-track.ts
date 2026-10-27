/**
 * Validação da pista fixa v2, sem navegador.
 *
 * Roda com `npm run validate:track` (rolldown empacota o TS e o Node executa).
 * Sai com código 1 se qualquer regra do layout falhar.
 */
import { Track } from '../src/track/Track';
import { Obstacles } from '../src/track/Obstacles';

const failures: string[] = [];
const notes: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

function format(value: number, digits = 1): string {
  return value.toFixed(digits);
}

const track = new Track();
const length = track.length;
const zones = track.def.zones;

notes.push(`comprimento: ${format(length)} m`);
check(length >= 950 && length <= 1100, `comprimento fora de 950–1100 m: ${format(length)} m`);

check(zones.length === 4, `esperadas 4 zonas, encontradas ${zones.length}`);
for (let i = 0; i < zones.length; i += 1) {
  const zone = zones[i];
  const expected = i % 2 === 0 ? 'forest' : 'desert';
  check(zone.id === expected, `zona ${i + 1} deveria ser ${expected}, é ${zone.id}`);
  if (i > 0) {
    check(
      Math.abs(zone.start - 250 * i) <= 1,
      `limite da zona ${i + 1} fora de ${250 * i} m: ${zone.start}`,
    );
  }
}

// Largura em toda a pista (a física usa widthAt com interpolação suave).
let minWidth = Infinity;
let maxWidth = -Infinity;
for (let s = 0; s <= length; s += 2) {
  const width = track.widthAt(s);
  minWidth = Math.min(minWidth, width);
  maxWidth = Math.max(maxWidth, width);
}
notes.push(`largura: ${format(minWidth)}–${format(maxWidth)} m`);
check(minWidth >= 8 - 1e-6, `largura mínima abaixo de 8 m: ${format(minWidth)} m`);
check(maxWidth <= 14 + 1e-6, `largura máxima acima de 14 m: ${format(maxWidth)} m`);

// Amostragem uniforme em s (~1 m) para raio, rampas e autointerseção.
const sampleStep = 1;
const sampleCount = Math.round(length / sampleStep);
const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
  const s = (index / sampleCount) * length;
  const sample = track.sampleAt(s);
  return {
    s,
    x: sample.position.x,
    y: sample.position.y,
    z: sample.position.z,
    heading: Math.atan2(sample.tangent.x, sample.tangent.z),
  };
});

function radiusAt(index: number): number {
  const from = Math.max(0, index - 5);
  const to = Math.min(samples.length - 1, index + 5);
  const a = samples[from];
  const b = samples[index];
  const c = samples[to];
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  return area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
}

let minRadius = Infinity;
let minRadiusS = 0;
for (let i = 5; i < samples.length - 5; i += 1) {
  const radius = radiusAt(i);
  if (radius < minRadius) {
    minRadius = radius;
    minRadiusS = samples[i].s;
  }
}
notes.push(`raio mínimo: ${format(minRadius)} m em s=${format(minRadiusS, 0)} m`);
check(minRadius >= 25, `raio mínimo abaixo de 25 m: ${format(minRadius)} m`);
check(minRadius >= 30, `raio mínimo abaixo da meta de 30 m: ${format(minRadius)} m`);

// Autointerseção (mesma janela de 40 m do Track).
function segmentsIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(denominator) < 1e-9) {
    return false;
  }
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

let intersects = false;
for (let i = 0; i < samples.length - 1 && !intersects; i += 4) {
  const a = samples[i];
  const b = samples[Math.min(samples.length - 1, i + 4)];
  for (let j = i + 4; j < samples.length - 1; j += 4) {
    if (Math.abs(a.s - samples[j].s) < 40) {
      continue;
    }
    const c = samples[j];
    const d = samples[Math.min(samples.length - 1, j + 4)];
    if (segmentsIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) {
      intersects = true;
      break;
    }
  }
}
check(!intersects, 'a pista se autointersecta');

// Rampas: altura/comprimento seguros e 40 m de pouso reto.
const kickers = track.def.kickers;
check(kickers.length === 2, `esperadas 2 rampas, encontradas ${kickers.length}`);
for (const kicker of kickers) {
  check(
    kicker.height >= 1.0 && kicker.height <= 1.5,
    `rampa em s=${kicker.s} com altura fora de 1,0–1,5 m: ${kicker.height}`,
  );
  check(
    kicker.length >= 6 && kicker.length <= 7,
    `rampa em s=${kicker.s} com comprimento fora de 6–7 m: ${kicker.length}`,
  );

  const entry = track.sampleAt(kicker.s);
  const entryHeading = Math.atan2(entry.tangent.x, entry.tangent.z);
  let deviation = 0;
  for (let s = kicker.s + kicker.length; s <= kicker.s + kicker.length + 40; s += 1) {
    const sample = track.sampleAt(s);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    let delta = heading - entryHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    deviation = Math.max(deviation, Math.abs(delta));
  }
  notes.push(
    `rampa s=${kicker.s}: ${format(kicker.height)} m × ${format(kicker.length)} m, ` +
      `desvio de rumo no pouso ${format((deviation * 180) / Math.PI)}°`,
  );
  check(
    deviation < (12 * Math.PI) / 180,
    `pouso da rampa em s=${kicker.s} com curva (>${12}° em 40 m)`,
  );
}

// Parciais em ordem.
const splits = track.def.splits;
notes.push(`parciais: ${splits.map((split) => `${split.name}@${format(split.s, 0)}`).join(', ')}`);
check(splits.length === 3, `esperadas 3 parciais, encontradas ${splits.length}`);
for (let i = 0; i < splits.length; i += 1) {
  check(splits[i].s > 0 && splits[i].s < length, `parcial ${i + 1} fora da pista`);
  check(splits[i].name.length > 0, `parcial ${i + 1} sem nome`);
  if (i > 0) {
    check(splits[i].s > splits[i - 1].s, `parcial ${i + 1} fora de ordem`);
  }
}

// Powerups: 4+, dentro da pista e longe de rampas/curvas fortes.
const powerups = track.def.powerups;
notes.push(`powerups: ${powerups.length}`);
check(powerups.length >= 4, `esperados 4+ powerups, encontrados ${powerups.length}`);
for (const powerup of powerups) {
  const half = track.widthAt(powerup.s) * 0.5;
  check(
    Math.abs(powerup.u) <= half - 0.4,
    `powerup ${powerup.type} em s=${powerup.s} fora da pista (u=${powerup.u})`,
  );
  for (const kicker of kickers) {
    check(
      powerup.s < kicker.s - 1 || powerup.s > kicker.s + kicker.length + 1,
      `powerup ${powerup.type} em s=${powerup.s} dentro da rampa de s=${kicker.s}`,
    );
  }
  const index = Math.round((powerup.s / length) * sampleCount);
  const radius = radiusAt(Math.max(5, Math.min(samples.length - 6, index)));
  check(
    radius >= 80,
    `powerup ${powerup.type} em s=${powerup.s} dentro de curva forte (R=${format(radius)} m)`,
  );
}

// Obstáculos: contagem, fora da pista, 5–10 m da borda, validação interna limpa.
const obstacles = new Obstacles(track);
const obstacleList = obstacles.getObstacles();
notes.push(`obstáculos: ${obstacleList.length}`);
check(
  obstacleList.length >= 40 && obstacleList.length <= 50,
  `obstáculos fora de 40–50: ${obstacleList.length}`,
);
const issues = obstacles.validate();
check(issues.length === 0, `Obstacles.validate(): ${issues.join(' | ')}`);

for (const obstacle of obstacleList) {
  const half = track.widthAt(obstacle.s) * 0.5;
  const edgeDistance = Math.abs(obstacle.u) - half;
  check(edgeDistance >= 5 - 1e-6, `obstáculo #${obstacle.index} a menos de 5 m da borda`);
  check(edgeDistance <= 10 + 1e-6, `obstáculo #${obstacle.index} a mais de 10 m da borda`);
  check(Math.abs(obstacle.u) > half, `obstáculo #${obstacle.index} dentro da pista`);
}

// Inclinações: reporta a maior rampa de 10 m (cristas curtas) e a máxima 1 m.
let maxGrade10 = 0;
let maxGrade10S = 0;
let maxGrade1 = 0;
let maxGrade1S = 0;
for (let i = 0; i + 10 < samples.length; i += 5) {
  const grade = Math.abs(samples[i + 10].y - samples[i].y) / 10;
  if (grade > maxGrade10) {
    maxGrade10 = grade;
    maxGrade10S = samples[i].s;
  }
}
for (let i = 1; i < samples.length; i += 1) {
  const grade = Math.abs(samples[i].y - samples[i - 1].y) / sampleStep;
  if (grade > maxGrade1) {
    maxGrade1 = grade;
    maxGrade1S = samples[i].s;
  }
}
notes.push(
  `inclinação máxima em 10 m: ${format(maxGrade10 * 100)}% em s=${format(maxGrade10S, 0)} m`,
);
notes.push(
  `inclinação máxima em 1 m: ${format(maxGrade1 * 100)}% em s=${format(maxGrade1S, 0)} m`,
);
check(maxGrade10 >= 0.035, 'pista sem inclinação longa relevante (>= 3,5% em 10 m)');
check(maxGrade1 <= 0.13, `inclinação local acima de 13%: ${format(maxGrade1 * 100)}%`);

console.log('[validate-track] métricas');
for (const note of notes) {
  console.log(`  - ${note}`);
}

if (failures.length > 0) {
  console.error(`\n[validate-track] ${failures.length} falha(s):`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('\n[validate-track] OK — layout dentro de todas as regras.');
}
