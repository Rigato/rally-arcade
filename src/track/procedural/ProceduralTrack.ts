/**
 * Gerador procedural de pistas do Rally Arcade.
 *
 * O gerador atual (`generateProceduralTrack`) usa uma gramática de segmentos:
 * retas curtas/médias/longas alternadas com curvas de seis categorias
 * (longa, média, curta, cotovelo, hairpin e kink), em ambos os sentidos. O
 * traçado é um caminho aberto A→B, sem pernas paralelas fixas. Cada candidato
 * passa por um teste de separação entre trechos não vizinhos (spatial hash,
 * ≥40 m entre centros), caixa de ~650×650 m e chegada a ≥100 m da largada.
 *
 * A largura é montada por eventos ao longo da pista (base, longos estreitos,
 * largos e choke points) e a elevação ganha faixas planas. A validação tem
 * dois perfis: `v5` para o gerador novo e `legacy` para a pista fixa.
 *
 * O gerador antigo da "serpente" de quatro pernas continua exportado como
 * `generateLegacyProceduralTrack` porque a pista fixa `track01-v3` foi
 * congelada da seed 91 dele. NÃO use o legado para pistas aleatórias.
 *
 * Tudo é determinístico por seed (mulberry32). O resultado é um `TrackDef`
 * comum: nenhuma alteração em `Track`, `Game` ou nos tipos compartilhados.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import type {
  MedalTargets,
  PowerupType,
  TrackDef,
  TrackKicker,
  TrackObstacle,
  TrackPoint,
  TrackPowerup,
  TrackSplit,
  TrackZone,
} from '../../game/types';
import { Track } from '../Track';
import type { TrackZoneId } from '../Track';
import { createRng, type Rng } from './rng';

const TAU = Math.PI * 2;
const DENSE_STEP = 1;
const CONTROL_SPACING = 3;
const KICKER_LANDING = 40;
const KICKER_PLACEMENT_LANDING = 41;
const KICKER_MAX_DEVIATION = 0.2;
const OBSTACLE_EDGE_CLEARANCE = 5;
const OBSTACLE_PLACEMENT_CLEARANCE = 5.2;
const POWERUP_MIN_CLEARANCE = 1;
const SELF_INTERSECTION_WINDOW = 30;
const MAX_GRADE_PASS = 0.35;
const MAX_GRADE_BUILD = 0.3;

/** Separação mínima (centro a centro) entre trechos não vizinhos do caminho. */
const SECTION_CLEARANCE = 40;
/** Trechos com menos que isto de distância ao longo da pista são "vizinhos". */
const SECTION_ALONG_WINDOW = 85;
/** Caixa máxima do traçado novo (m). */
const MAX_LAYOUT_SIZE = 650;
/** Distância mínima em linha reta entre largada e chegada (A→B de verdade). */
const MIN_START_TO_FINISH = 100;

/**
 * Limites do gerador novo (v5). O perfil legado fica separado para que a
 * pista fixa `track01-v3` continue reproduzível byte a byte.
 */
const MIN_LENGTH = 1300;
const MAX_LENGTH = 1800;
const MIN_ZONE_LENGTH = 300;
const MAX_ZONE_LENGTH = 500;
const MIN_TRACK_WIDTH = 4.4;
const MAX_TRACK_WIDTH = 15.2;
const MIN_RADIUS_PASS = 16;
const MIN_RADIUS_WARN = 19;
const MIN_POWERUPS = 6;
const MAX_POWERUPS = 8;
const MIN_OBSTACLES = 50;
const MAX_OBSTACLES = 75;

/** Perfil de validação legado — congelado junto com `track01-v3`. */
const LEGACY_MIN_LENGTH = 800;
const LEGACY_MAX_LENGTH = 1200;
const LEGACY_MIN_ZONE_LENGTH = 190;
const LEGACY_MAX_ZONE_LENGTH = 310;
const LEGACY_MIN_TRACK_WIDTH = 8;
const LEGACY_MAX_TRACK_WIDTH = 14;
const LEGACY_MIN_RADIUS_PASS = 22;
const LEGACY_MIN_RADIUS_WARN = 25;
const LEGACY_MIN_POWERUPS = 4;
const LEGACY_MAX_POWERUPS = 6;
const LEGACY_MIN_OBSTACLES = 30;
const LEGACY_MAX_OBSTACLES = 60;
const LEGACY_SECTION_CLEARANCE = 36;

export type ValidationProfile = 'v5' | 'legacy';

export type CurveCategory =
  | 'long'
  | 'medium'
  | 'short'
  | 'elbow'
  | 'hairpin'
  | 'kink';

export type CurveDirection = 'left' | 'right';

export interface ProceduralCurveInfo {
  readonly category: CurveCategory;
  readonly radius: number;
  /** Sweep em graus (positivo). */
  readonly sweepDeg: number;
  readonly direction: CurveDirection;
  readonly startS: number;
  readonly endS: number;
}

export interface ProceduralStraightInfo {
  readonly startS: number;
  readonly endS: number;
}

export interface ProceduralWidthFeature {
  readonly kind: 'choke' | 'narrow' | 'wide';
  readonly startS: number;
  readonly endS: number;
  readonly width: number;
}

export interface ProceduralLayout {
  readonly curves: readonly ProceduralCurveInfo[];
  readonly straights: readonly ProceduralStraightInfo[];
  readonly width: number;
  readonly height: number;
  readonly rawLength: number;
  readonly trackLength: number;
  /** Perfil de largura autorado (antes do clamp do `Track`). */
  readonly widthAt?: (s: number) => number;
  readonly widthFeatures?: readonly ProceduralWidthFeature[];
  /** Fração da pista coberta por faixas planas. */
  readonly flatFraction?: number;
  readonly flatBands?: readonly { readonly startS: number; readonly endS: number }[];
}

export interface ProceduralFeatures {
  readonly categories: Record<CurveCategory, number>;
  readonly leftSweepDeg: number;
  readonly rightSweepDeg: number;
  readonly chokes: number;
  readonly longNarrow: number;
  readonly wide: number;
}

export interface ProceduralStats {
  readonly length: number;
  readonly points: number;
  readonly zones: number;
  readonly minRadius: number;
  readonly minRadiusS: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly maxGrade: number;
  readonly obstacles: number;
  readonly powerups: number;
  readonly kickers: number;
  readonly splits: number;
  readonly startToFinish: number;
  readonly bboxWidth: number;
  readonly bboxHeight: number;
  readonly minSectionDistance: number;
  /** Cobertura das faixas planas (0..1). */
  readonly flatFraction: number;
  readonly features: ProceduralFeatures | null;
}

interface Bump {
  readonly center: number;
  readonly half: number;
  readonly amp: number;
}

interface RawPoint {
  x: number;
  z: number;
  y: number;
  /** Comprimento acumulado em 3D (m). */
  s: number;
}

interface RawRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

interface LegRange extends RawRange {
  readonly midStartIndex: number;
  readonly midEndIndex: number;
}

interface HairpinRange extends RawRange {
  readonly radius: number;
}

interface LegInfo {
  readonly startS: number;
  readonly midStartS: number;
  readonly midEndS: number;
  readonly endS: number;
}

interface HairpinInfo {
  readonly startS: number;
  readonly endS: number;
  readonly radius: number;
}

interface ObstacleCandidate {
  readonly s: number;
  readonly u: number;
  readonly radius: number;
  readonly type: TrackObstacle['type'];
  readonly x: number;
  readonly z: number;
}

export interface ProceduralValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly stats: ProceduralStats;
}

export interface ValidateOptions {
  /** Silencia os logs do construtor de `Track` (útil no gerador e nos testes). */
  readonly quiet?: boolean;
  /** Perfil de limites: `v5` (padrão) ou `legacy` (pista fixa). */
  readonly profile?: ValidationProfile;
}

interface ProfileLimits {
  readonly minLength: number;
  readonly maxLength: number;
  readonly minZoneLength: number;
  readonly maxZoneLength: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minRadiusPass: number;
  readonly minRadiusWarn: number;
  readonly minPowerups: number;
  readonly maxPowerups: number;
  readonly minObstacles: number;
  readonly maxObstacles: number;
  readonly sectionClearance: number;
}

const V5_LIMITS: ProfileLimits = {
  minLength: MIN_LENGTH,
  maxLength: MAX_LENGTH,
  minZoneLength: MIN_ZONE_LENGTH,
  maxZoneLength: MAX_ZONE_LENGTH,
  minWidth: MIN_TRACK_WIDTH,
  maxWidth: MAX_TRACK_WIDTH,
  minRadiusPass: MIN_RADIUS_PASS,
  minRadiusWarn: MIN_RADIUS_WARN,
  minPowerups: MIN_POWERUPS,
  maxPowerups: MAX_POWERUPS,
  minObstacles: MIN_OBSTACLES,
  maxObstacles: MAX_OBSTACLES,
  sectionClearance: SECTION_CLEARANCE,
};

const LEGACY_LIMITS: ProfileLimits = {
  minLength: LEGACY_MIN_LENGTH,
  maxLength: LEGACY_MAX_LENGTH,
  minZoneLength: LEGACY_MIN_ZONE_LENGTH,
  maxZoneLength: LEGACY_MAX_ZONE_LENGTH,
  minWidth: LEGACY_MIN_TRACK_WIDTH,
  maxWidth: LEGACY_MAX_TRACK_WIDTH,
  minRadiusPass: LEGACY_MIN_RADIUS_PASS,
  minRadiusWarn: LEGACY_MIN_RADIUS_WARN,
  minPowerups: LEGACY_MIN_POWERUPS,
  maxPowerups: LEGACY_MAX_POWERUPS,
  minObstacles: LEGACY_MIN_OBSTACLES,
  maxObstacles: LEGACY_MAX_OBSTACLES,
  sectionClearance: LEGACY_SECTION_CLEARANCE,
};

function limitsFor(profile: ValidationProfile): ProfileLimits {
  return profile === 'legacy' ? LEGACY_LIMITS : V5_LIMITS;
}

/**
 * Gera a pista procedural usada pelas seeds aleatórias do jogo.
 *
 * A gramática de segmentos é sorteada com o PRNG da seed. Candidatos que
 * falham nas checagens geométricas baratas (caixa, A→B, separação) são
 * descartados antes de construir um `Track`; só então a validação completa
 * roda. Cada tentativa continua a mesma sequência do PRNG, então a saída é
 * determinística.
 */
