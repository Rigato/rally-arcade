import * as THREE from 'three';
import { clamp } from '../core/math';
import { SCENARIOS } from '../game/scenarios';
import type { Track } from './Track';
import type { TrackBranch } from './TrackBranch';

const SHOULDER_OFFSETS = [8, 4.5, 1.8];
const ROAD_LIFT = 0.045;
const EDGE_LIFT = 0.06;
const EDGE_WIDTH = 0.42;
const ROW_STEP = 1.5;

const tempColor = new THREE.Color();

/**
 * Malha visual dos ramos de bifurcação.
 *
 * É separada da `TrackMesh` principal para não misturar a faixa da pista
 * principal com os desvios. Cada ramo tem asfalto/terra/neve coerente com o
 * cenário do setor e ombros de 8 m para esconder o terreno de fundo.
 */
export class ForkMesh {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(track: Track) {
    this.group.name = 'fork-branches';

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
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private buildBranch(track: Track, branch: TrackBranch): THREE.Group {
    const group = new THREE.Group();
    group.name = `fork-branch-${branch.id}`;
    const scenario = SCENARIOS[track.zoneAt(branch.startS)];
    const columns = SHOULDER_OFFSETS.length + 3;
    const rows = Math.max(2, Math.ceil(branch.length / ROW_STEP) + 1);
    const positions = new Float32Array(rows * columns * 3);
    const colors = new Float32Array(rows * columns * 3);
    const indices: number[] = [];
    const lateral = new Array<number>(columns);

    for (let i = 0; i < rows; i += 1) {
      const t = rows > 1 ? i / (rows - 1) : 0;
      const s = Math.min(t * branch.length, branch.length);
      const sample = branch.sampleAt(s);
      const half = sample.width * 0.5;
      const side = branch.side;
      const shoulderScale =
        smoothstep(clamp(t / 0.12, 0, 1)) *
        smoothstep(clamp((1 - t) / 0.12, 0, 1));

      // A borda interna do ramo encosta na pista principal; só o lado de fora
      // recebe ombro. Assim o ramo não pinta por cima da pista no merge.
      lateral[0] = -side * half;
      lateral[1] = 0;
      lateral[2] = side * half;
      for (let k = 0; k < SHOULDER_OFFSETS.length; k += 1) {
        lateral[3 + k] = side * (half + SHOULDER_OFFSETS[k] * shoulderScale);
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

        tempColor.setHex(isRoad ? scenario.colors.road : scenario.colors.shoulder);
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
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
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

    group.add(this.buildOuterEdgeRibbon(branch, scenario.colors.edge));
    return group;
  }

  private buildOuterEdgeRibbon(
    branch: TrackBranch,
    edgeColor: number,
  ): THREE.Mesh {
    const from = branch.length * 0.06;
    const to = branch.length * 0.94;
    const span = Math.max(1, to - from);
    const rows = Math.max(2, Math.ceil(span / ROW_STEP) + 1);
    const verticesPerRow = 2;
    const positions = new Float32Array(rows * verticesPerRow * 3);
    const colors = new Float32Array(rows * verticesPerRow * 3);
    const indices: number[] = [];
    tempColor.setHex(edgeColor);

    for (let i = 0; i < rows; i += 1) {
      const s = Math.min(from + (i / (rows - 1)) * span, to);
      const sample = branch.sampleAt(s);
      const half = sample.width * 0.5;

      for (let innerIndex = 0; innerIndex < 2; innerIndex += 1) {
        const inset = innerIndex === 0 ? 0 : EDGE_WIDTH;
        const u = branch.side * (half - inset);
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
    mesh.name = `fork-branch-outer-edge-${branch.id}`;
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
