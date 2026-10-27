import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type { SurfaceId, TrackDef, TrackZone } from '../game/types';
import { TRACK_01 } from './track01';

const SAMPLE_STEP = 1;
const MIN_WIDTH = 7;
const MAX_WIDTH = 14;
/** Margem lateral que ainda conta como pista para a física. */
const TRACK_MARGIN = 0.35;
const PROJECT_HINT_RADIUS = 20;
/** Acima disso a busca local é considerada perdida (pernas paralelas ficam a 28 m). */
const PROJECT_GLOBAL_FALLBACK = 24;
const VALIDATION_SELF_INTERSECTION_WINDOW = 40;
const KICKER_LANDING_CHECK = 20;
const KICKER_STRAIGHT_LIMIT = 0.35;
const DEFAULT_START_S = 22;

export type TrackZoneId = 'forest' | 'desert';

export interface TrackSample {
  s: number;
  position: THREE.Vector3;
  /** Tangente 3D normalizada (inclui a inclinação). */
  tangent: THREE.Vector3;
  /** Perpendicular horizontal, positiva à direita da pista. */
  right: THREE.Vector3;
  width: number;
  y: number;
  zone: TrackZoneId;
}

export interface TrackProjection {
  s: number;
  /** Posição lateral: positiva à direita, negativa à esquerda. */
  u: number;
  /** Distância horizontal até o centro da pista. */
  distance: number;
}

export interface TrackPose {
  position: THREE.Vector3;
  heading: number;
}

interface MutableSample extends TrackSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
}

/**
 * Sampler da pista autorada.
 *
 * A spline é amostrada a cada ~1 m e guardada em arrays planos. A malha
 * (`TrackMesh`) e a física do carro leem exatamente a mesma `heightAt`, então
 * não existe divergência entre o visual e o chão.
 */
export class Track {
  readonly def: TrackDef;
  readonly length: number;
  readonly step: number;
  readonly sampleCount: number;
  readonly startS: number;
  readonly startPose: TrackPose;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly tz: Float32Array;
  private readonly widths: Float32Array;
  private readonly kickerHeights: Float32Array;

  private readonly controlS: number[] = [];
  private readonly controlWidth: number[] = [];
  private readonly zones: readonly TrackZone[];

  private readonly sampleOut: MutableSample = {
    s: 0,
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    width: MIN_WIDTH,
    y: 0,
    zone: 'forest',
  };
  private readonly projection: TrackProjection = { s: 0, u: 0, distance: 0 };
  private readonly heightProjection: TrackProjection = { s: 0, u: 0, distance: 0 };

