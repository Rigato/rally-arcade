import { clamp, dampAlpha } from '../core/math';
import { INPUT_TUNING } from '../game/config';
import type { InputState, InputTuning } from '../game/types';
import { TouchGuide } from './TouchGuide';

export interface InputOptions {
  /** Tuning mutável; o painel do M1b pode alterar os campos ao vivo. */
  tuning?: InputTuning;
  /** Botão DOM de freio de mão (modo `button`). */
  handbrakeButton?: HTMLElement | null;
  /** Disparado sempre que o acelerador passa de solto para pressionado. */
  onFirstThrottle?: () => void;
  onReset?: () => void;
  onToggleTelemetry?: () => void;
}

const STEER_KEYS_LEFT = new Set(['KeyA', 'ArrowLeft']);
const STEER_KEYS_RIGHT = new Set(['KeyD', 'ArrowRight']);
const THROTTLE_KEYS = new Set(['KeyW', 'ArrowUp']);
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
 * - Qualquer pointer down no canvas acelera e ancora o esterço no ponto inicial.
 * - Esterço = clamp(dx / lockPx), com deadzone e suavização (tau).
 *   `lockPx = steerLockScreenRatio × min(innerWidth, innerHeight)`, escolha
 *   consistente com o plano (≈125 px em 390 px de largura no portrait).
 * - Soltar o pointer desacelera (o carro aplica a rampa de freio).
 * - Freio de mão por deslocamento (`drag`) ou por botão dedicado (`button`).
 * - Teclado: WASD/setas, Espaço, R (reset) e H (telemetria).
 *
 * Eventos de UI (botões do HUD) são ignorados: só o canvas dirige.
 */
export class Input {
  readonly inputState: InputState;

  private readonly canvas: HTMLElement;
  private readonly tuning: InputTuning;
  private readonly handbrakeButton: HTMLElement | null;
  private readonly onFirstThrottle: (() => void) | null;
  private readonly onReset: (() => void) | null;
  private readonly onToggleTelemetry: (() => void) | null;

  private steerTarget = 0;

  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerSteer = 0;
  private pointerHandbrake = false;
  private pointerBrakeTarget = 0;
  private pointerBrake = 0;
  private keyBrake = false;

  private readonly pressedKeys = new Set<string>();
  private readonly guide = new TouchGuide();

  private buttonHandbrake = false;

