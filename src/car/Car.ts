import * as THREE from 'three';
import { clamp, dampAlpha, lerp, lerpAngle, signOrZero, wrapAngle } from '../core/math';
import { CAR_TUNING } from '../game/config';
import type { CarState, CarTelemetry, CarTuning, InputState, SurfaceDef } from '../game/types';

export interface RenderPose {
  position: THREE.Vector3;
  heading: number;
}

/**
 * Modificadores temporários de física (powerups). Ausentes = 1.
 * O `Game` passa o objeto vivo do `Powerups` a cada passo fixo.
 */
export interface CarModifiers {
  maxSpeedMultiplier?: number;
  accelerationMultiplier?: number;
  gripMultiplier?: number;
}

const LOW_SPEED_YAW_THRESHOLD = 0.3;
const MIN_GRIP_RATE = 0.001;
const TERRAIN_SAMPLE_HALF_LENGTH = 1.5;
const TERRAIN_SAMPLE_HALF_WIDTH = 0.9;
const TERRAIN_ATTITUDE_TAU = 0.08;
const MAX_GRADE = 0.6;
const GRAVITY = 9.81;
const MAX_GROUND_CLIMB_RATE = 20;
/** Abaixo disso o chão é seguido; acima vira decolagem. */
const TAKEOFF_MIN_CLIMB_RATE = 1.2;
/** Margem para o ruído da amostragem não decolar em qualquer ondulação. */
const TAKEOFF_MARGIN = 0.06;
/** Queda abrupta (lip do kicker) mesmo em baixa velocidade. */
const LEDGE_DROP = 0.5;

/**
 * Física arcade do carro.
 *
 * Convenção: heading 0 = +Z, `forward = (sin(h), 0, cos(h))`,
 * `right = (cos(h), 0, -sin(h))` — a mesma usada por `CarView`.
 *
 * M3b: o carro segue a altura da pista no chão, mas quando o chão cai mais
 * rápido que a trajetória balística ele decola com a velocidade vertical da
 * rampa. No ar não existe esterço/grip/motor; ao pousar a suspensão visual
 * recebe o impacto. `heightAt` continua sendo a única fonte de verdade do
 * terreno, então malha e física não divergem.
 *
 * TODO(M4): colisões, obstáculos e terreno acidentado fora da pista.
 */
export class Car {
  readonly state: CarState;
  readonly telemetry: CarTelemetry;
  readonly tuning: CarTuning;

  private readonly previousPosition = new THREE.Vector3();
  private previousHeading = 0;
  /** Taxa vertical do chão no último passo (velocidade de saída da rampa). */
  private groundRate = 0;
  /** Impacto ainda não consumido pelo visual (o mais forte entre landings). */
  private pendingLandingImpact = 0;
  private readonly terrainForward = new THREE.Vector3();
  private readonly terrainRight = new THREE.Vector3();
  private readonly renderPose: RenderPose = {
    position: new THREE.Vector3(),
    heading: 0,
  };

  constructor(tuning: CarTuning = CAR_TUNING) {
    this.tuning = tuning;
    this.state = {
      position: new THREE.Vector3(),
      heading: 0,
      velocity: new THREE.Vector3(),
      yawRate: 0,
      grounded: true,
      releaseTime: 0,
      speed: 0,
      groundNormal: new THREE.Vector3(0, 1, 0),
      terrainPitch: 0,
      terrainRoll: 0,
      airborne: false,
      verticalVelocity: 0,
      airTime: 0,
      lastAirTime: 0,
      landingImpact: 0,
      trackS: 0,
      trackU: 0,
    };
    this.telemetry = {
      speed: 0,
      longitudinalSpeed: 0,
      lateralSpeed: 0,
      slipAngle: 0,
      yawRate: 0,
      steer: 0,
      brake: 0,
      throttle: 0,
      handbrake: false,
      grounded: true,
      airTime: 0,
      lastAirTime: 0,
      landingImpact: 0,
      longitudinalAcceleration: 0,
      lateralAcceleration: 0,
    };
  }

