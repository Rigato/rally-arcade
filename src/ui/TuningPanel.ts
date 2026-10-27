import GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import {
  CAMERA_TUNING,
  CAR_TUNING,
  INPUT_TUNING,
  POWERUP_TUNING,
  RACE_TUNING,
  SURFACES,
} from '../game/config';
import { exportTuningJson, resetTuning, saveTuning } from '../game/tuningStore';
import type { Game } from '../game/Game';
import type { ForcedSurface, SurfaceId } from '../game/types';
import type { Hud } from './Hud';

const SAVE_DEBOUNCE_MS = 200;
const COPY_LABEL_MS = 1400;

const SURFACE_LABELS: Record<SurfaceId, string> = {
  gravel: 'Cascalho',
  sand: 'Areia',
  'forest-offroad': 'Fora — floresta',
  'desert-offroad': 'Fora — deserto',
};

const SURFACE_OPTIONS: Record<string, ForcedSurface> = {
  Automático: 'auto',
  Cascalho: 'gravel',
  Areia: 'sand',
  'Fora — floresta': 'forest-offroad',
  'Fora — deserto': 'desert-offroad',
};

export interface TuningPanelOptions {
  game: Game;
  hud: Hud;
}

/**
 * Painel de ajuste ao vivo (lil-gui), criado somente em modo debug.
 *
 * Todos os controles leem/escrevem os mesmos objetos mutáveis de `config.ts`
 * que a física, a câmera e o input usam — não há cópia intermediária. Cada
 * mudança agenda um save com debounce; storage indisponível é silencioso.
 *
 * O painel vive sobre o canvas, com `pointer-events: auto` apenas nele. Como o
 * Input só escuta o canvas (e ignora eventos dentro de `.lil-gui`), ajustar o
 * painel nunca acelera nem inicia o cronômetro.
 */
export class TuningPanel {
  private readonly game: Game;
  private readonly hud: Hud;
  private readonly gui: GUI;
  private readonly controllers: Controller[] = [];

  private copyController: Controller | null = null;
  private copyOverlay: HTMLElement | null = null;
  private saveTimer: number | null = null;
  private copyLabelTimer: number | null = null;

  constructor(options: TuningPanelOptions) {
    this.game = options.game;
    this.hud = options.hud;

    this.gui = new GUI({
      title: 'TUNING — RALLY',
      width: 300,
      closeFolders: true,
    });
    this.gui.domElement.id = 'tuning-panel';
    this.gui.domElement.classList.add('tuning-panel');
    this.gui.domElement.dataset.uiPanel = 'tuning';

    this.buildCarFolder();
    this.buildCameraFolder();
    this.buildInputFolder();
    this.buildSurfaceFolder();
    this.buildRaceFolder();
    this.buildDebugFolder();
  }

  /** Fecha e salva qualquer alteração ainda no debounce. */
  dispose(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      saveTuning();
    }

    if (this.copyLabelTimer !== null) {
      window.clearTimeout(this.copyLabelTimer);
      this.copyLabelTimer = null;
    }

