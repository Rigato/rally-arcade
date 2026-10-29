import * as THREE from 'three';

/**
 * Textura de grão procedural compartilhada pela pista principal e pelas
 * rotas dos splits. O mesmo padrão determinístico evita que uma rota pareça
 * ter um material diferente da pista principal.
 */
export function createRoadGrainTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  context.fillStyle = '#d9d9d9';
  context.fillRect(0, 0, size, size);

  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let i = 0; i < 2600; i += 1) {
    const value = 170 + Math.floor(random() * 85);
    context.fillStyle = `rgb(${value}, ${value}, ${value})`;
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const w = 1 + Math.floor(random() * 2);
    const h = 1 + Math.floor(random() * 2);
    context.fillRect(x, y, w, h);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
