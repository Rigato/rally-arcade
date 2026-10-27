import * as THREE from 'three';

/**
 * Placeholder low poly do carro no M0: carroceria, cabine, rodas e sombra blob.
 * A física e a animação de suspensão entram no M1.
 */
export class CarView {
  readonly root = new THREE.Group();

  private readonly body = new THREE.Group();

  constructor() {
    this.root.name = 'car-placeholder';
    this.body.name = 'car-body';
    this.root.add(this.body);

    this.buildBody();
    this.buildWheels();
    this.buildShadow();
  }

  setPose(position: THREE.Vector3, heading: number): void {
    this.root.position.copy(position);
    this.root.rotation.y = heading;
  }

  private buildBody(): void {
    const paint = new THREE.MeshStandardMaterial({
      color: 0xd94b36,
      roughness: 0.55,
      metalness: 0.12,
      flatShading: true,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1c2b36,
      roughness: 0.35,
      metalness: 0.25,
      flatShading: true,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x1b1f22,
      roughness: 0.9,
      flatShading: true,
    });
    const light = new THREE.MeshStandardMaterial({
      color: 0xffe7a8,
      emissive: 0xffd166,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 3.5), paint);
    chassis.position.y = 0.62;
    this.body.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.52, 1.55), glass);
    cabin.position.set(0, 1.06, -0.18);
    this.body.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.62), paint);
    roof.position.set(0, 1.36, -0.18);
    this.body.add(roof);

    const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), trim);
    bumperFront.position.set(0, 0.5, 1.72);
    this.body.add(bumperFront);

    const bumperRear = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), trim);
    bumperRear.position.set(0, 0.5, -1.72);
    this.body.add(bumperRear);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.08, 0.34), trim);
    spoiler.position.set(0, 1.16, -1.55);
    this.body.add(spoiler);

    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), light);
      headlight.position.set(side * 0.56, 0.74, 1.76);
      this.body.add(headlight);
    }
  }

  private buildWheels(): void {
    const wheelGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12);
    wheelGeometry.rotateZ(Math.PI / 2);

    const tire = new THREE.MeshStandardMaterial({
      color: 0x14181b,
      roughness: 0.95,
      flatShading: true,
    });
    const hub = new THREE.MeshStandardMaterial({
      color: 0x9aa5a9,
      roughness: 0.6,
      metalness: 0.3,
      flatShading: true,
    });
    const hubGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 8);
    hubGeometry.rotateZ(Math.PI / 2);

    const positions: ReadonlyArray<readonly [number, number]> = [
      [-0.96, 1.16],
      [0.96, 1.16],
      [-0.96, -1.16],
      [0.96, -1.16],
    ];

    for (const [x, z] of positions) {
      const wheel = new THREE.Mesh(wheelGeometry, tire);
      wheel.position.set(x, 0.38, z);
      this.root.add(wheel);

      const hubcap = new THREE.Mesh(hubGeometry, hub);
      hubcap.position.set(x, 0.38, z);
      this.root.add(hubcap);
    }
  }

  private buildShadow(): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    shadow.name = 'car-blob-shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.scale.set(1.1, 1.9, 1);
    this.root.add(shadow);
  }
}
