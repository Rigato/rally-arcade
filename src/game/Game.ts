import * as THREE from 'three';
import { Car } from '../car/Car';
import { CarView } from '../car/CarView';
import { ChaseCamera } from '../camera/ChaseCamera';
import { Loop } from '../core/Loop';
import { Input } from '../input/Input';
import { Hud, type HudDebugInfo } from '../ui/Hud';
import { TuningPanel } from '../ui/TuningPanel';
import { buildArena } from '../world/Arena';
import {
  CAR_START,
  CAR_TUNING,
  INPUT_TUNING,
  RENDER_SETTINGS,
  SIMULATION,
  SURFACES,
} from './config';
import { isDebugMode } from './debug';
import type { CarState, ForcedSurface, HandbrakeMode, RaceState, SurfaceId } from './types';

const FPS_SMOOTHING_TAU = 0.5;

/** Integração do M1b: física, input, câmera, carro visual, arena, HUD e painel. */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly car: Car;
  private readonly carView = new CarView();
  private readonly input: Input;
  private readonly chaseCamera: ChaseCamera;
  private readonly hud: Hud;
  private readonly tuningPanel: TuningPanel | null;
  private readonly loop: Loop;
  private readonly resizeObserver: ResizeObserver | null;

  private readonly carStart = new THREE.Vector3(
    CAR_START.position.x,
    0,
    CAR_START.position.z,
  );

  /** Estado usado pela câmera no render (posição interpolada). */
  private readonly cameraState: CarState = {
    position: new THREE.Vector3(),
    heading: 0,
    velocity: new THREE.Vector3(),
    yawRate: 0,
    grounded: true,
    releaseTime: 0,
    speed: 0,
  };

  private elapsedSeconds = 0;
  private state: RaceState = 'READY';
  private started = false;
  private disposed = false;
  private pausedByVisibility = false;

  /** Piso do debug; até o M2 `auto` também resolve para cascalho. */
  private forcedSurface: ForcedSurface = 'gravel';
  /** FPS suavizado exibido na telemetria. */
  private fps = 0;

  constructor(container: HTMLElement, hudRoot: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_SETTINGS.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(RENDER_SETTINGS.background);
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Arena plana de teste do Rally Arcade',
    );
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(RENDER_SETTINGS.background);
    this.scene.fog = new THREE.Fog(
      RENDER_SETTINGS.fogColor,
      RENDER_SETTINGS.fogNear,
      RENDER_SETTINGS.fogFar,
    );

    this.setupLights();
    this.setupGround();
    buildArena(this.scene);

    this.car = new Car(CAR_TUNING);
    this.car.reset(this.carStart, CAR_START.heading);
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.scene.add(this.carView.root);

    this.chaseCamera = new ChaseCamera();
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);

    this.hud = new Hud(hudRoot, {
      handbrakeMode: INPUT_TUNING.handbrakeMode,
      debug: isDebugMode(),
    });
    this.hud.setState(this.state);
    this.hud.setTime(0);
    this.hud.onReset(this.reset);

    this.input = new Input(this.renderer.domElement, {
      tuning: INPUT_TUNING,
      handbrakeButton: this.hud.handbrakeButton,
      onFirstThrottle: this.handleFirstThrottle,
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
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.loop.start();
  }

  /** Piso escolhido no painel de debug (`auto` até o M2 = cascalho). */
  getForcedSurface(): ForcedSurface {
    return this.forcedSurface;
  }

  setForcedSurface(surface: ForcedSurface): void {
    if (surface !== 'auto' && !(surface in SURFACES)) {
      return;
    }

    this.forcedSurface = surface;
  }

  /** Superfície efetiva usada pela física neste passo. */
  getCurrentSurfaceId(): SurfaceId {
    return this.forcedSurface === 'auto' ? 'gravel' : this.forcedSurface;
  }

  /** Coloca o carro de volta na largada (mesmo fluxo do botão de reinício). */
  repositionCar(): void {
    this.reset();
  }

  /**
   * Aplica o modo do freio de mão ao vivo: HUD, Input e o objeto de tuning
   * compartilhado. Trocar para `drag` libera imediatamente o botão pressionado.
   */
  setHandbrakeMode(mode: HandbrakeMode): void {
    INPUT_TUNING.handbrakeMode = mode;
    this.hud.setHandbrakeMode(mode);
    this.input.notifyTuningChanged();
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
    this.hud.dispose();

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

  private readonly handleFirstThrottle = (): void => {
    if (this.state !== 'READY') {
      return;
    }

    this.state = 'RUNNING';
    this.hud.setState(this.state);
  };

  private readonly reset = (): void => {
    this.input.reset();
    this.car.reset(this.carStart, CAR_START.heading);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);

    this.elapsedSeconds = 0;
    this.state = 'READY';
    this.hud.setTime(0);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
  };

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xdbe9ff, 0x2a332b, 1.35);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
    sun.position.set(18, 30, 12);
    this.scene.add(sun);
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(RENDER_SETTINGS.groundSize, RENDER_SETTINGS.groundSize),
      new THREE.MeshStandardMaterial({
        color: RENDER_SETTINGS.groundColor,
        roughness: 0.96,
        metalness: 0,
      }),
    );
    ground.name = 'arena-ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(
      RENDER_SETTINGS.groundSize,
      RENDER_SETTINGS.gridDivisions,
      RENDER_SETTINGS.gridColor,
      RENDER_SETTINGS.gridColor,
    );
    grid.name = 'arena-grid';
    grid.position.y = 0.003;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.28;
    this.scene.add(grid);
  }

  private readonly update = (fixedDt: number): void => {
    this.input.update(fixedDt);
    // M1b: piso escolhido no painel. M2 troca por SURFACES conforme a zona,
    // reutilizando a mesma referência mutável.
    this.car.step(fixedDt, this.input.inputState, SURFACES[this.getCurrentSurfaceId()]);

    if (this.state === 'RUNNING') {
      this.elapsedSeconds += fixedDt;
    }
  };

  private readonly render = (alpha: number, frameDt: number): void => {
    if (frameDt > 0) {
      const instantFps = 1 / frameDt;
      const alphaFps = 1 - Math.exp(-frameDt / FPS_SMOOTHING_TAU);
      this.fps = this.fps > 0 ? this.fps + (instantFps - this.fps) * alphaFps : instantFps;
    }

    const pose = this.car.getRenderPose(alpha);
    this.carView.setPose(pose.position, pose.heading);
    this.carView.update(frameDt, {
      speed: this.car.telemetry.speed,
      steer: this.input.inputState.steer,
      lateralAccel: this.car.telemetry.lateralAcceleration,
      longAccel: this.car.telemetry.longitudinalAcceleration,
      handbrake: this.input.inputState.handbrake,
      grounded: this.car.state.grounded,
    });

    this.cameraState.position.copy(pose.position);
    this.cameraState.heading = pose.heading;
    this.cameraState.velocity.copy(this.car.state.velocity);
    this.cameraState.speed = this.car.state.speed;
    this.cameraState.yawRate = this.car.state.yawRate;
    this.cameraState.grounded = this.car.state.grounded;
    this.chaseCamera.update(frameDt, this.cameraState);

    this.hud.setTime(this.elapsedSeconds);
    this.hud.setTelemetry(this.car.telemetry, pose.position, this.debugInfo);

    this.renderer.render(this.scene, this.chaseCamera.camera);
  };

  private get debugInfo(): HudDebugInfo {
    return {
      fps: this.fps,
      surface: SURFACES[this.getCurrentSurfaceId()].label,
    };
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
