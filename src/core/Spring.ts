import { clamp } from './math';

/**
 * Mola/amortecedor semi-implícito para animação visual (roll, pitch, pouso).
 * Não participa da física do carro.
 */
export class Spring {
  value = 0;
  velocity = 0;

  private readonly stiffness: number;
  private readonly damping: number;
  private readonly maxAbs: number;

  constructor(stiffness = 120, damping = 18, maxAbs = Number.POSITIVE_INFINITY) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.maxAbs = maxAbs;
  }

  update(target: number, dt: number): number {
    const acceleration = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;

    if (Math.abs(this.value) > this.maxAbs) {
      this.value = Math.sign(this.value) * this.maxAbs;
      this.velocity = 0;
    }

    return this.value;
  }

  /** Injeta velocidade (ex.: impacto de pouso no M3). */
  kick(velocity: number): void {
    this.velocity += velocity;
  }

  reset(value = 0): void {
    this.value = clamp(value, -this.maxAbs, this.maxAbs);
    this.velocity = 0;
  }
}
