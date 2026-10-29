import type {
  DustProfile,
  HazardKind,
  ScenarioId,
  SurfaceId,
} from './types';

/** Paleta de céu, névoa e luz de um cenário. Cores em hex sRGB. */
export interface EnvironmentPalette {
  hemiIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
  sky: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunPosition: readonly [number, number, number];
}

/** Cores da pista, do ombro, do terreno de fundo e dos props. */
export interface ScenarioColors {
  road: number;
  shoulder: number;
  edge: number;
  terrain: number;
  rock: readonly number[];
  tree: readonly number[];
  log: readonly number[];
  bush: number;
  drybush: number;
}

export interface GateStyle {
  background: string;
  foreground: string;
  border: string;
}

export type SceneryFamily =
  | 'forest'
  | 'desert'
  | 'snow'
  | 'village'
  | 'dirt'
  | 'beach';

export interface ScenarioDef {
  readonly id: ScenarioId;
  readonly label: string;
  readonly shortLabel: string;
  readonly family: SceneryFamily;
  readonly roadSurface: SurfaceId;
  readonly offroadSurface: SurfaceId;
  readonly colors: ScenarioColors;
  readonly environment: EnvironmentPalette;
  readonly dust: DustProfile;
  readonly gate: GateStyle;
  readonly hazardKinds: readonly HazardKind[];
}

const FOREST: ScenarioDef = {
  id: 'forest',
  label: 'Floresta',
  shortLabel: 'FLORESTA',
  family: 'forest',
  roadSurface: 'gravel',
  offroadSurface: 'forest-offroad',
  colors: {
    road: 0x57534a,
    shoulder: 0x4c6436,
    edge: 0xdfe3cc,
    terrain: 0x465f33,
    rock: [0x9aa09a, 0x767d76, 0xb6b8ae, 0x616864],
    tree: [0x2f5a38, 0x356440, 0x294f32, 0x3b6b45],
    log: [0x6a4a30, 0x755235, 0x5d4029, 0x7d5839],
    bush: 0x3f6a3d,
    drybush: 0x9b8a56,
  },
  environment: {
    hemiIntensity: 1.25,
    sunIntensity: 2.0,
    fogNear: 55,
    fogFar: 235,
    sky: 0xb5c3bf,
    fog: 0xb5c3bf,
    hemiSky: 0xdce9ee,
    hemiGround: 0x36452f,
    sun: 0xfff0d0,
    sunPosition: [28, 42, 18],
  },
  dust: {
    color: 0xc9b48b,
    secondaryColor: 0xa9916b,
    rateMultiplier: 1,
    sizeMultiplier: 1,
    alphaMultiplier: 1,
    lifeMultiplier: 1,
    riseMin: 1.3,
    riseMax: 2.5,
    gravity: 0.2,
    slipStartDeg: 4,
    slipRangeDeg: 20,
  },
  gate: { background: '#1f3326', foreground: '#dceccd', border: '#7fa06a' },
  hazardKinds: ['deer'],
};

const DESERT: ScenarioDef = {
  id: 'desert',
  label: 'Deserto',
  shortLabel: 'DESERTO',
  family: 'desert',
  roadSurface: 'sand',
  offroadSurface: 'desert-offroad',
  colors: {
    road: 0xd4b173,
    shoulder: 0xd6ba85,
    edge: 0xf4e7c3,
    terrain: 0xc9ac75,
    rock: [0xd0c09b, 0xb09d79, 0xdfd2b1, 0x978767],
    tree: [0x4f7d4b, 0x5b8a54, 0x457145, 0x648f5c],
    log: [0x8a6a45, 0x9a7850, 0x7a5b3c],
    bush: 0x9b8a56,
    drybush: 0xa08b58,
  },
  environment: {
    hemiIntensity: 1.35,
    sunIntensity: 2.25,
    fogNear: 50,
    fogFar: 220,
    sky: 0xe9d0a5,
    fog: 0xe6cda5,
    hemiSky: 0xffe5bd,
    hemiGround: 0x9c7a4a,
    sun: 0xffd39a,
    sunPosition: [45, 34, -16],
  },
  dust: {
    // Mais escuro que o chão de areia para o rastro ter contraste.
    color: 0xbf9a63,
    secondaryColor: 0x8a6b42,
    rateMultiplier: 1.05,
    sizeMultiplier: 1.08,
    alphaMultiplier: 0.95,
    lifeMultiplier: 1,
    riseMin: 1.3,
    riseMax: 2.5,
    gravity: 0.2,
    slipStartDeg: 4,
    slipRangeDeg: 20,
  },
  gate: { background: '#22392a', foreground: '#f4e0ae', border: '#d3a765' },
  hazardKinds: ['camel'],
};

