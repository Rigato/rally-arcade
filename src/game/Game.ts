import * as THREE from 'three';
import { Car } from '../car/Car';
import { CarView } from '../car/CarView';
import { ChaseCamera } from '../camera/ChaseCamera';
import { Loop } from '../core/Loop';
import { DriftDust, type DriftDustState } from '../fx/DriftDust';
import { clamp } from '../core/math';
import { Input } from '../input/Input';
import { ForkMesh } from '../track/ForkMesh';
import { Gates } from '../track/Gates';
import { Hazards } from '../track/Hazards';
import { Obstacles } from '../track/Obstacles';
import { Powerups } from '../track/Powerups';
import { Track } from '../track/Track';
import { TrackMesh } from '../track/TrackMesh';
import { TRACK_01 } from '../track/track01';
import { generateProceduralTrack } from '../track/procedural/ProceduralTrack';
import { generateProceduralTrackV2 } from '../track/procedural/ProceduralTrackV2';
import { generateProceduralTrackV3 } from '../track/procedural/ProceduralTrackV3';
import { Hud, type HudDebugInfo } from '../ui/Hud';
import { Results } from '../ui/Results';
import { TrackMenu } from '../ui/TrackMenu';
import { TuningPanel } from '../ui/TuningPanel';
import { Environment } from '../world/Environment';
import { Scenery } from '../world/Scenery';
import {
  CAMERA_TUNING,
  CAR_TUNING,
  HAZARD_TUNING,
  INPUT_TUNING,
  RACE_TUNING,
  RENDER_SETTINGS,
  SIMULATION,
  SURFACES,
} from './config';
import { isDebugMode } from './debug';
import { Race } from './Race';
import { SCENARIOS, scenarioLabel } from './scenarios';
import type { CarState, ForcedSurface, RaceState, SurfaceId } from './types';

const FPS_SMOOTHING_TAU = 0.5;
/** Distância da faixa de chegada até o fim geométrico da spline (m). */
const FINISH_LINE_FROM_END = 3.5;
/** Intervalo entre parar o carro na chegada e abrir o resultado (s). */
const RESULT_DELAY_SECONDS = 0.5;
/** Fase em que o carro é recolocado (fração da recuperação total). */
const RECOVERY_TELEPORT_PHASE = 0.29;
/** Fase em que o fade de saída começa (fração da recuperação total). */
const RECOVERY_FADE_PHASE = 0.66;
/** Velocidade abaixo da qual o carro conta como preso (m/s). */
const UNSTUCK_SPEED = 0.8;
/** Tempo com acelerador e velocidade baixa para auto-recuperar (s). */
const UNSTUCK_TIME = 2.5;
/** Abaixo deste `s` o carro é considerado atrás da largada (m). */
const BEHIND_START_S = 1;
/** Intervalo de atualização dos chips de powerup no HUD (s). */
const POWERUP_HUD_INTERVAL = 0.1;

