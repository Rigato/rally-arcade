/**
 * Gerador procedural v2: pista principal da v1 + bifurcações replanejadas.
 *
 * A v1 (`generateProceduralTrack`) continua sendo a fonte da espinha principal
 * (pontos, zonas, rampas, obstáculos, powerups, hazards, medalhas e o
 * `layoutByDef`). Esta camada só SUBSTITUI `def.forks` por ramos que são
 * mini-traçados de verdade: uma polyline de waypoints em coordenadas de mundo,
 * com curvas próprias e relevo, em vez do antigo deslocamento lateral em sino.
 *
 * Regras de segurança do ramo:
 * - começa e termina na borda da pista principal, alinhado à tangente dela;
 * - fica no mesmo setor, longe do hairpin extremo, das rampas e do outro fork;
 * - comprimento 3D de 180–420 m, largura ≥ 5,5 m;
 * - não encosta em outros trechos da pista principal nem em si mesmo.
 *
 * Se qualquer etapa falhar, a v1 é devolvida sem alterações. Determinismo é
 * garantido por um PRNG próprio derivado da seed.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp, lerp } from '../../core/math';
import type {
  TrackDef,
  TrackFork,
  TrackForkBranch,
  TrackPoint,
  TrackZone,
} from '../../game/types';
import { Track } from '../Track';
import {
  generateProceduralTrack,
  getProceduralLayout,
  validateProceduralTrack,
} from './ProceduralTrack';
import { createRng, type Rng } from './rng';

export const PROCEDURAL_V2_VERSION = 2;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------------- */
/* Limites de planejamento                                                    */
/* ------------------------------------------------------------------------- */

const MIN_FORK_SPAN = 170;
const MAX_FORK_SPAN = 340;
const MIN_FORK_START = 140;
const FORK_END_MARGIN = 130;
const MIN_FORK_GAP = 60;
const MAX_FORKS = 2;

const WINDOW_SAMPLE_STEP = 2;
const MIN_CHORD_RATIO = 0.55;
const MAX_END_WIDTH_DELTA = 2.4;

const BRANCH_MIN_LENGTH = 180;
const BRANCH_MAX_LENGTH = 420;
const BRANCH_MIN_WIDTH = 5.5;
const BRANCH_WIDTH_RANGE: [number, number] = [6.2, 8.0];
const BRANCH_EDGE_OVERLAP = 0.35;
const BRANCH_SAMPLE_STEP = 3;
const BRANCH_MIN_TANGENT_DOT = 0.75;
const BRANCH_EDGE_TOLERANCE = 2.2;
const BRANCH_MAIN_CLEARANCE = 2;
const BRANCH_FORK_WINDOW_MARGIN = 12;
const BRANCH_MIN_RADIUS = 8;
const BRANCH_SELF_SKIP = 10;
const BRANCH_SELF_CLEARANCE = 0.85;
const BRANCH_MAX_GRADE = 0.4;

const LEAD_IN_RANGE: [number, number] = [18, 30];
const LEAD_OUT_RANGE: [number, number] = [18, 30];

const APEX_AMPLITUDES: readonly [number, number][] = [
  [35, 70],
  [30, 60],
  [20, 40],
];
const APEX_HEIGHTS: readonly [number, number][] = [
  [0.4, 2.0],
  [1.2, 4.0],
  [0.3, 1.6],
];
const APEX_TWO_TIMES: readonly [number, number][] = [
  [0.28, 0.4],
  [0.6, 0.72],
];
const APEX_THREE_TIMES: readonly [number, number][] = [
  [0.25, 0.4],
  [0.5, 0.65],
  [0.72, 0.85],
];

/* ------------------------------------------------------------------------- */
/* API                                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Gera um `TrackDef` com a pista principal da v1 e bifurcações v2.
 *
 * A v1 é sempre executada primeiro. Se o replanejamento dos forks falhar por
 * qualquer motivo, o objeto da v1 volta intacto (rollback seguro).
 */
