import * as THREE from 'three';
import { clamp } from '../core/math';
import { POWERUP_TUNING } from '../game/config';
import type { ActivePowerup, PowerupTuning, PowerupType } from '../game/types';
import type { Track } from './Track';

export type { PowerupType };

/** Multiplicadores aplicados à física enquanto um powerup está ativo. */
export interface PowerupModifiers {
  maxSpeedMultiplier: number;
  accelerationMultiplier: number;
  gripMultiplier: number;
}

/** Distância horizontal carro ↔ pickup que dispara a coleta (m). */
const COLLECT_RADIUS = 1.8;
const COLLECT_RADIUS_SQ = COLLECT_RADIUS * COLLECT_RADIUS;
/** Tolerância vertical (m): não coleta passando por cima no ar. */
const COLLECT_HEIGHT = 2.2;
/** Altura do centro do anel acima do chão (m). */
const HOVER_HEIGHT = 1.2;
const BOB_AMPLITUDE = 0.16;
/** Carrinho visual: anel + núcleo low poly. */
const RING_RADIUS = 0.9;
const RING_TUBE = 0.11;
const CORE_RADIUS = 0.3;

const COLORS: Record<PowerupType, { ring: number; core: number }> = {
  turbo: { ring: 0xff8a2a, core: 0xffd27a },
  grip: { ring: 0x2f9cff, core: 0xbfe9ff },
};

interface Pickup {
  readonly type: PowerupType;
  /** 0 = pista principal; 1..N = rota alternativa. */
  readonly pathId: number;
  readonly s: number;
  readonly u: number;
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
  readonly root: THREE.Group;
  readonly halo: THREE.Group;
  readonly core: THREE.Mesh;
  readonly phase: number;
  collected: boolean;
}

/**
 * Powerups do MVP (M5b): turbo e grip extra.
 *
 * Cada pickup é um anel flutuante com núcleo octaédrico, sem luz extra e sem
 * colisão física: o carro atravessa e coleta por distância horizontal. Pegar
 * o mesmo tipo de novo só renova o timer (nunca acumula); tipos diferentes
 * coexistem. Cada pickup some até o próximo `reset()`.
 *
 * O `Game` chama `update()`/`animate()` e `checkCollect()` apenas em RUNNING,
 * então READY/RECOVERING/FINISHED não gastam timers nem coletam.
 */
export class Powerups {
  readonly group = new THREE.Group();

  private readonly track: Track;
  private readonly tuning: PowerupTuning;
  private readonly items: Pickup[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private turboRemaining = 0;
  private gripRemaining = 0;
  private elapsed = 0;

  /** Buffers reutilizados: nada é alocado por frame. */
  private readonly modifiers: PowerupModifiers = {
    maxSpeedMultiplier: 1,
    accelerationMultiplier: 1,
    gripMultiplier: 1,
  };
  private readonly activeBuffer: ActivePowerup[] = [];
  private readonly turboEntry: ActivePowerup = {
    type: 'turbo',
    remaining: 0,
    duration: 0,
  };
  private readonly gripEntry: ActivePowerup = {
    type: 'grip',
    remaining: 0,
    duration: 0,
  };

  private readonly ringGeometry: THREE.TorusGeometry;
  private readonly coreGeometry: THREE.OctahedronGeometry;
  private readonly materialsByType: Record<
    PowerupType,
    { ring: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial }
  >;

  constructor(track: Track, tuning: PowerupTuning = POWERUP_TUNING) {
    this.track = track;
    this.tuning = tuning;
    this.group.name = 'powerups';

    this.ringGeometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 6, 20);
    this.coreGeometry = new THREE.OctahedronGeometry(CORE_RADIUS, 0);
    this.geometries.push(this.ringGeometry, this.coreGeometry);

    this.materialsByType = {
      turbo: this.createMaterials('turbo'),
      grip: this.createMaterials('grip'),
    };

    for (const def of track.def.powerups) {
      this.items.push(
        this.createPickup(def.type, def.s, def.u, def.pathId ?? 0),
      );
    }

    const turbo = this.items.filter((item) => item.type === 'turbo').length;
    const grip = this.items.filter((item) => item.type === 'grip').length;
    console.info(
      `[Powerups] ${this.items.length} pickups (${turbo} turbo, ${grip} grip).`,
    );
  }

