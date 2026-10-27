/**
 * Guia visual do toque (não é um joystick fixo).
 *
 * Mostra um anel no ponto onde o dedo encostou e um ponto que acompanha o
 * deslocamento. A horizontal é o esterço; a vertical para baixo é o freio no
 * modo `drag2d`. Só aparece enquanto o dedo está na tela e não captura eventos.
 */
export class TouchGuide {
  private readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly axisX: HTMLElement;
  private readonly axisY: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly brakeLabel: HTMLElement;

  private anchorX = 0;
  private anchorY = 0;
  private radius = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'touch-guide';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.ring = document.createElement('div');
    this.ring.className = 'touch-guide__ring';

    this.axisX = document.createElement('div');
    this.axisX.className = 'touch-guide__axis touch-guide__axis--x';

    this.axisY = document.createElement('div');
    this.axisY.className = 'touch-guide__axis touch-guide__axis--y';

    this.dot = document.createElement('div');
    this.dot.className = 'touch-guide__dot';

    this.brakeLabel = document.createElement('div');
    this.brakeLabel.className = 'touch-guide__brake-label';
    this.brakeLabel.textContent = 'FREIO';

    this.root.append(this.ring, this.axisX, this.axisY, this.dot, this.brakeLabel);
    document.body.append(this.root);
  }

  show(anchorX: number, anchorY: number, radius: number, brakeEnabled: boolean): void {
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    // O lock real é ~133 px em portrait; o anel visual fica um pouco menor para
    // não cobrir tanto a pista, mas o ponto continua representando o esterço.
    this.radius = Math.max(Math.min(radius, 110), 48);
    this.root.hidden = false;
    this.root.classList.toggle('touch-guide--brake', brakeEnabled);

    const size = this.radius * 2;
    this.root.style.setProperty('--guide-size', `${size}px`);
    this.root.style.setProperty('--guide-radius', `${this.radius}px`);
    this.positionElement(this.ring, anchorX, anchorY);
    this.positionElement(this.axisX, anchorX, anchorY);
    this.positionElement(this.axisY, anchorX, anchorY);
    this.positionElement(this.brakeLabel, anchorX, anchorY + this.radius * 0.72);
    this.positionElement(this.dot, anchorX, anchorY);
    this.dot.dataset.state = 'idle';
  }

  update(steer: number, brake: number, handbrake: boolean, brakeEnabled: boolean): void {
    const x = this.anchorX + steer * this.radius;
    const y = this.anchorY + (brakeEnabled ? brake * this.radius * 0.8 : 0);

    this.positionElement(this.dot, x, y);
    this.dot.dataset.state = handbrake ? 'handbrake' : brake > 0.05 ? 'brake' : 'drive';
    this.root.classList.toggle('touch-guide--braking', brake > 0.05);
    this.root.classList.toggle('touch-guide--handbrake', handbrake);
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove('touch-guide--braking', 'touch-guide--handbrake');
  }

  dispose(): void {
    this.root.remove();
  }

  private positionElement(element: HTMLElement, x: number, y: number): void {
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }
}