export function generateProceduralTrackV2(seed: number): TrackDef {
  const base = generateProceduralTrack(seed);
  const mutable = base as { forks?: readonly TrackFork[] };
  const oldForks = mutable.forks;

  try {
    // Algumas seeds não encontram geometria válida na primeira tentativa.
    // Tenta variações determinísticas do PRNG antes de cair para a v1.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rng = createRng(
        (seed ^ (0x9e3779b9 + attempt * 0x85ebca6b)) >>> 0,
      );
      const planned = planForks(base, rng);
      if (planned === null || planned.length === 0) {
        continue;
      }

      mutable.forks = planned;

      const validation = validateProceduralTrack(base, {
        quiet: true,
        profile: 'v5',
      });
      if (validation.ok) {
        return base;
      }

      mutable.forks = oldForks;
    }

    return base;
  } catch {
    mutable.forks = oldForks;
    return base;
  }
}

/* ------------------------------------------------------------------------- */
/* Planejamento                                                               */
/* ------------------------------------------------------------------------- */

interface MainSample {
  readonly s: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
}

interface Range {
  readonly startS: number;
  readonly endS: number;
}

interface ForkWindow extends Range {
  readonly score: number;
}

interface Waypoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function planForks(base: TrackDef, rng: Rng): readonly TrackFork[] | null {
  const layout = getProceduralLayout(base);
  if (!layout) {
    return null;
  }

  const main = buildQuietMain({ ...base, forks: [] });
  const length = main.length;
  if (length < MIN_FORK_START + MIN_FORK_SPAN + FORK_END_MARGIN) {
    return null;
  }

  // As curvas do layout estão na escala bruta do gerador; o `Track` mede a
  // spline final. Normaliza para comparar com `main.sampleAt`.
  const layoutScale =
    layout.rawLength > 1e-6 ? layout.trackLength / layout.rawLength : 1;
  const reserved: Range[] = [];

  for (const curve of layout.curves) {
    if (curve.category === 'hairpin' || curve.category === 'hairpin-extreme') {
      reserved.push({
        startS: curve.startS * layoutScale - 35,
        endS: curve.endS * layoutScale + 35,
      });
    }
  }
  for (const kicker of base.kickers) {
    reserved.push({
      startS: kicker.s - 18,
      endS: kicker.s + kicker.length + 48,
    });
  }
  // A v1 posicionou os hazards evitando os forks antigos. Como os novos ramos
  // podem cobrir outro trecho, reserva uma faixa em volta de cada hazard para
  // não invalidar `validateHazards` ("hazard dentro de uma bifurcação").
  for (const hazard of base.hazards ?? []) {
    reserved.push({
      startS: hazard.s - 30,
      endS: hazard.s + 30,
    });
  }

  const samples = sampleMain(main, WINDOW_SAMPLE_STEP);
  const strictWindows = collectWindows(
    base.zones,
    samples,
    WINDOW_SAMPLE_STEP,
    reserved,
    length,
    rng,
  );
  const relaxedWindows = collectWindows(
    base.zones,
    samples,
    WINDOW_SAMPLE_STEP,
    reserved,
    length,
    rng,
    true,
  );
  const windows = mergeWindows(strictWindows, relaxedWindows);
  if (windows.length === 0) {
    return null;
  }

  const wanted = rng.chance(0.55) ? MAX_FORKS : 1;
  const forks: TrackFork[] = [];

  for (let index = 0; index < windows.length && forks.length < wanted; index += 1) {
    const window = windows[index];
    if (
      forks.some(
        (fork) =>
          window.startS < fork.endS + MIN_FORK_GAP &&
          window.endS > fork.startS - MIN_FORK_GAP,
      )
    ) {
      continue;
    }

    const forkNumber = forks.length + 1;
    const preferredSide = rng.sign() as 1 | -1;
    const sides: readonly (1 | -1)[] = [
      preferredSide,
      preferredSide === 1 ? -1 : 1,
    ];

    for (const side of sides) {
      const branch = buildBranch(
        rng,
        main,
        window,
        side,
        `v2-fork-${forkNumber}-a`,
      );
      if (!branch) {
        continue;
      }

      forks.push({
        id: `v2-fork-${forkNumber}`,
        startS: window.startS,
        endS: window.endS,
        branches: [branch],
      });
      break;
    }
  }

