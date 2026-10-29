import type {
  BodyTuning,
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
} as const;

/** Valores iniciais da seção 4 do plano. Nenhum é definitivo. */
export const CAR_TUNING: CarTuning = {
  // v5: +15% no motor, na velocidade máxima e no freio (playtest).
  engineAcceleration: 11.5,
  maxSpeed: 39.1,
  dragCoefficient: 0.003,
  rollingResistance: 0.5,
  maxYawRate: 2.2,
  // Mais lento para entrar na curva: evita o efeito chicote no toque.
  steerResponseTau: 0.15,
  steerSpeedReference: 8,
  steerHighSpeedReduction: 0.38,
  brakeMax: 13.8,
  brakeRampStart: 3.5,
  brakeRampDuration: 0.55,
  airGravity: 24,
  // Carro claramente solto de traseira, mas ainda recuperável no contra-esterço.
  handbrakeGripMultiplier: 0.23,
  handbrakeBrake: 3.5,
  slipGripFalloff: 0.30,
  brakeGripReduction: 0.15,
  // Esterço cheio solta a traseira e o boost inicia a rotação.
  steerGripReduction: 0.18,
  yawBoost: 0.10,
};

/** Pisos da seção 4: grip (1/s), multiplicadores de aceleração/arrasto e bump. */
export const SURFACES: Record<SurfaceId, SurfaceDef> = {
  gravel: {
    id: 'gravel',
    label: 'Cascalho',
    grip: 4.6,
    acceleration: 1.0,
    drag: 1.0,
    bump: 0.6,
    steerMultiplier: 1.0,
    speedLimit: 1.0,
    offRoadBrake: 0,
  },
  sand: {
    id: 'sand',
    label: 'Areia',
    grip: 2.9,
    acceleration: 0.85,
    drag: 1.25,
    bump: 0.9,
    steerMultiplier: 0.95,
    speedLimit: 0.92,
    offRoadBrake: 0,
  },
  snow: {
    id: 'snow',
    label: 'Neve',
    grip: 2.35,
    acceleration: 0.82,
    drag: 1.15,
    bump: 0.35,
    steerMultiplier: 0.9,
    speedLimit: 0.95,
    offRoadBrake: 0,
  },
  asphalt: {
    id: 'asphalt',
    label: 'Asfalto',
    grip: 6.1,
    acceleration: 1.08,
    drag: 0.9,
    bump: 0.22,
    steerMultiplier: 1.04,
    speedLimit: 1,
    offRoadBrake: 0,
  },
  dirt: {
    id: 'dirt',
    label: 'Estrada de terra',
    grip: 3.55,
    acceleration: 0.92,
    drag: 1.15,
    bump: 1.0,
    steerMultiplier: 0.96,
    speedLimit: 0.96,
    offRoadBrake: 0,
  },
  'beach-sand': {
    id: 'beach-sand',
    label: 'Areia de praia',
    grip: 2.55,
    acceleration: 0.82,
    drag: 1.3,
    bump: 0.65,
    steerMultiplier: 0.93,
    speedLimit: 0.9,
    offRoadBrake: 0,
  },
  'forest-offroad': {
    id: 'forest-offroad',
    label: 'Fora da pista — floresta',
    grip: 2.2,
    acceleration: 0.8,
    drag: 1.7,
    bump: 1.4,
    steerMultiplier: 0.9,
    speedLimit: 0.65,
    offRoadBrake: 10.0,
  },
  'desert-offroad': {
    id: 'desert-offroad',
    label: 'Fora da pista — deserto',
    grip: 1.8,
    acceleration: 0.7,
    drag: 2.0,
    bump: 1.8,
    steerMultiplier: 0.85,
    speedLimit: 0.62,
    offRoadBrake: 8.0,
  },
  'snow-offroad': {
    id: 'snow-offroad',
    label: 'Fora da pista — neve',
    grip: 1.45,
    acceleration: 0.6,
    drag: 2.0,
    bump: 1.25,
    steerMultiplier: 0.82,
    speedLimit: 0.5,
    offRoadBrake: 12.0,
  },
  'village-offroad': {
    id: 'village-offroad',
    label: 'Fora da pista — vilarejo',
    grip: 2.8,
    acceleration: 0.8,
    drag: 1.6,
    bump: 1.0,
    steerMultiplier: 0.92,
    speedLimit: 0.68,
    offRoadBrake: 9.0,
  },
  'dirt-offroad': {
    id: 'dirt-offroad',
    label: 'Fora da pista — estrada de terra',
    grip: 2.0,
    acceleration: 0.7,
    drag: 2.2,
    bump: 1.7,
    steerMultiplier: 0.86,
    speedLimit: 0.55,
    offRoadBrake: 11.0,
  },
  'beach-offroad': {
    id: 'beach-offroad',
    label: 'Fora da pista — praia',
    grip: 1.55,
    acceleration: 0.6,
    drag: 2.4,
    bump: 0.95,
    steerMultiplier: 0.8,
    speedLimit: 0.5,
    offRoadBrake: 12.0,
  },
};

/** Ajustes globais dos efeitos de poeira (painel de debug e testes). */
export const DUST_TUNING = {
  enabled: true,
  rateScale: 1,
  sizeScale: 1,
  alphaScale: 1,
};

/** Parâmetros das bifurcações procedurais. */
export const FORK_TUNING = {
  minLaneWidth: 5.5,
  branchWidth: 6.4,
  maxForks: 2,
};

/** Parâmetros dos obstáculos móveis. */
export const HAZARD_TUNING = {
  enabled: true,
  zoneChance: 0.28,
  maxPerRun: 3,
  triggerDistance: 72,
  minStartClearance: 130,
  finishClearance: 90,
};

/**
 * Câmera calibrada para portrait: mantém o carro a ~67–69% da altura da tela.
 * M3b: distância/altura/look-ahead maiores para enquadrar o cenário novo e
 * ler os saltos, mantendo a pista no centro.
 */
export const CAMERA_TUNING: CameraTuning = {
  distance: 15.5,
  height: 15.2,
  lookAhead: 7.5,
  lookHeight: 0.8,
  pitchDeg: 44.0,
  positionTau: 0.12,
  // Um pouco mais de folga no yaw: a derrapagem fica legível, sem chicote.
  yawTau: 0.42,
  fov: 60,
  speedFovBoost: 3,
  turboFovBoost: 6,
  minGroundClearance: 2.2,
};

export const INPUT_TUNING: InputTuning = {
  steerSmoothingTau: 0.16,
  brakeSmoothingTau: 0.1,
};

/** Rolagem/pitch apenas visuais da carroceria. */
export const BODY_TUNING: BodyTuning = {
  maxRollDeg: 12,
  maxPitchDeg: 5,
  rollPerLateralAccel: 0.014,
  pitchPerLongAccel: 0.007,
  rollPerSteer: 0.03,
};

export const POWERUP_TUNING: PowerupTuning = {
  turboSpeedMultiplier: 1.3,
  turboAccelerationMultiplier: 1.3,
  turboDuration: 2.0,
  gripMultiplier: 1.8,
  gripDuration: 10.0,
};

export const RACE_TUNING: RaceTuning = {
  // Reserva: os alvos reais vêm de `TrackDef.splits` (autorados na pista).
  splitTarget: 13.5,
  medals: {
    gold: 55.0,
    silver: 62.0,
    bronze: 72.0,
  },
  // Reservado: o plano previa 24 m fixos. O limite real é medido a partir da
  // borda da pista (ombro visual de 12 m) e fica em `offTrackLimit`.
  worldLimit: 24,
  offTrackLimit: 12,
  recoveryPenalty: 1.2,
};
