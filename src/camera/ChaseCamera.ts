import * as THREE from 'three';
import { dampAlpha } from '../core/math';
import { CAMERA_TUNING } from '../game/config';

/**
 * Câmera de perseguição provisória do M0.
 * No M1 passa a seguir a direção do movimento, com look-ahead e FOV dinâmico.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly smoothedLookAt = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA_TUNING.fov, 1, 0.1, 600);
  }

  resize(aspect: number): void {
    this.camera.aspect = Math.max(aspect, 0.1);
    this.camera.updateProjectionMatrix();
  }

  snapTo(target: THREE.Vector3, heading: number): void {
    this.computeDesired(target, heading);
    this.camera.position.copy(this.desiredPosition);
    this.smoothedLookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.smoothedLookAt);
  }

  update(dt: number, target: THREE.Vector3, heading: number): void {
    this.computeDesired(target, heading);

    const positionAlpha = dampAlpha(CAMERA_TUNING.positionTau, dt);
    const yawAlpha = dampAlpha(CAMERA_TUNING.yawTau, dt);

    this.camera.position.lerp(this.desiredPosition, positionAlpha);
    this.smoothedLookAt.lerp(this.desiredLookAt, yawAlpha);
    this.camera.lookAt(this.smoothedLookAt);
  }

  private computeDesired(target: THREE.Vector3, heading: number): void {
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));

    this.desiredPosition.copy(target).addScaledVector(this.forward, -CAMERA_TUNING.distance);
    this.desiredPosition.y = Math.max(
      target.y + CAMERA_TUNING.height,
      target.y + CAMERA_TUNING.minGroundClearance,
    );

    this.desiredLookAt.copy(target).addScaledVector(this.forward, CAMERA_TUNING.lookAhead);
    this.desiredLookAt.y = target.y + CAMERA_TUNING.lookHeight;
  }
}