  constructor(def: TrackDef = TRACK_01) {
    this.def = def;
    this.zones = def.zones;

    const curve = new THREE.CatmullRomCurve3(
      def.points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
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
    this.kickerHeights = new Float32Array(count);

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

    this.buildControlWidths();
    for (let i = 0; i < count; i += 1) {
      this.widths[i] = this.widthAt(i * this.step);
      this.kickerHeights[i] = this.kickerHeightAt(i * this.step);
    }

    this.startS = clamp(DEFAULT_START_S, 0, this.length);
    const start = this.sampleAt(this.startS);
    this.startPose = {
      position: new THREE.Vector3(
        start.position.x,
        this.heightAt(this.startS, 0),
        start.position.z,
      ),
      heading: Math.atan2(start.tangent.x, start.tangent.z),
    };

    this.validate();
  }

  /** Amostra interpolada em `s` (o objeto retornado é reutilizado). */
  sampleAt(s: number): TrackSample {
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
    const last = this.controlS.length - 1;

    if (clamped <= this.controlS[0]) {
      return clamp(this.controlWidth[0], MIN_WIDTH, MAX_WIDTH);
    }
    if (clamped >= this.controlS[last]) {
      return clamp(this.controlWidth[last], MIN_WIDTH, MAX_WIDTH);
    }

    let index = 0;
    while (index < last && clamped > this.controlS[index + 1]) {
      index += 1;
    }

    const s0 = this.controlS[index];
    const s1 = this.controlS[index + 1];
    const raw = s1 > s0 ? (clamped - s0) / (s1 - s0) : 0;
    const t = raw * raw * (3 - 2 * raw);
    return clamp(
      lerp(this.controlWidth[index], this.controlWidth[index + 1], t),
      MIN_WIDTH,
      MAX_WIDTH,
    );
  }

  zoneAt(s: number): TrackZoneId {
    const clamped = clamp(s, 0, this.length);

    for (let i = 0; i < this.zones.length; i += 1) {
      const zone = this.zones[i];
      if (clamped >= zone.start && clamped < zone.end) {
        return zone.id;
      }
    }

    return this.zones[this.zones.length - 1]?.id ?? 'forest';
  }

  /**
   * Altura do chão na coordenada de pista. O perfil do kicker sobe de forma
   * parabólica e cai abruptamente no lip: por enquanto o carro ainda cola no
   * chão depois da queda; o voo real entra no M3b.
   */
  heightAt(s: number, _u: number): number {
    const clamped = clamp(s, 0, this.length);
    const f = clamped / this.step;
    const i = clamp(Math.floor(f), 0, this.sampleCount);
    const j = Math.min(i + 1, this.sampleCount);
    const t = clamp(f - i, 0, 1);

    const baseY = lerp(this.py[i], this.py[j], t);
    const kicker = lerp(this.kickerHeights[i], this.kickerHeights[j], t);
    return baseY + kicker;
  }

  heightAtWorld(x: number, z: number, hintS?: number): number {
    this.projectInto(x, z, hintS, this.heightProjection);
    return this.heightAt(this.heightProjection.s, this.heightProjection.u);
  }

  /** Projeta um ponto do mundo na pista. Reutiliza o objeto retornado. */
  project(x: number, z: number, hintS?: number): TrackProjection {
    this.projectInto(x, z, hintS, this.projection);
    return this.projection;
  }

  surfaceAt(s: number, u: number): SurfaceId {
    const zone = this.zoneDefAt(s);
    const halfWidth = this.widthAt(s) * 0.5;

    if (Math.abs(u) <= halfWidth + TRACK_MARGIN) {
      return zone.surface;
    }

    return zone.id === 'forest' ? 'forest-offroad' : 'desert-offroad';
  }

  surfaceAtWorld(x: number, z: number, hintS?: number): SurfaceId {
    this.projectInto(x, z, hintS, this.heightProjection);
    return this.surfaceAt(this.heightProjection.s, this.heightProjection.u);
  }

  /**
   * Validação de boot. Só registra avisos: nunca impede o jogo de abrir.
   */
  validate(): void {
    this.validateWidths();
    this.validateSelfIntersection();
    this.validateKickers();

    console.info(
      `[Track] ${this.def.id}: ${this.length.toFixed(1)} m, ` +
        `${this.def.points.length} pontos, ${this.def.zones.length} zonas.`,
    );
  }

  private buildControlWidths(): void {
    for (const point of this.def.points) {
      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i <= this.sampleCount; i += 1) {
        const dx = this.px[i] - point.x;
        const dz = this.pz[i] - point.z;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      this.controlS.push(bestIndex * this.step);
      this.controlWidth.push(clamp(point.width, MIN_WIDTH, MAX_WIDTH));
    }
  }

  private kickerHeightAt(s: number): number {
    let total = 0;

    for (const kicker of this.def.kickers) {
      const local = s - kicker.s;
      if (local < 0 || local > kicker.length) {
        continue;
      }

      const t = local / kicker.length;
      total += kicker.height * t * t;
    }

    return total;
  }

  private zoneDefAt(s: number): TrackZone {
    const clamped = clamp(s, 0, this.length);

    for (let i = 0; i < this.zones.length; i += 1) {
      const zone = this.zones[i];
      if (clamped >= zone.start && clamped < zone.end) {
        return zone;
      }
    }

    return this.zones[this.zones.length - 1];
  }

  private projectInto(
    x: number,
    z: number,
    hintS: number | undefined,
    out: TrackProjection,
  ): void {
    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    if (hintS !== undefined && Number.isFinite(hintS)) {
      const center = clamp(Math.round(hintS / this.step), 0, this.sampleCount);
      const radius = Math.ceil(PROJECT_HINT_RADIUS / this.step);
      const from = Math.max(0, center - radius);
      const to = Math.min(this.sampleCount, center + radius);

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

    // Busca local perdida (teleporte, reset ou carro muito longe): varre tudo.
    if (
      bestIndex < 0 ||
      bestDistanceSq > PROJECT_GLOBAL_FALLBACK * PROJECT_GLOBAL_FALLBACK
    ) {
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

    // Refina nos dois segmentos vizinhos, para s/u contínuos entre amostras.
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

    out.s = clamp(bestS, 0, this.length);
    out.u = bestU;
    out.distance = Math.sqrt(bestSegmentDistanceSq);
  }

  private validateWidths(): void {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i <= this.sampleCount; i += 1) {
      const width = this.widths[i];
      if (width < min) {
        min = width;
      }
      if (width > max) {
        max = width;
      }
    }

    if (min < MIN_WIDTH - 0.01 || max > MAX_WIDTH + 0.01) {
      console.warn(`[Track] Largura fora da faixa ${MIN_WIDTH}..${MAX_WIDTH} m: ${min}..${max}`);
    }
  }

  private validateSelfIntersection(): void {
    const stride = Math.max(1, Math.round(4 / this.step));

    for (let i = 0; i < this.sampleCount; i += stride) {
      const ai = i;
      const bi = Math.min(i + stride, this.sampleCount);
      const sA = ai * this.step;

      for (let j = i + stride; j < this.sampleCount; j += stride) {
        const sB = j * this.step;
        if (Math.abs(sA - sB) < VALIDATION_SELF_INTERSECTION_WINDOW) {
          continue;
        }

        const aj = j;
        const bj = Math.min(j + stride, this.sampleCount);
        if (
          segmentsIntersect(
            this.px[ai],
            this.pz[ai],
            this.px[bi],
            this.pz[bi],
            this.px[aj],
            this.pz[aj],
            this.px[bj],
            this.pz[bj],
          )
        ) {
          console.warn(
            `[Track] Autointerseção entre s=${sA.toFixed(0)} m e s=${sB.toFixed(0)} m.`,
          );
          return;
        }
      }
    }
  }

  private validateKickers(): void {
    for (const kicker of this.def.kickers) {
      const start = kicker.s;
      const end = kicker.s + kicker.length;
      const landingEnd = end + KICKER_LANDING_CHECK;

      if (start < 0 || landingEnd > this.length) {
        console.warn(`[Track] Kicker em s=${start} m não cabe na pista.`);
        continue;
      }

      const entry = this.sampleAt(start);
      const entryHeading = Math.atan2(entry.tangent.x, entry.tangent.z);
      let maxDeviationOnRamp = 0;
      let maxDeviationOnLanding = 0;

      for (let s = start; s <= end; s += this.step) {
        const sample = this.sampleAt(s);
        const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
        maxDeviationOnRamp = Math.max(
          maxDeviationOnRamp,
          Math.abs(shortestAngle(heading, entryHeading)),
        );
      }

      for (let s = end; s <= landingEnd; s += this.step) {
        const sample = this.sampleAt(s);
        const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
        maxDeviationOnLanding = Math.max(
          maxDeviationOnLanding,
          Math.abs(shortestAngle(heading, entryHeading)),
        );
      }

      if (maxDeviationOnRamp > 0.2) {
        console.warn(
          `[Track] Kicker em s=${start} m não está em trecho reto ` +
            `(variação ${maxDeviationOnRamp.toFixed(2)} rad).`,
        );
      }

      if (maxDeviationOnLanding > KICKER_STRAIGHT_LIMIT) {
        console.warn(
          `[Track] Área de pouso do kicker em s=${start} m não está reta ` +
            `(variação ${maxDeviationOnLanding.toFixed(2)} rad).`,
        );
      }
    }
  }
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) {
    delta += Math.PI * 2;
  }
  return delta - Math.PI;
}

function segmentsIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(denominator) < 1e-9) {
    return false;
  }

  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}
