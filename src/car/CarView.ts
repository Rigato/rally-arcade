import * as THREE from 'three';
import { Spring } from '../core/Spring';
import { clamp, dampAlpha } from '../core/math';

export interface CarViewState {
  speed: number;
  /** Esterço de entrada (-1..1). */
  steer: number;
  lateralAccel: number;
  longAccel: number;
  handbrake: boolean;
  grounded: boolean;
}

interface WheelVisual {
  steerPivot: THREE.Group;
  spinGroup: THREE.Group;
  front: boolean;
}

const WHEEL_RADIUS = 0.38;
const MAX_VISUAL_STEER = 0.5;
const MAX_ROLL = THREE.MathUtils.degToRad(8);
const MAX_PITCH = THREE.MathUtils.degToRad(4);
const ROLL_PER_ACCEL = 0.009;
const PITCH_PER_ACCEL = 0.006;

/**
 * Carro low poly com hierarquia para animação visual:
 *
 * `root` (posição + heading)
 *   ├── `bodyPivot` (roll/pitch) → carroceria
 *   ├── rodas (pivot de esterço → grupo de giro → pneu)
 *   └── sombra blob
 *
 * Nenhuma dessas animações participa da física.
 */
export class CarView {
  readonly root = new THREE.Group();

  private readonly bodyPivot = new THREE.Group();
  private readonly wheels: WheelVisual[] = [];
  private readonly rollSpring = new Spring(90, 14, MAX_ROLL);
  private readonly pitchSpring = new Spring(90, 14, MAX_PITCH);
  private readonly shadow: THREE.Mesh;

  private spinAngle = 0;
  private steerAngle = 0;

  constructor() {
    this.root.name = 'car';
    this.bodyPivot.name = 'car-body-pivot';
    this.bodyPivot.position.y = 0.55;
    this.root.add(this.bodyPivot);

    this.buildBody();
    this.buildWheels();
    this.shadow = this.buildShadow();
  }

  setPose(position: THREE.Vector3, heading: number): void {
    this.root.position.copy(position);
    this.root.rotation.y = heading;
  }

  /** Zera roll, pitch, esterço e giro das rodas (reset da corrida). */
  reset(): void {
    this.spinAngle = 0;
    this.steerAngle = 0;
    this.rollSpring.reset();
    this.pitchSpring.reset();
    this.bodyPivot.rotation.set(0, 0, 0);

    for (const wheel of this.wheels) {
      wheel.steerPivot.rotation.y = 0;
      wheel.spinGroup.rotation.x = 0;
    }
  }

  update(dt: number, state: CarViewState): void {
    if (dt <= 0) {
      return;
    }

    // Rodas dianteiras esterçam; todas giram com a velocidade; traseiras
    // travam no freio de mão.
    const steerTarget = clamp(state.steer, -1, 1) * MAX_VISUAL_STEER;
    this.steerAngle += (steerTarget - this.steerAngle) * dampAlpha(0.06, dt);

    const spinDelta = (state.speed / WHEEL_RADIUS) * dt;
    this.spinAngle = (this.spinAngle + spinDelta) % (Math.PI * 2);

    for (const wheel of this.wheels) {
      if (wheel.front) {
        wheel.steerPivot.rotation.y = this.steerAngle;
      }
      if (!wheel.front && state.handbrake) {
        continue;
      }
      wheel.spinGroup.rotation.x = this.spinAngle;
    }

    // Roll/pitch visuais via mola: só reagem à dinâmica, não alteram a física.
    const rollTarget = clamp(
      state.lateralAccel * ROLL_PER_ACCEL,
      -MAX_ROLL,
      MAX_ROLL,
    );
    const pitchTarget = clamp(
      -state.longAccel * PITCH_PER_ACCEL,
      -MAX_PITCH,
      MAX_PITCH,
    );

    this.bodyPivot.rotation.z = this.rollSpring.update(rollTarget, dt);
    this.bodyPivot.rotation.x = this.pitchSpring.update(pitchTarget, dt);

    const shadowMaterial = this.shadow.material as THREE.MeshBasicMaterial;
    shadowMaterial.opacity = state.grounded ? 0.32 : 0.16;
  }

  private buildBody(): void {
    const paint = new THREE.MeshStandardMaterial({
      color: 0xd94b36,
      roughness: 0.55,
      metalness: 0.12,
      flatShading: true,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1c2b36,
      roughness: 0.35,
      metalness: 0.25,
      flatShading: true,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x1b1f22,
      roughness: 0.9,
      flatShading: true,
    });
    const light = new THREE.MeshStandardMaterial({
      color: 0xffe7a8,
      emissive: 0xffd166,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 3.5), paint);
    chassis.position.y = 0.07;
    this.bodyPivot.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.52, 1.55), glass);
    cabin.position.set(0, 0.51, -0.18);
    this.bodyPivot.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.62), paint);
    roof.position.set(0, 0.81, -0.18);
    this.bodyPivot.add(roof);

    const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), trim);
    bumperFront.position.set(0, -0.05, 1.72);
    this.bodyPivot.add(bumperFront);

    const bumperRear = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), trim);
    bumperRear.position.set(0, -0.05, -1.72);
    this.bodyPivot.add(bumperRear);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.08, 0.34), trim);
    spoiler.position.set(0, 0.61, -1.55);
    this.bodyPivot.add(spoiler);

    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), light);
      headlight.position.set(side * 0.56, 0.19, 1.76);
      this.bodyPivot.add(headlight);
    }
  }

  private buildWheels(): void {
    // O cilindro nasce com o eixo em Y; girar em Z deixa o eixo ao longo de X.
    const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 12);
    wheelGeometry.rotateZ(Math.PI / 2);

    const tire = new THREE.MeshStandardMaterial({
      color: 0x14181b,
      roughness: 0.95,
      flatShading: true,
    });
    const hub = new THREE.MeshStandardMaterial({
      color: 0x9aa5a9,
      roughness: 0.6,
      metalness: 0.3,
      flatShading: true,
    });
    const hubGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 8);
    hubGeometry.rotateZ(Math.PI / 2);

    const positions: ReadonlyArray<readonly [number, number, boolean]> = [
      [-0.96, 1.16, true],
      [0.96, 1.16, true],
      [-0.96, -1.16, false],
      [0.96, -1.16, false],
    ];

    for (const [x, z, front] of positions) {
      const steerPivot = new THREE.Group();
      steerPivot.name = front ? 'wheel-front-steer' : 'wheel-rear';
      steerPivot.position.set(x, WHEEL_RADIUS, z);
      this.root.add(steerPivot);

      const spinGroup = new THREE.Group();
      steerPivot.add(spinGroup);

      const wheel = new THREE.Mesh(wheelGeometry, tire);
      spinGroup.add(wheel);

      const hubcap = new THREE.Mesh(hubGeometry, hub);
      spinGroup.add(hubcap);

      this.wheels.push({ steerPivot, spinGroup, front });
    }
  }

  private buildShadow(): THREE.Mesh {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    shadow.name = 'car-blob-shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.scale.set(1.1, 1.9, 1);
    shadow.renderOrder = -1;
    this.root.add(shadow);
    return shadow;
  }
}
