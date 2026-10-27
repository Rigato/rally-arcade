import type {
  CameraTuning,
  CarTuning,
  InputTuning,
  PowerupTuning,
  RaceTuning,
  SurfaceDef,
  SurfaceId,
  Vec2,
} from './types';

/** Loop de simulação e orçamento de renderização. */
export const SIMULATION = {
  fixedHz: 120,
  maxFrameDeltaSeconds: 0.25,
} as const;

export const RENDER_SETTINGS = {
  maxPixelRatio: 2,
  background: 0x0e1418,
  fogColor: 0x0e1418,
  fogNear: 45,
  fogFar: 190,
  groundSize: 600,
  groundColor: 0x39463d,
  gridColor: 0x84968a,
  gridDivisions: 120,
} as const;

/** Largada da arena de teste do M1a. Heading 0 = +Z. */
export const CAR_START: { position: Vec2; heading: number } = {
  position: { x: 0, z: 0 },
  heading: 0,
};

/** Valores iniciais da seção 4 do plano. Nenhum é definitivo. */
export const CAR_TUNING: CarTuning = {
  engineAcceleration: 10,
  maxSpeed: 34,
  dragCoefficient: 0.003,
  rollingResistance: 0.5,
  maxYawRate: 2.0,
  steerResponseTau: 0.1,
  steerSpeedReference: 6,
  steerHighSpeedReduction: 0.4,
  brakeMax: 12,
  brakeRampStart: 3.5,
  brakeRampDuration: 0.55,
  airGravity: 24,
  handbrakeGripMultiplier: 0.28,
  handbrakeBrake: 4.0,
};

/** Pisos da seção 4: grip (1/s), multiplicadores de aceleração/arrasto e bump. */
export const SURFACES: Record<SurfaceId, SurfaceDef> = {
  gravel: {
    id: 'gravel',
    label: 'Cascalho',
    grip: 6.5,
    acceleration: 1.0,
    drag: 1.0,
    bump: 0.6,
    steerMultiplier: 1.0,
  },
  sand: {
    id: 'sand',
    label: 'Areia',
    grip: 3.8,
    acceleration: 0.85,
    drag: 1.25,
    bump: 0.9,
    steerMultiplier: 0.95,
  },
  'forest-offroad': {
    id: 'forest-offroad',
    label: 'Fora da pista — floresta',
    grip: 3.4,
    acceleration: 0.8,
    drag: 1.7,
    bump: 1.4,
    steerMultiplier: 0.9,
  },
  'desert-offroad': {
    id: 'desert-offroad',
    label: 'Fora da pista — deserto',
    grip: 2.7,
    acceleration: 0.7,
    drag: 2.0,
    bump: 1.8,
    steerMultiplier: 0.85,
  },
};

/**
 * Câmera calibrada para portrait: mantém o carro a ~67% da altura da tela.
 * A altura alta compensa o lookAhead curto e ainda mostra bastante pista à frente.
 */
export const CAMERA_TUNING: CameraTuning = {
  distance: 12,
  height: 12.8,
  lookAhead: 5.2,
  lookHeight: 1.0,
  pitchDeg: 48.1,
  positionTau: 0.12,
  yawTau: 0.35,
  fov: 60,
  speedFovBoost: 3,
  turboFovBoost: 6,
  minGroundClearance: 2.0,
};

export const INPUT_TUNING: InputTuning = {
  steerLockScreenRatio: 0.32,
  steerDeadzonePx: 5,
  steerSmoothingTau: 0.08,
  handbrakeScreenRatio: 1.1,
  handbrakeMode: 'drag',
};

export const POWERUP_TUNING: PowerupTuning = {
  turboSpeedMultiplier: 1.3,
  turboAccelerationMultiplier: 1.3,
  turboDuration: 2.0,
  gripMultiplier: 1.8,
  gripDuration: 10.0,
};

export const RACE_TUNING: RaceTuning = {
  splitTarget: 21.0,
  medals: {
    gold: 43.0,
    silver: 49.0,
    bronze: 57.0,
  },
  worldLimit: 24,
  recoveryPenalty: 1.2,
};
