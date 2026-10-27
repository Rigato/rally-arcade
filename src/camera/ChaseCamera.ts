import * as THREE from 'three';
import { clamp, dampAlpha, dampAngle } from '../core/math';
import { CAMERA_TUNING, CAR_TUNING } from '../game/config';
import type { CameraTuning, CarState } from '../game/types';

const HEADING_FALLBACK_SPEED = 2;
const FOV_TAU = 0.25;
/** TODO(M3): substituir pela altura do terreno em `heightAt`. */
const GROUND_Y = 0;

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

  constructor(tuning: CameraTuning = CAMERA_TUNING) {
    this.tuning = tuning;
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
  }

  /** Atualiza seguimento e FOV. Chamar no render, com o frame delta real. */
  update(dt: number, carState: CarState): void {
    const targetYaw = this.resolveTargetYaw(carState.heading, carState.velocity);

    this.cameraYaw = dampAngle(this.cameraYaw, targetYaw, this.tuning.yawTau, dt);
    this.computeDesired(carState.position);

    const positionAlpha = dampAlpha(this.tuning.positionTau, dt);
    this.camera.position.lerp(this.desiredPosition, positionAlpha);

    // O yaw já é suavizado; usar o look-at desejado evita que o carro
    // "suba" na tela em alta velocidade por atraso do alvo.
    this.smoothedLookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.smoothedLookAt);

    this.updateFov(carState.speed, dt);
  }

  /** Boost futuro de turbo (graus extras de FOV). */
  setFovBoost(degrees: number): void {
    this.fovBoost = degrees;
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
    // Enquanto o chão é plano (y=0), basta garantir a folga mínima.
    this.desiredPosition.y = Math.max(
      carPosition.y + this.tuning.height,
      GROUND_Y + this.tuning.minGroundClearance,
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
