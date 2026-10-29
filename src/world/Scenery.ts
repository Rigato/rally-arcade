import * as THREE from 'three';
import { clamp } from '../core/math';
import { SCENARIOS, SCENARIO_IDS } from '../game/scenarios';
import type { SceneryFamily } from '../game/scenarios';
import type { Track, TrackZoneId } from '../track/Track';
import type { TrackBranch } from '../track/TrackBranch';
import type { TrackZone } from '../game/types';
import type { TrackBlock } from '../game/types';
import { zoneBlendAt, type ZoneId } from '../track/zones';
import { createBannerTexture } from './canvasText';

const SHOULDER_INNER = 3.0;
const SHOULDER_OUTER = 11.5;
/** Objetos altos (pinheiros/cactos) só a partir desta distância da borda. */
const TALL_CLEARANCE = 6.0;
const START_CLEARANCE = 10;
const FINISH_CLEARANCE = 12;
const PORTAL_CLEARANCE = 9;
const KICKER_CLEARANCE = 12;
const EDGE_POST_SPACING = 20;
const EDGE_POST_CLEARANCE = 0.55;
const BRANCH_SCATTER_STEP_MIN = 8;
const BRANCH_SCATTER_STEP_MAX = 14;
const BRANCH_SCATTER_MARGIN = 8;
const BRANCH_POST_MARGIN = 6;
const BRANCH_POST_CLEARANCE = 0.6;

const UP = new THREE.Vector3(0, 1, 0);
const TERRAIN_COLORS: Record<ZoneId, THREE.Color> = Object.fromEntries(
  SCENARIO_IDS.map((id) => [id, new THREE.Color(SCENARIOS[id].colors.terrain)]),
) as Record<ZoneId, THREE.Color>;
const tempTerrainColor = new THREE.Color();

type SceneryKind =
  | 'pine'
  | 'snowpine'
  | 'rock'
  | 'bush'
  | 'cactus'
  | 'drybush'
  | 'house'
  | 'fence'
  | 'lamp'
  | 'haybale'
  | 'palm'
  | 'umbrella';

