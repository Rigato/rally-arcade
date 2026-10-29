/**
 * Gerador procedural de pistas do Rally Arcade.
 *
 * O gerador atual (`generateProceduralTrack`) usa uma gramática de segmentos:
 * retas curtas/médias/longas alternadas com curvas de sete categorias
 * (longa, média, curta, cotovelo, hairpin, hairpin extremo e kink), em ambos
 * os sentidos. Toda pista recebe exatamente um hairpin extremo de 13–14 m de
 * raio, precedido por 45–60 m de reta e seguido por ≥35 m, com largura local
 * de 5,2–6,2 m. O traçado é um caminho aberto A→B, sem pernas paralelas fixas.
 * Cada candidato passa por um teste de separação entre trechos não vizinhos
 * (spatial hash, ≥40 m entre centros; as duas pernas de um hairpin extremo são
 * isentas a partir de 26 m), caixa de ~650×650 m e chegada a ≥100 m da largada.
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
  ScenarioId,
  TrackDef,
  TrackFork,
  TrackForkBranch,
  TrackHazard,
  TrackKicker,
  TrackObstacle,
  TrackPoint,
  TrackPowerup,
  TrackSplit,
  TrackZone,
} from '../../game/types';
import { SCENARIOS, SCENARIO_IDS } from '../../game/scenarios';
import { FORK_TUNING, HAZARD_TUNING } from '../../game/config';
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
const MIN_RADIUS_PASS = 8;
const MIN_RADIUS_WARN = 10;

/**
 * Hairpin extremo: mais fechado que o normal (20–23 m). O raio fica em
 * 13–14 m para que as pernas de retorno fiquem a ~26–28 m; os ombros visuais
 * de 12 m por lado passam a se sobrepor em parte do arco, o que o teste visual
 * aceita como apron contínuo (o usuário pediu o hairpin mais fechado).
 */
const EXTREME_MIN_RADIUS = 13;
const EXTREME_MAX_RADIUS = 14;
const EXTREME_MIN_SWEEP = Math.PI * (170 / 180);
const EXTREME_MAX_SWEEP = Math.PI * (185 / 180);
const EXTREME_APPROACH_MIN = 45;
const EXTREME_APPROACH_MAX = 60;
const EXTREME_EXIT_MIN = 35;
const EXTREME_EXIT_MAX = 60;
const EXTREME_START_FINISH_CLEARANCE = 80;
/** Separação aceitável entre as duas pernas de um hairpin extremo. */
const EXTREME_LEG_CLEARANCE = 24;
const EXTREME_WIDTH_RANGE: [number, number] = [5.2, 6.2];
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
  | 'hairpin-extreme'
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
  /** Bifurcações geradas (ramos que saem e voltam à pista principal). */
  readonly forks?: readonly TrackFork[];
  /** Obstáculos móveis gerados para a corrida. */
  readonly hazards?: readonly TrackHazard[];
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
  /** Quantidade de bifurcações (ramos alternativos). */
  readonly forks?: number;
  /** Quantidade de obstáculos móveis. */
  readonly hazards?: number;
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
  length: number;
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
  'hairpin-extreme',
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
  'hairpin-extreme': {
    radius: [EXTREME_MIN_RADIUS, EXTREME_MAX_RADIUS],
    sweep: [EXTREME_MIN_SWEEP, EXTREME_MAX_SWEEP],
  },
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

  // Pernas do hairpin extremo (uma de cada lado da curva) podem ficar a
  // 26–28 m: é o próprio formato do hairpin, não uma seção cruzando outra.
  const extremeRanges = built
    .filter(
      (segment) =>
        segment.kind === 'curve' && segment.category === 'hairpin-extreme',
    )
    .map((segment) => ({ startS: segment.startS, endS: segment.endS }));

  // Rejeita trechos que passam perto demais de outros trechos não vizinhos.
  const clearance = minSectionDistance(raw, extremeRanges);
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
  // Mantém o ouro na faixa física aprovada (45,2–48,3 s) em todas as pistas
  // aleatórias: 1517 m → 45,2 s; 1626 m → 48,3 s.
  if (length < 1517 || length > 1626) {
    return null;
  }
  const scale = length / total;

  const medals = buildMedalsV5(length);
  const splitsAndZones = buildZonesAndSplitsV5(rng, length, medals.gold);
  const forks = buildForks(
    rng,
    controlPoints,
    curves,
    splitsAndZones.zones,
    length,
  );

  const kickers = placeKickersOnStraights(
    rng,
    straights,
    curves,
    length,
    scale,
    forks,
  );
  if (kickers.length === 0) {
    return null;
  }
  const hazards = buildHazards(
    rng,
    splitsAndZones.zones,
    length,
    kickers,
    curves,
    forks,
  );
  const powerups = placePowerupsOnTrack(
    rng,
    raw,
    widthAt,
    kickers,
    length,
    scale,
  );
  const obstacles = placeObstaclesOffTrack(
    rng,
    raw,
    widthAt,
    splitsAndZones.zones,
    length,
    scale,
  );
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
    medals,
    forks,
    hazards,
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
    forks,
    hazards,
  });

  return def;
}

