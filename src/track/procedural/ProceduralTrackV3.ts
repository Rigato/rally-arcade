/**
 * Gerador procedural v3: pistas por blocos de cenário com splits intrínsecos.
 *
 * A pista é uma sequência de blocos. Cada bloco tem um bioma. Blocos lineares
 * têm uma rota completa; blocos com split têm entrada comum, duas rotas
 * completas (A e B) e saída comum. A rota A é o eixo lógico (cronômetro e
 * parciais); a rota B é uma `TrackForkBranch` com `kind: 'route'`, zonas
 * locais, kickers e conteúdo próprio.
 *
 * A v1 e a v2 continuam intactas para rollback (`?gen=v1`, `?gen=v2`).
 */

import { clamp, lerp } from '../../core/math';
import type {
  MedalTargets,
  ScenarioId,
  TrackBlock,
  TrackDef,
  TrackFork,
  TrackForkBranch,
  TrackHazard,
  TrackKicker,
  TrackPoint,
  TrackPowerup,
  TrackSplit,
  TrackZone,
} from '../../game/types';
import { SCENARIOS, SCENARIO_IDS } from '../../game/scenarios';
import { Track } from '../Track';
import { createRng, type Rng } from './rng';
import { generateProceduralTrackV2 } from './ProceduralTrackV2';

export const PROCEDURAL_V3_VERSION = 3;

const V3_DEBUG = false;

function debug(...args: unknown[]): void {
  if (V3_DEBUG) {
    console.warn('[ProcV3:debug]', ...args);
  }
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const MIN_TRACK_LENGTH = 2300;
const MAX_TRACK_LENGTH = 3800;
const MIN_ROUTE_LENGTH = 430;
const MAX_ROUTE_LENGTH = 980;
const MIN_ROUTE_WIDTH = 5.5;
const MAX_ROUTE_WIDTH = 10;
const ROUTE_HALF_GAP = 1.1;
const LANE_TRANSITION = 18;
const ROUTE_CONTROL_SPACING = 4.5;
const LINEAR_CONTROL_SPACING = 7;

type CurveCategory =
  | 'long'
  | 'medium'
  | 'short'
  | 'elbow'
  | 'hairpin'
  | 'hairpin-extreme'
  | 'kink';

const CURVE_RANGES: Record<
  CurveCategory,
  { radius: [number, number]; sweep: [number, number] }
> = {
  long: { radius: [70, 110], sweep: [25 * DEG, 70 * DEG] },
  medium: { radius: [45, 65], sweep: [35 * DEG, 90 * DEG] },
  short: { radius: [28, 38], sweep: [45 * DEG, 110 * DEG] },
  elbow: { radius: [26, 31], sweep: [75 * DEG, 120 * DEG] },
  hairpin: { radius: [20, 23], sweep: [160 * DEG, 180 * DEG] },
  'hairpin-extreme': { radius: [13.2, 14.2], sweep: [170 * DEG, 182 * DEG] },
  kink: { radius: [140, 220], sweep: [6 * DEG, 15 * DEG] },
};

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

type RouteProfile = 'mixed' | 'tight' | 'fast';
type SplitStyle = 'symmetric' | 'asymmetric';

interface Pose {
  x: number;
  z: number;
  y: number;
  heading: number;
}

interface BlockPlan {
  readonly index: number;
  readonly kind: 'linear' | 'split';
  readonly scenario: ScenarioId;
  readonly targetLength: number;
  readonly splitStyle: SplitStyle;
  readonly splitSide: 1 | -1;
}

interface LocalPoint {
  readonly x: number;
  readonly y: number;
  readonly s: number;
}

interface WidthPulse {
  readonly center: number;
  readonly sigma: number;
  readonly amount: number;
}

interface WidthProfile {
  readonly at: (x: number, span: number) => number;
}

interface GeneratedFork {
  readonly plan: BlockPlan;
  readonly branchPoints: readonly TrackPoint[];
  readonly branchWidth: number;
  readonly side: 1 | -1;
  readonly p0: Pose;
  readonly p1: Pose;
  readonly routeLengthEstimate: number;
}

interface GeneratedBlock {
  readonly plan: BlockPlan;
  readonly startPoint: TrackPoint;
  readonly endPoint: TrackPoint;
  readonly fork: GeneratedFork | null;
}

/**
 * API principal. Tenta até quatro variações determinísticas do PRNG; se todas
 * falharem, devolve a v2 intacta (rollback seguro).
 */
export function generateProceduralTrackV3(seed: number): TrackDef {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const built = tryBuild(seed, attempt);
      if (built) {
        return built;
      }
    } catch (error) {
      if (attempt === 3) {
        console.warn(`[ProcV3] seed ${seed} falhou; usando v2.`, error);
      }
    }
  }

  return generateProceduralTrackV2(seed);
}

/* ------------------------------------------------------------------------- */
/* Programa de blocos                                                        */
/* ------------------------------------------------------------------------- */

function buildBlockPlans(rng: Rng): readonly BlockPlan[] | null {
  const blockCount = rng.int(5, 6);
  const maxSplits = blockCount >= 6 ? 2 : 1;
  const splitCount = rng.chance(0.58) ? maxSplits : 1;

  const candidates: number[] = [];
  for (let index = 1; index < blockCount - 1; index += 1) {
    candidates.push(index);
  }
  shuffle(candidates, rng);

  const splitIndexes: number[] = [];
  for (const index of candidates) {
    if (splitIndexes.length >= splitCount) {
      break;
    }
    if (splitIndexes.some((other) => Math.abs(other - index) <= 1)) {
      continue;
    }
    splitIndexes.push(index);
  }
  if (splitIndexes.length === 0) {
    splitIndexes.push(1);
  }

  const scenarios = shuffle([...SCENARIO_IDS], rng).slice(0, blockCount);
  const plans: BlockPlan[] = [];

  for (let index = 0; index < blockCount; index += 1) {
    const split = splitIndexes.includes(index);
    const linearTarget = rng.range(390, 520);
    const splitTarget = rng.range(720, 900);
    plans.push({
      index,
      kind: split ? 'split' : 'linear',
      scenario: scenarios[index] ?? SCENARIO_IDS[index % SCENARIO_IDS.length],
      targetLength: split ? splitTarget : linearTarget,
      splitStyle: rng.chance(0.5) ? 'symmetric' : 'asymmetric',
      splitSide: rng.sign() as 1 | -1,
    });
  }

  return plans;
}

/* ------------------------------------------------------------------------- */
/* Construção principal                                                      */
/* ------------------------------------------------------------------------- */

