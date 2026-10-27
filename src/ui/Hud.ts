import type {
  ActivePowerup,
  CarTelemetry,
  HandbrakeMode,
  PowerupType,
  RaceState,
} from '../game/types';
import type { RaceSplit } from '../game/Race';
import { clamp } from '../core/math';
import { formatDelta, formatTime } from './format';

const RAD_TO_DEG = 180 / Math.PI;
const IMPACT_FLASH_MS = 160;
const SPLIT_BANNER_MS = 2500;
const POWERUP_FLASH_MS = 750;
const POWERUP_LABELS: Record<PowerupType, string> = {
  turbo: 'TURBO',
  grip: 'GRIP',
};

function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export interface HudTrackInfo {
  startS: number;
  finishS: number;
  splits: ReadonlyArray<{ s: number; name: string }>;
}

export interface HudOptions {
  handbrakeMode?: HandbrakeMode;
  debug?: boolean;
  track?: HudTrackInfo;
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
  /** Distância além da borda da pista (m; 0 dentro da pista). */
  offRoad: number;
  /** Quantidade de obstáculos sólidos gerados. */
  obstacles: number;
  /** Intensidade da última colisão com obstáculo (m/s; 0 = sem impacto). */
  impact: number;
  /** Powerups ativos já formatados (ex.: "TURBO 1,4s"). */
  powerups: string;
}

export type RecoveryPhase = 'in' | 'returning' | 'out';