export function generateProceduralTrack(seed: number): TrackDef {
  const rng = createRng(seed >>> 0);
  let lastValidation: ProceduralValidation | null = null;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const def = buildSegmentCandidate(rng, seed);
    if (!def) {
      continue;
    }
    lastValidation = validateProceduralTrack(def, {
      quiet: true,
      profile: 'v5',
    });
    if (lastValidation.ok) {
      return def;
    }
  }

  const details = lastValidation?.errors.slice(0, 4).join(' | ') ?? 'sem detalhes';
  throw new Error(
    `Não foi possível gerar uma pista válida para a seed ${seed}: ${details}`,
  );
}

/** Metadados do layout do último `TrackDef` gerado (para relatórios/testes). */
const layoutByDef = new WeakMap<TrackDef, ProceduralLayout>();

export function getProceduralLayout(def: TrackDef): ProceduralLayout | null {
  return layoutByDef.get(def) ?? null;
}

/**
 * Gerador antigo (serpente de 4 pernas + 3 hairpins).
 *
 * Mantido apenas para reproduzir a pista fixa `track01-v3`, congelada da seed
 * 91. NÃO é mais usado pelas pistas aleatórias do jogo; use
 * `generateProceduralTrack`.
 */
export function generateLegacyProceduralTrack(seed: number): TrackDef {
  const rng = createRng(seed >>> 0);
  let lastValidation: ProceduralValidation | null = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const def = buildCandidate(rng, seed);
    lastValidation = validateProceduralTrack(def, {
      quiet: true,
      profile: 'legacy',
    });
    if (lastValidation.ok) {
      return def;
    }
  }

  const details = lastValidation?.errors.slice(0, 4).join(' | ') ?? 'sem detalhes';
  throw new Error(
    `Não foi possível gerar uma pista legada válida para a seed ${seed}: ${details}`,
  );
}

/* ------------------------------------------------------------------------- */
/* Gramática de segmentos do gerador novo                                    */
/* ------------------------------------------------------------------------- */

interface CurveSpec {
  readonly kind: 'curve';
  readonly category: CurveCategory;
  readonly radius: number;
  readonly sweep: number;
  readonly turn: 1 | -1;
}

interface StraightSpec {
  readonly kind: 'straight';
  readonly length: number;
}

type SegmentSpec = CurveSpec | StraightSpec;

interface PathState {
  x: number;
  z: number;
  heading: number;
}

interface BuiltSegment {
  readonly kind: 'curve' | 'straight';
  readonly startS: number;
  readonly endS: number;
  readonly category?: CurveCategory;
  readonly radius?: number;
  readonly sweep?: number;
  readonly turn?: 1 | -1;
}

const DEG = Math.PI / 180;

const CURVE_CATEGORIES: readonly CurveCategory[] = [
  'long',
  'medium',
  'short',
  'elbow',
  'hairpin',
  'kink',
];

const CURVE_RANGES: Record<
  CurveCategory,
  { radius: [number, number]; sweep: [number, number] }
> = {
  long: { radius: [70, 110], sweep: [25 * DEG, 70 * DEG] },
  medium: { radius: [45, 65], sweep: [35 * DEG, 90 * DEG] },
  short: { radius: [28, 38], sweep: [45 * DEG, 110 * DEG] },
  elbow: { radius: [26, 31], sweep: [75 * DEG, 120 * DEG] },
  hairpin: { radius: [20, 23], sweep: [160 * DEG, 180 * DEG] },
  kink: { radius: [140, 220], sweep: [6 * DEG, 15 * DEG] },
};

function buildSegmentCandidate(rng: Rng, seed: number): TrackDef | null {
  const plan = planSegments(rng);
  if (!plan) {
    return null;
  }

  const raw: RawPoint[] = [{ x: 0, z: 0, y: 0, s: 0 }];
  const built: BuiltSegment[] = [];
  const state: PathState = {
    x: 0,
    z: 0,
    heading: rng.range(0, TAU),
  };
  let s = 0;

  for (const segment of plan) {
    const startS = s;

    if (segment.kind === 'straight') {
      s = appendStraightDense(raw, state, segment.length, s);
      built.push({ kind: 'straight', startS, endS: s });
    } else {
      const before = raw.length;
      s = appendArcDense(raw, state, segment, s);
      built.push({
        kind: 'curve',
        startS,
        endS: s,
        category: segment.category,
        radius: segment.radius,
        sweep: segment.sweep,
        turn: segment.turn,
      });
      if (raw.length <= before) {
        return null;
      }
    }
  }

  if (raw.length < 24) {
    return null;
  }

  // Centraliza a caixa na origem; a orientação já varia com o heading inicial.
  const bounds = planarBounds(raw);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  if (width > MAX_LAYOUT_SIZE || height > MAX_LAYOUT_SIZE) {
    return null;
  }
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  for (const point of raw) {
    point.x -= centerX;
    point.z -= centerZ;
  }

  const start = raw[0];
  const finish = raw[raw.length - 1];
  if (Math.hypot(finish.x - start.x, finish.z - start.z) < MIN_START_TO_FINISH) {
    return null;
  }

  // Rejeita trechos que passam perto demais de outros trechos não vizinhos.
  const clearance = minSectionDistance(raw);
  if (clearance < SECTION_CLEARANCE) {
    return null;
  }

  const planarLength = raw[raw.length - 1].s;
  const elevation = buildElevationV5(rng, planarLength);
  const baseY = elevation.value(0);
  let maxSlope = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const point = raw[i];
    point.y = elevation.value(point.s) - baseY;
    if (i > 0) {
      const previous = raw[i - 1];
      const run = Math.max(0.001, point.s - previous.s);
      maxSlope = Math.max(maxSlope, Math.abs(point.y - previous.y) / run);
    }
  }

  if (maxSlope > MAX_GRADE_BUILD) {
    const scale = MAX_GRADE_BUILD / maxSlope;
    for (const point of raw) {
      point.y *= scale;
    }
  }

  recalculate3dS(raw);
  const total = raw[raw.length - 1].s;

  const curves = built
    .filter((segment) => segment.kind === 'curve')
    .map<ProceduralCurveInfo>((segment) => ({
      category: segment.category ?? 'long',
      radius: segment.radius ?? 0,
      sweepDeg: ((segment.sweep ?? 0) * 180) / Math.PI,
      direction: (segment.turn ?? 1) > 0 ? 'right' : 'left',
      startS: segment.startS,
      endS: segment.endS,
    }));
  const straights = built
    .filter((segment) => segment.kind === 'straight')
    .map<ProceduralStraightInfo>((segment) => ({
      startS: segment.startS,
      endS: segment.endS,
    }));

  const widthProfile = buildWidthProfileV5(rng, curves, total);
  const widthAt = widthProfile.widthAt;
  const controlPoints = resampleControlPoints(raw, CONTROL_SPACING).map(
    (point) => ({
      x: point.x,
      z: point.z,
      y: point.y,
      width: widthAt(point.s),
    }),
  );

  const length = measureLength(controlPoints);
  if (length < MIN_LENGTH || length > MAX_LENGTH) {
    return null;
  }
  const scale = length / total;

  const kickers = placeKickersOnStraights(rng, straights, length, scale);
  if (kickers.length === 0) {
    return null;
  }
  const splitsAndZones = buildZonesAndSplitsV5(rng, length);
  const powerups = placePowerupsOnTrack(
    rng,
    raw,
    widthAt,
    kickers,
    length,
    scale,
  );
  const obstacles = placeObstaclesOffTrack(rng, raw, widthAt, length, scale);
  if (obstacles.length < MIN_OBSTACLES) {
    return null;
  }

  const def: TrackDef = {
    id: `proc-${seed}`,
    points: controlPoints,
    zones: splitsAndZones.zones,
    kickers,
    obstacles,
    powerups,
    splits: splitsAndZones.splits,
    medals: buildMedals(length),
  };

  layoutByDef.set(def, {
    curves,
    straights,
    width,
    height,
    rawLength: total,
    trackLength: length,
    widthAt,
    widthFeatures: widthProfile.features,
    flatFraction: elevation.flatFraction,
    flatBands: elevation.bands,
  });

  return def;
}

function planSegments(rng: Rng): readonly SegmentSpec[] | null {
  const target = rng.range(1490, 1600);
  const segments: SegmentSpec[] = [];
  const featureStraight = rng.int(2, 7);
  const planHairpins = rng.int(1, 2);
  const planKinks = rng.int(1, 3);
  const categoryCounts = new Map<CurveCategory, number>();
  const directionCounts: Record<'left' | 'right', number> = {
    left: 0,
    right: 0,
  };
  let turnBalance = 0;
  let totalTurn = 0;
  let leftTurn = 0;
  let rightTurn = 0;
  let lastDirection: 1 | -1 = rng.sign() as 1 | -1;
  let runLength = 0;
  let straightIndex = 0;
  let hairpins = 0;
  let kinks = 0;
  let total = 0;
  let curveCount = 0;

  while (total < target - 70 && straightIndex < 44) {
    let straightLength: number;
    if (straightIndex === featureStraight) {
      straightLength = rng.range(86, 108);
    } else if (rng.chance(0.3)) {
      straightLength = rng.range(60, 96);
    } else {
      straightLength = rng.range(24, 66);
    }

    segments.push({ kind: 'straight', length: straightLength });
    total += straightLength;
    straightIndex += 1;

    if (total >= target - 70) {
      break;
    }

    const category = pickCurveCategoryV5(
      rng,
      categoryCounts,
      curveCount,
      hairpins,
      planHairpins,
      kinks,
      planKinks,
    );
    if (category === null) {
      break;
    }
    if (category === 'hairpin') {
      hairpins += 1;
    }
    if (category === 'kink') {
      kinks += 1;
    }
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const range = CURVE_RANGES[category];
    const radius = rng.range(range.radius[0], range.radius[1]);
    const sweep = rng.range(range.sweep[0], range.sweep[1]);

    // Evita três curvas seguidas no mesmo sentido e puxa o balanço para zero.
    let turn: 1 | -1;
    if (runLength >= 2) {
      turn = lastDirection === 1 ? -1 : 1;
    } else {
      const expectedShare = turnBalance / Math.max(60, totalTurn + sweep);
      const probabilityRight = clamp(0.5 - expectedShare * 0.45, 0.18, 0.82);
      turn = rng.chance(probabilityRight) ? 1 : -1;
    }

    if (turn === lastDirection) {
      runLength += 1;
    } else {
      runLength = 1;
      lastDirection = turn;
    }

    segments.push({
      kind: 'curve',
      category,
      radius,
      sweep,
      turn,
    });
    total += radius * sweep;
    curveCount += 1;
    directionCounts[turn > 0 ? 'right' : 'left'] += 1;
    turnBalance += turn * sweep;
    totalTurn += sweep;
    if (turn > 0) {
      rightTurn += sweep;
    } else {
      leftTurn += sweep;
    }
  }

  const finalLength = clamp(target + 25 - total, 40, 96);
  segments.push({ kind: 'straight', length: finalLength });
  total += finalLength;

  if (curveCount < 10 || straightIndex < 8) {
    return null;
  }

  // Pelo menos 4 das 6 categorias em cada pista.
  const categoriesPresent = [...categoryCounts.keys()];
  if (categoriesPresent.length < 4) {
    return null;
  }
  if (!categoryCounts.has('hairpin') || !categoryCounts.has('kink')) {
    return null;
  }

  // Curvas para os dois lados e sem sequência totalmente unilateral.
  if (directionCounts.left < 2 || directionCounts.right < 2) {
    return null;
  }
  if (totalTurn > 0) {
    // Nenhum dos sentidos pode dominar o traçado (evita pista "one-sided").
    if (leftTurn / totalTurn < 0.3 || rightTurn / totalTurn < 0.3) {
      return null;
    }
  }

  return segments;
}