  /**
   * Avança a simulação em `dt` segundos.
   *
   * `heightAt` é a altura analítica da pista. No chão o carro segue o terreno
   * (inclusive rampas); quando a trajetória balística fica acima do chão, ele
   * decola e passa a integrar gravidade até pousar. Sem `heightAt`, mantém o
   * comportamento plano do M1.
   */
  step(
    dt: number,
    input: Readonly<InputState>,
    surface: SurfaceDef,
    heightAt?: (x: number, z: number) => number,
    modifiers?: CarModifiers,
  ): void {
    if (dt <= 0) {
      return;
    }

    const tuning = this.tuning;
    const state = this.state;
    const maxSpeedMultiplier = modifiers?.maxSpeedMultiplier ?? 1;
    const accelerationMultiplier = modifiers?.accelerationMultiplier ?? 1;
    const gripMultiplier = modifiers?.gripMultiplier ?? 1;

    this.previousPosition.copy(state.position);
    this.previousHeading = state.heading;

    const startGrounded = !state.airborne;
    const startX = state.position.x;
    const startZ = state.position.z;
    const startY = state.position.y;
    const startGroundY = heightAt ? heightAt(startX, startZ) : 0;

    // --- Terreno: inclinação usada pela gravidade e pelo visual ---
    // No ar a atitude fica congelada na última amostra do chão.
    let grade = 0;
    if (heightAt && startGrounded) {
      grade = this.sampleTerrain(startX, startZ, state.heading, heightAt, dt);
    }

    // --- Direção do carro no referencial do mundo ---
    let forwardX = Math.sin(state.heading);
    let forwardZ = Math.cos(state.heading);
    let rightX = Math.cos(state.heading);
    let rightZ = -Math.sin(state.heading);

    // --- Velocidade atual no referencial do carro ---
    let vLong = state.velocity.x * forwardX + state.velocity.z * forwardZ;
    let vLat = state.velocity.x * rightX + state.velocity.z * rightZ;

    const speed = Math.hypot(vLong, vLat);
    const speedRatio = clamp(
      speed / (tuning.maxSpeed * Math.max(maxSpeedMultiplier, 0.01)),
      0,
      1,
    );

    let nextVLong = vLong;
    let nextVLat = vLat;
    let brakeDeceleration = 0;

    if (startGrounded) {
      // --- Guinada ---
      // Cresce de zero até steerSpeedReference e cai levemente no topo.
      const lowSpeedFactor = clamp(speed / tuning.steerSpeedReference, 0, 1);
      const highSpeedFactor = 1 - tuning.steerHighSpeedReduction * speedRatio;
      const yawTarget =
        speed > LOW_SPEED_YAW_THRESHOLD
          ? clamp(input.steer, -1, 1) *
            tuning.maxYawRate *
            lowSpeedFactor *
            highSpeedFactor *
            surface.steerMultiplier
          : 0;

      state.yawRate = lerp(
        state.yawRate,
        yawTarget,
        dampAlpha(tuning.steerResponseTau, dt),
      );
      state.heading = wrapAngle(state.heading + state.yawRate * dt);

      // O heading girou; a velocidade ainda aponta para a direção antiga.
      // Recalcular os eixos aqui é o que gera a derrapagem.
      forwardX = Math.sin(state.heading);
      forwardZ = Math.cos(state.heading);
      rightX = Math.cos(state.heading);
      rightZ = -Math.sin(state.heading);

      vLong = state.velocity.x * forwardX + state.velocity.z * forwardZ;
      vLat = state.velocity.x * rightX + state.velocity.z * rightZ;

      // --- Longitudinal ---
      const brakeInput = clamp(input.brake, 0, 1);
      // Frear corta o motor: o jogador não consegue "acelerar e frear" juntos.
      let accelerationLong =
        tuning.engineAcceleration *
        accelerationMultiplier *
        (input.throttle ? 1 : 0) *
        (1 - brakeInput) *
        surface.acceleration;
      accelerationLong -= tuning.dragCoefficient * vLong * Math.abs(vLong) * surface.drag;

      // Componente da gravidade na inclinação (positivo sobe, então desacelera).
      accelerationLong -= GRAVITY * grade;

      const rolling = signOrZero(vLong, 0.05);
      accelerationLong -= tuning.rollingResistance * rolling;

      if (brakeInput > 0.01) {
        // Freio analógico do arrasto vertical (0..1).
        brakeDeceleration = tuning.brakeMax * brakeInput;
      } else if (!input.throttle && vLong > 0.01) {
        // Esquema antigo e soltura do dedo: rampa de freio.
        const ramp = clamp(this.state.releaseTime / tuning.brakeRampDuration, 0, 1);
        brakeDeceleration = lerp(tuning.brakeRampStart, tuning.brakeMax, ramp);
      }

      this.state.releaseTime =
        input.throttle || brakeInput > 0.01 ? 0 : this.state.releaseTime + dt;

      if (brakeDeceleration > 0) {
        accelerationLong -= brakeDeceleration;
      }

      if (input.handbrake && Math.abs(vLong) > 0.05) {
        accelerationLong -= tuning.handbrakeBrake * Math.sign(vLong);
      }

      nextVLong = vLong + accelerationLong * dt;

      // Não existe entrada de ré, mas o carro pode ficar com velocidade
      // longitudinal negativa durante um giro forte (apontando para trás).
      nextVLong = clamp(
        nextVLong,
        -tuning.maxSpeed * 0.6,
        tuning.maxSpeed * maxSpeedMultiplier,
      );

      // Evita creep de poucos mm/s depois que o carro já parou.
      if (!input.throttle && Math.abs(nextVLong) < 0.02) {
        nextVLong = 0;
      }

      // --- Lateral ---
      // Três efeitos somados:
      // 1. handbrake solta a traseira;
      // 2. frear dentro da curva reduz o grip e ajuda a rotacionar;
      // 3. quanto maior o ângulo de escorregamento, menos grip sobra — a
      //    derrapagem começa mais cedo e se sustenta, em vez de "colar".
      const slip = Math.atan2(Math.abs(vLat), Math.abs(vLong) + 0.1);
      const slipFalloff = 1 - tuning.slipGripFalloff * clamp(slip / 0.7, 0, 1);
      const brakeGrip = 1 - tuning.brakeGripReduction * brakeInput;
      const gripRate = Math.max(
        surface.grip *
          gripMultiplier *
          (input.handbrake ? tuning.handbrakeGripMultiplier : 1) *
          slipFalloff *
          brakeGrip,
        MIN_GRIP_RATE,
      );
      nextVLat = vLat * Math.exp(-gripRate * dt);
    } else {
      // --- Ar: sem controle ---
      // Sem esterço, sem grip lateral, sem motor/freio/gravidade de rampa.
      // O heading fica congelado e a velocidade horizontal é preservada.
      state.yawRate = 0;
      state.releaseTime += dt;
    }

    // --- Recomposição e integração horizontal ---
    state.velocity.x = forwardX * nextVLong + rightX * nextVLat;
    state.velocity.z = forwardZ * nextVLong + rightZ * nextVLat;
    state.velocity.y = 0;
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;

    // --- Vertical: chão, decolagem, voo e pouso ---
    if (!heightAt) {
      state.position.y = 0;
      state.grounded = true;
      state.airborne = false;
      state.verticalVelocity = 0;
      state.airTime = 0;
      this.groundRate = 0;
    } else {
      const newGroundY = heightAt(state.position.x, state.position.z);

      if (state.airborne) {
        state.verticalVelocity -= tuning.airGravity * dt;
        state.position.y += state.verticalVelocity * dt;
        state.airTime += dt;

        if (state.position.y <= newGroundY && state.verticalVelocity <= 0) {
          this.land(state, newGroundY);
          this.sampleTerrain(
            state.position.x,
            state.position.z,
            state.heading,
            heightAt,
            dt,
          );
        }
      } else {
        // A rampa vinha subindo a `groundRate`; se o chão agora cai mais
        // rápido que a parábola, o carro sai voando com essa velocidade.
        const ballisticY =
          startY +
          this.groundRate * dt -
          0.5 * tuning.airGravity * dt * dt;
        const launched =
          this.groundRate > TAKEOFF_MIN_CLIMB_RATE &&
          newGroundY < ballisticY - TAKEOFF_MARGIN;
        // Mesmo em baixa velocidade um lip de kicker não pode teleportar o
        // carro para baixo: ele cai em queda livre.
        const dropped = newGroundY < startY - LEDGE_DROP;

        if (launched || dropped) {
          state.airborne = true;
          state.grounded = false;
          state.airTime = 0;
          state.position.y = launched ? ballisticY : startY;
          state.verticalVelocity = launched
            ? clamp(this.groundRate, -MAX_GROUND_CLIMB_RATE, MAX_GROUND_CLIMB_RATE)
            : 0;
        } else {
          const groundRate = (newGroundY - startGroundY) / dt;
          state.position.y = newGroundY;
          state.grounded = true;
          state.verticalVelocity = 0;
          state.airTime = 0;
          this.groundRate = clamp(
            groundRate,
            -MAX_GROUND_CLIMB_RATE,
            MAX_GROUND_CLIMB_RATE,
          );
        }
      }
    }

    // --- Telemetria ---
    const nextSpeed = Math.hypot(nextVLong, nextVLat);
    this.telemetry.speed = nextSpeed;
    this.telemetry.longitudinalSpeed = nextVLong;
    this.telemetry.lateralSpeed = nextVLat;
    this.telemetry.slipAngle = Math.atan2(nextVLat, Math.abs(nextVLong) + 0.05);
    this.telemetry.yawRate = state.yawRate;
    this.telemetry.steer = input.steer;
    this.telemetry.brake = brakeDeceleration;
    this.telemetry.throttle = input.throttle ? 1 : 0;
    this.telemetry.handbrake = input.handbrake;
    this.telemetry.grounded = state.grounded;
    this.telemetry.airTime = state.airTime;
    this.telemetry.lastAirTime = state.lastAirTime;
    this.telemetry.landingImpact = state.landingImpact;
    this.telemetry.longitudinalAcceleration = startGrounded
      ? (nextVLong - vLong) / dt
      : 0;
    this.telemetry.lateralAcceleration = startGrounded
      ? state.yawRate * nextVLong
      : 0;

    state.speed = nextSpeed;
  }

