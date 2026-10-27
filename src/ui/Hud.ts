import type { CarTelemetry, HandbrakeMode, RaceState } from '../game/types';

const RAD_TO_DEG = 180 / Math.PI;

function formatTime(seconds: number): string {
  const totalMs = Math.floor(Math.max(seconds, 0) * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export interface HudOptions {
  handbrakeMode?: HandbrakeMode;
  debug?: boolean;
}

/** Dados de debug que não vêm da física do carro. */
export interface HudDebugInfo {
  /** FPS suavizado. */
  fps: number;
  /** Label do piso atual (ex.: "Cascalho"). */
  surface: string;
  /** Coordenada longitudinal na pista (m). */
  s: number;
  /** Coordenada lateral na pista (m; positivo à direita). */
  u: number;
  /** Altura do carro no mundo (m). */
  y: number;
  /** Zona da pista já formatada (FLORESTA/DESERTO). */
  zone: string;
}

/**
 * HUD em DOM sobre o canvas. O root tem `pointer-events: none`; somente os
 * botões reativam pointer events, então toques no HUD nunca dirigem o carro.
 */
export class Hud {
  readonly handbrakeButton: HTMLButtonElement;

  private readonly root: HTMLElement;
  private readonly timer: HTMLOutputElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly debugPanel: HTMLElement;

  private readonly debugValues: Record<string, HTMLElement> = {};

  private resetHandler: (() => void) | null = null;
  private lastTimeText = '';
  private lastTelemetry: CarTelemetry | null = null;
  private lastPosition: { x: number; z: number } | null = null;
  private lastDebugInfo: HudDebugInfo | null = null;
  private debugVisible: boolean;
  private currentState: RaceState = 'READY';

  constructor(root: HTMLElement, options: HudOptions = {}) {
    this.root = root;
    this.root.classList.add('hud');
    this.root.replaceChildren();

    this.debugVisible = options.debug ?? false;
    const handbrakeMode = options.handbrakeMode ?? 'drag';

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
    this.resetButton.title = 'Reiniciar corrida (R)';

    top.append(spacer, this.timer, this.resetButton);

    this.hint = document.createElement('p');
    this.hint.className = 'hud__hint';
    this.hint.textContent = 'TOQUE E ARRASTE';

    this.handbrakeButton = document.createElement('button');
    this.handbrakeButton.className = 'hud__handbrake';
    this.handbrakeButton.type = 'button';
    this.handbrakeButton.setAttribute('aria-label', 'Freio de mão');
    this.handbrakeButton.title = 'Freio de mão (Espaço)';
    this.handbrakeButton.innerHTML =
      '<span class="hud__handbrake-icon" aria-hidden="true">✋</span>' +
      '<span class="hud__handbrake-label">FREIO</span>';
    this.handbrakeButton.hidden = handbrakeMode !== 'button';

    this.debugPanel = document.createElement('div');
    this.debugPanel.className = 'hud__debug';
    this.debugPanel.hidden = !this.debugVisible;

    const title = document.createElement('div');
    title.className = 'hud__debug-title';
    title.textContent = 'TELEMETRIA';
    this.debugPanel.append(title);

    this.addDebugRow('state', 'ESTADO');
    this.addDebugRow('fps', 'FPS');
    this.addDebugRow('surface', 'PISO');
    this.addDebugRow('zone', 'ZONA');
    this.addDebugRow('track', 'S / U');
    this.addDebugRow('height', 'Y');
    this.addDebugRow('grounded', 'CHÃO');
    this.addDebugRow('jump', 'SALTO');
    this.addDebugRow('speed', 'VEL');
    this.addDebugRow('slip', 'DERRAPE');
    this.addDebugRow('lateral', 'LATERAL');
    this.addDebugRow('yaw', 'GUINADA');
    this.addDebugRow('input', 'INPUT');
    this.addDebugRow('position', 'POS');

    this.root.append(top, this.hint, this.handbrakeButton, this.debugPanel);
    this.resetButton.addEventListener('click', this.handleReset);
    this.setState(this.currentState);
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
    this.currentState = state;
    this.root.dataset.state = state;
    this.hint.hidden = state !== 'READY';

    this.debugValues.state.textContent = state;
  }

  setTelemetry(
    telemetry: CarTelemetry,
    position?: { x: number; z: number },
    debugInfo?: HudDebugInfo,
  ): void {
    this.lastTelemetry = telemetry;
    this.lastPosition = position ?? null;
    this.lastDebugInfo = debugInfo ?? this.lastDebugInfo;

    if (!this.debugVisible) {
      return;
    }

    this.updateDebugRows(telemetry);
  }

  setHandbrakeMode(mode: HandbrakeMode): void {
    this.handbrakeButton.hidden = mode !== 'button';
  }

  isDebugVisible(): boolean {
    return this.debugVisible;
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.debugPanel.hidden = !visible;

    if (visible && this.lastTelemetry) {
      this.updateDebugRows(this.lastTelemetry);
    }
  }

  toggleDebug(): boolean {
    this.setDebugVisible(!this.debugVisible);
    return this.debugVisible;
  }

  onReset(handler: () => void): void {
    this.resetHandler = handler;
  }

  dispose(): void {
    this.resetButton.removeEventListener('click', this.handleReset);
    this.resetHandler = null;
  }

  private addDebugRow(key: string, label: string): void {
    const row = document.createElement('div');
    row.className = 'hud__debug-row';

    const name = document.createElement('span');
    name.textContent = label;

    const value = document.createElement('b');
    value.textContent = '—';

    row.append(name, value);
    this.debugPanel.append(row);
    this.debugValues[key] = value;
  }

  private updateDebugRows(telemetry: CarTelemetry): void {
    const slipDeg = RAD_TO_DEG * telemetry.slipAngle;
    const yawDeg = RAD_TO_DEG * telemetry.yawRate;
    const debugInfo = this.lastDebugInfo;

    this.debugValues.fps.textContent = debugInfo
      ? `${formatNumber(debugInfo.fps, 0)} fps`
      : '—';
    this.debugValues.surface.textContent = debugInfo?.surface ?? '—';
    this.debugValues.zone.textContent = debugInfo?.zone ?? '—';
    this.debugValues.track.textContent = debugInfo
      ? `${formatNumber(debugInfo.s, 1)} / ${formatNumber(debugInfo.u, 1)} m`
      : '—';
    this.debugValues.height.textContent = debugInfo
      ? `${formatNumber(debugInfo.y, 1)} m`
      : '—';
    this.debugValues.grounded.textContent = telemetry.grounded
      ? 'CHÃO'
      : `AR ${formatNumber(telemetry.airTime, 2)} s`;
    this.debugValues.jump.textContent =
      telemetry.lastAirTime > 0.02
        ? `${formatNumber(telemetry.lastAirTime, 2)} s / ` +
          `${formatNumber(Math.abs(telemetry.landingImpact), 1)} m/s`
        : '—';
    this.debugValues.speed.textContent = `${formatNumber(telemetry.speed * 3.6)} km/h`;
    this.debugValues.slip.textContent = `${formatNumber(slipDeg, 1)}°`;
    this.debugValues.lateral.textContent = `${formatNumber(telemetry.lateralSpeed, 1)} m/s`;
    this.debugValues.yaw.textContent = `${formatNumber(yawDeg, 0)}°/s`;
    this.debugValues.input.textContent =
      `${telemetry.throttle ? 'T' : '—'} ` +
      `S${telemetry.steer >= 0 ? '+' : ''}${formatNumber(telemetry.steer, 2)} ` +
      `${telemetry.handbrake ? 'HB' : '—'}`;
    this.debugValues.position.textContent = this.lastPosition
      ? `${formatNumber(this.lastPosition.x, 1)}, ${formatNumber(this.lastPosition.z, 1)}`
      : '—';
  }

  private readonly handleReset = (): void => {
    this.resetHandler?.();
  };
}