interface SceneryItem {
  kind: SceneryKind;
  zone: TrackZoneId;
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

interface TerrainSample {
  readonly pathId: number;
  readonly s: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly zone: TrackZoneId;
}

interface TerrainHeight {
  readonly y: number;
  readonly zone: TrackZoneId;
  readonly s: number;
  readonly pathId: number;
  readonly distance: number;
}

/** Passo (m) da distribuição de props por família de cenário. */
const SCATTER_STEPS: Record<SceneryFamily, readonly [number, number]> = {
  forest: [3.7, 6.3],
  desert: [6.1, 9.4],
  snow: [5, 8],
  village: [8, 12],
  dirt: [7, 11],
  beach: [6, 10],
};

/** Cores de lona dos guarda-sóis: acento próprio da praia, não da paleta. */
const UMBRELLA_COLORS = [0xe0573c, 0x2f8fa3, 0xf0c44a];

/**
 * Cenário low poly instanciado ao longo da pista.
 *
 * Floresta: pinheiros, pedras e arbustos.
 * Deserto: cactos, pedras claras e arbustos secos.
 * Neve: pinheiros nevados, pedras e montes de neve.
 * Vilarejo: casas, cercas, postes, pinheiros e arbustos.
 * Estrada de terra: celeiros, cercas, fardos de feno e árvores.
 * Praia: palmeiras, guarda-sóis, pedras e arbustos secos.
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
  private readonly terrainSamples: TerrainSample[] = [];
  private readonly terrainGrid = new Map<string, TerrainSample[]>();
  private hasRouteBranches = false;
  private readonly kickers: ReadonlyArray<{ readonly s: number; readonly length: number }>;
  private readonly zones: readonly TrackZone[];
  private readonly portalSs: readonly number[];

  constructor(track: Track) {
    this.group.name = 'scenery';
    this.zones = track.def.zones;
    this.portalSs = this.zones.slice(1).map((zone) => zone.start);
    this.kickers = track.def.kickers;
    this.buildTerrainSamples(track);

    // Cada setor tem seu próprio PRNG: o cenário de cada zona é estável mesmo
    // que outro setor mude de extensão.
    for (let i = 0; i < this.zones.length; i += 1) {
      const zone = this.zones[i];
      const rng = mulberry32(0x5eedf00d + i * 0x9e3779b1);
      const from = i === 0
        ? track.startS + START_CLEARANCE
        : zone.start + 2;
      const to = Math.min(
        i === this.zones.length - 1 ? track.length - FINISH_CLEARANCE : zone.end - 2,
        track.length - FINISH_CLEARANCE,
      );

      if (to <= from) {
        continue;
      }

      const family = SCENARIOS[zone.id].family;
      const [stepMin, stepMax] = SCATTER_STEPS[family];
      this.scatter(track, rng, from, to, zone.id, stepMin, stepMax);
    }

    // Ramos de bifurcação: cenário próprio apenas no ombro externo. Cada ramo
    // recebe um PRNG estável derivado do índice para não alterar as zonas.
    track.branches.forEach((branch, index) => {
      const rng = mulberry32(0x0b1a5c00 + (index + 1) * 0x9e3779b1);
      this.scatterBranch(track, branch, rng);
    });

    // Blocos com split: preenche o miolo do Y com cenário do bioma do bloco,
    // usando o mesmo terreno do backdrop.
    if (track.def.blocks) {
      track.def.blocks.forEach((block, index) => {
        if (block.kind !== 'split') {
          return;
        }
        const branch = track.def.forks
          ?.flatMap((fork) => fork.branches)
          .find((entry) => entry.id === block.routeId);
        if (!branch) {
          return;
        }
        const rng = mulberry32(0x5eedb10c + (index + 1) * 0x85ebca6b);
        this.scatterSplitIsland(track, block, branch.id, rng);
      });
    }

    this.group.add(this.buildTerrainBackdrop(track));
    this.group.add(this.buildPines());
    this.group.add(this.buildRocks());
    this.group.add(this.buildBushes());
    this.group.add(this.buildCacti());
    this.group.add(this.buildHouses());
    this.group.add(this.buildFences());
    this.group.add(this.buildLamps());
    this.group.add(this.buildHaybales());
    this.group.add(this.buildPalms());
    this.group.add(this.buildUmbrellas());
    this.group.add(this.buildEdgePosts(track));
    this.group.add(this.buildBranchEdgePosts(track));
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

          // Não colocar decoração no meio de uma estrada alternativa. No v3,
          // só a faixa da rota é bloqueada; o resto do miolo pode receber
          // cenário. No v2 (legacy), mantém o corredor de 12 m.
          if (this.isNearRouteRoad(track, x, z, 2)) {
            continue;
          }

          this.items.push(
            this.makeItem(zone, x, y, z, rng, Math.abs(u) - half),
          );
        }
      }

      s += stepMin + rng() * (stepMax - stepMin);
    }
  }

  /**
   * Decora o ombro de um ramo. No v3 a rota é completa: decora os dois lados
   * (o interno preenche o miolo do Y). No v2 legacy, só o lado externo.
   */
  private scatterBranch(
    track: Track,
    branch: TrackBranch,
    rng: () => number,
  ): void {
    const from = Math.min(BRANCH_SCATTER_MARGIN, branch.length * 0.25);
    const to = branch.length - from;
    if (to <= from) {
      return;
    }

    const fullRoute = branch.kind === 'route';
    const sides = fullRoute ? [-1, 1] : [branch.side];
    let s = from;

    while (s < to) {
      if (rng() >= 0.14) {
        const ss = clamp(s + (rng() - 0.5) * 2.4, from, to);
        const sample = branch.sampleAt(ss);
        const half = branch.widthAt(ss) * 0.5;
        const zone = branch.zoneAt(ss);

        for (const side of sides) {
          // 3–10 m além da borda, no lado externo e/ou interno.
          const lateral = half + 3 + rng() * 7;
          const u = side * lateral;
          const x = sample.position.x + sample.right.x * u;
          const z = sample.position.z + sample.right.z * u;
          if (this.isNearRoad(track, x, z, branch, half + 2)) {
            continue;
          }
          const y = branch.heightAt(ss, u) - 0.02;
          this.items.push(
            this.makeItem(zone, x, y, z, rng, Math.abs(u) - half),
          );
        }
      }

      s += (fullRoute ? 6 : BRANCH_SCATTER_STEP_MIN) +
        rng() *
          ((fullRoute ? 10 : BRANCH_SCATTER_STEP_MAX) -
            (fullRoute ? 6 : BRANCH_SCATTER_STEP_MIN));
    }
  }