function tryBuild(seed: number, attempt: number): TrackDef | null {
  const rng = createRng((seed ^ (0x51ed270b + attempt * 0x85ebca6b)) >>> 0);
  const plans = buildBlockPlans(rng);
  if (!plans) {
    return null;
  }

  const pose: Pose = {
    x: 0,
    z: 0,
    y: 0,
    heading: 0,
  };
  const points: TrackPoint[] = [{ x: 0, z: 0, y: 0, width: 10.5 }];
  const blocks: GeneratedBlock[] = [];

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const isFirst = index === 0;
    const isLast = index === plans.length - 1;

    if (plan.kind === 'split') {
      const split = buildSplitBlock(rng, pose, plan);
      if (!split) {
        // Degrada o bloco para linear em vez de derrubar a pista inteira.
        const linear = buildLinearBlock(
          rng,
          pose,
          {
            ...plan,
            kind: 'linear',
            targetLength: rng.range(390, 520),
          },
          isFirst,
          isLast,
        );
        appendPoints(points, linear.points);
        pose.x = linear.pose.x;
        pose.z = linear.pose.z;
        pose.y = linear.pose.y;
        pose.heading = linear.pose.heading;
        blocks.push({
          plan: { ...plan, kind: 'linear' },
          startPoint: points[points.length - linear.points.length - 1] ?? points[0],
          endPoint: points[points.length - 1],
          fork: null,
        });
        continue;
      }

      const startPoint = points[points.length - 1];
      appendPoints(points, split.points);
      pose.x = split.pose.x;
      pose.z = split.pose.z;
      pose.y = split.pose.y;
      pose.heading = split.pose.heading;
      blocks.push({
        plan,
        startPoint,
        endPoint: points[points.length - 1],
        fork: split.fork,
      });
      continue;
    }

    const linear = buildLinearBlock(rng, pose, plan, isFirst, isLast);
    const startPoint = points[points.length - 1];
    appendPoints(points, linear.points);
    pose.x = linear.pose.x;
    pose.z = linear.pose.z;
    pose.y = linear.pose.y;
    pose.heading = linear.pose.heading;
    blocks.push({
      plan,
      startPoint,
      endPoint: points[points.length - 1],
      fork: null,
    });
  }

  if (points.length < 80) {
    debug('poucos pontos', points.length);
    return null;
  }

  const quietDef: TrackDef = {
    id: `proc-${seed}`,
    points,
    zones: [
      {
        start: 0,
        end: 1,
        id: plans[0].scenario,
        surface: SCENARIOS[plans[0].scenario].roadSurface,
        offroad: SCENARIOS[plans[0].scenario].offroadSurface,
      },
    ],
    kickers: [],
    obstacles: [],
    powerups: [],
    splits: [],
    medals: { gold: 1, silver: 1.1, bronze: 1.2 },
    forks: [],
    hazards: [],
  };
  const quiet = buildQuietTrack(quietDef);
  if (quiet.length < MIN_TRACK_LENGTH || quiet.length > MAX_TRACK_LENGTH) {
    debug('comprimento trunk', quiet.length.toFixed(0));
    return null;
  }

  const blockBounds = resolveBlockBounds(quiet, blocks);

  const zones: TrackZone[] = [];
  const trackBlocks: TrackBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const bounds = blockBounds[index];
    const scenario = SCENARIOS[block.plan.scenario];
    zones.push({
      start: bounds.startS,
      end: bounds.endS,
      id: block.plan.scenario,
      surface: scenario.roadSurface,
      offroad: scenario.offroadSurface,
    });
    trackBlocks.push({
      id: `block-${index + 1}`,
      index,
      kind: block.fork ? 'split' : 'linear',
      scenario: block.plan.scenario,
      startS: bounds.startS,
      endS: bounds.endS,
      routeId: block.fork ? `route-${index + 1}` : undefined,
    });
  }
  zones[zones.length - 1] = {
    ...zones[zones.length - 1],
    end: quiet.length,
  };

  const forks: TrackFork[] = [];
  const forkIndexByBlock = new Map<number, number>();
  for (let index = 0; index < blocks.length; index += 1) {
    const fork = blocks[index].fork;
    if (!fork) {
      continue;
    }
    const bounds = blockBounds[index];
    const branchLength = polylineLength(fork.branchPoints);
    const scenario = SCENARIOS[fork.plan.scenario];
    const p0S = quiet.project(fork.p0.x, fork.p0.z).s;
    const p1S = quiet.project(fork.p1.x, fork.p1.z).s;
    if (V3_DEBUG) {
      const p0Sample = quiet.sampleAt(p0S);
      const p1Sample = quiet.sampleAt(p1S);
      debug(
        'project',
        index,
        `bounds=${bounds.startS.toFixed(0)}..${bounds.endS.toFixed(0)}`,
        `p0=(${fork.p0.x.toFixed(1)},${fork.p0.z.toFixed(1)})`,
        `s=${p0S.toFixed(1)}`,
        `sample=(${p0Sample.position.x.toFixed(1)},${p0Sample.position.z.toFixed(1)})`,
        `p1=(${fork.p1.x.toFixed(1)},${fork.p1.z.toFixed(1)})`,
        `s1=${p1S.toFixed(1)}`,
        `sample1=(${p1Sample.position.x.toFixed(1)},${p1Sample.position.z.toFixed(1)})`,
      );
    }
    if (p1S <= p0S + 80) {
      debug('p0/p1 inválidos', p0S.toFixed(0), p1S.toFixed(0));
      return null;
    }
    const branchZones: TrackZone[] = [
      {
        start: 0,
        end: branchLength,
        id: fork.plan.scenario,
        surface: scenario.roadSurface,
        offroad: scenario.offroadSurface,
      },
    ];
    const branch: TrackForkBranch = {
      id: `route-${index + 1}`,
      points: fork.branchPoints,
      startS: p0S,
      endS: p1S,
      length: branchLength,
      width: fork.branchWidth,
      side: fork.side,
      kind: 'route',
      zones: branchZones,
      kickers: [],
    };
    forkIndexByBlock.set(index, forks.length);
    forks.push({
      id: `split-${index + 1}`,
      startS: branch.startS,
      endS: branch.endS,
      branches: [branch],
    });
  }

  if (forks.length === 0) {
    debug('sem forks');
    return null;
  }

  const medal = buildMedals(quiet.length);
  const splitPoints = chooseSplits(trackBlocks, quiet.length, medal.gold);
  const preliminary: TrackDef = {
    id: `proc-${seed}`,
    points,
    zones,
    kickers: [],
    obstacles: [],
    powerups: [],
    splits: splitPoints,
    medals: medal,
    forks,
    hazards: [],
    blocks: trackBlocks,
  };
  const preliminaryTrack = buildQuietTrack(preliminary);
  if (preliminaryTrack.length < MIN_TRACK_LENGTH) {
    return null;
  }

  const content = buildContent(preliminary, preliminaryTrack, blocks, forkIndexByBlock);
  if (!content) {
    debug('sem conteúdo');
    return null;
  }

  const finalBlocks = trackBlocks.map((block, index) => {
    const forkIndex = forkIndexByBlock.get(index);
    if (forkIndex === undefined) {
      return block;
    }
    const branch = preliminaryTrack.branches[forkIndex];
    return {
      ...block,
      routeLength: branch?.length,
    };
  });

  const def: TrackDef = {
    ...preliminary,
    kickers: content.kickers,
    powerups: content.powerups,
    hazards: content.hazards,
    forks: content.forks,
    blocks: finalBlocks,
  };

  if (!validateGenerated(def)) {
    debug('validação falhou', def.id, `len=${quiet.length.toFixed(0)}`, `forks=${def.forks?.length}`);
    return null;
  }

  return def;}

