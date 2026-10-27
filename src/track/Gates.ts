import * as THREE from 'three';
import { clamp } from '../core/math';
import { createBannerTexture } from '../world/canvasText';
import type { Track } from './Track';

const POST_HEIGHT = 6;
const POST_RADIUS = 0.17;
const POST_CLEARANCE = 1.2;
const CROSSBAR_HEIGHT = 0.26;
const BANNER_ASPECT = 6.4;

interface PortalStyle {
  text: string;
  background: string;
  foreground: string;
  border: string;
  checker?: boolean;
}

const DESERT_STYLE: PortalStyle = {
  text: 'DESERTO',
  background: '#22392a',
  foreground: '#f4e0ae',
  border: '#d3a765',
};

const FOREST_STYLE: PortalStyle = {
  text: 'FLORESTA',
  background: '#1f3326',
  foreground: '#dceccd',
  border: '#7fa06a',
};

const FINISH_STYLE: PortalStyle = {
  text: 'CHEGADA',
  background: '#202624',
  foreground: '#ffffff',
  border: '#e9e4d6',
  checker: true,
};

/**
 * Portais visuais sem colisão: um em cada troca de setor (floresta ↔ deserto)
 * e outro na chegada.
 *
 * Os postes ficam fora da pista e o banner aponta para o carro que chega
 * (normal no sentido contrário à tangente), com material DoubleSide. O texto
 * vem de uma textura de canvas, sem depender de fonte externa.
 */
export class Gates {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  constructor(track: Track) {
    this.group.name = 'gates';

    let transitionIndex = 0;
    for (let i = 1; i < track.def.zones.length; i += 1) {
      const zone = track.def.zones[i];
      transitionIndex += 1;
      const style = zone.id === 'desert' ? DESERT_STYLE : FOREST_STYLE;
      this.group.add(
        this.buildPortal(
          track,
          zone.start,
          `gate-${zone.id}-${transitionIndex}`,
          style,
        ),
      );
    }

    const finishS = Math.max(0, track.length - 5);
    this.group.add(this.buildPortal(track, finishS, 'gate-finish', FINISH_STYLE));
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const texture of this.textures) {
      texture.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }

  private buildPortal(
    track: Track,
    s: number,
    name: string,
    style: PortalStyle,
  ): THREE.Group {
    const sample = track.sampleAt(clamp(s, 0, track.length));
    const half = sample.width * 0.5;
    const postU = half + POST_CLEARANCE;
    const centerX = sample.position.x;
    const centerY = track.heightAt(clamp(s, 0, track.length), 0);
    const centerZ = sample.position.z;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

    const group = new THREE.Group();
    group.name = name;
    group.position.set(centerX, centerY, centerZ);
    // Local +Z aponta contra a tangente: o banner fica de frente para o
    // carro que se aproxima (sem texto espelhado).
    group.rotation.y = heading + Math.PI;

    const postGeometry = new THREE.CylinderGeometry(
      POST_RADIUS,
      POST_RADIUS * 1.2,
      POST_HEIGHT,
      8,
    );
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b3c36,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    this.geometries.push(postGeometry);
    this.materials.push(postMaterial);

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.name = `${name}-post`;
      post.position.set(side * postU, POST_HEIGHT * 0.5, 0);
      group.add(post);
    }

    const span = postU * 2;
    const crossbarGeometry = new THREE.BoxGeometry(span, CROSSBAR_HEIGHT, 0.24);
    const crossbar = new THREE.Mesh(crossbarGeometry, postMaterial);
    crossbar.name = `${name}-crossbar`;
    crossbar.position.y = POST_HEIGHT;
    group.add(crossbar);
    this.geometries.push(crossbarGeometry);

    const bannerWidth = span - 0.8;
    const bannerHeight = clamp(bannerWidth / BANNER_ASPECT, 1.15, 1.75);
    const texture = createBannerTexture({
      text: style.text,
      background: style.background,
      foreground: style.foreground,
      border: style.border,
      checker: style.checker,
      width: 1024,
      height: Math.max(96, Math.round((1024 * bannerHeight) / bannerWidth)),
    });
    const bannerMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const bannerGeometry = new THREE.PlaneGeometry(bannerWidth, bannerHeight);
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.name = `${name}-banner`;
    banner.position.y = POST_HEIGHT - 0.55 - bannerHeight * 0.5;
    group.add(banner);

    this.textures.push(texture);
    this.geometries.push(bannerGeometry);
    this.materials.push(bannerMaterial);

    return group;
  }
}
