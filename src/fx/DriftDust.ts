import * as THREE from 'three';
import { clamp } from '../core/math';
import type { SurfaceId } from '../game/types';

/** Estado mínimo de telemetria necessário para a poeira. */
export interface DriftDustState {
  position: THREE.Vector3;
  heading: number;
  velocity: THREE.Vector3;
  speed: number;
  /** Ângulo entre heading e direção do movimento (rad). */
  slipAngle: number;
  grounded: boolean;
  surfaceId: SurfaceId;
}

const POOL_SIZE = 80;
const MAX_RATE = 34;
const SLIP_START_DEG = 5;
const SLIP_RANGE_DEG = 22;
const SPEED_START = 5;
const SPEED_RANGE = 20;
const RAD_TO_DEG = 180 / Math.PI;

const COLORS: Record<SurfaceId, number> = {
  gravel: 0xc9b48b,
  sand: 0xd8c08a,
  'forest-offroad': 0xa89a7c,
  'desert-offroad': 0xc9a76a,
};

const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;

  uniform float uPointScale;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(aSize * uPointScale / max(-mvPosition.z, 0.1), 1.0, 180.0);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

// Círculo radial procedural: mais barato que uma textura e sem assets.
const FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) {
      discard;
    }

    // Núcleo opaco maior: a poeira lê como nuvem, não como pontos isolados.
    float soft = 1.0 - smoothstep(0.18, 0.5, distanceToCenter);
    float alpha = vAlpha * soft;
    if (alpha < 0.003) {
      discard;
    }

    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Poeira de derrapagem em um único `THREE.Points` com pool fixo.
 *
 * Nada é alocado durante o frame: os atributos vivem em typed arrays e são
 * reenviados inteiros (80 partículas é um custo desprezível). A emissão só
 * acontece com o carro no chão, acima de 5 m/s e com slip acima de 5°.
 */
export class DriftDust {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly pointScaleUniform: THREE.IUniform<number>;

  private readonly positions = new Float32Array(POOL_SIZE * 3);
  private readonly sizes = new Float32Array(POOL_SIZE);
  private readonly alphas = new Float32Array(POOL_SIZE);
  private readonly colors = new Float32Array(POOL_SIZE * 3);

  private readonly ages = new Float32Array(POOL_SIZE);
  private readonly lives = new Float32Array(POOL_SIZE);
  private readonly velocities = new Float32Array(POOL_SIZE * 3);
  private readonly baseSizes = new Float32Array(POOL_SIZE);
  private readonly growths = new Float32Array(POOL_SIZE);
  private readonly baseAlphas = new Float32Array(POOL_SIZE);
  private readonly alive = new Uint8Array(POOL_SIZE);

  private readonly surfaceColors: Record<SurfaceId, THREE.Color>;

  private cursor = 0;
  private emitAccumulator = 0;
  private activeParticles = 0;