/* ------------------------------------------------------------------------- */
/* Blocos lineares                                                           */
/* ------------------------------------------------------------------------- */

function buildLinearBlock(
  rng: Rng,
  pose: Pose,
  plan: BlockPlan,
  isFirst: boolean,
  isLast: boolean,
): { points: TrackPoint[]; pose: Pose } {
  const startStraight = isFirst ? rng.range(90, 120) : rng.range(20, 40);
  const endStraight = isLast ? rng.range(120, 150) : rng.range(30, 55);
  const target = isFirst || isLast
    ? Math.max(plan.targetLength, startStraight + endStraight + 220)
    : plan.targetLength;
  const local = generateOpenRoute(rng, target, startStraight, endStraight);
  const baseWidth = rng.range(9.5, 11.2);
  const width = makeWidthProfile(rng, target, baseWidth, 0.7);
  const slope = rng.range(-0.035, 0.035);
  const hump = rng.range(0, 2.8);

  const points = localToWorld(
    local,
    pose,
    (x) => slope * x + hump * Math.sin(Math.PI * clamp(x / target, 0, 1)) *
      Math.sin(Math.PI * clamp(x / target, 0, 1)),
    (x) => width.at(x, target),
    LINEAR_CONTROL_SPACING,
    pose.y,
  );

  const end = local[local.length - 1];
  const endPose: Pose = {
    x: worldX(pose, end.x, end.y),
    z: worldZ(pose, end.x, end.y),
    y: pose.y + slope * end.x +
      hump * Math.sin(Math.PI * clamp(end.x / target, 0, 1)) ** 2,
    heading: pose.heading,
  };
  // O gerador local termina com heading 0 no referencial do bloco; convertemos
  // a direção final para o mundo.
  endPose.heading = pose.heading;
  // A posição final real é o último ponto, não o eixo local (curvas desviam).
  endPose.x = points[points.length - 1].x;
  endPose.z = points[points.length - 1].z;
  endPose.y = points[points.length - 1].y;
  endPose.heading = endHeading(pose, local);

  return { points, pose: endPose };
}

function generateOpenRoute(
  rng: Rng,
  targetLength: number,
  startStraight: number,
  endStraight: number,
): readonly LocalPoint[] {
  const points: LocalPoint[] = [];
  const state = { x: 0, y: 0, heading: 0, s: 0 };
  points.push({ x: 0, y: 0, s: 0 });
  appendLocalStraight(points, state, startStraight);

  let lastTurn: 1 | -1 = rng.sign() as 1 | -1;
  let runLength = 0;
  let categoryCount = 0;
  let segments = 0;
  let turnBalance = 0;

  while (
    state.s < targetLength - endStraight - 55 &&
    segments < 22
  ) {
    segments += 1;
    const useStraight = rng.chance(0.3);
    if (useStraight) {
      const length = rng.range(20, 65);
      appendLocalStraight(points, state, length);
      continue;
    }

    const category = pickCurveCategory(rng, 'mixed', categoryCount);
    let turn: 1 | -1;
    if (runLength >= 2) {
      turn = lastTurn === 1 ? -1 : 1;
    } else {
      const expected = turnBalance / Math.max(40, state.s);
      const probabilityRight = clamp(0.5 - expected * 0.9, 0.18, 0.82);
      turn = rng.chance(probabilityRight) ? 1 : -1;
    }
    if (turn === lastTurn) {
      runLength += 1;
    } else {
      runLength = 1;
      lastTurn = turn;
    }
    const range = CURVE_RANGES[category];
    const sweep = rng.range(range.sweep[0], range.sweep[1]);
    appendLocalArc(
      points,
      state,
      rng.range(range.radius[0], range.radius[1]),
      sweep,
      turn,
    );
    turnBalance += turn * sweep;
    categoryCount += 1;
  }

  // Fecha o bloco com heading próximo de 0. Sem isso, a pista inteira pode
  // derivar 90–180° e cruzar um bloco anterior.
  if (Math.abs(state.heading) > 0.08) {
    const sweep = Math.min(Math.abs(state.heading), 70 * DEG);
    appendLocalArc(
      points,
      state,
      rng.range(45, 70),
      sweep,
      (state.heading > 0 ? -1 : 1) as 1 | -1,
    );
  }

  const remaining = Math.max(30, targetLength - state.s);
  appendLocalStraight(points, state, Math.min(remaining, endStraight + 40));
  return points;
}

/* ------------------------------------------------------------------------- */
/* Blocos com split                                                          */
/* ------------------------------------------------------------------------- */

