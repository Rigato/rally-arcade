/** Tipos compartilhados do jogo. Unidades em metros e segundos. */

import type * as THREE from 'three';

export interface Vec2 {
  x: number;
  z: number;
}

export type RaceState = 'READY' | 'RUNNING' | 'RECOVERING' | 'FINISHED';

/** Cenário visual/jogável de um setor. O piso físico é independente. */
export type ScenarioId =
  | 'forest'
  | 'desert'
  | 'snow'
  | 'village'
  | 'dirt'
  | 'beach';

export type SurfaceId =
  | 'gravel'
  | 'sand'
  | 'snow'
  | 'asphalt'
  | 'dirt'
  | 'beach-sand'
  | 'forest-offroad'
  | 'desert-offroad'
  | 'snow-offroad'
  | 'village-offroad'
  | 'dirt-offroad'
  | 'beach-offroad';

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
  /**
   * Multiplicador do limite de velocidade longitudinal (0..1). Fora de pista
   * o carro não passa de `maxSpeed * speedLimit`, por mais que acelere.
   */
  speedLimit: number;
  /**
   * Desaceleração extra (m/s²) aplicada suavemente quando o carro está acima
   * do limite do piso. 0 nos pisos de pista.
   */
  offRoadBrake: number;
}

/** Powerups do MVP: turbo (velocidade) e grip extra (derrapagem). */
export type PowerupType = 'turbo' | 'grip';

/** Powerup ativo exposto ao HUD (lista pequena, recriada pelo `Powerups`). */
export interface ActivePowerup {
  type: PowerupType;
  /** Tempo restante (s); chega a 0 e o powerup desativa. */
  remaining: number;
  /** Duração total da ativação (s), para a barra do chip. */
  duration: number;
}

/**
 * Piso escolhido no painel de debug. `auto` usa o piso da zona da pista
 * (cascalho na floresta, areia no deserto; fora da pista, o piso da zona).
 */
export type ForcedSurface = SurfaceId | 'auto';

/**
 * Entrada normalizada do jogador. `steer` vai de -1 a +1 no referencial do
 * carro (+1 = direita do carro); a câmera vê essa direita à esquerda na tela,
 * então o botão ◀ envia +1 (ver `Input`).
 */
export interface InputState {
  throttle: boolean;
  steer: number;
  /** Freio analógico 0..1 (0 = solto, 1 = freio máximo). */
  brake: number;
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
  /**
   * Queda de grip conforme o ângulo de escorregamento (0..1). Ajuda a iniciar
   * e sustentar a derrapagem sem deixar o carro "no trilho".
   */
  slipGripFalloff: number;
  /** Redução de grip ao frear dentro da curva (0..1); ajuda a rotacionar. */
  brakeGripReduction: number;
  /**
   * Redução de grip proporcional ao esterço e à velocidade (0..1). Com esterço
   * cheio a traseira solta e o carro rotaciona em vez de "colar" na curva.
   */
  steerGripReduction: number;
  /**
   * Guinada extra (rad/s) a esterço cheio, aplicada principalmente com pouco
   * slip. Inicia a rotação sem transformar o carro em um pião.
   */
  yawBoost: number;
}

/** Ajustes visuais da carroceria (não participam da física). */
export interface BodyTuning {
  maxRollDeg: number;
  maxPitchDeg: number;
  rollPerLateralAccel: number;
  pitchPerLongAccel: number;
  /** Rolagem extra proporcional ao esterço, para dar vida em baixa velocidade. */
  rollPerSteer: number;
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
  /** Constante de tempo (s) do esterço até o alvo de -1/0/+1. */
  steerSmoothingTau: number;
  /** Constante de tempo (s) do freio até 0/1. */
  brakeSmoothingTau: number;
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
  readonly id: ScenarioId;
  readonly surface: SurfaceId;
  /** Piso fora da pista; quando ausente, mantém o fallback histórico. */
  readonly offroad?: SurfaceId;
}

/** Perfil de poeira/partículas de um piso. */
export interface DustProfile {
  readonly color: number;
  readonly secondaryColor: number;
  readonly rateMultiplier: number;
  readonly sizeMultiplier: number;
  readonly alphaMultiplier: number;
  readonly lifeMultiplier: number;
  readonly riseMin: number;
  readonly riseMax: number;
  readonly gravity: number;
  readonly slipStartDeg: number;
  readonly slipRangeDeg: number;
}

/** Ramo alternativo de uma bifurcação; começa e termina na pista principal. */
export interface TrackForkBranch {
  readonly id: string;
  readonly points: readonly TrackPoint[];
  /** `s` da pista principal no início/fim do ramo. */
  readonly startS: number;
  readonly endS: number;
  /** Comprimento 3D do ramo (m). */
  readonly length: number;
  readonly width: number;
}

/**
 * Bifurcação: a pista principal continua sendo uma opção e cada ramo é uma
 * alternativa que sai e volta para ela. Não há final próprio.
 */
export interface TrackFork {
  readonly id: string;
  readonly startS: number;
  readonly endS: number;
  readonly branches: readonly TrackForkBranch[];
}

/** Obstáculos móveis que atravessam a pista. */
export type HazardKind =
  | 'camel'
  | 'deer'
  | 'reindeer'
  | 'car'
  | 'truck'
  | 'tractor'
  | 'cow'
  | 'buggy';

export interface TrackHazard {
  readonly id: string;
  readonly kind: HazardKind;
  readonly zoneIndex: number;
  readonly scenario: ScenarioId;
  /** `s` da pista principal onde o objeto cruza. */
  readonly s: number;
  readonly direction: 1 | -1;
  readonly speed: number;
  readonly radius: number;
  readonly height: number;
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
  readonly type: PowerupType;
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
  /** Bifurcações opcionais (pistas procedurais; a fixa não usa). */
  readonly forks?: readonly TrackFork[];
  /** Obstáculos móveis opcionais (pistas procedurais; a fixa não usa). */
  readonly hazards?: readonly TrackHazard[];
}
