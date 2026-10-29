import * as THREE from 'three';
import { lerp } from '../core/math';
import type { ScenarioId, TrackZone } from '../game/types';
import { SCENARIOS, SCENARIO_IDS } from '../game/scenarios';
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

function paletteFor(id: ScenarioId): EnvironmentPalette {
  const source = SCENARIOS[id].environment;
  return {
    hemiIntensity: source.hemiIntensity,
    sunIntensity: source.sunIntensity,
    fogNear: source.fogNear,
    fogFar: source.fogFar,
    sky: new THREE.Color(source.sky),
    fog: new THREE.Color(source.fog),
    hemiSky: new THREE.Color(source.hemiSky),
    hemiGround: new THREE.Color(source.hemiGround),
    sun: new THREE.Color(source.sun),
    sunPosition: new THREE.Vector3().fromArray(source.sunPosition),
  };
}

const PALETTES = Object.fromEntries(
  SCENARIO_IDS.map((id) => [id, paletteFor(id)]),
) as Record<ZoneId, EnvironmentPalette>;

const DEFAULT_ZONES: readonly TrackZone[] = [
  { start: 0, end: 250, id: 'forest', surface: 'gravel' },
  { start: 250, end: 500, id: 'desert', surface: 'sand' },
  { start: 500, end: 750, id: 'forest', surface: 'gravel' },
  { start: 750, end: 1000, id: 'desert', surface: 'sand' },
];

/**
 * Céu, névoa e luzes da pista. As paletas acompanham os quatro setores e
 * misturam perto de cada limite (qualquer combinação de cenários), sem skybox
 * e sem shadow maps.
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
    const first = PALETTES[this.zones[0]?.id ?? 'forest'];
    this.fog = new THREE.Fog(first.fog.getHex(), first.fogNear, first.fogFar);
    this.scene.fog = this.fog;

    this.hemisphere = new THREE.HemisphereLight(
      first.hemiSky.getHex(),
      first.hemiGround.getHex(),
      first.hemiIntensity,
    );
    this.hemisphere.name = 'environment-hemisphere';
    this.sun = new THREE.DirectionalLight(first.sun.getHex(), first.sunIntensity);
    this.sun.name = 'environment-sun';
    this.sun.position.copy(first.sunPosition);

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