  private buildTerrainSamples(track: Track): void {
    this.terrainSamples.length = 0;
    this.terrainGrid.clear();
    this.hasRouteBranches = track.branches.some(
      (branch) => branch.kind === 'route',
    );

    const add = (sample: TerrainSample): void => {
      this.terrainSamples.push(sample);
      const key = this.terrainCellKey(sample.x, sample.z);
      const bucket = this.terrainGrid.get(key);
      if (bucket) {
        bucket.push(sample);
      } else {
        this.terrainGrid.set(key, [sample]);
      }
    };

    for (let s = 0; s <= track.length; s += 4) {
      const sample = track.sampleAt(s);
      add({
        pathId: 0,
        s,
        x: sample.position.x,
        y: sample.position.y,
        z: sample.position.z,
        width: sample.width,
        zone: track.zoneAt(s),
      });
    }

    track.branches.forEach((branch, index) => {
      if (branch.kind !== 'route') {
        return;
      }
      for (let s = 0; s <= branch.length; s += 4) {
        const sample = branch.sampleAt(s);
        add({
          pathId: index + 1,
          s,
          x: sample.position.x,
          y: sample.position.y,
          z: sample.position.z,
          width: sample.width,
          zone: branch.zoneAt(s),
        });
      }
    });
  }

  private terrainCellKey(x: number, z: number): string {
    return `${Math.floor(x / 80)},${Math.floor(z / 80)}`;
  }

