import * as THREE from 'three';
import { clamp } from '../core/math';
import { HAZARD_TUNING } from '../game/config';
import type { Car } from '../car/Car';
import type { HazardKind, TrackHazard } from '../game/types';
import type { Track } from './Track';

const CAR_COLLIDER_RADIUS = 0.85;
const CAR_COLLIDER_OFFSET = 1.2;
const RESTITUTION = 0.25;
const IMPACT_SPEED_KEEP = 0.5;
const COLLISION_ITERATIONS = 2;
const CROSSING_MARGIN = 9;

type HazardState = 'idle' | 'crossing' | 'done';

interface HazardRuntime {
  readonly def: TrackHazard;
  readonly group: THREE.Group;
  state: HazardState;
  progress: number;
  crossingDistance: number;
  startU: number;
  endU: number;
  heading: number;
  elapsed: number;
}

interface HazardTemplate {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

const HAZARD_COLORS: Record<HazardKind, { body: number; dark: number; accent: number }> = {
  camel: { body: 0xc49a63, dark: 0x8f6b42, accent: 0x6b4b2c },
  deer: { body: 0x9a6a43, dark: 0x6b482d, accent: 0xe8dcc4 },
  reindeer: { body: 0x9d8b74, dark: 0x6b5d4c, accent: 0xd9cbb5 },
  car: { body: 0xd84f3f, dark: 0x272b2e, accent: 0xbfd7e0 },
  truck: { body: 0x3f6f9c, dark: 0x272b2e, accent: 0xc9d4d8 },
  tractor: { body: 0x4f8a3f, dark: 0x2d2f2b, accent: 0xd8b23f },
  cow: { body: 0xe4e0d2, dark: 0x33322f, accent: 0x9b8e7f },
  buggy: { body: 0xf0a52c, dark: 0x2b2b29, accent: 0x4b4f50 },
};

/**
 * Obstáculos móveis que atravessam a pista.
 *
 * Cada evento nasce parado fora da pista, começa a atravessar quando o carro
 * se aproxima e continua até o outro lado. A colisão usa um círculo simples
 * (dois para veículos longos, se necessário) e devolve a intensidade do
 * impacto para o feedback existente do Game.
 */
export class Hazards {
  readonly group = new THREE.Group();

  private readonly track: Track;
  private readonly events: HazardRuntime[] = [];
  private readonly templates = new Map<HazardKind, HazardTemplate>();
  private enabled: boolean;

  constructor(track: Track, enabled = HAZARD_TUNING.enabled) {
    this.track = track;
    this.enabled = enabled;
    this.group.name = 'hazards';

    for (const def of track.def.hazards ?? []) {
      const template = this.templateFor(def.kind);
      const group = template.group.clone(true);
      group.name = `hazard-${def.id}`;
      group.visible = false;
      this.group.add(group);

      const sample = track.sampleAt(def.s);
      const half = sample.width * 0.5;
      const startU = def.direction > 0 ? -(half + CROSSING_MARGIN) : half + CROSSING_MARGIN;
      const endU = -startU;
      const rightX = sample.right.x * def.direction;
      const rightZ = sample.right.z * def.direction;

      this.events.push({
        def,
        group,
        state: 'idle',
        progress: 0,
        crossingDistance: Math.abs(endU - startU),
        startU,
        endU,
        heading: Math.atan2(rightX, rightZ),
        elapsed: 0,
      });
    }

    if (!this.enabled) {
      this.group.visible = false;
    }
  }

  getCount(): number {
    return this.events.length;
  }

  getActiveCount(): number {
    return this.events.filter((event) => event.state === 'crossing').length;
  }

  getDefinitions(): readonly TrackHazard[] {
    return this.events.map((event) => event.def);
  }

  /** Próximo hazard à frente (debug). */
  getNextS(s: number): number | null {
    let best: number | null = null;
    for (const event of this.events) {
      if (event.state === 'done' || event.def.s <= s) {
        continue;
      }
      if (best === null || event.def.s < best) {
        best = event.def.s;
      }
    }
    return best;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    for (const event of this.events) {
      event.state = 'idle';
      event.progress = 0;
      event.elapsed = 0;
      event.group.visible = false;
      event.group.position.set(0, -1000, 0);
    }
    this.group.visible = this.enabled;
  }

