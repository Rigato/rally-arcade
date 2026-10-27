import * as THREE from 'three';
import { clamp, lerp } from '../core/math';

const TRANSITION_RANGE = 15;

interface EnvironmentPalette {
  hemiIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
  sunPosition: THREE.Vector3;
}

const FOREST: EnvironmentPalette = {
  hemiIntensity: 1.25,
  sunIntensity: 2.0,
  fogNear: 55,
  fogFar: 235,
  sunPosition: new THREE.Vector3(28, 42, 18),
};

const DESERT: EnvironmentPalette = {
  hemiIntensity: 1.35,
  sunIntensity: 2.25,
  fogNear: 50,
  fogFar: 220,
  sunPosition: new THREE.Vector3(45, 34, -16),
};

const FOREST_SKY = new THREE.Color(0xb5c3bf);
const DESERT_SKY = new THREE.Color(0xe9d0a5);
const FOREST_FOG = new THREE.Color(0xb5c3bf);
const DESERT_FOG = new THREE.Color(0xe6cda5);
const FOREST_HEMI_SKY = new THREE.Color(0xdce9ee);
const DESERT_HEMI_SKY = new THREE.Color(0xffe5bd);
const FOREST_HEMI_GROUND = new THREE.Color(0x36452f);
const DESERT_HEMI_GROUND = new THREE.Color(0x9c7a4a);
const FOREST_SUN = new THREE.Color(0xfff0d0);
const DESERT_SUN = new THREE.Color(0xffd39a);

/**
 * Céu, névoa e luzes da pista. A transição floresta→deserto acontece em
 * ~30 m ao redor da troca de zona (s ≈ 300 m), sem skybox e sem shadow maps.
 */
export class Environment {
  readonly hemisphere: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;

  private readonly scene: THREE.Scene;
  private readonly transitionS: number;

  private readonly skyColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly hemiSky = new THREE.Color();
  private readonly hemiGround = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly sunPosition = new THREE.Vector3();

  constructor(scene: THREE.Scene, transitionS = 300) {
    this.scene = scene;
    this.transitionS = transitionS;

    this.scene.background = this.skyColor;
    this.fog = new THREE.Fog(FOREST_FOG.getHex(), FOREST.fogNear, FOREST.fogFar);
    this.scene.fog = this.fog;

    this.hemisphere = new THREE.HemisphereLight(
      FOREST_HEMI_SKY.getHex(),
      FOREST_HEMI_GROUND.getHex(),
      FOREST.hemiIntensity,
    );
    this.hemisphere.name = 'environment-hemisphere';
    this.sun = new THREE.DirectionalLight(FOREST_SUN.getHex(), FOREST.sunIntensity);
    this.sun.name = 'environment-sun';
    this.sun.position.copy(FOREST.sunPosition);

    this.scene.add(this.hemisphere, this.sun);
    this.update(0, 1);
  }

  /** `s` posição na pista; `length` evita que a transição passe do fim. */
  update(s: number, length: number): void {
    const center = Math.min(this.transitionS, length * 0.5);
    const raw = clamp(
      (s - (center - TRANSITION_RANGE)) / (TRANSITION_RANGE * 2),
      0,
      1,
    );
    const t = raw * raw * (3 - 2 * raw);

    this.skyColor.copy(FOREST_SKY).lerp(DESERT_SKY, t);
    this.fogColor.copy(FOREST_FOG).lerp(DESERT_FOG, t);
    this.hemiSky.copy(FOREST_HEMI_SKY).lerp(DESERT_HEMI_SKY, t);
    this.hemiGround.copy(FOREST_HEMI_GROUND).lerp(DESERT_HEMI_GROUND, t);
    this.sunColor.copy(FOREST_SUN).lerp(DESERT_SUN, t);
    this.sunPosition.copy(FOREST.sunPosition).lerp(DESERT.sunPosition, t);

    this.hemisphere.color.copy(this.hemiSky);
    this.hemisphere.groundColor.copy(this.hemiGround);
    this.hemisphere.intensity = lerp(FOREST.hemiIntensity, DESERT.hemiIntensity, t);

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = lerp(FOREST.sunIntensity, DESERT.sunIntensity, t);
    this.sun.position.copy(this.sunPosition);

    this.fog.color.copy(this.fogColor);
    this.fog.near = lerp(FOREST.fogNear, DESERT.fogNear, t);
    this.fog.far = lerp(FOREST.fogFar, DESERT.fogFar, t);
  }
}