  /** Anima os pickups (rotação/bob) sem mexer nos timers. Usado em READY. */
  animate(dt: number): void {
    if (dt <= 0) {
      return;
    }

    this.elapsed += dt;
    for (const item of this.items) {
      if (!item.root.visible) {
        continue;
      }

      const t = this.elapsed + item.phase;
      item.root.position.y =
        item.groundY + HOVER_HEIGHT + Math.sin(t * 1.9) * BOB_AMPLITUDE;
      item.halo.rotation.x = Math.sin(t * 1.1) * 0.14;
      item.halo.rotation.z = Math.cos(t * 0.9) * 0.14;
      item.core.rotation.y = t * 2.2;
      item.core.rotation.x = t * 1.4;
      item.core.scale.setScalar(1 + Math.sin(t * 3.1) * 0.08);
    }
  }

  /** Avança timers e animação. Chamado só em RUNNING. */
  update(dt: number): void {
    if (dt <= 0) {
      return;
    }

    this.animate(dt);

    if (this.turboRemaining > 0) {
      this.turboRemaining = Math.max(0, this.turboRemaining - dt);
    }
    if (this.gripRemaining > 0) {
      this.gripRemaining = Math.max(0, this.gripRemaining - dt);
    }
  }

  /**
   * Coleta o primeiro pickup ativo ao alcance horizontal do carro.
   * Retorna o tipo coletado (e ativa/renova o timer) ou `null`.
   */
  checkCollect(position: THREE.Vector3): PowerupType | null {
    for (const item of this.items) {
      if (item.collected) {
        continue;
      }

      const dx = position.x - item.x;
      const dz = position.z - item.z;
      if (dx * dx + dz * dz > COLLECT_RADIUS_SQ) {
        continue;
      }

      // No ar alto o carro passa por cima sem pegar.
      if (Math.abs(position.y - item.groundY) > COLLECT_HEIGHT) {
        continue;
      }

      item.collected = true;
      item.root.visible = false;
      this.activate(item.type);
      return item.type;
    }

    return null;
  }

  /** Ativa ou renova o timer do tipo; tipos diferentes coexistem. */
  collect(type: PowerupType): void {
    this.activate(type);
  }

  getModifiers(): PowerupModifiers {
    this.modifiers.maxSpeedMultiplier =
      this.turboRemaining > 0 ? this.tuning.turboSpeedMultiplier : 1;
    this.modifiers.accelerationMultiplier =
      this.turboRemaining > 0 ? this.tuning.turboAccelerationMultiplier : 1;
    this.modifiers.gripMultiplier =
      this.gripRemaining > 0 ? this.tuning.gripMultiplier : 1;
    return this.modifiers;
  }

  isActive(type: PowerupType): boolean {
    return type === 'turbo' ? this.turboRemaining > 0 : this.gripRemaining > 0;
  }

  /**
   * Lista pequena para o HUD. O array e as entradas são reutilizados; o HUD
   * deve ler os valores na hora e não guardar referência.
   */
  getActive(): readonly ActivePowerup[] {
    let count = 0;

    if (this.turboRemaining > 0) {
      this.turboEntry.remaining = this.turboRemaining;
      this.turboEntry.duration = Math.max(this.tuning.turboDuration, 0.001);
      this.activeBuffer[count] = this.turboEntry;
      count += 1;
    }

    if (this.gripRemaining > 0) {
      this.gripEntry.remaining = this.gripRemaining;
      this.gripEntry.duration = Math.max(this.tuning.gripDuration, 0.001);
      this.activeBuffer[count] = this.gripEntry;
      count += 1;
    }

    this.activeBuffer.length = count;
    return this.activeBuffer;
  }