function planSegments(rng: Rng): readonly SegmentSpec[] | null {
  const target = rng.range(1490, 1600);
  const segments: SegmentSpec[] = [];
  const featureStraight = rng.int(2, 7);
  const planHairpins = rng.int(0, 1);
  const planKinks = rng.int(1, 3);
  const categoryCounts = new Map<CurveCategory, number>();
  let turnBalance = 0;
  let totalTurn = 0;
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
    turnBalance += turn * sweep;
    totalTurn += sweep;
  }

  const finalLength = clamp(target + 25 - total, 40, 96);
  segments.push({ kind: 'straight', length: finalLength });
  total += finalLength;

  if (curveCount < 10 || straightIndex < 8) {
    return null;
  }

  if (!insertExtremeHairpin(rng, segments)) {
    return null;
  }

  // Recalcula depois do hairpin extremo (que entra no meio da lista).
  const curves = segments.filter(
    (segment): segment is CurveSpec => segment.kind === 'curve',
  );
  const straights = segments.filter(
    (segment): segment is StraightSpec => segment.kind === 'straight',
  );
  if (curves.length < 11 || straights.length < 9) {
    return null;
  }

  // Pelo menos 4 das 7 categorias em cada pista.
  const categoriesPresent = new Set(curves.map((curve) => curve.category));
  if (categoriesPresent.size < 4) {
    return null;
  }
  if (!categoriesPresent.has('kink')) {
    return null;
  }
  const extremeCount = curves.filter(
    (curve) => curve.category === 'hairpin-extreme',
  ).length;
  const hairpinCount = curves.filter(
    (curve) => curve.category === 'hairpin',
  ).length;
  if (extremeCount !== 1 || hairpinCount > 1) {
    return null;
  }

  // Curvas para os dois lados e sem sequência totalmente unilateral.
  let leftCount = 0;
  let rightCount = 0;
  let leftTurnTotal = 0;
  let rightTurnTotal = 0;
  for (const curve of curves) {
    if (curve.turn > 0) {
      rightCount += 1;
      rightTurnTotal += curve.sweep;
    } else {
      leftCount += 1;
      leftTurnTotal += curve.sweep;
    }
  }
  if (leftCount < 2 || rightCount < 2) {
    return null;
  }
  const totalCurveTurn = leftTurnTotal + rightTurnTotal;
  if (totalCurveTurn > 0) {
    if (
      leftTurnTotal / totalCurveTurn < 0.3 ||
      rightTurnTotal / totalCurveTurn < 0.3
    ) {
      return null;
    }
  }

  return segments;
}

/**
 * Insere o hairpin extremo no meio de uma reta já planejada, com retas
 * próprias de aproximação (45–60 m) e saída (35–60 m). Como essas retas têm
 * menos de 70 m, o planejador de rampas nunca coloca um kicker nelas.
 */
function insertExtremeHairpin(rng: Rng, segments: SegmentSpec[]): boolean {
  const approach = rng.range(EXTREME_APPROACH_MIN, EXTREME_APPROACH_MAX);
  const exit = rng.range(EXTREME_EXIT_MIN, EXTREME_EXIT_MAX);
  const radius = rng.range(EXTREME_MIN_RADIUS, EXTREME_MAX_RADIUS);
  const sweep = rng.range(EXTREME_MIN_SWEEP, EXTREME_MAX_SWEEP);
  const arc = radius * sweep;

  let total = 0;
  for (const segment of segments) {
    total +=
      segment.kind === 'straight'
        ? segment.length
        : segment.radius * segment.sweep;
  }

  const candidates: number[] = [];
  let prefix = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'straight') {
      const newTotal = total - segment.length + approach + arc + exit;
      const extremeStart = prefix + approach;
      const extremeEnd = extremeStart + arc;
      if (
        extremeStart >= EXTREME_START_FINISH_CLEARANCE + 10 &&
        newTotal - extremeEnd >= EXTREME_START_FINISH_CLEARANCE + 10 &&
        newTotal <= MAX_LENGTH - 30 &&
        prefix > 0
      ) {
        candidates.push(index);
      }
    }
    prefix +=
      segment.kind === 'straight' ? segment.length : segment.radius * segment.sweep;
  }

  if (candidates.length === 0) {
    return false;
  }

  const index = rng.pick(candidates);
  const before = segments[index - 1];
  const after = segments[index + 1];
  const beforeTurn = before?.kind === 'curve' ? before.turn : null;
  const afterTurn = after?.kind === 'curve' ? after.turn : null;
  let turn: 1 | -1 = rng.sign() as 1 | -1;
  if (beforeTurn === turn && afterTurn === turn) {
    turn = turn === 1 ? -1 : 1;
  }

  segments.splice(
    index,
    1,
    { kind: 'straight', length: approach },
    { kind: 'curve', category: 'hairpin-extreme', radius, sweep, turn },
    { kind: 'straight', length: exit },
  );

  // Reequilibra as demais retas para o comprimento planejado não crescer
  // ~100 m com o bloco novo (mantém as pistas em 1518–1626 m).
  const otherStraights = segments
    .map((segment, segmentIndex) => ({ segment, segmentIndex }))
    .filter(
      ({ segment, segmentIndex }) =>
        segment.kind === 'straight' &&
        segmentIndex !== index &&
        segmentIndex !== index + 2,
    )
    .map(({ segment }) => segment as StraightSpec);
  const sumOthers = otherStraights.reduce(
    (sum, segment) => sum + segment.length,
    0,
  );
  const curveSum = segments
    .filter(
      (segment): segment is CurveSpec => segment.kind === 'curve',
    )
    .reduce((sum, curve) => sum + curve.radius * curve.sweep, 0);
  const wantedOthers = total - curveSum - approach - exit;
  if (sumOthers <= 0 || wantedOthers <= 0) {
    return false;
  }
  const factor = clamp(wantedOthers / sumOthers, 0.5, 1.2);
  if (Math.abs(factor - 1) > 0.001) {
    for (const straight of otherStraights) {
      straight.length = clamp(straight.length * factor, 22, 110);
    }
  }

  // Recalcula posição do extremo e garante os 80 m de folga nas pontas.
  let prefix2 = 0;
  let extremeStart = 0;
  let extremeEnd = 0;
  let newTotal = 0;
  for (const segment of segments) {
    const segmentLength =
      segment.kind === 'straight' ? segment.length : segment.radius * segment.sweep;
    if (segment.kind === 'curve' && segment.category === 'hairpin-extreme') {
      extremeStart = prefix2;
      extremeEnd = prefix2 + segmentLength;
    }
    prefix2 += segmentLength;
  }
  newTotal = prefix2;
  if (
    extremeStart < EXTREME_START_FINISH_CLEARANCE ||
    newTotal - extremeEnd < EXTREME_START_FINISH_CLEARANCE
  ) {
    return false;
  }

  return true;
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
 *
 * Pares que cruzam um hairpin extremo (uma perna de cada lado da curva) são
 * aceitos a partir de `EXTREME_LEG_CLEARANCE`, pois a proximidade é inerente
 * ao formato de 180°.
 */
