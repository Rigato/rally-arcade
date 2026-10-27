import * as THREE from 'three';
import { lerp } from '../core/math';
import type { TrackZone } from '../game/types';
import { zoneBlendAt, type ZoneId } from '../track/zones';

interface EnvironmentPalette {
  hemiIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
  sky: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sun: THREE.Color;
  sunPosition: THREE.Vector3;
}

const FOREST: EnvironmentPalette = {
  hemiIntensity: 1.25,
  sunIntensity: 2.0,
  fogNear: 55,
  fogFar: 235,
  sky: new THREE.Color(0xb5c3bf),
  fog: new THREE.Color(0xb5c3bf),
  hemiSky: new THREE.Color(0xdce9ee),
  hemiGround: new THREE.Color(0x36452f),
  sun: new THREE.Color(0xfff0d0),
  sunPosition: new THREE.Vector3(28, 42, 18),
};

const DESERT: EnvironmentPalette = {
  hemiIntensity: 1.35,
  sunIntensity: 2.25,
  fogNear: 50,
  fogFar: 220,
  sky: new THREE.Color(0xe9d0a5),
  fog: new THREE.Color(0xe6cda5),
  hemiSky: new THREE.Color(0xffe5bd),
  hemiGround: new THREE.Color(0x9c7a4a),
  sun: new THREE.Color(0xffd39a),
  sunPosition: new THREE.Vector3(45, 34, -16),
};

const PALETTES: Record<ZoneId, EnvironmentPalette> = {
  forest: FOREST,
  desert: DESERT,
};

const DEFAULT_ZONES: readonly TrackZone[] = [
  { start: 0, end: 250, id: 'forest', surface: 'gravel' },
  { start: 250, end: 500, id: 'desert', surface: 'sand' },
  { start: 500, end: 750, id: 'forest', surface: 'gravel' },
  { start: 750, end: 1000, id: 'desert', surface: 'sand' },
];

/**
 * Céu, névoa e luzes da pista. As paletas acompanham as quatro zonas
 * intercaladas e misturam perto de cada limite de setor (floresta ↔ deserto),
 * sem skybox e sem shadow maps.
 */
export class Environment {
  readonly hemisphere: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;

  private readonly scene: THREE.Scene;
  private readonly zones: readonly TrackZone[];

  private readonly skyColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly hemiSky = new THREE.Color();
  private readonly hemiGround = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly sunPosition = new THREE.Vector3();

  constructor(scene: THREE.Scene, zones: readonly TrackZone[] = DEFAULT_ZONES) {
    this.scene = scene;
    this.zones = zones;

    this.scene.background = this.skyColor;
    this.fog = new THREE.Fog(FOREST.fog.getHex(), FOREST.fogNear, FOREST.fogFar);
    this.scene.fog = this.fog;

    this.hemisphere = new THREE.HemisphereLight(
      FOREST.hemiSky.getHex(),
      FOREST.hemiGround.getHex(),
      FOREST.hemiIntensity,
    );
    this.hemisphere.name = 'environment-hemisphere';
    this.sun = new THREE.DirectionalLight(FOREST.sun.getHex(), FOREST.sunIntensity);
    this.sun.name = 'environment-sun';
    this.sun.position.copy(FOREST.sunPosition);

    this.scene.add(this.hemisphere, this.sun);
    this.update(0);
  }

  /** `s` posição na pista. A paleta mistura suavemente em cada limite de setor. */
  update(s: number): void {
    const blend = zoneBlendAt(this.zones, s);
    const from = PALETTES[this.zones[blend.from]?.id ?? 'forest'];
    const to = PALETTES[this.zones[blend.to]?.id ?? 'forest'];
    const t = blend.t;

    this.skyColor.copy(from.sky).lerp(to.sky, t);
    this.fogColor.copy(from.fog).lerp(to.fog, t);
    this.hemiSky.copy(from.hemiSky).lerp(to.hemiSky, t);
    this.hemiGround.copy(from.hemiGround).lerp(to.hemiGround, t);
    this.sunColor.copy(from.sun).lerp(to.sun, t);
    this.sunPosition.copy(from.sunPosition).lerp(to.sunPosition, t);

    this.hemisphere.color.copy(this.hemiSky);
    this.hemisphere.groundColor.copy(this.hemiGround);
    this.hemisphere.intensity = lerp(from.hemiIntensity, to.hemiIntensity, t);

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = lerp(from.sunIntensity, to.sunIntensity, t);
    this.sun.position.copy(this.sunPosition);

    this.fog.color.copy(this.fogColor);
    this.fog.near = lerp(from.fogNear, to.fogNear, t);
    this.fog.far = lerp(from.fogFar, to.fogFar, t);
  }
}
