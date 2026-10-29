import { clamp } from '../core/math';

/** Distância em que o relevo fora da pista aparece (transição suave). */
const OFFROAD_BLEND_RANGE = 2;
/** Distância em que a amplitude do fora de pista atinge o máximo (ombro). */
const OFFROAD_FULL_DISTANCE = 12;

/**
 * Relevo determinístico do ombro/fora da pista.
 *
 * Duas escalas: ondulações finas (λ ≈ 4–8 m em s, 2–5 m em u) e "costelas"
 * mais grossas, que fazem o carro subir/descer e eventualmente decolar. A
 * amplitude cresce com a distância da borda; a mistura de 2 m mantém a
 * derivada contínua na emenda.
 */
export function offRoadHeightAt(s: number, u: number, distance: number): number {
  const growth = Math.min(distance / OFFROAD_FULL_DISTANCE, 1);
  const blend = smoothstep01(distance / OFFROAD_BLEND_RANGE);

  const fineAmplitude = 0.04 + 0.08 * growth;
  const coarseAmplitude = 0.08 + 0.12 * growth;
  const crossAmplitude = 0.01 + 0.02 * growth;

  const fine =
    Math.sin(s * 0.55 + u * 1.1) * 0.6 +
    Math.sin(s * 0.31 - u * 0.8 + 1.9) * 0.4;
  const coarse =
    Math.sin(s * 0.37 + u * 0.5 + 0.6) * 0.55 +
    Math.sin(s * 0.23 - u * 0.7 + 3.1) * 0.45;
  const cross = Math.sin(u * 1.3 + s * 0.18 + 0.9);

  return (
    blend *
    (fineAmplitude * fine +
      coarseAmplitude * coarse +
      crossAmplitude * cross)
  );
}

export function smoothstep01(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