const DEFAULT_TRACK_INFO: HudTrackInfo = {
  startS: 0,
  finishS: 1,
  splits: [],
};

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
  private readonly bestTimeEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressTrack: HTMLElement;
  private readonly progressDistance: HTMLElement;
  private readonly splitBanner: HTMLElement;
  private readonly splitNameEl: HTMLElement;
  private readonly splitTimeEl: HTMLElement;
  private readonly splitDeltaEl: HTMLElement;
  private readonly debugPanel: HTMLElement;
  private readonly recoveryOverlay: HTMLElement;
  private readonly recoveryText: HTMLParagraphElement;
  private readonly recoverySub: HTMLParagraphElement;
  private readonly impactOverlay: HTMLElement;
  private readonly powerupsBar: HTMLElement;
  private readonly powerupChips: Record<
    PowerupType,
    { root: HTMLElement; time: HTMLElement; fill: HTMLElement }
  >;
  private readonly powerupFlash: HTMLElement;

  private readonly trackStartS: number;
  private readonly trackFinishS: number;

  private readonly debugValues: Record<string, HTMLElement> = {};

  private resetHandler: (() => void) | null = null;
  private lastTimeText = '';
  private lastBestText = '';
  private lastProgressPercent = -1;
  private lastDistanceM = -1;
  private lastTelemetry: CarTelemetry | null = null;
  private lastPosition: { x: number; z: number } | null = null;
  private lastDebugInfo: HudDebugInfo | null = null;
  private debugVisible: boolean;
  private currentState: RaceState = 'READY';
  private impactTimer: number | null = null;
  private splitTimer: number | null = null;
  private powerupFlashTimer: number | null = null;
  private readonly lastPowerupText: Record<PowerupType, string> = {
    turbo: '',
    grip: '',
  };

  constructor(root: HTMLElement, options: HudOptions = {}) {
    this.root = root;
    this.root.classList.add('hud');
    this.root.replaceChildren();

    this.debugVisible = options.debug ?? false;
    const handbrakeMode = options.handbrakeMode ?? 'drag';
    const track = options.track ?? DEFAULT_TRACK_INFO;
    this.trackStartS = track.startS;
    this.trackFinishS = Math.max(track.finishS, track.startS + 1);

    const header = document.createElement('div');
    header.className = 'hud__header';

    const top = document.createElement('div');
    top.className = 'hud__top';

    const best = document.createElement('div');
    best.className = 'hud__best';

    const bestLabel = document.createElement('span');
    bestLabel.className = 'hud__best-label';
    bestLabel.textContent = 'MELHOR';

    this.bestTimeEl = document.createElement('span');
    this.bestTimeEl.className = 'hud__best-time';
    this.bestTimeEl.textContent = '--:--.---';

    best.append(bestLabel, this.bestTimeEl);

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

    top.append(best, this.timer, this.resetButton);

    const progress = document.createElement('div');
    progress.className = 'hud__progress';

    const progressMeta = document.createElement('div');
    progressMeta.className = 'hud__progress-meta';

    const progressLabel = document.createElement('span');
    progressLabel.className = 'hud__progress-label';
    progressLabel.textContent = 'DISTÂNCIA';

    this.progressDistance = document.createElement('span');
    this.progressDistance.className = 'hud__progress-distance';

    progressMeta.append(progressLabel, this.progressDistance);

    this.progressTrack = document.createElement('div');
    this.progressTrack.className = 'hud__progress-track';
    this.progressTrack.setAttribute('role', 'progressbar');
    this.progressTrack.setAttribute('aria-label', 'Progresso na pista');
    this.progressTrack.setAttribute('aria-valuemin', '0');
    this.progressTrack.setAttribute(
      'aria-valuemax',
      String(Math.round(this.trackFinishS - this.trackStartS)),
    );

    this.progressFill = document.createElement('div');
    this.progressFill.className = 'hud__progress-fill';
    this.progressTrack.append(this.progressFill);

    for (const split of track.splits) {
      const ratio = (split.s - this.trackStartS) / (this.trackFinishS - this.trackStartS);
      if (ratio < 0 || ratio > 1) {
        continue;
      }

      const marker = document.createElement('span');
      marker.className = 'hud__progress-split';
      marker.style.left = `${(ratio * 100).toFixed(2)}%`;
      marker.title = split.name;
      marker.setAttribute('aria-hidden', 'true');
      this.progressTrack.append(marker);
    }

    progress.append(progressMeta, this.progressTrack);
    header.append(top, progress);

    this.hint = document.createElement('p');
    this.hint.className = 'hud__hint';
    this.hint.textContent = 'TOQUE E ARRASTE';

    this.splitBanner = document.createElement('div');
    this.splitBanner.className = 'hud__split';
    this.splitBanner.hidden = true;
    this.splitBanner.setAttribute('role', 'status');
    this.splitBanner.setAttribute('aria-live', 'polite');

    this.splitNameEl = document.createElement('span');
    this.splitNameEl.className = 'hud__split-name';

    this.splitTimeEl = document.createElement('strong');
    this.splitTimeEl.className = 'hud__split-time';

    this.splitDeltaEl = document.createElement('span');
    this.splitDeltaEl.className = 'hud__split-delta';

    this.splitBanner.append(this.splitNameEl, this.splitTimeEl, this.splitDeltaEl);

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
    this.addDebugRow('offroad', 'OFF-ROAD');
    this.addDebugRow('obstacles', 'OBSTÁCULOS');
    this.addDebugRow('impact', 'IMPACTO');
    this.addDebugRow('powerups', 'POWERUP');
    this.addDebugRow('height', 'Y');
    this.addDebugRow('grounded', 'CHÃO');
    this.addDebugRow('jump', 'SALTO');
    this.addDebugRow('speed', 'VEL');
    this.addDebugRow('slip', 'DERRAPE');
    this.addDebugRow('lateral', 'LATERAL');
    this.addDebugRow('yaw', 'GUINADA');
    this.addDebugRow('input', 'INPUT');
    this.addDebugRow('position', 'POS');

    this.powerupsBar = document.createElement('div');
    this.powerupsBar.className = 'hud__powerups';
    this.powerupsBar.hidden = true;
    this.powerupsBar.setAttribute('aria-label', 'Powerups ativos');
    this.powerupsBar.setAttribute('aria-live', 'off');

    this.powerupChips = {
      turbo: this.createPowerupChip('turbo'),
      grip: this.createPowerupChip('grip'),
    };
    this.powerupsBar.append(
      this.powerupChips.turbo.root,
      this.powerupChips.grip.root,
    );

    this.powerupFlash = document.createElement('span');
    this.powerupFlash.className = 'hud__powerup-flash';
    this.powerupFlash.hidden = true;
    this.powerupFlash.setAttribute('aria-hidden', 'true');

    this.recoveryOverlay = document.createElement('div');
    this.recoveryOverlay.className = 'hud__recovery';
    this.recoveryOverlay.setAttribute('aria-hidden', 'true');
    this.recoveryOverlay.dataset.phase = 'off';

    this.impactOverlay = document.createElement('div');
    this.impactOverlay.className = 'hud__impact';
    this.impactOverlay.setAttribute('aria-hidden', 'true');

    const recoveryPanel = document.createElement('div');
    recoveryPanel.className = 'hud__recovery-panel';

    this.recoveryText = document.createElement('p');
    this.recoveryText.className = 'hud__recovery-text';
    this.recoveryText.textContent = 'RECUPERANDO...';

    this.recoverySub = document.createElement('p');
    this.recoverySub.className = 'hud__recovery-sub';
    this.recoverySub.textContent = 'PERDENDO TEMPO';

    recoveryPanel.append(this.recoveryText, this.recoverySub);
    this.recoveryOverlay.append(recoveryPanel);

    this.root.append(
      header,
      this.hint,
      this.splitBanner,
      this.powerupsBar,
      this.powerupFlash,
      this.recoveryOverlay,
      this.handbrakeButton,
      this.debugPanel,
    );
    this.root.prepend(this.impactOverlay);
    this.resetButton.addEventListener('click', this.handleReset);
    this.setBest(null);
    this.setProgress(this.trackStartS);
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

  /** Mostra `MELHOR --:--.---` até existir um recorde salvo. */
  setBest(seconds: number | null): void {
    const text = seconds !== null ? formatTime(seconds) : '--:--.---';
    if (text === this.lastBestText) {
      return;
    }

    this.lastBestText = text;
    this.bestTimeEl.textContent = text;
    this.bestTimeEl.setAttribute(
      'aria-label',
      seconds !== null ? `Melhor tempo ${text}` : 'Sem melhor tempo',
    );
  }

  /**
   * Preenche a barra do início até a chegada. Atualiza o DOM só quando o
   * percentual muda o suficiente; a distância, em metros inteiros.
   */
  setProgress(s: number): void {
    const total = this.trackFinishS - this.trackStartS;
    const traveled = clamp(s - this.trackStartS, 0, total);
    const percent = clamp((traveled / total) * 100, 0, 100);

    if (Math.abs(percent - this.lastProgressPercent) >= 0.01) {
      this.lastProgressPercent = percent;
      this.progressFill.style.width = `${percent.toFixed(2)}%`;
      this.progressTrack.setAttribute('aria-valuenow', String(Math.round(traveled)));
    }

    const meters = Math.round(traveled);
    if (meters !== this.lastDistanceM) {
      this.lastDistanceM = meters;
      this.progressDistance.textContent = `${meters} m / ${Math.round(total)} m`;
    }
  }

  /** Banner da parcial: aparece por ~2,5 s e some sozinho. */
  showSplit(split: RaceSplit): void {
    if (this.splitTimer !== null) {
      window.clearTimeout(this.splitTimer);
      this.splitTimer = null;
    }

    this.splitNameEl.textContent = split.name.toUpperCase();
    this.splitTimeEl.textContent = formatTime(split.time);
    this.splitDeltaEl.textContent = formatDelta(split.delta);
    this.splitDeltaEl.dataset.sign =
      Math.abs(split.delta) < 0.005 ? 'even' : split.delta > 0 ? 'slow' : 'fast';

    this.splitBanner.hidden = false;
    this.splitBanner.setAttribute('aria-hidden', 'false');
    this.splitBanner.classList.remove('is-active');
    void this.splitBanner.offsetWidth;
    this.splitBanner.classList.add('is-active');

    this.splitTimer = window.setTimeout(() => {
      this.splitTimer = null;
      this.hideSplit();
    }, SPLIT_BANNER_MS);
  }

  hideSplit(): void {
    if (this.splitTimer !== null) {
      window.clearTimeout(this.splitTimer);
      this.splitTimer = null;
    }

    this.splitBanner.classList.remove('is-active');
    this.splitBanner.hidden = true;
    this.splitBanner.setAttribute('aria-hidden', 'true');
  }

  setState(state: RaceState): void {
    this.currentState = state;
    this.root.dataset.state = state;
    this.hint.hidden = state !== 'READY';

    this.debugValues.state.textContent = state;
  }

  /** Mostra/esconde o overlay de recuperação (fade controlado por CSS). */
  setRecovery(active: boolean): void {
    this.recoveryOverlay.classList.toggle('is-active', active);
    this.recoveryOverlay.setAttribute('aria-hidden', active ? 'false' : 'true');
    this.recoveryOverlay.dataset.phase = active ? 'in' : 'off';
    this.recoveryText.textContent = 'RECUPERANDO...';
    this.recoverySub.textContent = 'PERDENDO TEMPO';
  }

  /**
   * Fase visual da recuperação. `out` inicia o fade de saída mantendo o
   * overlay no DOM; o fim (RUNNING) chama `setRecovery(false)`.
   */
  setRecoveryPhase(phase: RecoveryPhase): void {
    this.recoveryOverlay.dataset.phase = phase;
    this.recoverySub.textContent =
      phase === 'returning' ? 'VOLTANDO À PISTA' : 'PERDENDO TEMPO';

    if (phase === 'out') {
      this.recoveryOverlay.classList.remove('is-active');
      this.recoveryOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  /** Flash curto de borda/vinheta no impacto; não bloqueia a tela. */
  flashImpact(): void {
    if (this.impactTimer !== null) {
      window.clearTimeout(this.impactTimer);
      this.impactTimer = null;
    }

    // Reinicia a animação mesmo se um impacto anterior ainda estiver ativo.
    this.impactOverlay.classList.remove('is-active');
    void this.impactOverlay.offsetWidth;
    this.impactOverlay.classList.add('is-active');

    this.impactTimer = window.setTimeout(() => {
      this.impactTimer = null;
      this.impactOverlay.classList.remove('is-active');
    }, IMPACT_FLASH_MS);
  }

  /** Cancela o flash e o estado visual (reset, teleporte, recuperação). */
  clearImpact(): void {
    if (this.impactTimer !== null) {
      window.clearTimeout(this.impactTimer);
      this.impactTimer = null;
    }
    this.impactOverlay.classList.remove('is-active');
  }

  /**
   * Chips de powerup ativos com tempo restante. O `Game` chama no máximo
   * ~10 Hz; a lista vem do buffer reutilizado do `Powerups`.
   */
  setPowerups(active: readonly ActivePowerup[]): void {
    let turbo: ActivePowerup | null = null;
    let grip: ActivePowerup | null = null;

    for (const entry of active) {
      if (entry.type === 'turbo') {
        turbo = entry;
      } else {
        grip = entry;
      }
    }

    this.updatePowerupChip('turbo', turbo);
    this.updatePowerupChip('grip', grip);
    this.powerupsBar.hidden = turbo === null && grip === null;
  }

  /** Feedback curto de coleta: nome do powerup sobe e some (~0,75 s). */
  flashPowerup(type: PowerupType): void {
    if (this.powerupFlashTimer !== null) {
      window.clearTimeout(this.powerupFlashTimer);
      this.powerupFlashTimer = null;
    }

    this.powerupFlash.textContent = POWERUP_LABELS[type];
    this.powerupFlash.dataset.type = type;
    this.powerupFlash.hidden = false;
    this.powerupFlash.classList.remove('is-active');
    void this.powerupFlash.offsetWidth;
    this.powerupFlash.classList.add('is-active');

    this.powerupFlashTimer = window.setTimeout(() => {
      this.powerupFlashTimer = null;
      this.powerupFlash.hidden = true;
      this.powerupFlash.classList.remove('is-active');
    }, POWERUP_FLASH_MS);
  }

  /** Esconde chips e feedback; usado no reset, teleporte e chegada. */
  clearPowerups(): void {
    this.setPowerups([]);

    if (this.powerupFlashTimer !== null) {
      window.clearTimeout(this.powerupFlashTimer);
      this.powerupFlashTimer = null;
    }

    this.powerupFlash.hidden = true;
    this.powerupFlash.classList.remove('is-active');
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
    this.clearImpact();
    this.hideSplit();
    this.clearPowerups();
    this.resetButton.removeEventListener('click', this.handleReset);
    this.resetHandler = null;
  }

  private createPowerupChip(type: PowerupType): {
    root: HTMLElement;
    time: HTMLElement;
    fill: HTMLElement;
  } {
    const root = document.createElement('div');
    root.className = 'hud__powerup';
    root.dataset.type = type;
    root.hidden = true;

    const label = document.createElement('span');
    label.className = 'hud__powerup-label';
    label.textContent = POWERUP_LABELS[type];

    const time = document.createElement('span');
    time.className = 'hud__powerup-time';
    time.textContent = '0,0s';

    const bar = document.createElement('span');
    bar.className = 'hud__powerup-bar';

    const fill = document.createElement('i');
    fill.className = 'hud__powerup-fill';
    bar.append(fill);

    root.append(label, time, bar);
    return { root, time, fill };
  }

  private updatePowerupChip(
    type: PowerupType,
    entry: ActivePowerup | null,
  ): void {
    const chip = this.powerupChips[type];

    if (entry === null) {
      chip.root.hidden = true;
      this.lastPowerupText[type] = '';
      return;
    }

    chip.root.hidden = false;

    const remaining = Math.max(entry.remaining, 0);
    const text = `${remaining.toFixed(1).replace('.', ',')}s`;
    if (text !== this.lastPowerupText[type]) {
      this.lastPowerupText[type] = text;
      chip.time.textContent = text;
      chip.root.setAttribute(
        'aria-label',
        `${POWERUP_LABELS[type]} ${text} restantes`,
      );
    }

    const duration = Math.max(entry.duration, 0.001);
    const percent = clamp((remaining / duration) * 100, 0, 100);
    chip.fill.style.width = `${percent.toFixed(1)}%`;
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
    this.debugValues.offroad.textContent = debugInfo
      ? debugInfo.offRoad > 0.01
        ? `${formatNumber(debugInfo.offRoad, 1)} m`
        : '—'
      : '—';
    this.debugValues.obstacles.textContent = debugInfo
      ? String(debugInfo.obstacles)
      : '—';
    this.debugValues.impact.textContent =
      debugInfo && debugInfo.impact > 0
        ? `${formatNumber(debugInfo.impact, 1)} m/s`
        : '—';
    this.debugValues.powerups.textContent = debugInfo?.powerups ?? '—';
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
      `B${formatNumber(telemetry.brake, 1)} ` +
      `${telemetry.handbrake ? 'HB' : '—'}`;
    this.debugValues.position.textContent = this.lastPosition
      ? `${formatNumber(this.lastPosition.x, 1)}, ${formatNumber(this.lastPosition.z, 1)}`
      : '—';
  }

  private readonly handleReset = (): void => {
    this.resetHandler?.();
  };
}
