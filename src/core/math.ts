/** Utilidades matemáticas pequenas e sem dependências. */

export const TAU = Math.PI * 2;

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

/** Normaliza um ângulo para o intervalo (-PI, PI]. */
export function wrapAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % TAU + TAU) % TAU;
  return wrapped - Math.PI;
}

/** Menor diferença angular de `from` até `to`, em (-PI, PI]. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Interpolação angular pelo caminho mais curto. */
export function lerpAngle(from: number, to: number, alpha: number): number {
  return wrapAngle(from + shortestAngleDelta(from, to) * alpha);
}

/** Suaviza um ângulo até o alvo com constante de tempo `tau`. */
export function dampAngle(current: number, target: number, tau: number, dt: number): number {
  return lerpAngle(current, target, dampAlpha(tau, dt));
}

export function signOrZero(value: number, epsilon = 1e-4): number {
  if (value > epsilon) {
    return 1;
  }
  if (value < -epsilon) {
    return -1;
  }
  return 0;
}
