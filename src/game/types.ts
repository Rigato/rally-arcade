/** Tipos compartilhados do jogo. Unidades em metros e segundos. */

import type * as THREE from 'three';

export interface Vec2 {
  x: number;
  z: number;
}

export type RaceState = 'READY' | 'RUNNING' | 'RECOVERING' | 'FINISHED';

export type SurfaceId = 'gravel' | 'sand' | 'forest-offroad' | 'desert-offroad';

/**
 * Piso do terreno. Todos os campos são mutáveis: o painel de tuning do M1b
 * edita estes valores ao vivo e a física lê a mesma referência.
 */
export interface SurfaceDef {
  id: SurfaceId;
  label: string;
  /** Grip lateral (1/s): quanto maior, mais rápido a velocidade se alinha ao heading. */
  grip: number;
  /** Multiplicador de aceleração do motor. */
  acceleration: number;
  /** Multiplicador do arrasto do piso. */
  drag: number;
  /** Intensidade da trepidação visual/física fora de estrada. */
  bump: number;
  /** Multiplicador da resposta de esterço (1.0 no M1; ajustado no M2). */
  steerMultiplier: number;
}

export type HandbrakeMode = 'drag' | 'button';

/**
 * Piso escolhido no painel de debug. `auto` usa o piso da zona da pista
 * (cascalho na floresta, areia no deserto; fora da pista, o piso da zona).
 */
export type ForcedSurface = SurfaceId | 'auto';

/** Entrada normalizada do jogador. `steer` vai de -1 (esquerda) a +1 (direita). */
export interface InputState {
  throttle: boolean;
  steer: number;
  brake: boolean;
  handbrake: boolean;
}

/** Estado físico exposto pelo carro (posição no mundo + referencial do carro). */
export interface CarState {
  position: THREE.Vector3;
  /** Yaw em radianos. 0 = +Z, positivo gira para +X (direita). */
  heading: number;
  velocity: THREE.Vector3;
  yawRate: number;
  grounded: boolean;
  /** Tempo desde que o acelerador foi solto; alimenta a rampa de freio. */
  releaseTime: number;
  /** Velocidade planar (m/s). */
  speed: number;
  /** Normal do terreno no espaço do mundo (aproximada por amostras). */
  groundNormal: THREE.Vector3;
  /** Inclinação do terreno no eixo do carro (rad; positivo = frente para baixo). */
  terrainPitch: number;
  /** Inclinação lateral do terreno (rad; positivo = direita para cima). */
  terrainRoll: number;
  /** Em voo (M3b): sem esterço, grip ou motor até pousar. */
  airborne: boolean;
  /** Velocidade vertical (m/s); positiva subindo. */
  verticalVelocity: number;
  /** Tempo de voo acumulado no salto atual (s). */
  airTime: number;
  /** Duração do último voo concluído (s). */
  lastAirTime: number;
  /** Velocidade vertical do último pouso (m/s, negativa na descida). */
  landingImpact: number;
  /** Coordenada longitudinal na pista (m), preenchida pelo Game. */
  trackS: number;
  /** Coordenada lateral na pista (m, positivo à direita), preenchida pelo Game. */
  trackU: number;
}

/** Telemetria pronta para HUD, painel de tuning e animação visual. */
export interface CarTelemetry {
  /** Velocidade planar (m/s). */
  speed: number;
  /** Velocidade longitudinal no referencial do carro (m/s). */
  longitudinalSpeed: number;
  /** Velocidade lateral no referencial do carro (m/s, positivo = direita). */
  lateralSpeed: number;
  /** Ângulo entre o heading e a direção do movimento (rad). */
  slipAngle: number;
  yawRate: number;
  /** Esterço aplicado neste passo (-1..1). */
  steer: number;
  /** Intensidade da rampa de freio aplicada neste passo (m/s²). */
  brake: number;
  throttle: number;
  handbrake: boolean;
  grounded: boolean;
  /** Tempo de voo acumulado no salto atual (s). */
  airTime: number;
  /** Duração do último voo concluído (s). */
  lastAirTime: number;
  /** Impacto vertical do último pouso (m/s, negativo). */
  landingImpact: number;
  /** Aceleração longitudinal no referencial do carro (m/s²). */
  longitudinalAcceleration: number;
  /** Aceleração lateral/centrípeta (m/s², positivo = direita). */
  lateralAcceleration: number;
}

export interface CarTuning {
  engineAcceleration: number;
  maxSpeed: number;
  dragCoefficient: number;
  rollingResistance: number;
  maxYawRate: number;
  steerResponseTau: number;
  /** Velocidade (m/s) em que o esterço atinge resposta máxima em baixa. */
  steerSpeedReference: number;
  /** Redução da guinada em velocidade máxima (0..1). */
  steerHighSpeedReduction: number;
  brakeMax: number;
  brakeRampStart: number;
  brakeRampDuration: number;
  airGravity: number;
  handbrakeGripMultiplier: number;
  handbrakeBrake: number;
}

export interface CameraTuning {
  distance: number;
  height: number;
  lookAhead: number;
  lookHeight: number;
  /** Referência de ângulo da câmera (informativo/painel). */
  pitchDeg: number;
  positionTau: number;
  yawTau: number;
  fov: number;
  /** Ganho de FOV proporcional à velocidade (graus no topo). */
  speedFovBoost: number;
  /** Ganho extra de FOV para o turbo futuro. */
  turboFovBoost: number;
  minGroundClearance: number;
}

export interface InputTuning {
  /** Fração de min(innerWidth, innerHeight) para atingir o esterço máximo. */
  steerLockScreenRatio: number;
  steerDeadzonePx: number;
  steerSmoothingTau: number;
  /** Deslocamento (em múltiplos do lock) para acionar o freio de mão no modo drag. */
  handbrakeScreenRatio: number;
  handbrakeMode: HandbrakeMode;
}

export interface PowerupTuning {
  turboSpeedMultiplier: number;
  turboAccelerationMultiplier: number;
  turboDuration: number;
  gripMultiplier: number;
  gripDuration: number;
}

export interface MedalTargets {
  gold: number;
  silver: number;
  bronze: number;
}

export interface RaceTuning {
  splitTarget: number;
  medals: MedalTargets;
  /** Reservado: limite antigo do plano (24 m), hoje substituído por `offTrackLimit`. */
  worldLimit: number;
  /** Distância além da borda da pista que dispara a recuperação (m). */
  offTrackLimit: number;
  /** Duração total da recuperação/fade (s); o cronômetro continua correndo. */
  recoveryPenalty: number;
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
