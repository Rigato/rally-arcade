import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type {
  SurfaceId,
  TrackForkBranch,
  TrackKicker,
  TrackPoint,
  TrackZone,
} from '../game/types';
import { offRoadHeightAt } from './terrainNoise';
import type { TrackZoneId } from './Track';

const SAMPLE_STEP = 1;
const MIN_WIDTH = 4.2;
const MAX_WIDTH = 10;

export interface BranchSample {
  s: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  width: number;
  y: number;
  zone: TrackZoneId;
}

export interface BranchProjection {
  s: number;
  u: number;
  distance: number;
}

/**
 * Sampler de um ramo de bifurcação.
 *
 * No v1/v2 é o desvio antigo: começa/termina na borda da pista principal e
 * só o lado externo tem ombro. No v3 (`kind: 'route'`) é uma rota completa,
 * com zonas locais, kickers e ombros dos dois lados.
 */
export class TrackBranch {
  readonly id: string;
  /** `s` da pista principal no início/fim. */
  readonly startS: number;
  readonly endS: number;
  readonly length: number;
  readonly step: number;
  readonly sampleCount: number;
  readonly width: number;
  readonly side: 1 | -1;
  readonly kind: 'legacy' | 'route';
  readonly zones: readonly TrackZone[];
  readonly kickers: readonly TrackKicker[];
  /** Mantidos para compatibilidade com HUD/debug e fallback de piso. */
  readonly surface: SurfaceId;
  readonly offroad: SurfaceId;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly tz: Float32Array;
  private readonly widths: Float32Array;

  private readonly sampleOut: BranchSample = {
    s: 0,
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    width: MIN_WIDTH,
    y: 0,
    zone: 'forest',
  };
  private readonly projection: BranchProjection = { s: 0, u: 0, distance: 0 };

  constructor(
    branch: TrackForkBranch,
    zones: readonly TrackZone[],
    kickers: readonly TrackKicker[] = [],
  ) {
    this.id = branch.id;
    this.startS = branch.startS;
    this.endS = branch.endS;
    this.kind = branch.kind ?? 'legacy';
    this.zones = zones;
    this.kickers = kickers;
    this.surface = zones[0]?.surface ?? 'gravel';
    this.offroad = zones[0]?.offroad ?? 'forest-offroad';
    this.width = branch.width;
    this.side = branch.side ?? 1;

    const points = branch.points.length >= 2
      ? branch.points
      : [
          { x: 0, z: 0, y: 0, width: branch.width },
          { x: 0, z: 1, y: 0, width: branch.width },
        ];

    const curve = new THREE.CatmullRomCurve3(
      points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
      false,
      'centripetal',
    );

    this.length = curve.getLength();
    this.sampleCount = Math.max(2, Math.ceil(this.length / SAMPLE_STEP));
    this.step = this.length / this.sampleCount;
    const count = this.sampleCount + 1;

    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.ty = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.widths = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const u = i / this.sampleCount;
      const point = curve.getPointAt(u);
      const tangent = curve.getTangentAt(u).normalize();

      this.px[i] = point.x;
      this.py[i] = point.y;
      this.pz[i] = point.z;
      this.tx[i] = tangent.x;
      this.ty[i] = tangent.y;
      this.tz[i] = tangent.z;
    }

