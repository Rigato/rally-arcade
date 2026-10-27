import * as THREE from 'three';
import { TAU, clamp, dampAlpha, dampAngle } from '../core/math';
import { CAMERA_TUNING, CAR_TUNING } from '../game/config';
import type { CameraTuning, CarState } from '../game/types';

const HEADING_FALLBACK_SPEED = 2;
const FOV_TAU = 0.25;
/** Amplitude máxima do rumbling contínuo (m). */
const RUMBLE_AMPLITUDE = 0.1;
/** Amplitude máxima do shake de impacto (m). */
const SHAKE_AMPLITUDE = 0.12;
/** Decaimento do shake (s). */
const SHAKE_TAU = 0.18;

/**
 * Câmera de perseguição em portrait.
 *
 * Segue a direção do movimento (não o heading) para que o carro gire em
 * relação à tela ao derrapar. Abaixo de 2 m/s volta a usar o heading.
 * Yaw e posição têm suavizações independentes; o look-at usa o yaw suavizado.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Tuning mutável compartilhado com o painel do M1b. */
  private readonly tuning: CameraTuning;

  private cameraYaw = 0;

  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly smoothedLookAt = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  private fovBoost = 0;
  private currentFov: number;
  private readonly groundHeightAt: ((x: number, z: number) => number) | null;

  /** Rumbling contínuo do fora de pista (0..1), atualizado pelo Game. */
  private rumble = 0;
  /** Shake transitório de impacto (0..1), decai exponencialmente. */
  private shake = 0;
  private shakeTime = 0;

  constructor(
    tuning: CameraTuning = CAMERA_TUNING,
    groundHeightAt: ((x: number, z: number) => number) | null = null,
  ) {
    this.tuning = tuning;
    this.groundHeightAt = groundHeightAt;
    this.currentFov = tuning.fov;
    this.camera = new THREE.PerspectiveCamera(tuning.fov, 1, 0.1, 600);
    this.camera.position.set(0, tuning.height, -tuning.distance);
    this.smoothedLookAt.set(0, tuning.lookHeight, tuning.lookAhead);
    this.camera.lookAt(this.smoothedLookAt);
  }

  resize(aspect: number): void {
    this.camera.aspect = Math.max(aspect, 0.1);
    this.camera.updateProjectionMatrix();
  }

  /** Posiciona a câmera imediatamente (usado no reset). */
  snapTo(position: THREE.Vector3, heading: number, velocity?: THREE.Vector3): void {
    this.cameraYaw = this.resolveTargetYaw(heading, velocity);
    this.computeDesired(position);
    this.camera.position.copy(this.desiredPosition);
    this.smoothedLookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.smoothedLookAt);

    this.currentFov = this.tuning.fov;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.fovBoost = 0;
    this.rumble = 0;
    this.shake = 0;
    this.shakeTime = 0;
  }

  /** Atualiza seguimento e FOV. Chamar no render, com o frame delta real. */
  update(dt: number, carState: CarState): void {
    const targetYaw = this.resolveTargetYaw(carState.heading, carState.velocity);

    this.cameraYaw = dampAngle(this.cameraYaw, targetYaw, this.tuning.yawTau, dt);
    this.computeDesired(carState.position);

    const positionAlpha = dampAlpha(this.tuning.positionTau, dt);
    this.camera.position.lerp(this.desiredPosition, positionAlpha);

    // O offset entra só na posição: o look-at continua no carro, então a tela
    // treme sem girar. O clamp de chão é reaplicado depois do deslocamento.
    this.applyShake(dt);

    // O yaw já é suavizado; usar o look-at desejado evita que o carro
    // "suba" na tela em alta velocidade por atraso do alvo.
    this.smoothedLookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.smoothedLookAt);

    this.updateFov(carState.speed, dt);
  }

  /** Rumbling contínuo do piso (0 = pista lisa, 1 = fora de pista em velocidade). */
  setRumble(intensity: number): void {
    this.rumble = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  }

  /** Injeta um shake transitório (impacto, pouso forte). 0..1 por chamada. */
  addShake(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    this.shake = Math.min(this.shake + amount, 1.5);
  }

  /** Boost futuro de turbo (graus extras de FOV). */
  setFovBoost(degrees: number): void {
    this.fovBoost = degrees;
  }

  private applyShake(dt: number): void {
    this.shakeTime += Math.max(dt, 0);

    if (this.shake > 0) {
      this.shake *= Math.exp(-Math.max(dt, 0) / SHAKE_TAU);
      if (this.shake < 0.001) {
        this.shake = 0;
      }
    }

    const amplitude = this.rumble * RUMBLE_AMPLITUDE + this.shake * SHAKE_AMPLITUDE;
    if (amplitude < 0.0005) {
      return;
    }

    // Duas frequências incomensuráveis (~13–19 Hz) para não parecer um pulso.
    const time = this.shakeTime;
    const offsetX =
      (Math.sin(time * TAU * 12.7) * 0.6 +
        Math.sin(time * TAU * 17.9 + 1.3) * 0.4) *
      amplitude;
    const offsetZ =
      (Math.sin(time * TAU * 14.3 + 2.1) * 0.55 +
        Math.sin(time * TAU * 19.1 + 0.4) * 0.45) *
      amplitude;
    const offsetY = Math.sin(time * TAU * 13.1 + 1.7) * amplitude * 0.45;

    this.camera.position.x += offsetX;
    this.camera.position.z += offsetZ;
    this.camera.position.y += offsetY;

    if (this.groundHeightAt) {
      const groundY = this.groundHeightAt(this.camera.position.x, this.camera.position.z);
      this.camera.position.y = Math.max(
        this.camera.position.y,
        groundY + this.tuning.minGroundClearance,
      );
    }
  }

  private resolveTargetYaw(heading: number, velocity?: THREE.Vector3): number {
    if (velocity) {
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > HEADING_FALLBACK_SPEED) {
        return Math.atan2(velocity.x, velocity.z);
      }
    }

    return heading;
  }

  private computeDesired(carPosition: THREE.Vector3): void {
    this.direction.set(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));

    this.desiredPosition
      .copy(carPosition)
      .addScaledVector(this.direction, -this.tuning.distance);

    // A câmera fica atrás do carro; ali o terreno pode estar mais alto.
    // Amostrar o chão na posição desejada evita que ela entre na pista.
    const groundY = this.groundHeightAt
      ? this.groundHeightAt(this.desiredPosition.x, this.desiredPosition.z)
      : 0;
    this.desiredPosition.y = Math.max(
      carPosition.y + this.tuning.height,
      groundY + this.tuning.minGroundClearance,
    );

    this.desiredLookAt
      .copy(carPosition)
      .addScaledVector(this.direction, this.tuning.lookAhead);
    this.desiredLookAt.y = carPosition.y + this.tuning.lookHeight;
  }

  private updateFov(speed: number, dt: number): void {
    const speedRatio = clamp(speed / CAR_TUNING.maxSpeed, 0, 1);
    const target = this.tuning.fov + speedRatio * this.tuning.speedFovBoost + this.fovBoost;
    this.currentFov += (target - this.currentFov) * dampAlpha(FOV_TAU, dt);

    if (Math.abs(this.currentFov - this.camera.fov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
