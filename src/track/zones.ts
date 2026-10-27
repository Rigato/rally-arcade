import { clamp } from '../core/math';
import type { TrackZone } from '../game/types';

export type ZoneId = 'forest' | 'desert';

/** Mistura de paletas entre duas zonas vizinhas. */
export interface ZoneBlend {
  /** Índice da zona de origem na lista de zonas. */
  readonly from: number;
  /** Índice da zona de destino (igual a `from` fora das transições). */
  readonly to: number;
  /** 0 = totalmente `from`, 1 = totalmente `to`. */
  readonly t: number;
}

/** Zona ativa em `s` (a última zona vale até o fim da spline). */
export function zoneIndexAt(zones: readonly TrackZone[], s: number): number {
  for (let i = 0; i < zones.length; i += 1) {
    if (s >= zones[i].start && s < zones[i].end) {
      return i;
    }
  }

  return Math.max(0, zones.length - 1);
}

/**
 * Mistura suave em volta de cada limite de setor. Fora dos limites o retorno
 * é `from === to`; perto de um limite `t` vai de 0 a 1 em `2 * range` metros,
 * com derivada zero nas pontas (sem emenda visível).
 */
export function zoneBlendAt(
  zones: readonly TrackZone[],
  s: number,
  range = 15,
): ZoneBlend {
  if (zones.length === 0) {
    return { from: 0, to: 0, t: 0 };
  }

  const clamped = clamp(s, 0, zones[zones.length - 1].end);

  for (let i = 1; i < zones.length; i += 1) {
    const boundary = zones[i].start;
    if (clamped >= boundary - range && clamped <= boundary + range) {
      const raw = clamp((clamped - (boundary - range)) / (range * 2), 0, 1);
      return { from: i - 1, to: i, t: smoothstep01(raw) };
    }
  }

  const index = zoneIndexAt(zones, clamped);
  return { from: index, to: index, t: 0 };
}

export function smoothstep01(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