function pickCurveCategoryV5(
  rng: Rng,
  counts: ReadonlyMap<CurveCategory, number>,
  curveCount: number,
  hairpins: number,
  hairpinBudget: number,
  kinks: number,
  kinkBudget: number,
): CurveCategory | null {
  // Garante pelo menos um kink e um hairpin; depois respeita os orçamentos.
  if (kinks < kinkBudget && kinks === 0 && curveCount >= 6) {
    return 'kink';
  }
  if (kinks < kinkBudget && rng.chance(0.13)) {
    return 'kink';
  }
  if (hairpins < hairpinBudget && hairpins === 0 && curveCount >= 9) {
    return 'hairpin';
  }
  if (hairpins < hairpinBudget && rng.chance(0.13)) {
    return 'hairpin';
  }

  // Reforça categorias ainda ausentes na segunda metade da pista.
  if (curveCount >= 7 && counts.size < 4) {
    const missing: CurveCategory[] = (
      ['long', 'medium', 'short', 'elbow'] as const
    ).filter((category) => !counts.has(category));
    if (missing.length > 0) {
      return rng.pick(missing);
    }
  }

  const roll = rng.next();
  if (roll < 0.32) return 'long';
  if (roll < 0.6) return 'medium';
  if (roll < 0.8) return 'short';
  return 'elbow';
}

function appendStraightDense(
  raw: RawPoint[],
  state: PathState,
  length: number,
  startS: number,
): number {
  const steps = Math.max(2, Math.ceil(length / DENSE_STEP));
  const stepLength = length / steps;
  const dx = Math.sin(state.heading) * stepLength;
  const dz = Math.cos(state.heading) * stepLength;
  let s = startS;

  for (let step = 0; step < steps; step += 1) {
    state.x += dx;
    state.z += dz;
    s += stepLength;
    raw.push({ x: state.x, z: state.z, y: 0, s });
  }

  return s;
}

function appendArcDense(
  raw: RawPoint[],
  state: PathState,
  curve: CurveSpec,
  startS: number,
): number {
  const arcLength = curve.radius * curve.sweep;
  const steps = Math.max(4, Math.ceil(arcLength / DENSE_STEP));
  const stepLength = arcLength / steps;
  const delta = (curve.turn * curve.sweep) / steps;
  let s = startS;

  for (let step = 0; step < steps; step += 1) {
    const midHeading = state.heading + delta * 0.5;
    state.x += Math.sin(midHeading) * stepLength;
    state.z += Math.cos(midHeading) * stepLength;
    state.heading += delta;
    s += stepLength;
    raw.push({ x: state.x, z: state.z, y: 0, s });
  }

  return s;
}

function planarBounds(raw: readonly RawPoint[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of raw) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  return { minX, maxX, minZ, maxZ };
}

/**
 * Menor distância entre dois trechos não vizinhos, usando spatial hash.
 * Retorna `Infinity` quando o caminho tem menos de dois trechos distantes.
 */
function minSectionDistance(raw: readonly RawPoint[]): number {
  const cell = SECTION_CLEARANCE;
  const cells = new Map<string, number[]>();
  let best = Infinity;

  for (let i = 0; i < raw.length; i += 1) {
    const point = raw[i];
    const cx = Math.floor(point.x / cell);
    const cz = Math.floor(point.z / cell);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = cells.get(`${cx + dx},${cz + dz}`);
        if (!bucket) {
          continue;
        }
        for (const index of bucket) {
          const other = raw[index];
          if (point.s - other.s < SECTION_ALONG_WINDOW) {
            continue;
          }
          const distance = Math.hypot(point.x - other.x, point.z - other.z);
          if (distance < best) {
            best = distance;
          }
        }
      }
    }

    const key = `${cx},${cz}`;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      cells.set(key, [i]);
    }
  }

  return best;
}

interface WidthEvent {
  startS: number;
  endS: number;
  center: number;
  half: number;
  width: number;
  transition: number;
  kind: 'choke' | 'narrow' | 'wide';
}

interface WidthProfileV5 {
  widthAt: (s: number) => number;
  features: readonly ProceduralWidthFeature[];
}

