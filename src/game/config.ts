import type {
  CameraTuning,
  CarTuning,
  InputTuning,
  PowerupTuning,
  RaceTuning,
  SurfaceDef,
  SurfaceId,
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
  gridColor: 0x536157,
  gridDivisions: 120,
} as const;

/** Valores iniciais da seção 4 do plano. Nenhum é definitivo. */
export const CAR_TUNING: CarTuning = {
  engineAcceleration: 10,
  maxSpeed: 34,
  dragCoefficient: 0.003,
  rollingResistance: 0.5,
  maxYawRate: 2.0,
  steerResponseTau: 0.1,
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
  },
  sand: {
    id: 'sand',
    label: 'Areia',
    grip: 3.8,
    acceleration: 0.85,
    drag: 1.25,
    bump: 0.9,
  },
  'forest-offroad': {
    id: 'forest-offroad',
    label: 'Fora da pista — floresta',
    grip: 3.4,
    acceleration: 0.8,
    drag: 1.7,
    bump: 1.4,
  },
  'desert-offroad': {
    id: 'desert-offroad',
    label: 'Fora da pista — deserto',
    grip: 2.7,
    acceleration: 0.7,
    drag: 2.0,
    bump: 1.8,
  },
};

export const CAMERA_TUNING: CameraTuning = {
  distance: 8.0,
  height: 9.0,
  lookAhead: 6.0,
  lookHeight: 1.2,
  pitchDeg: 48.4,
  positionTau: 0.12,
  yawTau: 0.35,
  fov: 60,
  turboFovBoost: 6,
  minGroundClearance: 2.0,
};

export const INPUT_TUNING: InputTuning = {
  steerLockScreenRatio: 0.32,
  steerDeadzonePx: 5,
  steerSmoothingTau: 0.08,
  handbrakeScreenRatio: 1.1,
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
