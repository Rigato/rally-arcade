import { formatTime } from './format';

/** Mesmos limites usados pelo gerador de pistas procedurais. */
export const TRACK_SEED_MIN = 1;
export const TRACK_SEED_MAX = 100;

const BEST_KEY_PREFIX = 'rally.best.';
const BEST_KEY_SUFFIX = '.v1';
const MISSING_BEST = '--';

export interface TrackMenuCurrent {
  /** Id da pista (`proc-N`, `fixed`, ...). */
  id: string;
  /** Seed procedural, ou `null` na pista fixa. */
  seed: number | null;
  /** Rótulo opcional exibido no cartão (ex.: "FLORESTA 42"). */
  label?: string;
}

interface SeedEntry {
  root: HTMLButtonElement;
  best: HTMLElement;
  seed: number;
}

/** Lê o recorde de uma seed procedural (`mm:ss.mmm` é exibido formatado). */
function readSeedBest(seed: number): number | null {
  try {
    const raw = window.localStorage.getItem(
      `${BEST_KEY_PREFIX}proc-${seed}${BEST_KEY_SUFFIX}`,
    );
    if (raw === null) {
      return null;
    }

    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Overlay de seleção de pista/seed. Não navega nem recarrega nada: só emite
 * callbacks. Vive acima do Results (`z-index: 30`) e fecha com Esc, `FECHAR`
 * ou clique no véu. Ao escolher uma seed/SORTEAR/PISTA FIXA o menu fecha
 * antes de chamar o handler, para o jogo assumir a tela.
 */
export class TrackMenu {
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly currentName: HTMLElement;
  private readonly currentMeta: HTMLElement;
  private readonly seedButtons: SeedEntry[] = [];
  private readonly seedInput: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly closeButton: HTMLButtonElement;

  private opened = false;
  private currentSeed: number | null = null;
  private lastFocus: HTMLElement | null = null;

  private seedHandler: ((seed: number) => void) | null = null;
  private fixedHandler: (() => void) | null = null;
  private randomHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'track-menu';
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.addEventListener('pointerdown', this.stopPropagation);
    this.overlay.addEventListener('click', this.handleOverlayClick);

    this.panel = document.createElement('section');
    this.panel.className = 'track-menu__panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'track-menu-title');
    this.panel.addEventListener('pointerdown', this.stopPropagation);
    this.panel.addEventListener('click', this.stopPropagation);

    const title = document.createElement('h2');
    title.className = 'track-menu__title';
    title.id = 'track-menu-title';
    title.textContent = 'PISTAS';

    const current = document.createElement('div');
    current.className = 'track-menu__current';

    const currentLabel = document.createElement('span');
    currentLabel.className = 'track-menu__current-label';
    currentLabel.textContent = 'PISTA ATUAL';

    this.currentName = document.createElement('strong');
    this.currentName.className = 'track-menu__current-name';
    this.currentName.textContent = '—';

    this.currentMeta = document.createElement('span');
    this.currentMeta.className = 'track-menu__current-meta';

    current.append(currentLabel, this.currentName, this.currentMeta);

    const grid = document.createElement('div');
    grid.className = 'track-menu__grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Seeds 1 a 100');

    for (let seed = TRACK_SEED_MIN; seed <= TRACK_SEED_MAX; seed += 1) {
      const button = document.createElement('button');
      button.className = 'track-menu__seed';
      button.type = 'button';
      button.dataset.seed = String(seed);
      button.addEventListener('click', () => {
        this.selectSeed(seed);
      });

      const number = document.createElement('span');
      number.className = 'track-menu__seed-number';
      number.textContent = `#${seed}`;

      const best = document.createElement('span');
      best.className = 'track-menu__seed-best';
      best.textContent = MISSING_BEST;

      button.append(number, best);
      grid.append(button);
      this.seedButtons.push({ root: button, best, seed });
    }

    const form = document.createElement('div');
    form.className = 'track-menu__form';

    this.seedInput = document.createElement('input');
    this.seedInput.className = 'track-menu__input';
    this.seedInput.type = 'number';
    this.seedInput.min = String(TRACK_SEED_MIN);
    this.seedInput.max = String(TRACK_SEED_MAX);
    this.seedInput.step = '1';
    this.seedInput.inputMode = 'numeric';
    this.seedInput.autocomplete = 'off';
    this.seedInput.placeholder = `Seed ${TRACK_SEED_MIN}–${TRACK_SEED_MAX}`;
    this.seedInput.setAttribute(
      'aria-label',
      `Número da seed (${TRACK_SEED_MIN} a ${TRACK_SEED_MAX})`,
    );
    this.seedInput.addEventListener('keydown', this.handleInputKeydown);

    const playButton = document.createElement('button');
    playButton.className = 'track-menu__play';
    playButton.type = 'button';
    playButton.textContent = 'JOGAR';
    playButton.addEventListener('click', this.handleSubmit);

    form.append(this.seedInput, playButton);

    this.errorEl = document.createElement('p');
    this.errorEl.className = 'track-menu__error';
    this.errorEl.hidden = true;
    this.errorEl.setAttribute('role', 'alert');

    const actions = document.createElement('div');
    actions.className = 'track-menu__actions';

    const randomButton = document.createElement('button');
    randomButton.className = 'track-menu__action track-menu__action--random';
    randomButton.type = 'button';
    randomButton.textContent = 'SORTEAR';
    randomButton.addEventListener('click', this.handleRandom);

    const fixedButton = document.createElement('button');
    fixedButton.className = 'track-menu__action';
    fixedButton.type = 'button';
    fixedButton.textContent = 'PISTA FIXA';
    fixedButton.addEventListener('click', this.handleFixed);

    actions.append(randomButton, fixedButton);

    this.closeButton = document.createElement('button');
    this.closeButton.className = 'track-menu__close';
    this.closeButton.type = 'button';
    this.closeButton.textContent = 'FECHAR';
    this.closeButton.addEventListener('click', this.handleClose);

    this.panel.append(
      title,
      current,
      grid,
      form,
      this.errorEl,
      actions,
      this.closeButton,
    );
    this.overlay.append(this.panel);
    host.append(this.overlay);
  }

  onSelectSeed(handler: (seed: number) => void): void {
    this.seedHandler = handler;
  }

  onSelectFixed(handler: () => void): void {
    this.fixedHandler = handler;
  }

  onRandom(handler: () => void): void {
    this.randomHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  open(current?: TrackMenuCurrent): void {
    if (current) {
      this.setCurrent(current);
    }

    this.refreshBests();

    if (this.opened) {
      return;
    }

    this.lastFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.opened = true;
    this.overlay.hidden = false;
    this.overlay.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', this.handleKeydown, true);

    const target =
      (this.currentSeed !== null
        ? this.seedButtons.find((entry) => entry.seed === this.currentSeed)?.root
        : null) ?? this.seedInput;
    target.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) {
      return;
    }

    this.opened = false;
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', this.handleKeydown, true);
    this.errorEl.hidden = true;
    this.seedInput.removeAttribute('aria-invalid');

    const previous = this.lastFocus;
    this.lastFocus = null;
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
    }

    this.closeHandler?.();
  }

  isOpen(): boolean {
    return this.opened;
  }

  setCurrent(current: TrackMenuCurrent): void {
    const label = current.label?.trim();
    const seed = current.seed;

    this.currentSeed = seed;
    this.currentName.textContent =
      label && label.length > 0
        ? label
        : seed !== null
          ? `PROCEDURAL #${seed}`
          : current.id.toUpperCase();

    const parts = [`ID ${current.id}`];
    if (seed !== null) {
      parts.push(`SEED ${seed}`);
    }
    this.currentMeta.textContent = parts.join(' · ');

    for (const entry of this.seedButtons) {
      const active = seed !== null && entry.seed === seed;
      entry.root.classList.toggle('is-current', active);
      if (active) {
        entry.root.setAttribute('aria-current', 'true');
      } else {
        entry.root.removeAttribute('aria-current');
      }
    }

    if (seed !== null) {
      this.seedInput.value = String(seed);
    }
  }

  dispose(): void {
    document.removeEventListener('keydown', this.handleKeydown, true);
    this.seedInput.removeEventListener('keydown', this.handleInputKeydown);
    this.overlay.removeEventListener('pointerdown', this.stopPropagation);
    this.overlay.removeEventListener('click', this.handleOverlayClick);
    this.overlay.remove();
    this.seedHandler = null;
    this.fixedHandler = null;
    this.randomHandler = null;
    this.closeHandler = null;
  }

  /** Relê os recordes locais de cada seed (chamado ao abrir). */
  private refreshBests(): void {
    for (const entry of this.seedButtons) {
      const best = readSeedBest(entry.seed);
      const text = best !== null ? formatTime(best) : MISSING_BEST;
      entry.best.textContent = text;
      entry.root.setAttribute(
        'aria-label',
        best !== null
          ? `Seed ${entry.seed}. Melhor tempo ${text}`
          : `Seed ${entry.seed}. Sem melhor tempo`,
      );
    }
  }

  private selectSeed(seed: number): void {
    const handler = this.seedHandler;
    this.close();
    handler?.(seed);
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
    this.seedInput.setAttribute('aria-invalid', 'true');
    this.seedInput.focus({ preventScroll: true });
  }

  private readonly handleSubmit = (): void => {
    const value = Number(this.seedInput.value);
    if (
      !Number.isInteger(value) ||
      value < TRACK_SEED_MIN ||
      value > TRACK_SEED_MAX
    ) {
      this.showError(`Escolha uma seed de ${TRACK_SEED_MIN} a ${TRACK_SEED_MAX}.`);
      return;
    }

    this.errorEl.hidden = true;
    this.seedInput.removeAttribute('aria-invalid');
    this.seedInput.value = String(value);
    this.selectSeed(value);
  };

  private readonly handleInputKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.handleSubmit();
    }
  };

  private readonly handleRandom = (): void => {
    const handler = this.randomHandler;
    this.close();
    handler?.();
  };

  private readonly handleFixed = (): void => {
    const handler = this.fixedHandler;
    this.close();
    handler?.();
  };

  private readonly handleClose = (): void => {
    this.close();
  };

  private readonly handleOverlayClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (event.target === this.overlay) {
      this.close();
    }
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!this.opened) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    // Modal: atalhos do jogo (R, Enter, setas) não correm com o menu aberto.
    event.stopPropagation();
  };

  /** Toques/cliques no menu nunca chegam ao canvas (nem iniciam corrida). */
  private readonly stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };
}