  private terrainSamplesNear(x: number, z: number): readonly TerrainSample[] {
    const cx = Math.floor(x / 80);
    const cz = Math.floor(z / 80);
    const result: TerrainSample[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = this.terrainGrid.get(`${cx + dx},${cz + dz}`);
        if (bucket) {
          result.push(...bucket);
        }
      }
    }
    return result.length > 0 ? result : this.terrainSamples;
  }

  /**
   * Altura do terreno visual no mundo. Mistura o caminho mais próximo com o
   * mais próximo de OUTRO caminho, para o miolo do Y não ficar numa parede.
   */
  private terrainHeightAt(x: number, z: number): TerrainHeight {
    let nearest: TerrainSample | null = null;
    let nearestDistanceSq = Infinity;
    const nearby = this.terrainSamplesNear(x, z);

    for (const sample of nearby) {
      const dx = sample.x - x;
      const dz = sample.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < nearestDistanceSq) {
        nearest = sample;
        nearestDistanceSq = distanceSq;
      }
    }

    if (!nearest) {
      return { y: 0, zone: 'forest', s: 0, pathId: 0, distance: 0 };
    }

    // Prefere uma amostra de outro caminho (miolo entre rotas). Se não
    // existir, usa a amostra mais próxima de outro trecho do mesmo caminho,
    // preservando o fundo suave entre pernas paralelas (pista fixa/v2).
    let blend: TerrainSample | null = null;
    let blendDistanceSq = Infinity;
    let samePathFar: TerrainSample | null = null;
    let samePathFarDistanceSq = Infinity;

    for (const sample of nearby) {
      const dx = sample.x - x;
      const dz = sample.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (sample.pathId !== nearest.pathId) {
        if (distanceSq < blendDistanceSq) {
          blend = sample;
          blendDistanceSq = distanceSq;
        }
        continue;
      }
      if (Math.abs(sample.s - nearest.s) < 40) {
        continue;
      }
      if (distanceSq < samePathFarDistanceSq) {
        samePathFar = sample;
        samePathFarDistanceSq = distanceSq;
      }
    }

    if (!blend && samePathFar) {
      blend = samePathFar;
      blendDistanceSq = samePathFarDistanceSq;
    }

    // Fallback global para pistas com pernas paralelas distantes (pista fixa
    // e v2): procura a amostra mais próxima de outro trecho.
    if (!blend && !this.hasRouteBranches) {
      for (const sample of this.terrainSamples) {
        if (sample.pathId === nearest.pathId &&
            Math.abs(sample.s - nearest.s) < 40) {
          continue;
        }
        const dx = sample.x - x;
        const dz = sample.z - z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < blendDistanceSq) {
          blend = sample;
          blendDistanceSq = distanceSq;
        }
      }
    }

    const weight1 = 1 / (nearestDistanceSq + 1);
    const weight2 = blend && Number.isFinite(blendDistanceSq)
      ? 1 / (blendDistanceSq + 1)
      : 0;
    const blendedY = blend && weight2 > 0
      ? (nearest.y * weight1 + blend.y * weight2) / (weight1 + weight2)
      : nearest.y;

    const lateral = Math.sqrt(nearestDistanceSq);
    const half = nearest.width * 0.5;
    const inner = half + 11.9;
    const outside = Math.max(0, lateral - inner);
    const slope = Math.min(Math.max(0, outside - 2) * 0.12, 5);
    const ripple =
      (Math.sin(nearest.s * 0.055 + lateral * 0.11) * 0.3 +
        Math.sin(nearest.s * 0.017 - lateral * 0.03) * 0.6) *
      Math.min(1, outside / 8);
    const nearDepression = 0.18 + 0.26 * (1 - clamp(outside / 14, 0, 1));
    const island = this.hasRouteBranches
      ? clamp((Math.max(0, lateral - half - 2) - 2) / 20, 0, 1)
      : 0;
    const hill = island > 0
      ? (
        Math.sin(x * 0.032 + z * 0.017) * 1.8 +
        Math.cos(z * 0.041 - x * 0.013) * 1.2
      ) * island
      : 0;

    return {
      y: blendedY - nearDepression - slope + ripple + hill,
      zone: nearest.zone,
      s: nearest.s,
      pathId: nearest.pathId,
      distance: Math.max(0, lateral - half),
    };
  }

  /** `true` se (x,z) está na faixa de qualquer estrada do v3. */
  private isNearRouteRoad(
    track: Track,
    x: number,
    z: number,
    margin: number,
  ): boolean {
    for (const branch of track.branches) {
      const projection = branch.project(x, z);
      if (branch.kind === 'route') {
        if (
          projection.distance <
          branch.widthAt(projection.s) * 0.5 + margin
        ) {
          return true;
        }
      } else if (projection.distance < 12) {
        return true;
      }
    }
    return false;
  }

  /** `true` se (x,z) está em cima da pista principal ou de outro ramo. */
  private isNearRoad(
    track: Track,
    x: number,
    z: number,
    current: TrackBranch,
    margin: number,
  ): boolean {
    const main = track.project(x, z);
    if (main.distance < track.widthAt(main.s) * 0.5 + margin) {
      return true;
    }
    for (const branch of track.branches) {
      if (branch === current) {
        continue;
      }
      const projection = branch.project(x, z);
      if (
        projection.distance <
        branch.widthAt(projection.s) * 0.5 + margin
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Preenche o miolo de um bloco com split. Amostra o bounding box do bloco,
   * rejeita estradas e usa o mesmo terreno do backdrop.
   */
  private scatterSplitIsland(
    track: Track,
    block: TrackBlock,
    routeId: string,
    rng: () => number,
  ): void {
    const branch = track.branches.find((entry) => entry.id === routeId);
    if (!branch) {
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let s = block.startS; s <= block.endS; s += 12) {
      const sample = track.sampleAt(s);
      minX = Math.min(minX, sample.position.x);
      maxX = Math.max(maxX, sample.position.x);
      minZ = Math.min(minZ, sample.position.z);
      maxZ = Math.max(maxZ, sample.position.z);
    }
    for (let s = 0; s <= branch.length; s += 12) {
      const sample = branch.sampleAt(s);
      minX = Math.min(minX, sample.position.x);
      maxX = Math.max(maxX, sample.position.x);
      minZ = Math.min(minZ, sample.position.z);
      maxZ = Math.max(maxZ, sample.position.z);
    }

    const spacing = 6.5;
    let placed = 0;
    for (let z = minZ - 10; z <= maxZ + 10 && placed < 260; z += spacing) {
      for (let x = minX - 10; x <= maxX + 10 && placed < 260; x += spacing) {
        if (rng() > 0.55) {
          continue;
        }
        const px = x + (rng() - 0.5) * spacing * 0.8;
        const pz = z + (rng() - 0.5) * spacing * 0.8;
        if (this.isNearRouteRoad(track, px, pz, 2.5)) {
          continue;
        }
        const mainDistance = track.project(px, pz).distance;
        const branchDistance = branch.project(px, pz).distance;
        if (mainDistance > 95 || branchDistance > 95) {
          continue;
        }
        const terrain = this.terrainHeightAt(px, pz);
        if (terrain.distance < 2.5) {
          continue;
        }
        let tooClose = false;
        for (const item of this.items) {
          const dx = item.x - px;
          const dz = item.z - pz;
          if (dx * dx + dz * dz < 2 * 2) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) {
          continue;
        }
        this.items.push(
          this.makeItem(
            block.scenario,
            px,
            terrain.y - 0.02,
            pz,
            rng,
            terrain.distance,
          ),
        );
        placed += 1;
      }
    }
  }

  private isClear(s: number): boolean {
    for (const portalS of this.portalSs) {
      if (Math.abs(s - portalS) < PORTAL_CLEARANCE) {
        return false;
      }
    }

    for (const kicker of this.kickers) {
      if (
        s >= kicker.s - KICKER_CLEARANCE &&
        s <= kicker.s + kicker.length + KICKER_CLEARANCE
      ) {
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
    distanceFromEdge: number,
  ): SceneryItem {
    const family = SCENARIOS[zone].family;
    const roll = rng();
    let kind: SceneryKind;

    switch (family) {
      case 'forest':
        kind = roll < 0.5 ? 'pine' : roll < 0.78 ? 'rock' : 'bush';
        break;
      case 'desert':
        kind = roll < 0.42 ? 'cactus' : roll < 0.72 ? 'rock' : 'drybush';
        break;
      case 'snow':
        kind = roll < 0.44 ? 'snowpine' : roll < 0.7 ? 'rock' : 'bush';
        break;
      case 'village':
        kind =
          roll < 0.28
            ? 'pine'
            : roll < 0.46
              ? 'house'
              : roll < 0.6
                ? 'fence'
                : roll < 0.7
                  ? 'lamp'
                  : roll < 0.86
                    ? 'bush'
                    : 'rock';
        break;
      case 'dirt':
        kind =
          roll < 0.26
            ? 'pine'
            : roll < 0.4
              ? 'house'
              : roll < 0.54
                ? 'fence'
                : roll < 0.66
                  ? 'haybale'
                  : roll < 0.84
                    ? 'drybush'
                    : 'rock';
        break;
      case 'beach':
        kind =
          roll < 0.34
            ? 'palm'
            : roll < 0.48
              ? 'umbrella'
              : roll < 0.7
                ? 'drybush'
                : roll < 0.86
                  ? 'rock'
                  : 'bush';
        break;
    }

    const tall =
      kind === 'pine' ||
      kind === 'snowpine' ||
      kind === 'cactus' ||
      kind === 'palm' ||
      kind === 'house' ||
      kind === 'lamp';

    if (tall && distanceFromEdge < TALL_CLEARANCE) {
      kind = this.fallbackKind(kind, family, rng);
    }

    const baseScale = 0.75 + rng() * 0.75;
    const yaw = rng() * Math.PI * 2;
    const scale =
      family === 'dirt' && kind === 'house' ? baseScale * 1.45 : baseScale;

    return {
      kind,
      zone,
      x,
      y,
      z,
      yaw,
      scale,
      sx: 0.85 + rng() * 0.5,
      sy: 0.75 + rng() * 0.65,
      sz: 0.85 + rng() * 0.5,
      color: this.pickColor(kind, zone, rng),
    };
  }

  /** Prop baixo usado quando um prop alto cai dentro da faixa de 6 m. */
  private fallbackKind(
    kind: SceneryKind,
    family: SceneryFamily,
    rng: () => number,
  ): SceneryKind {
    // Floresta e deserto mantêm a substituição histórica.
    if (family === 'forest') {
      return rng() < 0.55 ? 'rock' : 'bush';
    }
    if (family === 'desert') {
      return rng() < 0.5 ? 'rock' : 'drybush';
    }
    if (kind === 'house') {
      return family === 'dirt' ? 'haybale' : 'fence';
    }
    if (family === 'beach') {
      return rng() < 0.5 ? 'umbrella' : 'drybush';
    }
    if (family === 'dirt') {
      return rng() < 0.5 ? 'drybush' : 'rock';
    }
    if (family === 'snow') {
      return rng() < 0.5 ? 'rock' : 'bush';
    }
    return rng() < 0.5 ? 'bush' : 'rock';
  }

  private pickColor(kind: SceneryKind, zone: TrackZoneId, rng: () => number): THREE.Color {
    const colors = SCENARIOS[zone].colors;
    const variation = (rng() - 0.5) * 0.18;
    const color = new THREE.Color();

    switch (kind) {
      case 'pine':
      case 'snowpine':
      case 'cactus':
      case 'palm':
        color.setHex(pickFrom(colors.tree, rng));
        break;
      case 'bush':
        color.setHex(colors.bush);
        break;
      case 'drybush':
        color.setHex(colors.drybush);
        break;
      case 'rock':
        color.setHex(pickFrom(colors.rock, rng));
        break;
      case 'house':
        color.setHex(zone === 'dirt' ? pickFrom(colors.log, rng) : colors.edge);
        break;
      case 'fence':
        color.setHex(pickFrom(colors.log, rng));
        break;
      case 'lamp':
        color.setHex(colors.rock[0] ?? colors.edge);
        break;
      case 'haybale':
        color.setHex(colors.drybush);
        break;
      case 'umbrella':
        color.setHex(pickFrom(UMBRELLA_COLORS, rng));
        break;
    }

    color.offsetHSL(variation * 0.25, variation * 0.4, variation);
    // Copa nevada: clareia a paleta `tree[]` sem sair do registro.
    if (kind === 'snowpine') {
      color.offsetHSL(0, -0.12, 0.07);
    }
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
    if (this.terrainSamples.length > 0) {
      for (const sample of this.terrainSamples) {
        minX = Math.min(minX, sample.x);
        maxX = Math.max(maxX, sample.x);
        minZ = Math.min(minZ, sample.z);
        maxZ = Math.max(maxZ, sample.z);
      }
    } else {
      for (const point of track.def.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
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
        const terrain = this.terrainHeightAt(x, z);
        const vertex = row * cols + col;

        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = terrain.y;
        positions[vertex * 3 + 2] = z;

        const grain = 0.9 + hash2(col, row) * 0.18;
        if (terrain.pathId === 0) {
          const blend = zoneBlendAt(this.zones, terrain.s);
          const fromZone = this.zones[blend.from]?.id ?? 'forest';
          const toZone = this.zones[blend.to]?.id ?? 'forest';
          tempTerrainColor
            .copy(TERRAIN_COLORS[fromZone])
            .lerp(TERRAIN_COLORS[toZone], blend.t);
        } else {
          tempTerrainColor.copy(TERRAIN_COLORS[terrain.zone]);
        }
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
    const pines = this.items.filter(
      (item) => item.kind === 'pine' || item.kind === 'snowpine',
    );

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

  private buildHouses(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-houses';
    const houses = this.items.filter((item) => item.kind === 'house');

    if (houses.length === 0) {
      return group;
    }

    const bodyGeometry = new THREE.BoxGeometry(3.2, 2.4, 2.8);
    bodyGeometry.translate(0, 1.2, 0);
    const roofGeometry = makeGableRoofGeometry(3.7, 3.2, 1.2);
    roofGeometry.translate(0, 2.4, 0);
    const bodies = this.instanced(
      'scenery-house-bodies',
      bodyGeometry,
      this.standardMaterial(),
      houses.length,
    );
    const roofs = this.instanced(
      'scenery-house-roofs',
      roofGeometry,
      this.standardMaterial(),
      houses.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    houses.forEach((house, index) => {
      const s = house.scale;
      position.set(house.x, house.y, house.z);
      quaternion.setFromAxisAngle(UP, house.yaw);
      scale.set(s * house.sx, s * house.sy, s * house.sz);
      matrix.compose(position, quaternion, scale);

      bodies.setMatrixAt(index, matrix);
      bodies.setColorAt(index, house.color);

      const roofColor = new THREE.Color(
        SCENARIOS[house.zone].colors.log[0],
      ).offsetHSL(0, 0, -0.04 + (index % 3) * 0.012);
      roofs.setMatrixAt(index, matrix);
      roofs.setColorAt(index, roofColor);
    });

    for (const mesh of [bodies, roofs]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildFences(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-fences';
    const fences = this.items.filter((item) => item.kind === 'fence');

    if (fences.length === 0) {
      return group;
    }

    const postGeometry = new THREE.BoxGeometry(0.12, 1.05, 0.12);
    postGeometry.translate(0, 0.525, 0);
    const railGeometry = new THREE.BoxGeometry(1.7, 0.09, 0.07);
    const material = this.standardMaterial();
    const posts = this.instanced(
      'scenery-fence-posts',
      postGeometry,
      material,
      fences.length * 3,
    );
    const rails = this.instanced(
      'scenery-fence-rails',
      railGeometry,
      material,
      fences.length * 4,
    );

    const baseMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    fences.forEach((fence, index) => {
      const s = fence.scale;
      position.set(fence.x, fence.y, fence.z);
      quaternion.setFromAxisAngle(UP, fence.yaw);
      scale.set(s * fence.sx, s * fence.sy, s * fence.sz);
      baseMatrix.compose(position, quaternion, scale);

      for (let post = 0; post < 3; post += 1) {
        localMatrix.makeTranslation((post - 1) * 1.7, 0, 0);
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        posts.setMatrixAt(index * 3 + post, finalMatrix);
        posts.setColorAt(index * 3 + post, fence.color);
      }

      for (let span = 0; span < 2; span += 1) {
        for (let height = 0; height < 2; height += 1) {
          const railIndex = index * 4 + span * 2 + height;
          localMatrix.makeTranslation(span === 0 ? -0.85 : 0.85, 0.42 + height * 0.38, 0);
          finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
          rails.setMatrixAt(railIndex, finalMatrix);
          rails.setColorAt(railIndex, fence.color);
        }
      }
    });

    for (const mesh of [posts, rails]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildLamps(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-lamps';
    const lamps = this.items.filter((item) => item.kind === 'lamp');

    if (lamps.length === 0) {
      return group;
    }

    const poleGeometry = new THREE.CylinderGeometry(0.08, 0.11, 4.2, 6);
    poleGeometry.translate(0, 2.1, 0);
    const headGeometry = new THREE.IcosahedronGeometry(0.24, 0);
    headGeometry.translate(0, 4.2, 0);
    const poleMaterial = this.standardMaterial();
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.55,
      roughness: 0.6,
      metalness: 0,
      flatShading: true,
    });
    const poles = this.instanced(
      'scenery-lamp-poles',
      poleGeometry,
      poleMaterial,
      lamps.length,
    );
    const heads = this.instanced(
      'scenery-lamp-heads',
      headGeometry,
      headMaterial,
      lamps.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const glow = new THREE.Color(0xffe2b0);
    lamps.forEach((lamp, index) => {
      const s = lamp.scale;
      position.set(lamp.x, lamp.y, lamp.z);
      quaternion.setFromAxisAngle(UP, lamp.yaw);
      scale.set(s * lamp.sx, s * lamp.sy, s * lamp.sz);
      matrix.compose(position, quaternion, scale);
      poles.setMatrixAt(index, matrix);
      poles.setColorAt(index, lamp.color);
      heads.setMatrixAt(index, matrix);
      heads.setColorAt(index, glow);
    });

    for (const mesh of [poles, heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildHaybales(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-haybales';
    const bales = this.items.filter((item) => item.kind === 'haybale');

    if (bales.length === 0) {
      return group;
    }

    const geometry = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 9);
    geometry.rotateZ(Math.PI * 0.5);
    geometry.translate(0, 0.55, 0);
    const mesh = this.instanced(
      'scenery-haybales-mesh',
      geometry,
      this.standardMaterial(),
      bales.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    bales.forEach((bale, index) => {
      const s = bale.scale;
      position.set(bale.x, bale.y, bale.z);
      quaternion.setFromAxisAngle(UP, bale.yaw);
      scale.set(s * bale.sx, s * bale.sy, s * bale.sz);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, bale.color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return group;
  }

  private buildPalms(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-palms';
    const palms = this.items.filter((item) => item.kind === 'palm');

    if (palms.length === 0) {
      return group;
    }

    const LEAVES = 5;
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.3, 4.2, 6);
    trunkGeometry.translate(0, 2.1, 0);
    const leafGeometry = new THREE.ConeGeometry(0.34, 1.8, 4);
    leafGeometry.translate(0, 0.9, 0);
    leafGeometry.scale(1, 1, 0.4);
    const trunkMaterial = this.standardMaterial();
    const leafMaterial = this.standardMaterial();
    const trunks = this.instanced(
      'scenery-palm-trunks',
      trunkGeometry,
      trunkMaterial,
      palms.length,
    );
    const leaves = this.instanced(
      'scenery-palm-leaves',
      leafGeometry,
      leafMaterial,
      palms.length * LEAVES,
    );

    const baseMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();
    const crownMatrix = new THREE.Matrix4();
    const fanMatrix = new THREE.Matrix4();
    const droopMatrix = new THREE.Matrix4().makeRotationZ(-1.9);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    palms.forEach((palm, index) => {
      const s = palm.scale;
      position.set(palm.x, palm.y, palm.z);
      quaternion.setFromAxisAngle(UP, palm.yaw);
      scale.set(s * palm.sx, s * palm.sy, s * palm.sz);
      baseMatrix.compose(position, quaternion, scale);

      trunks.setMatrixAt(index, baseMatrix);
      trunks.setColorAt(
        index,
        new THREE.Color(SCENARIOS[palm.zone].colors.log[0]),
      );

      crownMatrix.makeTranslation(0, 4.05 * s * palm.sy, 0);
      for (let leaf = 0; leaf < LEAVES; leaf += 1) {
        fanMatrix.makeRotationY((leaf / LEAVES) * Math.PI * 2);
        localMatrix.multiplyMatrices(crownMatrix, fanMatrix);
        localMatrix.multiply(droopMatrix);
        finalMatrix.multiplyMatrices(baseMatrix, localMatrix);
        const leafIndex = index * LEAVES + leaf;
        leaves.setMatrixAt(leafIndex, finalMatrix);
        leaves.setColorAt(leafIndex, palm.color);
      }
    });

    for (const mesh of [trunks, leaves]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    return group;
  }

  private buildUmbrellas(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-umbrellas';
    const umbrellas = this.items.filter((item) => item.kind === 'umbrella');

    if (umbrellas.length === 0) {
      return group;
    }

    const postGeometry = new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6);
    postGeometry.translate(0, 1.1, 0);
    const canopyGeometry = new THREE.ConeGeometry(1.15, 0.5, 8);
    canopyGeometry.translate(0, 2.35, 0);
    const postMaterial = this.standardMaterial();
    const canopyMaterial = this.standardMaterial();
    canopyMaterial.side = THREE.DoubleSide;
    const posts = this.instanced(
      'scenery-umbrella-posts',
      postGeometry,
      postMaterial,
      umbrellas.length,
    );
    const canopies = this.instanced(
      'scenery-umbrella-canopies',
      canopyGeometry,
      canopyMaterial,
      umbrellas.length,
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    umbrellas.forEach((umbrella, index) => {
      const s = umbrella.scale;
      position.set(umbrella.x, umbrella.y, umbrella.z);
      quaternion.setFromAxisAngle(UP, umbrella.yaw);
      scale.set(s * umbrella.sx, s * umbrella.sy, s * umbrella.sz);
      matrix.compose(position, quaternion, scale);
      posts.setMatrixAt(index, matrix);
      posts.setColorAt(
        index,
        new THREE.Color(SCENARIOS[umbrella.zone].colors.log[0]),
      );
      canopies.setMatrixAt(index, matrix);
      canopies.setColorAt(index, umbrella.color);
    });

    for (const mesh of [posts, canopies]) {
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

  /**
   * Postes de borda dos ramos, no ombro externo. Reaproveita o visual dos
   * postes principais (cilindro claro + topo vermelho) em uma única
   * `InstancedMesh` por parte, somando apenas 2 draw calls.
   */
  private buildBranchEdgePosts(track: Track): THREE.Group {
    const group = new THREE.Group();
    group.name = 'scenery-branch-edge-posts';

    const placements: Array<{ x: number; y: number; z: number; yaw: number }> = [];

    for (const branch of track.branches) {
      const from = Math.min(BRANCH_POST_MARGIN, branch.length * 0.25);
      const to = branch.length - from;
      if (to <= from) {
        continue;
      }

      const sides = branch.kind === 'route'
        ? [-1, 1]
        : [branch.side];
      const spacing = branch.kind === 'route' ? 14 : EDGE_POST_SPACING;
      for (let s = from; s <= to; s += spacing) {
        const sample = branch.sampleAt(s);
        const half = branch.widthAt(s) * 0.5;
        for (const side of sides) {
          const u = side * (half + BRANCH_POST_CLEARANCE);
          placements.push({
            x: sample.position.x + sample.right.x * u,
            y: branch.heightAt(s, u),
            z: sample.position.z + sample.right.z * u,
            yaw: Math.atan2(sample.tangent.x, sample.tangent.z),
          });
        }
      }
    }

    if (placements.length === 0) {
      return group;
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
      'scenery-branch-edge-post-body',
      postGeometry,
      postMaterial,
      placements.length,
    );
    const tops = this.instanced(
      'scenery-branch-edge-post-top',
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

/** Telhado de duas águas (prisma triangular) apoiado em y=0. */
function makeGableRoofGeometry(
  width: number,
  depth: number,
  height: number,
): THREE.BufferGeometry {
  const w = width * 0.5;
  const d = depth * 0.5;
  const a = [-w, 0, -d];
  const b = [w, 0, -d];
  const c = [0, height, -d];
  const dd = [-w, 0, d];
  const e = [w, 0, d];
  const f = [0, height, d];

  const positions = [
    // Frente e fundo.
    ...a, ...c, ...b,
    ...dd, ...e, ...f,
    // Água esquerda e direita.
    ...a, ...f, ...c,
    ...a, ...dd, ...f,
    ...b, ...c, ...f,
    ...b, ...f, ...e,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
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

/** Sorteia um elemento de uma paleta do registro de cenários. */
function pickFrom<T>(values: readonly T[], rng: () => number): T {
  return values[Math.floor(rng() * values.length)] ?? values[0];
}