    this.closeCopyOverlay();
    this.gui.destroy();
  }

  private buildCarFolder(): void {
    const folder = this.gui.addFolder('Carro');

    this.addNumber(folder, CAR_TUNING, 'engineAcceleration', 'Aceleração', 0, 20, 0.1);
    this.addNumber(folder, CAR_TUNING, 'maxSpeed', 'Velocidade máx.', 10, 60, 1);
    this.addNumber(folder, CAR_TUNING, 'dragCoefficient', 'Arrasto', 0, 0.02, 0.0005);
    this.addNumber(folder, CAR_TUNING, 'rollingResistance', 'Rolamento', 0, 5, 0.1);
    this.addNumber(folder, CAR_TUNING, 'maxYawRate', 'Guinada máx.', 0.5, 5, 0.1);
    this.addNumber(folder, CAR_TUNING, 'steerResponseTau', 'Resposta esterço', 0.01, 1, 0.01);
    this.addNumber(folder, CAR_TUNING, 'steerSpeedReference', 'Ref. velocidade', 1, 20, 0.5);
    this.addNumber(folder, CAR_TUNING, 'steerHighSpeedReduction', 'Redução alta vel.', 0, 1, 0.01);
    this.addNumber(folder, CAR_TUNING, 'brakeMax', 'Freio máx.', 0, 30, 0.5);
    this.addNumber(folder, CAR_TUNING, 'brakeRampStart', 'Rampa início', 0, 15, 0.5);
    this.addNumber(folder, CAR_TUNING, 'brakeRampDuration', 'Rampa duração', 0.05, 3, 0.01);
    this.addNumber(folder, CAR_TUNING, 'handbrakeGripMultiplier', 'HB grip ×', 0.05, 1, 0.01);
    this.addNumber(folder, CAR_TUNING, 'handbrakeBrake', 'HB frenagem', 0, 20, 0.5);
    this.addNumber(folder, CAR_TUNING, 'airGravity', 'Gravidade no ar', 0, 50, 0.5);
  }

  private buildCameraFolder(): void {
    const folder = this.gui.addFolder('Câmera');

    this.addNumber(folder, CAMERA_TUNING, 'distance', 'Distância', 4, 30, 0.5);
    this.addNumber(folder, CAMERA_TUNING, 'height', 'Altura', 2, 30, 0.5);
    this.addNumber(folder, CAMERA_TUNING, 'lookAhead', 'Look-ahead', 0, 20, 0.2);
    this.addNumber(folder, CAMERA_TUNING, 'lookHeight', 'Look height', 0, 5, 0.1);
    this.addNumber(folder, CAMERA_TUNING, 'positionTau', 'Posição tau', 0.01, 1, 0.01);
    this.addNumber(folder, CAMERA_TUNING, 'yawTau', 'Yaw tau', 0.01, 2, 0.01);
    this.addNumber(folder, CAMERA_TUNING, 'fov', 'FOV', 30, 100, 1);
    this.addNumber(folder, CAMERA_TUNING, 'speedFovBoost', 'FOV velocidade', 0, 20, 0.5);
    this.addNumber(folder, CAMERA_TUNING, 'turboFovBoost', 'FOV turbo', 0, 30, 0.5);
    this.addNumber(
      folder,
      CAMERA_TUNING,
      'minGroundClearance',
      'Folga do chão',
      0,
      10,
      0.5,
    );
  }

  private buildInputFolder(): void {
    const folder = this.gui.addFolder('Input');

    this.addNumber(
      folder,
      INPUT_TUNING,
      'steerLockScreenRatio',
      'Lock (tela)',
      0.05,
      0.6,
      0.01,
    );
    this.addNumber(folder, INPUT_TUNING, 'steerDeadzonePx', 'Deadzone (px)', 0, 40, 1);
    this.addNumber(
      folder,
      INPUT_TUNING,
      'steerSmoothingTau',
      'Suavização tau',
      0.01,
      0.5,
      0.01,
    );
    this.addNumber(
      folder,
      INPUT_TUNING,
      'handbrakeScreenRatio',
      'HB desloc. ×',
      0.5,
      2,
      0.05,
    );

    const modeController = folder
      .add(INPUT_TUNING, 'handbrakeMode', {
        Deslocamento: 'drag',
        Botão: 'button',
      })
      .name('Freio de mão');

    modeController.onChange(() => {
      this.game.setHandbrakeMode(INPUT_TUNING.handbrakeMode);
      this.scheduleSave();
    });
    this.controllers.push(modeController);
  }

  private buildSurfaceFolder(): void {
    const folder = this.gui.addFolder('Pisos');

    for (const id of Object.keys(SURFACES) as SurfaceId[]) {
      const surface = SURFACES[id];
      const surfaceFolder = folder.addFolder(SURFACE_LABELS[id]);

      this.addNumber(surfaceFolder, surface, 'grip', 'Grip', 0.5, 15, 0.1);
      this.addNumber(surfaceFolder, surface, 'acceleration', 'Aceleração', 0.2, 2, 0.05);
      this.addNumber(surfaceFolder, surface, 'drag', 'Arrasto', 0.2, 4, 0.05);
      this.addNumber(surfaceFolder, surface, 'bump', 'Bump', 0, 3, 0.1);
      this.addNumber(
        surfaceFolder,
        surface,
        'steerMultiplier',
        'Esterço ×',
        0.2,
        1.5,
        0.05,
      );
    }
  }

  private buildRaceFolder(): void {
    const folder = this.gui.addFolder('Powerups / Corrida');
    const powerups = folder.addFolder('Powerups');
    const race = folder.addFolder('Corrida');

    this.addNumber(
      powerups,
      POWERUP_TUNING,
      'turboSpeedMultiplier',
      'Turbo velocidade ×',
      1,
      2,
      0.05,
    );
    this.addNumber(
      powerups,
      POWERUP_TUNING,
      'turboAccelerationMultiplier',
      'Turbo aceleração ×',
      1,
      2,
      0.05,
    );
    this.addNumber(powerups, POWERUP_TUNING, 'turboDuration', 'Turbo duração', 0.5, 10, 0.1);
    this.addNumber(powerups, POWERUP_TUNING, 'gripMultiplier', 'Grip extra ×', 1, 3, 0.1);
    this.addNumber(powerups, POWERUP_TUNING, 'gripDuration', 'Grip duração', 1, 30, 0.5);

    this.addNumber(race, RACE_TUNING, 'splitTarget', 'Parcial alvo (s)', 5, 120, 0.5);
    this.addNumber(race, RACE_TUNING.medals, 'gold', 'Ouro (s)', 20, 180, 1);
    this.addNumber(race, RACE_TUNING.medals, 'silver', 'Prata (s)', 20, 180, 1);
    this.addNumber(race, RACE_TUNING.medals, 'bronze', 'Bronze (s)', 20, 180, 1);
    this.addNumber(race, RACE_TUNING, 'worldLimit', 'Limite do mundo', 5, 100, 1);
    this.addNumber(race, RACE_TUNING, 'recoveryPenalty', 'Penalidade (s)', 0, 10, 0.1);
  }

  private buildDebugFolder(): void {
    const folder = this.gui.addFolder('Debug');

    const debugState = {
      telemetry: this.hud.isDebugVisible(),
      surface: this.game.getForcedSurface() as string,
    };

    folder
      .add(debugState, 'telemetry')
      .name('Telemetria')
      .onChange((value: unknown) => {
        this.hud.setDebugVisible(Boolean(value));
      });

    folder
      .add(debugState, 'surface', SURFACE_OPTIONS)
      .name('Piso forçado')
      .onChange((value: unknown) => {
        const selected = Object.entries(SURFACE_OPTIONS).find(
          ([, surface]) => surface === value,
        );
        this.game.setForcedSurface(selected ? selected[1] : 'auto');
      });

    folder
      .add({ reposition: () => this.game.repositionCar() }, 'reposition')
      .name('↺ Reposicionar carro');

    this.copyController = folder
      .add({ copy: () => void this.copyJson() }, 'copy')
      .name('Copiar JSON');

    folder
      .add({ reset: () => this.resetAll() }, 'reset')
      .name('Resetar tuning');
  }

  private addNumber<T extends object>(
    folder: GUI,
    object: T,
    property: keyof T,
    label: string,
    min: number,
    max: number,
    step: number,
  ): void {
    const controller = folder.add(object, property, min, max, step).name(label);
    controller.onChange(this.handleTuningChange);
    this.controllers.push(controller);
  }

  private readonly handleTuningChange = (): void => {
    this.scheduleSave();
  };

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      saveTuning();
    }, SAVE_DEBOUNCE_MS);
  }

  private resetAll = (): void => {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    resetTuning();
    this.game.setHandbrakeMode(INPUT_TUNING.handbrakeMode);

    for (const controller of this.controllers) {
      controller.updateDisplay();
    }
  };

  private async copyJson(): Promise<void> {
    const json = exportTuningJson();

    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard indisponível');
      }

      await navigator.clipboard.writeText(json);
      this.flashCopyLabel('Copiado!');
    } catch {
      this.showCopyFallback(json);
    }
  }

  private flashCopyLabel(label: string): void {
    if (!this.copyController) {
      return;
    }

    this.copyController.name(label);

    if (this.copyLabelTimer !== null) {
      window.clearTimeout(this.copyLabelTimer);
    }

    this.copyLabelTimer = window.setTimeout(() => {
      this.copyLabelTimer = null;
      this.copyController?.name('Copiar JSON');
    }, COPY_LABEL_MS);
  }

  private showCopyFallback(json: string): void {
    this.closeCopyOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'tuning-copy';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Copiar tuning em JSON');

    const box = document.createElement('div');
    box.className = 'tuning-copy__box';

    const title = document.createElement('p');
    title.className = 'tuning-copy__title';
    title.textContent = 'COPIE O JSON';

    const textarea = document.createElement('textarea');
    textarea.className = 'tuning-copy__text';
    textarea.readOnly = true;
    textarea.spellcheck = false;
    textarea.value = json;
    textarea.setAttribute('aria-label', 'Tuning em JSON');

    const closeButton = document.createElement('button');
    closeButton.className = 'tuning-copy__close';
    closeButton.type = 'button';
    closeButton.textContent = 'FECHAR';
    closeButton.addEventListener('click', this.closeCopyOverlay);

    box.append(title, textarea, closeButton);
    overlay.append(box);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.closeCopyOverlay();
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeCopyOverlay();
      }
    });

    document.body.append(overlay);
    this.copyOverlay = overlay;

    textarea.focus();
    textarea.select();
  }

  private readonly closeCopyOverlay = (): void => {
    this.copyOverlay?.remove();
    this.copyOverlay = null;
  };
}
