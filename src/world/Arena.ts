import * as THREE from 'three';

/**
 * Arena plana de teste do M1a: grid (no Game) + cones e caixas de referência.
 * Nada aqui colide — o objetivo é perceber velocidade, curva e derrapagem.
 */
export function buildArena(scene: THREE.Scene): void {
  const cones: Array<[number, number]> = [];

  // Slalom em zigue-zague à frente da largada.
  for (let i = 0; i < 6; i += 1) {
    cones.push([i % 2 === 0 ? 3.8 : -3.8, 18 + i * 9]);
  }

  // Círculo grande para treinar donut/hairpin.
  const circleX = 0;
  const circleZ = 62;
  const circleRadius = 13;
  const circleCount = 18;
  for (let i = 0; i < circleCount; i += 1) {
    const angle = (i / circleCount) * Math.PI * 2;
    cones.push([
      circleX + Math.cos(angle) * circleRadius,
      circleZ + Math.sin(angle) * circleRadius,
    ]);
  }

  // Portais improvisados de referência ao longo do eixo +Z.
  for (const z of [30, 72]) {
    cones.push([-7.5, z], [7.5, z]);
  }

  const coneGeometry = new THREE.ConeGeometry(0.34, 0.9, 8);
  const coneMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2733d,
    roughness: 0.82,
    flatShading: true,
  });
  const coneMesh = new THREE.InstancedMesh(coneGeometry, coneMaterial, cones.length);
  coneMesh.name = 'arena-cones';
  coneMesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  cones.forEach(([x, z], index) => {
    matrix.makeTranslation(x, 0.45, z);
    coneMesh.setMatrixAt(index, matrix);
  });
  coneMesh.instanceMatrix.needsUpdate = true;
  scene.add(coneMesh);

  // Caixas de referência nas laterais, em alturas diferentes.
  const crateGeometry = new THREE.BoxGeometry(1, 1, 1);
  const crateMaterial = new THREE.MeshStandardMaterial({
    color: 0x7d6a4f,
    roughness: 0.9,
    flatShading: true,
  });
  const cratePositions: Array<[number, number, number, number]> = [
    [-10, 0.55, 20, 1.1],
    [10, 0.55, 20, 1.1],
    [-10, 0.55, 40, 1.1],
    [10, 0.55, 40, 1.1],
    [10.9, 0.95, 40.9, 1.9],
    [-10, 0.55, 60, 1.1],
    [10, 0.55, 60, 1.1],
  ];

  const crateMesh = new THREE.InstancedMesh(crateGeometry, crateMaterial, cratePositions.length);
  crateMesh.name = 'arena-crates';
  crateMesh.frustumCulled = false;

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  cratePositions.forEach(([x, y, z, size], index) => {
    position.set(x, y * (size / 1.1), z);
    scale.set(size, size, size);
    matrix.compose(position, quaternion, scale);
    crateMesh.setMatrixAt(index, matrix);
  });
  crateMesh.instanceMatrix.needsUpdate = true;
  scene.add(crateMesh);

  // Linha de largada simples.
  const startLine = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.03, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0xe8eee5,
      roughness: 0.7,
      transparent: true,
      opacity: 0.75,
    }),
  );
  startLine.name = 'arena-start-line';
  startLine.position.set(0, 0.01, -1.4);
  scene.add(startLine);
}
