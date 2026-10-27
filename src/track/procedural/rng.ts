/**
 * PRNG determinístico (mulberry32) para o gerador procedural.
 *
 * A mesma seed produz exatamente a mesma sequência. Nada aqui depende de
 * `Math.random`, tempo ou estado global.
 */

export interface Rng {
  /** Próximo float em [0, 1). */
  next(): number;
  /** Float em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro em [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Sorteia um item de uma lista não vazia. */
  pick<T>(items: readonly T[]): T;
  /** `true` com probabilidade `p`. */
  chance(p: number): boolean;
  /** Sinal aleatório: -1 ou +1. */
  sign(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}