const SNOW: ScenarioDef = {
  id: 'snow',
  label: 'Neve',
  shortLabel: 'NEVE',
  family: 'snow',
  roadSurface: 'snow',
  offroadSurface: 'snow-offroad',
  colors: {
    road: 0xc4d0d6,
    shoulder: 0xeaf1f4,
    edge: 0xffffff,
    terrain: 0xe1eaef,
    rock: [0xb9c6cc, 0x98a9b2, 0xd5e0e5, 0x84969f],
    tree: [0x5d7d72, 0x6f9184, 0x4c6a61, 0x8aa79a],
    log: [0x6b5948, 0x7d6a56, 0x574638],
    bush: 0xdfe9ec,
    drybush: 0xb9c9cc,
  },
  environment: {
    hemiIntensity: 1.45,
    sunIntensity: 2.05,
    fogNear: 45,
    fogFar: 190,
    sky: 0xdfeaf0,
    fog: 0xe4eef3,
    hemiSky: 0xf4fbff,
    hemiGround: 0x6f7f8a,
    sun: 0xfff6ec,
    sunPosition: [30, 38, 20],
  },
  dust: {
    color: 0xdceaf2,
    secondaryColor: 0xa8c0d2,
    rateMultiplier: 0.75,
    sizeMultiplier: 0.95,
    alphaMultiplier: 0.78,
    lifeMultiplier: 1.05,
    riseMin: 1.2,
    riseMax: 2.2,
    gravity: 0.15,
    slipStartDeg: 3,
    slipRangeDeg: 16,
  },
  gate: { background: '#263842', foreground: '#eaf7ff', border: '#9fc8dd' },
  hazardKinds: ['reindeer'],
};

const VILLAGE: ScenarioDef = {
  id: 'village',
  label: 'Vilarejo',
  shortLabel: 'VILAREJO',
  family: 'village',
  roadSurface: 'asphalt',
  offroadSurface: 'village-offroad',
  colors: {
    road: 0x4e5255,
    shoulder: 0x6d7a4f,
    edge: 0xf0e6cf,
    terrain: 0x5b6b42,
    rock: [0x9a9d97, 0x7f837d, 0xb4b7ae],
    tree: [0x3d6a3d, 0x4b7b47, 0x315a36],
    log: [0x6b4b33, 0x7a583b, 0x5a3e2a],
    bush: 0x4e7a43,
    drybush: 0x8d8a5e,
  },
  environment: {
    hemiIntensity: 1.2,
    sunIntensity: 1.9,
    fogNear: 55,
    fogFar: 230,
    sky: 0xc8cfc0,
    fog: 0xc8cfc0,
    hemiSky: 0xe6eadf,
    hemiGround: 0x3d4a34,
    sun: 0xffe3b0,
    sunPosition: [35, 36, 10],
  },
  dust: {
    color: 0x9a9388,
    secondaryColor: 0x6f6a62,
    rateMultiplier: 0.22,
    sizeMultiplier: 0.6,
    alphaMultiplier: 0.55,
    lifeMultiplier: 0.7,
    riseMin: 0.8,
    riseMax: 1.4,
    gravity: 0.25,
    slipStartDeg: 7,
    slipRangeDeg: 22,
  },
  gate: { background: '#2b2f35', foreground: '#f3e9d2', border: '#b7a37a' },
  hazardKinds: ['car', 'truck'],
};

const DIRT: ScenarioDef = {
  id: 'dirt',
  label: 'Estrada de terra',
  shortLabel: 'TERRA',
  family: 'dirt',
  roadSurface: 'dirt',
  offroadSurface: 'dirt-offroad',
  colors: {
    road: 0x8a6540,
    shoulder: 0x8a8a4a,
    edge: 0xe8d7a8,
    terrain: 0x7d7a3f,
    rock: [0xa89a7d, 0x8e8068, 0xc0b292],
    tree: [0x4b6d38, 0x5b7d43, 0x3d5c30],
    log: [0x745033, 0x855f3e, 0x63442c],
    bush: 0x7d7a43,
    drybush: 0xb09a5f,
  },
  environment: {
    hemiIntensity: 1.25,
    sunIntensity: 2.15,
    fogNear: 50,
    fogFar: 220,
    sky: 0xd8c8a8,
    fog: 0xd8c8a8,
    hemiSky: 0xffe9c6,
    hemiGround: 0x6e5c3a,
    sun: 0xffcf8a,
    sunPosition: [40, 32, -12],
  },
  dust: {
    color: 0xb07a4c,
    secondaryColor: 0x7d5532,
    rateMultiplier: 1.2,
    sizeMultiplier: 1.1,
    alphaMultiplier: 1.05,
    lifeMultiplier: 1.05,
    riseMin: 1.4,
    riseMax: 2.7,
    gravity: 0.2,
    slipStartDeg: 3.5,
    slipRangeDeg: 20,
  },
  gate: { background: '#3a2d20', foreground: '#f2dfb8', border: '#c18b4c' },
  hazardKinds: ['tractor', 'cow'],
};