/** Integração do M3a: pista fixa, terreno, cenário, câmera, HUD e painel. */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly track: Track;
  private readonly trackMesh: TrackMesh;
  private readonly forkMesh: ForkMesh;
  private readonly gates: Gates;
  private readonly scenery: Scenery;
  private readonly obstacles: Obstacles;
  private readonly hazards: Hazards;
  private readonly powerups: Powerups;
  private readonly environment: Environment;
  private readonly car: Car;
  private readonly carView = new CarView();
  private readonly driftDust = new DriftDust();
  private readonly input: Input;
  private readonly chaseCamera: ChaseCamera;
  private readonly race: Race;
  private readonly hud: Hud;
  private readonly results: Results;
  private readonly trackMenu: TrackMenu;
  private readonly tuningPanel: TuningPanel | null;
  private readonly loop: Loop;
  private readonly resizeObserver: ResizeObserver | null;

  private readonly heightAt: (x: number, z: number) => number;
  private readonly cameraGroundAt: (x: number, z: number) => number;
  private readonly teleportPosition = new THREE.Vector3();

  /** Estado usado pela câmera no render (posição interpolada). */
  private readonly cameraState: CarState = {
    position: new THREE.Vector3(),
    heading: 0,
    velocity: new THREE.Vector3(),
    yawRate: 0,
    grounded: true,
    releaseTime: 0,
    speed: 0,
    groundNormal: new THREE.Vector3(0, 1, 0),
    terrainPitch: 0,
    terrainRoll: 0,
    airborne: false,
    verticalVelocity: 0,
    airTime: 0,
    lastAirTime: 0,
    landingImpact: 0,
    trackS: 0,
    trackU: 0,
  };

  /** Estado reutilizado pela poeira; nenhum objeto novo por frame. */
  private readonly dustState: DriftDustState = {
    position: new THREE.Vector3(),
    heading: 0,
    velocity: new THREE.Vector3(),
    speed: 0,
    slipAngle: 0,
    grounded: true,
    surfaceId: 'gravel',
  };

  private state: RaceState = 'READY';
  private started = false;
  private disposed = false;
  private pausedByVisibility = false;
  /** Menu de pistas aberto: congela simulação e cronômetro. */
  private menuOpen = false;

  /** Apresentação da chegada: carro parado, resultado abre após um respiro. */
  private resultPending = false;
  private resultDelayElapsed = 0;

  /** Recuperação em andamento (fases e reposicionamento). */
  private recoveryElapsed = 0;
  private recoveryTeleported = false;
  private recoveryFaded = false;
  /** `s` guardado no início da recuperação; o carro volta para o centro ali. */
  private recoveryS = 0;
  /** Tempo com acelerador mas sem sair do lugar (auto-unstick). */
  private unstickElapsed = 0;

  /** Piso forçado no debug; `auto` segue a zona da pista. */
  private forcedSurface: ForcedSurface = 'auto';
  /** Piso efetivamente usado no último passo fixo. */
  private currentSurfaceId: SurfaceId = 'gravel';
  /** Caminho ativo: -1 pista principal, >= 0 ramo de bifurcação. */
  private activePathId = -1;
  /** `s` dentro do caminho ativo (principal ou ramo). */
  private activePathS = 0;
  /** Histerese do ramo ativo para não piscar no início/fim da bifurcação. */
  private activeBranchS = 0;
  /** FPS suavizado exibido na telemetria. */
  private fps = 0;
  /** Intensidade da última colisão com obstáculo (m/s), para a telemetria. */
  private lastImpact = 0;
  /** Acumulador da atualização dos chips de powerup (~10 Hz). */
  private powerupHudElapsed = 0;

  constructor(container: HTMLElement, hudRoot: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_SETTINGS.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Pista de rally do Rally Arcade',
    );
    container.appendChild(this.renderer.domElement);

    const trackDef = resolveTrackDef();
    this.track = new Track(trackDef);
    // A pista manda nos tempos-alvo; o painel ainda pode ajustar em runtime.
    RACE_TUNING.medals.gold = trackDef.medals.gold;
    RACE_TUNING.medals.silver = trackDef.medals.silver;
    RACE_TUNING.medals.bronze = trackDef.medals.bronze;
    this.trackMesh = new TrackMesh(this.track);
    this.scene.add(this.trackMesh.group);
    this.forkMesh = new ForkMesh(this.track);
    this.scene.add(this.forkMesh.group);
    this.gates = new Gates(this.track);
    this.scene.add(this.gates.group);
    this.scenery = new Scenery(this.track);
    this.scene.add(this.scenery.group);
    this.obstacles = new Obstacles(this.track);
    this.scene.add(this.obstacles.group);
    this.hazards = new Hazards(this.track, readHazardsEnabled());
    HAZARD_TUNING.enabled = this.hazards.isEnabled();
    this.scene.add(this.hazards.group);
    this.powerups = new Powerups(this.track);
    this.scene.add(this.powerups.group);
    this.environment = new Environment(this.scene, this.track.def.zones);
    this.environment.update(this.track.startS);

    this.race = new Race({
      trackId: this.track.def.id,
      finishS: this.track.length - FINISH_LINE_FROM_END,
      splits: this.track.def.splits,
      tuning: RACE_TUNING,
    });

    this.car = new Car(CAR_TUNING);
    this.heightAt = (x, z) =>
      this.track.heightAtWorldMulti(
        x,
        z,
        this.car.state.trackS,
        this.activePathId,
        this.activeBranchS,
      );
    this.cameraGroundAt = (x, z) =>
      this.track.heightAtWorldMulti(
        x,
        z,
        this.car.state.trackS,
        this.activePathId,
        this.activeBranchS,
      );

    this.car.reset(this.track.startPose.position, this.track.startPose.heading);
    this.car.state.trackS = this.track.startS;
    this.car.state.trackU = 0;
    this.resetPathTracking(this.car.state.trackS);
    this.currentSurfaceId = this.track.surfaceAt(this.track.startS, 0);
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.scene.add(this.carView.root);
    this.scene.add(this.carView.shadow);
    this.scene.add(this.driftDust.points);

    this.chaseCamera = new ChaseCamera(undefined, this.cameraGroundAt);
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);

    this.hud = new Hud(hudRoot, {
      debug: isDebugMode(),
      onMenu: this.openMenu,
      track: {
        startS: this.track.startS,
        finishS: this.race.finishS,
        splits: this.race.splits,
      },
    });
    this.hud.setState(this.state);
    this.hud.setTime(0);
    this.hud.setBest(this.race.bestTime);
    this.hud.setTrackLabel(this.trackLabel());
    this.hud.onReset(this.reset);

    this.trackMenu = new TrackMenu(document.body);
    this.trackMenu.onSelectSeed((seed) => this.navigateToTrack('proc', seed));
    this.trackMenu.onSelectFixed(() => this.navigateToTrack('fixed'));
    this.trackMenu.onRandom(() => this.navigateToTrack('proc', randomTrackSeed()));
    this.trackMenu.onClose(this.handleMenuClosed);

    this.results = new Results(hudRoot);
    this.results.onRetry(this.reset);
    this.results.onChooseTrack(this.openMenu);

    this.input = new Input(this.renderer.domElement, {
      tuning: INPUT_TUNING,
      goButton: this.hud.goButton,
      // +1 = esquerda na tela; combos ◀F/▶F somam freio ao mesmo pointer.
      controls: [
        { element: this.hud.steerLeftButton, steer: 1 },
        { element: this.hud.steerRightButton, steer: -1 },
        { element: this.hud.leftBrakeButton, steer: 1, brake: true },
        { element: this.hud.rightBrakeButton, steer: -1, brake: true },
        { element: this.hud.brakeButton, brake: true },
      ],
      onRaceStart: this.handleRaceStart,
      onReset: this.reset,
      onToggleTelemetry: () => {
        this.hud.toggleDebug();
      },
    });

    this.tuningPanel = isDebugMode()
      ? new TuningPanel({ game: this, hud: this.hud })
      : null;

    this.loop = new Loop(
      this.update,
      this.render,
      SIMULATION.fixedHz,
      SIMULATION.maxFrameDeltaSeconds,
    );

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.resize);
    this.resizeObserver?.observe(container);

    this.applyDebugStartS();
    this.applyDebugStartBranch();

    // Hook só de QA: `?debug=1` expõe a contagem da poeira para os testes
    // headless sem alterar a API pública do jogo.
    if (isDebugMode()) {
      const dust = this.driftDust;
      const hazards = this.hazards;
      const currentCarS = (): number => this.car.state.trackS;
      const currentPathId = (): number => this.activePathId;
      const currentPathS = (): number => this.activePathS;
      const currentTrackU = (): number => this.car.state.trackU;
      (
        window as Window & {
          __rallyDust?: { readonly activeCount: number };
          __rallyHazards?: {
            readonly count: number;
            readonly activeCount: number;
            readonly enabled: boolean;
            readonly nextS: number | null;
          };
          __rallyPath?: {
            readonly pathId: number;
            readonly pathS: number;
            readonly mainS: number;
            readonly u: number;
          };
        }
      ).__rallyDust = {
        get activeCount(): number {
          return dust.activeCount;
        },
      };
      (
        window as Window & {
          __rallyHazards?: {
            readonly count: number;
            readonly activeCount: number;
            readonly enabled: boolean;
            readonly nextS: number | null;
          };
          __rallyPath?: {
            readonly pathId: number;
            readonly pathS: number;
            readonly mainS: number;
            readonly u: number;
          };
        }
      ).__rallyHazards = {
        get count(): number {
          return hazards.getCount();
        },
        get activeCount(): number {
          return hazards.getActiveCount();
        },
        get enabled(): boolean {
          return hazards.isEnabled();
        },
        get nextS(): number | null {
          return hazards.getNextS(currentCarS(), currentPathId() + 1);
        },
      };
      (
        window as Window & {
          __rallyPath?: {
            readonly pathId: number;
            readonly pathS: number;
            readonly mainS: number;
            readonly u: number;
          };
        }
      ).__rallyPath = {
        get pathId(): number {
          return currentPathId();
        },
        get pathS(): number {
          return currentPathS();
        },
        get mainS(): number {
          return currentCarS();
        },
        get u(): number {
          return currentTrackU();
        },
      };
    }
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.loop.start();
  }

  /** Abre o menu de pistas; congela simulação e cronômetro. */
  private readonly openMenu = (): void => {
    if (this.menuOpen || this.disposed) {
      return;
    }

    this.menuOpen = true;
    this.hud.setMenuOpen(true);
    this.trackMenu.open(this.currentTrackInfo());

    if (this.state === 'RUNNING' || this.state === 'RECOVERING') {
      this.input.cancelAll();
      this.input.setRaceActive(false);
    }
  };

  private readonly handleMenuClosed = (): void => {
    if (!this.menuOpen) {
      return;
    }

    this.menuOpen = false;
    this.hud.setMenuOpen(false);

    if (this.state === 'RUNNING') {
      this.input.setRaceActive(true);
    }
  };

  private currentTrackInfo(): { id: string; seed: number | null; label: string } {
    const match = /^proc-(\d+)$/.exec(this.track.def.id);
    return {
      id: this.track.def.id,
      seed: match ? Number(match[1]) : null,
      label: this.trackLabel(),
    };
  }

  private trackLabel(): string {
    const scenarios = this.track.def.zones
      .map((zone) => SCENARIOS[zone.id].shortLabel)
      .join(' · ');
    return `${this.track.def.id} · ${scenarios}`;
  }

  private navigateToTrack(mode: 'proc' | 'fixed', seed?: number): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('s');
    url.searchParams.delete('seed');
    url.searchParams.set('track', mode === 'fixed' ? 'fixed' : 'proc');

    if (mode === 'proc' && seed !== undefined) {
      url.searchParams.set('seed', String(clamp(Math.round(seed), 1, 100)));
    }

    window.location.assign(url.toString());
  }

  /** Piso escolhido no painel de debug (`auto` = piso da zona da pista). */
  getForcedSurface(): ForcedSurface {
    return this.forcedSurface;
  }

  setForcedSurface(surface: ForcedSurface): void {
    if (surface !== 'auto' && !(surface in SURFACES)) {
      return;
    }

    this.forcedSurface = surface;
  }

  /** Superfície efetiva usada pela física no último passo. */
  getCurrentSurfaceId(): SurfaceId {
    return this.currentSurfaceId;
  }

  getTrackLength(): number {
    return this.track.length;
  }

  getTrackS(): number {
    return this.car.state.trackS;
  }

  getObstacleCount(): number {
    return this.obstacles.getCount();
  }

  getHazardCount(): number {
    return this.hazards.getCount();
  }

  areHazardsEnabled(): boolean {
    return this.hazards.isEnabled();
  }

  setHazardsEnabled(enabled: boolean): void {
    HAZARD_TUNING.enabled = enabled;
    this.hazards.setEnabled(enabled);
  }

  /** Teleporta para ~70 m antes do próximo hazard e retorna o `s` dele. */
  teleportToNextHazard(): number | null {
    const target = this.hazards.getNextTarget(
      this.car.state.trackS,
      this.activePathId + 1,
    );
    if (!target) {
      return null;
    }
    if (target.pathId > 0) {
      const branch = this.track.branches[target.pathId - 1];
      if (branch) {
        this.teleportToBranch(
          target.pathId - 1,
          clamp((target.localS - 70) / branch.length, 0, 1),
        );
        return target.logicalS;
      }
    }
    this.teleportToS(Math.max(0, target.logicalS - 70));
    return target.logicalS;
  }

  /** Wireframe dos colisores (debug, desligado por padrão). */
  setObstacleCollidersVisible(visible: boolean): void {
    this.obstacles.setColliderDebugVisible(visible);
  }

  /**
   * Teleporte de debug para ~14 m antes do próximo obstáculo à frente.
   * Retorna o `s` do obstáculo escolhido (ou null se não houver).
   */
  teleportToNextObstacle(): number | null {
    const obstacle = this.obstacles.getNextObstacle(this.car.state.trackS);
    if (!obstacle) {
      return null;
    }

    const target = clamp(obstacle.s - 14, 0, this.track.length);
    this.teleportToS(target);
    return obstacle.s;
  }

  /** Coloca o carro de volta na largada (mesmo fluxo do botão de reinício). */
  repositionCar(): void {
    this.reset();
  }

  /** Teleporte de debug para o centro da pista em `s`, alinhado à tangente. */
  teleportToS(s: number): void {
    const target = clamp(s, 0, this.track.length);
    const sample = this.track.sampleAt(target);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

    this.teleportPosition.set(
      sample.position.x,
      this.track.heightAt(target, 0),
      sample.position.z,
    );

    this.cancelRecovery();
    this.input.reset();
    this.input.setRaceActive(false);
    this.car.reset(this.teleportPosition, heading);
    this.car.state.trackS = target;
    this.car.state.trackU = 0;
    this.resetPathTracking(this.car.state.trackS);
    this.currentSurfaceId = this.track.surfaceAt(target, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.driftDust.reset();
    this.hazards.reset();
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.environment.update(target);
    this.powerups.reset();
    this.chaseCamera.setFovBoost(0);
    this.hud.clearPowerups();
    this.powerupHudElapsed = 0;

    // Teleporte de debug é um estado limpo de teste: volta para READY e zera
    // o cronômetro, senão a corrida ficaria RUNNING sem ter começado no lugar.
    // O melhor tempo é preservado; uma parcial já ultrapassada fica pulada.
    this.race.reset(target);
    this.hideResult();
    this.state = 'READY';
    this.hud.hideSplit();
    this.hud.setTime(0);
    this.hud.setBest(this.race.bestTime);
    this.hud.setProgress(target);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
  }

  /**
   * Teleporte de debug para um ramo de bifurcação. `ratio` 0 = entrada,
   * 1 = saída. Útil para validar a transição de física sem dirigir o fork
   * inteiro.
   */
  teleportToBranch(pathId: number, ratio = 0.5): boolean {
    const branch = this.track.branches[pathId];
    if (!branch) {
      return false;
    }

    const clampedRatio = clamp(ratio, 0, 1);
    const pathS = branch.length * clampedRatio;
    const sample = branch.sampleAt(pathS);
    const mainS =
      branch.startS + (branch.endS - branch.startS) * clampedRatio;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

    this.teleportPosition.set(
      sample.position.x,
      branch.heightAt(pathS, 0),
      sample.position.z,
    );

    this.cancelRecovery();
    this.input.reset();
    this.input.setRaceActive(false);
    this.car.reset(this.teleportPosition, heading);
    this.car.state.trackS = mainS;
    this.car.state.trackU = 0;
    this.activePathId = pathId;
    this.activePathS = pathS;
    this.activeBranchS = pathS;
    this.currentSurfaceId = branch.surfaceAt(pathS, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.driftDust.reset();
    this.hazards.reset();
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.environment.update(mainS);
    this.powerups.reset();
    this.chaseCamera.setFovBoost(0);
    this.hud.clearPowerups();
    this.powerupHudElapsed = 0;

    this.race.reset(mainS);
    this.hideResult();
    this.state = 'READY';
    this.hud.hideSplit();
    this.hud.setTime(0);
    this.hud.setBest(this.race.bestTime);
    this.hud.setProgress(mainS);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.loop.stop();
    this.tuningPanel?.dispose();
    this.input.dispose();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver?.disconnect();
    this.results.dispose();
    this.trackMenu.dispose();
    this.hud.dispose();

    this.trackMesh.dispose();
    this.forkMesh.dispose();
    this.gates.dispose();
    this.scenery.dispose();
    this.obstacles.dispose();
    this.hazards.dispose();
    this.powerups.dispose();
    this.driftDust.dispose();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      }
    });

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly handleRaceStart = (): void => {
    if (this.state !== 'READY') {
      return;
    }

    this.state = 'RUNNING';
    this.input.setRaceActive(true);
    this.hud.setState(this.state);
  };

  /** Volta a física para a pista principal em `s`. */
  private resetPathTracking(s: number): void {
    this.activePathId = -1;
    this.activePathS = s;
    this.activeBranchS = 0;
  }

  private readonly reset = (): void => {
    this.cancelRecovery();
    this.input.reset();
    this.input.setRaceActive(false);
    this.car.reset(this.track.startPose.position, this.track.startPose.heading);
    this.car.state.trackS = this.track.startS;
    this.car.state.trackU = 0;
    this.resetPathTracking(this.car.state.trackS);
    this.currentSurfaceId = this.track.surfaceAt(this.track.startS, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.driftDust.reset();
    this.hazards.reset();
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.environment.update(this.track.startS);
    this.powerups.reset();
    this.chaseCamera.setFovBoost(0);
    this.hud.clearPowerups();
    this.powerupHudElapsed = 0;

    this.race.reset();
    this.hideResult();
    this.state = 'READY';
    this.hud.hideSplit();
    this.hud.setTime(0);
    this.hud.setBest(this.race.bestTime);
    this.hud.setProgress(this.track.startS);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
  };

  private readonly update = (fixedDt: number): void => {
    // Menu aberto: o render continua, mas simulação e cronômetro congelam.
    if (this.menuOpen) {
      return;
    }

    // Na chegada a física para; só corre o respiro antes de abrir o resultado.
    if (this.state === 'FINISHED') {
      this.updateFinishPresentation(fixedDt);
      return;
    }

    // O relógio só anda com a corrida ativa. Em RECOVERING ele continua
    // correndo (penalidade), mas a física fica congelada.
    if (this.state === 'RUNNING' || this.state === 'RECOVERING') {
      this.race.tick(fixedDt);
    }

    if (this.state === 'RECOVERING') {
      this.updateRecovery(fixedDt);
      return;
    }

    this.input.update(fixedDt);

    if (this.state === 'RUNNING') {
      this.powerups.update(fixedDt);
    } else {
      // READY: os pickups continuam girando/flutuando, mas sem timers.
      this.powerups.animate(fixedDt);
    }

    const state = this.car.state;
    if (this.state === 'RUNNING') {
      this.hazards.update(fixedDt, state.trackS, this.activePathId + 1);
    }
    const before = this.track.projectNearest(
      state.position.x,
      state.position.z,
      state.trackS,
      this.activePathId,
      this.activeBranchS,
    );
    this.activePathId = before.pathId;
    this.activePathS = before.pathS;
    this.activeBranchS = before.pathS;
    const trackSurface = this.track.surfaceAtPath(
      before.pathId + 1,
      before.pathS,
      before.u,
    );
    const surfaceId = this.forcedSurface === 'auto' ? trackSurface : this.forcedSurface;
    this.currentSurfaceId = surfaceId;

    this.car.step(
      fixedDt,
      this.input.inputState,
      SURFACES[surfaceId],
      this.heightAt,
      this.powerups.getModifiers(),
    );

    // Colisão com obstáculos sólidos: push-out + ricochete. Acontece antes da
    // projeção em (s,u), então a recuperação e a telemetria já leem a posição
    // corrigida. O carro não é teletransportado: só sai da sobreposição.
    const obstacleImpact = this.obstacles.resolveCollisions(this.car);
    const hazardImpact = this.hazards.resolveCollisions(this.car);
    const impact = Math.max(obstacleImpact, hazardImpact);
    if (impact > 0) {
      this.lastImpact = impact;
      this.chaseCamera.addShake(clamp(impact / 25, 0.05, 0.35));
      this.hud.flashImpact();
      this.carView.impact(impact);
    }

    // Coleta só com a corrida ativa (nunca em READY/RECOVERING/FINISHED).
    // Ativar/renovar acontece na hora; o HUD recebe o novo estado sem
    // esperar o próximo tick de 0,1 s.
    if (this.state === 'RUNNING') {
      const collected = this.powerups.checkCollect(state.position);
      if (collected) {
        this.hud.flashPowerup(collected);
        this.hud.setPowerups(this.powerups.getActive());
      }
    }

    const after = this.track.projectNearest(
      state.position.x,
      state.position.z,
      before.mainS,
      before.pathId,
      before.pathS,
    );
    this.activePathId = after.pathId;
    this.activePathS = after.pathS;
    this.activeBranchS = after.pathS;
    state.trackS = after.mainS;
    state.trackU = after.u;

    this.environment.update(state.trackS);
    this.updateRumble();

    if (this.state === 'RUNNING') {
      let split = this.race.checkSplit(after.mainS);
      while (split) {
        this.hud.showSplit(split);
        split = this.race.checkSplit(after.mainS);
      }

      if (this.race.checkFinish(after.mainS)) {
        this.finishRace();
        return;
      }
    }

    this.updateRecoveryTriggers(fixedDt);
  };

  /**
   * Chegada: para o relógio (o Race já marcou), cancela todo input e congela
   * o carro. O resultado só abre depois de um respiro curto para o jogador
   * registrar o cruzamento da faixa.
   */
  private finishRace(): void {
    if (this.state === 'FINISHED') {
      return;
    }

    this.state = 'FINISHED';
    this.input.cancelAll();
    this.input.setRaceActive(false);
    this.driftDust.reset();
    this.hazards.reset();
    this.chaseCamera.setRumble(0);
    this.powerups.clearEffects();
    this.chaseCamera.setFovBoost(0);
    this.hud.clearPowerups();
    this.powerupHudElapsed = 0;
    this.resetImpactFeedback();

    const state = this.car.state;
    state.velocity.set(0, 0, 0);
    state.speed = 0;
    state.yawRate = 0;
    this.car.telemetry.speed = 0;
    this.car.telemetry.longitudinalSpeed = 0;
    this.car.telemetry.lateralSpeed = 0;
    this.car.telemetry.slipAngle = 0;
    this.car.snapRenderPose();

    this.resultPending = true;
    this.resultDelayElapsed = 0;

    this.hud.hideSplit();
    this.hud.setState(this.state);
    this.hud.setTime(this.race.elapsed);
    this.hud.setBest(this.race.bestTime);
    this.hud.setProgress(this.race.finishS);
    this.hud.setTelemetry(this.car.telemetry, state.position, this.debugInfo);
  }

  private updateFinishPresentation(dt: number): void {
    if (!this.resultPending) {
      return;
    }

    this.resultDelayElapsed += dt;
    if (this.resultDelayElapsed < RESULT_DELAY_SECONDS) {
      return;
    }

    this.resultPending = false;
    this.results.show(this.race.snapshot());
  }

  private hideResult(): void {
    this.resultPending = false;
    this.resultDelayElapsed = 0;
    this.results.hide();
  }

  /**
   * Inicia a recuperação (limite do mundo, atrás da largada ou carro preso).
   * Idempotente: só age em RUNNING e cancela inputs, para o carro congelar.
   */
  private startRecovery(): void {
    if (this.state !== 'RUNNING') {
      return;
    }

    const state = this.car.state;

    this.state = 'RECOVERING';
    this.driftDust.reset();
    this.hazards.reset();
    this.recoveryElapsed = 0;
    this.recoveryTeleported = false;
    this.recoveryFaded = false;
    // Atrás da largada, volta para a posição de largada; senão, mantém o `s`.
    this.recoveryS = clamp(state.trackS, this.track.startS, this.track.length);
    this.unstickElapsed = 0;

    // "Pare a física": sem input, sem velocidade e sem rumbling da câmera.
    this.input.cancelAll();
    this.input.setRaceActive(false);
    state.velocity.set(0, 0, 0);
    state.speed = 0;
    state.yawRate = 0;
    this.car.telemetry.speed = 0;
    this.chaseCamera.setRumble(0);
    this.resetImpactFeedback();

    this.hud.setRecovery(true);
    this.hud.setState(this.state);
  }

  /** Cancela a recuperação (reset, teleporte de debug) e limpa o overlay. */
  private cancelRecovery(): void {
    this.recoveryElapsed = 0;
    this.recoveryTeleported = false;
    this.recoveryFaded = false;
    this.unstickElapsed = 0;
    this.chaseCamera.setRumble(0);
    this.hud.setRecovery(false);
    this.resetImpactFeedback();
  }

  /** Limpa o feedback transitório de impacto (reset, teleporte, recuperação). */
  private resetImpactFeedback(): void {
    this.lastImpact = 0;
    this.hud.clearImpact();
  }

  /**
   * Fases da recuperação, escaladas pela duração de `recoveryPenalty`:
   * reposiciona em ~29% (≈0,35 s), começa o fade em ~66% (≈0,8 s) e volta a
   * RUNNING no fim (≈1,2 s). O cronômetro soma durante todo o processo.
   */
  private updateRecovery(dt: number): void {
    const duration = Math.max(RACE_TUNING.recoveryPenalty, 0.2);
    this.recoveryElapsed += dt;

    if (!this.recoveryTeleported && this.recoveryElapsed >= duration * RECOVERY_TELEPORT_PHASE) {
      this.teleportAfterRecovery();
    }

    if (
      this.recoveryTeleported &&
      !this.recoveryFaded &&
      this.recoveryElapsed >= duration * RECOVERY_FADE_PHASE
    ) {
      this.recoveryFaded = true;
      this.hud.setRecoveryPhase('out');
    }

    if (this.recoveryElapsed >= duration) {
      this.state = 'RUNNING';
      this.unstickElapsed = 0;
      this.input.setRaceActive(true);
      this.hud.setRecovery(false);
      this.hud.setState(this.state);
    }
  }

  /** Recoloca o carro no centro da pista, no `s` guardado, olhando adiante. */
  private teleportAfterRecovery(): void {
    const target = clamp(this.recoveryS, 0, this.track.length);
    const sample = this.track.sampleAt(target);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

    this.teleportPosition.set(
      sample.position.x,
      this.track.heightAt(target, 0),
      sample.position.z,
    );

    this.input.cancelAll();
    this.car.reset(this.teleportPosition, heading);
    this.car.state.trackS = target;
    this.car.state.trackU = 0;
    this.resetPathTracking(this.car.state.trackS);
    this.currentSurfaceId = this.track.surfaceAt(target, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.driftDust.reset();
    this.hazards.reset();
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.chaseCamera.setRumble(0);
    this.environment.update(target);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);

    this.recoveryTeleported = true;
    this.hud.setRecoveryPhase('returning');
  }

  /**
   * Trepidação contínua: distância lateral além da borda × velocidade,
   * escalada pelo `bump` do piso atual (areia e fora de pista sacodem mais).
   */
  private updateRumble(): void {
    const state = this.car.state;
    const half = this.track.widthAtPath(this.activePathId + 1, this.activePathS) * 0.5;
    const distanceBeyond = Math.max(0, Math.abs(state.trackU) - half);
    const offRoad = this.currentSurfaceId.endsWith('-offroad')
      ? distanceBeyond
      : 0;
    const surfaceBump = SURFACES[this.currentSurfaceId].bump;
    const bumpFactor = clamp(0.7 + 0.25 * surfaceBump, 0.7, 1.2);
    const intensity =
      clamp(offRoad / Math.max(RACE_TUNING.offTrackLimit, 0.1), 0, 1) *
      clamp(state.speed / 15, 0, 1) *
      bumpFactor;

    // No ar o chão não está batendo no carro: o shake de pouso entra no render.
    this.chaseCamera.setRumble(state.grounded ? intensity : 0);
  }

  /**
   * Limite do mundo baseado na borda (ombro de 12 m) e auto-unstick: acelerar
   * contra algo por 2,5 s sem sair de ~0,8 m/s também dispara a recuperação.
   */
  private updateRecoveryTriggers(dt: number): void {
    if (this.state !== 'RUNNING') {
      this.unstickElapsed = 0;
      return;
    }

    const state = this.car.state;
    const half = this.track.widthAtPath(this.activePathId + 1, this.activePathS) * 0.5;
    const beyondEdge = this.currentSurfaceId.endsWith('-offroad')
      ? Math.abs(state.trackU) - half
      : 0;

    if (beyondEdge > RACE_TUNING.offTrackLimit || state.trackS < BEHIND_START_S) {
      this.startRecovery();
      return;
    }

    if (this.input.inputState.throttle && state.speed < UNSTUCK_SPEED) {
      this.unstickElapsed += dt;
    } else {
      this.unstickElapsed = 0;
    }

    if (this.unstickElapsed >= UNSTUCK_TIME) {
      this.startRecovery();
    }
  }

  private readonly render = (alpha: number, frameDt: number): void => {
    if (frameDt > 0) {
      const instantFps = 1 / frameDt;
      const alphaFps = 1 - Math.exp(-frameDt / FPS_SMOOTHING_TAU);
      this.fps = this.fps > 0 ? this.fps + (instantFps - this.fps) * alphaFps : instantFps;
    }

    const pose = this.car.getRenderPose(alpha);
    this.carView.setPose(
      pose.position,
      pose.heading,
      this.car.state.terrainPitch,
      this.car.state.terrainRoll,
    );
    const groundY = this.track.heightAtWorldMulti(
      pose.position.x,
      pose.position.z,
      this.car.state.trackS,
      this.activePathId,
      this.activeBranchS,
    );
    const landingImpact = frameDt > 0 ? this.car.consumeLandingImpact() : 0;

    // Pousos fortes também sacodem a câmera (barato e ajuda a ler o salto).
    if (landingImpact < -6) {
      this.chaseCamera.addShake(clamp((-landingImpact - 6) / 18, 0, 1) * 0.6);
    }

    this.carView.update(frameDt, {
      speed: this.car.telemetry.speed,
      steer: this.input.inputState.steer,
      lateralAccel: this.car.telemetry.lateralAcceleration,
      longAccel: this.car.telemetry.longitudinalAcceleration,
      handbrake: this.input.inputState.handbrake,
      grounded: this.car.state.grounded,
      groundY,
      verticalVelocity: this.car.state.verticalVelocity,
      airborne: this.car.state.airborne,
      landingImpact,
    });

    // A poeira usa a pose interpolada para não tremer em relação ao carro.
    this.dustState.position.copy(pose.position);
    this.dustState.heading = pose.heading;
    this.dustState.velocity.copy(this.car.state.velocity);
    this.dustState.speed = this.car.state.speed;
    this.dustState.slipAngle = this.car.telemetry.slipAngle;
    this.dustState.grounded = this.car.state.grounded;
    this.dustState.surfaceId = this.currentSurfaceId;
    this.driftDust.setProjection(
      this.renderer.domElement.height,
      this.chaseCamera.camera.fov,
    );
    this.driftDust.update(frameDt, this.dustState);

    this.cameraState.position.copy(pose.position);
    this.cameraState.heading = pose.heading;
    this.cameraState.velocity.copy(this.car.state.velocity);
    this.cameraState.speed = this.car.state.speed;
    this.cameraState.yawRate = this.car.state.yawRate;
    this.cameraState.grounded = this.car.state.grounded;
    this.cameraState.groundNormal.copy(this.car.state.groundNormal);
    this.cameraState.terrainPitch = this.car.state.terrainPitch;
    this.cameraState.terrainRoll = this.car.state.terrainRoll;
    this.cameraState.airborne = this.car.state.airborne;
    this.cameraState.verticalVelocity = this.car.state.verticalVelocity;
    this.cameraState.trackS = this.car.state.trackS;
    this.cameraState.trackU = this.car.state.trackU;
    this.chaseCamera.setFovBoost(
      this.powerups.isActive('turbo') ? CAMERA_TUNING.turboFovBoost : 0,
    );
    this.chaseCamera.update(frameDt, this.cameraState);

    this.hud.setTime(this.race.elapsed);
    this.hud.setSpeed(this.state === 'FINISHED' ? 0 : this.car.telemetry.speed * 3.6);
    this.hud.setProgress(
      this.state === 'FINISHED' ? this.race.finishS : this.car.state.trackS,
    );

    this.powerupHudElapsed += frameDt;
    if (this.powerupHudElapsed >= POWERUP_HUD_INTERVAL) {
      this.powerupHudElapsed = 0;
      this.hud.setPowerups(this.powerups.getActive());
    }

    this.hud.setTelemetry(this.car.telemetry, pose.position, this.debugInfo);

    this.renderer.render(this.scene, this.chaseCamera.camera);
  };

  private get debugInfo(): HudDebugInfo {
    const state = this.car.state;
    return {
      fps: this.fps,
      surface: SURFACES[this.currentSurfaceId].label,
      s: state.trackS,
      u: state.trackU,
      y: state.position.y,
      zone: scenarioLabel(
        this.track.zoneAtPath(this.activePathId + 1, this.activePathS),
      ).toUpperCase(),
      offRoad: Math.max(
        0,
        Math.abs(state.trackU) -
          this.track.widthAtPath(this.activePathId + 1, this.activePathS) * 0.5,
      ),
      obstacles: this.obstacles.getCount(),
      hazards:
        `${this.hazards.getCount()} total · ` +
        `${this.hazards.getActiveCount()} ativo(s) · ` +
        `${this.hazards.isEnabled() ? 'ON' : 'OFF'}`,
      path:
        this.activePathId < 0
          ? 'rota A'
          : `rota ${this.activePathId + 2} (${this.activePathS.toFixed(0)} m)`,
      impact: this.lastImpact,
      powerups: this.describePowerups(),
    };
  }

  private describePowerups(): string {
    const active = this.powerups.getActive();
    if (active.length === 0) {
      return '—';
    }

    const modifiers = this.powerups.getModifiers();
    let text = '';
    for (const entry of active) {
      if (text.length > 0) {
        text += ' · ';
      }
      text += `${entry.type.toUpperCase()} ${entry.remaining.toFixed(1)}s`;
    }

    return (
      `${text} | V×${modifiers.maxSpeedMultiplier.toFixed(2)} ` +
      `A×${modifiers.accelerationMultiplier.toFixed(2)} ` +
      `G×${modifiers.gripMultiplier.toFixed(2)}`
    );
  }

  /** `?debug=1&s=150` abre já teleportado — útil para revisar a pista inteira. */
  private applyDebugStartS(): void {
    if (!isDebugMode()) {
      return;
    }

    const raw = new URLSearchParams(window.location.search).get('s');
    if (raw === null) {
      return;
    }

    const value = Number(raw);
    if (Number.isFinite(value)) {
      this.teleportToS(value);
    }
  }

  /**
   * `?debug=1&branch=0&bt=0.9` teleporta para um ramo de bifurcação
   * (0 = entrada, 1 = saída). QA da transição de física no merge.
   */
  private applyDebugStartBranch(): void {
    if (!isDebugMode()) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const rawBranch = params.get('branch');
    if (rawBranch === null) {
      return;
    }

    const branchId = Number(rawBranch);
    const rawRatio = params.get('bt');
    const ratio = rawRatio === null ? 0.5 : Number(rawRatio);
    if (Number.isFinite(branchId) && Number.isFinite(ratio)) {
      this.teleportToBranch(Math.floor(branchId), ratio);
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.started && !this.disposed) {
        this.pausedByVisibility = true;
        this.loop.stop();
      }
      this.input.cancelAll();
      return;
    }

    if (this.pausedByVisibility) {
      this.pausedByVisibility = false;

      if (this.started && !this.disposed) {
        // Loop.start reseta lastTime/accumulator: o tempo oculto não acumula.
        this.loop.start();
      }
    }
  };

  private readonly resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_SETTINGS.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.chaseCamera.resize(width / height);
  };
}

