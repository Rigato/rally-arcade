import * as THREE from 'three';
import { Spring } from '../core/Spring';
import { clamp, dampAlpha } from '../core/math';
import { BODY_TUNING } from '../game/config';
import type { BodyTuning } from '../game/types';

export interface CarViewState {
  speed: number;
  /** Esterço de entrada (-1..1). */
  steer: number;
  lateralAccel: number;
  longAccel: number;
  handbrake: boolean;
  grounded: boolean;
  /** Altura do chão sob o carro (mundo). */
  groundY: number;
  /** Velocidade vertical da física (m/s). */
  verticalVelocity: number;
  airborne: boolean;
  /** Impacto do pouso a consumir neste frame (m/s, negativo). */
  landingImpact: number;
}

interface WheelVisual {
  steerPivot: THREE.Group;
  spinGroup: THREE.Group;
  front: boolean;
}

const WHEEL_RADIUS = 0.38;
const MAX_VISUAL_STEER = 0.5;
const MAX_AIR_PITCH = THREE.MathUtils.degToRad(11);
const AIR_PITCH_PER_VY = 0.018;
/** Limite físico das molas; o alvo é clampado pelo tuning visual. */
const SPRING_MAX_ANGLE = 0.5;
const BODY_HEIGHT = 0.55;
/** Converte o impacto (negativo) em velocidade da mola de heave. */
const LANDING_KICK_PER_IMPACT = 0.22;
const MAX_LANDING_KICK = 4.5;

/**
 * Carro low poly com hierarquia para animação visual:
 *
 * `root` (posição + heading + atitude do terreno)
 *   ├── `bodyPivot` (roll/pitch + heave) → carroceria
 *   └── rodas (pivot de esterço → grupo de giro → pneu)
 *
 * `shadow` é um grupo separado, no chão, adicionado à cena pelo Game.
 * Nenhuma dessas animações participa da física.
 */
export class CarView {
  readonly root = new THREE.Group();
  /** Blob shadow projetada no chão (o Game adiciona à cena). */
  readonly shadow = new THREE.Group();

  private readonly bodyPivot = new THREE.Group();
  private readonly wheels: WheelVisual[] = [];
  private readonly bodyTuning: BodyTuning;
  private readonly rollSpring = new Spring(90, 14, SPRING_MAX_ANGLE);
  private readonly pitchSpring = new Spring(90, 14, SPRING_MAX_ANGLE);
  private readonly heaveSpring = new Spring(110, 16, 0.3);
  private readonly shadowMesh: THREE.Mesh;

  private spinAngle = 0;
  private steerAngle = 0;
  private airPitch = 0;
  private shadowPitch = 0;
  private shadowRoll = 0;

  constructor(bodyTuning: BodyTuning = BODY_TUNING) {
    this.bodyTuning = bodyTuning;
    this.root.name = 'car';
    this.bodyPivot.name = 'car-body-pivot';
    this.bodyPivot.position.y = BODY_HEIGHT;
    this.root.add(this.bodyPivot);

    this.buildBody();
    this.buildWheels();
    this.shadowMesh = this.buildShadow();
  }

  setPose(position: THREE.Vector3, heading: number, terrainPitch = 0, terrainRoll = 0): void {
    this.root.position.copy(position);
    this.root.rotation.set(terrainPitch, heading, terrainRoll, 'YXZ');
  }

  /** Zera roll, pitch, heave, ar e sombra (reset / teleporte). */
  reset(): void {
    this.spinAngle = 0;
    this.steerAngle = 0;
    this.rollSpring.reset();
    this.pitchSpring.reset();
    this.heaveSpring.reset();
    this.bodyPivot.rotation.set(0, 0, 0);
    this.bodyPivot.position.y = BODY_HEIGHT;
    this.airPitch = 0;
    this.shadowPitch = 0;
    this.shadowRoll = 0;

    const shadowMaterial = this.shadowMesh.material as THREE.MeshBasicMaterial;
    shadowMaterial.opacity = 0.32;
    this.shadowMesh.scale.set(1.1, 1.9, 1);
    this.shadow.position.copy(this.root.position);
    this.shadow.position.y += 0.025;
    this.shadow.rotation.set(0, this.root.rotation.y, 0, 'YXZ');

    for (const wheel of this.wheels) {
      wheel.steerPivot.rotation.y = 0;
      wheel.spinGroup.rotation.x = 0;
    }
  }

