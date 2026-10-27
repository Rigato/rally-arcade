/** Tipos compartilhados do jogo. Unidades em metros e segundos. */

export interface Vec2 {
  x: number;
  z: number;
}

export type RaceState = 'READY' | 'RUNNING' | 'RECOVERING' | 'FINISHED';

export type SurfaceId = 'gravel' | 'sand' | 'forest-offroad' | 'desert-offroad';

export interface SurfaceDef {
  readonly id: SurfaceId;
  readonly label: string;
  /** Grip lateral (1/s): quanto maior, mais rápido a velocidade se alinha ao heading. */
  readonly grip: number;
  /** Multiplicador de aceleração do motor. */
  readonly acceleration: number;
  /** Multiplicador do arrasto do piso. */
  readonly drag: number;
  /** Intensidade da trepidação visual/física fora de estrada. */
  readonly bump: number;
}

export interface CarTuning {
  readonly engineAcceleration: number;
  readonly maxSpeed: number;
  readonly dragCoefficient: number;
  readonly rollingResistance: number;
  readonly maxYawRate: number;
  readonly steerResponseTau: number;
  readonly brakeMax: number;
  readonly brakeRampStart: number;
  readonly brakeRampDuration: number;
  readonly airGravity: number;
  readonly handbrakeGripMultiplier: number;
  readonly handbrakeBrake: number;
}

export interface CameraTuning {
  readonly distance: number;
  readonly height: number;
  readonly lookAhead: number;
  readonly lookHeight: number;
  readonly pitchDeg: number;
  readonly positionTau: number;
  readonly yawTau: number;
  readonly fov: number;
  readonly turboFovBoost: number;
  readonly minGroundClearance: number;
}

export interface InputTuning {
  /** Fração da largura da tela para atingir o esterço máximo. */
  readonly steerLockScreenRatio: number;
  readonly steerDeadzonePx: number;
  readonly steerSmoothingTau: number;
  /** Deslocamento (em múltiplos do lock) para acionar o freio de mão. */
  readonly handbrakeScreenRatio: number;
}

export interface PowerupTuning {
  readonly turboSpeedMultiplier: number;
  readonly turboAccelerationMultiplier: number;
  readonly turboDuration: number;
  readonly gripMultiplier: number;
  readonly gripDuration: number;
}

export interface MedalTargets {
  readonly gold: number;
  readonly silver: number;
  readonly bronze: number;
}

export interface RaceTuning {
  readonly splitTarget: number;
  readonly medals: MedalTargets;
  readonly worldLimit: number;
  readonly recoveryPenalty: number;
}

/* Estruturas previstas para a pista autorada (M3). */

export interface TrackPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly width: number;
}

export interface TrackZone {
  readonly start: number;
  readonly end: number;
  readonly id: 'forest' | 'desert';
  readonly surface: 'gravel' | 'sand';
}

export interface TrackKicker {
  readonly s: number;
  readonly length: number;
  readonly height: number;
}

export interface TrackObstacle {
  readonly type: 'rock' | 'tree' | 'log';
  readonly s: number;
  readonly u: number;
  readonly radius: number;
}

export interface TrackPowerup {
  readonly type: 'turbo' | 'grip';
  readonly s: number;
  readonly u: number;
}

export interface TrackSplit {
  readonly s: number;
  readonly name: string;
  readonly target: number;
}

export interface TrackDef {
  readonly id: string;
  readonly points: readonly TrackPoint[];
  readonly zones: readonly TrackZone[];
  readonly kickers: readonly TrackKicker[];
  readonly obstacles: readonly TrackObstacle[];
  readonly powerups: readonly TrackPowerup[];
  readonly splits: readonly TrackSplit[];
  readonly medals: MedalTargets;
}