  /**
   * Amostra a inclinação do terreno em `x,z` e atualiza pitch/roll/normal.
   * Retorna o grade longitudinal (positivo = subindo) usado pela gravidade.
   */
  private sampleTerrain(
    x: number,
    z: number,
    heading: number,
    heightAt: (x: number, z: number) => number,
    dt: number,
  ): number {
    const state = this.state;
    const sampleForwardX = Math.sin(heading);
    const sampleForwardZ = Math.cos(heading);
    const sampleRightX = Math.cos(heading);
    const sampleRightZ = -Math.sin(heading);

    const halfLength = TERRAIN_SAMPLE_HALF_LENGTH;
    const halfWidth = TERRAIN_SAMPLE_HALF_WIDTH;

    const frontY = heightAt(
      x + sampleForwardX * halfLength,
      z + sampleForwardZ * halfLength,
    );
    const backY = heightAt(
      x - sampleForwardX * halfLength,
      z - sampleForwardZ * halfLength,
    );
    const rightY = heightAt(
      x + sampleRightX * halfWidth,
      z + sampleRightZ * halfWidth,
    );
    const leftY = heightAt(
      x - sampleRightX * halfWidth,
      z - sampleRightZ * halfWidth,
    );

    // Positivo = frente para baixo (mesma convenção de rotation.x do CarView).
    const targetPitch = Math.atan2(backY - frontY, halfLength * 2);
    const targetRoll = Math.atan2(rightY - leftY, halfWidth * 2);
    const attitudeAlpha = dampAlpha(TERRAIN_ATTITUDE_TAU, dt);
    state.terrainPitch += (targetPitch - state.terrainPitch) * attitudeAlpha;
    state.terrainRoll += (targetRoll - state.terrainRoll) * attitudeAlpha;

    this.terrainForward.set(
      sampleForwardX * halfLength * 2,
      frontY - backY,
      sampleForwardZ * halfLength * 2,
    );
    this.terrainRight.set(
      sampleRightX * halfWidth * 2,
      rightY - leftY,
      sampleRightZ * halfWidth * 2,
    );
    state.groundNormal
      .crossVectors(this.terrainForward, this.terrainRight)
      .normalize();

    if (state.groundNormal.y < 0) {
      state.groundNormal.negate();
    }

    return clamp((frontY - backY) / (halfLength * 2), -MAX_GRADE, MAX_GRADE);
  }