function minSectionDistance(
  raw: readonly RawPoint[],
  extremeRanges: readonly { startS: number; endS: number }[],
): number {
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
            if (
              distance >= EXTREME_LEG_CLEARANCE &&
              straddlesExtremeHairpin(other.s, point.s, extremeRanges)
            ) {
              continue;
            }
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

/** `true` quando o intervalo [fromS, toS] contém um hairpin extremo inteiro. */
function straddlesExtremeHairpin(
  fromS: number,
  toS: number,
  extremeRanges: readonly { startS: number; endS: number }[],
): boolean {
  return extremeRanges.some(
    (range) => fromS < range.startS && toS > range.endS,
  );
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
  const extremeEvents: WidthEvent[] = [];
  const extremeCurves = curves.filter(
    (curve) => curve.category === 'hairpin-extreme',
  );
  const tightCurves = curves.filter(
    (curve) =>
      curve.category === 'hairpin' ||
      curve.category === 'hairpin-extreme' ||
      curve.category === 'elbow',
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
    // O hairpin extremo tem largura própria (5,2–6,2 m) e não recebe choke,
    // trecho estreito nem largo por cima.
    for (const curve of extremeCurves) {
      if (
        center + half + transition > curve.startS - 6 &&
        center - half - transition < curve.endS + 6
      ) {
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

  for (const curve of extremeCurves) {
    const half = (curve.endS - curve.startS) * 0.5;
    extremeEvents.push({
      startS: curve.startS,
      endS: curve.endS,
      center: curve.startS + half,
      half,
      width: rng.range(EXTREME_WIDTH_RANGE[0], EXTREME_WIDTH_RANGE[1]),
      transition: 22,
      kind: 'narrow',
    });
  }

  events.sort((a, b) => a.center - b.center);

  const widthAt = (s: number): number => {
    let width = base + 0.35 * Math.sin(s * 0.007 + basePhase);

    for (const event of [...events, ...extremeEvents]) {
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

/** Janela (m de pista principal) em que a bifurcação pode começar/terminar. */
const FORK_MIN_SPAN = 150;
const FORK_MAX_SPAN = 260;
const FORK_MIN_START = 130;
const FORK_END_MARGIN = 110;
/** Amplitude lateral (m) do afastamento do ramo em relação à borda. */
const FORK_MIN_AMPLITUDE = 28;
const FORK_MAX_AMPLITUDE = 48;
/** Amplitude vertical (m) do sobe-e-desce do ramo. */
const FORK_MIN_HEIGHT = 1;
const FORK_MAX_HEIGHT = 3;
/** Largura nominal (m) do ramo. */
const FORK_MIN_WIDTH = 6;
const FORK_MAX_WIDTH = 8;
/** Sobreposição (m) entre a borda do ramo e a borda da pista principal. */
const FORK_EDGE_OVERLAP = 0.35;
/** Fator de largura do ramo: 0,97 ± 0,05 (mínimo 5,52 m em 6,0 m). */
const FORK_WIDTH_BASE = 0.97;
const FORK_WIDTH_SWING = 0.05;

interface ForkCandidate {
  startIndex: number;
  endIndex: number;
  startS: number;
  endS: number;
  score: number;
}

/**
 * Cria 1–2 bifurcações em trechos longos e pouco curvados.
 *
 * O ramo é um mini traçado independente: começa e termina na borda da pista
 * principal (centro deslocado por `mainHalf + branchHalf - 0,35`) e se afasta
 * com um perfil de sino `0,5 - 0,5·cos(2πt)`, cuja derivada é zero nas pontas.
 * Assim ele não sobrepõe a pista no início/fim nem cria rampa de entrada/saída.
 * A pista principal continua existindo como a outra opção.
 */
function buildForks(
  rng: Rng,
  points: readonly TrackPoint[],
  curves: readonly ProceduralCurveInfo[],
  zones: readonly TrackZone[],
  length: number,
): readonly TrackFork[] {
  if (points.length < 20 || length < 400) {
    return [];
  }

  const sValues = cumulativePointLengths(points);
  const extremeRanges = curves
    .filter((curve) => curve.category === 'hairpin-extreme')
    .map((curve) => ({ startS: curve.startS, endS: curve.endS }));

  const collect = (minRatio: number, maxTurn: number): ForkCandidate[] => {
    const candidates: ForkCandidate[] = [];

    for (let startIndex = 2; startIndex < points.length - 8; startIndex += 1) {
      const startS = sValues[startIndex];
      if (startS < FORK_MIN_START) {
        continue;
      }

      for (
        let endIndex = startIndex + 8;
        endIndex < points.length - 2;
        endIndex += 1
      ) {
        const endS = sValues[endIndex];
        const span = endS - startS;
        if (span < FORK_MIN_SPAN) {
          continue;
        }
        if (span > FORK_MAX_SPAN) {
          break;
        }
        if (endS > length - FORK_END_MARGIN) {
          break;
        }

        if (
          extremeRanges.some(
            (range) =>
              endS > range.startS - 35 && startS < range.endS + 35,
          )
        ) {
          continue;
        }

        // A bifurcação inteira precisa ficar no mesmo setor.
        if (zoneIndexAtS(zones, startS) !== zoneIndexAtS(zones, endS)) {
          continue;
        }

        let pathLength = 0;
        let turn = 0;
        let previousHeading: number | null = null;
        for (let i = startIndex + 1; i <= endIndex; i += 1) {
          const a = points[i - 1];
          const b = points[i];
          pathLength += Math.hypot(b.x - a.x, b.z - a.z);
          const heading = Math.atan2(b.x - a.x, b.z - a.z);
          if (previousHeading !== null) {
            turn += Math.abs(shortestAngle(previousHeading, heading));
          }
          previousHeading = heading;
        }

        const chord = Math.hypot(
          points[endIndex].x - points[startIndex].x,
          points[endIndex].z - points[startIndex].z,
        );
        const ratio = pathLength > 1e-6 ? chord / pathLength : 0;
        if (ratio < minRatio || turn > maxTurn) {
          continue;
        }

        candidates.push({
          startIndex,
          endIndex,
          startS,
          endS,
          score: turn + (1 - ratio) * 4,
        });
        break;
      }
    }

    return candidates;
  };

  let candidates = collect(0.82, (55 * Math.PI) / 180);
  if (candidates.length === 0) {
    candidates = collect(0.68, (90 * Math.PI) / 180);
  }
  if (candidates.length === 0) {
    candidates = collect(0.52, (125 * Math.PI) / 180);
  }
  if (candidates.length === 0) {
    return [];
  }

  const wanted = Math.min(
    rng.chance(0.45) ? 2 : 1,
    FORK_TUNING.maxForks,
  );
  const shuffled = shuffle(candidates, rng).sort((a, b) => a.score - b.score);
  const forks: TrackFork[] = [];

  // Tenta candidatos até conseguir o número desejado; se um lado encostar em
  // outro trecho da pista, tenta o lado oposto antes de descartar o candidato.
  for (const candidate of shuffled) {
    if (forks.length >= wanted) {
      break;
    }
    if (
      forks.some(
        (other) =>
          candidate.startS < other.endS + 60 &&
          candidate.endS > other.startS - 60,
      )
    ) {
      continue;
    }

    const preferredSide = rng.sign() as 1 | -1;
    const amplitude = rng.range(FORK_MIN_AMPLITUDE, FORK_MAX_AMPLITUDE);
    const heightAmplitude = rng.range(FORK_MIN_HEIGHT, FORK_MAX_HEIGHT);
    const nominalWidth = rng.range(FORK_MIN_WIDTH, FORK_MAX_WIDTH);
    const phase = rng.range(0, TAU);
    const phase2 = rng.range(0, TAU);
    const mainHalf =
      Math.max(
        points[candidate.startIndex].width,
        points[candidate.endIndex].width,
      ) * 0.5;
    const edgeOffset = mainHalf + nominalWidth * 0.5 - FORK_EDGE_OVERLAP;

    let branch: TrackForkBranch | null = null;
    const otherSide: 1 | -1 = preferredSide === 1 ? -1 : 1;

    for (const side of [preferredSide, otherSide]) {
      const branchPoints = buildForkBranchPoints(
        points,
        candidate,
        side,
        edgeOffset,
        amplitude,
        heightAmplitude,
        nominalWidth,
        phase,
        phase2,
      );

      const branchLength = measurePoints3d(branchPoints);
      if (branchPoints.length < 6 || branchLength < 70) {
        continue;
      }
      if (
        branchNearMain(
          branchPoints,
          points,
          candidate.startIndex,
          candidate.endIndex,
        )
      ) {
        continue;
      }

      branch = {
        id: `fork-${forks.length + 1}-a`,
        points: branchPoints,
        startS: candidate.startS,
        endS: candidate.endS,
        length: branchLength,
        width: nominalWidth,
        side,
      };
      break;
    }

    if (!branch) {
      continue;
    }

    forks.push({
      id: `fork-${forks.length + 1}`,
      startS: candidate.startS,
      endS: candidate.endS,
      branches: [branch],
    });
  }

  return forks;
}

/** Constrói o traçado do ramo: borda → sino lateral → borda. */
function buildForkBranchPoints(
  points: readonly TrackPoint[],
  candidate: ForkCandidate,
  side: 1 | -1,
  edgeOffset: number,
  amplitude: number,
  heightAmplitude: number,
  nominalWidth: number,
  phase: number,
  phase2: number,
): TrackPoint[] {
  const branchPoints: TrackPoint[] = [];
  const span = Math.max(1, candidate.endIndex - candidate.startIndex);

  for (let i = candidate.startIndex; i <= candidate.endIndex; i += 1) {
    const t = (i - candidate.startIndex) / span;
    const point = points[i];
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    const rightX = dz / horizontal;
    const rightZ = -dx / horizontal;

    // Platô: o ramo corre paralelo/encostado à pista por ~12% do trecho,
    // abre depois e volta a encostar antes do merge. Isso dá tempo para o
    // jogador escolher o lado sem cair no vão interno.
    const ramp = smoothstep(clamp((t - 0.12) / 0.18, 0, 1));
    const fall = smoothstep(clamp((0.88 - t) / 0.18, 0, 1));
    const bell = ramp * fall;
    const wave = 1 + 0.18 * Math.sin(2 * TAU * t + phase);
    const offset = side * (edgeOffset + amplitude * bell * wave);
    const y = point.y + heightAmplitude * bell;
    const width =
      nominalWidth * (FORK_WIDTH_BASE + FORK_WIDTH_SWING * Math.sin(TAU * t + phase2));

    branchPoints.push({
      x: point.x + rightX * offset,
      z: point.z + rightZ * offset,
      y,
      width,
    });
  }

  return branchPoints;
}

function measurePoints3d(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

function branchNearMain(
  branchPoints: readonly TrackPoint[],
  mainPoints: readonly TrackPoint[],
  startIndex: number,
  endIndex: number,
): boolean {
  // Os extremos do ramo ficam deliberadamente na borda da própria
  // bifurcação; a região do fork é ignorada para não rejeitar o próprio
  // começo/fim.
  for (let i = 2; i < branchPoints.length - 2; i += 2) {
    const branchPoint = branchPoints[i];

    for (let j = 0; j < mainPoints.length; j += 2) {
      if (j >= startIndex - 8 && j <= endIndex + 8) {
        continue;
      }

      const mainPoint = mainPoints[j];
      const distance = Math.hypot(
        branchPoint.x - mainPoint.x,
        branchPoint.z - mainPoint.z,
      );
      if (distance < 11) {
        return true;
      }
    }
  }

  return false;
}

function cumulativePointLengths(points: readonly TrackPoint[]): number[] {
  const values = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    values.push(total);
  }
  return values;
}

function zoneIndexAtS(zones: readonly TrackZone[], s: number): number {
  for (let i = 0; i < zones.length; i += 1) {
    if (s >= zones[i].start && s < zones[i].end) {
      return i;
    }
  }
  return Math.max(0, zones.length - 1);
}

const HAZARD_SPEEDS: Record<TrackHazard['kind'], number> = {
  camel: 5.2,
  deer: 7.0,
  reindeer: 6.5,
  car: 10.5,
  truck: 9.5,
  tractor: 6.2,
  cow: 4.8,
  buggy: 9.5,
};

const HAZARD_RADII: Record<TrackHazard['kind'], { radius: number; height: number }> = {
  camel: { radius: 1.3, height: 2.4 },
  deer: { radius: 1.0, height: 1.8 },
  reindeer: { radius: 1.0, height: 1.8 },
  car: { radius: 1.2, height: 1.6 },
  truck: { radius: 1.7, height: 2.6 },
  tractor: { radius: 1.5, height: 2.2 },
  cow: { radius: 1.2, height: 1.7 },
  buggy: { radius: 1.2, height: 1.6 },
};

/**
 * 1–3 obstáculos móveis por pista, com chance por setor e pelo menos um
 * garantido. O posicionamento é deliberadamente aleatório dentro do setor,
 * preservando só a largada/chegada, rampas, hairpin extremo e bifurcações.
 */
function buildHazards(
  rng: Rng,
  zones: readonly TrackZone[],
  length: number,
  kickers: readonly TrackKicker[],
  curves: readonly ProceduralCurveInfo[],
  forks: readonly TrackFork[],
): readonly TrackHazard[] {
  const zoneIndexes = zones
    .map((_, index) => index)
    .filter(() => rng.chance(HAZARD_TUNING.zoneChance));

  if (zoneIndexes.length === 0) {
    zoneIndexes.push(rng.int(0, zones.length - 1));
  }

  shuffle(zoneIndexes, rng);

  while (zoneIndexes.length > HAZARD_TUNING.maxPerRun) {
    zoneIndexes.pop();
  }

  const extremeRanges = curves
    .filter((curve) => curve.category === 'hairpin-extreme')
    .map((curve) => ({ startS: curve.startS, endS: curve.endS }));

  const hazards: TrackHazard[] = [];
  const usedZones = new Set<number>();

  const tryPlace = (zoneIndex: number): TrackHazard | null => {
    const zone = zones[zoneIndex];
    const minimum = Math.max(
      zone.start + 40,
      HAZARD_TUNING.minStartClearance,
    );
    const maximum = Math.min(
      zone.end - 40,
      length - HAZARD_TUNING.finishClearance,
    );

    if (maximum <= minimum) {
      return null;
    }

    for (let attempt = 0; attempt < 160; attempt += 1) {
      const s = rng.range(minimum, maximum);

      if (
        kickers.some(
          (kicker) => s > kicker.s - 28 && s < kicker.s + kicker.length + 28,
        )
      ) {
        continue;
      }
      if (
        extremeRanges.some(
          (range) => s > range.startS - 40 && s < range.endS + 40,
        )
      ) {
        continue;
      }
      if (
        forks.some((fork) => s > fork.startS - 25 && s < fork.endS + 25)
      ) {
        continue;
      }
      if (hazards.some((hazard) => Math.abs(hazard.s - s) < 90)) {
        continue;
      }

      const scenario = zone.id;
      const kind = rng.pick(SCENARIOS[scenario].hazardKinds);
      const dimensions = HAZARD_RADII[kind];

      return {
        id: `hazard-${zoneIndex + 1}-${kind}`,
        kind,
        zoneIndex,
        scenario,
        s,
        direction: rng.sign() as 1 | -1,
        speed: HAZARD_SPEEDS[kind],
        radius: dimensions.radius,
        height: dimensions.height,
      };
    }

    return null;
  };

  for (const zoneIndex of zoneIndexes) {
    if (usedZones.has(zoneIndex)) {
      continue;
    }

    const hazard = tryPlace(zoneIndex);
    if (hazard) {
      hazards.push(hazard);
      usedZones.add(zoneIndex);
    }
  }

  // Garantia de pelo menos 1: procura qualquer setor ainda elegível.
  if (hazards.length === 0) {
    for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
      const hazard = tryPlace(zoneIndex);
      if (hazard) {
        hazards.push(hazard);
        break;
      }
    }
  }

  hazards.sort((a, b) => a.s - b.s);
  return hazards;
}

function placeKickersOnStraights(
  rng: Rng,
  straights: readonly ProceduralStraightInfo[],
  curves: readonly ProceduralCurveInfo[],
  length: number,
  scale: number,
  forks: readonly TrackFork[],
): readonly TrackKicker[] {
  const desired = rng.chance(0.7) ? 2 : 1;
  // Nunca coloca rampa na aproximação/saída do hairpin extremo nem no meio de
  // uma bifurcação.
  const reserved = [
    ...curves
      .filter((curve) => curve.category === 'hairpin-extreme')
      .flatMap((curve) => [
        { startS: curve.startS - 12, endS: curve.startS + 12 },
        { startS: curve.endS - 12, endS: curve.endS + 12 },
      ]),
    ...forks.map((fork) => ({
      startS: fork.startS - 10,
      endS: fork.endS + 10,
    })),
  ];
  const candidates = shuffle(
    straights.filter(
      (straight) =>
        straight.endS - straight.startS >= 70 &&
        !reserved.some(
          (range) => straight.endS > range.startS && straight.startS < range.endS,
        ),
    ),
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
    const rawS = rng.range(45, Math.max(50, total - 18));
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
  zones: readonly TrackZone[],
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
    const zone = zones[zoneIndex] ?? zones[zones.length - 1];
    const type = pickObstacleType(rng, zone.id);
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
  gold: number,
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

  // 4 cenários distintos do pool de 6. A pista vira uma volta pelo mundo,
  // com trocas de piso e de leitura visual a cada ~350–450 m.
  const scenarios = shuffle(SCENARIO_IDS, rng).slice(0, 4);
  const zones: TrackZone[] = [];
  const splits: TrackSplit[] = [];

  for (let i = 0; i < 4; i += 1) {
    const id = scenarios[i] ?? SCENARIO_IDS[i % SCENARIO_IDS.length];
    const scenario = SCENARIOS[id];
    zones.push({
      start: bounds[i],
      end: i === 3 ? length : bounds[i + 1],
      id,
      surface: scenario.roadSurface,
      offroad: scenario.offroadSurface,
    });
  }

  for (let i = 0; i < 3; i += 1) {
    const s = bounds[i + 1];
    splits.push({
      s,
      name: `Parcial ${i + 1}`,
      target: round1((gold * s) / length),
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
  scenario: ScenarioId,
): TrackObstacle['type'] {
  const roll = rng.next();

  switch (scenario) {
    case 'forest':
      if (roll < 0.45) return 'tree';
      if (roll < 0.8) return 'rock';
      return 'log';
    case 'desert':
      if (roll < 0.55) return 'rock';
      if (roll < 0.85) return 'log';
      return 'tree';
    case 'snow':
      if (roll < 0.4) return 'tree';
      if (roll < 0.8) return 'rock';
      return 'log';
    case 'village':
      if (roll < 0.3) return 'tree';
      if (roll < 0.7) return 'rock';
      return 'log';
    case 'dirt':
      if (roll < 0.4) return 'tree';
      if (roll < 0.65) return 'rock';
      return 'log';
    case 'beach':
      if (roll < 0.55) return 'rock';
      if (roll < 0.85) return 'log';
      return 'tree';
  }
}

/** Medalhas do gerador novo, na escala física do carro (maxSpeed 39,1 m/s). */
function buildMedalsV5(length: number): MedalTargets {
  const gold = round1(39 + 10 * clamp((length - 1300) / 350, 0, 1));
  return {
    gold,
    silver: round1(gold + 6),
    bronze: round1(gold + 12),
  };
}

/** Fórmula antiga — só o gerador legado (pista fixa congelada) usa isto. */
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

  validateZones(
    track,
    def,
    length,
    limits,
    options.profile ?? 'v5',
    fail,
  );
  validateSplits(def, length, options.profile ?? 'v5', fail);

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
  validateForks(track, def, length, fail, warn);
  validateHazards(track, def, length, fail);
  validatePowerups(def, length, widthAt, limits, fail);
  validateObstacles(def, length, widthAt, limits, fail);
  validateLayoutFeatures(
    layout,
    length,
    widthAt,
    def.kickers,
    fail,
  );

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

  const tooClose = findTooCloseSections(
    samples,
    limits.sectionClearance,
    layout
      ? (a, b, distance) => {
          if (distance < EXTREME_LEG_CLEARANCE) {
            return false;
          }
          const extremes = layout.curves.filter(
            (curve) => curve.category === 'hairpin-extreme',
          );
          return straddlesExtremeHairpin(a, b, extremes);
        }
      : undefined,
  );
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
      forks: def.forks?.length ?? 0,
      hazards: def.hazards?.length ?? 0,
    },
  };
}

function validateLayoutFeatures(
  layout: ProceduralLayout | null,
  length: number,
  widthAt: (s: number) => number,
  kickers: readonly TrackKicker[],
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

  const extremes = layout.curves.filter(
    (curve) => curve.category === 'hairpin-extreme',
  );
  const normalHairpins = layout.curves.filter(
    (curve) => curve.category === 'hairpin',
  );
  if (extremes.length !== 1) {
    fail(`hairpins extremos: ${extremes.length} (esperado exatamente 1)`);
  }
  if (normalHairpins.length > 1) {
    fail(`hairpins normais: ${normalHairpins.length} (esperado 0..1)`);
  }

  for (const extreme of extremes) {
    if (extreme.radius < 13 - 0.01 || extreme.radius > 14 + 0.01) {
      fail(`hairpin extremo com raio ${extreme.radius.toFixed(1)} m (esperado 13..14)`);
    }
    if (extreme.sweepDeg < 170 - 0.01 || extreme.sweepDeg > 185 + 0.01) {
      fail(
        `hairpin extremo com sweep ${extreme.sweepDeg.toFixed(1)}° ` +
          `(esperado 170..185)`,
      );
    }
    if (extreme.startS < EXTREME_START_FINISH_CLEARANCE - 0.5) {
      fail(
        `hairpin extremo começa a ${extreme.startS.toFixed(1)} m da largada ` +
          `(mínimo ${EXTREME_START_FINISH_CLEARANCE} m)`,
      );
    }
    if (length - extreme.endS < EXTREME_START_FINISH_CLEARANCE - 0.5) {
      fail(
        `hairpin extremo termina a ${(length - extreme.endS).toFixed(1)} m ` +
          `da chegada (mínimo ${EXTREME_START_FINISH_CLEARANCE} m)`,
      );
    }

    const approach = layout.straights.find(
      (straight) => Math.abs(straight.endS - extreme.startS) < 1,
    );
    const exit = layout.straights.find(
      (straight) => Math.abs(straight.startS - extreme.endS) < 1,
    );
    if (!approach || !exit) {
      fail('hairpin extremo sem retas de aproximação/saída identificáveis');
    } else {
      const approachLength = approach.endS - approach.startS;
      const exitLength = exit.endS - exit.startS;
      if (approachLength < 45 - 0.5 || approachLength > 60 + 0.5) {
        fail(
          `reta de aproximação do hairpin extremo com ${approachLength.toFixed(1)} m ` +
            `(esperado 45..60 m)`,
        );
      }
      if (exitLength < 35 - 0.5) {
        fail(
          `reta de saída do hairpin extremo com ${exitLength.toFixed(1)} m ` +
            `(esperado >=35 m)`,
        );
      }
      for (const kicker of kickers) {
        if (
          kicker.s > approach.startS - 5 &&
          kicker.s < extreme.startS + 5
        ) {
          fail('kicker na aproximação do hairpin extremo');
        }
      }
    }

    let localMin = Infinity;
    let localMax = -Infinity;
    for (let s = extreme.startS; s <= extreme.endS; s += 1) {
      localMin = Math.min(localMin, widthAt(s));
      localMax = Math.max(localMax, widthAt(s));
    }
    if (localMin < EXTREME_WIDTH_RANGE[0] - 0.06 || localMax > EXTREME_WIDTH_RANGE[1] + 0.06) {
      fail(
        `largura no hairpin extremo ${localMin.toFixed(2)}..${localMax.toFixed(2)} m ` +
          `(esperado ${EXTREME_WIDTH_RANGE[0]}..${EXTREME_WIDTH_RANGE[1]} m)`,
      );
    }
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
  profile: ValidationProfile,
  fail: (message: string) => void,
): void {
  if (def.zones.length !== 4) {
    fail(`esperadas 4 zonas, encontradas ${def.zones.length}`);
    return;
  }

  const seen = new Set<ScenarioId>();

  for (let i = 0; i < def.zones.length; i += 1) {
    const zone = def.zones[i];
    const zoneLength = zone.end - zone.start;

    if (profile === 'legacy') {
      const expectedId: TrackZoneId = i % 2 === 0 ? 'forest' : 'desert';
      const expectedSurface = expectedId === 'forest' ? 'gravel' : 'sand';
      if (zone.id !== expectedId) {
        fail(`zona ${i + 1} deveria ser ${expectedId}, veio ${zone.id}`);
      }
      if (zone.surface !== expectedSurface) {
        fail(`superfície da zona ${i + 1} incompatível com ${zone.id}`);
      }
    } else {
      const scenario = SCENARIOS[zone.id];
      if (!scenario) {
        fail(`zona ${i + 1} tem cenário desconhecido ${zone.id}`);
      } else {
        if (zone.surface !== scenario.roadSurface) {
          fail(
            `superfície ${zone.surface} incompatível com o cenário ${zone.id}`,
          );
        }
        if (zone.offroad !== scenario.offroadSurface) {
          fail(
            `off-road ${zone.offroad ?? '—'} incompatível com o cenário ${zone.id}`,
          );
        }
      }
      seen.add(zone.id);
      if (i > 0 && def.zones[i - 1].id === zone.id) {
        fail(`zona ${i + 1} repete o cenário da anterior (${zone.id})`);
      }
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

  if (profile === 'v5' && seen.size < 3) {
    fail(`pista com ${seen.size} cenários distintos (mínimo 3)`);
  }

  const zoneAtStart = track.zoneAt(0);
  if (profile === 'legacy' && zoneAtStart !== 'forest') {
    fail('a primeira zona deveria ser floresta');
  }
}

function validateSplits(
  def: TrackDef,
  length: number,
  profile: ValidationProfile,
  fail: (message: string) => void,
): void {
  if (def.splits.length !== 3) {
    fail(`esperadas 3 parciais, encontradas ${def.splits.length}`);
    return;
  }

  const expectedGold = profile === 'v5' ? buildMedalsV5(length).gold : null;

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
    if (expectedGold !== null) {
      const wanted = round1((expectedGold * split.s) / length);
      if (Math.abs(split.target - wanted) > 0.11) {
        fail(
          `parcial ${i + 1} com alvo ${split.target} s ` +
            `(esperado ${wanted} s para o ouro de ${expectedGold} s)`,
        );
      }
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
  exempt?: (a: number, b: number, distance: number) => boolean,
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
          if (exempt && exempt(other.s, point.s, distance)) {
            continue;
          }
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

function validateForks(
  track: Track,
  def: TrackDef,
  length: number,
  fail: (message: string) => void,
  warn: (message: string) => void,
): void {
  const forks = def.forks ?? [];
  if (forks.length > FORK_TUNING.maxForks) {
    fail(`bifurcações demais: ${forks.length} (máx ${FORK_TUNING.maxForks})`);
  }
  if (forks.length === 0) {
    warn('pista sem bifurcação');
    return;
  }

  for (let i = 0; i < forks.length; i += 1) {
    const fork = forks[i];
    if (
      fork.startS < FORK_MIN_START ||
      fork.endS > length - FORK_END_MARGIN ||
      fork.endS - fork.startS < FORK_MIN_SPAN - 5
    ) {
      fail(
        `bifurcação ${i + 1} em s=${fork.startS.toFixed(0)}..${fork.endS.toFixed(0)} ` +
          `fora da faixa segura`,
      );
    }

    if (i > 0 && fork.startS < forks[i - 1].endS + 40) {
      fail(`bifurcação ${i + 1} encosta na anterior`);
    }

    for (const branchInfo of fork.branches) {
      if (
        Math.abs(branchInfo.startS - fork.startS) > 0.5 ||
        Math.abs(branchInfo.endS - fork.endS) > 0.5
      ) {
        fail(`ramo ${branchInfo.id} não casa com o início/fim da bifurcação`);
      }
      if (branchInfo.points.length < 8) {
        fail(`ramo ${branchInfo.id} tem poucos pontos de controle`);
      }
      if (branchInfo.side !== 1 && branchInfo.side !== -1) {
        fail(`ramo ${branchInfo.id} sem lado definido (side=${branchInfo.side})`);
      }

      const branch = track.branches.find((entry) => entry.id === branchInfo.id);
      if (!branch) {
        fail(`ramo ${branchInfo.id} não foi construído no Track`);
        continue;
      }

      const startMain = track.sampleAt(branch.startS);
      const endMain = track.sampleAt(branch.endS);
      const startBranch = branch.sampleAt(0);
      const endBranch = branch.sampleAt(branch.length);
      const startDistance = Math.hypot(
        startMain.position.x - startBranch.position.x,
        startMain.position.z - startBranch.position.z,
      );
      const endDistance = Math.hypot(
        endMain.position.x - endBranch.position.x,
        endMain.position.z - endBranch.position.z,
      );

      // O ramo começa/termina na BORDA da pista principal: o centro fica a
      // `mainHalf + branchHalf` do centro dela (menos a pequena sobreposição).
      const mainHalf =
        Math.max(track.widthAt(branch.startS), track.widthAt(branch.endS)) * 0.5;
      const branchHalf = branchInfo.width * 0.5;
      const expectedOffset = mainHalf + branchHalf;

      if (
        startDistance < expectedOffset - 2.0 ||
        startDistance > expectedOffset + 2.5 ||
        endDistance < expectedOffset - 2.0 ||
        endDistance > expectedOffset + 2.5
      ) {
        fail(
          `ramo ${branchInfo.id} não começa/termina na borda da pista ` +
            `(${startDistance.toFixed(1)} m / ${endDistance.toFixed(1)} m, ` +
            `esperado ~${expectedOffset.toFixed(1)} m)`,
        );
      }

      const startU =
        (startBranch.position.x - startMain.position.x) * startMain.right.x +
        (startBranch.position.z - startMain.position.z) * startMain.right.z;
      const endU =
        (endBranch.position.x - endMain.position.x) * endMain.right.x +
        (endBranch.position.z - endMain.position.z) * endMain.right.z;
      if (
        Math.sign(startU) !== branchInfo.side ||
        Math.sign(endU) !== branchInfo.side
      ) {
        fail(
          `ramo ${branchInfo.id} abre do lado errado ` +
            `(side=${branchInfo.side}, u=${startU.toFixed(1)}/${endU.toFixed(1)})`,
        );
      }

      let minBranchWidth = Infinity;
      for (let s = 0; s <= branch.length; s += 2) {
        minBranchWidth = Math.min(minBranchWidth, branch.widthAt(s));
      }
      if (minBranchWidth < FORK_TUNING.minLaneWidth - 0.01) {
        fail(
          `ramo ${branchInfo.id} estreita demais ` +
            `(${minBranchWidth.toFixed(2)} m < ${FORK_TUNING.minLaneWidth} m)`,
        );
      }

      // O ramo pode se afastar, mas não deve encostar em outro trecho da pista
      // principal fora da própria bifurcação.
      for (let s = 8; s < branch.length - 8; s += 4) {
        const sample = branch.sampleAt(s);
        const projection = track.project(
          sample.position.x,
          sample.position.z,
        );
        if (
          projection.s > fork.startS - 8 &&
          projection.s < fork.endS + 8
        ) {
          continue;
        }
        const clearance =
          track.widthAt(projection.s) * 0.5 +
          branch.widthAt(s) * 0.5 +
          2;
        if (projection.distance < clearance) {
          warn(
            `ramo ${branchInfo.id} passa a ${projection.distance.toFixed(1)} m ` +
              `da pista principal em s=${projection.s.toFixed(0)} m`,
          );
        }
      }
    }
  }
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

function validateHazards(
  track: Track,
  def: TrackDef,
  length: number,
  fail: (message: string) => void,
): void {
  const hazards = def.hazards ?? [];
  if (hazards.length < 1 || hazards.length > HAZARD_TUNING.maxPerRun) {
    fail(
      `hazards fora da faixa 1..${HAZARD_TUNING.maxPerRun} ` +
        `(${hazards.length})`,
    );
  }

  for (let i = 0; i < hazards.length; i += 1) {
    const hazard = hazards[i];
    const zone = def.zones[hazard.zoneIndex];
    if (!zone) {
      fail(`hazard ${i + 1} aponta para setor inexistente`);
      continue;
    }
    if (hazard.scenario !== zone.id) {
      fail(`hazard ${i + 1} não pertence ao cenário do setor`);
    }
    if (!SCENARIOS[zone.id].hazardKinds.includes(hazard.kind)) {
      fail(`hazard ${i + 1} (${hazard.kind}) não é válido em ${zone.id}`);
    }
    if (
      hazard.s < HAZARD_TUNING.minStartClearance ||
      hazard.s > length - HAZARD_TUNING.finishClearance
    ) {
      fail(`hazard ${i + 1} em s=${hazard.s.toFixed(0)} fora da faixa segura`);
    }
    if (hazard.s < zone.start || hazard.s > zone.end) {
      fail(`hazard ${i + 1} fora do setor ${hazard.zoneIndex + 1}`);
    }
    if (
      def.kickers.some(
        (kicker) =>
          hazard.s > kicker.s - 20 &&
          hazard.s < kicker.s + kicker.length + 20,
      )
    ) {
      fail(`hazard ${i + 1} em cima de uma rampa`);
    }
    if (track.branches.some((branch) => {
      const delta = hazard.s - branch.startS;
      return delta > -15 && hazard.s < branch.endS + 15;
    })) {
      fail(`hazard ${i + 1} dentro de uma bifurcação`);
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