function buildSplitBlock(
  rng: Rng,
  pose: Pose,
  plan: BlockPlan,
): { points: TrackPoint[]; pose: Pose; fork: GeneratedFork } | null {
  const side = plan.splitSide;
  const routeWidth = rng.range(6.3, 7.2);
  const routeHalf = routeWidth * 0.5;
  const corridorHalf = rng.range(62, 82);
  const entryLength = rng.range(66, 86);
  const exitLength = rng.range(58, 78);
  const axisLength = Math.max(500, plan.targetLength - entryLength - exitLength);
  const profile: RouteProfile = plan.splitStyle === 'symmetric' ? 'mixed' : 'mixed';

  const laneY = routeHalf + ROUTE_HALF_GAP;
  const routeA = tryGenerateCorridorRoute(
    rng,
    (-side) as 1 | -1,
    LANE_TRANSITION,
    axisLength - LANE_TRANSITION,
    -side * laneY,
    -side * laneY,
    routeHalf + 0.8,
    corridorHalf,
    plan.splitStyle === 'asymmetric' ? 'fast' : profile,
  );
  const routeB = tryGenerateCorridorRoute(
    rng,
    side,
    LANE_TRANSITION,
    axisLength - LANE_TRANSITION,
    side * laneY,
    side * laneY,
    routeHalf + 0.8,
    corridorHalf,
    plan.splitStyle === 'asymmetric' ? 'tight' : profile,
  );

  if (!routeA || !routeB) {
    debug('rota A/B falhou', plan.index, Boolean(routeA), Boolean(routeB));
    return null;
  }

  const lengthA = routeA[routeA.length - 1].s;
  const lengthB = routeB[routeB.length - 1].s;
  if (lengthA < MIN_ROUTE_LENGTH || lengthB < MIN_ROUTE_LENGTH) {
    debug('rota curta', lengthA.toFixed(0), lengthB.toFixed(0));
    return null;
  }
  const maxDifference = plan.splitStyle === 'symmetric' ? 0.18 : 0.38;
  if (Math.abs(lengthA - lengthB) > maxDifference * Math.max(lengthA, lengthB)) {
    debug('rotas desiguais', lengthA.toFixed(0), lengthB.toFixed(0), plan.splitStyle);
    return null;
  }

  const points: TrackPoint[] = [];
  const entryY = pose.y;
  const entrySteps = Math.max(4, Math.ceil(entryLength / 6));
  for (let index = 1; index <= entrySteps; index += 1) {
    const t = index / entrySteps;
    const x = entryLength * t;
    const widen = smoothstep(clamp((x - (entryLength - 18)) / 18, 0, 1));
    const width = lerp(10.5, routeWidth * 2, widen);
    points.push({
      x: worldX(pose, x, 0),
      z: worldZ(pose, x, 0),
      y: entryY,
      width,
    });
  }

  const p0: Pose = {
    x: worldX(pose, entryLength, 0),
    z: worldZ(pose, entryLength, 0),
    y: entryY,
    heading: pose.heading,
  };

  // Transição da pista comum para a faixa A.
  const transitionSteps = Math.max(3, Math.ceil(LANE_TRANSITION / 5));
  for (let index = 1; index <= transitionSteps; index += 1) {
    const t = index / transitionSteps;
    const x = LANE_TRANSITION * t;
    const y = lerp(0, -side * laneY, smoothstep(t));
    points.push({
      x: worldX(p0, x, y),
      z: worldZ(p0, x, y),
      y: entryY,
      width: lerp(routeWidth * 2, routeWidth, smoothstep(t)),
    });
  }

  const routeAPoints = localToWorld(
    routeA,
    p0,
    (x) => elevationProfile(x, axisLength, routeA, 0.55),
    (x) => routeWidthAt(x, axisLength, routeWidth, routeA.length, 0.55),
    ROUTE_CONTROL_SPACING,
    entryY,
  );
  // Remove o primeiro ponto: ele coincide com o fim da transição.
  appendPoints(points, routeAPoints.slice(1));

  const p1: Pose = {
    x: worldX(p0, axisLength, 0),
    z: worldZ(p0, axisLength, 0),
    y: entryY,
    heading: pose.heading,
  };

  // Transição da faixa A de volta ao centro do merge.
  const lastA = routeA[routeA.length - 1];
  const startMergeX = lastA.x;
  const mergeSteps = Math.max(3, Math.ceil(LANE_TRANSITION / 5));
  for (let index = 1; index <= mergeSteps; index += 1) {
    const t = index / mergeSteps;
    const x = lerp(startMergeX, axisLength, t);
    const y = lerp(-side * laneY, 0, smoothstep(t));
    points.push({
      x: worldX(p0, x, y),
      z: worldZ(p0, x, y),
      y: entryY,
      width: lerp(routeWidth, routeWidth * 2, smoothstep(t)),
    });
  }

  const exitSteps = Math.max(4, Math.ceil(exitLength / 6));
  for (let index = 1; index <= exitSteps; index += 1) {
    const t = index / exitSteps;
    const x = axisLength + exitLength * t;
    const narrow = smoothstep(clamp((exitLength * t) / 18, 0, 1));
    points.push({
      x: worldX(p0, x, 0),
      z: worldZ(p0, x, 0),
      y: entryY,
      width: lerp(routeWidth * 2, 10.5, narrow),
    });
  }

  const branchPoints = buildBranchPoints(
    p0,
    routeB,
    axisLength,
    side * laneY,
    routeWidth,
    entryY,
  );

  const fork: GeneratedFork = {
    plan,
    branchPoints,
    branchWidth: routeWidth,
    side,
    p0,
    p1,
    routeLengthEstimate: lengthB,
  };
  if (V3_DEBUG) {
    debug(
      'split',
      plan.index,
      `p0=(${p0.x.toFixed(1)},${p0.z.toFixed(1)})`,
      `first=(${branchPoints[0].x.toFixed(1)},${branchPoints[0].z.toFixed(1)})`,
      `laneY=${laneY.toFixed(1)}`,
      `heading=${pose.heading.toFixed(2)}`,
    );
  }

  const endLocal = {
    x: axisLength + exitLength,
    y: 0,
  };
  return {
    points,
    pose: {
      x: worldX(p0, endLocal.x, endLocal.y),
      z: worldZ(p0, endLocal.x, endLocal.y),
      y: entryY,
      heading: pose.heading,
    },
    fork,
  };
}

function buildBranchPoints(
  p0: Pose,
  route: readonly LocalPoint[],
  axisLength: number,
  laneY: number,
  routeWidth: number,
  baseY: number,
): readonly TrackPoint[] {
  // A rota B tem uma reta curta na faixa direita antes/depois do trecho
  // curvo, para começar/terminar alinhada ao eixo.
  const dense: LocalPoint[] = [
    { x: 0, y: laneY, s: 0 },
  ];
  const lead = {
    x: 0,
    y: laneY,
    s: 0,
  };
  appendFixedStraight(dense, lead, LANE_TRANSITION, laneY);
  for (const point of route) {
    const last = dense[dense.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.3) {
      continue;
    }
    dense.push({ x: point.x, y: point.y, s: point.s + LANE_TRANSITION });
  }
  const tail = {
    x: axisLength - LANE_TRANSITION,
    y: laneY,
    s: 0,
  };
  appendFixedStraight(dense, tail, LANE_TRANSITION, laneY);

  return localToWorld(
    dense,
    p0,
    (x) => elevationProfile(x, axisLength, route, 0.9),
    (x) => routeWidthAt(x, axisLength, routeWidth, route.length, 0.9),
    ROUTE_CONTROL_SPACING,
    baseY,
  );
}

