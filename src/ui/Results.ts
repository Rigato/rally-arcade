import type { MedalId, RaceResult } from '../game/Race';
import { formatDelta, formatSeconds, formatTime } from './format';

const MEDAL_LABELS: Record<MedalId, string> = {
  gold: 'OURO',
  silver: 'PRATA',
  bronze: 'BRONZE',
};

/**
 * Overlay de resultado. Vive dentro do HUD, mas fora do fluxo: fica escondido
 * (`hidden`) e sem pointer-events até a chegada. Só o painel e o botão capturam
 * toque, então o canvas continua alcançável quando o resultado não está aberto.
 */
export class Results {
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly medalEl: HTMLElement;
  private readonly gapEl: HTMLElement;
  private readonly splitLabelEl: HTMLElement;
  private readonly splitTimeEl: HTMLElement;
  private readonly splitDeltaEl: HTMLElement;
  private readonly bestTimeEl: HTMLElement;
  private readonly newBestEl: HTMLElement;
  private readonly targetValues = new Map<MedalId, HTMLElement>();
  private readonly retryButton: HTMLButtonElement;

  private retryHandler: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'results';
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');

    this.panel = document.createElement('section');
    this.panel.className = 'results__panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'results-title');

    const kicker = document.createElement('p');
    kicker.className = 'results__kicker';
    kicker.id = 'results-title';
    kicker.textContent = 'CHEGADA';

    this.timeEl = document.createElement('p');
    this.timeEl.className = 'results__time';

    this.medalEl = document.createElement('p');
    this.medalEl.className = 'results__medal';
    this.medalEl.dataset.medal = 'none';

    this.gapEl = document.createElement('p');
    this.gapEl.className = 'results__gap';
    this.gapEl.hidden = true;

    const targets = document.createElement('div');
    targets.className = 'results__targets';
    targets.setAttribute('aria-label', 'Tempos-alvo das medalhas');

    for (const medal of ['gold', 'silver', 'bronze'] as const) {
      const item = document.createElement('div');
      item.className = 'results__target';
      item.dataset.medal = medal;

      const label = document.createElement('span');
      label.className = 'results__target-label';
      label.textContent = MEDAL_LABELS[medal];

      const value = document.createElement('b');
      value.className = 'results__target-value';

      item.append(label, value);
      targets.append(item);
      this.targetValues.set(medal, value);
    }

    const stats = document.createElement('div');
    stats.className = 'results__stats';

    const splitRow = this.createStat('PARCIAL');
    this.splitLabelEl = splitRow.label;
    this.splitTimeEl = document.createElement('span');
    this.splitTimeEl.className = 'results__stat-time';
    this.splitDeltaEl = document.createElement('em');
    this.splitDeltaEl.className = 'results__delta';
    splitRow.value.append(this.splitTimeEl, this.splitDeltaEl);

    const bestRow = this.createStat('MELHOR');
    this.bestTimeEl = document.createElement('span');
    this.bestTimeEl.className = 'results__stat-time';
    this.newBestEl = document.createElement('span');
    this.newBestEl.className = 'results__new-best';
    this.newBestEl.textContent = 'NOVO RECORDE';
    this.newBestEl.hidden = true;
    bestRow.value.append(this.bestTimeEl, this.newBestEl);

    stats.append(splitRow.row, bestRow.row);

    this.retryButton = document.createElement('button');
    this.retryButton.className = 'results__retry';
    this.retryButton.type = 'button';
    this.retryButton.textContent = 'CORRER DE NOVO';
    this.retryButton.addEventListener('click', this.handleRetry);

    this.panel.append(
      kicker,
      this.timeEl,
      this.medalEl,
      this.gapEl,
      targets,
      stats,
      this.retryButton,
    );
    this.overlay.append(this.panel);
    host.append(this.overlay);
  }

  onRetry(handler: () => void): void {
    this.retryHandler = handler;
  }

  show(result: RaceResult): void {
    const finalTime = result.finishedTime ?? result.elapsed;
    this.timeEl.textContent = formatTime(finalTime);

    const medal = result.medal;
    this.medalEl.dataset.medal = medal ?? 'none';
    this.medalEl.textContent = medal ? MEDAL_LABELS[medal] : 'SEM MEDALHA';

    if (medal === null) {
      const missing = Math.max(0, finalTime - result.medals.bronze);
      this.gapEl.textContent = `FALTARAM ${formatSeconds(missing)} PARA O BRONZE`;
      this.gapEl.hidden = false;
    } else {
      this.gapEl.hidden = true;
    }

    for (const key of ['gold', 'silver', 'bronze'] as const) {
      const value = this.targetValues.get(key);
      if (value) {
        value.textContent = formatTime(result.medals[key]);
        value.parentElement?.classList.toggle(
          'is-reached',
          finalTime <= result.medals[key],
        );
      }
    }

    this.splitLabelEl.textContent = result.splitName.toUpperCase();

    if (result.splitTime !== null) {
      this.splitTimeEl.textContent = formatTime(result.splitTime);
      this.splitDeltaEl.hidden = false;
      this.splitDeltaEl.textContent = formatDelta(result.splitDelta ?? 0);
      this.splitDeltaEl.dataset.sign = deltaSign(result.splitDelta ?? 0);
    } else {
      this.splitTimeEl.textContent = '--:--.---';
      this.splitDeltaEl.hidden = true;
    }

    this.bestTimeEl.textContent =
      result.best !== null ? formatTime(result.best) : '--:--.---';
    this.newBestEl.hidden = !result.newBest;

    this.overlay.hidden = false;
    this.overlay.setAttribute('aria-hidden', 'false');
    this.retryButton.focus({ preventScroll: true });
  }

  hide(): void {
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');

    if (this.retryButton === document.activeElement) {
      this.retryButton.blur();
    }
  }

  dispose(): void {
    this.retryButton.removeEventListener('click', this.handleRetry);
    this.retryHandler = null;
    this.overlay.remove();
  }

  private createStat(labelText: string): {
    row: HTMLElement;
    label: HTMLElement;
    value: HTMLElement;
  } {
    const row = document.createElement('div');
    row.className = 'results__stat';

    const label = document.createElement('span');
    label.className = 'results__stat-label';
    label.textContent = labelText;

    const value = document.createElement('b');
    value.className = 'results__stat-value';

    row.append(label, value);
    return { row, label, value };
  }

  private readonly handleRetry = (): void => {
    this.retryHandler?.();
  };
}

function deltaSign(delta: number): 'slow' | 'fast' | 'even' {
  if (Math.abs(delta) < 0.005) {
    return 'even';
  }

  return delta > 0 ? 'slow' : 'fast';
}
