export type FixedUpdate = (fixedDt: number) => void;
export type InterpolatedRender = (alpha: number, frameDt: number) => void;

/**
 * Loop com passo fixo e acumulador.
 *
 * A simulação roda em passos de 1/120 s; o render recebe `alpha` (0..1),
 * a fração restante do passo, para interpolar o estado visual.
 */
export class Loop {
  private readonly fixedDt: number;
  private readonly maxFrameDelta: number;
  private readonly update: FixedUpdate;
  private readonly render: InterpolatedRender;

  private rafId: number | null = null;
  private lastTime = 0;
  private accumulator = 0;

  constructor(
    update: FixedUpdate,
    render: InterpolatedRender,
    fixedHz: number,
    maxFrameDeltaSeconds: number,
  ) {
    this.update = update;
    this.render = render;
    this.fixedDt = 1 / fixedHz;
    this.maxFrameDelta = maxFrameDeltaSeconds;
  }

  get isRunning(): boolean {
    return this.rafId !== null;
  }

  start(): void {
    if (this.rafId !== null) {
      return;
    }

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId === null) {
      return;
    }

    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.accumulator = 0;
  }

  private readonly tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    // Clamp evita "espiral da morte" após troca de aba, travada ou background.
    const frameDt = Math.min(Math.max((now - this.lastTime) / 1000, 0), this.maxFrameDelta);
    this.lastTime = now;
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 64) {
      this.update(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }

    // Se o teto de passos foi atingido, descarta o excesso para não acumular atraso.
    if (steps === 64) {
      this.accumulator = 0;
    }

    this.render(this.accumulator / this.fixedDt, frameDt);
  };
}