function tryGenerateCorridorRoute(
  rng: Rng,
  side: 1 | -1,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  minAbsY: number,
  maxAbsY: number,
  profile: RouteProfile,
): readonly LocalPoint[] | null {
  const span = Math.max(1, endX - startX);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const nominalSpacing = profile === 'tight'
      ? rng.range(46, 60)
      : profile === 'fast'
        ? rng.range(70, 94)
        : rng.range(56, 78);
    const count = Math.round(span / nominalSpacing);
    const waypointCount = clamp(count, 5, 15);
    const lateralMin = minAbsY + 10;
    const lateralMax = Math.max(lateralMin + 12, maxAbsY - 12);
    const waveCount = profile === 'tight'
      ? rng.range(4.6, 6.4)
      : profile === 'fast'
        ? rng.range(2.6, 4.0)
        : rng.range(3.5, 5.4);
    const amplitude = profile === 'tight'
      ? rng.range(0.36, 0.56)
      : profile === 'fast'
        ? rng.range(0.56, 0.8)
        : rng.range(0.44, 0.7);
    const phase = rng.range(0, TAU);
    const secondaryPhase = rng.range(0, TAU);

    const waypoints: Array<{ x: number; y: number }> = [
      { x: startX, y: startY },
      { x: startX + 22, y: startY },
    ];
    let previousX = startX + 22;

    for (let index = 1; index < waypointCount; index += 1) {
      const u = index / waypointCount;
      const baseX = startX + span * u;
      const jitter = rng.range(-0.06, 0.06) * nominalSpacing;
      const x = clamp(baseX + jitter, previousX + 18, endX - 44);
      const primary = Math.sin(u * Math.PI * waveCount + phase);
      const secondary = Math.sin(u * Math.PI * waveCount * 2.1 + secondaryPhase);
      const wave = clamp(primary + secondary * 0.22, -1, 1);
      const normalized = clamp(0.5 + 0.5 * wave * amplitude, 0, 1);
      const absY = lerp(lateralMin, lateralMax, normalized);
      waypoints.push({ x, y: side * absY });
      previousX = x;
    }
    waypoints.push({ x: endX - 22, y: endY });
    waypoints.push({ x: endX, y: endY });

    const control = [
      { x: startX - 45, y: startY },
      ...waypoints,
      { x: endX + 45, y: endY },
    ];
    const dense = sampleCatmullRomThrough(control, 2.2);
    if (dense.length < 24) {
      continue;
    }

    let valid = true;
    for (const point of dense) {
      const absY = point.y * side;
      if (
        point.x < startX - 1 ||
        point.x > endX + 1 ||
        absY < 1.2 ||
        absY > maxAbsY + 18
      ) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      if (attempt < 4) {
        debug('corridor invalid', side, attempt);
      }
      continue;
    }

    const length = dense[dense.length - 1].s;
    if (
      length < MIN_ROUTE_LENGTH * 0.8 ||
      length > MAX_ROUTE_LENGTH * 1.05
    ) {
      if (attempt < 4) {
        debug('corridor length', side, length.toFixed(0));
      }
      continue;
    }
    const radius = localMinRadius(dense);
    if (radius < 14) {
      if (attempt < 4) {
        debug('corridor radius', side, radius.toFixed(1));
      }
      continue;
    }
    if (hasGrossSelfIntersection(dense)) {
      if (attempt < 4) {
        debug('corridor self', side);
      }
      continue;
    }

    return dense;
  }

  return null;
}

/**
 * Amostra uma Catmull-Rom uniforme passando pelos pontos de controle. O
 * primeiro/último controle são fantasmas para alinhar a tangente das pontas.
 */
function sampleCatmullRomThrough(
  control: readonly { x: number; y: number }[],
  spacing: number,
): LocalPoint[] {
  const points: LocalPoint[] = [];
  let s = 0;

  for (let index = 1; index < control.length - 2; index += 1) {
    const p0 = control[index - 1];
    const p1 = control[index];
    const p2 = control[index + 1];
    const p3 = control[index + 2];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(4, Math.ceil(distance / spacing));

    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const point = catmullRomPoint(p0, p1, p2, p3, t);
      const last = points[points.length - 1];
      if (last) {
        const delta = Math.hypot(point.x - last.x, point.y - last.y);
        if (delta < 1e-4) {
          continue;
        }
        s += delta;
      }
      points.push({ x: point.x, y: point.y, s });
    }
  }

  return points;
}

function catmullRomPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
}

function localMinRadius(points: readonly LocalPoint[]): number {
  let min = Infinity;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const ab = Math.hypot(abx, aby);
    const bc = Math.hypot(bcx, bcy);
    if (ab < 1e-4 || bc < 1e-4) {
      continue;
    }
    const turn = Math.abs(Math.atan2(abx * bcy - aby * bcx, abx * bcx + aby * bcy));
    if (turn < 1e-5) {
      continue;
    }
    min = Math.min(min, (ab + bc) * 0.5 / turn);
  }
  return Number.isFinite(min) ? min : 999;
}

/* ------------------------------------------------------------------------- */
/* Mapeamento local → mundo                                                  */
/* ------------------------------------------------------------------------- */

function localToWorld(
  local: readonly LocalPoint[],
  pose: Pose,
  elevationAt: (x: number) => number,
  widthAt: (x: number) => number,
  spacing: number,
  baseY: number,
): TrackPoint[] {
  const dense: TrackPoint[] = [];
  for (const point of local) {
    dense.push({
      x: worldX(pose, point.x, point.y),
      z: worldZ(pose, point.x, point.y),
      y: baseY + elevationAt(point.x),
      width: widthAt(point.x),
    });
  }
  return resampleTrackPoints(dense, spacing);
}

function routeWidthAt(
  x: number,
  axisLength: number,
  base: number,
  _routeLength: number,
  phaseSeed: number,
): number {
  const startX = LANE_TRANSITION;
  const endX = axisLength - LANE_TRANSITION;
  const u = clamp((x - startX) / Math.max(1, endX - startX), 0, 1);
  const fade = smoothstep(clamp(u / 0.08, 0, 1)) *
    smoothstep(clamp((1 - u) / 0.08, 0, 1));
  const wave = Math.sin(u * Math.PI * 3.2 + phaseSeed * TAU) * 0.7 +
    Math.sin(u * Math.PI * 7.1 + phaseSeed * 11) * 0.35;
  return clamp(base + wave * fade, MIN_ROUTE_WIDTH, MAX_ROUTE_WIDTH);
}

function elevationProfile(
  x: number,
  axisLength: number,
  route: readonly LocalPoint[],
  phase: number,
): number {
  const routeLength = route[route.length - 1]?.s ?? axisLength;
  const u = clamp(x / Math.max(1, axisLength), 0, 1);
  const fade = Math.sin(Math.PI * u);
  const amplitude = 3.5 + phase * 4.5;
  return fade * fade * (
    amplitude * Math.sin(Math.PI * u) +
    amplitude * 0.35 * Math.sin(Math.PI * 3 * u + phase * 4)
  ) * (0.7 + 0.3 * Math.sin(routeLength * 0.013));
}