  forks.sort((a, b) => a.startS - b.startS);
  return forks;
}

function buildQuietMain(def: TrackDef): Track {
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

function sampleMain(main: Track, step: number): readonly MainSample[] {
  const count = Math.max(1, Math.floor(main.length / step));
  const samples: MainSample[] = [];

  for (let index = 0; index <= count; index += 1) {
    const s = Math.min(main.length, index * step);
    const sample = main.sampleAt(s);
    samples.push({
      s,
      x: sample.position.x,
      z: sample.position.z,
      width: sample.width,
    });
  }

  return samples;
}

/**
 * Coleta janelas candidatas. O modo `relaxed` afrouxa a curvatura depois de
 * uma primeira passada estrita, mantendo o mesmo setor e as mesmas exclusões.
 */
function collectWindows(
  zones: readonly TrackZone[],
  samples: readonly MainSample[],
  step: number,
  reserved: readonly Range[],
  length: number,
  rng: Rng,
  relaxed = false,
): ForkWindow[] {
  const windows: ForkWindow[] = [];
  const maxStart = length - FORK_END_MARGIN - MIN_FORK_SPAN;
  const minRatio = relaxed ? 0.35 : MIN_CHORD_RATIO;
  const maxTurn = (relaxed ? 165 : 120) * DEG;

  const startIndexMin = Math.ceil(MIN_FORK_START / step);
  const startIndexMax = Math.floor(maxStart / step);
  const spanMinIndex = Math.ceil(MIN_FORK_SPAN / step);
  const spanMaxIndex = Math.floor(MAX_FORK_SPAN / step);

  for (let startIndex = startIndexMin; startIndex <= startIndexMax; startIndex += 1) {
    const startS = samples[startIndex].s;
    if (startS < MIN_FORK_START) {
      continue;
    }
    for (
      let spanIndex = spanMinIndex;
      spanIndex <= spanMaxIndex;
      spanIndex += 1
    ) {
      const endIndex = startIndex + spanIndex;
      if (endIndex >= samples.length) {
        break;
      }
      const endS = samples[endIndex].s;
      if (endS > length - FORK_END_MARGIN) {
        break;
      }

      if (zoneIndexAtS(zones, startS) !== zoneIndexAtS(zones, endS)) {
        continue;
      }
      if (overlapsAny(reserved, startS, endS)) {
        continue;
      }
      if (
        Math.abs(
          samples[startIndex].width - samples[endIndex].width,
        ) > MAX_END_WIDTH_DELTA
      ) {
        continue;
      }

      const metrics = windowMetrics(samples, startIndex, endIndex);
      if (metrics.ratio < minRatio || metrics.turn > maxTurn) {
        continue;
      }

      windows.push({
        startS,
        endS,
        score:
          (metrics.turn / Math.PI) * 0.8 +
          (1 - metrics.ratio) * 2 +
          Math.abs(endS - startS - 240) / 600,
      });
    }
  }

  // Embaralha antes de ordenar para variar entre seeds quando o score empata.
  shuffle(windows, rng);
  windows.sort((a, b) => a.score - b.score);

  // Cada par início/fim é único, mas a deduplicação defensiva mantém o
  // primeiro (melhor score) caso a grade mude no futuro.
  const unique: ForkWindow[] = [];
  const seen = new Set<string>();
  for (const window of windows) {
    const key = `${window.startS.toFixed(1)}:${window.endS.toFixed(1)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(window);
  }

  return unique;
}

function mergeWindows(
  primary: readonly ForkWindow[],
  secondary: readonly ForkWindow[],
): readonly ForkWindow[] {
  const seen = new Set(
    primary.map((window) => `${window.startS.toFixed(1)}:${window.endS.toFixed(1)}`),
  );
  const merged = [...primary];

  for (const window of secondary) {
    const key = `${window.startS.toFixed(1)}:${window.endS.toFixed(1)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(window);
  }

  return merged;
}

function windowMetrics(
  samples: readonly MainSample[],
  startIndex: number,
  endIndex: number,
): { ratio: number; turn: number } {
  let path = 0;
  let turn = 0;
  let previousHeading: number | null = null;

  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const a = samples[index - 1];
    const b = samples[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) {
      continue;
    }

    path += distance;
    const heading = Math.atan2(dx, dz);
    if (previousHeading !== null) {
      turn += Math.abs(shortestAngle(previousHeading, heading));
    }
    previousHeading = heading;
  }

  const chord = Math.hypot(
    samples[endIndex].x - samples[startIndex].x,
    samples[endIndex].z - samples[startIndex].z,
  );

  return {
    ratio: path > 1e-6 ? chord / path : 0,
    turn,
  };
}

function overlapsAny(
  ranges: readonly Range[],
  startS: number,
  endS: number,
): boolean {
  return ranges.some(
    (range) => endS > range.startS && startS < range.endS,
  );
}

function zoneIndexAtS(zones: readonly TrackZone[], s: number): number {
  for (let index = 0; index < zones.length; index += 1) {
    if (s >= zones[index].start && s < zones[index].end) {
      return index;
    }
  }
  return Math.max(0, zones.length - 1);
}

/* ------------------------------------------------------------------------- */
/* Construção do ramo                                                         */
/* ------------------------------------------------------------------------- */

interface Frame {
  readonly x: number;
  readonly z: number;
  readonly forwardX: number;
  readonly forwardZ: number;
  readonly rightX: number;
  readonly rightZ: number;
}

function buildBranch(
  rng: Rng,
  main: Track,
  window: ForkWindow,
  side: 1 | -1,
  branchId: string,
): TrackForkBranch | null {
  const { startS, endS } = window;
  const mainHalf =
    Math.max(main.widthAt(startS), main.widthAt(endS)) * 0.5;
  const branchWidth = rng.range(BRANCH_WIDTH_RANGE[0], BRANCH_WIDTH_RANGE[1]);
  const edgeOffset = mainHalf + branchWidth * 0.5 - BRANCH_EDGE_OVERLAP;

  const startFrame = frameAt(main, startS);
  const endFrame = frameAt(main, endS);
  if (!startFrame || !endFrame) {
    return null;
  }

  const leadIn = rng.range(LEAD_IN_RANGE[0], LEAD_IN_RANGE[1]);
  const leadOut = rng.range(LEAD_OUT_RANGE[0], LEAD_OUT_RANGE[1]);

  const p0: Waypoint = {
    x: startFrame.x + startFrame.rightX * side * edgeOffset,
    y: main.heightAt(startS, 0),
    z: startFrame.z + startFrame.rightZ * side * edgeOffset,
  };
  const p1: Waypoint = {
    x: p0.x + startFrame.forwardX * leadIn,
    y: main.heightAt(clamp(startS + leadIn, 0, main.length), 0),
    z: p0.z + startFrame.forwardZ * leadIn,
  };
  const pEnd: Waypoint = {
    x: endFrame.x + endFrame.rightX * side * edgeOffset,
    y: main.heightAt(endS, 0),
    z: endFrame.z + endFrame.rightZ * side * edgeOffset,
  };
  const pEnd1: Waypoint = {
    x: pEnd.x - endFrame.forwardX * leadOut,
    y: main.heightAt(clamp(endS - leadOut, 0, main.length), 0),
    z: pEnd.z - endFrame.forwardZ * leadOut,
  };

  const apexCount = rng.chance(0.65) ? 3 : 2;
  const apexTimes =
    apexCount === 3 ? APEX_THREE_TIMES : APEX_TWO_TIMES;
  const apexes: Waypoint[] = [];

  for (let index = 0; index < apexTimes.length; index += 1) {
    const t = rng.range(apexTimes[index][0], apexTimes[index][1]);
    const midS = lerp(startS, endS, t);
    const sample = main.sampleAt(midS);
    const midX = sample.position.x;
    const midZ = sample.position.z;
    const tangent = sample.tangent;
    const horizontal = Math.hypot(tangent.x, tangent.z) || 1;
    const forwardX = tangent.x / horizontal;
    const forwardZ = tangent.z / horizontal;
    const rightX = tangent.z / horizontal;
    const rightZ = -tangent.x / horizontal;

    const forwardOffset = rng.range(-12, 18);
    const amplitude = rng.range(
      APEX_AMPLITUDES[index][0],
      APEX_AMPLITUDES[index][1],
    );
    const lateral = edgeOffset + amplitude;
    const height = rng.range(
      APEX_HEIGHTS[index][0],
      APEX_HEIGHTS[index][1],
    );

    apexes.push({
      x:
        midX +
        forwardX * forwardOffset +
        rightX * side * lateral,
      y: main.heightAt(midS, 0) + height,
      z:
        midZ +
        forwardZ * forwardOffset +
        rightZ * side * lateral,
    });
  }

  const controls: Waypoint[] = [p0, p1, ...apexes, pEnd1, pEnd];
  const curve = new CatmullRomCurve3(
    controls.map((point) => new Vector3(point.x, point.y, point.z)),
    false,
    'centripetal',
  );
  const curveLength = curve.getLength();
  if (!(curveLength > 0)) {
    return null;
  }

  const pointCount = Math.max(12, Math.ceil(curveLength / BRANCH_SAMPLE_STEP));
  const widthPhase = rng.range(0, TAU);
  const points: TrackPoint[] = [];

  for (let index = 0; index <= pointCount; index += 1) {
    const u = index / pointCount;
    const position = curve.getPointAt(u);
    const width = Math.max(
      BRANCH_MIN_WIDTH,
      branchWidth * (0.97 + 0.05 * Math.sin(TAU * u + widthPhase)),
    );
    points.push({
      x: position.x,
      y: position.y,
      z: position.z,
      width,
    });
  }

  const length = measurePoints3d(points);
  if (length < BRANCH_MIN_LENGTH || length > BRANCH_MAX_LENGTH) {
    return null;
  }

  if (
    !validateBranch(
      main,
      window,
      side,
      branchWidth,
      points,
      startFrame,
      endFrame,
    )
  ) {
    return null;
  }

  return {
    id: branchId,
    points,
    startS,
    endS,
    length,
    width: branchWidth,
    side,
  };
}

function frameAt(main: Track, s: number): Frame | null {
  const sample = main.sampleAt(s);
  const tangent = sample.tangent;
  const horizontal = Math.hypot(tangent.x, tangent.z);
  if (horizontal < 1e-6) {
    return null;
  }
  const forwardX = tangent.x / horizontal;
  const forwardZ = tangent.z / horizontal;

  return {
    x: sample.position.x,
    z: sample.position.z,
    forwardX,
    forwardZ,
    rightX: forwardZ,
    rightZ: -forwardX,
  };
}

/* ------------------------------------------------------------------------- */
/* Validação local do ramo                                                    */
/* ------------------------------------------------------------------------- */

function validateBranch(
  main: Track,
  window: ForkWindow,
  side: 1 | -1,
  branchWidth: number,
  points: readonly TrackPoint[],
  startFrame: Frame,
  endFrame: Frame,
): boolean {
  if (points.length < 8) {
    return false;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const mainHalf =
    Math.max(main.widthAt(window.startS), main.widthAt(window.endS)) * 0.5;
  const expectedOffset = mainHalf + branchWidth * 0.5;
  const startDistance = Math.hypot(
    first.x - startFrame.x,
    first.z - startFrame.z,
  );
  const endDistance = Math.hypot(last.x - endFrame.x, last.z - endFrame.z);

  if (
    Math.abs(startDistance - expectedOffset) > BRANCH_EDGE_TOLERANCE ||
    Math.abs(endDistance - expectedOffset) > BRANCH_EDGE_TOLERANCE
  ) {
    return false;
  }

  const startU =
    (first.x - startFrame.x) * startFrame.rightX +
    (first.z - startFrame.z) * startFrame.rightZ;
  const endU =
    (last.x - endFrame.x) * endFrame.rightX +
    (last.z - endFrame.z) * endFrame.rightZ;
  if (Math.sign(startU) !== side || Math.sign(endU) !== side) {
    return false;
  }

  for (const point of points) {
    if (point.width < BRANCH_MIN_WIDTH - 1e-6) {
      return false;
    }
  }

  if (!tangentsAligned(points, startFrame, endFrame)) {
    return false;
  }

  if (selfIntersects(points, branchWidth)) {
    return false;
  }

  if (minimumRadius(points) < BRANCH_MIN_RADIUS) {
    return false;
  }

  if (maxGrade(points) > BRANCH_MAX_GRADE) {
    return false;
  }

  // Fora da janela do próprio fork, o ramo precisa ficar longe de qualquer
  // outro trecho da pista principal (não só do centro, também das bordas).
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const projection = main.project(point.x, point.z);
    if (
      projection.s > window.startS - BRANCH_FORK_WINDOW_MARGIN &&
      projection.s < window.endS + BRANCH_FORK_WINDOW_MARGIN
    ) {
      continue;
    }

    const clearance =
      main.widthAt(projection.s) * 0.5 +
      branchWidth * 0.5 +
      BRANCH_MAIN_CLEARANCE;
    if (projection.distance < clearance) {
      return false;
    }
  }

  return true;
}

function tangentsAligned(
  points: readonly TrackPoint[],
  startFrame: Frame,
  endFrame: Frame,
): boolean {
  const first = points[0];
  const second = points[1];
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];

  const startDx = second.x - first.x;
  const startDz = second.z - first.z;
  const endDx = last.x - penultimate.x;
  const endDz = last.z - penultimate.z;
  const startLength = Math.hypot(startDx, startDz);
  const endLength = Math.hypot(endDx, endDz);
  if (startLength < 1e-6 || endLength < 1e-6) {
    return false;
  }

  const startDot =
    (startDx / startLength) * startFrame.forwardX +
    (startDz / startLength) * startFrame.forwardZ;
  const endDot =
    (endDx / endLength) * endFrame.forwardX +
    (endDz / endLength) * endFrame.forwardZ;

  return (
    startDot > BRANCH_MIN_TANGENT_DOT &&
    endDot > BRANCH_MIN_TANGENT_DOT
  );
}

function selfIntersects(
  points: readonly TrackPoint[],
  branchWidth: number,
): boolean {
  const minimum = branchWidth * BRANCH_SELF_CLEARANCE;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    for (let j = i + BRANCH_SELF_SKIP; j < points.length; j += 1) {
      const b = points[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < minimum) {
        return true;
      }
    }
  }

  return false;
}

function maxGrade(points: readonly TrackPoint[]): number {
  let maximum = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 1e-6) {
      continue;
    }
    maximum = Math.max(maximum, Math.abs(b.y - a.y) / run);
  }

  return maximum;
}

function minimumRadius(points: readonly TrackPoint[]): number {
  let minimum = Infinity;

  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) {
      continue;
    }

    const area =
      Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) /
      2;
    if (area < 1e-9) {
      continue;
    }

    minimum = Math.min(minimum, (ab * bc * ca) / (4 * area));
  }

  return minimum;
}

/* ------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* ------------------------------------------------------------------------- */

function measurePoints3d(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from + Math.PI) % TAU;
  if (delta < 0) {
    delta += TAU;
  }
  return delta - Math.PI;
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = rng.int(0, index);
    [items[index], items[other]] = [items[other], items[index]];
  }
}
