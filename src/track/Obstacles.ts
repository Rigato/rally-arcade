import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Car } from '../car/Car';
import type { Track, TrackZoneId } from './Track';

/**
 * Obstáculos sólidos fora da pista (M4b).
 *
 * A lista é gerada uma vez com seed fixa em coordenadas (s,u): sempre os
 * mesmos obstáculos, sempre fora da pista e longe de largada, portal,
 * chegada e kickers. O visual é low poly instanciado; a colisão usa círculos
 * horizontais independentes da malha.
 */

export type ObstacleType = 'rock' | 'tree' | 'log';
export type ObstacleVariant = 'rock-dodeca' | 'rock-icosa' | 'pine' | 'cactus' | 'log';

/** Informação pública de um obstáculo (debug, validação e testes). */
export interface ObstacleInfo {
  readonly index: number;
  readonly type: ObstacleType;
  readonly variant: ObstacleVariant;
  readonly s: number;
  readonly u: number;
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
  readonly radius: number;
  /** Altura do colisor acima do chão (m); serve para saltar por cima. */
  readonly height: number;
}

interface Obstacle extends ObstacleInfo {
  readonly yaw: number;
  readonly scale: number;
  readonly length: number;
  readonly color: THREE.Color;
}

/** Raio do carro e offset dos dois círculos ao longo do heading. */
const CAR_COLLIDER_RADIUS = 0.85;
const CAR_COLLIDER_OFFSET = 1.2;
/** Restituição do ricochete e perda de velocidade depois do impacto. */
const RESTITUTION = 0.25;
const IMPACT_SPEED_KEEP = 0.5;
const COLLISION_ITERATIONS = 2;
/** Margem mínima entre a borda da pista e o colisor. */
const EDGE_CLEARANCE = 5.0;
const EDGE_MAX_OFFSET = 10.0;
const MIN_OBSTACLE_GAP = 4.0;
/** Evita obstáculos em cima dos portais, da chegada, da largada e dos kickers. */
const PORTAL_CLEARANCE = 12;
const FINISH_CLEARANCE = 14;
const START_CLEARANCE = 10;
const KICKER_CLEARANCE = 10;
/** Zona de pouso/run-out depois da rampa, livre de obstáculos. */
const LANDING_CLEARANCE = 40;
/** Faixa de geração: começa depois da largada e termina antes da chegada. */
const GENERATION_START_OFFSET = 15;
const GENERATION_END_OFFSET = 15;
const TARGET_MIN = 44;
const TARGET_MAX = 50;
const S_STEP_MIN = 9.5;
const S_STEP_MAX = 13.0;
const MAX_PLACEMENT_ATTEMPTS = 320;

const UP = new THREE.Vector3(0, 1, 0);
const ROCK_RADIUS = 0.9;
const FOREST_ROCK_COLORS = [0x9aa09a, 0x767d76, 0xb6b8ae, 0x616864];
const DESERT_ROCK_COLORS = [0xd0c09b, 0xb09d79, 0xdfd2b1, 0x978767];
const PINE_CROWN_COLORS = [0x2f5a38, 0x356440, 0x294f32, 0x3b6b45];
const CACTUS_COLORS = [0x4f7d4b, 0x5b8a54, 0x457145, 0x648f5c];
const LOG_COLORS = [0x6a4a30, 0x755235, 0x5d4029, 0x7d5839];

const KIND_DEBUG_COLORS: Record<ObstacleType, number> = {
  rock: 0xff5da8,
  tree: 0xffc247,
  log: 0x59d7ff,
};

export class Obstacles {
  readonly group = new THREE.Group();

