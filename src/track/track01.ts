import type { TrackDef } from '../game/types';

/**
 * Pista fixa v2 — ~1 km, quatro setores intercalados floresta/deserto.
 *
 * Layout visto de cima (heading 0 = +Z, +X = direita). O traçado é um circuito
 * didático, sem hairpins: quatro curvas de 90° com raio de 50 m e pernas
 * paralelas separadas por ~270 m, espaço de sobra para os ombros de 12 m.
 *
 *   perna norte (x = 0) ─── curva NE ─── perna leste (z = 260)
 *        ↑                                     ↓
 *   curva NO                               curva SE
 *        ↑                                     ↓
 *   perna oeste (z = -30) ─ curva SO ─── perna sul (x = 270)
 *
 * - Setor 1 (0–250 m): floresta, cascalho. Sobe ~10 m em rampa de 5%.
 * - Setor 2 (250–500 m): deserto, areia. Desce até o nível de largada.
 * - Setor 3 (500–750 m): floresta, cascalho. Desce e encara o segundo salto.
 * - Setor 4 (750–fim): deserto, areia. Sobe de volta ao ponto de largada.
 *
 * Rampas: duas de 1,2 m de altura por 6,5 m de comprimento, sempre em reta
 * longa (≥ 110 m de pouso/run-out antes da próxima curva). Os turbos ficam
 * depois do pouso, nunca antes da rampa.
 */
export const TRACK_01: TrackDef = {
  id: 'track01',
  points: [
    { x: 0, z: 20, y: 0, width: 12 }, // largada
    { x: 0, z: 70, y: 2.5, width: 12 },
    { x: 0, z: 120, y: 5, width: 11.5 },
    { x: 0, z: 140, y: 6, width: 11 }, // início do platô
    { x: 0, z: 170, y: 6, width: 11 }, // platô (rampa 1 em s≈128)
    { x: 0, z: 185, y: 7.2, width: 11 }, // crista curta de 8%
    { x: 0, z: 210, y: 7.4, width: 11 },
    { x: 1.7, z: 222.94, y: 7.1, width: 11 },
    { x: 6.7, z: 235, y: 6.7, width: 11 },
    { x: 14.64, z: 245.36, y: 6.6, width: 11 },
    { x: 25, z: 253.3, y: 6.5, width: 11 },
    { x: 37.06, z: 258.3, y: 6.45, width: 11 },
    { x: 50, z: 260, y: 6.4, width: 11 },
    { x: 90, z: 260, y: 6, width: 10.5 },
    { x: 130, z: 263, y: 5.5, width: 10.5 },
    { x: 170, z: 263, y: 5, width: 10.5 },
    { x: 210, z: 260, y: 4.6, width: 11 },
    { x: 220, z: 260, y: 4.4, width: 11 },
    { x: 232.94, z: 258.3, y: 4.3, width: 11 },
    { x: 245, z: 253.3, y: 4.2, width: 11 },
    { x: 255.36, z: 245.36, y: 4.1, width: 11 },
    { x: 263.3, z: 235, y: 4, width: 11 },
    { x: 268.3, z: 222.94, y: 3.7, width: 11 },
    { x: 270, z: 210, y: 3.4, width: 11 },
    { x: 270, z: 170, y: 3, width: 11 },
    { x: 270, z: 130, y: 2.6, width: 11 },
    { x: 270, z: 95, y: 2.1, width: 11 },
    { x: 270, z: 60, y: 1.4, width: 11 },
    { x: 270, z: 20, y: 0.8, width: 11 },
    { x: 268.3, z: 7.06, y: 0.7, width: 11 },
    { x: 263.3, z: -5, y: 0.6, width: 11 },
    { x: 255.36, z: -15.36, y: 0.5, width: 11 },
    { x: 245, z: -23.3, y: 0.4, width: 11 },
    { x: 232.94, z: -28.3, y: 0.2, width: 11 },
    { x: 220, z: -30, y: 0, width: 11 },
    { x: 180, z: -30, y: 0.15, width: 11 },
    { x: 140, z: -30, y: 0.35, width: 11 },
    { x: 100, z: -30, y: 0.55, width: 11.5 },
    { x: 60, z: -30, y: 0.75, width: 12 },
    { x: 50, z: -30, y: 0.85, width: 12 },
    { x: 37.06, z: -28.3, y: 0.85, width: 12 },
    { x: 25, z: -23.3, y: 0.72, width: 12 },
    { x: 14.64, z: -15.36, y: 0.6, width: 12 },
    { x: 6.7, z: -5, y: 0.46, width: 12 },
    { x: 1.7, z: 7.06, y: 0.24, width: 12 },
    { x: 0, z: 20, y: 0, width: 12 },
  ],
  zones: [
    { start: 0, end: 250, id: 'forest', surface: 'gravel' },
    { start: 250, end: 500, id: 'desert', surface: 'sand' },
    { start: 500, end: 750, id: 'forest', surface: 'gravel' },
    // `end` é aproximado; o Track trata a última zona até o fim real da spline.
    { start: 750, end: 1100, id: 'desert', surface: 'sand' },
  ],
  kickers: [
    // Reta norte: sobe a 5% e termina em reta plana por 63 m até a curva NE.
    { s: 128, length: 6.5, height: 1.2 },
    // Reta sul: pouso e run-out de ~120 m até a curva SO.
    { s: 580, length: 6.5, height: 1.2 },
  ],
  obstacles: [],
  powerups: [
    // Grip na reta de largada, antes da rampa (s = 120).
    { type: 'grip', s: 60, u: -1.2 },
    // Turbo depois do pouso da rampa 1, ainda na reta norte.
    { type: 'turbo', s: 160, u: 1.6 },
    // Grip no fim da perna leste, 18 m antes da curva SE.
    { type: 'grip', s: 420, u: 1.2 },
    // Turbo depois do pouso da rampa 2, na reta sul.
    { type: 'turbo', s: 610, u: -1.6 },
    // Grip 17 m antes da curva SO.
    { type: 'grip', s: 690, u: 1.2 },
    // Turbo na reta oeste, longe de rampas e curvas próximas.
    { type: 'turbo', s: 850, u: -1.6 },
  ],
  splits: [
    { s: 250, name: 'Parcial 1', target: 13.5 },
    { s: 500, name: 'Parcial 2', target: 27.0 },
    { s: 750, name: 'Parcial 3', target: 40.5 },
  ],
  medals: { gold: 55, silver: 62, bronze: 72 },
};