const TRACK_SEED_MIN = 1;
const TRACK_SEED_MAX = 100;

/** Seed explícita válida (1–100) ou `null` quando ausente/fora do intervalo. */
function parseTrackSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }

  const seed = Math.floor(value);
  return seed >= TRACK_SEED_MIN && seed <= TRACK_SEED_MAX ? seed : null;
}

function randomTrackSeed(): number {
  return TRACK_SEED_MIN + Math.floor(Math.random() * (TRACK_SEED_MAX - TRACK_SEED_MIN + 1));
}

/**
 * `?hazards=0` desliga os obstáculos móveis; `1`/ausente liga.
 * `force` liga e é tratado como modo de QA (a telemetria expõe os hazards).
 */
function readHazardsEnabled(): boolean {
  const raw = new URLSearchParams(window.location.search).get('hazards');
  if (raw === '0' || raw === 'off' || raw === 'false') {
    return false;
  }
  return true;
}

/**
 * Pista procedural por padrão: abrir o jogo sem `track` sorteia uma seed 1–100
 * a cada reload (a URL não é reescrita). `?track=proc&seed=N` é determinística e
 * compartilhável; `?track=fixed` carrega a pista fixa. Se a geração falhar,
 * volta para a pista fixa sem quebrar o boot.
 */
