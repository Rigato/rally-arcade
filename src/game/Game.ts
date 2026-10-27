import * as THREE from 'three';
import { CarView } from '../car/CarView';
import { ChaseCamera } from '../camera/ChaseCamera';
import { Loop } from '../core/Loop';
import { Hud } from '../ui/Hud';
import { RENDER_SETTINGS, SIMULATION } from './config';
import type { RaceState } from './types';

/** Bootstrap e orquestração do M0: cena, carro placeholder, câmera, loop e HUD. */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly carView = new CarView();
  private readonly chaseCamera: ChaseCamera;
  private readonly hud: Hud;
  private readonly loop: Loop;
  private readonly resizeObserver: ResizeObserver | null;

  private readonly carPosition = new THREE.Vector3(0, 0, 0);
  private readonly carHeading = 0;

  private elapsedSeconds = 0;
  private state: RaceState = 'READY';
  private started = false;
  private disposed = false;

  constructor(container: HTMLElement, hudRoot: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_SETTINGS.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(RENDER_SETTINGS.background);
    this.renderer.domElement.setAttribute('aria-label', 'Pista provisória do Rally Arcade');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(RENDER_SETTINGS.background);
    this.scene.fog = new THREE.Fog(
      RENDER_SETTINGS.fogColor,
      RENDER_SETTINGS.fogNear,
      RENDER_SETTINGS.fogFar,
    );

    this.setupLights();
    this.setupGround();

    this.carView.setPose(this.carPosition, this.carHeading);
    this.scene.add(this.carView.root);

    this.chaseCamera = new ChaseCamera();
    this.chaseCamera.snapTo(this.carPosition, this.carHeading);

    this.hud = new Hud(hudRoot);
    this.hud.setState(this.state);
    this.hud.setTime(0);
    this.hud.onReset(() => this.reset());

    this.loop = new Loop(
      this.update,
      this.render,
      SIMULATION.fixedHz,
      SIMULATION.maxFrameDeltaSeconds,
    );

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);

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

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
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

  private reset(): void {
    // M0: apenas zera o cronômetro. A corrida e a física entram no M1+.
    this.elapsedSeconds = 0;
    this.state = 'READY';
    this.hud.setTime(0);
    this.hud.setState(this.state);
    this.chaseCamera.snapTo(this.carPosition, this.carHeading);
  }

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
    ground.name = 'provisional-ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(
      RENDER_SETTINGS.groundSize,
      RENDER_SETTINGS.gridDivisions,
      RENDER_SETTINGS.gridColor,
      RENDER_SETTINGS.gridColor,
    );
    grid.name = 'provisional-grid';
    grid.position.y = 0.003;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.16;
    this.scene.add(grid);
  }

  private readonly update = (fixedDt: number): void => {
    if (this.state === 'RUNNING') {
      this.elapsedSeconds += fixedDt;
    }

    // M1: física do carro, pista e lógica de corrida entram aqui.
  };

  private readonly render = (_alpha: number, frameDt: number): void => {
    this.chaseCamera.update(frameDt, this.carPosition, this.carHeading);
    this.hud.setTime(this.elapsedSeconds);
    this.renderer.render(this.scene, this.chaseCamera.camera);
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
