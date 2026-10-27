import * as THREE from 'three';
import { clamp, dampAlpha, lerp, lerpAngle, signOrZero, wrapAngle } from '../core/math';
import { CAR_TUNING } from '../game/config';
import type { CarState, CarTelemetry, CarTuning, InputState, SurfaceDef } from '../game/types';

export interface RenderPose {
  position: THREE.Vector3;
  heading: number;
}

const LOW_SPEED_YAW_THRESHOLD = 0.3;
const MIN_GRIP_RATE = 0.001;

/**
 * Física arcade do carro em plano liso (M1a).
 *
 * Convenção: heading 0 = +Z, `forward = (sin(h), 0, cos(h))`,
 * `right = (cos(h), 0, -sin(h))` — a mesma usada por `CarView`.
 *
 * TODO(M3): pista com altura, alinhamento ao terreno, saltos e gravidade.
 * TODO(M4): colisões e obstáculos.
 */
export class Car {
  readonly state: CarState;
  readonly telemetry: CarTelemetry;
  readonly tuning: CarTuning;

  private readonly previousPosition = new THREE.Vector3();
  private previousHeading = 0;
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
      longitudinalAcceleration: 0,
      lateralAcceleration: 0,
    };
  }

  /**
   * Avança a simulação em `dt` segundos.
   * `surface` é lido ao vivo para permitir tuning em runtime no M1b.
   */
  step(dt: number, input: Readonly<InputState>, surface: SurfaceDef): void {
    if (dt <= 0) {
      return;
    }

    const tuning = this.tuning;
    const state = this.state;

    this.previousPosition.copy(state.position);
    this.previousHeading = state.heading;

    // --- Direção do carro no referencial do mundo ---
    let forwardX = Math.sin(state.heading);
    let forwardZ = Math.cos(state.heading);
    let rightX = Math.cos(state.heading);
    let rightZ = -Math.sin(state.heading);

    // --- Velocidade atual no referencial do carro ---
    let vLong = state.velocity.x * forwardX + state.velocity.z * forwardZ;
    let vLat = state.velocity.x * rightX + state.velocity.z * rightZ;

    const speed = Math.hypot(vLong, vLat);
    const speedRatio = clamp(speed / tuning.maxSpeed, 0, 1);

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
    let accelerationLong = tuning.engineAcceleration * (input.throttle ? 1 : 0) * surface.acceleration;
    accelerationLong -= tuning.dragCoefficient * vLong * Math.abs(vLong) * surface.drag;

    const rolling = signOrZero(vLong, 0.05);
    accelerationLong -= tuning.rollingResistance * rolling;

    let brakeDeceleration = 0;
    if (input.brake) {
      brakeDeceleration = tuning.brakeMax;
    } else if (!input.throttle && vLong > 0.01) {
      const ramp = clamp(this.state.releaseTime / tuning.brakeRampDuration, 0, 1);
      brakeDeceleration = lerp(tuning.brakeRampStart, tuning.brakeMax, ramp);
    }

    this.state.releaseTime = input.throttle ? 0 : this.state.releaseTime + dt;

    if (brakeDeceleration > 0) {
      accelerationLong -= brakeDeceleration;
    }

    if (input.handbrake && Math.abs(vLong) > 0.05) {
      accelerationLong -= tuning.handbrakeBrake * Math.sign(vLong);
    }

    let nextVLong = vLong + accelerationLong * dt;

    // Não existe entrada de ré, mas o carro pode ficar com velocidade
    // longitudinal negativa durante um giro forte (apontando para trás).
    // Não zerar isso: seria um freio invisível no meio da derrapagem.
    // O motor continua empurrando para frente e o atrito/rolamento recuperam.
    nextVLong = clamp(nextVLong, -tuning.maxSpeed * 0.6, tuning.maxSpeed);

    // Evita creep de poucos mm/s depois que o carro já parou.
    if (!input.throttle && Math.abs(nextVLong) < 0.02) {
      nextVLong = 0;
    }

    // --- Lateral ---
    const gripRate = Math.max(
      surface.grip * (input.handbrake ? tuning.handbrakeGripMultiplier : 1),
      MIN_GRIP_RATE,
    );
    const nextVLat = vLat * Math.exp(-gripRate * dt);

    // --- Recomposição e integração ---
    state.velocity.x = forwardX * nextVLong + rightX * nextVLat;
    state.velocity.z = forwardZ * nextVLong + rightZ * nextVLat;
    state.velocity.y = 0;
    state.grounded = true; // TODO(M3): altura do terreno e tempo de voo.
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    state.position.y = 0;

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
    this.telemetry.longitudinalAcceleration = (nextVLong - vLong) / dt;
    this.telemetry.lateralAcceleration = state.yawRate * nextVLong;

    state.speed = nextSpeed;
  }

  reset(position?: THREE.Vector3, heading = 0): void {
    this.state.position.copy(position ?? new THREE.Vector3());
    this.state.position.y = 0;
    this.state.heading = wrapAngle(heading);
    this.state.velocity.set(0, 0, 0);
    this.state.yawRate = 0;
    this.state.releaseTime = 0;
    this.state.grounded = true;
    this.state.speed = 0;

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
    this.telemetry.longitudinalAcceleration = 0;
    this.telemetry.lateralAcceleration = 0;
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
