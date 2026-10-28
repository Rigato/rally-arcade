import { clamp, dampAlpha } from '../core/math';
import { INPUT_TUNING } from '../game/config';
import type { InputState, InputTuning } from '../game/types';

export interface InputOptions {
  /** Tuning mutável; o painel de debug pode alterar os campos ao vivo. */
  tuning?: InputTuning;
  /** Botão central GO!. */
  goButton?: HTMLElement | null;
  /** Botões de esterço e freio (DOM do HUD). */
  steerLeftButton?: HTMLElement | null;
  steerRightButton?: HTMLElement | null;
  brakeButton?: HTMLElement | null;
  /** Chamado quando o jogador pede para largar (GO, toque no canvas ou tecla). */
  onRaceStart?: () => void;
  onReset?: () => void;
  onToggleTelemetry?: () => void;
}

type HoldControl = 'left' | 'right' | 'brake';

const STEER_KEYS_LEFT = new Set(['KeyA', 'ArrowLeft']);
const STEER_KEYS_RIGHT = new Set(['KeyD', 'ArrowRight']);
const START_KEYS = new Set(['KeyW', 'ArrowUp', 'Enter']);
const BRAKE_KEYS = new Set(['KeyS', 'ArrowDown']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    // Painel de tuning e modal de exportação: teclas não podem dirigir.
    target.closest('.lil-gui') !== null ||
    target.closest('.tuning-copy') !== null
  );
}

/**
 * Entrada única para touch, mouse e teclado.
 *
 * - A corrida começa parada em READY. GO, um toque no canvas ou W/↑/Enter
 *   disparam `onRaceStart`; o Game só então passa para RUNNING.
 * - Depois do start o acelerador é automático (`setRaceActive(true)`); frear
 *   corta o motor dentro do próprio Car.
 * - Touch: três botões DOM (◀, ▶, FREIO), com pointer capture e suporte a
 *   múltiplos pointers (esterçar + frear com dois dedos).
 * - Teclado: A/← esterça para a esquerda na tela, D/→ para a direita,
 *   S/↓ freia, Espaço é freio de mão, R reinicia e H alterna a telemetria.
 *
 * Convenção de sinal: a câmera olha para a frente do carro, então o eixo +X
 * do mundo aparece à esquerda na tela. Por isso "esquerda na tela" é +1 e
 * "direita na tela" é -1 no `steerTarget`.
 */
export class Input {
  readonly inputState: InputState;

  private readonly canvas: HTMLElement;
  private readonly tuning: InputTuning;
  private readonly goButton: HTMLElement | null;
  private readonly steerLeftButton: HTMLElement | null;
  private readonly steerRightButton: HTMLElement | null;
  private readonly brakeButton: HTMLElement | null;
  private readonly onRaceStart: (() => void) | null;
  private readonly onReset: (() => void) | null;
  private readonly onToggleTelemetry: (() => void) | null;

  private raceActive = false;
  private steerTarget = 0;

  /** Pointers ativos nos botões (permite um dedo por botão). */
  private readonly pointerControls = new Map<number, HoldControl>();
  private readonly releaseListeners: Array<() => void> = [];

  private brakeTarget = 0;
  private brake = 0;

  private keyBrake = false;
  private keyHandbrake = false;

  private readonly pressedKeys = new Set<string>();

  constructor(canvas: HTMLElement, options: InputOptions = {}) {
    this.canvas = canvas;
    this.tuning = options.tuning ?? INPUT_TUNING;
    this.goButton = options.goButton ?? null;
    this.steerLeftButton = options.steerLeftButton ?? null;
    this.steerRightButton = options.steerRightButton ?? null;
    this.brakeButton = options.brakeButton ?? null;
    this.onRaceStart = options.onRaceStart ?? null;
    this.onReset = options.onReset ?? null;
    this.onToggleTelemetry = options.onToggleTelemetry ?? null;

    this.inputState = {
      throttle: false,
      steer: 0,
      brake: 0,
      handbrake: false,
    };

    canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    canvas.addEventListener('contextmenu', this.handleContextMenu);

    this.bindHold(this.goButton, 'start');
    this.bindHold(this.steerLeftButton, 'left');
    this.bindHold(this.steerRightButton, 'right');
    this.bindHold(this.brakeButton, 'brake');

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  /**
   * Liga/desliga a auto-aceleração. O Game chama `true` somente em RUNNING e
   * `false` em READY, RECOVERING e FINISHED.
   */
  setRaceActive(active: boolean): void {
    if (this.raceActive === active) {
      return;
    }

    this.raceActive = active;
    this.refreshState();
  }

  /** Suaviza esterço/freio na direção do alvo. Chamar uma vez por passo fixo. */
  update(dt: number): void {
    const steerAlpha = dampAlpha(this.tuning.steerSmoothingTau, dt);
    this.inputState.steer += (this.steerTarget - this.inputState.steer) * steerAlpha;

    if (this.steerTarget === 0 && Math.abs(this.inputState.steer) < 0.001) {
      this.inputState.steer = 0;
    }

    const brakeAlpha = dampAlpha(this.tuning.brakeSmoothingTau, dt);
    this.brake += (this.brakeTarget - this.brake) * brakeAlpha;

    if (this.brakeTarget === 0 && this.brake < 0.002) {
      this.brake = 0;
    }

    this.inputState.brake = this.brake;
  }

  /** Limpa botões e teclas (perda de foco, aba oculta, recuperação). */
  cancelAll(): void {
    for (const pointerId of [...this.pointerControls.keys()]) {
      this.releasePointer(pointerId);
    }
    this.pointerControls.clear();

    this.pressedKeys.clear();
    this.keyBrake = false;
    this.keyHandbrake = false;
    this.brakeTarget = 0;
    this.brake = 0;
    this.steerTarget = 0;

    this.refreshState();
    this.inputState.brake = 0;
  }

  /** Reset total: também zera o esterço/freio suavizados imediatamente. */
  reset(): void {
    this.cancelAll();
    this.inputState.steer = 0;
    this.inputState.brake = 0;
  }

  /** Reaplica os estados das teclas/botões depois de mudanças de tuning. */
  notifyTuningChanged(): void {
    this.refreshState();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);

    for (const off of this.releaseListeners) {
      off();
    }
    this.releaseListeners.length = 0;

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);