  constructor(canvas: HTMLElement, options: InputOptions = {}) {
    this.canvas = canvas;
    this.tuning = options.tuning ?? INPUT_TUNING;
    this.handbrakeButton = options.handbrakeButton ?? null;
    this.onFirstThrottle = options.onFirstThrottle ?? null;
    this.onReset = options.onReset ?? null;
    this.onToggleTelemetry = options.onToggleTelemetry ?? null;

    this.inputState = {
      throttle: false,
      steer: 0,
      brake: 0,
      handbrake: false,
    };

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('lostpointercapture', this.handlePointerUp);
    canvas.addEventListener('contextmenu', this.handleContextMenu);

    this.handbrakeButton?.addEventListener('pointerdown', this.handleHandbrakeDown);
    this.handbrakeButton?.addEventListener('pointerup', this.handleHandbrakeUp);
    this.handbrakeButton?.addEventListener('pointercancel', this.handleHandbrakeUp);
    this.handbrakeButton?.addEventListener('lostpointercapture', this.handleHandbrakeUp);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  /**
   * Suaviza esterço/freio na direção do alvo. Chamar uma vez por passo fixo.
   *
   * O freio é analógico no modo `drag2d`; no modo `release` ele fica em 0 e o
   * carro usa a rampa de frenagem ao soltar o acelerador.
   */
  update(dt: number): void {
    const steerAlpha = dampAlpha(this.tuning.steerSmoothingTau, dt);
    this.inputState.steer += (this.steerTarget - this.inputState.steer) * steerAlpha;

    if (this.steerTarget === 0 && Math.abs(this.inputState.steer) < 0.001) {
      this.inputState.steer = 0;
    }

    const pointerActive = this.pointerId !== null;
    const targetBrake =
      pointerActive && this.tuning.controlMode === 'drag2d'
        ? this.pointerBrakeTarget
        : 0;
    const brakeAlpha = dampAlpha(this.tuning.brakeSmoothingTau, dt);
    this.pointerBrake += (targetBrake - this.pointerBrake) * brakeAlpha;

    if (Math.abs(this.pointerBrake) < 0.002) {
      this.pointerBrake = 0;
    }

    this.inputState.brake = this.keyBrake
      ? 1
      : pointerActive && this.tuning.controlMode === 'drag2d'
        ? this.pointerBrake
        : 0;

    if (this.pointerId !== null && this.tuning.touchGuide) {
      this.guide.update(
        this.pointerSteer,
        this.pointerBrake,
        this.inputState.handbrake,
        this.tuning.controlMode === 'drag2d',
      );
    }
  }

  /** Limpa pointer e teclas (perda de foco, aba oculta, reset). */
  cancelAll(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.releasePointerCapture(pointerId);
    this.pointerSteer = 0;
    this.pointerHandbrake = false;
    this.pointerBrakeTarget = 0;
    this.pointerBrake = 0;
    this.keyBrake = false;
    this.guide.hide();

    this.pressedKeys.clear();

    this.buttonHandbrake = false;
    this.steerTarget = 0;
    this.refreshState();
    this.inputState.brake = 0;
  }

  /** Reset total: também zera o esterço suavizado imediatamente. */
  reset(): void {
    this.cancelAll();
    this.inputState.steer = 0;
    this.inputState.brake = 0;
  }

  /**
   * Reaplica o estado depois que o painel de tuning mudou algo que afeta a
   * leitura dos pointers — principalmente `handbrakeMode`. Não espera um novo
   * evento de toque/teclado.
   */
  notifyTuningChanged(): void {
    if (this.tuning.handbrakeMode === 'drag') {
      // Botão pode ter ficado "preso" ao ser escondido no meio do toque.
      this.buttonHandbrake = false;
    } else {
      // No modo botão o deslocamento não deve continuar segurando o freio.
      this.pointerHandbrake = false;
    }

    if (this.tuning.controlMode !== 'drag2d') {
      this.pointerBrakeTarget = 0;
      this.pointerBrake = 0;
    }

    if (!this.tuning.touchGuide) {
      this.guide.hide();
    }

    this.refreshState();
    this.inputState.brake = 0;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.handlePointerUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);

    this.handbrakeButton?.removeEventListener('pointerdown', this.handleHandbrakeDown);
    this.handbrakeButton?.removeEventListener('pointerup', this.handleHandbrakeUp);
    this.handbrakeButton?.removeEventListener('pointercancel', this.handleHandbrakeUp);
    this.handbrakeButton?.removeEventListener('lostpointercapture', this.handleHandbrakeUp);

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);