const BEACH: ScenarioDef = {
  id: 'beach',
  label: 'Praia',
  shortLabel: 'PRAIA',
  family: 'beach',
  roadSurface: 'beach-sand',
  offroadSurface: 'beach-offroad',
  colors: {
    road: 0xc9ad72,
    shoulder: 0xe6d3a4,
    edge: 0xfff4d8,
    terrain: 0xdcc58f,
    rock: [0xb6ab94, 0x9c927e, 0xd0c4a8],
    tree: [0x4f7d4b, 0x5f8e55, 0x3f6c42],
    log: [0x9a7a52, 0xae8d61, 0x886a47],
    bush: 0x9c9a62,
    drybush: 0xb3a573,
  },
  environment: {
    hemiIntensity: 1.4,
    sunIntensity: 2.35,
    fogNear: 55,
    fogFar: 230,
    sky: 0xbfe3ea,
    fog: 0xc9e8ee,
    hemiSky: 0xe9ffff,
    hemiGround: 0xb59a6b,
    sun: 0xfff2cf,
    sunPosition: [50, 40, -15],
  },
  dust: {
    color: 0xeed7a2,
    secondaryColor: 0xc2a574,
    rateMultiplier: 0.9,
    sizeMultiplier: 0.85,
    alphaMultiplier: 0.72,
    lifeMultiplier: 0.95,
    riseMin: 1.1,
    riseMax: 2.1,
    gravity: 0.18,
    slipStartDeg: 3.5,
    slipRangeDeg: 18,
  },
  gate: { background: '#1f3a42', foreground: '#eafcff', border: '#8fd4d8' },
  hazardKinds: ['buggy'],
};

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  forest: FOREST,
  desert: DESERT,
  snow: SNOW,
  village: VILLAGE,
  dirt: DIRT,
  beach: BEACH,
};

export const SCENARIO_IDS: readonly ScenarioId[] = [
  'forest',
  'desert',
  'snow',
  'village',
  'dirt',
  'beach',
];

/** Perfis de poeira por superfície (estrada e fora de pista). */
export const DUST_PROFILES: Record<SurfaceId, DustProfile> = {
  gravel: FOREST.dust,
  sand: DESERT.dust,
  snow: SNOW.dust,
  asphalt: VILLAGE.dust,
  dirt: DIRT.dust,
  'beach-sand': BEACH.dust,
  'forest-offroad': {
    color: 0xa89a7c,
    secondaryColor: 0x7b6b4f,
    rateMultiplier: 1.25,
    sizeMultiplier: 1.1,
    alphaMultiplier: 1.05,
    lifeMultiplier: 1.05,
    riseMin: 1.2,
    riseMax: 2.4,
    gravity: 0.2,
    slipStartDeg: 4,
    slipRangeDeg: 20,
  },
  'desert-offroad': {
    color: 0xc9a76a,
    secondaryColor: 0x8a6b42,
    rateMultiplier: 1.25,
    sizeMultiplier: 1.12,
    alphaMultiplier: 1.05,
    lifeMultiplier: 1.05,
    riseMin: 1.2,
    riseMax: 2.4,
    gravity: 0.2,
    slipStartDeg: 4,
    slipRangeDeg: 20,
  },
  'snow-offroad': {
    color: 0xc8dbe8,
    secondaryColor: 0x93adc0,
    rateMultiplier: 1,
    sizeMultiplier: 1.1,
    alphaMultiplier: 0.85,
    lifeMultiplier: 1.1,
    riseMin: 1.1,
    riseMax: 2.2,
    gravity: 0.15,
    slipStartDeg: 3,
    slipRangeDeg: 16,
  },
  'village-offroad': {
    color: 0x8a8a6d,
    secondaryColor: 0x62624e,
    rateMultiplier: 0.9,
    sizeMultiplier: 1,
    alphaMultiplier: 0.9,
    lifeMultiplier: 0.9,
    riseMin: 1,
    riseMax: 2,
    gravity: 0.22,
    slipStartDeg: 5,
    slipRangeDeg: 20,
  },
  'dirt-offroad': {
    color: 0x9a6b42,
    secondaryColor: 0x6b4829,
    rateMultiplier: 1.4,
    sizeMultiplier: 1.18,
    alphaMultiplier: 1.1,
    lifeMultiplier: 1.1,
    riseMin: 1.4,
    riseMax: 2.8,
    gravity: 0.2,
    slipStartDeg: 3.5,
    slipRangeDeg: 20,
  },
  'beach-offroad': {
    color: 0xe0c58c,
    secondaryColor: 0xb19360,
    rateMultiplier: 1.15,
    sizeMultiplier: 1.05,
    alphaMultiplier: 1,
    lifeMultiplier: 1,
    riseMin: 1.1,
    riseMax: 2.2,
    gravity: 0.18,
    slipStartDeg: 3.5,
    slipRangeDeg: 18,
  },
};

/** Rótulo curto de cenário usado no HUD/telemetria. */
export function scenarioLabel(id: ScenarioId): string {
  return SCENARIOS[id]?.label ?? id;
}