  private readonly track: Track;
  private readonly items: Obstacle[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private colliderDebugGroup: THREE.Group | null = null;
  private colliderDebugVisible = false;

  readonly portalSs: readonly number[];
  readonly finishS: number;

  constructor(track: Track) {
    this.track = track;
    this.group.name = 'obstacles';

    this.portalSs = track.def.zones.slice(1).map((zone) => zone.start);
    this.finishS = track.length - 5;

    this.generate();

    this.group.add(
      ...this.buildRockMeshes(),
      ...this.buildPineMeshes(),
      ...this.buildCactusMeshes(),
      ...this.buildLogMeshes(),
    );

    const issues = this.validate();
    if (issues.length > 0) {
      console.warn(`[Obstacles] ${issues.length} problema(s) de validação:`, issues);
    }

    console.info(
      `[Obstacles] ${this.items.length} obstáculos sólidos ` +
        `(${this.countByType('rock')} rochas, ${this.countByType('tree')} árvores, ` +
        `${this.countByType('log')} troncos).`,
    );
  }

  getCount(): number {
    return this.items.length;
  }

  getObstacles(): readonly ObstacleInfo[] {
    return this.items;
  }

  /** Obstáculo mais próximo em `s` (para debug e testes). */
  getNearestObstacle(s: number): ObstacleInfo | null {
    if (this.items.length === 0) {
      return null;
    }

    let best = this.items[0];
    let bestDistance = Math.abs(best.s - s);

    for (let i = 1; i < this.items.length; i += 1) {
      const distance = Math.abs(this.items[i].s - s);
      if (distance < bestDistance) {
        best = this.items[i];
        bestDistance = distance;
      }
    }

    return best;
  }

  /** Próximo obstáculo à frente de `s`; dá a volta se não houver mais. */
  getNextObstacle(s: number): ObstacleInfo | null {
    if (this.items.length === 0) {
      return null;
    }

    let best: Obstacle | null = null;
    for (const obstacle of this.items) {
      if (obstacle.s <= s + 0.5) {
        continue;
      }
      if (best === null || obstacle.s < best.s) {
        best = obstacle;
      }
    }

    return best ?? this.items[0];
  }

  /**
   * Resolve a colisão carro ↔ obstáculos.
   *
   * Dois círculos no carro (±1,2 m ao longo do heading, raio 0,85 m). Para
   * cada sobreposição: push-out pela penetração e, se a velocidade normal
   * aponta para o obstáculo, ricochete com restituição 0,25 seguido de perda
   * forte de velocidade. Duas iterações resolvem contatos simultâneos.
   *
   * Retorna a maior intensidade de impacto (m/s) ou 0 se não houve colisão.
   * Não muda a altura, o heading nem o yaw; não há dano nem capotamento.
   */
  resolveCollisions(car: Car): number {
    const state = car.state;
    let maxImpact = 0;
    let touched = false;

    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);

    for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
      let resolvedThisPass = false;

      for (const obstacle of this.items) {
        // Árvores altas sempre colidem. Rochas e troncos baixos podem ser
        // saltados quando o carro está claramente acima do topo.
        if (
          obstacle.type !== 'tree' &&
          state.airborne &&
          state.position.y > obstacle.groundY + obstacle.height + 0.2
        ) {
          continue;
        }

        const combinedRadius = CAR_COLLIDER_RADIUS + obstacle.radius;
        let contactCount = 0;
        let chosenNormalX = 0;
        let chosenNormalZ = 0;
        let chosenPenetration = 0;
        let firstNormalX = 0;
        let firstNormalZ = 0;
        let secondNormalX = 0;
        let secondNormalZ = 0;

        for (let circleIndex = 0; circleIndex < 2; circleIndex += 1) {
          const offset = circleIndex === 0 ? CAR_COLLIDER_OFFSET : -CAR_COLLIDER_OFFSET;
          const circleX = state.position.x + forwardX * offset;
          const circleZ = state.position.z + forwardZ * offset;
          const dx = circleX - obstacle.x;
          const dz = circleZ - obstacle.z;
          const distanceSq = dx * dx + dz * dz;

          if (distanceSq >= combinedRadius * combinedRadius) {
            continue;
          }

          const distance = Math.sqrt(distanceSq);
          let normalX: number;
          let normalZ: number;

          if (distance < 1e-4) {
            // Centros coincidentes: usa o vetor right do carro.
            normalX = rightX;
            normalZ = rightZ;
          } else {
            normalX = dx / distance;
            normalZ = dz / distance;
          }

          const penetration = combinedRadius - distance;
          contactCount += 1;

          if (contactCount === 1) {
            firstNormalX = normalX;
            firstNormalZ = normalZ;
            chosenNormalX = normalX;
            chosenNormalZ = normalZ;
            chosenPenetration = penetration;
          } else {
            secondNormalX = normalX;
            secondNormalZ = normalZ;
            if (penetration > chosenPenetration) {
              chosenNormalX = normalX;
              chosenNormalZ = normalZ;
              chosenPenetration = penetration;
            }
          }
        }

        if (contactCount === 0) {
          continue;
        }

        // Os dois círculos do carro podem tocar lados opostos do obstáculo
        // (obstáculo "entre" frente e traseira). Empurrar cada um em sequência
        // cancelaria a correção; nesse caso empurra o carro de lado.
        if (
          contactCount > 1 &&
          firstNormalX * secondNormalX + firstNormalZ * secondNormalZ < -0.2
        ) {
          const toCarX = state.position.x - obstacle.x;
          const toCarZ = state.position.z - obstacle.z;
          const lateral = toCarX * rightX + toCarZ * rightZ;
          const sign = lateral < 0 ? -1 : 1;
          chosenNormalX = rightX * sign;
          chosenNormalZ = rightZ * sign;
          chosenPenetration = combinedRadius;
        }

        state.position.x += chosenNormalX * chosenPenetration;
        state.position.z += chosenNormalZ * chosenPenetration;
        resolvedThisPass = true;
        touched = true;

        const velocityX = state.velocity.x;
        const velocityZ = state.velocity.z;
        const normalVelocity =
          velocityX * chosenNormalX + velocityZ * chosenNormalZ;

        // Já está se afastando: só corrige a sobreposição, sem impulso novo.
        if (normalVelocity >= 0) {
          continue;
        }

        const impact = -normalVelocity;
        if (impact > maxImpact) {
          maxImpact = impact;
        }

        // Reflexão com restituição e depois perda forte de velocidade,
        // como no GDD: tira muito velocidade e dá um leve ricochete.
        const reflectedX =
          (velocityX - (1 + RESTITUTION) * normalVelocity * chosenNormalX) *
          IMPACT_SPEED_KEEP;
        const reflectedZ =
          (velocityZ - (1 + RESTITUTION) * normalVelocity * chosenNormalZ) *
          IMPACT_SPEED_KEEP;

        state.velocity.x = reflectedX;
        state.velocity.z = reflectedZ;
      }

      if (!resolvedThisPass) {
        break;
      }
    }