  constructor() {
    this.surfaceColors = {
      gravel: new THREE.Color(COLORS.gravel),
      sand: new THREE.Color(COLORS.sand),
      'forest-offroad': new THREE.Color(COLORS['forest-offroad']),
      'desert-offroad': new THREE.Color(COLORS['desert-offroad']),
    };

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage),
    );
    const colorAttribute = new THREE.BufferAttribute(this.colors, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.geometry.setAttribute('aColor', colorAttribute);

    this.pointScaleUniform = { value: 700 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uPointScale: this.pointScaleUniform,
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'drift-dust';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;

    this.reset();
  }

  /** Quantidade de partículas vivas; usado nos testes e no relatório. */
  get activeCount(): number {
    return this.activeParticles;
  }

  /** Ajusta o tamanho em pixels à altura do framebuffer e ao FOV atual. */
  setProjection(framebufferHeight: number, fovDegrees: number): void {
    const fovRadians = Math.max(fovDegrees, 1) * (Math.PI / 180);
    this.pointScaleUniform.value =
      framebufferHeight / (2 * Math.tan(fovRadians * 0.5));
  }

  update(dt: number, state: DriftDustState): void {
    const step = clamp(dt, 0, 0.1);

    if (step > 0) {
      this.advance(step);
    }

    const slipDegrees = Math.abs(state.slipAngle) * RAD_TO_DEG;
    if (
      step > 0 &&
      state.grounded &&
      state.speed > SPEED_START &&
      slipDegrees > SLIP_START_DEG
    ) {
      const slipFactor = clamp((slipDegrees - SLIP_START_DEG) / SLIP_RANGE_DEG, 0, 1);
      const speedFactor = clamp((state.speed - SPEED_START) / SPEED_RANGE, 0, 1);
      this.emitAccumulator += MAX_RATE * slipFactor * speedFactor * step;
    } else {
      this.emitAccumulator = 0;
    }

    while (this.emitAccumulator >= 1) {
      this.emitAccumulator -= 1;
      this.emit(state);
    }

    this.flushDynamicAttributes();
  }

  /** Remove todas as partículas (reset, teleporte, recuperação e chegada). */
  reset(): void {
    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.alive[i] = 0;
      this.sizes[i] = 0;
      this.alphas[i] = 0;
      this.ages[i] = 0;
      this.lives[i] = 0;
      this.positions[i * 3 + 1] = -1000;
    }

    this.cursor = 0;
    this.emitAccumulator = 0;
    this.activeParticles = 0;
    this.flushDynamicAttributes();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private advance(dt: number): void {
    const drag = Math.exp(-2.0 * dt);
    const verticalDrag = Math.exp(-1.2 * dt);

    for (let i = 0; i < POOL_SIZE; i += 1) {
      if (this.alive[i] === 0) {
        continue;
      }

      const age = this.ages[i] + dt;
      if (age >= this.lives[i]) {
        this.kill(i);
        continue;
      }

      this.ages[i] = age;
      const t = age / this.lives[i];

      const v = i * 3;
      this.velocities[v] *= drag;
      this.velocities[v + 1] = this.velocities[v + 1] * verticalDrag - 0.25 * dt;
      this.velocities[v + 2] *= drag;

      this.positions[v] += this.velocities[v] * dt;
      this.positions[v + 1] += this.velocities[v + 1] * dt;
      this.positions[v + 2] += this.velocities[v + 2] * dt;

      const growth = 1 + (this.growths[i] - 1) * t;
      this.sizes[i] = this.baseSizes[i] * growth;

      const fade = 1 - t;
      this.alphas[i] = this.baseAlphas[i] * fade * fade * (1.25 - 0.25 * t);
    }
  }

  private emit(state: DriftDustState): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % POOL_SIZE;

    if (this.alive[index] === 0) {
      this.alive[index] = 1;
      this.activeParticles += 1;
    }

    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);

    const side = Math.random() < 0.5 ? -1 : 1;
    const lateralOffset = 0.55 * side;
    const v = index * 3;

    this.positions[v] =
      state.position.x - forwardX * 1.25 + rightX * lateralOffset;
    this.positions[v + 1] = state.position.y + 0.12 + Math.random() * 0.18;
    this.positions[v + 2] =
      state.position.z - forwardZ * 1.25 + rightZ * lateralOffset;

    const lateralJitter = (Math.random() * 2 - 1) * 0.5;
    const forwardJitter = (Math.random() * 2 - 1) * 0.15;
    this.velocities[v] =
      -state.velocity.x * 0.12 + rightX * lateralJitter + forwardX * forwardJitter;
    this.velocities[v + 1] = 1.0 + Math.random() * 1.0;
    this.velocities[v + 2] =
      -state.velocity.z * 0.12 + rightZ * lateralJitter + forwardZ * forwardJitter;

    this.ages[index] = 0;
    this.lives[index] = 0.50 + Math.random() * 0.45;
    this.baseSizes[index] = 0.30 + Math.random() * 0.35;
    this.growths[index] = 1.5 + Math.random() * 0.5;
    this.baseAlphas[index] = 0.28 + Math.random() * 0.27;
    this.sizes[index] = this.baseSizes[index];
    this.alphas[index] = this.baseAlphas[index];

    const color = this.surfaceColors[state.surfaceId] ?? this.surfaceColors.gravel;
    this.colors[v] = color.r;
    this.colors[v + 1] = color.g;
    this.colors[v + 2] = color.b;
  }

  private kill(index: number): void {
    if (this.alive[index] === 0) {
      return;
    }

    this.alive[index] = 0;
    this.activeParticles = Math.max(0, this.activeParticles - 1);
    this.sizes[index] = 0;
    this.alphas[index] = 0;
    this.positions[index * 3 + 1] = -1000;
  }

  private flushDynamicAttributes(): void {
    const position = this.geometry.getAttribute('position');
    const size = this.geometry.getAttribute('aSize');
    const alpha = this.geometry.getAttribute('aAlpha');
    const color = this.geometry.getAttribute('aColor');

    position.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    color.needsUpdate = true;
  }
}