  /**
   * Avança os eventos. `carS` é a posição na pista principal; o gatilho usa
   * a distância de reação para o objeto já estar atravessando na chegada.
   */
  update(dt: number, carS: number): void {
    if (!this.enabled) {
      return;
    }

    for (const event of this.events) {
      if (event.state === 'done') {
        continue;
      }

      if (event.state === 'idle') {
        const distance = event.def.s - carS;
        if (distance < -12) {
          event.state = 'done';
          event.group.visible = false;
          continue;
        }
        if (distance > HAZARD_TUNING.triggerDistance || distance < 0) {
          continue;
        }
        event.state = 'crossing';
        event.elapsed = 0;
        event.group.visible = true;
      }

      event.elapsed += dt;
      const speed = Math.max(0.1, event.def.speed);
      event.progress = clamp(
        event.progress + (speed / Math.max(1, event.crossingDistance)) * dt,
        0,
        1,
      );

      const u = event.startU + (event.endU - event.startU) * event.progress;
      const sample = this.track.sampleAt(event.def.s);
      const x = sample.position.x + sample.right.x * u;
      const z = sample.position.z + sample.right.z * u;
      const y = this.track.heightAt(event.def.s, u);

      event.group.position.set(x, y, z);
      event.group.rotation.y = event.heading;
      event.group.visible = true;

      if (event.progress >= 1) {
        event.state = 'done';
        event.group.visible = false;
      }
    }
  }

  /** Resolve colisões dos hazards em travessia. Retorna o maior impacto. */
  resolveCollisions(car: Car): number {
    if (!this.enabled) {
      return 0;
    }

    const state = car.state;
    let maxImpact = 0;
    let touched = false;
    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);

    for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
      let resolvedThisPass = false;