    if (touched) {
      this.syncCarSpeed(car);
    }

    return maxImpact;
  }

  /** Liga/desliga o wireframe dos colisores (debug no painel). */
  setColliderDebugVisible(visible: boolean): void {
    this.colliderDebugVisible = visible;

    if (visible && this.colliderDebugGroup === null) {
      this.colliderDebugGroup = this.buildColliderDebug();
      this.group.add(this.colliderDebugGroup);
    }

    if (this.colliderDebugGroup !== null) {
      this.colliderDebugGroup.visible = visible;
    }
  }

  isColliderDebugVisible(): boolean {
    return this.colliderDebugVisible;
  }

  /** Lista de problemas de geração; vazia quando tudo está dentro das regras. */
  validate(): string[] {
    const issues: string[] = [];
    const firstS = this.track.startS + START_CLEARANCE;
    const lastS = this.track.length - FINISH_CLEARANCE;

    for (const obstacle of this.items) {
      const half = this.track.widthAt(obstacle.s) * 0.5;
      const edgeDistance = Math.abs(obstacle.u) - half;

      if (edgeDistance - obstacle.radius < EDGE_CLEARANCE - 1e-6) {
        issues.push(
          `#${obstacle.index} (${obstacle.type}) invade o ombro: ` +
            `${edgeDistance.toFixed(2)} m da borda, raio ${obstacle.radius.toFixed(2)}.`,
        );
      }

      if (obstacle.s < firstS - 1e-6 || obstacle.s > lastS + 1e-6) {
        issues.push(
          `#${obstacle.index} (${obstacle.type}) fora da faixa segura: s=${obstacle.s.toFixed(1)}.`,
        );
      }

      for (const portalS of this.portalSs) {
        if (Math.abs(obstacle.s - portalS) < PORTAL_CLEARANCE - 1e-6) {
          issues.push(
            `#${obstacle.index} perto do portal de s=${portalS}: s=${obstacle.s.toFixed(1)}.`,
          );
        }
      }

      if (obstacle.s > this.track.length - FINISH_CLEARANCE + 1e-6) {
        issues.push(`#${obstacle.index} perto da chegada: s=${obstacle.s.toFixed(1)}.`);
      }

      for (const kicker of this.track.def.kickers) {
        if (
          obstacle.s >= kicker.s - KICKER_CLEARANCE &&
          obstacle.s <=
            kicker.s + kicker.length + KICKER_CLEARANCE + LANDING_CLEARANCE
        ) {
          issues.push(
            `#${obstacle.index} na faixa da rampa/pouso de s=${kicker.s} m: ` +
              `s=${obstacle.s.toFixed(1)}.`,
          );
        }
      }

      if (obstacle.radius < 0.55 - 1e-6 || obstacle.radius > 1.4 + 1e-6) {
        issues.push(
          `#${obstacle.index} com raio fora da faixa: ${obstacle.radius.toFixed(2)}.`,
        );
      }

      for (const other of this.items) {
        if (other.index <= obstacle.index) {
          continue;
        }
        const dx = other.x - obstacle.x;
        const dz = other.z - obstacle.z;
        if (Math.hypot(dx, dz) < MIN_OBSTACLE_GAP - 1e-6) {
          issues.push(
            `#${obstacle.index} e #${other.index} a menos de ${MIN_OBSTACLE_GAP} m.`,
          );
        }
      }
    }

    return issues;
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.colliderDebugGroup = null;
    this.colliderDebugVisible = false;
  }

  private generate(): void {
    const rng = mulberry32(0x5eed0b57);
    const from = this.track.startS + GENERATION_START_OFFSET;
    const to = this.track.length - GENERATION_END_OFFSET;
    let s = from;
    let attempts = 0;

    while (s <= to && attempts < MAX_PLACEMENT_ATTEMPTS) {
      attempts += 1;

      if (this.items.length >= TARGET_MAX) {
        break;
      }

      const jitteredS = clamp(s + (rng() - 0.5) * 2.4, from, to);
      const side = rng() < 0.5 ? -1 : 1;
      this.tryPlace(jitteredS, side, rng);

      s += S_STEP_MIN + rng() * (S_STEP_MAX - S_STEP_MIN);
    }

    // Segunda passada (mais densa) só se a primeira ficou abaixo do mínimo.
    if (this.items.length < TARGET_MIN) {
      let fillS = from;
      while (fillS <= to && this.items.length < TARGET_MIN) {
        const jitter = (rng() - 0.5) * 8;
        this.tryPlace(
          clamp(fillS + jitter, from, to),
          this.items.length % 2 === 0 ? 1 : -1,
          rng,
        );
        fillS += 6 + rng() * 4;
      }
    }

    // A ordem de geração já é crescente em s; ordenar garante índices estáveis.
    this.items.sort((a, b) => a.s - b.s);
    for (let i = 0; i < this.items.length; i += 1) {
      (this.items[i] as { index: number }).index = i;
    }
  }

  private tryPlace(s: number, side: number, rng: () => number): void {
    if (!this.isClearOfTrackFeatures(s)) {
      return;
    }

    const zone = this.track.zoneAt(s);
    const type = this.pickType(zone, rng);
    const dimensions = this.pickDimensions(type, zone, rng);
    const minOffset = EDGE_CLEARANCE + dimensions.radius;
    const span = EDGE_MAX_OFFSET - minOffset;

    if (span <= 0) {
      return;
    }

    // Uniforme na faixa disponível: distâncias variadas da borda.
    const offset = minOffset + rng() * span;
    const sample = this.track.sampleAt(s);
    const u = side * (sample.width * 0.5 + offset);
    const x = sample.position.x + sample.right.x * u;
    const z = sample.position.z + sample.right.z * u;
    const groundY = this.track.heightAt(s, u);

    for (const other of this.items) {
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < MIN_OBSTACLE_GAP * MIN_OBSTACLE_GAP) {
        return;
      }
    }

    this.items.push({
      index: -1,
      type,
      variant: dimensions.variant,
      s,
      u,
      x,
      z,
      groundY,
      radius: dimensions.radius,
      height: dimensions.height,
      yaw: rng() * Math.PI * 2,
      scale: dimensions.scale,
      length: dimensions.length,
      color: this.pickColor(type, zone, dimensions.variant, rng),
    });
  }

  private isClearOfTrackFeatures(s: number): boolean {
    if (s < this.track.startS + START_CLEARANCE) {
      return false;
    }
    if (s > this.track.length - FINISH_CLEARANCE) {
      return false;
    }
    for (const portalS of this.portalSs) {
      if (Math.abs(s - portalS) < PORTAL_CLEARANCE) {
        return false;
      }
    }

    for (const kicker of this.track.def.kickers) {
      if (
        s >= kicker.s - KICKER_CLEARANCE &&
        s <= kicker.s + kicker.length + KICKER_CLEARANCE + LANDING_CLEARANCE
      ) {
        return false;
      }
    }

    return true;
  }

  private pickType(zone: TrackZoneId, rng: () => number): ObstacleType {
    const roll = rng();

    if (zone === 'forest') {
      return roll < 0.38 ? 'tree' : roll < 0.74 ? 'rock' : 'log';
    }

    return roll < 0.3 ? 'tree' : roll < 0.72 ? 'rock' : 'log';
  }

  private pickDimensions(
    type: ObstacleType,
    zone: TrackZoneId,
    rng: () => number,
  ): {
    variant: ObstacleVariant;
    radius: number;
    height: number;
    scale: number;
    length: number;
  } {
    if (type === 'rock') {
      const radius = 0.55 + rng() * 0.7;
      const height = Math.max(0.65, radius * (0.8 + rng() * 0.8));
      return {
        variant: rng() < 0.5 ? 'rock-dodeca' : 'rock-icosa',
        radius,
        height,
        scale: 1,
        length: 0,
      };
    }

    if (type === 'log') {
      const length = 2.4 + rng() * 1.3;
      return {
        variant: 'log',
        radius: 0.75 + rng() * 0.35,
        height: 0.7 + rng() * 0.12,
        scale: 1,
        length,
      };
    }

    if (zone === 'forest') {
      const scale = 0.85 + rng() * 0.35;
      return {
        variant: 'pine',
        radius: 0.62 + rng() * 0.24,
        height: 6.4 * scale,
        scale,
        length: 0,
      };
    }

    const scale = 0.85 + rng() * 0.3;
    return {
      variant: 'cactus',
      radius: 0.6 + rng() * 0.22,
      height: 4.2 * scale,
      scale,
      length: 0,
    };
  }

  private pickColor(
    type: ObstacleType,
    zone: TrackZoneId,
    variant: ObstacleVariant,
    rng: () => number,
  ): THREE.Color {
    if (type === 'rock') {
      const palette = zone === 'forest' ? FOREST_ROCK_COLORS : DESERT_ROCK_COLORS;
      return new THREE.Color(palette[Math.floor(rng() * palette.length)]);
    }

    if (type === 'log') {
      return new THREE.Color(LOG_COLORS[Math.floor(rng() * LOG_COLORS.length)]);
    }

    if (variant === 'cactus') {
      return new THREE.Color(CACTUS_COLORS[Math.floor(rng() * CACTUS_COLORS.length)]);
    }

    return new THREE.Color(
      PINE_CROWN_COLORS[Math.floor(rng() * PINE_CROWN_COLORS.length)],
    );
  }

  private buildRockMeshes(): THREE.Object3D[] {
    const dodeca = this.items.filter((item) => item.variant === 'rock-dodeca');
    const icosa = this.items.filter((item) => item.variant === 'rock-icosa');
    const meshes: THREE.Object3D[] = [];

    for (const [name, items, geometry] of [
      ['obstacle-rocks-dodeca', dodeca, new THREE.DodecahedronGeometry(ROCK_RADIUS, 0)],
      ['obstacle-rocks-icosa', icosa, new THREE.IcosahedronGeometry(ROCK_RADIUS, 0)],
    ] as const) {
      if (items.length === 0) {
        geometry.dispose();
        continue;
      }

      const material = this.standardMaterial();
      const mesh = this.instanced(name, geometry, material, items.length);
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      items.forEach((rock, index) => {
        position.set(rock.x, rock.groundY + rock.height * 0.5, rock.z);
        quaternion.setFromAxisAngle(UP, rock.yaw);
        scale.set(rock.radius / ROCK_RADIUS, rock.height / (ROCK_RADIUS * 2), rock.radius / ROCK_RADIUS);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, rock.color);
      });

      this.finishInstances(mesh);
      meshes.push(mesh);
    }

    return meshes;
  }

  private buildPineMeshes(): THREE.Object3D[] {
    const pines = this.items.filter((item) => item.variant === 'pine');
    if (pines.length === 0) {
      return [];
    }

    const meshes: THREE.Object3D[] = [];
    const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.32, 2.7, 6);
    trunkGeometry.translate(0, 1.35, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b4b32,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
    });
    const trunk = this.instanced(
      'obstacle-pine-trunks',
      trunkGeometry,
      trunkMaterial,
      pines.length,
    );

    const layers: ReadonlyArray<readonly [number, number, number]> = [
      [2.0, 3.0, 2.0],
      [1.5, 2.5, 3.7],
      [1.0, 2.0, 5.0],
    ];

    const crowns = layers.map(([radius, height, baseY], index) => {
      const geometry = new THREE.ConeGeometry(radius, height, 7);
      geometry.translate(0, baseY + height * 0.5, 0);
      const material = this.standardMaterial();
      const mesh = this.instanced(
        `obstacle-pine-crown-${index}`,
        geometry,
        material,
        pines.length,
      );
      return { mesh, material };
    });

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    pines.forEach((pine, index) => {
      position.set(pine.x, pine.groundY, pine.z);
      quaternion.setFromAxisAngle(UP, pine.yaw);
      scale.setScalar(pine.scale);

      matrix.compose(position, quaternion, scale);
      trunk.setMatrixAt(index, matrix);
      trunk.setColorAt(index, new THREE.Color(0x6b4b32));

      for (const { mesh } of crowns) {
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, pine.color);
      }
    });

    this.finishInstances(trunk);
    meshes.push(trunk);

    for (const { mesh } of crowns) {
      this.finishInstances(mesh);
      meshes.push(mesh);
    }

    return meshes;
  }

  private buildCactusMeshes(): THREE.Object3D[] {
    const cacti = this.items.filter((item) => item.variant === 'cactus');
    if (cacti.length === 0) {
      return [];
    }

    const meshes: THREE.Object3D[] = [];
    const trunkGeometry = new THREE.CylinderGeometry(0.28, 0.4, 3.2, 7);
    trunkGeometry.translate(0, 1.6, 0);
    const armGeometry = new THREE.CylinderGeometry(0.16, 0.18, 1.2, 6);
    armGeometry.translate(0, 0.6, 0);
    const jointGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6);
    jointGeometry.rotateZ(Math.PI * 0.5);

    const material = this.standardMaterial();
    const trunk = this.instanced(
      'obstacle-cactus-trunks',
      trunkGeometry,
      material,
      cacti.length,
    );
    const arms = this.instanced(
      'obstacle-cactus-arms',
      armGeometry,
      material,
      cacti.length * 2,
    );
    const joints = this.instanced(
      'obstacle-cactus-joints',
      jointGeometry,
      material,
      cacti.length * 2,
    );

    const baseMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    cacti.forEach((cactus, index) => {
      position.set(cactus.x, cactus.groundY, cactus.z);
      quaternion.setFromAxisAngle(UP, cactus.yaw);
      scale.setScalar(cactus.scale);
      baseMatrix.compose(position, quaternion, scale);

      trunk.setMatrixAt(index, baseMatrix);
      trunk.setColorAt(index, cactus.color);

      for (let arm = 0; arm < 2; arm += 1) {
        const side = arm === 0 ? 1 : -1;
        const armY = arm === 0 ? 1.15 : 1.55;
        const instanceIndex = index * 2 + arm;

        localMatrix.makeTranslation(side * 0.58, armY, 0);
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        arms.setMatrixAt(instanceIndex, finalMatrix);
        arms.setColorAt(instanceIndex, cactus.color);

        localMatrix.makeTranslation(side * 0.32, armY, 0);
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        joints.setMatrixAt(instanceIndex, finalMatrix);
        joints.setColorAt(instanceIndex, cactus.color);
      }
    });

    for (const mesh of [trunk, arms, joints]) {
      this.finishInstances(mesh);
      meshes.push(mesh);
    }

    return meshes;
  }

  private buildLogMeshes(): THREE.Object3D[] {
    const logs = this.items.filter((item) => item.variant === 'log');
    if (logs.length === 0) {
      return [];
    }

    const geometry = new THREE.CylinderGeometry(0.4, 0.4, 1, 8);
    geometry.rotateZ(Math.PI * 0.5);
    const material = this.standardMaterial();
    const mesh = this.instanced('obstacle-logs', geometry, material, logs.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    logs.forEach((log, index) => {
      position.set(log.x, log.groundY + 0.36, log.z);
      quaternion.setFromAxisAngle(UP, log.yaw);
      scale.set(log.length, 0.9, 0.9);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, log.color);
    });

    this.finishInstances(mesh);
    return [mesh];
  }

  private buildColliderDebug(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'obstacle-colliders-debug';

    const positions: number[] = [];
    const colors: number[] = [];
    const segments = 12;

    for (const obstacle of this.items) {
      const color = new THREE.Color(KIND_DEBUG_COLORS[obstacle.type]);
      const baseY = obstacle.groundY + 0.05;
      const topY = obstacle.groundY + obstacle.height;

      for (let segment = 0; segment < segments; segment += 1) {
        const a0 = (segment / segments) * Math.PI * 2;
        const a1 = ((segment + 1) / segments) * Math.PI * 2;
        const x0 = obstacle.x + Math.cos(a0) * obstacle.radius;
        const z0 = obstacle.z + Math.sin(a0) * obstacle.radius;
        const x1 = obstacle.x + Math.cos(a1) * obstacle.radius;
        const z1 = obstacle.z + Math.sin(a1) * obstacle.radius;

        positions.push(x0, baseY, z0, x1, baseY, z1);
        positions.push(x0, topY, z0, x1, topY, z1);
        pushColor(colors, color, 2);

        if (segment % 3 === 0) {
          positions.push(x0, baseY, z0, x0, topY, z0);
          pushColor(colors, color, 1);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'obstacle-colliders-wireframe';
    group.add(lines);
    group.visible = this.colliderDebugVisible;

    this.geometries.push(geometry);
    this.materials.push(material);
    return group;
  }

  private instanced(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.name = name;
    mesh.count = count;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private finishInstances(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }

  private standardMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
    });
  }

  private countByType(type: ObstacleType): number {
    let count = 0;
    for (const item of this.items) {
      if (item.type === type) {
        count += 1;
      }
    }
    return count;
  }

  /** Sincroniza velocidade/telemetria depois do push-out e do ricochete. */
  private syncCarSpeed(car: Car): void {
    const state = car.state;
    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);
    const velocityX = state.velocity.x;
    const velocityZ = state.velocity.z;
    const speed = Math.hypot(velocityX, velocityZ);
    const longitudinal = velocityX * forwardX + velocityZ * forwardZ;
    const lateral = velocityX * rightX + velocityZ * rightZ;

    state.speed = speed;
    car.telemetry.speed = speed;
    car.telemetry.longitudinalSpeed = longitudinal;
    car.telemetry.lateralSpeed = lateral;
    car.telemetry.slipAngle = Math.atan2(lateral, Math.abs(longitudinal) + 0.05);
  }
}

function pushColor(colors: number[], color: THREE.Color, times: number): void {
  for (let i = 0; i < times; i += 1) {
    colors.push(color.r, color.g, color.b);
  }
}

/** PRNG determinística (mulberry32), igual à do cenário. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
