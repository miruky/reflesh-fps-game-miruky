import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createCinematicCloudData, installCinematicSky } from './cinematic-sky';
import type { StagePalette } from '../game/stage';

const palette: StagePalette = {
  sky: '#8fa9bd',
  fog: '#8094a3',
  floor: '#626870',
  wall: '#555b62',
  obstacle: '#444b52',
  accent: '#ff6a42',
  lightColor: '#fff0d8',
  lightIntensity: 1.4,
  ambientIntensity: 0.8,
  fogDensity: 0.006,
  emissiveAccent: false,
};

describe('cinematic sky', () => {
  it('追加ドローコール無しでSkyシェーダへ雲と露出クランプを注入する', () => {
    const sky = new Sky();
    const handle = installCinematicSky(sky, {
      palette,
      mood: 'overcast',
      tier: 'medium',
      reduceMotion: false,
      skyScale: 0.16,
      skyClamp: 0.5,
    });
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: `
        const float pi = 3.14159265;
        varying vec3 vSunDirection;
        void main() {
          vec3 direction = vec3(0.0, 1.0, 0.0);
          vec3 retColor = vec3(1.0);
          gl_FragColor = vec4( retColor, 1.0 );
        }`,
    };
    (sky.material as THREE.ShaderMaterial).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(shader.fragmentShader).toContain('uCloudMap');
    expect(shader.fragmentShader).toContain('texture2D(uCloudMap');
    expect(shader.fragmentShader).toContain('hibSkyBase');
    expect(shader.fragmentShader).not.toContain('gl_FragColor = vec4( retColor, 1.0 );');
    expect(Object.keys(shader.uniforms)).toContain('uCloudDetail');
    expect(handle.uniforms.cloudDetail.value).toBe(1);
    handle.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
  });

  it('適応負荷時は再コンパイルせずuniformだけで雲を段階停止する', () => {
    const sky = new Sky();
    const handle = installCinematicSky(sky, {
      palette,
      mood: 'day',
      tier: 'high',
      reduceMotion: false,
      skyScale: 0.16,
      skyClamp: 0.5,
    });
    handle.setDetailScale(0.8);
    expect(handle.uniforms.cloudDetail.value).toBeCloseTo(0.58);
    handle.setDetailScale(0.6);
    expect(handle.uniforms.cloudDetail.value).toBe(0);
    handle.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
  });

  it('雲マップは小容量・決定論で、外部アセットを必要としない', () => {
    const a = createCinematicCloudData(32, 16, 123);
    const b = createCinematicCloudData(32, 16, 123);
    expect(a).toEqual(b);
    expect(a.byteLength).toBe(32 * 16 * 4);
    expect(new Set(a).size).toBeGreaterThan(8);
  });
});