function buildWidthProfileV5(
  rng: Rng,
  curves: readonly ProceduralCurveInfo[],
  total: number,
): WidthProfileV5 {
  const base = rng.range(10.5, 12);
  const basePhase = rng.range(0, TAU);
  const events: WidthEvent[] = [];
  const tightCurves = curves.filter(
    (curve) => curve.category === 'hairpin' || curve.category === 'elbow',
  );

  const fits = (
    center: number,
    half: number,
    transition: number,
    kind: 'choke' | 'narrow' | 'wide',
  ): boolean => {
    if (center - half - transition < 25 || center + half + transition > total - 25) {
      return false;
    }
    for (const other of events) {
      const minimum =
        half + other.half + Math.max(transition, other.transition) + 12;
      if (Math.abs(center - other.center) < minimum) {
        return false;
      }
    }
    if (kind === 'choke') {
      for (const curve of tightCurves) {
        if (
          center + half + transition > curve.startS - 4 &&
          center - half - transition < curve.endS + 4
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const addEvents = (
    count: number,
    kind: 'choke' | 'narrow' | 'wide',
    lengthRange: [number, number],
    widthRange: [number, number],
  ): void => {
    for (let index = 0; index < count; index += 1) {
      const length = rng.range(lengthRange[0], lengthRange[1]);
      const half = length * 0.5;
      const transition = rng.range(30, 40);
      let placed = false;

      for (let attempt = 0; attempt < 400; attempt += 1) {
        const center = rng.range(25 + half + transition, total - 25 - half - transition);
        if (!fits(center, half, transition, kind)) {
          continue;
        }
        events.push({
          startS: center - half,
          endS: center + half,
          center,
          half,
          width: rng.range(widthRange[0], widthRange[1]),
          transition,
          kind,
        });
        placed = true;
        break;
      }

      if (!placed) {
        // Posições de reserva espaçadas (mantém a contagem mínima por pista).
        const slot = (index + 1) / (count + 2);
        const center = total * (0.25 + slot * 0.5);
        const shift = kind === 'choke' ? 26 : kind === 'narrow' ? -34 : 0;
        events.push({
          startS: center + shift - half,
          endS: center + shift + half,
          center: center + shift,
          half,
          width: (widthRange[0] + widthRange[1]) * 0.5,
          transition,
          kind,
        });
      }
    }
  };

  const chokeCount = rng.int(2, 3);
  addEvents(chokeCount, 'choke', [50, 90], [4.6, 5.4]);
  addEvents(1, 'narrow', [120, 220], [5.5, 7]);
  addEvents(rng.int(1, 2), 'wide', [80, 160], [13, 15]);

  events.sort((a, b) => a.center - b.center);

  const widthAt = (s: number): number => {
    let width = base + 0.35 * Math.sin(s * 0.007 + basePhase);

    for (const event of events) {
      let weight = 0;
      if (s >= event.startS && s <= event.endS) {
        weight = 1;
      } else if (s < event.startS) {
        weight = smoothstep(
          clamp((s - (event.startS - event.transition)) / event.transition, 0, 1),
        );
      } else if (s > event.endS) {
        weight = smoothstep(
          clamp(
            (event.endS + event.transition - s) / event.transition,
            0,
            1,
          ),
        );
      }
      if (weight <= 0) {
        continue;
      }
      width = lerp(width, event.width, weight);
    }

    return clamp(width, 4.6, 15);
  };

  return {
    widthAt,
    features: events.map((event) => ({
      kind: event.kind,
      startS: event.startS,
      endS: event.endS,
      width: event.width,
    })),
  };
}

function placeKickersOnStraights(
  rng: Rng,
  straights: readonly ProceduralStraightInfo[],
  length: number,
  scale: number,
): readonly TrackKicker[] {
  const desired = rng.chance(0.7) ? 2 : 1;
  const candidates = shuffle(
    straights.filter((straight) => straight.endS - straight.startS >= 70),
    rng,
  );
  const kickers: TrackKicker[] = [];

  for (const straight of candidates) {
    if (kickers.length >= desired) {
      break;
    }

    const rampLength = rng.range(6, 7);
    const straightLength = straight.endS - straight.startS;
    const margin = 8;
    const landing = 48;
    const minimum = straight.startS + margin;
    const maximum = straight.endS - margin - rampLength - landing;
    if (maximum < minimum || straightLength < margin * 2 + rampLength + landing) {
      continue;
    }

    const rawS = rng.range(minimum, maximum);
    const s = rawS * scale;
    if (s < 12 || s + rampLength + KICKER_LANDING > length - 2) {
      continue;
    }
    if (
      kickers.some(
        (kicker) => Math.abs(kicker.s - s) < 40 + rampLength,
      )
    ) {
      continue;
    }

    kickers.push({
      s,
      length: rampLength,
      height: rng.range(1, 1.5),
    });
  }

  kickers.sort((a, b) => a.s - b.s);
  return kickers;
}

function placePowerupsOnTrack(
  rng: Rng,
  raw: readonly RawPoint[],
  widthAt: (s: number) => number,
  kickers: readonly TrackKicker[],
  length: number,
  scale: number,
): readonly TrackPowerup[] {
  const count = rng.int(MIN_POWERUPS, MAX_POWERUPS);
  const types: PowerupType[] = [
    rng.chance(0.5) ? 'turbo' : 'grip',
    rng.chance(0.5) ? 'turbo' : 'grip',
  ];
  if (types[0] === types[1]) {
    types[1] = types[0] === 'turbo' ? 'grip' : 'turbo';
  }
  while (types.length < count) {
    types.push(rng.chance(0.5) ? 'turbo' : 'grip');
  }

  const placed: TrackPowerup[] = [];
  const total = raw[raw.length - 1].s;

  for (let attempt = 0; attempt < 900 && placed.length < count; attempt += 1) {
    const rawS = rng.range(15, Math.max(20, total - 18));
    const s = rawS * scale;
    if (s > length - 12) {
      continue;
    }
    if (
      kickers.some(
        (kicker) =>
          s > kicker.s - 20 &&
          s < kicker.s + kicker.length + 22,
      )
    ) {
      continue;
    }
    if (placed.some((powerup) => Math.abs(powerup.s - s) < 30)) {
      continue;
    }

    const halfWidth = widthAt(rawS) * 0.5;
    // Prefere trechos com espaço para desviar; chokes muito estreitos ainda
    // aceitam powerup centralizado.
    const magnitude = Math.min(
      halfWidth - POWERUP_MIN_CLEARANCE - 0.4,
      rng.range(0.2, 0.6) * halfWidth,
    );
    if (magnitude <= 0.2) {
      continue;
    }

    placed.push({
      type: types[placed.length] ?? 'turbo',
      s,
      u: rng.sign() * magnitude,
    });
  }

  // Fallback determinístico, sempre fora da zona de salto/aterrissagem.
  let slot = 0;
  while (placed.length < count) {
    slot += 1;
    let s = (length * slot) / (count + 1);
    for (const kicker of kickers) {
      if (s > kicker.s - 20 && s < kicker.s + kicker.length + 22) {
        s = kicker.s + kicker.length + 26;
      }
    }
    if (s > length - 12) {
      s = length - 12;
    }
    while (
      placed.some((powerup) => Math.abs(powerup.s - s) < 18) &&
      s < length - 30
    ) {
      s += 22;
    }
    const rawS = clamp(s / scale, 0, total);
    const halfWidth = widthAt(rawS) * 0.5;
    const magnitude = Math.max(0, Math.min(0.35, halfWidth - POWERUP_MIN_CLEARANCE - 0.4));
    placed.push({
      type: types[placed.length] ?? 'turbo',
      s,
      u: magnitude,
    });
  }

  placed.sort((a, b) => a.s - b.s);
  return placed;
}

function placeObstaclesOffTrack(
  rng: Rng,
  raw: readonly RawPoint[],
  widthAt: (s: number) => number,
  length: number,
  scale: number,
): readonly TrackObstacle[] {
  const target = rng.int(MIN_OBSTACLES, MAX_OBSTACLES);
  const total = raw[raw.length - 1].s;
  const rawWidths = raw.map((point) => widthAt(point.s));
  const obstacles: ObstacleCandidate[] = [];
  const maxAttempts = target * 220;

  for (let attempt = 0; attempt < maxAttempts && obstacles.length < target; attempt += 1) {
    const rawS = rng.range(8, Math.max(10, total - 8));
    const center = sampleDense(raw, rawS);
    const nearbyMax = Math.max(
      widthAt(rawS),
      widthAt(clamp(rawS - 6, 0, total)),
      widthAt(clamp(rawS + 6, 0, total)),
    );
    const halfWidth = nearbyMax * 0.5;
    const side = rng.sign();
    const u = side * (halfWidth + rng.range(6.2, 13));
    const obstacleX = center.x + center.rightX * u;
    const obstacleZ = center.z + center.rightZ * u;

    let clear = true;
    for (let i = 0; i < raw.length; i += 1) {
      const point = raw[i];
      const distance = Math.hypot(point.x - obstacleX, point.z - obstacleZ);
      if (distance < rawWidths[i] * 0.5 + OBSTACLE_EDGE_CLEARANCE) {
        clear = false;
        break;
      }
    }
    if (!clear) {
      continue;
    }

    for (const other of obstacles) {
      if (
        Math.hypot(other.x - obstacleX, other.z - obstacleZ) <
        other.radius + 1.4 + 1.6
      ) {
        clear = false;
        break;
      }
    }
    if (!clear) {
      continue;
    }

    const zoneIndex = Math.min(3, Math.floor((rawS / Math.max(1, total)) * 4));
    const zoneId: TrackZoneId = zoneIndex % 2 === 0 ? 'forest' : 'desert';
    const type = pickObstacleType(rng, zoneId);
    const radius =
      type === 'tree'
        ? rng.range(0.8, 1.4)
        : type === 'log'
          ? rng.range(1, 1.6)
          : rng.range(0.8, 1.5);

    obstacles.push({
      s: clamp(rawS * scale, 2, length - 2),
      u,
      radius,
      type,
      x: obstacleX,
      z: obstacleZ,
    });
  }

  obstacles.sort((a, b) => a.s - b.s);
  return obstacles.map(({ s, u, radius, type }) => ({ s, u, radius, type }));
}


function buildCandidate(rng: Rng, seed: number): TrackDef {
  const hairpinRadii = pickHairpinRadii(rng);
  const raw: RawPoint[] = [{ x: 0, z: 0, y: 0, s: 0 }];
  const legRanges: LegRange[] = [];
  const hairpinRanges: HairpinRange[] = [];

  let laneX = 0;
  let z = 0;

  for (let legIndex = 0; legIndex < 4; legIndex += 1) {
    const direction = legIndex % 2 === 0 ? 1 : -1;
    const legLength = rng.range(165, 215);
    const bumps = buildBumps(rng, legLength);
    const range = appendLeg(raw, laneX, z, direction, legLength, bumps);
    legRanges.push(range);
    z += direction * legLength;

    if (legIndex < 3) {
      const radius = hairpinRadii[legIndex];
      const centerX = laneX + radius;
      const startAngle = Math.PI;
      const endAngle = legIndex % 2 === 0 ? 0 : TAU;
      hairpinRanges.push(
        appendHairpin(raw, centerX, z, radius, startAngle, endAngle),
      );
      laneX += radius * 2;
    }
  }

  const planarLength = raw[raw.length - 1].s;
  const elevation = buildElevation(rng, planarLength);
  const baseY = elevation(0);
  let maxSlope = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const point = raw[i];
    point.y = elevation(point.s) - baseY;
    if (i > 0) {
      const previous = raw[i - 1];
      const run = Math.max(0.001, point.s - previous.s);
      maxSlope = Math.max(maxSlope, Math.abs(point.y - previous.y) / run);
    }
  }

  // Mantém o relevo suave mesmo quando as ondas somam no pior caso.
  if (maxSlope > MAX_GRADE_BUILD) {
    const scale = MAX_GRADE_BUILD / maxSlope;
    for (const point of raw) {
      point.y *= scale;
    }
  }

  recalculate3dS(raw);

  const total = raw[raw.length - 1].s;
  const legs = legRanges.map((range) => ({
    startS: raw[range.startIndex].s,
    midStartS: raw[range.midStartIndex].s,
    midEndS: raw[range.midEndIndex].s,
    endS: raw[range.endIndex].s,
  }));
  const hairpins: HairpinInfo[] = hairpinRanges.map((range) => ({
    startS: raw[range.startIndex].s,
    endS: raw[range.endIndex].s,
    radius: range.radius,
  }));

  const widthAt = buildWidthFunction(rng, hairpins);
  const controlPoints = resampleControlPoints(raw, CONTROL_SPACING).map(
    (point) => ({
      x: point.x,
      z: point.z,
      y: point.y,
      width: widthAt(point.s),
    }),
  );

  const length = measureLength(controlPoints);
  const scale = length / total;

  const kickers = placeKickers(rng, legs, length, scale);
  const splitsAndZones = buildZonesAndSplits(length);
  const powerups = placePowerups(
    rng,
    raw,
    widthAt,
    kickers,
    length,
    scale,
  );
  const obstacles = placeObstacles(rng, raw, widthAt, length, scale);

  return {
    id: `proc-${seed}`,
    points: controlPoints,
    zones: splitsAndZones.zones,
    kickers,
    obstacles,
    powerups,
    splits: splitsAndZones.splits,
    medals: buildMedals(length),
  };
}

function pickHairpinRadii(rng: Rng): [number, number, number] {
  const tightIndex = rng.int(0, 2);
  return [0, 1, 2].map((index) =>
    index === tightIndex ? rng.range(26.3, 27.5) : rng.range(29.5, 34),
  ) as [number, number, number];
}

function buildBumps(rng: Rng, legLength: number): readonly Bump[] {
  // A ondulação principal ocupa ~28% da perna e termina em t = 0.32.
  const mainHalf = rng.range(0.12, 0.14);
  const mainCenter = 0.18;
  const mainSpan = 2 * mainHalf * legLength;
  const mainCurvatureLimit =
    (mainSpan * mainSpan) / (2 * Math.PI * Math.PI * 34);
  const mainAmp =
    Math.min(rng.range(4.2, 6.5), mainCurvatureLimit) * rng.sign();

  const bumps: Bump[] = [
    { center: mainCenter, half: mainHalf, amp: mainAmp },
  ];

  if (rng.chance(0.7)) {
    const secondaryHalf = rng.range(0.1, 0.12);
    const secondaryCenter = 0.82;
    const secondarySpan = 2 * secondaryHalf * legLength;
    const secondaryCurvatureLimit =
      (secondarySpan * secondarySpan) / (2 * Math.PI * Math.PI * 38);
    const secondaryAmp =
      Math.min(rng.range(2.6, 4.2), secondaryCurvatureLimit) *
      (rng.chance(0.7) ? -Math.sign(mainAmp) : rng.sign());
    bumps.push({
      center: secondaryCenter,
      half: secondaryHalf,
      amp: secondaryAmp,
    });
  }

  return bumps;
}

function legOffset(t: number, bumps: readonly Bump[]): number {
  let offset = 0;

  for (const bump of bumps) {
    const u = (t - (bump.center - bump.half)) / (bump.half * 2);
    if (u <= 0 || u >= 1) {
      continue;
    }
    const wave = Math.sin(Math.PI * u);
    offset += bump.amp * wave * wave;
  }

  return offset;
}

function appendLeg(
  raw: RawPoint[],
  laneX: number,
  zStart: number,
  direction: 1 | -1,
  legLength: number,
  bumps: readonly Bump[],
): LegRange {
  const startIndex = raw.length - 1;
  const steps = Math.max(2, Math.round(legLength / DENSE_STEP));
  let midStartIndex = startIndex;
  let midEndIndex = -1;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    pushRaw(
      raw,
      laneX + legOffset(t, bumps),
      zStart + direction * legLength * t,
    );

    if (t >= 0.32 && midStartIndex === startIndex) {
      midStartIndex = raw.length - 1;
    }
    if (t >= 0.68 && midEndIndex < 0) {
      midEndIndex = raw.length - 1;
    }
  }

  return {
    startIndex,
    endIndex: raw.length - 1,
    midStartIndex,
    midEndIndex: midEndIndex < 0 ? raw.length - 1 : midEndIndex,
  };
}

function appendHairpin(
  raw: RawPoint[],
  centerX: number,
  centerZ: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): HairpinRange {
  const startIndex = raw.length - 1;
  const arcLength = Math.abs(endAngle - startAngle) * radius;
  const steps = Math.max(8, Math.ceil(arcLength / DENSE_STEP));

  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + ((endAngle - startAngle) * step) / steps;
    pushRaw(
      raw,
      centerX + Math.cos(angle) * radius,
      centerZ + Math.sin(angle) * radius,
    );
  }

  return { startIndex, endIndex: raw.length - 1, radius };
}

function pushRaw(raw: RawPoint[], x: number, z: number): void {
  const previous = raw[raw.length - 1];
  const distance = Math.hypot(x - previous.x, z - previous.z);
  raw.push({ x, z, y: 0, s: previous.s + distance });
}

function recalculate3dS(raw: RawPoint[]): void {
  let total = 0;
  raw[0].s = 0;

  for (let i = 1; i < raw.length; i += 1) {
    const previous = raw[i - 1];
    const point = raw[i];
    total += Math.hypot(
      point.x - previous.x,
      point.y - previous.y,
      point.z - previous.z,
    );
    point.s = total;
  }
}

function buildElevation(
  rng: Rng,
  totalLength: number,
): (s: number) => number {
  const longAmplitude = rng.range(3.5, 6);
  const longWavelength = rng.range(320, 460);
  const longPhase = rng.range(0, TAU);
  const mediumAmplitude = rng.range(1.2, 2.4);
  const mediumWavelength = rng.range(170, 240);
  const mediumPhase = rng.range(0, TAU);

  const crests: { center: number; half: number; height: number }[] = [];
  const crestCount = rng.int(2, 4);

  for (let i = 0; i < crestCount; i += 1) {
    crests.push({
      center: rng.range(70, Math.max(80, totalLength - 70)),
      half: rng.range(15, 22),
      height: rng.range(0.5, 0.9) * rng.sign(),
    });
  }

  return (s: number): number => {
    let y =
      longAmplitude * Math.sin((TAU * s) / longWavelength + longPhase) +
      mediumAmplitude * Math.sin((TAU * s) / mediumWavelength + mediumPhase);

    for (const crest of crests) {
      const u = (s - (crest.center - crest.half)) / (crest.half * 2);
      if (u <= 0 || u >= 1) {
        continue;
      }
      const wave = Math.sin(Math.PI * u);
      y += crest.height * wave * wave;
    }

    return y;
  };
}

interface ElevationV5 {
  value: (s: number) => number;
  flatFraction: number;
  bands: readonly { startS: number; endS: number }[];
}

function buildElevationV5(rng: Rng, totalLength: number): ElevationV5 {
  const longAmplitude = rng.range(4.2, 7.2);
  const longWavelength = rng.range(320, 460);
  const longPhase = rng.range(0, TAU);
  const mediumAmplitude = rng.range(1.45, 2.9);
  const mediumWavelength = rng.range(170, 240);
  const mediumPhase = rng.range(0, TAU);

  const crests: { center: number; half: number; height: number }[] = [];
  const crestCount = rng.int(2, 4);

  for (let i = 0; i < crestCount; i += 1) {
    crests.push({
      center: rng.range(70, Math.max(80, totalLength - 70)),
      half: rng.range(15, 22),
      height: rng.range(0.6, 1.1) * rng.sign(),
    });
  }

  const baseValue = (s: number): number => {
    let y =
      longAmplitude * Math.sin((TAU * s) / longWavelength + longPhase) +
      mediumAmplitude * Math.sin((TAU * s) / mediumWavelength + mediumPhase);

    for (const crest of crests) {
      const u = (s - (crest.center - crest.half)) / (crest.half * 2);
      if (u <= 0 || u >= 1) {
        continue;
      }
      const wave = Math.sin(Math.PI * u);
      y += crest.height * wave * wave;
    }

    return y;
  };

  // 2–3 faixas planas ocupando 20–25% da pista. Pistas mais longas usam 3
  // faixas para que cada uma caiba em 70–150 m.
  const bandCount = totalLength > 1500 ? 3 : rng.int(2, 3);
  const targetFraction = rng.range(0.2, 0.25);
  const wanted = (targetFraction * totalLength) / bandCount;
  let bandLength = clamp(wanted, 70, 150);
  let sum = bandLength * bandCount;
  if (sum < 0.2 * totalLength) {
    bandLength = Math.min(150, (0.21 * totalLength) / bandCount);
    sum = bandLength * bandCount;
  }
  if (sum > 0.25 * totalLength) {
    bandLength = Math.max(70, (0.24 * totalLength) / bandCount);
    sum = bandLength * bandCount;
  }

  const bands: { startS: number; endS: number; level: number; transition: number }[] = [];
  const gap = 90;

  for (let index = 0; index < bandCount; index += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const start = rng.range(
        70,
        Math.max(80, totalLength - 70 - bandLength),
      );
      const end = start + bandLength;
      const overlaps = bands.some(
        (band) => start < band.endS + gap && end > band.startS - gap,
      );
      if (overlaps) {
        continue;
      }
      bands.push({
        startS: start,
        endS: end,
        level: baseValue((start + end) * 0.5),
        transition: rng.range(25, 30),
      });
      placed = true;
      break;
    }
    if (!placed) {
      return {
        value: baseValue,
        flatFraction: 0,
        bands: [],
      };
    }
  }

  bands.sort((a, b) => a.startS - b.startS);

  const value = (s: number): number => {
    for (const band of bands) {
      if (s >= band.startS && s <= band.endS) {
        return band.level;
      }
      if (s >= band.startS - band.transition && s < band.startS) {
        const weight = smoothstep(
          clamp((s - (band.startS - band.transition)) / band.transition, 0, 1),
        );
        return lerp(baseValue(s), band.level, weight);
      }
      if (s > band.endS && s <= band.endS + band.transition) {
        const weight = smoothstep(
          clamp((band.endS + band.transition - s) / band.transition, 0, 1),
        );
        return lerp(baseValue(s), band.level, weight);
      }
    }
    return baseValue(s);
  };

  return {
    value,
    flatFraction: (bandLength * bandCount) / totalLength,
    bands: bands.map((band) => ({ startS: band.startS, endS: band.endS })),
  };
}

