import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { SCENARIOS } from '../game/scenarios';
import type { Track } from './Track';
import type { TrackBranch } from './TrackBranch';
import { zoneBlendAt } from './zones';
import { createRoadGrainTexture } from './roadTexture';

const SHOULDER_OFFSETS = [8, 4.5, 1.8];
const INNER_SHOULDER_OFFSETS = [1.4];
/** Ombros da rota completa, do mais interno para o mais externo. */
const ROUTE_SHOULDER_OFFSETS = [1.2, 2.5, 4];
const ROAD_LIFT = 0.045;
const EDGE_LIFT = 0.06;
const EDGE_WIDTH = 0.42;
const ROW_STEP = 1.5;

const tempColor = new THREE.Color();
const tempBlend = new THREE.Color();
const tempRoad = new THREE.Color();

function setBlendedColor(
  target: THREE.Color,
  from: number,
  to: number,
  t: number,
): void {
  target.setHex(from);
  tempBlend.setHex(to);
  target.lerp(tempBlend, t);
}

/**
 * Malha visual dos ramos de bifurcação.
 *
 * É separada da `TrackMesh` principal para não misturar a faixa da pista
 * principal com os desvios. Cada ramo tem asfalto/terra/neve coerente com o
 * cenário do setor e ombros de 8 m para esconder o terreno de fundo.
 *
 * - `legacy`: só o ombro externo, encostando na pista principal pelo lado
 *   interno (visual v1/v2 preservado).
 * - `route`: rota completa do v3, com ombros e bordas dos dois lados. Nas
 *   pontas o ombro interno é suprimido para não pintar sobre a pista.
 */
export class ForkMesh {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly grainTexture: THREE.CanvasTexture;