  /**
   * Pequeno afundamento da carroceria ao bater em obstáculo (só visual).
   * A intensidade vem da velocidade normal do impacto (m/s).
   */
  impact(strength: number): void {
    if (!Number.isFinite(strength) || strength <= 0) {
      return;
    }

    this.heaveSpring.kick(-clamp(strength * 0.06, 0.3, 1.8));
  }

  update(dt: number, state: CarViewState): void {
    if (dt <= 0) {
      return;
    }

    // Rodas dianteiras esterçam; todas giram com a velocidade; traseiras
    // travam no freio de mão. No ar o giro continua.
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

    // Impacto de pouso: injeta velocidade negativa na mola de heave, que
    // afunda a carroceria e volta amortecida.
    if (state.landingImpact < 0) {
      this.heaveSpring.kick(
        clamp(
          state.landingImpact * LANDING_KICK_PER_IMPACT,
          -MAX_LANDING_KICK,
          0,
        ),
      );
    }
    const heave = this.heaveSpring.update(0, dt);

    // Roll/pitch visuais via mola: só reagem à dinâmica, não alteram a física.
    // O termo de esterço dá vida em curvas lentas, quando a aceleração lateral
    // ainda é pequena; em velocidade, o termo lateral domina.
    const maxRoll = THREE.MathUtils.degToRad(this.bodyTuning.maxRollDeg);
    const maxPitch = THREE.MathUtils.degToRad(this.bodyTuning.maxPitchDeg);
    const speedInfluence = clamp(state.speed / 8, 0, 1);
    const rollTarget = clamp(
      state.lateralAccel * this.bodyTuning.rollPerLateralAccel +
        state.steer * this.bodyTuning.rollPerSteer * speedInfluence,
      -maxRoll,
      maxRoll,
    );
    const pitchTarget = clamp(
      -state.longAccel * this.bodyTuning.pitchPerLongAccel,
      -maxPitch,
      maxPitch,
    );

    // No ar o nariz acompanha a velocidade vertical (subindo = para cima).
    const airPitchTarget = state.airborne
      ? clamp(-state.verticalVelocity * AIR_PITCH_PER_VY, -MAX_AIR_PITCH, MAX_AIR_PITCH)
      : 0;
    this.airPitch += (airPitchTarget - this.airPitch) * dampAlpha(0.12, dt);

    this.bodyPivot.position.y = BODY_HEIGHT + heave;
    this.bodyPivot.rotation.z = this.rollSpring.update(rollTarget, dt);
    this.bodyPivot.rotation.x =
      this.pitchSpring.update(pitchTarget, dt) + this.airPitch;

    this.updateShadow(dt, state);
  }

  private updateShadow(dt: number, state: CarViewState): void {
    const heightAboveGround = Math.max(0, this.root.position.y - state.groundY);

    // A sombra fica no chão, não no carro. Quanto mais alto, menor e mais
    // clara; no chão ela acompanha pitch/roll do terreno.
    const scaleFactor = clamp(1 - heightAboveGround * 0.06, 0.55, 1);
    this.shadowMesh.scale.set(1.1 * scaleFactor, 1.9 * scaleFactor, 1);

    const shadowMaterial = this.shadowMesh.material as THREE.MeshBasicMaterial;
    shadowMaterial.opacity = 0.32 * clamp(1 - heightAboveGround * 0.09, 0.2, 1);

    const pitchTarget = state.airborne ? 0 : this.root.rotation.x;
    const rollTarget = state.airborne ? 0 : this.root.rotation.z;
    const alpha = dampAlpha(0.12, dt);
    this.shadowPitch += (pitchTarget - this.shadowPitch) * alpha;
    this.shadowRoll += (rollTarget - this.shadowRoll) * alpha;

    this.shadow.position.set(
      this.root.position.x,
      state.groundY + 0.025,
      this.root.position.z,
    );
    this.shadow.rotation.set(
      this.shadowPitch,
      this.root.rotation.y,
      this.shadowRoll,
      'YXZ',
    );
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
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = 'car-blob-shadow';
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(1.1, 1.9, 1);
    mesh.renderOrder = -1;

    this.shadow.name = 'car-blob-shadow-root';
    this.shadow.rotation.order = 'YXZ';
    this.shadow.add(mesh);
    return mesh;
  }
}