function buildWidthFunction(
  rng: Rng,
  hairpins: readonly HairpinInfo[],
): (s: number) => number {
  const basePhase = rng.range(0, TAU);
  const narrowPhase = rng.range(0, TAU);

  return (s: number): number => {
    let distanceToHairpin = Infinity;

    for (const hairpin of hairpins) {
      if (s >= hairpin.startS && s <= hairpin.endS) {
        distanceToHairpin = 0;
        break;
      }
      distanceToHairpin = Math.min(
        distanceToHairpin,
        Math.abs(s - hairpin.startS),
        Math.abs(s - hairpin.endS),
      );
    }

    const base = 11.8 + 1.2 * Math.sin(s * 0.011 + basePhase);
    const narrow = 8.8 + 0.5 * Math.sin(s * 0.17 + narrowPhase);
    const blend = smoothstep(clamp(distanceToHairpin / 34, 0, 1));
    const width = lerp(narrow, base, blend);
    return clamp(width, 8.6, 13.5);
  };
}

function resampleControlPoints(
  raw: readonly RawPoint[],
  spacing: number,
): readonly RawPoint[] {
  const total = raw[raw.length - 1].s;
  const out: RawPoint[] = [];
  let index = 0;

  for (let target = 0; target < total; target += spacing) {
    while (
      index < raw.length - 2 &&
      raw[index + 1].s < target
    ) {
      index += 1;
    }

    const a = raw[index];
    const b = raw[Math.min(index + 1, raw.length - 1)];
    const span = b.s - a.s;
    const t = span > 1e-9 ? clamp((target - a.s) / span, 0, 1) : 0;
    out.push({
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      y: lerp(a.y, b.y, t),
      s: target,
    });
  }

  const last = raw[raw.length - 1];
  const previous = out[out.length - 1];
  if (!previous || Math.hypot(last.x - previous.x, last.z - previous.z) > 0.25) {
    out.push({ ...last });
  } else if (previous) {
    previous.x = last.x;
    previous.z = last.z;
    previous.y = last.y;
  }

  return out;
}

function measureLength(points: readonly TrackPoint[]): number {
  const curve = new CatmullRomCurve3(
    points.map((point) => new Vector3(point.x, point.y, point.z)),
    false,
    'centripetal',
  );
  return curve.getLength();
}

