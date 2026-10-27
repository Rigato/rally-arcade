import type { MedalTargets, RaceTuning } from './types';

export type MedalId = 'gold' | 'silver' | 'bronze';

export interface RaceSplit {
  name: string;
  s: number;
  time: number;
  target: number;
  delta: number;
}

/** Snapshot imutável consumido pelo HUD e pela tela de resultado. */
export interface RaceResult {
  elapsed: number;
  splitName: string;
  splitTime: number | null;
  splitTarget: number;
  splitDelta: number | null;
  splitDone: boolean;
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
  splitS: number | null;
  splitName: string;
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
  readonly splitS: number | null;
  readonly splitName: string;
  readonly tuning: RaceTuning;

  private readonly bestKey: string;
  private best: number | null;

  private elapsedTime = 0;
  private splitTimeValue: number | null = null;
  private splitDeltaValue: number | null = null;
  private splitDoneValue = false;
  private finishedValue = false;
  private finishedTimeValue: number | null = null;
  private medalValue: MedalId | null = null;
  private newBestValue = false;

  constructor(options: RaceOptions) {
    this.tuning = options.tuning;
    this.finishS = options.finishS;
    this.splitS = options.splitS;
    this.splitName = options.splitName;
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
   * Registra a parcial uma única vez ao cruzar `splitS`.
   * Retorna o evento para o HUD mostrar o banner; `null` se já passou.
   */
  checkSplit(s: number): RaceSplit | null {
    if (
      this.finishedValue ||
      this.splitDoneValue ||
      this.splitS === null ||
      s < this.splitS
    ) {
      return null;
    }

    const target = Number.isFinite(this.tuning.splitTarget)
      ? this.tuning.splitTarget
      : 0;

    this.splitDoneValue = true;
    this.splitTimeValue = this.elapsedTime;
    this.splitDeltaValue = this.elapsedTime - target;

    return {
      name: this.splitName,
      s: this.splitS,
      time: this.splitTimeValue,
      target,
      delta: this.splitDeltaValue,
    };
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
   * `s` além da parcial marca a parcial como pulada (sem tempo inventado).
   */
  reset(atS?: number): void {
    this.elapsedTime = 0;
    this.splitTimeValue = null;
    this.splitDeltaValue = null;
    this.splitDoneValue =
      atS !== undefined && this.splitS !== null && atS >= this.splitS;
    this.finishedValue = false;
    this.finishedTimeValue = null;
    this.medalValue = null;
    this.newBestValue = false;
  }

  /** Cópia imutável do estado atual. */
  snapshot(): RaceResult {
    return {
      elapsed: this.elapsedTime,
      splitName: this.splitName,
      splitTime: this.splitTimeValue,
      splitTarget: this.tuning.splitTarget,
      splitDelta: this.splitDeltaValue,
      splitDone: this.splitDoneValue,
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