  /** Zera os timers sem restaurar os pickups (usado na chegada). */
  clearEffects(): void {
    this.turboRemaining = 0;
    this.gripRemaining = 0;
    this.activeBuffer.length = 0;
  }

  /** Restaura todos os pickups e zera timers (reinício/teleporte). */
  reset(): void {
    this.clearEffects();
    this.elapsed = 0;

    for (const item of this.items) {
      item.collected = false;
      item.root.visible = true;
      item.root.position.y = item.groundY + HOVER_HEIGHT;
      item.halo.rotation.x = 0;
      item.halo.rotation.z = 0;
      item.core.rotation.set(0, 0, 0);
      item.core.scale.setScalar(1);
    }
  }

  getCount(): number {
    return this.items.length;
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
    this.items.length = 0;
  }

  private activate(type: PowerupType): void {
    if (type === 'turbo') {
      this.turboRemaining = Math.max(this.tuning.turboDuration, 0);
    } else {
      this.gripRemaining = Math.max(this.tuning.gripDuration, 0);
    }
  }

  private createMaterials(type: PowerupType): {
    ring: THREE.MeshBasicMaterial;
    core: THREE.MeshBasicMaterial;
  } {
    const palette = COLORS[type];
    const ring = new THREE.MeshBasicMaterial({
      color: palette.ring,
      toneMapped: false,
    });
    const core = new THREE.MeshBasicMaterial({
      color: palette.core,
      toneMapped: false,
    });

    this.materials.push(ring, core);
    return { ring, core };
  }

  private createPickup(
    type: PowerupType,
    s: number,
    u: number,
    pathId: number,
  ): Pickup {
    // pathId inválido cai na pista principal em vez de quebrar o pickup.
    const resolvedPathId =
      pathId > 0 && this.track.branches[pathId - 1] ? pathId : 0;
    const pathLength = this.track.pathLength(resolvedPathId);
    const clampedS = clamp(s, 0, pathLength);
    const sample = this.track.sampleAtPath(resolvedPathId, clampedS);
    const x = sample.position.x + sample.right.x * u;
    const z = sample.position.z + sample.right.z * u;
    // A largura/altura vêm do caminho local (rota ou principal).
    const groundY = this.pathHeightAt(resolvedPathId, clampedS, u);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    const materials = this.materialsByType[type];

    const root = new THREE.Group();
    root.name =
      resolvedPathId > 0
        ? `powerup-${type}-p${resolvedPathId}-${clampedS.toFixed(0)}`
        : `powerup-${type}-${clampedS.toFixed(0)}`;
    root.position.set(x, groundY + HOVER_HEIGHT, z);
    root.rotation.y = heading;

    // Anel deitado (plano horizontal), com leve balanço no `animate`.
    const halo = new THREE.Group();
    const ring = new THREE.Mesh(this.ringGeometry, materials.ring);
    ring.rotation.x = -Math.PI * 0.5;
    halo.add(ring);
    root.add(halo);

    // Núcleo low poly girado no `animate`; dá leitura mesmo de longe.
    const core = new THREE.Mesh(this.coreGeometry, materials.core);
    root.add(core);

    this.group.add(root);

    return {
      type,
      pathId: resolvedPathId,
      s: clampedS,
      u,
      x,
      z,
      groundY,
      root,
      halo,
      core,
      phase: clampedS * 0.07,
      collected: false,
    };
  }

  /**
   * Altura do chão no caminho. `Track.heightAtPath` indexa os ramos por
   * `pathId` e não por `pathId - 1`, então usamos o ramo diretamente quando
   * o caminho é alternativo; na principal delega para `heightAt`.
   */
  private pathHeightAt(pathId: number, s: number, u: number): number {
    const branch = pathId > 0 ? this.track.branches[pathId - 1] : undefined;
    return branch ? branch.heightAt(s, u) : this.track.heightAt(s, u);
  }
}