    const controlS = this.controlSamples(points, curve);
    for (let i = 0; i < count; i += 1) {
      this.widths[i] = this.widthAtSample(i * this.step, points, controlS);
    }
  }

  sampleAt(s: number): BranchSample {
    const clamped = clamp(s, 0, this.length);
    const f = clamped / this.step;
    const i = clamp(Math.floor(f), 0, this.sampleCount);
    const j = Math.min(i + 1, this.sampleCount);
    const t = clamp(f - i, 0, 1);

    const out = this.sampleOut;
    out.s = clamped;
    out.position.set(
      lerp(this.px[i], this.px[j], t),
      lerp(this.py[i], this.py[j], t),
      lerp(this.pz[i], this.pz[j], t),
    );
    out.tangent.set(
      lerp(this.tx[i], this.tx[j], t),
      lerp(this.ty[i], this.ty[j], t),
      lerp(this.tz[i], this.tz[j], t),
    );

    if (out.tangent.lengthSq() < 1e-8) {
      out.tangent.set(0, 0, 1);
    } else {
      out.tangent.normalize();
    }

    const horizontal = Math.hypot(out.tangent.x, out.tangent.z) || 1;
    out.right.set(out.tangent.z / horizontal, 0, -out.tangent.x / horizontal);
    out.width = this.widthAt(clamped);
    out.y = out.position.y;
    out.zone = this.zoneAt(clamped);

    return out;
  }

  widthAt(s: number): number {
    const clamped = clamp(s, 0, this.length);
    const f = clamped / this.step;
    const i = clamp(Math.floor(f), 0, this.sampleCount);
    const j = Math.min(i + 1, this.sampleCount);
    const t = clamp(f - i, 0, 1);
    return lerp(this.widths[i], this.widths[j], t);
  }

  heightAt(s: number, u: number): number {
    const clamped = clamp(s, 0, this.length);
    const f = clamped / this.step;
    const i = clamp(Math.floor(f), 0, this.sampleCount);
    const j = Math.min(i + 1, this.sampleCount);
    const t = clamp(f - i, 0, 1);

    const baseY = lerp(this.py[i], this.py[j], t) + this.kickerHeightAt(clamped);

    const distance = Math.abs(u) - this.widthAt(clamped) * 0.5;
    if (distance <= 0) {
      return baseY;
    }

    if (this.kind === 'route') {
      // Rota completa: o ombro interno existe no miolo do fork. Perto da
      // entrada/saída ele fica plano para encostar na pista principal.
      const blend =
        smoothstep(clamp(clamped / 28, 0, 1)) *
        smoothstep(clamp((this.length - clamped) / 28, 0, 1));
      if (u * this.side < 0) {
        return baseY + offRoadHeightAt(clamped, u, distance) * blend;
      }
      return baseY + offRoadHeightAt(clamped, u, distance);
    }

    // Ramo legado: o lado interno encosta na pista principal e continua plano.
    if (u * this.side < 0) {
      return baseY;
    }

    return baseY + offRoadHeightAt(clamped, u, distance);
  }

  zoneAt(s: number): TrackZoneId {
    const clamped = clamp(s, 0, this.length);
    for (const zone of this.zones) {
      if (clamped >= zone.start && clamped < zone.end) {
        return zone.id;
      }
    }
    return this.zones[this.zones.length - 1]?.id ?? 'forest';
  }

  heightAtWorld(x: number, z: number, hintS?: number): number {
    const projection = this.project(x, z, hintS);
    return this.heightAt(projection.s, projection.u);
  }

  surfaceAt(s: number, u: number): SurfaceId {
    const half = this.widthAt(s) * 0.5;
    // Lado interno = pista principal; nunca reportar off-road ali (legado).
    if (this.kind !== 'route' && u * this.side <= half) {
      return this.surface;
    }
    if (Math.abs(u) <= half + 0.35) {
      return this.zoneSurfaceAt(s).surface;
    }
    return this.zoneSurfaceAt(s).offroad ?? this.offroad;
  }

  private zoneSurfaceAt(s: number): { surface: SurfaceId; offroad?: SurfaceId } {
    const clamped = clamp(s, 0, this.length);
    for (const zone of this.zones) {
      if (clamped >= zone.start && clamped < zone.end) {
        return zone;
      }
    }
    return this.zones[this.zones.length - 1] ?? {
      surface: this.surface,
      offroad: this.offroad,
    };
  }

  private kickerHeightAt(s: number): number {
    let total = 0;
    for (const kicker of this.kickers) {
      const local = s - kicker.s;
      if (local < 0 || local > kicker.length) {
        continue;
      }
      const t = local / kicker.length;
      total += kicker.height * t * t;
    }
    return total;
  }

  project(x: number, z: number, hintS?: number): BranchProjection {
    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    if (hintS !== undefined && Number.isFinite(hintS)) {
      const center = clamp(Math.round(hintS / this.step), 0, this.sampleCount);
      const from = Math.max(0, center - 24);
      const to = Math.min(this.sampleCount, center + 24);

      for (let i = from; i <= to; i += 1) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistanceSq) {
          bestDistanceSq = distance;
          bestIndex = i;
        }
      }
    }

    if (bestIndex < 0 || bestDistanceSq > 30 * 30) {
      bestIndex = 0;
      bestDistanceSq = Infinity;

      for (let i = 0; i <= this.sampleCount; i += 1) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistanceSq) {
          bestDistanceSq = distance;
          bestIndex = i;
        }
      }
    }

    let bestS = bestIndex * this.step;
    let bestU = 0;
    let bestSegmentDistanceSq = Infinity;

    for (let segment = bestIndex - 1; segment <= bestIndex; segment += 1) {
      const a = segment;
      const b = segment + 1;
      if (a < 0 || b > this.sampleCount) {
        continue;
      }

      const ax = this.px[a];
      const az = this.pz[a];
      const dx = this.px[b] - ax;
      const dz = this.pz[b] - az;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-8) {
        continue;
      }

      const t = clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
      const cx = ax + dx * t;
      const cz = az + dz * t;
      const distanceSq = (x - cx) * (x - cx) + (z - cz) * (z - cz);

      if (distanceSq < bestSegmentDistanceSq) {
        const inverseLength = 1 / Math.sqrt(lengthSq);
        const rx = dz * inverseLength;
        const rz = -dx * inverseLength;

        bestSegmentDistanceSq = distanceSq;
        bestS = (a + t) * this.step;
        bestU = (x - cx) * rx + (z - cz) * rz;
      }
    }

    this.projection.s = clamp(bestS, 0, this.length);
    this.projection.u = bestU;
    this.projection.distance = Math.sqrt(bestSegmentDistanceSq);
    return this.projection;
  }

  private controlSamples(
    points: readonly TrackPoint[],
    curve: THREE.CatmullRomCurve3,
  ): readonly number[] {
    const lengths = points.map(() => 0);
    let cumulative = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      cumulative += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      lengths[i] = cumulative;
    }

    // A spline Catmull-Rom não passa exatamente pelo comprimento acumulado
    // dos pontos de controle; normaliza para o comprimento real.
    const total = Math.max(1e-6, cumulative);
    const scale = curve.getLength() / total;
    return lengths.map((value) => value * scale);
  }

  private widthAtSample(
    s: number,
    points: readonly TrackPoint[],
    controlS: readonly number[],
  ): number {
    if (points.length === 1) {
      return clamp(points[0].width, MIN_WIDTH, MAX_WIDTH);
    }

    for (let i = 1; i < points.length; i += 1) {
      if (s <= controlS[i]) {
        const span = controlS[i] - controlS[i - 1];
        const t = span > 1e-6 ? (s - controlS[i - 1]) / span : 0;
        return clamp(
          lerp(points[i - 1].width, points[i].width, t),
          MIN_WIDTH,
          MAX_WIDTH,
        );
      }
    }

    return clamp(points[points.length - 1].width, MIN_WIDTH, MAX_WIDTH);
  }
}

function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
