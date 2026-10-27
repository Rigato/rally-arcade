/** Utilidades matemáticas pequenas e sem dependências. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Fator de interpolação estável para suavização exponencial independente de FPS. */
export function dampAlpha(tau: number, dt: number): number {
  return 1 - Math.exp(-dt / Math.max(tau, 0.0001));
}
