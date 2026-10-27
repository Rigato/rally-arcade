import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Track } from './Track';
import { zoneBlendAt, type ZoneId } from './zones';

/**
 * Offsets laterais do ombro (além da borda), do mais externo ao mais interno.
 * O ombro tem 12 m por lado, com cinco colunas para o relevo de 2–5 m em `u`.
 */
const SHOULDER_OFFSETS: readonly number[] = [12, 9.6, 7.2, 4.8, 2.4];
/** Pista (borda esquerda, centro, borda direita) + ombros dos dois lados. */
const COLUMNS = SHOULDER_OFFSETS.length * 2 + 3;
const EDGE_RIBBON_WIDTH = 0.45;
const EDGE_LIFT = 0.025;
const BAND_LIFT = 0.04;

const ROAD_COLORS: Record<ZoneId, THREE.Color> = {
  forest: new THREE.Color(0x57534a),
  desert: new THREE.Color(0xd4b173),
};
const SHOULDER_COLORS: Record<ZoneId, THREE.Color> = {
  forest: new THREE.Color(0x4c6436),
  desert: new THREE.Color(0xd6ba85),
};
const EDGE_COLORS: Record<ZoneId, THREE.Color> = {
  forest: new THREE.Color(0xdfe3cc),
  desert: new THREE.Color(0xf4e7c3),
};
const BAND_DARK = new THREE.Color(0x232825);
const BAND_LIGHT = new THREE.Color(0xf2eee0);
const BAND_FINISH = new THREE.Color(0xc94f3b);

const tempColor = new THREE.Color();

/**
 * Malha da pista em faixas de ~1 m.
 *
 * Uma única malha contém pista + ombros; a cor é por vértice e mistura
 * floresta→deserto em ~30 m. A faixa de borda e as linhas de largada/chegada
 * são malhas separadas, finas e sem shadow map.
 */
export class TrackMesh {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly grainTexture: THREE.CanvasTexture;