    this.cancelAll();
    this.guide.dispose();
  }

  private get lockPx(): number {
    return Math.max(
      Math.min(window.innerWidth, window.innerHeight) * this.tuning.steerLockScreenRatio,
      1,
    );
  }

  private applyPointerPosition(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerStartX;
    const dy = clientY - this.pointerStartY;
    const deadzone = this.tuning.steerDeadzonePx;
    const magnitude = Math.abs(dx);
    const usable = Math.max(this.lockPx - deadzone, 1);

    // Curva exponencial: pequenos deslocamentos mexem pouco o carro; o lock
    // completo continua no mesmo lugar. É o principal remédio contra o chicote.
    this.pointerSteer =
      magnitude <= deadzone
        ? 0
        : clamp(
            Math.pow(clamp((magnitude - deadzone) / usable, 0, 1), this.tuning.steerExponent),
            0,
            1,
          ) * Math.sign(dx);

    if (this.tuning.handbrakeMode === 'drag') {
      this.pointerHandbrake = magnitude > this.lockPx * this.tuning.handbrakeScreenRatio;
    }

    if (this.tuning.controlMode === 'drag2d') {
      const down = Math.max(0, dy - this.tuning.brakeDeadzonePx);
      const brakeNormalized = clamp(down / Math.max(this.tuning.brakeTravelPx, 1), 0, 1);
      this.pointerBrakeTarget = Math.pow(brakeNormalized, this.tuning.brakeExponent);
    } else {
      this.pointerBrakeTarget = 0;
    }
  }

  private refreshState(): void {
    const wasThrottle = this.inputState.throttle;
    const pointerActive = this.pointerId !== null;

    let keyThrottle = false;
    let keyBrake = false;
    let keySteer = 0;
    let keyHandbrake = false;

    for (const code of this.pressedKeys) {
      if (THROTTLE_KEYS.has(code)) {
        keyThrottle = true;
      } else if (BRAKE_KEYS.has(code)) {
        keyBrake = true;
      } else if (STEER_KEYS_LEFT.has(code)) {
        keySteer -= 1;
      } else if (STEER_KEYS_RIGHT.has(code)) {
        keySteer += 1;
      } else if (code === 'Space') {
        keyHandbrake = true;
      }
    }

    this.inputState.throttle = pointerActive || keyThrottle;
    this.keyBrake = keyBrake;
    // O freio suavizado é aplicado em update(); aqui só guardamos o estado das
    // teclas. No modo drag2d, o freio vem do deslocamento vertical do dedo.
    if (keyBrake) {
      this.inputState.brake = 1;
    }
    // O valor suavizado é aplicado em update(); aqui só definimos o alvo.
    this.steerTarget = pointerActive ? this.pointerSteer : clamp(keySteer, -1, 1);
    this.inputState.handbrake =
      keyHandbrake ||
      (this.tuning.handbrakeMode === 'drag' && pointerActive && this.pointerHandbrake) ||
      (this.tuning.handbrakeMode === 'button' && this.buttonHandbrake);

    if (!wasThrottle && this.inputState.throttle) {
      this.onFirstThrottle?.();
    }
  }

  private releasePointerCapture(pointerId: number | null = this.pointerId): void {
    if (pointerId === null) {
      return;
    }

    if (this.canvas.hasPointerCapture?.(pointerId)) {
      try {
        this.canvas.releasePointerCapture(pointerId);
      } catch {
        // O pointer pode já ter sido liberado pelo navegador.
      }
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.target !== this.canvas) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    // Um único pointer dirige; toques extras são ignorados.
    if (this.pointerId !== null) {
      return;
    }

    event.preventDefault();

    this.pointerId = event.pointerId;
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.pointerSteer = 0;
    this.pointerHandbrake = false;
    this.pointerBrakeTarget = 0;
    this.pointerBrake = 0;

    if (this.tuning.touchGuide) {
      this.guide.show(
        event.clientX,
        event.clientY,
        this.lockPx,
        this.tuning.controlMode === 'drag2d',
      );
    }

    try {
      this.canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Safari pode recusar a captura; os handlers de up/cancel continuam valendo.
    }

    this.refreshState();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return;
    }

    // Mouse solto fora do canvas: encerra como se fosse release.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      this.finishPointer();
      return;
    }

    this.applyPointerPosition(event.clientX, event.clientY);
    if (this.tuning.touchGuide) {
      this.guide.update(
        this.pointerSteer,
        this.pointerBrakeTarget,
        this.pointerHandbrake,
        this.tuning.controlMode === 'drag2d',
      );
    }
    this.refreshState();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return;
    }

    this.finishPointer();
  };

  private finishPointer(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.releasePointerCapture(pointerId);
    this.pointerSteer = 0;
    this.pointerHandbrake = false;
    this.pointerBrakeTarget = 0;
    this.pointerBrake = 0;
    this.guide.hide();
    this.refreshState();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (THROTTLE_KEYS.has(event.code) || BRAKE_KEYS.has(event.code)) {
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
      THROTTLE_KEYS.has(event.code) ||
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

  private readonly handleHandbrakeDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    this.buttonHandbrake = true;
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignora captura indisponível.
    }
    this.refreshState();
  };

  private readonly handleHandbrakeUp = (event: PointerEvent): void => {
    event.preventDefault();
    this.buttonHandbrake = false;
    this.refreshState();
  };

  private readonly handleBlur = (): void => {
    this.cancelAll();
  };

  private readonly handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