function placeKickers(
  rng: Rng,
  legs: readonly LegInfo[],
  length: number,
  scale: number,
): readonly TrackKicker[] {
  const desired = rng.chance(0.65) ? 2 : 1;
  const order = shuffle([0, 1, 2, 3], rng);
  const kickers: TrackKicker[] = [];

  for (const legIndex of order) {
    if (kickers.length >= desired) {
      break;
    }

    const leg = legs[legIndex];
    const rampLength = rng.range(6, 7);
    const minimum = leg.midStartS + 6;
    const maximum =
      leg.midEndS - (rampLength + KICKER_PLACEMENT_LANDING) - 1;

    if (maximum < minimum) {
      continue;
    }

    const s = clamp(rng.range(minimum, maximum) * scale, 12, length - 55);
    if (s < 12 || s + rampLength + KICKER_LANDING > length - 2) {
      continue;
    }

    kickers.push({
      s,
      length: rampLength,
      height: rng.range(1, 1.5),
    });
  }

  if (kickers.length === 0) {
    // Caminho de segurança: usa a perna 1, que sempre tem trecho reto.
    const leg = legs[1] ?? legs[0];
    const rampLength = 6.2;
    const s = clamp(
      leg.midStartS + 6,
      12,
      Math.max(12, length - rampLength - KICKER_LANDING - 2),
    );
    kickers.push({ s, length: rampLength, height: 1.15 });
  }

  kickers.sort((a, b) => a.s - b.s);
  return kickers;
}

function buildZonesAndSplits(length: number): {
  zones: readonly TrackZone[];
  splits: readonly TrackSplit[];
} {
  const bounds = [0, length * 0.25, length * 0.5, length * 0.75, length];
  const zones: TrackZone[] = [];
  const splits: TrackSplit[] = [];

  for (let i = 0; i < 4; i += 1) {
    const id: TrackZoneId = i % 2 === 0 ? 'forest' : 'desert';
    zones.push({
      start: bounds[i],
      end: i === 3 ? length : bounds[i + 1],
      id,
      surface: id === 'forest' ? 'gravel' : 'sand',
    });
  }

  for (let i = 0; i < 3; i += 1) {
    const s = bounds[i + 1];
    splits.push({
      s,
      name: `Parcial ${i + 1}`,
      target: round1(s / 18),
    });
  }

  return { zones, splits };
}

function buildZonesAndSplitsV5(
  rng: Rng,
  length: number,
): {
  zones: readonly TrackZone[];
  splits: readonly TrackSplit[];
} {
  // Comprimento nominal por setor (340–470 m) com jitter de ±8%. Se a soma
  // não casar com o comprimento final, escala proporcionalmente.
  const weights = [0, 1, 2, 3].map(() => rng.range(0.92, 1.08));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  let lengths = weights.map((weight) =>
    clamp((weight / weightSum) * length, 340, 470),
  );
  const lengthSum = lengths.reduce((sum, value) => sum + value, 0);
  const scale = length / lengthSum;
  lengths = lengths.map((value) => value * scale);

  const bounds = [0];
  for (const zoneLength of lengths) {
    bounds.push(bounds[bounds.length - 1] + zoneLength);
  }
  bounds[bounds.length - 1] = length;

  const zones: TrackZone[] = [];
  const splits: TrackSplit[] = [];

  for (let i = 0; i < 4; i += 1) {
    const id: TrackZoneId = i % 2 === 0 ? 'forest' : 'desert';
    zones.push({
      start: bounds[i],
      end: i === 3 ? length : bounds[i + 1],
      id,
      surface: id === 'forest' ? 'gravel' : 'sand',
    });
  }

  for (let i = 0; i < 3; i += 1) {
    const s = bounds[i + 1];
    splits.push({
      s,
      name: `Parcial ${i + 1}`,
      target: round1(s / 18),
    });
  }

  return { zones, splits };
}

function placePowerups(
  rng: Rng,
  raw: readonly RawPoint[],
  widthAt: (s: number) => number,
  kickers: readonly TrackKicker[],
  length: number,
  scale: number,
): readonly TrackPowerup[] {
  const count = rng.int(4, 6);
  const types: PowerupType[] = [
    rng.chance(0.5) ? 'turbo' : 'grip',
    rng.chance(0.5) ? 'turbo' : 'grip',
  ];
  if (types[0] === types[1]) {
    types[1] = types[0] === 'turbo' ? 'grip' : 'turbo';
  }
  while (types.length < count) {
    types.push(rng.chance(0.5) ? 'turbo' : 'grip');
  }

  const placed: TrackPowerup[] = [];
  const total = raw[raw.length - 1].s;

  for (let attempt = 0; attempt < 500 && placed.length < count; attempt += 1) {
    const rawS = rng.range(15, Math.max(20, total - 18));
    const s = rawS * scale;
    if (s > length - 12) {
      continue;
    }
    if (
      kickers.some(
        (kicker) =>
          s > kicker.s - 18 &&
          s < kicker.s + kicker.length + 20,
      )
    ) {
      continue;
    }
    if (placed.some((powerup) => Math.abs(powerup.s - s) < 24)) {
      continue;
    }

    const halfWidth = widthAt(rawS) * 0.5;
    const magnitude = Math.min(
      halfWidth - POWERUP_MIN_CLEARANCE - 0.2,
      rng.range(0.2, 0.55) * halfWidth,
    );
    if (magnitude <= 0.2) {
      continue;
    }

    placed.push({
      type: types[placed.length] ?? 'turbo',
      s,
      u: rng.sign() * magnitude,
    });
  }

  // Fallback determinístico: cobre o caso extremo de rejeições.
  while (placed.length < 4) {
    const s = (length * (placed.length + 1)) / 6;
    placed.push({
      type: types[placed.length] ?? 'turbo',
      s,
      u: 0,
    });
  }

  placed.sort((a, b) => a.s - b.s);
  return placed;
}

function placeObstacles(
  rng: Rng,
  raw: readonly RawPoint[],
  widthAt: (s: number) => number,
  length: number,
  scale: number,
): readonly TrackObstacle[] {
  const target = rng.int(30, 60);
  const total = raw[raw.length - 1].s;
  const rawWidths = raw.map((point) => widthAt(point.s));
  const obstacles: ObstacleCandidate[] = [];
  const maxAttempts = target * 120;

  for (let attempt = 0; attempt < maxAttempts && obstacles.length < target; attempt += 1) {
    const rawS = rng.range(10, Math.max(12, total - 10));
    const halfWidth = widthAt(rawS) * 0.5;
    const side = rng.sign();
    const u = side * (halfWidth + rng.range(OBSTACLE_PLACEMENT_CLEARANCE, 13));
    const center = sampleDense(raw, rawS);
    const x = center.x + center.rightX * u;
    const z = center.z + center.rightZ * u;

    let clear = true;

    for (let i = 0; i < raw.length; i += 1) {
      const point = raw[i];
      const distance = Math.hypot(point.x - x, point.z - z);
      if (distance < rawWidths[i] * 0.5 + OBSTACLE_EDGE_CLEARANCE - 0.3) {
        clear = false;
        break;
      }
    }

    if (!clear) {
      continue;
    }

    for (const other of obstacles) {
      if (
        Math.hypot(other.x - x, other.z - z) <
        other.radius + 1.4 + 1.6
      ) {
        clear = false;
        break;
      }
    }

    if (!clear) {
      continue;
    }

    const zoneIndex = Math.min(
      3,
      Math.floor((rawS / Math.max(1, total)) * 4),
    );
    const zoneId: TrackZoneId = zoneIndex % 2 === 0 ? 'forest' : 'desert';
    const type = pickObstacleType(rng, zoneId);
    const radius =
      type === 'tree'
        ? rng.range(0.8, 1.4)
        : type === 'log'
          ? rng.range(1, 1.6)
          : rng.range(0.8, 1.5);

    obstacles.push({
      s: clamp(rawS * scale, 2, length - 2),
      u,
      radius,
      type,
      x,
      z,
    });
  }

  obstacles.sort((a, b) => a.s - b.s);
  return obstacles.map(({ s, u, radius, type }) => ({ s, u, radius, type }));
}

function pickObstacleType(
  rng: Rng,
  zone: TrackZoneId,
): TrackObstacle['type'] {
  const roll = rng.next();

  if (zone === 'forest') {
    if (roll < 0.45) return 'tree';
    if (roll < 0.8) return 'rock';
    return 'log';
  }

  if (roll < 0.55) return 'rock';
  if (roll < 0.85) return 'log';
  return 'tree';
}

function buildMedals(length: number): MedalTargets {
  const gold = round1(length / 18.5);
  return {
    gold,
    silver: round1(gold * 1.14),
    bronze: round1(gold * 1.3),
  };
}

function sampleDense(
  raw: readonly RawPoint[],
  s: number,
): { x: number; z: number; rightX: number; rightZ: number } {
  let low = 0;
  let high = raw.length - 1;

  if (s <= 0) {
    low = 0;
    high = 1;
  } else if (s >= raw[high].s) {
    low = Math.max(0, high - 1);
  } else {
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (raw[middle].s < s) {
        low = middle;
      } else {
        high = middle;
      }
    }
  }

  const a = raw[low];
  const b = raw[Math.min(low + 1, raw.length - 1)];
  const span = b.s - a.s;
  const t = span > 1e-9 ? clamp((s - a.s) / span, 0, 1) : 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const horizontal = Math.hypot(dx, dz) || 1;

  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    rightX: dz / horizontal,
    rightZ: -dx / horizontal,
  };
}

/**
 * Valida uma pista procedural usando o mesmo sampler do jogo.
 *
 * Erros impedem o uso da pista; avisos indicam algo fora do ideal, mas que
 * ainda não quebra o `TrackDef`.
 */