  constructor(track: Track) {
    this.group.name = 'fork-branches';
    this.grainTexture = createRoadGrainTexture();

    for (const branch of track.branches) {
      this.group.add(this.buildBranch(track, branch));
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.grainTexture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private buildBranch(track: Track, branch: TrackBranch): THREE.Group {
    const group = new THREE.Group();
    group.name = `fork-branch-${branch.id}`;
    const fullRoute = branch.kind === 'route';
    const legacyScenario = SCENARIOS[track.zoneAt(branch.startS)];
    const columns = fullRoute
      ? INNER_SHOULDER_OFFSETS.length + ROUTE_SHOULDER_OFFSETS.length + 3
      : SHOULDER_OFFSETS.length + 3;
    const rows = Math.max(2, Math.ceil(branch.length / ROW_STEP) + 1);
    const positions = new Float32Array(rows * columns * 3);
    const colors = new Float32Array(rows * columns * 3);
    const uvs = new Float32Array(rows * columns * 2);
    const indices: number[] = [];
    const lateral = new Array<number>(columns);
    const roadColor = new THREE.Color();
    const shoulderColor = new THREE.Color();
    const terrainColor = new THREE.Color();

    for (let i = 0; i < rows; i += 1) {
      const t = rows > 1 ? i / (rows - 1) : 0;
      const s = Math.min(t * branch.length, branch.length);
      const sample = branch.sampleAt(s);
      const half = sample.width * 0.5;
      const side = branch.side;
      const shoulderScale =
        smoothstep(clamp(t / 0.12, 0, 1)) *
        smoothstep(clamp((1 - t) / 0.12, 0, 1));

      if (fullRoute) {
        const mainS = lerp(branch.startS, branch.endS, t);
        const blend = zoneBlendAt(track.def.zones, mainS);
        const from = SCENARIOS[
          track.def.zones[blend.from]?.id ?? 'forest'
        ];
        const to = SCENARIOS[
          track.def.zones[blend.to]?.id ?? 'forest'
        ];
        setBlendedColor(roadColor, from.colors.road, to.colors.road, blend.t);
        setBlendedColor(
          shoulderColor,
          from.colors.shoulder,
          to.colors.shoulder,
          blend.t,
        );
        setBlendedColor(
          terrainColor,
          from.colors.terrain,
          to.colors.terrain,
          blend.t,
        );
      } else {
        roadColor.setHex(legacyScenario.colors.road);
        shoulderColor.setHex(legacyScenario.colors.shoulder);
        terrainColor.setHex(legacyScenario.colors.terrain);
      }

      if (fullRoute) {
        // Rota completa: ombro interno mais curto (4 m) para o miolo do Y não
        // virar um apron plano. Ele some nas pontas para encostar na pista.
        const innerScale =
          smoothstep(clamp(t / 0.18, 0, 1)) *
          smoothstep(clamp((1 - t) / 0.18, 0, 1));

        for (let k = 0; k < INNER_SHOULDER_OFFSETS.length; k += 1) {
          lateral[k] = -side * (half + INNER_SHOULDER_OFFSETS[k] * innerScale);
        }
        lateral[INNER_SHOULDER_OFFSETS.length] = -side * half;
        lateral[INNER_SHOULDER_OFFSETS.length + 1] = 0;
        lateral[INNER_SHOULDER_OFFSETS.length + 2] = side * half;
        for (let k = 0; k < ROUTE_SHOULDER_OFFSETS.length; k += 1) {
          lateral[INNER_SHOULDER_OFFSETS.length + 3 + k] =
            side * (half + ROUTE_SHOULDER_OFFSETS[k] * shoulderScale);
        }
      } else {
        // Ramo legado: a borda interna encosta na pista principal; só o lado
        // de fora recebe ombro.
        lateral[0] = -side * half;
        lateral[1] = 0;
        lateral[2] = side * half;
        for (let k = 0; k < SHOULDER_OFFSETS.length; k += 1) {
          const offset = SHOULDER_OFFSETS[SHOULDER_OFFSETS.length - 1 - k];
          lateral[3 + k] = side * (half + offset * shoulderScale);
        }
      }

      for (let k = 0; k < columns; k += 1) {
        const u = lateral[k];
        const vertex = i * columns + k;
        const x = sample.position.x + sample.right.x * u;
        const z = sample.position.z + sample.right.z * u;
        const isRoad = Math.abs(u) <= half + 1e-6;
        const y = branch.heightAt(s, u) + (isRoad ? ROAD_LIFT : ROAD_LIFT - 0.02);

        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        uvs[vertex * 2] = u / 8 + 0.5;
        uvs[vertex * 2 + 1] = s / 8;

        const outerStart = INNER_SHOULDER_OFFSETS.length + 3;
        const outerBlend = fullRoute && k >= outerStart
          ? (k - outerStart) /
            Math.max(1, ROUTE_SHOULDER_OFFSETS.length - 1)
          : 0;
        if (isRoad) {
          tempColor.copy(roadColor);
        } else if (fullRoute && k < INNER_SHOULDER_OFFSETS.length) {
          tempColor.copy(terrainColor);
        } else {
          tempColor.copy(shoulderColor);
        }
        if (!isRoad && outerBlend > 0) {
          tempColor.lerp(terrainColor, outerBlend * 0.85);
        }
        const grain = 0.94 + hash2(i, k) * 0.12;
        colors[vertex * 3] = tempColor.r * grain;
        colors[vertex * 3 + 1] = tempColor.g * grain;
        colors[vertex * 3 + 2] = tempColor.b * grain;
      }
    }

    for (let i = 0; i < rows - 1; i += 1) {
      for (let k = 0; k < columns - 1; k += 1) {
        const a = i * columns + k;
        const b = a + 1;
        const c = a + columns + 1;
        const d = a + columns;
        indices.push(a, c, b, a, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = fullRoute
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: this.grainTexture,
          roughness: 0.97,
          metalness: 0,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.96,
          metalness: 0,
          flatShading: true,
          side: THREE.DoubleSide,
        });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `fork-branch-surface-${branch.id}`;
    this.geometries.push(geometry);
    this.materials.push(material);
    group.add(mesh);

    group.add(
      this.buildEdgeRibbon(
        track,
        branch,
        branch.length * (fullRoute ? 0.005 : 0.06),
        branch.length * (fullRoute ? 0.995 : 0.94),
        branch.side,
        legacyScenario.colors.edge,
        fullRoute,
        'outer',
      ),
    );

    if (fullRoute) {
      group.add(
        this.buildEdgeRibbon(
          track,
          branch,
          branch.length * 0.06,
          branch.length * 0.94,
          -branch.side,
          legacyScenario.colors.edge,
          true,
          'inner',
        ),
      );
    }

    return group;
  }

  private buildEdgeRibbon(
    track: Track,
    branch: TrackBranch,
    from: number,
    to: number,
    side: number,
    edgeColor: number,
    perZoneColor: boolean,
    edge: 'outer' | 'inner',
  ): THREE.Mesh {
    const span = Math.max(1, to - from);
    const rows = Math.max(2, Math.ceil(span / ROW_STEP) + 1);
    const verticesPerRow = 2;
    const positions = new Float32Array(rows * verticesPerRow * 3);
    const colors = new Float32Array(rows * verticesPerRow * 3);
    const indices: number[] = [];

    for (let i = 0; i < rows; i += 1) {
      const s = Math.min(from + (i / (rows - 1)) * span, to);
      const sample = branch.sampleAt(s);
      const half = sample.width * 0.5;
      if (perZoneColor) {
        const mainS = lerp(branch.startS, branch.endS, s / branch.length);
        const blend = zoneBlendAt(track.def.zones, mainS);
        const fromScenario = SCENARIOS[
          track.def.zones[blend.from]?.id ?? 'forest'
        ];
        const toScenario = SCENARIOS[
          track.def.zones[blend.to]?.id ?? 'forest'
        ];
        setBlendedColor(
          tempColor,
          fromScenario.colors.edge,
          toScenario.colors.edge,
          blend.t,
        );
        if (edge === 'inner') {
          // A borda interna é uma divisória de pista no miolo do Y, não uma
          // borda no split/merge. Ela surge/some gradualmente para não deixar
          // uma linha solta no gore.
          const progress = (s - from) / Math.max(1, to - from);
          const fade =
            smoothstep(clamp(progress / 0.16, 0, 1)) *
            smoothstep(clamp((1 - progress) / 0.16, 0, 1));
          setBlendedColor(
            tempRoad,
            fromScenario.colors.road,
            toScenario.colors.road,
            blend.t,
          );
          tempColor.lerp(tempRoad, 1 - fade);
        }
      } else {
        tempColor.setHex(edgeColor);
      }

      for (let innerIndex = 0; innerIndex < 2; innerIndex += 1) {
        const inset = innerIndex === 0 ? 0 : EDGE_WIDTH;
        const u = side * (half - inset);
        const vertex = i * verticesPerRow + innerIndex;

        positions[vertex * 3] = sample.position.x + sample.right.x * u;
        positions[vertex * 3 + 1] = branch.heightAt(s, u) + EDGE_LIFT;
        positions[vertex * 3 + 2] = sample.position.z + sample.right.z * u;

        colors[vertex * 3] = tempColor.r;
        colors[vertex * 3 + 1] = tempColor.g;
        colors[vertex * 3 + 2] = tempColor.b;
      }
    }

    for (let i = 0; i < rows - 1; i += 1) {
      const a = i * verticesPerRow;
      const b = a + 1;
      const c = a + verticesPerRow + 1;
      const d = a + verticesPerRow;
      indices.push(a, b, c, a, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `fork-branch-${edge}-edge-${branch.id}`;
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }
}

function hash2(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