function makeWidthProfile(
  rng: Rng,
  span: number,
  base: number,
  strength: number,
): WidthProfile {
  const pulses: WidthPulse[] = [];
  const count = rng.int(1, 3);
  for (let index = 0; index < count; index += 1) {
    pulses.push({
      center: rng.range(0.2, 0.8) * span,
      sigma: rng.range(28, 65),
      amount: rng.range(-2.4, 1.8) * strength,
    });
  }

  return {
    at: (x: number, target: number): number => {
      const fade = smoothstep(clamp(x / 45, 0, 1)) *
        smoothstep(clamp((target - x) / 45, 0, 1));
      let width = base;
      for (const pulse of pulses) {
        const d = (x - pulse.center) / pulse.sigma;
        width += pulse.amount * Math.exp(-d * d) * fade;
      }
      return clamp(width, 5.5, 14.5);
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Resolução de bounds, forks e conteúdo                                    */
/* ------------------------------------------------------------------------- */

interface BlockBounds {
  readonly startS: number;
  readonly endS: number;
}

function resolveBlockBounds(
  track: Track,
  blocks: readonly GeneratedBlock[],
): readonly BlockBounds[] {
  const result: BlockBounds[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const startS = index === 0
      ? 0
      : track.project(block.startPoint.x, block.startPoint.z).s;
    const endS = index === blocks.length - 1
      ? track.length
      : track.project(block.endPoint.x, block.endPoint.z).s;
    result.push({ startS, endS });
  }
  // Corrige pequenas inversões numéricas mantendo a ordem.
  for (let index = 1; index < result.length; index += 1) {
    if (result[index].startS <= result[index - 1].startS) {
      result[index] = {
        startS: result[index - 1].startS + 1,
        endS: result[index].endS,
      };
    }
  }
  result[result.length - 1] = {
    startS: result[result.length - 1].startS,
    endS: track.length,
  };
  return result;
}

function buildContent(
  def: TrackDef,
  track: Track,
  blocks: readonly GeneratedBlock[],
  forkIndexByBlock: ReadonlyMap<number, number>,
): {
  kickers: readonly TrackKicker[];
  powerups: readonly TrackPowerup[];
  hazards: readonly TrackHazard[];
  forks: readonly TrackFork[];
} | null {
  const rng = createRng(0xa11ce + def.points.length * 17);
  const kickers: TrackKicker[] = [];
  const powerups: TrackPowerup[] = [];
  const hazards: TrackHazard[] = [];
  const branchKickers = new Map<number, TrackKicker[]>();

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const bounds = def.blocks?.[index];
    if (!bounds) {
      continue;
    }
    const scenario = block.plan.scenario;

    // Rota A / tronco.
    const aStart = bounds.startS + 45;
    const aEnd = bounds.endS - 45;
    if (aEnd > aStart) {
      maybeAddKicker(
        rng,
        track,
        0,
        aStart,
        aEnd,
        kickers,
        block.fork ? bounds.startS + 90 : aStart,
        block.fork ? bounds.endS - 90 : aEnd,
      );
      placePowerups(rng, track, 0, aStart, aEnd, 1, powerups);
      if (rng.chance(block.fork ? 0.85 : 0.55)) {
        placeHazard(rng, track, 0, scenario, index, aStart, aEnd, hazards);
      }
    }

    const forkIndex = forkIndexByBlock.get(index);
    if (forkIndex === undefined) {
      continue;
    }
    const pathId = forkIndex + 1;
    const branch = track.branches[forkIndex];
    if (!branch) {
      continue;
    }
    const bStart = 45;
    const bEnd = branch.length - 45;
    if (bEnd <= bStart) {
      continue;
    }

    const localKickers: TrackKicker[] = [];
    maybeAddKicker(
      rng,
      track,
      pathId,
      bStart,
      bEnd,
      localKickers,
      bStart + 30,
      bEnd - 30,
    );
    if (localKickers.length > 0) {
      branchKickers.set(pathId, localKickers);
    }
    placePowerups(rng, track, pathId, bStart, bEnd, 1, powerups);
    if (rng.chance(0.9)) {
      placeHazard(rng, track, pathId, scenario, index, bStart, bEnd, hazards);
    }
  }

  if (hazards.length === 0) {
    const index = 0;
    const block = blocks[index];
    const bounds = def.blocks?.[index];
    if (bounds) {
      placeHazard(
        rng,
        track,
        0,
        block.plan.scenario,
        index,
        bounds.startS + 60,
        bounds.endS - 60,
        hazards,
      );
    }
  }

  const forks: TrackFork[] = (def.forks ?? []).map((fork, index) => {
    const branch = fork.branches[0];
    const local = branchKickers.get(index + 1) ?? [];
    return {
      ...fork,
      branches: [
        {
          ...branch,
          kickers: local,
        },
      ],
    };
  });

  return { kickers, powerups, hazards, forks };
}

function maybeAddKicker(
  rng: Rng,
  track: Track,
  pathId: number,
  from: number,
  to: number,
  out: TrackKicker[],
  safeFrom: number,
  safeTo: number,
): void {
  if (!rng.chance(0.55)) {
    return;
  }
  const min = Math.max(from, safeFrom);
  const max = Math.min(to, safeTo);
  if (max - min < 80) {
    return;
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const s = rng.range(min, max);
    if (!isStraightAt(track, pathId, s, 28)) {
      continue;
    }
    if (!isStraightAt(track, pathId, s + 8, 28)) {
      continue;
    }
    const length = rng.range(6, 10);
    if (s + length + 40 > track.pathLength(pathId)) {
      continue;
    }
    if (!isStraightAt(track, pathId, s + length + 26, 30)) {
      continue;
    }
    out.push({
      s,
      length,
      height: rng.range(1.1, 2.2),
      pathId,
    });
    return;
  }
}

function placePowerups(
  rng: Rng,
  track: Track,
  pathId: number,
  from: number,
  to: number,
  count: number,
  out: TrackPowerup[],
): void {
  for (let index = 0; index < count; index += 1) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const s = rng.range(from, to);
      const length = track.pathLength(pathId);
      if (s < 20 || s > length - 20) {
        continue;
      }
      const width = track.widthAtPath(pathId, s);
      const u = rng.range(-0.28, 0.28) * width;
      out.push({
        type: rng.chance(0.55) ? 'turbo' : 'grip',
        s,
        u,
        pathId,
      });
      break;
    }
  }
}

function placeHazard(
  rng: Rng,
  track: Track,
  pathId: number,
  scenario: ScenarioId,
  zoneIndex: number,
  from: number,
  to: number,
  out: TrackHazard[],
): void {
  const length = track.pathLength(pathId);
  const minimum = Math.max(30, from);
  const maximum = Math.min(length - 30, to);
  if (maximum <= minimum) {
    return;
  }
  const kind = rng.pick(SCENARIOS[scenario].hazardKinds);
  const dimensions = HAZARD_RADII[kind];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const s = rng.range(minimum, maximum);
    if (
      out.some(
        (hazard) =>
          (hazard.pathId ?? 0) === pathId && Math.abs(hazard.s - s) < 70,
      )
    ) {
      continue;
    }
    out.push({
      id: `hazard-${zoneIndex + 1}-${pathId}-${kind}`,
      kind,
      zoneIndex,
      scenario,
      s,
      direction: rng.sign() as 1 | -1,
      speed: HAZARD_SPEEDS[kind],
      radius: dimensions.radius,
      height: dimensions.height,
      pathId,
    });
    return;
  }
}

function isStraightAt(track: Track, pathId: number, s: number, window: number): boolean {
  const length = track.pathLength(pathId);
  const from = clamp(s - window, 0, length);
  const to = clamp(s + window, 0, length);
  const a = track.sampleAtPath(pathId, from);
  const aHeading = Math.atan2(a.tangent.x, a.tangent.z);
  const b = track.sampleAtPath(pathId, to);
  const bHeading = Math.atan2(b.tangent.x, b.tangent.z);
  return Math.abs(shortestAngle(aHeading, bHeading)) < 0.16;
}