function resolveTrackDef(): typeof TRACK_01 {
  const params = new URLSearchParams(window.location.search);
  const track = params.get('track');

  if (track === 'fixed') {
    console.info('[Game] pista fixa track01-v3.');
    return TRACK_01;
  }

  if (track === 'proc' || track === null) {
    const seed = parseTrackSeed(params.get('seed')) ?? randomTrackSeed();
    const rawVersion = params.get('gen');
    const version = rawVersion === 'v1' ? 1 : rawVersion === 'v2' ? 2 : 3;

    if (version === 3) {
      try {
        const generated = generateProceduralTrackV3(seed);
        console.info(
          `[Game] pista procedural v3 seed=${seed} (${generated.id}).`,
        );
        return generated;
      } catch (error) {
        console.warn(
          '[Game] falha no gerador procedural v3; tentando a v2.',
          error,
        );
      }
    }

    if (version >= 2) {
      try {
        const generated = generateProceduralTrackV2(seed);
        console.info(
          `[Game] pista procedural v2 seed=${seed} (${generated.id}).`,
        );
        return generated;
      } catch (error) {
        console.warn(
          '[Game] falha no gerador procedural v2; tentando a v1.',
          error,
        );
      }
    }

    try {
      const generated = generateProceduralTrack(seed);
      console.info(
        `[Game] pista procedural v1 seed=${seed} (${generated.id}).`,
      );
      return generated;
    } catch (error) {
      console.warn('[Game] falha no gerador procedural; usando a pista fixa.', error);
    }
  }

  return TRACK_01;
}
