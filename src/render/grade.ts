import { MathUtils, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { GradeParams } from '../game/stage';

// ── 映画的カラーグレード(フルスクリーンポスト) ──
// composer 順: Render → Bloom → Grade → SMAA → Output。Grade は OutputPass(Neutral+sRGB)
// より前段=線形HDR空間で走る。ムード別の色調(ティント/コントラスト/彩度)、周辺減光(ビネット)、
// レンズの色収差、フィルムグレインを一括で乗せてフィールドごとの「作品性」を作る。
export const GRADE_SHADER = {
  name: 'HibanaGrade',
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uContrast;
    uniform float uSat;
    uniform float uVignette;
    uniform float uVignetteR;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uTealOrange;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      // レンズ色収差: 中心から放射状にRチャンネルを外、Bを内へずらす(端ほど強い)
      vec2 off = d * (uChroma / uResolution) * dot(d, d) * 4.0;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + off).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - off).b;

      // ムードティント
      c *= uTint;
      // コントラスト(18%グレーを軸に伸縮)
      c = (c - 0.18) * uContrast + 0.18;
      // 彩度
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSat);
      // 同じHDRパス内で寒色の影と暖色の光を僅かに分離する。別PostFXを常時1枚
      // 回さず、立体感と素材の色分離だけを増やす。
      float shadowMask = 1.0 - smoothstep(0.08, 0.52, luma);
      float lightMask = smoothstep(0.28, 1.1, luma);
      c *= mix(vec3(1.0), vec3(0.90, 1.025, 1.065), shadowMask * uTealOrange);
      c *= mix(vec3(1.0), vec3(1.065, 1.015, 0.91), lightMask * uTealOrange);
      // 周辺減光(中央は uVignetteR まで無減光。vignetteR を高めに保ち中央を広く残す)
      float vig = smoothstep(uVignetteR, uVignetteR - 0.45, length(d));
      c *= mix(1.0, vig, uVignette);
      // フィルムグレイン(uTime を混ぜてフレーム毎に更新。reduceMotion では uTime 停止=静止粒状)
      float g = (hash(vUv * uResolution + uTime) - 0.5) * uGrain;
      c += g;

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

// uTime を composer の deltaTime で自走させる ShaderPass。reduceMotion のときは
// 加算を止めてグレインを静止させる。uResolution は composer のリサイズで追従。
class GradePass extends ShaderPass {
  private readonly animate: boolean;

  constructor(
    animate: boolean,
    width: number,
    height: number,
    params: GradeParams,
    tealOrange: number,
  ) {
    super({
      name: GRADE_SHADER.name,
      uniforms: {
        tDiffuse: { value: null },
        uTint: { value: new Vector3(params.tint[0], params.tint[1], params.tint[2]) },
        uContrast: { value: params.contrast },
        uSat: { value: params.saturation },
        uVignette: { value: params.vignette },
        uVignetteR: { value: params.vignetteR },
        uGrain: { value: params.grain },
        uChroma: { value: params.chroma },
        uTealOrange: { value: tealOrange },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(width, height) },
      },
      vertexShader: GRADE_SHADER.vertexShader,
      fragmentShader: GRADE_SHADER.fragmentShader,
    });
    this.animate = animate;
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    if (this.animate) {
      const t = this.uniforms.uTime;
      // 1000秒でラップさせて float 精度の劣化を避ける
      if (t) t.value = (t.value + deltaTime) % 1000;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  override setSize(width: number, height: number): void {
    const r = this.uniforms.uResolution;
    if (r) (r.value as Vector2).set(width, height);
  }
}

// GradeParams から表示前段のグレードパスを生成する。
// opts.reduceMotion=true でグレインを静止、width/height はビネット/収差/グレインの
// アスペクト補正に使う(composer のリサイズでも setSize が追従)。
export function createGradePass(
  params: GradeParams,
  opts: { reduceMotion?: boolean; width?: number; height?: number; tealOrange?: number } = {},
): ShaderPass {
  return new GradePass(
    !opts.reduceMotion,
    opts.width ?? 1,
    opts.height ?? 1,
    params,
    MathUtils.clamp(opts.tealOrange ?? 0, 0, 1),
  );
}
