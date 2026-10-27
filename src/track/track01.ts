import type { TrackDef } from '../game/types';

/**
 * Pista fixa do MVP — ~800 m, dois cenários e dois hairpins.
 *
 * Layout visto de cima (heading 0 = +Z, +X = direita):
 *
 *  perna A (norte)   perna B (sul)    perna C (norte)
 *  x ≈ 0             x ≈ 28           x ≈ 56
 *       ↑                 ↓                 ↑
 *       └── hairpin 1 ────┘                 │
 *                          └── hairpin 2 ───┘
 *
 * - Floresta (cascalho) do início até s = 300 m.
 * - Deserto (areia) de s = 300 m até o fim.
 * - Dois kickers de 8 m com 2,2 m de altura, em trechos retos:
 *   s ≈ 140 m (perna A) e s ≈ 620 m (perna C).
 *
 * A elevação sobe e desce ~10 m no total. Os valores de `y` são suaves
 * entre pontos vizinhos para o Catmull-Rom centrípeto não oscilar.
 */
export const TRACK_01: TrackDef = {
  id: 'track01',
  points: [
    // Perna A — subida suave rumo ao primeiro hairpin.
    { x: 0, z: 0, y: 0.5, width: 14 },
    { x: 0, z: 40, y: 2, width: 13 },
    { x: 3, z: 80, y: 3.5, width: 12 },
    { x: 5, z: 120, y: 5, width: 11 },
    { x: 2, z: 160, y: 6.5, width: 10 },
    { x: 0, z: 200, y: 7.5, width: 9 },
    { x: 0, z: 230, y: 7, width: 8 },

    // Hairpin 1 — semicírculo de raio 14 em torno de (14, 230).
    { x: 4.1, z: 240.1, y: 6, width: 8 },
    { x: 14, z: 244, y: 5, width: 8 },
    { x: 23.9, z: 240.1, y: 4, width: 8 },
    { x: 28, z: 230, y: 3.5, width: 9 },

    // Perna B — descida para o sul.
    { x: 28, z: 200, y: 3, width: 10 },
    { x: 30, z: 160, y: 2, width: 11 },
    { x: 33, z: 120, y: 0.5, width: 10 },
    { x: 30, z: 80, y: -1, width: 9 },
    { x: 28, z: 50, y: 0, width: 8 },

    // Hairpin 2 — semicírculo de raio 14 em torno de (42, 50).
    { x: 32.1, z: 39.9, y: 1, width: 8 },
    { x: 42, z: 36, y: 1.5, width: 8 },
    { x: 51.9, z: 39.9, y: 2, width: 8 },
    { x: 56, z: 50, y: 2.5, width: 9 },

    // Perna C — subida até o ponto mais alto e descida até a chegada.
    { x: 56, z: 80, y: 3.5, width: 10 },
    { x: 58, z: 120, y: 5, width: 12 },
    { x: 55, z: 160, y: 7, width: 12 },
    { x: 56, z: 200, y: 8.5, width: 13 },
    { x: 58, z: 240, y: 9, width: 13 },
    { x: 56, z: 280, y: 7, width: 12 },
    { x: 56, z: 320, y: 4.5, width: 11 },
    { x: 56, z: 350, y: 2.5, width: 10 },
  ],
  zones: [
    { start: 0, end: 300, id: 'forest', surface: 'gravel' },
    // `end` é aproximado; o Track trata a última zona até o fim real da spline.
    { start: 300, end: 800, id: 'desert', surface: 'sand' },
  ],
  kickers: [
    // Reta da perna A, antes do hairpin 1.
    { s: 140, length: 8, height: 2.2 },
    // Reta da perna C, depois do hairpin 2.
    { s: 620, length: 8, height: 2.2 },
  ],
  obstacles: [],
  powerups: [
    // Turbo na reta da floresta, à direita do centro (fora da linha ideal e
    // 20 m antes do kicker de s = 140, que fica em trecho reto).
    { type: 'turbo', s: 120, u: 1.6 },
    // Grip na aproximação do hairpin 1 (s ≈ 241), à esquerda do centro.
    { type: 'grip', s: 200, u: -1.2 },
    // Grip antes do hairpin 2 (s ≈ 466), à direita do centro.
    { type: 'grip', s: 440, u: 1.2 },
    // Turbo na reta do deserto, à esquerda do centro e 20 m antes do kicker
    // de s = 620.
    { type: 'turbo', s: 600, u: -1.6 },
  ],
  splits: [{ s: 300, name: 'Parcial 1', target: 21 }],
  medals: { gold: 43, silver: 49, bronze: 57 },
};