      for (const event of this.events) {
        if (event.state !== 'crossing') {
          continue;
        }

        if (
          state.airborne &&
          state.position.y >
            event.group.position.y + event.def.height + 0.2
        ) {
          continue;
        }

        for (let circleIndex = 0; circleIndex < 2; circleIndex += 1) {
          const offset = circleIndex === 0 ? CAR_COLLIDER_OFFSET : -CAR_COLLIDER_OFFSET;
          const circleX = state.position.x + forwardX * offset;
          const circleZ = state.position.z + forwardZ * offset;
          const position = event.group.position;
          const combined = CAR_COLLIDER_RADIUS + event.def.radius;
          const dx = circleX - position.x;
          const dz = circleZ - position.z;
          const distanceSq = dx * dx + dz * dz;

          if (distanceSq >= combined * combined) {
            continue;
          }

          const distance = Math.sqrt(distanceSq) || 0.001;
          const normalX = dx / distance;
          const normalZ = dz / distance;
          const penetration = combined - distance;
          state.position.x += normalX * penetration;
          state.position.z += normalZ * penetration;

          const velocityX = state.velocity.x;
          const velocityZ = state.velocity.z;
          const normalSpeed = velocityX * normalX + velocityZ * normalZ;

          if (normalSpeed < 0) {
            const impact = -normalSpeed;
            const impulse = (1 + RESTITUTION) * normalSpeed;
            state.velocity.x -= normalX * impulse;
            state.velocity.z -= normalZ * impulse;
            state.velocity.x *= IMPACT_SPEED_KEEP;
            state.velocity.z *= IMPACT_SPEED_KEEP;
            maxImpact = Math.max(maxImpact, impact);
          }

          touched = true;
          resolvedThisPass = true;
        }
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

  dispose(): void {
    for (const template of this.templates.values()) {
      for (const geometry of template.geometries) {
        geometry.dispose();
      }
      for (const material of template.materials) {
        material.dispose();
      }
    }
    this.templates.clear();
  }

  private templateFor(kind: HazardKind): HazardTemplate {
    const existing = this.templates.get(kind);
    if (existing) {
      return existing;
    }

    const template = this.buildTemplate(kind);
    this.templates.set(kind, template);
    return template;
  }

  private buildTemplate(kind: HazardKind): HazardTemplate {
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const colors = HAZARD_COLORS[kind];
    const body = this.material(colors.body, materials);
    const dark = this.material(colors.dark, materials);
    const accent = this.material(colors.accent, materials);
    const wheels = this.material(0x1d1e1c, materials);

    const add = (
      parent: THREE.Object3D,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx = 0,
      ry = 0,
      rz = 0,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      geometries.push(geometry);
      return mesh;
    };

    switch (kind) {
      case 'camel': {
        add(group, box(1.2, 0.8, 2.4), body, 0, 1.05, 0);
        add(group, box(0.85, 0.55, 0.75), body, 0, 1.55, -0.15);
        add(group, box(0.32, 0.85, 0.32), body, 0, 1.55, 1.0, 0.32);
        add(group, box(0.5, 0.42, 0.65), body, 0, 2.0, 1.3);
        add(group, box(0.45, 0.18, 0.2), dark, 0, 2.12, 1.58);
        for (const x of [-0.42, 0.42]) {
          for (const z of [-0.8, 0.8]) {
            add(group, box(0.16, 1.1, 0.16), dark, x, 0.55, z);
          }
        }
        break;
      }
      case 'deer':
      case 'reindeer': {
        add(group, box(0.65, 0.55, 1.45), body, 0, 0.95, 0);
        add(group, box(0.42, 0.7, 0.42), body, 0, 1.3, 0.75, 0.22);
        add(group, box(0.34, 0.3, 0.55), body, 0, 1.6, 0.98);
        add(group, box(0.14, 0.5, 0.14), accent, -0.16, 1.85, 0.98, 0.15, 0, 0.4);
        add(group, box(0.14, 0.5, 0.14), accent, 0.16, 1.85, 0.98, 0.15, 0, -0.4);
        for (const x of [-0.22, 0.22]) {
          for (const z of [-0.48, 0.48]) {
            add(group, box(0.11, 0.75, 0.11), dark, x, 0.38, z);
          }
        }
        break;
      }
      case 'car': {
        add(group, box(1.55, 0.55, 3.1), body, 0, 0.65, 0);
        add(group, box(1.3, 0.55, 1.45), accent, 0, 1.12, -0.15);
        add(group, box(0.65, 0.22, 0.2), dark, 0, 0.75, 1.58);
        for (const x of [-0.72, 0.72]) {
          for (const z of [-0.95, 0.95]) {
            add(group, cylinder(0.32, 0.32, 0.18, 8), wheels, x, 0.36, z, 0, 0, Math.PI / 2);
          }
        }
        break;
      }
      case 'truck': {
        add(group, box(1.65, 0.65, 2.2), body, 0, 0.85, 1.0);
        add(group, box(1.45, 0.85, 1.1), accent, 0, 1.2, 2.2);
        add(group, box(1.65, 1.4, 2.6), accent, 0, 1.3, -0.7);
        for (const x of [-0.8, 0.8]) {
          for (const z of [-1.6, -0.2, 1.6]) {
            add(group, cylinder(0.42, 0.42, 0.2, 8), wheels, x, 0.42, z, 0, 0, Math.PI / 2);
          }
        }
        break;
      }
      case 'tractor': {
        add(group, box(1.1, 0.55, 1.9), body, 0, 0.85, 0);
        add(group, box(0.85, 0.8, 0.8), accent, 0, 1.5, -0.3);
        add(group, box(0.25, 0.7, 0.25), dark, 0, 1.5, 0.8);
        for (const x of [-0.85, 0.85]) {
          add(group, cylinder(0.62, 0.62, 0.28, 10), wheels, x, 0.62, -0.55, 0, 0, Math.PI / 2);
          add(group, cylinder(0.38, 0.38, 0.22, 8), wheels, x, 0.38, 0.75, 0, 0, Math.PI / 2);
        }
        break;
      }
      case 'cow': {
        add(group, box(0.85, 0.7, 1.7), body, 0, 0.95, 0);
        add(group, box(0.45, 0.42, 0.55), body, 0, 1.0, 0.98);
        add(group, box(0.3, 0.16, 0.25), dark, 0, 1.05, 1.25);
        for (const x of [-0.28, 0.28]) {
          for (const z of [-0.6, 0.6]) {
            add(group, box(0.14, 0.65, 0.14), dark, x, 0.33, z);
          }
        }
        break;
      }
      case 'buggy': {
        add(group, box(1.5, 0.45, 2.4), body, 0, 0.55, 0);
        add(group, box(1.05, 0.55, 1.0), accent, 0, 1.0, -0.15);
        add(group, box(0.08, 0.65, 0.08), dark, -0.55, 1.15, 0.55, 0.25);
        add(group, box(0.08, 0.65, 0.08), dark, 0.55, 1.15, 0.55, 0.25);
        for (const x of [-0.78, 0.78]) {
          for (const z of [-0.85, 0.85]) {
            add(group, cylinder(0.42, 0.42, 0.24, 8), wheels, x, 0.45, z, 0, 0, Math.PI / 2);
          }
        }
        break;
      }
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    return { group, geometries, materials };
  }

  private material(color: number, list: THREE.Material[]): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    list.push(material);
    return material;
  }
}

function box(x: number, y: number, z: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(x, y, z);
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
}