export function validateProceduralTrack(
  def: TrackDef,
  options: ValidateOptions = {},
): ProceduralValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = limitsFor(options.profile ?? 'v5');
  const layout = layoutByDef.get(def) ?? null;
  const track = makeTrack(def, options.quiet === true);
  const length = track.length;
  // O perfil v5 valida a largura autorada antes do clamp de segurança do
  // `Track` (7–14 m). O legado continua usando a largura efetiva do sampler.
  const widthAt = layout?.widthAt ?? ((s: number) => track.widthAt(s));

  const fail = (message: string): void => {
    errors.push(message);
  };
  const warn = (message: string): void => {
    warnings.push(message);
  };

  if (length < limits.minLength || length > limits.maxLength) {
    fail(
      `comprimento ${length.toFixed(1)} m fora de ` +
        `${limits.minLength}..${limits.maxLength} m`,
    );
  }

  validateZones(track, def, length, limits, fail);
  validateSplits(def, length, fail);

  let minWidth = Infinity;
  let maxWidth = -Infinity;
  for (let s = 0; s <= length; s += 2) {
    const width = widthAt(s);
    minWidth = Math.min(minWidth, width);
    maxWidth = Math.max(maxWidth, width);
  }
  if (minWidth < limits.minWidth - 0.01) {
    fail(`largura mínima ${minWidth.toFixed(2)} m < ${limits.minWidth} m`);
  }
  if (maxWidth > limits.maxWidth + 0.01) {
    fail(`largura máxima ${maxWidth.toFixed(2)} m > ${limits.maxWidth} m`);
  }

  const samples = collectSamples(track, length);
  const radius = computeRadius(samples);
  if (radius.minRadius < limits.minRadiusPass) {
    fail(
      `raio mínimo ${radius.minRadius.toFixed(1)} m ` +
        `(< ${limits.minRadiusPass} m) ` +
        `em s=${radius.minRadiusS.toFixed(0)} m`,
    );
  } else if (radius.minRadius < limits.minRadiusWarn) {
    warn(
      `raio mínimo ${radius.minRadius.toFixed(1)} m ` +
        `(< ${limits.minRadiusWarn} m)`,
    );
  }

  const intersection = findSelfIntersection(samples);
  if (intersection) {
    fail(
      `autointerseção entre s=${intersection.a.toFixed(0)} m e ` +
        `s=${intersection.b.toFixed(0)} m`,
    );
  }

  const grade = computeMaxGrade(track, samples, def.kickers);
  if (grade > MAX_GRADE_PASS) {
    fail(`grade máxima ${grade.toFixed(3)} > ${MAX_GRADE_PASS}`);
  }

  validateKickers(track, def, length, fail, warn);
  validatePowerups(def, length, widthAt, limits, fail);
  validateObstacles(def, length, widthAt, limits, fail);
  validateLayoutFeatures(layout, fail);

  const startSample = track.sampleAt(0);
  const startX = startSample.position.x;
  const startZ = startSample.position.z;
  const finishSample = track.sampleAt(length);
  const startToFinish = Math.hypot(
    startX - finishSample.position.x,
    startZ - finishSample.position.z,
  );
  if (startToFinish < MIN_START_TO_FINISH) {
    fail(
      `largada e chegada muito próximas (${startToFinish.toFixed(1)} m); ` +
        `a pista A→B precisa de pelo menos ${MIN_START_TO_FINISH} m`,
    );
  }

  const tooClose = findTooCloseSections(samples, limits.sectionClearance);
  if (tooClose && tooClose.distance < limits.sectionClearance) {
    fail(
      `trechos não vizinhos a ${tooClose.distance.toFixed(1)} m ` +
        `(mínimo ${limits.sectionClearance} m, entre s=${tooClose.a.toFixed(0)} m ` +
        `e s=${tooClose.b.toFixed(0)} m)`,
    );
  }

  let bboxMinX = Infinity;
  let bboxMaxX = -Infinity;
  let bboxMinZ = Infinity;
  let bboxMaxZ = -Infinity;
  for (const sample of samples) {
    bboxMinX = Math.min(bboxMinX, sample.x);
    bboxMaxX = Math.max(bboxMaxX, sample.x);
    bboxMinZ = Math.min(bboxMinZ, sample.z);
    bboxMaxZ = Math.max(bboxMaxZ, sample.z);
  }
  const bboxWidth = bboxMaxX - bboxMinX;
  const bboxHeight = bboxMaxZ - bboxMinZ;

  if (!(def.medals.gold < def.medals.silver && def.medals.silver < def.medals.bronze)) {
    fail('medalhas fora de ordem (gold < silver < bronze)');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      length,
      points: def.points.length,
      zones: def.zones.length,
      minRadius: radius.minRadius,
      minRadiusS: radius.minRadiusS,
      minWidth,
      maxWidth,
      maxGrade: grade,
      obstacles: def.obstacles.length,
      powerups: def.powerups.length,
      kickers: def.kickers.length,
      splits: def.splits.length,
      startToFinish,
      bboxWidth,
      bboxHeight,
      minSectionDistance: tooClose ? tooClose.distance : Infinity,
      flatFraction: layout?.flatFraction ?? 0,
      features: buildFeatures(layout),
    },
  };
}

function validateLayoutFeatures(
  layout: ProceduralLayout | null,
  fail: (message: string) => void,
): void {
  if (!layout) {
    return;
  }

  const categories = new Map<CurveCategory, number>();
  let leftSweep = 0;
  let rightSweep = 0;
  let run = 0;
  let lastDirection: CurveDirection | null = null;

  for (const curve of layout.curves) {
    categories.set(curve.category, (categories.get(curve.category) ?? 0) + 1);
    if (curve.direction === 'left') {
      leftSweep += curve.sweepDeg;
    } else {
      rightSweep += curve.sweepDeg;
    }
    if (curve.direction === lastDirection) {
      run += 1;
      if (run > 2) {
        fail('mais de duas curvas seguidas no mesmo sentido');
      }
    } else {
      run = 1;
      lastDirection = curve.direction;
    }
  }

  if (categories.size < 4) {
    fail(`apenas ${categories.size} categorias de curva (mínimo 4)`);
  }
  const kinks = categories.get('kink') ?? 0;
  if (kinks < 1 || kinks > 3) {
    fail(`kinks: ${kinks} (esperado 1..3)`);
  }
  const totalSweep = leftSweep + rightSweep;
  if (
    totalSweep > 0 &&
    (leftSweep / totalSweep < 0.3 || rightSweep / totalSweep < 0.3)
  ) {
    fail('sweep concentrado em um único sentido (<30% para o outro)');
  }

  const features = layout.widthFeatures ?? [];
  const chokes = features.filter((feature) => feature.kind === 'choke');
  if (chokes.length < 2 || chokes.length > 3) {
    fail(`chokes: ${chokes.length} (esperado 2..3)`);
  }
  if (!features.some((feature) => feature.kind === 'narrow')) {
    fail('faltou trecho longo estreito');
  }
  const wide = features.filter((feature) => feature.kind === 'wide').length;
  if (wide < 1 || wide > 2) {
    fail(`trechos largos: ${wide} (esperado 1..2)`);
  }

  for (const choke of chokes) {
    for (const curve of layout.curves) {
      if (curve.category !== 'hairpin' && curve.category !== 'elbow') {
        continue;
      }
      if (choke.startS < curve.endS && choke.endS > curve.startS) {
        fail('choke dentro de hairpin/cotovelo');
      }
    }
  }

  const flatFraction = layout.flatFraction ?? 0;
  if (flatFraction > 0 && (flatFraction < 0.195 || flatFraction > 0.255)) {
    fail(
      `faixas planas cobrem ${(flatFraction * 100).toFixed(1)}% ` +
        `(esperado 20..25%)`,
    );
  }
}