    this.cancelAll();
  }

  /**
   * Prende um botão DOM a um controle. Cada botão escuta o próprio pointer,
   * então dois dedos podem segurar botões diferentes ao mesmo tempo. Os
   * eventos não chegam ao canvas (que fica atrás do HUD).
   */
  private bindHold(
    element: HTMLElement | null,
    control: HoldControl | 'start',
  ): void {
    if (!element) {
      return;
    }

    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (control === 'start') {
        this.onRaceStart?.();
        return;
      }

      this.pointerControls.set(event.pointerId, control);
      try {
        element.setPointerCapture?.(event.pointerId);
      } catch {
        // Safari pode recusar a captura; up/cancel continuam valendo.
      }
      this.refreshState();
    };

    const onUp = (event: PointerEvent): void => {
      if (control === 'start') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (this.pointerControls.get(event.pointerId) === control) {
        this.pointerControls.delete(event.pointerId);
      }
      this.releasePointer(event.pointerId);
      this.refreshState();
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('lostpointercapture', onUp);

    this.releaseListeners.push(() => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('lostpointercapture', onUp);
    });
  }

  private releasePointer(pointerId: number): void {
    for (const element of [
      this.steerLeftButton,
      this.steerRightButton,
      this.brakeButton,
    ]) {
      if (element?.hasPointerCapture?.(pointerId)) {
        try {
          element.releasePointerCapture(pointerId);
        } catch {
          // O pointer pode já ter sido liberado pelo navegador.
        }
      }
    }
  }

  private hasPointerControl(control: HoldControl): boolean {
    for (const value of this.pointerControls.values()) {
      if (value === control) {
        return true;
      }
    }
    return false;
  }

  private refreshState(): void {
    let keySteer = 0;
    let keyHandbrake = false;

    for (const code of this.pressedKeys) {
      if (STEER_KEYS_LEFT.has(code)) {
        // +1 = esquerda na tela nesta convenção de câmera.
        keySteer += 1;
      } else if (STEER_KEYS_RIGHT.has(code)) {
        keySteer -= 1;
      } else if (code === 'Space') {
        keyHandbrake = true;
      }
    }

    const left = this.hasPointerControl('left');
    const right = this.hasPointerControl('right');

    if (left && !right) {
      this.steerTarget = 1;
    } else if (right && !left) {
      this.steerTarget = -1;
    } else if (!left && !right) {
      this.steerTarget = clamp(keySteer, -1, 1);
    } else {
      this.steerTarget = 0;
    }

    this.keyBrake = this.hasPointerControl('brake') || this.hasKey(BRAKE_KEYS);
    this.keyHandbrake = keyHandbrake;

    this.brakeTarget = this.keyBrake ? 1 : 0;
    this.inputState.throttle = this.raceActive;
    this.inputState.handbrake = this.keyHandbrake;
  }

  private hasKey(codes: Set<string>): boolean {
    for (const code of codes) {
      if (this.pressedKeys.has(code)) {
        return true;
      }
    }
    return false;
  }

  private readonly handleCanvasPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    // Fora do start, o canvas não dirige: só os botões e o teclado.
    event.preventDefault();
    this.onRaceStart?.();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (START_KEYS.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) {
        this.onRaceStart?.();
      }
      return;
    }

    if (BRAKE_KEYS.has(event.code)) {
      event.preventDefault();
      this.pressedKeys.add(event.code);
    } else if (STEER_KEYS_LEFT.has(event.code) || STEER_KEYS_RIGHT.has(event.code)) {
      event.preventDefault();
      this.pressedKeys.add(event.code);
    } else if (event.code === 'Space') {
      event.preventDefault();
      this.pressedKeys.add(event.code);
    } else if (event.code === 'KeyR') {
      event.preventDefault();
      if (!event.repeat) {
        this.onReset?.();
      }
      return;
    } else if (event.code === 'KeyH') {
      event.preventDefault();
      if (!event.repeat) {
        this.onToggleTelemetry?.();
      }
      return;
    } else {
      return;
    }

    this.refreshState();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (
      BRAKE_KEYS.has(event.code) ||
      STEER_KEYS_LEFT.has(event.code) ||
      STEER_KEYS_RIGHT.has(event.code) ||
      event.code === 'Space'
    ) {
      this.pressedKeys.delete(event.code);
    } else {
      return;
    }

    this.refreshState();
  };

  private readonly handleBlur = (): void => {
    this.cancelAll();
  };

  private readonly handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
