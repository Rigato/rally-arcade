import type { MedalTargets, RaceTuning, TrackSplit } from './types';

export type MedalId = 'gold' | 'silver' | 'bronze';

export interface RaceSplit {
  name: string;
  s: number;
  time: number;
  target: number;
  delta: number;
}

/** Estado de uma parcial no snapshot (pulada = `done` sem `time`). */
export interface RaceSplitResult {
  name: string;
  s: number;
  target: number;
  time: number | null;
  delta: number | null;
  done: boolean;
}

/** Snapshot imutável consumido pelo HUD e pela tela de resultado. */
export interface RaceResult {
  elapsed: number;
  splits: RaceSplitResult[];
  finished: boolean;
  finishedTime: number | null;
  medal: MedalId | null;
  medals: MedalTargets;
  best: number | null;
  newBest: boolean;
}

export interface RaceOptions {
  trackId: string;
  finishS: number;
  /** Parciais autoradas na pista (nome, s e alvo). */
  splits: readonly TrackSplit[];
  /** Objeto mutável de config.ts: o painel pode editar alvo e medalhas ao vivo. */
  tuning: RaceTuning;
}

const BEST_KEY_PREFIX = 'rally.best.';
const BEST_KEY_SUFFIX = '.v1';

/**
 * Relógio e regras de uma corrida.
 *
 * O tempo usa o `dt` fixo da simulação (nunca `performance.now`), então pausar
 * a aba ou parar o loop congela o cronômetro. A recuperação é penalizada pelo
 * `Game`, que continua chamando `tick()` enquanto o estado é RECOVERING.
 */
export class Race {
  readonly finishS: number;
  readonly splits: readonly TrackSplit[];
  readonly tuning: RaceTuning;

  private readonly bestKey: string;
  private best: number | null;

  private elapsedTime = 0;
  private readonly splitTimes: Array<number | null>;
  private readonly splitDeltas: Array<number | null>;
  private readonly splitDone: boolean[];
  private finishedValue = false;
  private finishedTimeValue: number | null = null;
  private medalValue: MedalId | null = null;
  private newBestValue = false;

  constructor(options: RaceOptions) {
    this.tuning = options.tuning;
    this.finishS = options.finishS;
    this.splits = options.splits;
    this.splitTimes = this.splits.map(() => null);
    this.splitDeltas = this.splits.map(() => null);
    this.splitDone = this.splits.map(() => false);
    this.bestKey = `${BEST_KEY_PREFIX}${options.trackId}${BEST_KEY_SUFFIX}`;
    this.best = this.loadBest();
  }

  get elapsed(): number {
    return this.elapsedTime;
  }

  get completedTime(): number | null {
    return this.finishedTimeValue;
  }

  get bestTime(): number | null {
    return this.best;
  }

  /** Avança o relógio. Chamado apenas em RUNNING/RECOVERING. */
  tick(dt: number): void {
    if (this.finishedValue || dt <= 0) {
      return;
    }

    this.elapsedTime += dt;
  }

  /**
   * Registra a próxima parcial ainda não cruzada. Cada parcial é registrada
   * uma única vez; retorna o evento para o HUD mostrar o banner, ou `null`.
   */
  checkSplit(s: number): RaceSplit | null {
    if (this.finishedValue) {
      return null;
    }

    for (let i = 0; i < this.splits.length; i += 1) {
      const split = this.splits[i];
      if (this.splitDone[i] || s < split.s) {
        continue;
      }

      const target = Number.isFinite(split.target)
        ? split.target
        : Number.isFinite(this.tuning.splitTarget)
          ? this.tuning.splitTarget
          : 0;

      this.splitDone[i] = true;
      this.splitTimes[i] = this.elapsedTime;
      this.splitDeltas[i] = this.elapsedTime - target;

      return {
        name: split.name,
        s: split.s,
        time: this.elapsedTime,
        target,
        delta: this.splitDeltas[i] ?? 0,
      };
    }

    return null;
  }

  /**
   * Para o relógio e fecha a medalha ao cruzar a faixa de chegada.
   * Retorna `true` só na transição para FINISHED.
   */
  checkFinish(s: number): boolean {
    if (this.finishedValue || s < this.finishS) {
      return false;
    }

    this.finishedValue = true;
    this.finishedTimeValue = this.elapsedTime;
    this.medalValue = medalFor(this.elapsedTime, this.tuning.medals);

    if (this.best === null || this.elapsedTime < this.best) {
      this.best = this.elapsedTime;
      this.newBestValue = true;
      this.saveBest(this.elapsedTime);
    }

    return true;
  }

  /**
   * Volta para READY. Preserva o melhor tempo. Ao reposicionar em debug, um
   * `s` além de uma parcial marca a parcial como pulada (sem tempo inventado).
   */
  reset(atS?: number): void {
    this.elapsedTime = 0;
    for (let i = 0; i < this.splits.length; i += 1) {
      this.splitTimes[i] = null;
      this.splitDeltas[i] = null;
      this.splitDone[i] = atS !== undefined && atS >= this.splits[i].s;
    }
    this.finishedValue = false;
    this.finishedTimeValue = null;
    this.medalValue = null;
    this.newBestValue = false;
  }

  /** Cópia imutável do estado atual. */
  snapshot(): RaceResult {
    return {
      elapsed: this.elapsedTime,
      splits: this.splits.map((split, index) => ({
        name: split.name,
        s: split.s,
        target: Number.isFinite(split.target)
          ? split.target
          : this.tuning.splitTarget,
        time: this.splitTimes[index],
        delta: this.splitDeltas[index],
        done: this.splitDone[index],
      })),
      finished: this.finishedValue,
      finishedTime: this.finishedTimeValue,
      medal: this.medalValue,
      medals: { ...this.tuning.medals },
      best: this.best,
      newBest: this.newBestValue,
    };
  }

  private loadBest(): number | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      const raw = localStorage.getItem(this.bestKey);
      if (raw === null) {
        return null;
      }

      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private saveBest(seconds: number): void {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }

      localStorage.setItem(this.bestKey, String(seconds));
    } catch {
      // Modo privado/storage bloqueado: o recorde vale só nesta sessão.
    }
  }
}

function medalFor(seconds: number, medals: MedalTargets): MedalId | null {
  if (seconds <= medals.gold) {
    return 'gold';
  }
  if (seconds <= medals.silver) {
    return 'silver';
  }
  if (seconds <= medals.bronze) {
    return 'bronze';
  }

  return null;
}