function buildFeatures(layout: ProceduralLayout | null): ProceduralFeatures | null {
  if (!layout) {
    return null;
  }

  const categories = Object.fromEntries(
    CURVE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<CurveCategory, number>;
  let leftSweepDeg = 0;
  let rightSweepDeg = 0;

  for (const curve of layout.curves) {
    categories[curve.category] += 1;
    if (curve.direction === 'left') {
      leftSweepDeg += curve.sweepDeg;
    } else {
      rightSweepDeg += curve.sweepDeg;
    }
  }

  const features = layout.widthFeatures ?? [];
  return {
    categories,
    leftSweepDeg,
    rightSweepDeg,
    chokes: features.filter((feature) => feature.kind === 'choke').length,
    longNarrow: features.filter((feature) => feature.kind === 'narrow').length,
    wide: features.filter((feature) => feature.kind === 'wide').length,
  };
}

function makeTrack(def: TrackDef, quiet: boolean): Track {
  if (!quiet) {
    return new Track(def);
  }

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

function validateZones(
  track: Track,
  def: TrackDef,
  length: number,
  limits: ProfileLimits,
  fail: (message: string) => void,
): void {
  if (def.zones.length !== 4) {
    fail(`esperadas 4 zonas, encontradas ${def.zones.length}`);
    return;
  }

  for (let i = 0; i < def.zones.length; i += 1) {
    const zone = def.zones[i];
    const expectedId: TrackZoneId = i % 2 === 0 ? 'forest' : 'desert';
    const expectedSurface = expectedId === 'forest' ? 'gravel' : 'sand';
    const zoneLength = zone.end - zone.start;

    if (zone.id !== expectedId) {
      fail(`zona ${i + 1} deveria ser ${expectedId}, veio ${zone.id}`);
    }
    if (zone.surface !== expectedSurface) {
      fail(`superfície da zona ${i + 1} incompatível com ${zone.id}`);
    }
    if (zoneLength < limits.minZoneLength || zoneLength > limits.maxZoneLength) {
      fail(
        `zona ${i + 1} tem ${zoneLength.toFixed(1)} m ` +
          `(esperado ${limits.minZoneLength}..${limits.maxZoneLength} m)`,
      );
    }
    if (Math.abs(zone.start - (i === 0 ? 0 : def.zones[i - 1].end)) > 0.5) {
      fail(`zona ${i + 1} não começa onde a anterior termina`);
    }
    if (i === def.zones.length - 1 && Math.abs(zone.end - length) > 1) {
      fail(`última zona termina em ${zone.end.toFixed(1)}, pista tem ${length.toFixed(1)}`);
    }
  }

  const zoneAtStart = track.zoneAt(0);
  if (zoneAtStart !== 'forest') {
    fail('a primeira zona deveria ser floresta');
  }
}

function validateSplits(
  def: TrackDef,
  length: number,
  fail: (message: string) => void,
): void {
  if (def.splits.length !== 3) {
    fail(`esperadas 3 parciais, encontradas ${def.splits.length}`);
    return;
  }

  for (let i = 0; i < def.splits.length; i += 1) {
    const split = def.splits[i];
    const expected = def.zones[i + 1]?.start;
    if (expected === undefined || Math.abs(split.s - expected) > 1) {
      fail(`parcial ${i + 1} fora do limite de setor`);
    }
    if (split.s <= 0 || split.s >= length) {
      fail(`parcial ${i + 1} fora da pista`);
    }
    if (!(split.target > 0)) {
      fail(`parcial ${i + 1} sem tempo-alvo`);
    }
    if (i > 0 && split.s <= def.splits[i - 1].s) {
      fail('parciais fora de ordem');
    }
  }
}

interface TrackSampleSummary {
  readonly s: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
}

function collectSamples(track: Track, length: number): readonly TrackSampleSummary[] {
  const step = 1;
  const count = Math.max(2, Math.ceil(length / step));
  const samples: TrackSampleSummary[] = [];

  for (let i = 0; i <= count; i += 1) {
    const s = (i / count) * length;
    const sample = track.sampleAt(s);
    samples.push({
      s,
      x: sample.position.x,
      z: sample.position.z,
      width: sample.width,
    });
  }

  return samples;
}

function computeRadius(samples: readonly TrackSampleSummary[]): {
  minRadius: number;
  minRadiusS: number;
} {
  let minRadius = Infinity;
  let minRadiusS = 0;
  const window = 3;

  for (let i = window; i < samples.length - window; i += 1) {
    const radius = circumradius(
      samples[i - window],
      samples[i],
      samples[i + window],
    );
    if (radius < minRadius) {
      minRadius = radius;
      minRadiusS = samples[i].s;
    }
  }

  return { minRadius, minRadiusS };
}

function circumradius(
  a: TrackSampleSummary,
  b: TrackSampleSummary,
  c: TrackSampleSummary,
): number {
  const ab = Math.hypot(a.x - b.x, a.z - b.z);
  const bc = Math.hypot(b.x - c.x, b.z - c.z);
  const ca = Math.hypot(c.x - a.x, c.z - a.z);
  const doubleArea = Math.abs(
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
  );

  if (doubleArea < 1e-7) {
    return Infinity;
  }

  return (ab * bc * ca) / (2 * doubleArea);
}

function findSelfIntersection(
  samples: readonly TrackSampleSummary[],
): { a: number; b: number } | null {
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a0 = samples[i];
    const a1 = samples[i + 1];

    for (let j = i + 1; j < samples.length - 1; j += 1) {
      const b0 = samples[j];
      const b1 = samples[j + 1];

      if (Math.abs(a0.s - b0.s) < SELF_INTERSECTION_WINDOW) {
        continue;
      }

      if (segmentsIntersect(a0, a1, b0, b1)) {
        return { a: a0.s, b: b0.s };
      }
    }
  }

  return null;
}

function findTooCloseSections(
  samples: readonly TrackSampleSummary[],
  clearance: number,
): { a: number; b: number; distance: number } | null {
  const cell = clearance;
  const cells = new Map<string, number[]>();
  let closest: { a: number; b: number; distance: number } | null = null;

  for (let i = 0; i < samples.length; i += 1) {
    const point = samples[i];
    const cx = Math.floor(point.x / cell);
    const cz = Math.floor(point.z / cell);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = cells.get(`${cx + dx},${cz + dz}`);
        if (!bucket) {
          continue;
        }
        for (const index of bucket) {
          const other = samples[index];
          if (point.s - other.s < SECTION_ALONG_WINDOW) {
            continue;
          }
          const distance = Math.hypot(point.x - other.x, point.z - other.z);
          if (!closest || distance < closest.distance) {
            closest = { a: other.s, b: point.s, distance };
          }
        }
      }
    }

    const key = `${cx},${cz}`;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      cells.set(key, [i]);
    }
  }

  return closest;
}

function segmentsIntersect(
  a0: TrackSampleSummary,
  a1: TrackSampleSummary,
  b0: TrackSampleSummary,
  b1: TrackSampleSummary,
): boolean {
  const denominator =
    (a1.x - a0.x) * (b1.z - b0.z) - (a1.z - a0.z) * (b1.x - b0.x);
  if (Math.abs(denominator) < 1e-9) {
    return false;
  }

  const t =
    ((b0.x - a0.x) * (b1.z - b0.z) - (b0.z - a0.z) * (b1.x - b0.x)) /
    denominator;
  const u =
    ((b0.x - a0.x) * (a1.z - a0.z) - (b0.z - a0.z) * (a1.x - a0.x)) /
    denominator;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function computeMaxGrade(
  track: Track,
  samples: readonly TrackSampleSummary[],
  kickers: readonly TrackKicker[],
): number {
  let maximum = 0;
  const window = 2;

  for (let i = window; i < samples.length - window; i += 1) {
    const s = samples[i].s;
    if (
      kickers.some(
        (kicker) => s > kicker.s - 2 && s < kicker.s + kicker.length + 2,
      )
    ) {
      continue;
    }

    const a = samples[i - window];
    const b = samples[i + window];
    const run = b.s - a.s;
    if (run <= 0) {
      continue;
    }
    const grade = Math.abs(
      track.heightAt(b.s, 0) - track.heightAt(a.s, 0),
    ) / run;
    maximum = Math.max(maximum, grade);
  }

  return maximum;
}

function validateKickers(
  track: Track,
  def: TrackDef,
  length: number,
  fail: (message: string) => void,
  warn: (message: string) => void,
): void {
  if (def.kickers.length < 1 || def.kickers.length > 2) {
    fail(`esperados 1..2 kickers, encontrados ${def.kickers.length}`);
  }

  for (let i = 0; i < def.kickers.length; i += 1) {
    const kicker = def.kickers[i];

    if (kicker.length < 6 - 0.01 || kicker.length > 7 + 0.01) {
      fail(`kicker ${i + 1} com comprimento ${kicker.length.toFixed(2)} m`);
    }
    if (kicker.height < 1 - 0.01 || kicker.height > 1.5 + 0.01) {
      fail(`kicker ${i + 1} com altura ${kicker.height.toFixed(2)} m`);
    }
    if (kicker.s < 10) {
      fail(`kicker ${i + 1} começa em s=${kicker.s.toFixed(1)} m`);
    }
    if (kicker.s + kicker.length + KICKER_LANDING > length) {
      fail(`kicker ${i + 1} não tem ${KICKER_LANDING} m de pouso`);
    }
    if (i > 0 && kicker.s - (def.kickers[i - 1].s + def.kickers[i - 1].length) < 40) {
      fail('kickers muito próximos');
    }

    const entry = track.sampleAt(kicker.s);
    const entryHeading = Math.atan2(entry.tangent.x, entry.tangent.z);
    let maximumDeviation = 0;
    const end = kicker.s + kicker.length + KICKER_LANDING;

    for (let s = kicker.s; s <= Math.min(end, length); s += 1) {
      const sample = track.sampleAt(s);
      const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
      maximumDeviation = Math.max(
        maximumDeviation,
        Math.abs(shortestAngle(entryHeading, heading)),
      );
    }

    if (maximumDeviation > KICKER_MAX_DEVIATION) {
      fail(
        `kicker ${i + 1} fora de trecho reto: desvio ` +
          `${maximumDeviation.toFixed(2)} rad`,
      );
    } else if (maximumDeviation > 0.12) {
      warn(
        `kicker ${i + 1} com desvio de ${maximumDeviation.toFixed(2)} rad`,
      );
    }
  }
}

function validatePowerups(
  def: TrackDef,
  length: number,
  widthAt: (s: number) => number,
  limits: ProfileLimits,
  fail: (message: string) => void,
): void {
  if (
    def.powerups.length < limits.minPowerups ||
    def.powerups.length > limits.maxPowerups
  ) {
    fail(
      `esperados ${limits.minPowerups}..${limits.maxPowerups} powerups, ` +
        `encontrados ${def.powerups.length}`,
    );
  }

  const types = new Set<PowerupType>();

  for (let i = 0; i < def.powerups.length; i += 1) {
    const powerup = def.powerups[i];
    types.add(powerup.type);

    if (powerup.s < 5 || powerup.s > length - 10) {
      fail(`powerup ${i + 1} fora da pista (s=${powerup.s.toFixed(1)})`);
    }
    const halfWidth = widthAt(powerup.s) * 0.5;
    if (Math.abs(powerup.u) > halfWidth - POWERUP_MIN_CLEARANCE + 0.001) {
      fail(
        `powerup ${i + 1} fora da pista (u=${powerup.u.toFixed(1)}, ` +
          `meia-largura=${halfWidth.toFixed(1)})`,
      );
    }
    if (powerup.type !== 'turbo' && powerup.type !== 'grip') {
      fail(`powerup ${i + 1} com tipo inválido`);
    }
  }

  if (types.size < 2) {
    fail('faltou variar os powerups (turbo e grip)');
  }
}

function validateObstacles(
  def: TrackDef,
  length: number,
  widthAt: (s: number) => number,
  limits: ProfileLimits,
  fail: (message: string) => void,
): void {
  if (
    def.obstacles.length < limits.minObstacles ||
    def.obstacles.length > limits.maxObstacles
  ) {
    fail(
      `esperados ${limits.minObstacles}..${limits.maxObstacles} obstáculos, ` +
        `encontrados ${def.obstacles.length}`,
    );
  }

  for (let i = 0; i < def.obstacles.length; i += 1) {
    const obstacle = def.obstacles[i];
    if (obstacle.s < 0 || obstacle.s > length) {
      fail(`obstáculo ${i + 1} fora do intervalo da pista`);
      continue;
    }
    if (!(obstacle.radius > 0)) {
      fail(`obstáculo ${i + 1} sem raio`);
    }
    if (
      obstacle.type !== 'rock' &&
      obstacle.type !== 'tree' &&
      obstacle.type !== 'log'
    ) {
      fail(`obstáculo ${i + 1} com tipo inválido`);
    }

    const halfWidth = widthAt(obstacle.s) * 0.5;
    if (Math.abs(obstacle.u) < halfWidth + OBSTACLE_EDGE_CLEARANCE - 0.01) {
      fail(
        `obstáculo ${i + 1} a menos de ${OBSTACLE_EDGE_CLEARANCE} m da borda ` +
          `(u=${obstacle.u.toFixed(1)}, meia-largura=${halfWidth.toFixed(1)})`,
      );
    }
  }
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from + Math.PI) % TAU;
  if (delta < 0) {
    delta += TAU;
  }
  return delta - Math.PI;
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
