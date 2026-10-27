import type { RaceState } from '../game/types';

function formatTime(seconds: number): string {
  const totalMs = Math.floor(Math.max(seconds, 0) * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** HUD em DOM sobre o canvas: cronômetro, reinício e dica de controle. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly timer: HTMLOutputElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;

  private resetHandler: (() => void) | null = null;
  private lastTimeText = '';

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('hud');
    this.root.replaceChildren();

    const top = document.createElement('div');
    top.className = 'hud__top';

    const spacer = document.createElement('span');
    spacer.setAttribute('aria-hidden', 'true');

    this.timer = document.createElement('output');
    this.timer.className = 'hud__timer';
    this.timer.setAttribute('aria-label', 'Cronômetro');
    this.timer.setAttribute('aria-live', 'off');
    this.timer.textContent = formatTime(0);

    this.resetButton = document.createElement('button');
    this.resetButton.className = 'hud__reset';
    this.resetButton.type = 'button';
    this.resetButton.textContent = '↺';
    this.resetButton.setAttribute('aria-label', 'Reiniciar corrida');
    this.resetButton.title = 'Reiniciar corrida';

    top.append(spacer, this.timer, this.resetButton);

    this.hint = document.createElement('p');
    this.hint.className = 'hud__hint';
    this.hint.textContent = 'TOQUE E ARRASTE';

    this.root.append(top, this.hint);
    this.resetButton.addEventListener('click', this.handleReset);
  }

  setTime(seconds: number): void {
    const text = formatTime(seconds);
    if (text === this.lastTimeText) {
      return;
    }

    this.lastTimeText = text;
    this.timer.textContent = text;
  }

  setState(state: RaceState): void {
    this.root.dataset.state = state;
    this.hint.hidden = state !== 'READY';
  }

  onReset(handler: () => void): void {
    this.resetHandler = handler;
  }

  dispose(): void {
    this.resetButton.removeEventListener('click', this.handleReset);
    this.resetHandler = null;
  }

  private readonly handleReset = (): void => {
    this.resetHandler?.();
  };
}