function chooseSplits(
  blocks: readonly TrackBlock[],
  length: number,
  gold: number,
): readonly TrackSplit[] {
  const boundaries = blocks
    .slice(0, -1)
    .map((block) => block.endS)
    .filter((s) => s > 120 && s < length - 120);
  if (boundaries.length < 3) {
    return boundaries.map((s, index) => ({
      s,
      name: `Parcial ${index + 1}`,
      target: round1((gold * s) / length),
    }));
  }

  const chosen: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const target = length * ((index + 1) / 4);
    let best = boundaries[0];
    let bestDistance = Infinity;
    for (const boundary of boundaries) {
      if (chosen.some((value) => Math.abs(value - boundary) < 1)) {
        continue;
      }
      const distance = Math.abs(boundary - target);
      if (distance < bestDistance) {
        best = boundary;
        bestDistance = distance;
      }
    }
    chosen.push(best);
  }
  chosen.sort((a, b) => a - b);

  return chosen.map((s, index) => ({
    s,
    name: `Parcial ${index + 1}`,
    target: round1((gold * s) / length),
  }));
}

function buildMedals(length: number): MedalTargets {
  const gold = round1(length / 33.5);
  return {
    gold,
    silver: round1(gold * 1.12),
    bronze: round1(gold * 1.24),
  };
}

/* ------------------------------------------------------------------------- */
/* Validação                                                                 */
/* ------------------------------------------------------------------------- */

function validateGenerated(def: TrackDef): boolean {
  const track = buildQuietTrack(def);
  if (V3_DEBUG && def.forks?.[0]) {
    const route = track.branches[0];
    const noForks = buildQuietTrack({ ...def, forks: [] });
    debug(
      'geom',
      `points=${def.points.length}`,
      `len=${track.length.toFixed(1)}`,
      `noForksLen=${noForks.length.toFixed(1)}`,
      `startS=${route?.startS.toFixed(1)}`,
      `track=(${track.sampleAt(route?.startS ?? 0).position.x.toFixed(1)},${track.sampleAt(route?.startS ?? 0).position.z.toFixed(1)})`,
      `noForks=(${noForks.sampleAt(route?.startS ?? 0).position.x.toFixed(1)},${noForks.sampleAt(route?.startS ?? 0).position.z.toFixed(1)})`,
    );
  }
  if (track.length < MIN_TRACK_LENGTH || track.length > MAX_TRACK_LENGTH) {
    debug('validate len', track.length.toFixed(0));
    return false;
  }
  if ((def.blocks ?? []).filter((block) => block.kind === 'split').length === 0) {
    debug('validate sem split');
    return false;
  }
  if (hasTrunkSelfIntersection(track)) {
    debug('validate trunk self');
    return false;
  }

  for (const fork of def.forks ?? []) {
    for (const branch of fork.branches) {
      const route = track.branches.find((entry) => entry.id === branch.id);
      if (!route) {
        debug('validate sem rota', branch.id);
        return false;
      }
      if (route.length < MIN_ROUTE_LENGTH || route.length > MAX_ROUTE_LENGTH) {
        debug('validate rota len', branch.id, route.length.toFixed(0));
        return false;
      }
      const width = minWidth(route);
      if (width < MIN_ROUTE_WIDTH - 0.05) {
        debug('validate rota width', branch.id, width.toFixed(2));
        return false;
      }
      const radius = minRadius(route);
      if (radius < 9.0) {
        debug('validate rota radius', branch.id, radius.toFixed(1));
        return false;
      }
      const slope = maxSlope(route);
      if (slope > 1.2) {
        debug('validate rota slope', branch.id, slope.toFixed(2));
        return false;
      }
      if (hasGrossTrackSelfIntersection(route)) {
        debug('validate rota self', branch.id);
        return false;
      }

      const first = route.sampleAt(0);
      const firstX = first.position.x;
      const firstZ = first.position.z;
      const firstHeading = Math.atan2(first.tangent.x, first.tangent.z);
      const last = route.sampleAt(route.length);
      const lastX = last.position.x;
      const lastZ = last.position.z;
      const lastHeading = Math.atan2(last.tangent.x, last.tangent.z);

      const startTrunkSample = track.sampleAt(route.startS);
      const startTrunkX = startTrunkSample.position.x;
      const startTrunkZ = startTrunkSample.position.z;
      const startTrunkHeading = Math.atan2(
        startTrunkSample.tangent.x,
        startTrunkSample.tangent.z,
      );
      const endTrunkSample = track.sampleAt(route.endS);
      const endTrunkX = endTrunkSample.position.x;
      const endTrunkZ = endTrunkSample.position.z;
      const endTrunkHeading = Math.atan2(
        endTrunkSample.tangent.x,
        endTrunkSample.tangent.z,
      );

      const startOffset = Math.hypot(
        firstX - startTrunkX,
        firstZ - startTrunkZ,
      );
      const endOffset = Math.hypot(
        lastX - endTrunkX,
        lastZ - endTrunkZ,
      );
      if (Math.abs(startOffset - route.width * 0.5) > 3.5) {
        debug(
          'validate start offset',
          branch.id,
          startOffset.toFixed(1),
          route.width,
          `startS=${route.startS.toFixed(1)}`,
          `trunk=(${startTrunkX.toFixed(1)},${startTrunkZ.toFixed(1)})`,
          `first=(${firstX.toFixed(1)},${firstZ.toFixed(1)})`,
        );
        return false;
      }
      if (Math.abs(endOffset - route.width * 0.5) > 3.5) {
        debug('validate end offset', branch.id, endOffset.toFixed(1), route.width);
        return false;
      }
      if (Math.abs(shortestAngle(firstHeading, startTrunkHeading)) > 0.4) {
        debug('validate start tangent', branch.id);
        return false;
      }
      if (Math.abs(shortestAngle(lastHeading, endTrunkHeading)) > 0.4) {
        debug('validate end tangent', branch.id);
        return false;
      }
    }
  }

  return true;
}

function minWidth(route: { length: number; widthAt: (s: number) => number }): number {
  let min = Infinity;
  for (let s = 0; s <= route.length; s += 2) {
    min = Math.min(min, route.widthAt(s));
  }
  return min;
}

function minRadius(route: { length: number; sampleAt: (s: number) => { tangent: { x: number; z: number } } }): number {
  let min = Infinity;
  let previous = route.sampleAt(0);
  let previousHeading = Math.atan2(previous.tangent.x, previous.tangent.z);
  for (let s = 2; s <= route.length; s += 2) {
    const sample = route.sampleAt(s);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    const delta = Math.abs(shortestAngle(previousHeading, heading));
    if (delta > 1e-5) {
      min = Math.min(min, 2 / delta);
    }
    previousHeading = heading;
  }
  return Number.isFinite(min) ? min : 999;
}