  private land(state: CarState, groundY: number): void {
    const impact = state.verticalVelocity;
    state.position.y = groundY;
    state.grounded = true;
    state.airborne = false;
    state.verticalVelocity = 0;
    state.lastAirTime = state.airTime;
    state.airTime = 0;
    state.landingImpact = impact;
    this.groundRate = 0;

    // O visual consome uma vez; guarda o impacto mais forte se dois pousos
    // acontecerem entre dois frames renderizados.
    this.pendingLandingImpact = Math.min(this.pendingLandingImpact, impact);
  }

  /**
   * Impacto do último pouso ainda não consumido (m/s, negativo).
   * Retorna 0 quando não há pouso novo; o valor é consumido na chamada.
   */
  consumeLandingImpact(): number {
    const impact = this.pendingLandingImpact;
    this.pendingLandingImpact = 0;
    return impact;
  }

  reset(position?: THREE.Vector3, heading = 0): void {
    // A posição já pode vir com a altura da pista (startPose / teleporte).
    this.state.position.copy(position ?? new THREE.Vector3());
    this.state.heading = wrapAngle(heading);
    this.state.velocity.set(0, 0, 0);
    this.state.yawRate = 0;
    this.state.releaseTime = 0;
    this.state.grounded = true;
    this.state.speed = 0;
    this.state.groundNormal.set(0, 1, 0);
    this.state.terrainPitch = 0;
    this.state.terrainRoll = 0;
    this.state.airborne = false;
    this.state.verticalVelocity = 0;
    this.state.airTime = 0;
    this.state.lastAirTime = 0;
    this.state.landingImpact = 0;
    this.state.trackS = 0;
    this.state.trackU = 0;
    this.groundRate = 0;
    this.pendingLandingImpact = 0;

    this.previousPosition.copy(this.state.position);
    this.previousHeading = this.state.heading;

    this.telemetry.speed = 0;
    this.telemetry.longitudinalSpeed = 0;
    this.telemetry.lateralSpeed = 0;
    this.telemetry.slipAngle = 0;
    this.telemetry.yawRate = 0;
    this.telemetry.steer = 0;
    this.telemetry.brake = 0;
    this.telemetry.throttle = 0;
    this.telemetry.handbrake = false;
    this.telemetry.grounded = true;
    this.telemetry.airTime = 0;
    this.telemetry.lastAirTime = 0;
    this.telemetry.landingImpact = 0;
    this.telemetry.longitudinalAcceleration = 0;
    this.telemetry.lateralAcceleration = 0;
  }

  /**
   * Alinha a pose visual à posição atual. Usado na chegada: sem novos passos,
   * a interpolação continuaria oscilando entre `previousPosition` e a posição
   * final a cada frame renderizado.
   */
  snapRenderPose(): void {
    this.previousPosition.copy(this.state.position);
    this.previousHeading = this.state.heading;
  }

  /**
   * Pose interpolada entre o passo fixo anterior e o atual.
   * O objeto retornado é reutilizado a cada frame (não guardar referência).
   */
  getRenderPose(alpha: number): RenderPose {
    const t = clamp(alpha, 0, 1);
    this.renderPose.position.lerpVectors(this.previousPosition, this.state.position, t);
    this.renderPose.heading = lerpAngle(this.previousHeading, this.state.heading, t);
    return this.renderPose;
  }
}