  constructor(track: Track) {
    this.group.name = 'track';
    this.grainTexture = createGrainTexture();

    this.group.add(this.buildSurface(track));
    this.group.add(this.buildEdgeRibbons(track));
    this.group.add(this.buildBand(track, Math.max(1, track.startS - 1.5), 1.4, BAND_DARK));
    this.group.add(this.buildBand(track, track.length - 3.5, 1.6, BAND_FINISH));
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

  private buildSurface(track: Track): THREE.Mesh {
    const columns = COLUMNS;
    const rows = track.sampleCount + 1;
    const positions = new Float32Array(rows * columns * 3);
    const colors = new Float32Array(rows * columns * 3);
    const uvs = new Float32Array(rows * columns * 2);
    const indices: number[] = [];
    const zones = track.def.zones;
    const lateral = new Array<number>(columns);

    for (let i = 0; i < rows; i += 1) {
      const s = Math.min(i * track.step, track.length);
      const sample = track.sampleAt(s);
      const half = sample.width * 0.5;
      const blend = zoneBlendAt(zones, s);
      const fromZone = zones[blend.from].id;
      const toZone = zones[blend.to].id;
      const centerY = track.heightAt(s, 0);

      // Ombros com 5 faixas por lado: resolução suficiente para as ondulações
      // de 2–5 m em u. A pista continua com 3 colunas e fica lisa.
      for (let k = 0; k < SHOULDER_OFFSETS.length; k += 1) {
        lateral[k] = -half - SHOULDER_OFFSETS[k];
        lateral[columns - 1 - k] = half + SHOULDER_OFFSETS[k];
      }
      lateral[SHOULDER_OFFSETS.length] = -half;
      lateral[SHOULDER_OFFSETS.length + 1] = 0;
      lateral[SHOULDER_OFFSETS.length + 2] = half;

      for (let k = 0; k < columns; k += 1) {
        const u = lateral[k];
        const vertex = i * columns + k;
        const x = sample.position.x + sample.right.x * u;
        const z = sample.position.z + sample.right.z * u;
        const y = track.heightAt(s, u);
        const isRoad = Math.abs(u) <= half + 1e-6;

        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        uvs[vertex * 2] = u / 8 + 0.5;
        uvs[vertex * 2 + 1] = s / 8;

        if (isRoad) {
          tempColor
            .copy(ROAD_COLORS[fromZone])
            .lerp(ROAD_COLORS[toZone], blend.t);
        } else {
          tempColor
            .copy(SHOULDER_COLORS[fromZone])
            .lerp(SHOULDER_COLORS[toZone], blend.t);
        }

        let grain = 0.94 + 0.12 * hash2(i, k);
        if (!isRoad) {
          // Claro nas cristas, escuro nas covas: dá leitura ao relevo mesmo
          // no low poly e sem shadow map.
          grain += clamp((y - centerY) * 0.22, -0.1, 0.1);
        }

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
        // Sentido anti-horário visto de cima (+Y): a→c→b, a→d→c.
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

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.grainTexture,
      roughness: 0.97,
      metalness: 0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'track-surface';
    mesh.receiveShadow = false;
    mesh.castShadow = false;

    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildEdgeRibbons(track: Track): THREE.Mesh {
    const rows = track.sampleCount + 1;
    const sides = 2;
    const verticesPerRow = sides * 2;
    const positions = new Float32Array(rows * verticesPerRow * 3);
    const colors = new Float32Array(rows * verticesPerRow * 3);
    const indices: number[] = [];
    const zones = track.def.zones;

    for (let i = 0; i < rows; i += 1) {
      const s = Math.min(i * track.step, track.length);
      const sample = track.sampleAt(s);
      const half = sample.width * 0.5;
      const blend = zoneBlendAt(zones, s);
      const fromZone = zones[blend.from].id;
      const toZone = zones[blend.to].id;

      tempColor
        .copy(EDGE_COLORS[fromZone])
        .lerp(EDGE_COLORS[toZone], blend.t);
      for (let sideIndex = 0; sideIndex < sides; sideIndex += 1) {
        const side = sideIndex === 0 ? -1 : 1;
        for (let innerIndex = 0; innerIndex < 2; innerIndex += 1) {
          const inset = innerIndex === 0 ? 0 : EDGE_RIBBON_WIDTH;
          const u = side * (half - inset);
          const vertex = i * verticesPerRow + sideIndex * 2 + innerIndex;

          positions[vertex * 3] = sample.position.x + sample.right.x * u;
          positions[vertex * 3 + 1] = track.heightAt(s, u) + EDGE_LIFT;
          positions[vertex * 3 + 2] = sample.position.z + sample.right.z * u;

          colors[vertex * 3] = tempColor.r;
          colors[vertex * 3 + 1] = tempColor.g;
          colors[vertex * 3 + 2] = tempColor.b;
        }
      }
    }

    for (let i = 0; i < rows - 1; i += 1) {
      for (let sideIndex = 0; sideIndex < sides; sideIndex += 1) {
        const a = i * verticesPerRow + sideIndex * 2;
        const b = a + 1;
        const c = a + verticesPerRow + 1;
        const d = a + verticesPerRow;

        if (sideIndex === 0) {
          indices.push(a, b, c, a, c, d);
        } else {
          indices.push(b, a, d, b, d, c);
        }
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
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'track-edge-ribbons';
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildBand(
    track: Track,
    centerS: number,
    bandLength: number,
    accent: THREE.Color,
  ): THREE.Mesh {
    const segments = 12;
    const s0 = clamp(centerS - bandLength * 0.5, 0, track.length);
    const s1 = clamp(centerS + bandLength * 0.5, 0, track.length);

    // `track.sampleAt` reutiliza o mesmo objeto: copiar as duas linhas antes
    // de montar os vértices.
    const sample0 = track.sampleAt(s0);
    const row0 = {
      x: sample0.position.x,
      z: sample0.position.z,
      rightX: sample0.right.x,
      rightZ: sample0.right.z,
      half: sample0.width * 0.5,
    };
    const sample1 = track.sampleAt(s1);
    const row1 = {
      x: sample1.position.x,
      z: sample1.position.z,
      rightX: sample1.right.x,
      rightZ: sample1.right.z,
      half: sample1.width * 0.5,
    };

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let segment = 0; segment < segments; segment += 1) {
      const t0 = segment / segments;
      const t1 = (segment + 1) / segments;
      const u0a = -row0.half + row0.half * 2 * t0;
      const u1a = -row0.half + row0.half * 2 * t1;
      const u0b = -row1.half + row1.half * 2 * t0;
      const u1b = -row1.half + row1.half * 2 * t1;

      const base = positions.length / 3;
      pushBandVertex(positions, row0, track, s0, u0a);
      pushBandVertex(positions, row0, track, s0, u1a);
      pushBandVertex(positions, row1, track, s1, u1b);
      pushBandVertex(positions, row1, track, s1, u0b);

      const color = segment % 2 === 0 ? BAND_LIGHT : accent;
      for (let vertex = base; vertex < base + 4; vertex += 1) {
        colors.push(color.r, color.g, color.b);
      }

      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = accent === BAND_FINISH ? 'track-finish-band' : 'track-start-band';
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

}

interface BandRow {
  x: number;
  z: number;
  rightX: number;
  rightZ: number;
  half: number;
}

function pushBandVertex(
  positions: number[],
  row: BandRow,
  track: Track,
  s: number,
  u: number,
): void {
  positions.push(
    row.x + row.rightX * u,
    track.heightAt(s, u) + BAND_LIFT,
    row.z + row.rightZ * u,
  );
}

function hash2(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Textura procedural de grão, repetida via UV. */
function createGrainTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  context.fillStyle = '#d9d9d9';
  context.fillRect(0, 0, size, size);

  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let i = 0; i < 2600; i += 1) {
    const value = 170 + Math.floor(random() * 85);
    context.fillStyle = `rgb(${value}, ${value}, ${value})`;
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const w = 1 + Math.floor(random() * 2);
    const h = 1 + Math.floor(random() * 2);
    context.fillRect(x, y, w, h);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