function maxSlope(route: { length: number; heightAt: (s: number, u: number) => number }): number {
  let max = 0;
  let previous = route.heightAt(0, 0);
  for (let s = 2; s <= route.length; s += 2) {
    const height = route.heightAt(s, 0);
    max = Math.max(max, Math.abs(height - previous) / 2);
    previous = height;
  }
  return max;
}

function hasGrossTrackSelfIntersection(route: {
  length: number;
  sampleAt: (s: number) => { position: { x: number; z: number } };
}): boolean {
  const samples: Array<{ x: number; z: number; s: number }> = [];
  for (let s = 0; s <= route.length; s += 4) {
    const sample = route.sampleAt(s);
    samples.push({ x: sample.position.x, z: sample.position.z, s });
  }
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      if (samples[j].s - samples[i].s < 45) {
        continue;
      }
      const dx = samples[j].x - samples[i].x;
      const dz = samples[j].z - samples[i].z;
      if (dx * dx + dz * dz < 7 * 7) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Autointerseção do eixo lógico. Os blocos lineares podem curvar de volta e
 * cruzar um trecho anterior; isso é rejeitado na geração, não só avisado no
 * console do `Track`.
 */
function hasTrunkSelfIntersection(track: Track): boolean {
  const samples: Array<{ x: number; z: number; s: number }> = [];
  for (let s = 0; s <= track.length; s += 3) {
    const sample = track.sampleAt(s);
    samples.push({ x: sample.position.x, z: sample.position.z, s });
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    for (let j = i + 2; j < samples.length - 1; j += 1) {
      if (samples[j].s - a.s < 55) {
        continue;
      }
      const c = samples[j];
      const d = samples[j + 1];
      if (segmentsIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) {
        return true;
      }
    }
  }

  return false;
}

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
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/* ------------------------------------------------------------------------- */
/* Helpers geométricos                                                       */
/* ------------------------------------------------------------------------- */

function appendLocalStraight(
  points: LocalPoint[],
  state: { x: number; y: number; heading: number; s: number },
  length: number,
): void {
  const steps = Math.max(2, Math.ceil(length / 2.5));
  const step = length / steps;
  for (let index = 0; index < steps; index += 1) {
    // x = avanço, y = lateral direita. heading 0 aponta para +x.
    state.x += Math.cos(state.heading) * step;
    state.y += Math.sin(state.heading) * step;
    state.s += step;
    points.push({ x: state.x, y: state.y, s: state.s });
  }
}

function appendFixedStraight(
  points: LocalPoint[],
  state: { x: number; y: number; s: number },
  length: number,
  y: number,
): void {
  const steps = Math.max(2, Math.ceil(length / 2.5));
  const step = length / steps;
  for (let index = 0; index < steps; index += 1) {
    state.x += step;
    state.s += step;
    points.push({ x: state.x, y, s: state.s });
  }
}

function appendLocalArc(
  points: LocalPoint[],
  state: { x: number; y: number; heading: number; s: number },
  radius: number,
  sweep: number,
  turn: 1 | -1,
): void {
  const length = radius * sweep;
  const steps = Math.max(4, Math.ceil(length / 2.5));
  const step = length / steps;
  const delta = (turn * sweep) / steps;
  for (let index = 0; index < steps; index += 1) {
    const mid = state.heading + delta * 0.5;
    state.x += Math.cos(mid) * step;
    state.y += Math.sin(mid) * step;
    state.heading += delta;
    state.s += step;
    points.push({ x: state.x, y: state.y, s: state.s });
  }
}

function hasGrossSelfIntersection(points: readonly LocalPoint[]): boolean {
  for (let i = 0; i < points.length; i += 2) {
    for (let j = i + 16; j < points.length; j += 2) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      if (dx * dx + dy * dy < 6 * 6) {
        return true;
      }
    }
  }
  return false;
}

function resampleTrackPoints(points: readonly TrackPoint[], spacing: number): TrackPoint[] {
  if (points.length <= 2) {
    return [...points];
  }
  const result: TrackPoint[] = [points[0]];
  let accumulated = 0;
  let previous = points[0];

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    let segment = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (segment < 1e-5) {
      continue;
    }
    while (accumulated + segment >= spacing) {
      const t = (spacing - accumulated) / segment;
      const x = lerp(previous.x, current.x, t);
      const z = lerp(previous.z, current.z, t);
      const y = lerp(previous.y, current.y, t);
      const width = lerp(previous.width, current.width, t);
      result.push({ x, z, y, width });
      const consumed = spacing - accumulated;
      segment -= consumed;
      accumulated = 0;
      previous = { x, z, y, width };
    }
    accumulated += segment;
    previous = current;
  }

  const last = points[points.length - 1];
  const tail = result[result.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > 1) {
    result.push(last);
  }
  return result;
}

function polylineLength(points: readonly TrackPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].z - points[index - 1].z,
    );
  }
  return length;
}

function appendPoints(target: TrackPoint[], points: readonly TrackPoint[]): void {
  for (const point of points) {
    const last = target[target.length - 1];
    if (last && Math.hypot(point.x - last.x, point.z - last.z) < 0.4) {
      continue;
    }
    target.push(point);
  }
}

function worldX(pose: Pose, forward: number, right: number): number {
  return pose.x + Math.sin(pose.heading) * forward + Math.cos(pose.heading) * right;
}

function worldZ(pose: Pose, forward: number, right: number): number {
  return pose.z + Math.cos(pose.heading) * forward - Math.sin(pose.heading) * right;
}

function endHeading(pose: Pose, local: readonly LocalPoint[]): number {
  const a = local[Math.max(0, local.length - 2)];
  const b = local[local.length - 1];
  const dx = worldX(pose, b.x, b.y) - worldX(pose, a.x, a.y);
  const dz = worldZ(pose, b.x, b.y) - worldZ(pose, a.x, a.y);
  return Math.atan2(dx, dz);
}

function buildQuietTrack(def: TrackDef): Track {
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

function pickCurveCategory(
  rng: Rng,
  profile: RouteProfile,
  _index: number,
): CurveCategory {
  const roll = rng.next();
  if (profile === 'tight') {
    if (roll < 0.26) return 'short';
    if (roll < 0.52) return 'elbow';
    if (roll < 0.7) return 'medium';
    if (roll < 0.88) return 'long';
    return 'kink';
  }
  if (profile === 'fast') {
    if (roll < 0.38) return 'long';
    if (roll < 0.68) return 'medium';
    if (roll < 0.82) return 'kink';
    if (roll < 0.94) return 'short';
    return 'elbow';
  }
  if (roll < 0.3) return 'long';
  if (roll < 0.56) return 'medium';
  if (roll < 0.74) return 'short';
  if (roll < 0.9) return 'elbow';
  return 'kink';
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from + Math.PI) % TAU;
  if (delta < 0) {
    delta += TAU;
  }
  return delta - Math.PI;
}

function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng.next() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
