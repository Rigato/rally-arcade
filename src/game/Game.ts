import * as THREE from 'three';
import { Car } from '../car/Car';
import { CarView } from '../car/CarView';
import { ChaseCamera } from '../camera/ChaseCamera';
import { Loop } from '../core/Loop';
import { clamp } from '../core/math';
import { Input } from '../input/Input';
import { Gates } from '../track/Gates';
import { Obstacles } from '../track/Obstacles';
import { Track } from '../track/Track';
import { TrackMesh } from '../track/TrackMesh';
import { TRACK_01 } from '../track/track01';
import { Hud, type HudDebugInfo } from '../ui/Hud';
import { TuningPanel } from '../ui/TuningPanel';
import { Environment } from '../world/Environment';
import { Scenery } from '../world/Scenery';
import {
  CAR_TUNING,
  INPUT_TUNING,
  RACE_TUNING,
  RENDER_SETTINGS,
  SIMULATION,
  SURFACES,
} from './config';
import { isDebugMode } from './debug';
import type { CarState, ForcedSurface, HandbrakeMode, RaceState, SurfaceId } from './types';

const FPS_SMOOTHING_TAU = 0.5;
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

/** Integração do M3a: pista fixa, terreno, cenário, câmera, HUD e painel. */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly track: Track;
  private readonly trackMesh: TrackMesh;
  private readonly gates: Gates;
  private readonly scenery: Scenery;
  private readonly obstacles: Obstacles;
  private readonly environment: Environment;
  private readonly car: Car;
  private readonly carView = new CarView();
  private readonly input: Input;
  private readonly chaseCamera: ChaseCamera;
  private readonly hud: Hud;
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

  private elapsedSeconds = 0;
  private state: RaceState = 'READY';
  private started = false;
  private disposed = false;
  private pausedByVisibility = false;

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
  /** FPS suavizado exibido na telemetria. */
  private fps = 0;
  /** Intensidade da última colisão com obstáculo (m/s), para a telemetria. */
  private lastImpact = 0;

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

    this.track = new Track(TRACK_01);
    this.trackMesh = new TrackMesh(this.track);
    this.scene.add(this.trackMesh.group);
    this.gates = new Gates(this.track);
    this.scene.add(this.gates.group);
    this.scenery = new Scenery(this.track);
    this.scene.add(this.scenery.group);
    this.obstacles = new Obstacles(this.track);
    this.scene.add(this.obstacles.group);
    this.environment = new Environment(this.scene, desertStart(this.track));
    this.environment.update(this.track.startS, this.track.length);

    this.car = new Car(CAR_TUNING);
    this.heightAt = (x, z) => this.track.heightAtWorld(x, z, this.car.state.trackS);
    this.cameraGroundAt = (x, z) => this.track.heightAtWorld(x, z, this.car.state.trackS);

    this.car.reset(this.track.startPose.position, this.track.startPose.heading);
    this.car.state.trackS = this.track.startS;
    this.car.state.trackU = 0;
    this.currentSurfaceId = this.track.surfaceAt(this.track.startS, 0);
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.scene.add(this.carView.root);
    this.scene.add(this.carView.shadow);

    this.chaseCamera = new ChaseCamera(undefined, this.cameraGroundAt);
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

    this.applyDebugStartS();
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.loop.start();
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
    this.car.reset(this.teleportPosition, heading);
    this.car.state.trackS = target;
    this.car.state.trackU = 0;
    this.currentSurfaceId = this.track.surfaceAt(target, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.environment.update(target, this.track.length);

    // Teleporte de debug é um estado limpo de teste: volta para READY e zera
    // o cronômetro, senão a corrida ficaria RUNNING sem ter começado no lugar.
    this.elapsedSeconds = 0;
    this.state = 'READY';
    this.hud.setTime(0);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
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

    this.trackMesh.dispose();
    this.gates.dispose();
    this.scenery.dispose();
    this.obstacles.dispose();

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
    this.cancelRecovery();
    this.input.reset();
    this.car.reset(this.track.startPose.position, this.track.startPose.heading);
    this.car.state.trackS = this.track.startS;
    this.car.state.trackU = 0;
    this.currentSurfaceId = this.track.surfaceAt(this.track.startS, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.environment.update(this.track.startS, this.track.length);

    this.elapsedSeconds = 0;
    this.state = 'READY';
    this.hud.setTime(0);
    this.hud.setState(this.state);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);
  };

  private readonly update = (fixedDt: number): void => {
    // Na recuperação a física fica congelada, mas o cronômetro continua: essa
    // é a penalidade. O carro só é reposicionado no meio do fade.
    if (this.state === 'RECOVERING') {
      this.updateRecovery(fixedDt);
      return;
    }

    this.input.update(fixedDt);

    const state = this.car.state;
    const before = this.track.project(state.position.x, state.position.z, state.trackS);
    const trackSurface = this.track.surfaceAt(before.s, before.u);
    const surfaceId = this.forcedSurface === 'auto' ? trackSurface : this.forcedSurface;
    this.currentSurfaceId = surfaceId;

    this.car.step(fixedDt, this.input.inputState, SURFACES[surfaceId], this.heightAt);

    // Colisão com obstáculos sólidos: push-out + ricochete. Acontece antes da
    // projeção em (s,u), então a recuperação e a telemetria já leem a posição
    // corrigida. O carro não é teletransportado: só sai da sobreposição.
    const impact = this.obstacles.resolveCollisions(this.car);
    if (impact > 0) {
      this.lastImpact = impact;
      this.chaseCamera.addShake(clamp(impact / 25, 0.05, 0.35));
      this.hud.flashImpact();
      this.carView.impact(impact);
    }

    const after = this.track.project(
      state.position.x,
      state.position.z,
      before.s,
    );
    state.trackS = after.s;
    state.trackU = after.u;

    this.environment.update(state.trackS, this.track.length);
    this.updateRumble();

    if (this.state === 'RUNNING') {
      this.elapsedSeconds += fixedDt;
    }

    this.updateRecoveryTriggers(fixedDt);
  };

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
    this.recoveryElapsed = 0;
    this.recoveryTeleported = false;
    this.recoveryFaded = false;
    // Atrás da largada, volta para a posição de largada; senão, mantém o `s`.
    this.recoveryS = clamp(state.trackS, this.track.startS, this.track.length);
    this.unstickElapsed = 0;

    // "Pare a física": sem input, sem velocidade e sem rumbling da câmera.
    this.input.cancelAll();
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
    this.elapsedSeconds += dt;

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
    this.currentSurfaceId = this.track.surfaceAt(target, 0);
    this.carView.reset();
    this.carView.setPose(this.car.state.position, this.car.state.heading);
    this.chaseCamera.snapTo(this.car.state.position, this.car.state.heading);
    this.chaseCamera.setRumble(0);
    this.environment.update(target, this.track.length);
    this.hud.setTelemetry(this.car.telemetry, this.car.state.position, this.debugInfo);

    this.recoveryTeleported = true;
    this.hud.setRecoveryPhase('returning');
  }

  /** Trepidação contínua: distância lateral além da borda × velocidade. */
  private updateRumble(): void {
    const state = this.car.state;
    const half = this.track.widthAt(state.trackS) * 0.5;
    const offRoad = Math.max(0, Math.abs(state.trackU) - half);
    const intensity =
      clamp(offRoad / Math.max(RACE_TUNING.offTrackLimit, 0.1), 0, 1) *
      clamp(state.speed / 15, 0, 1);

    // No ar o chão não está batendo no carro: o shake de pouso entra no render.
    this.chaseCamera.setRumble(state.grounded ? intensity : 0);
  }

  /**
   * Limite do mundo baseado na borda (ombro de 6 m) e auto-unstick: acelerar
   * contra algo por 2,5 s sem sair de ~0,8 m/s também dispara a recuperação.
   */
  private updateRecoveryTriggers(dt: number): void {
    if (this.state !== 'RUNNING') {
      this.unstickElapsed = 0;
      return;
    }

    const state = this.car.state;
    const half = this.track.widthAt(state.trackS) * 0.5;
    const beyondEdge = Math.abs(state.trackU) - half;

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
    const groundY = this.track.heightAtWorld(
      pose.position.x,
      pose.position.z,
      this.car.state.trackS,
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
    this.chaseCamera.update(frameDt, this.cameraState);

    this.hud.setTime(this.elapsedSeconds);
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
      zone: this.track.zoneAt(state.trackS) === 'forest' ? 'FLORESTA' : 'DESERTO',
      offRoad: this.track.offTrackDistance(state.trackS, state.trackU),
      obstacles: this.obstacles.getCount(),
      impact: this.lastImpact,
    };
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

function desertStart(track: Track): number {
  return (
    track.def.zones.find((zone) => zone.id === 'desert')?.start ??
    track.length * 0.5
  );
}
