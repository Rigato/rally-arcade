import * as THREE from 'three';

export interface BannerTextureOptions {
  text: string;
  /** Cor de fundo (ignorada quando `checker`). */
  background: string;
  foreground: string;
  /** Cor da borda e do padrão. */
  border: string;
  /** Fundo quadriculado (chegada). */
  checker?: boolean;
  width?: number;
  height?: number;
}

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Textura de banner desenhada em canvas: texto grande, legível e independente
 * de fontes externas. A orientação do plano é definida por quem usa (o texto
 * não é espelhado do lado da frente).
 */
export function createBannerTexture(options: BannerTextureOptions): THREE.CanvasTexture {
  const width = options.width ?? 1024;
  const height = options.height ?? 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  if (options.checker) {
    const cell = Math.max(12, Math.round(height / 5));
    for (let row = 0; row < Math.ceil(height / cell); row += 1) {
      for (let col = 0; col < Math.ceil(width / cell); col += 1) {
        context.fillStyle =
          (row + col) % 2 === 0 ? '#f2efe6' : '#202624';
        context.fillRect(col * cell, row * cell, cell, cell);
      }
    }

    // Faixa escura central para o texto ficar legível sobre o xadrez.
    const barX = width * 0.08;
    const barY = height * 0.24;
    const barW = width * 0.84;
    const barH = height * 0.52;
    context.fillStyle = 'rgba(22, 28, 26, 0.86)';
    context.fillRect(barX, barY, barW, barH);
  } else {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, options.background);
    gradient.addColorStop(1, options.border);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  const borderWidth = Math.max(5, Math.round(height * 0.045));
  context.strokeStyle = options.border;
  context.lineWidth = borderWidth;
  context.strokeRect(
    borderWidth * 0.5,
    borderWidth * 0.5,
    width - borderWidth,
    height - borderWidth,
  );

  const fontSize = Math.round(height * (options.checker ? 0.5 : 0.58));
  context.font = `900 ${fontSize}px ${FONT_STACK}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';

  const centerX = width * 0.5;
  const centerY = height * 0.53;
  context.lineWidth = Math.max(6, Math.round(fontSize * 0.12));
  context.strokeStyle = 'rgba(12, 16, 14, 0.72)';
  context.strokeText(options.text, centerX, centerY);

  context.fillStyle = options.foreground;
  context.fillText(options.text, centerX, centerY);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
