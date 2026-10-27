import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Track, TrackZoneId } from '../track/Track';
import { createBannerTexture } from './canvasText';

const SHOULDER_INNER = 2.0;
const SHOULDER_OUTER = 5.5;
/** Trechos de hairpin: sem pinheiros altos, para não bloquear a câmera. */
const HAIRPIN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [215, 295],
  [440, 515],
];
const START_CLEARANCE = 10;
const FINISH_CLEARANCE = 12;
const PORTAL_CLEARANCE = 9;
const EDGE_POST_SPACING = 20;
const EDGE_POST_CLEARANCE = 0.55;

const UP = new THREE.Vector3(0, 1, 0);
const FOREST_TERRAIN = new THREE.Color(0x465f33);
const DESERT_TERRAIN = new THREE.Color(0xc9ac75);
const tempTerrainColor = new THREE.Color();

type SceneryKind = 'pine' | 'rock' | 'bush' | 'cactus' | 'drybush';

interface SceneryItem {
  kind: SceneryKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  sx: number;
  sy: number;
  sz: number;
  color: THREE.Color;
}

/**
 * Cenário low poly instanciado ao longo da pista.
 *
 * Floresta (s < 300): pinheiros, pedras e arbustos.
 * Deserto (s > 300): cactos, pedras claras e arbustos secos.
 * Tudo é posicionado em coordenadas (s,u), dentro dos 6 m de ombro, e lido
 * da mesma `heightAt` da pista. Não há colisão — obstáculos sólidos são M4.
 *
 * Também entram postes de borda (leitura de largura/salto), marcadores de
 * salto nos kickers e uma faixa escura no início de cada rampa.
 */
export class Scenery {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  private readonly items: SceneryItem[] = [];
  private readonly kickers: ReadonlyArray<{ readonly s: number; readonly length: number }>;
  private readonly desertStart: number;

  constructor(track: Track) {
    this.group.name = 'scenery';
    this.desertStart =
      track.def.zones.find((zone) => zone.id === 'desert')?.start ??
      track.length * 0.5;
    this.kickers = track.def.kickers;

    const forestRng = mulberry32(0x5eedf00d);
    const desertRng = mulberry32(0x5eed0f1d);
    const forestFrom = track.startS + START_CLEARANCE;
    const forestTo = this.desertStart - 2;
    const desertFrom = this.desertStart + 2;
    const desertTo = track.length - FINISH_CLEARANCE;

    this.scatter(track, forestRng, forestFrom, forestTo, 'forest', 3.7, 6.3);
    this.scatter(track, desertRng, desertFrom, desertTo, 'desert', 6.1, 9.4);

    this.group.add(this.buildTerrainBackdrop(track));
    this.group.add(this.buildPines());
    this.group.add(this.buildRocks());
    this.group.add(this.buildBushes());
    this.group.add(this.buildCacti());
    this.group.add(this.buildEdgePosts(track));
    this.group.add(this.buildJumpMarkers(track));
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const texture of this.textures) {
      texture.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }

  /** Distribui objetos em (s,u) em ambos os lados, com clareiras aleatórias. */
  private scatter(
    track: Track,
    rng: () => number,
    fromS: number,
    toS: number,
    zone: TrackZoneId,
    stepMin: number,
    stepMax: number,
  ): void {
    let s = fromS;

    while (s < toS) {
      for (const side of [-1, 1]) {
        if (rng() < 0.08) {
          continue;
        }

        const countRoll = rng();
        const count = countRoll < 0.28 ? 3 : countRoll < 0.72 ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
          if (rng() < 0.14) {
            continue;
          }

          const ss = clamp(s + (rng() - 0.5) * 3.2, fromS, toS);
          if (!this.isClear(ss)) {
            continue;
          }

          const sample = track.sampleAt(ss);
          const half = sample.width * 0.5;
          const u =
            side *
            (half + SHOULDER_INNER + rng() * (SHOULDER_OUTER - SHOULDER_INNER));
          const x = sample.position.x + sample.right.x * u;
          const z = sample.position.z + sample.right.z * u;
          const y = track.heightAt(ss, u) - 0.02;

          this.items.push(
            this.makeItem(zone, x, y, z, rng, this.isHairpin(ss), Math.abs(u) - half),
          );
        }
      }

      s += stepMin + rng() * (stepMax - stepMin);
    }
  }

  private isHairpin(s: number): boolean {
    return HAIRPIN_RANGES.some(([from, to]) => s >= from && s <= to);
  }

  private isClear(s: number): boolean {
    if (Math.abs(s - this.desertStart) < PORTAL_CLEARANCE) {
      return false;
    }

    for (const kicker of this.kickers) {
      if (Math.abs(s - (kicker.s + 1)) < 4) {
        return false;
      }
    }

    return true;
  }

  private makeItem(
    zone: TrackZoneId,
    x: number,
    y: number,
    z: number,
    rng: () => number,
    inHairpin: boolean,
    distanceFromEdge: number,
  ): SceneryItem {
    const roll = rng();
    let kind: SceneryKind;

    if (zone === 'forest') {
      kind = roll < 0.5 ? 'pine' : roll < 0.78 ? 'rock' : 'bush';
      if ((inHairpin || distanceFromEdge < 3.5) && kind === 'pine') {
        kind = rng() < 0.55 ? 'rock' : 'bush';
      }
    } else {
      kind = roll < 0.42 ? 'cactus' : roll < 0.72 ? 'rock' : 'drybush';
      if (distanceFromEdge < 3.5 && kind === 'cactus') {
        kind = rng() < 0.5 ? 'rock' : 'drybush';
      }
    }

    const baseScale = 0.75 + rng() * 0.75;
    const yaw = rng() * Math.PI * 2;

    return {
      kind,
      x,
      y,
      z,
      yaw,
      scale: baseScale,
      sx: 0.85 + rng() * 0.5,
      sy: 0.75 + rng() * 0.65,
      sz: 0.85 + rng() * 0.5,
      color: this.pickColor(kind, zone, rng),
    };
  }

  private pickColor(kind: SceneryKind, zone: TrackZoneId, rng: () => number): THREE.Color {
    const variation = (rng() - 0.5) * 0.18;
    const color = new THREE.Color();

    switch (kind) {
      case 'pine':
        color.setHex(0x2f5a38);
        break;
      case 'bush':
        color.setHex(zone === 'forest' ? 0x3f6a3d : 0x9b8a56);
        break;
      case 'cactus':
        color.setHex(0x4f7d4b);
        break;
      case 'drybush':
        color.setHex(0xa08b58);
        break;
      case 'rock':
        color.setHex(zone === 'forest' ? 0x6c756b : 0xc7b18a);
        break;
    }

    color.offsetHSL(variation * 0.25, variation * 0.4, variation);
    return color;
  }

  /**
   * Terreno de fundo (visual) que segue a pista e cobre o vazio além dos 6 m
   * de ombro. Não participa da física: a altura do carro continua vindo de
   * `Track.heightAt`, e o M4 traz o terreno acidentado de verdade.
   */
  private buildTerrainBackdrop(track: Track): THREE.Mesh {
    const spacing = 6;
    const margin = 120;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of track.def.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    minX -= margin;
    maxX += margin;
    minZ -= margin;
    maxZ += margin;

    const cols = Math.ceil((maxX - minX) / spacing) + 1;
    const rows = Math.ceil((maxZ - minZ) / spacing) + 1;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    for (let row = 0; row < rows; row += 1) {
      const z = minZ + row * spacing;
      for (let col = 0; col < cols; col += 1) {
        const x = minX + col * spacing;
        const projection = track.project(x, z);
        const s = projection.s;
        const lateral = Math.abs(projection.u);
        const half = track.widthAt(s) * 0.5;
        const inner = half + 5.9;
        const outside = Math.max(0, lateral - inner);
        const slope = Math.min(Math.max(0, outside - 2) * 0.12, 5.0);
        const ripple =
          (Math.sin(s * 0.055 + lateral * 0.11) * 0.3 +
            Math.sin(s * 0.017 - lateral * 0.03) * 0.6) *
          Math.min(1, outside / 8);
        // No corredor da pista o relevo fica rebaixado: a malha de fundo tem
        // células de 6 m e a corda entre vértices passa por cima da rampa
        // convexa dos kickers. Sem essa folga o terreno cobre a pista.
        const nearDepression = 0.18 + 0.26 * (1 - clamp(outside / 10, 0, 1));
        const y = track.heightAt(s, 0) - nearDepression - slope + ripple;

        const vertex = row * cols + col;
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;

        const raw = clamp((s - (this.desertStart - 15)) / 30, 0, 1);
        const blend = raw * raw * (3 - 2 * raw);
        const grain = 0.9 + hash2(col, row) * 0.18;
        tempTerrainColor.copy(FOREST_TERRAIN).lerp(DESERT_TERRAIN, blend);
        colors[vertex * 3] = tempTerrainColor.r * grain;
        colors[vertex * 3 + 1] = tempTerrainColor.g * grain;
        colors[vertex * 3 + 2] = tempTerrainColor.b * grain;
      }
    }

    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const a = row * cols + col;
        const b = a + 1;
        const c = a + cols + 1;
        const d = a + cols;
        indices.push(a, d, b, b, d, c);
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
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'scenery-terrain-backdrop';
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildPines(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-pines';
    const pines = this.items.filter((item) => item.kind === 'pine');

    if (pines.length === 0) {
      return group;
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.24, 1.6, 6);
    trunkGeometry.translate(0, 0.8, 0);
    const trunkMaterial = this.standardMaterial();
    const trunk = this.instanced('scenery-pine-trunks', trunkGeometry, trunkMaterial, pines.length);

    const layers: ReadonlyArray<readonly [number, number, number]> = [
      [1.5, 2.5, 0.8],
      [1.15, 2.1, 1.85],
      [0.78, 1.55, 2.85],
    ];

    const cones = layers.map(([radius, height, offset], index) => {
      const geometry = new THREE.ConeGeometry(radius, height, 7);
      geometry.translate(0, height * 0.5, 0);
      const mesh = this.instanced(
        `scenery-pine-crown-${index}`,
        geometry,
        trunkMaterial.clone(),
        pines.length,
      );
      return { mesh, offset };
    });

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    pines.forEach((pine, index) => {
      const s = pine.scale;
      position.set(pine.x, pine.y, pine.z);
      quaternion.setFromAxisAngle(UP, pine.yaw);
      scale.set(s * pine.sx, s * pine.sy, s * pine.sz);

      matrix.compose(position, quaternion, scale);
      trunk.setMatrixAt(index, matrix);
      trunk.setColorAt(index, new THREE.Color(0x6b4b32).offsetHSL(0, 0, (index % 5) * 0.01));

      for (const { mesh, offset } of cones) {
        position.set(pine.x, pine.y + offset * s * pine.sy, pine.z);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, pine.color);
      }
    });

    trunk.instanceMatrix.needsUpdate = true;
    trunk.instanceColor!.needsUpdate = true;
    trunk.computeBoundingSphere();
    group.add(trunk);

    for (const { mesh } of cones) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildRocks(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-rocks';
    const rocks = this.items.filter((item) => item.kind === 'rock');

    if (rocks.length === 0) {
      return group;
    }

    const geometry = new THREE.DodecahedronGeometry(0.7, 0);
    const material = this.standardMaterial();
    const mesh = this.instanced('scenery-rocks-mesh', geometry, material, rocks.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    rocks.forEach((rock, index) => {
      position.set(rock.x, rock.y + 0.28 * rock.scale * rock.sy, rock.z);
      quaternion.setFromAxisAngle(UP, rock.yaw);
      scale.set(
        rock.scale * rock.sx * 1.1,
        rock.scale * rock.sy * 0.75,
        rock.scale * rock.sz,
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, rock.color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return group;
  }

  private buildBushes(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-bushes';
    const bushes = this.items.filter(
      (item) => item.kind === 'bush' || item.kind === 'drybush',
    );

    if (bushes.length === 0) {
      return group;
    }

    const geometry = new THREE.IcosahedronGeometry(0.75, 0);
    const material = this.standardMaterial();
    const mesh = this.instanced('scenery-bushes-mesh', geometry, material, bushes.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    bushes.forEach((bush, index) => {
      const squash = bush.kind === 'drybush' ? 0.55 : 0.72;
      position.set(bush.x, bush.y + 0.4 * bush.scale * squash, bush.z);
      quaternion.setFromAxisAngle(UP, bush.yaw);
      scale.set(
        bush.scale * bush.sx,
        bush.scale * bush.sy * squash,
        bush.scale * bush.sz,
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, bush.color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return group;
  }

  private buildCacti(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-cacti';
    const cacti = this.items.filter((item) => item.kind === 'cactus');

    if (cacti.length === 0) {
      return group;
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.26, 0.34, 2.8, 7);
    trunkGeometry.translate(0, 1.4, 0);
    const armGeometry = new THREE.CylinderGeometry(0.16, 0.18, 1.0, 6);
    armGeometry.translate(0, 0.5, 0);
    const jointGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.55, 6);
    jointGeometry.rotateZ(Math.PI * 0.5);

    const material = this.standardMaterial();
    const trunk = this.instanced('scenery-cactus-trunks', trunkGeometry, material, cacti.length);
    const arms = this.instanced(
      'scenery-cactus-arms',
      armGeometry,
      material,
      cacti.length * 2,
    );
    const joints = this.instanced(
      'scenery-cactus-joints',
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
    const identity = new THREE.Quaternion();

    cacti.forEach((cactus, index) => {
      const s = cactus.scale;
      position.set(cactus.x, cactus.y, cactus.z);
      quaternion.setFromAxisAngle(UP, cactus.yaw);
      scale.set(s * cactus.sx, s * cactus.sy, s * cactus.sz);
      baseMatrix.compose(position, quaternion, scale);

      trunk.setMatrixAt(index, baseMatrix);
      trunk.setColorAt(index, cactus.color);

      for (let arm = 0; arm < 2; arm += 1) {
        const side = arm === 0 ? 1 : -1;
        const armY = arm === 0 ? 1.15 : 1.55;

        localMatrix.makeTranslation(side * 0.55, armY, 0);
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        arms.setMatrixAt(index * 2 + arm, finalMatrix);
        arms.setColorAt(index * 2 + arm, cactus.color);

        localMatrix.compose(
          new THREE.Vector3(side * 0.3, armY, 0),
          identity,
          new THREE.Vector3(1, 1, 1),
        );
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        joints.setMatrixAt(index * 2 + arm, finalMatrix);
        joints.setColorAt(index * 2 + arm, cactus.color);
      }
    });

    for (const mesh of [trunk, arms, joints]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildEdgePosts(track: Track): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-edge-posts';

    const placements: Array<{ x: number; y: number; z: number; yaw: number }> = [];
    const from = 8;
    const to = track.length - 8;

    for (let s = from; s <= to; s += EDGE_POST_SPACING) {
      const sample = track.sampleAt(s);
      const half = sample.width * 0.5;
      const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);

      for (const side of [-1, 1]) {
        const u = side * (half + EDGE_POST_CLEARANCE);
        placements.push({
          x: sample.position.x + sample.right.x * u,
          y: track.heightAt(s, u),
          z: sample.position.z + sample.right.z * u,
          yaw,
        });
      }
    }

    const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 1.15, 6);
    postGeometry.translate(0, 0.575, 0);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f1e4,
      roughness: 0.8,
      flatShading: true,
    });
    const topGeometry = new THREE.CylinderGeometry(0.085, 0.085, 0.2, 6);
    topGeometry.translate(0, 1.24, 0);
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0xcf4630,
      roughness: 0.75,
      flatShading: true,
    });

    const posts = this.instanced(
      'scenery-edge-post-body',
      postGeometry,
      postMaterial,
      placements.length,
    );
    const tops = this.instanced(
      'scenery-edge-post-top',
      topGeometry,
      topMaterial,
      placements.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    placements.forEach((placement, index) => {
      position.set(placement.x, placement.y, placement.z);
      quaternion.setFromAxisAngle(UP, placement.yaw);
      matrix.compose(position, quaternion, scale);
      posts.setMatrixAt(index, matrix);
      tops.setMatrixAt(index, matrix);
    });

    for (const mesh of [posts, tops]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildJumpMarkers(track: Track): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-jump-markers';
    const kickers = track.def.kickers;

    if (kickers.length === 0) {
      return group;
    }

    const postGeometry = new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6);
    postGeometry.translate(0, 0.85, 0);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xff7a1a,
      roughness: 0.7,
      flatShading: true,
    });
    const flagGeometry = new THREE.BoxGeometry(0.48, 0.3, 0.04);
    const flagMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8c2b,
      roughness: 0.65,
      flatShading: true,
    });

    const postMatrices: Array<{ x: number; y: number; z: number; yaw: number }> = [];
    const flagMatrices: Array<{ x: number; y: number; z: number; yaw: number }> = [];

    for (const kicker of kickers) {
      for (const s of [kicker.s + 0.3, kicker.s + kicker.length - 0.3]) {
        if (s < 0 || s > track.length) {
          continue;
        }

        const sample = track.sampleAt(s);
        const half = sample.width * 0.5;
        const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);

        for (const side of [-1, 1]) {
          const u = side * (half + 0.9);
          const x = sample.position.x + sample.right.x * u;
          const z = sample.position.z + sample.right.z * u;
          const y = track.heightAt(s, u);
          postMatrices.push({ x, y, z, yaw });
          flagMatrices.push({
            x: x + sample.right.x * side * 0.26,
            y: y + 1.52,
            z: z + sample.right.z * side * 0.26,
            yaw,
          });
        }
      }
    }

    const posts = this.instanced(
      'scenery-jump-posts',
      postGeometry,
      postMaterial,
      postMatrices.length,
    );
    const flags = this.instanced(
      'scenery-jump-flags',
      flagGeometry,
      flagMaterial,
      flagMatrices.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    postMatrices.forEach((placement, index) => {
      position.set(placement.x, placement.y, placement.z);
      quaternion.setFromAxisAngle(UP, placement.yaw);
      matrix.compose(position, quaternion, scale);
      posts.setMatrixAt(index, matrix);
    });

    flagMatrices.forEach((placement, index) => {
      position.set(placement.x, placement.y, placement.z);
      quaternion.setFromAxisAngle(UP, placement.yaw + Math.PI);
      matrix.compose(position, quaternion, scale);
      flags.setMatrixAt(index, matrix);
    });

    for (const mesh of [posts, flags]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    for (const kicker of kickers) {
      group.add(this.buildJumpBand(track, kicker.s + 0.35));
      group.add(this.buildSaltoBoard(track, kicker.s + 0.9));
    }

    return group;
  }

  private buildJumpBand(track: Track, s: number): THREE.Mesh {
    const s0 = clamp(s, 0, track.length);
    const s1 = clamp(s + 0.9, 0, track.length);

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

    const rows = [row0, row1];
    const rowsS = [s0, s1];
    const segments = 8;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let row = 0; row < rows.length; row += 1) {
      const current = rows[row];
      const rowS = rowsS[row];
      for (let segment = 0; segment <= segments; segment += 1) {
        const u = -current.half + (current.half * 2 * segment) / segments;
        positions.push(
          current.x + current.rightX * u,
          track.heightAt(rowS, u) + 0.055,
          current.z + current.rightZ * u,
        );
      }
    }

    const rowWidth = segments + 1;
    for (let segment = 0; segment < segments; segment += 1) {
      const a = segment;
      const b = segment + 1;
      const c = rowWidth + segment + 1;
      const d = rowWidth + segment;
      indices.push(a, c, b, a, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: 0x23241f,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'scenery-jump-band';
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildSaltoBoard(track: Track, s: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-salto-board';

    const clampedS = clamp(s, 0, track.length);
    const sample = track.sampleAt(clampedS);
    const half = sample.width * 0.5;
    const u = half + 1.3;
    const x = sample.position.x + sample.right.x * u;
    const z = sample.position.z + sample.right.z * u;
    const y = track.heightAt(clampedS, u);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

    group.position.set(x, y, z);
    group.rotation.y = heading + Math.PI;

    const texture = createBannerTexture({
      text: 'SALTO',
      background: '#221f19',
      foreground: '#ffb45c',
      border: '#ff7a1a',
      width: 512,
      height: 128,
    });
    const bannerMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const bannerGeometry = new THREE.PlaneGeometry(2.2, 0.55);
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.y = 2.05;
    group.add(banner);

    const postGeometry = new THREE.BoxGeometry(0.07, 2.05, 0.07);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a332a,
      roughness: 0.9,
      flatShading: true,
    });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(side * 0.92, 1.02, 0);
      group.add(post);
    }

    this.textures.push(texture);
    this.geometries.push(bannerGeometry, postGeometry);
    this.materials.push(bannerMaterial, postMaterial);
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

    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private standardMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
  }
}

/** PRNG determinística (mulberry32). */
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

/** Ruído determinístico 0..1 para quebrar a cor do terreno. */
function hash2(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
