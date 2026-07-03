import * as THREE from 'three';

// ── プロシージャル惑星のGLSL(アセットレス: テクスチャ画像を一切使わない)──────────
// Ashima/Stefan Gustavson の 3D simplex noise(webgl-noise, MITライセンス相当の定番実装)
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int oct){
  float a=0.5,f=1.0,s=0.0;
  for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*snoise(p*f); f*=2.0; a*=0.5; }
  return s;
}
`;

// 等距円筒UV→3D方向ベクトル(極の歪み回避)
const EQUIRECT = /* glsl */ `
const float PI=3.14159265359;
vec3 dirFromUv(vec2 uv){
  float lon=(uv.x*2.0-1.0)*PI; float lat=(uv.y-0.5)*PI;
  return vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon));
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`;

// 各種等距円筒マップを1回だけ焼くベイクシェーダ
//   uMode 0=地球アルベド/陸マスク, 1=夜光, 2=雲, 3=星雲(深宇宙ガス)
// nebula(3)も同じRTベイク経路に載せ、毎フレームの全画面fbmを完全に排除する。
const BAKE_FRAG =
  NOISE +
  EQUIRECT +
  /* glsl */ `
varying vec2 vUv; uniform int uMode; uniform vec3 uSunDir;
void main(){
  vec3 d=dirFromUv(vUv);
  if(uMode==0){
    float h=fbm(d*2.2,5)+0.12*fbm(d*6.0,4);
    float land=smoothstep(0.02,0.16,h);
    float ice=smoothstep(0.72,0.86,abs(d.y));
    vec3 ocean=mix(vec3(0.02,0.13,0.32),vec3(0.05,0.27,0.45),smoothstep(-0.3,0.2,h));
    vec3 grass=mix(vec3(0.13,0.34,0.12),vec3(0.42,0.40,0.20),smoothstep(0.1,0.5,h));
    vec3 col=mix(ocean,grass,land);
    col=mix(col,vec3(0.92,0.95,0.99),ice);
    gl_FragColor=vec4(col, land); // a=陸マスク
  } else if(uMode==1){
    float h=fbm(d*2.2,5);
    float land=smoothstep(0.02,0.16,h);
    float c=fbm(d*18.0,3);
    float lights=smoothstep(0.55,0.8,c)*land*smoothstep(0.0,0.25,h);
    gl_FragColor=vec4(vec3(lights),1.0);
  } else if(uMode==2){
    float c=fbm(d*2.6+vec3(11.0),5);
    float band=0.5+0.5*sin(d.y*9.0);
    float dens=smoothstep(0.15,0.6,c*0.7+band*0.3);
    gl_FragColor=vec4(vec3(dens),1.0);
  } else {
    // 星雲: 低周波fbmで淡いガス塊、太陽方向(uSunDir)へ暖色を寄せて光源を1軸に統一
    float n=fbm(d*1.5+vec3(19.0),5);
    float wisp=fbm(d*3.4-vec3(7.0),4);
    float dens=smoothstep(0.10,0.92,n*0.72+wisp*0.28);
    dens*=dens; // 疎に絞り、空の大半は黒(本文可読性/加算暴発を抑制)
    float sun=max(0.0,dot(d,normalize(uSunDir)));
    vec3 cold=vec3(0.06,0.15,0.32);   // シアン寄りの青
    vec3 warm=vec3(0.34,0.14,0.07);   // emberの暖橙
    vec3 col=mix(cold,warm,smoothstep(0.05,0.95,sun));
    col+=vec3(0.40,0.19,0.08)*pow(sun,4.0)*0.6; // 太陽近傍の暖芯
    gl_FragColor=vec4(col*dens,1.0);
  }
}
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vNormalW; varying vec3 vViewW; varying vec3 vLocal; varying vec2 vUv;
void main(){
  vUv=uv; vLocal=normalize(position);
  vNormalW=normalize(mat3(modelMatrix)*normal);
  vec4 wp=modelMatrix*vec4(position,1.0);
  vViewW=normalize(cameraPosition-wp.xyz);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uAlbedo; uniform sampler2D uNight; uniform vec3 uSunDir;
varying vec3 vNormalW; varying vec3 vViewW; varying vec2 vUv;
void main(){
  vec3 N=normalize(vNormalW); float ndl=dot(N,normalize(uSunDir));
  float day=smoothstep(-0.06,0.12,ndl);
  vec4 alb=texture2D(uAlbedo,vUv); float city=texture2D(uNight,vUv).r;
  vec3 lit=alb.rgb*(0.10+0.90*day);
  vec3 night=vec3(1.0,0.82,0.45)*city*(1.0-day)*alb.a;
  float band=exp(-pow(ndl/0.10,2.0));
  vec3 scatter=mix(vec3(1.0,0.45,0.18),vec3(1.0,0.85,0.6),day);
  // 昼側のフレネル・リムライト(BO3的な地球の縁光り。太陽側ほど強い)
  float rim=pow(1.0-abs(dot(N,normalize(vViewW))),3.0);
  vec3 rimCol=vec3(0.35,0.6,1.0)*rim*max(0.0,day)*0.6;
  vec3 col=lit+night+scatter*band*0.5+rimCol;
  gl_FragColor=vec4(col,1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uCloud; uniform vec3 uSunDir; uniform float uCloudOffset;
varying vec3 vNormalW; varying vec2 vUv;
void main(){
  float day=smoothstep(-0.1,0.2,dot(normalize(vNormalW),normalize(uSunDir)));
  float c=texture2D(uCloud,vUv+vec2(uCloudOffset,0.0)).r;
  vec3 col=mix(vec3(0.07,0.09,0.14),vec3(1.0),day);
  gl_FragColor=vec4(col,c*0.8);
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir; varying vec3 vNormalW; varying vec3 vViewW;
void main(){
  vec3 N=normalize(vNormalW);
  float rim=pow(1.0-abs(dot(N,normalize(vViewW))),4.0);
  float sun=0.4+0.6*max(0.0,dot(N,normalize(uSunDir)));
  vec3 col=min(vec3(0.35,0.6,1.0)*rim*sun, vec3(1.2));
  gl_FragColor=vec4(col,rim*0.7);
}
`;

// 汎用惑星(uMode: 0=ガス縞, 1=岩石, 2=月クレーター)
const PLANET_FRAG =
  NOISE +
  /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uColA; uniform vec3 uColB; uniform int uMode; uniform float uScale;
varying vec3 vNormalW; varying vec3 vViewW; varying vec3 vLocal;
void main(){
  float t;
  if(uMode==0){ t=0.5+0.5*sin(vLocal.y*uScale + fbm(vLocal*3.0,4)*2.5); }
  else if(uMode==1){ t=0.5+0.5*fbm(vLocal*uScale,5); }
  else { float n=fbm(vLocal*uScale,5); t=smoothstep(0.0,0.6,abs(n)); }
  vec3 base=mix(uColA,uColB,t);
  float light=0.12+0.88*max(0.0,dot(normalize(vNormalW),normalize(uSunDir)));
  float rim=pow(1.0-abs(dot(normalize(vNormalW),normalize(vViewW))),3.0);
  vec3 col=base*light + uColB*rim*0.25;
  gl_FragColor=vec4(col,1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
void main(){ vUv=uv; vWorld=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const RING_FRAG = /* glsl */ `
varying vec2 vUv;
void main(){
  float r=vUv.x;
  float rings=0.55+0.45*sin(r*90.0);
  float cassini=smoothstep(0.42,0.45,r)*(1.0-smoothstep(0.49,0.52,r));
  float a=rings*(1.0-cassini*0.85)*smoothstep(1.0,0.85,r);
  vec3 col=mix(vec3(0.86,0.76,0.55),vec3(0.5,0.42,0.3),r);
  gl_FragColor=vec4(col,a*0.7);
}
`;

const GLOW_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
void main(){
  float d=distance(vUv,vec2(0.5));
  float g=smoothstep(0.5,0.0,d);
  vec3 col=min(vec3(1.0,0.86,0.6)*g, vec3(1.2));
  gl_FragColor=vec4(col,g*0.85);
}
`;

// 星雲スカイドーム: ベイク済みテクスチャを内向き球でサンプルするだけ(毎フレームfbmゼロ)。
// uOffset を極ゆっくり進めて経度方向にスクロールし、雲海が漂う奥行きを出す。
const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const NEBULA_FRAG = /* glsl */ `
uniform sampler2D uTex; uniform float uOffset; uniform float uDim;
varying vec2 vUv;
void main(){
  vec3 c=texture2D(uTex, vec2(vUv.x+uOffset, vUv.y)).rgb;
  gl_FragColor=vec4(c*uDim, 1.0);
}
`;

// 星野: ShaderMaterial化して uDim(減光)を uniform で受け、uTime で微かに瞬かせる。
// 頂点色/位相/サイズ/瞬き周波数は属性で持ち、加減はGPU側。sizeAttenuation相当は uPixelRatio で吸収。
// ⑤自然化: gl_PointSize は max(1.0,…) で床止め(WebGLはサブピクセル点を落とす=機械的シマーの原因)。
// 瞬きは aFreq で星ごとに独立させ、振幅を 0.72〜1.0 の浅い帯へ(消えない/派手すぎない)。
const STAR_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aPhase; attribute float aSize; attribute float aFreq;
uniform float uTime; uniform float uPixelRatio;
varying vec3 vCol; varying float vTw; varying float vSize;
void main(){
  vCol=aColor;
  // 星ごとに独立した周波数/位相で瞬く(同期した機械的な明滅を排除)。振幅0.72〜1.0。
  vTw=0.86+0.14*sin(uTime*aFreq+aPhase);
  vSize=aSize;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  // サブピクセル点はGPUが間引いてチラつくため最低1pxを保証する
  gl_PointSize=max(1.0, aSize*uPixelRatio);
}
`;
const STAR_FRAG = /* glsl */ `
uniform float uDim; varying vec3 vCol; varying float vTw; varying float vSize;
void main(){
  vec2 pc=gl_PointCoord-0.5;
  float d2=dot(pc,pc);
  // 芯: 全星に鋭い丸コア。ハロ: 明星(vSize大)だけ広い柔らかなグロー=自然な等級差。
  float core=smoothstep(0.25,0.015,d2);
  float halo=smoothstep(0.25,0.0,d2)*clamp((vSize-1.6)*0.3, 0.0, 0.45);
  float a=clamp(core+halo, 0.0, 1.0);
  gl_FragColor=vec4(vCol*vTw, a*uDim);
}
`;

// ── ページ連動カメラのフォーカス表 ────────────────────────────────
// 各MFDページで宇宙背景の画角(カメラ位置/注視点)と星の減光を切り替え、
// メニューにシネマ的な奥行きを与える。DoFは blur禁止(#space-bgを毎フレーム
// 全面再合成させない決定済)のため pixelRatio を落とす side で表現する。
export type BgFocus = {
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
  starDim: number;
};

// DEPLOY: ヒーロー化した地球(手前・大径)へ正対
const DEFAULT_FOCUS: BgFocus = { pos: [0, 0, 0.3], look: [1.12, -0.68, -3.5], starDim: 1 };
const FOCUS: Record<string, BgFocus> = {
  // DEPLOY: 地球をヒーローに正対
  deploy: DEFAULT_FOCUS,
  // CAMPAIGN: 環付き巨星へ振り、広大な戦役の画へ
  campaign: { pos: [-0.8, 0.42, 0.5], look: [-30, 16, -84], starDim: 0.85 },
  // ARMORY: 手前の月へ寄せ、星を落として武器プレビューを引き立てる
  armory: { pos: [0.3, 0.18, 0.9], look: [-2.4, 1.6, -7.2], starDim: 0.62 },
  // INTEL: 赤錆の岩石惑星を遠望
  intel: { pos: [0.55, -0.12, 0.36], look: [22, -8, -118], starDim: 0.9 },
  // SYSTEM: 深宇宙側へ静かに傾ける
  system: { pos: [-0.4, 0.28, 0.72], look: [-6, 3, -60], starDim: 0.78 },
};

const STAR_COUNT = 3000;
const DUST_COUNT = 300; // 近景の浮遊ダスト(BO3的な奥行きの手掛かり)
const DUST_CHUNK = 60; // 1フレームで動かす点数(残りは据置=部分アップロードで軽量化)

// メニュー背景の宇宙(星野)。GameLoopとは独立した自前RAFで回す軽量レンダラ。
// アセットレス: 星は単一Points 1ドローコール、地球/星雲はプロシージャルGLSLをRTへ
// 1回ベイクして参照するのみ(毎フレームの全画面fbmを持たない)。start/stopは冪等で、
// 出撃時は確実に停止・非表示にしてプレイ中のRAF/GPUを圧迫しない。
export class SpaceBg {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stars: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly starUniforms: {
    uTime: { value: number };
    uDim: { value: number };
    uPixelRatio: { value: number };
  };
  private rafId = 0;
  private running = false;
  private reduceMotion = false;
  private spin = 0;
  private targetX = 0;
  private targetY = 0;
  private offX = 0;
  private offY = 0;
  private readonly finePointer: boolean;

  // ── 太陽系オブジェクト(地球+伴星) ──────────────────────────────
  // 全惑星/星雲/ダストで共有する太陽方向(昼夜境界・大気散乱・縞・暖色ガスを一貫させる)
  private readonly uSunDir = new THREE.Vector3(0.8, 0.25, 0.55).normalize();
  private readonly earthGroup = new THREE.Group();
  private readonly planetGroup = new THREE.Group();
  private cloudMesh: THREE.Mesh | null = null;
  private earthMat: THREE.ShaderMaterial | null = null;
  private cloudMat: THREE.ShaderMaterial | null = null;
  private atmoMat: THREE.ShaderMaterial | null = null;
  private sunGlow: THREE.Mesh | null = null;
  private readonly planetMats: THREE.ShaderMaterial[] = [];
  private readonly spinners: THREE.Object3D[] = [];
  // 地球マップ/星雲は起動時に1回だけ等距円筒テクスチャへ焼く(毎フレームのfbm呼び出しを回避)
  private bakedAlbedo: THREE.WebGLRenderTarget | null = null;
  private bakedNight: THREE.WebGLRenderTarget | null = null;
  private bakedCloud: THREE.WebGLRenderTarget | null = null;
  private bakedNebula: THREE.WebGLRenderTarget | null = null;

  // ── 星雲スカイドーム ──────────────────────────────────────────
  private nebulaMesh: THREE.Mesh | null = null;
  private nebulaMat: THREE.ShaderMaterial | null = null;

  // ── 近景ダスト(対称ラップ・部分アップロード) ────────────────────
  private dustPoints: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;
  private dustPos: Float32Array = new Float32Array(0);
  private readonly dustVel = new Float32Array(DUST_COUNT * 3);
  private dustCursor = 0;
  private readonly dustCenter = new THREE.Vector3(1.2, -0.85, -3.1);
  private readonly dustHalf = new THREE.Vector3(3.4, 2.7, 2.4);

  // ── 流星(アクセント。常時は非表示でコストゼロ) ────────────────────
  private meteor: THREE.Line | null = null;
  private meteorGeo: THREE.BufferGeometry | null = null;
  private meteorMat: THREE.LineBasicMaterial | null = null;
  private meteorLife = 0;
  private meteorMax = 1;
  private meteorTimer = 5;
  private readonly meteorHead = new THREE.Vector3();
  private readonly meteorDir = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  private lastT = 0; // dt正規化用(高リフレッシュ環境で回転が速くなりすぎないように)

  // ── ページ連動カメラ(setFocus / setModalDim) ──────────────────────
  private readonly focusPos = new THREE.Vector3(0, 0, 0.3);
  private readonly focusLook = new THREE.Vector3(0, 0, -1);
  private readonly curPos = new THREE.Vector3(0, 0, 0.3);
  private readonly curLook = new THREE.Vector3(0, 0, -1);
  private readonly lookScratch = new THREE.Vector3();
  private targetStarDim = 1;
  private curStarDim = 1;
  private modalDim = 0; // モーダル時のDoF量(pixelRatioを落とし被写界深度風に。blur不使用)
  private focusInited = false;

  private readonly onResize = (): void => this.resize();
  private readonly onVisibility = (): void => {
    if (document.hidden) this.pauseLoop();
    else if (this.running) this.startLoop();
  };
  private readonly onPointer = (e: PointerEvent): void => {
    if (!this.finePointer) return;
    this.targetX = e.clientX / window.innerWidth - 0.5;
    this.targetY = e.clientY / window.innerHeight - 0.5;
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.finePointer =
      typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x05070b, 1);
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      2000,
    );

    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const phases = new Float32Array(STAR_COUNT);
    const sizes = new Float32Array(STAR_COUNT);
    const freqs = new Float32Array(STAR_COUNT);
    // ⑤自然化: 色温度8色パレット(青白い高温→白→黄→橙赤の低温)。白系を厚めにし、
    // シアン/アンバーの寒暖アクセントを少数散らす。palette[0] の null合体ガードは維持。
    const palette = [
      new THREE.Color(0xf4f6ff), // 高温の青白
      new THREE.Color(0xeef2ff), // 白(A型)
      new THREE.Color(0xf0f1ee), // 中間の白
      new THREE.Color(0xfdf6e8), // 暖白(F/G型・太陽似)
      new THREE.Color(0xd6e6ff), // 青みの白(B型)
      new THREE.Color(0x9fd6e8), // シアン寄り
      new THREE.Color(0xffdca8), // 琥珀(K型)
      new THREE.Color(0xffb9a8), // 橙赤(M型)
    ];
    for (let i = 0; i < STAR_COUNT; i += 1) {
      // 遠方の球殻に配置(半径500-900)。手前の惑星(z≈-3〜-110)が星に隠れないよう
      // 一様な立方体ではなく球面方向に散らし、深度的に必ず奥へ置く
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = 500 + Math.random() * 400;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(phi) * s * r;
      positions[i * 3 + 1] = u * r;
      positions[i * 3 + 2] = Math.sin(phi) * s * r;
      const c = palette[Math.floor(Math.random() * palette.length)] ?? palette[0]!;
      // 明るさは対数寄り(べき乗)の分布: 大多数を暗く、少数だけ明るく(実際の等級分布)
      const rb = Math.random();
      const b = 0.3 + 0.7 * rb * rb;
      colors[i * 3] = c.r * b;
      colors[i * 3 + 1] = c.g * b;
      colors[i * 3 + 2] = c.b * b;
      phases[i] = Math.random() * Math.PI * 2;
      // サイズはべき乗分布(0.9〜3.3px相当)。多くは最小級、稀に大きな明星。床止めはシェーダ側。
      sizes[i] = 0.9 + Math.pow(Math.random(), 2.2) * 2.4;
      // 瞬き周波数を星ごとに独立(0.4〜2.0)=同期しない自然なシンチレーション
      freqs[i] = 0.4 + Math.random() * 1.6;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aFreq', new THREE.BufferAttribute(freqs, 1));
    this.starUniforms = {
      uTime: { value: 0 },
      uDim: { value: 0.95 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    };
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
    });
    this.stars = new THREE.Points(this.geometry, this.starMat);
    this.scene.add(this.stars);

    // 太陽系。星雲スカイドーム、地球(本体+雲+大気の3殻)、伴星、太陽コロナ、近景ダスト
    this.buildNebula();
    this.buildEarth();
    this.buildCompanions();
    this.buildSunGlow();
    this.buildDust();
    this.buildMeteor();
    this.scene.add(this.earthGroup, this.planetGroup);

    this.resize();
  }

  // 等距円筒マップ(地球アルベド/夜光/雲 + 星雲)を起動時に1回だけGPUで焼く。
  // 以後は各シェーダがテクスチャを参照するだけ(毎フレームのfbmゼロ)。
  private bakeMaps(): void {
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: { uMode: { value: 0 }, uSunDir: { value: this.uSunDir } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quadScene.add(quad);
    const bake = (w: number, h: number, mode: number): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, // 経度方向にシームレス(雲/星雲スクロール用)
        depthBuffer: false,
      });
      mat.uniforms.uMode!.value = mode;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(quadScene, quadCam);
      return rt;
    };
    this.bakedAlbedo = bake(1024, 512, 0);
    this.bakedNight = bake(512, 256, 1);
    this.bakedCloud = bake(512, 256, 2);
    this.bakedNebula = bake(512, 288, 3); // 低解像で十分(ぼけた深宇宙ガス)
    this.renderer.setRenderTarget(null);
    quad.geometry.dispose();
    mat.dispose();
  }

  private buildNebula(): void {
    this.bakeMaps();
    this.nebulaMat = new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // depthTest は既定(true): 手前の地球/惑星が星雲を遮蔽し、加算で地球を洗い流さない。
      // renderOrder -3 で透過パスの最初に描き、星は上に重なる(深度クリア=遠方なので通過)。
      uniforms: {
        uTex: { value: this.bakedNebula!.texture },
        uOffset: { value: 0 },
        uDim: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 24), this.nebulaMat);
    mesh.renderOrder = -3;
    this.nebulaMesh = mesh;
    this.scene.add(mesh);
  }

  private buildEarth(): void {
    const sun = this.uSunDir;
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        uAlbedo: { value: this.bakedAlbedo!.texture },
        uNight: { value: this.bakedNight!.texture },
        uSunDir: { value: sun },
      },
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.0, 64, 48), this.earthMat);
    body.renderOrder = 0;

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCloud: { value: this.bakedCloud!.texture },
        uSunDir: { value: sun },
        uCloudOffset: { value: 0 },
      },
    });
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 48, 32), this.cloudMat);
    this.cloudMesh.scale.setScalar(1.006);
    this.cloudMesh.renderOrder = 1;

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: { uSunDir: { value: sun } },
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 24), this.atmoMat);
    atmo.scale.setScalar(1.035);
    atmo.renderOrder = 2;

    this.earthGroup.add(body, this.cloudMesh, atmo);
    // ヒーロー化: 手前(z)へ寄せ、3殻ごと1.25倍に拡大して迫力と奥行きを出す
    this.earthGroup.position.set(1.2, -0.85, -3.1);
    this.earthGroup.scale.setScalar(1.25);
    this.earthGroup.rotation.z = 0.41; // 自転軸の傾き(23.4°相当)を演出
  }

  private buildCompanions(): void {
    const sun = this.uSunDir;
    const mkPlanet = (
      mode: number,
      colA: number,
      colB: number,
      detail: number,
      radius: number,
      seg: number,
      pos: readonly [number, number, number],
    ): THREE.Mesh => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
        uniforms: {
          uSunDir: { value: sun },
          uColA: { value: new THREE.Color(colA) },
          uColB: { value: new THREE.Color(colB) },
          uMode: { value: mode },
          uScale: { value: detail },
        },
      });
      this.planetMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg), mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      this.planetGroup.add(mesh);
      this.spinners.push(mesh);
      return mesh;
    };

    // 環付きアンバーのガス巨星(遠景・左上)
    const giant = mkPlanet(0, 0xd9b380, 0x7a4a22, 9.0, 5.0, 48, [-34, 19, -86]);
    const innerR = 6.4;
    const outerR = 10.8;
    const ringGeo = new THREE.RingGeometry(innerR, outerR, 128, 1);
    // RingGeometryの既定UVは扇状。半径方向(0..1)へ張り直してCassini空隙を出す
    const rpos = ringGeo.attributes.position as THREE.BufferAttribute;
    const ruv = ringGeo.attributes.uv as THREE.BufferAttribute;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < rpos.count; i += 1) {
      v3.fromBufferAttribute(rpos, i);
      ruv.setXY(i, (v3.length() - innerR) / (outerR - innerR), 0);
    }
    ruv.needsUpdate = true;
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.planetMats.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 - 0.42;
    ring.rotation.z = 0.2;
    giant.add(ring); // 巨星と一緒に自転(spinners には巨星のみ)

    // 赤錆の岩石惑星(右奥)
    mkPlanet(1, 0x9c4a2a, 0xc97a4a, 5.0, 1.7, 36, [24, -9, -118]);
    // 月(地球の少し手前・上)。クレーター調
    mkPlanet(2, 0x83838a, 0xcfd2d8, 5.0, 0.42, 28, [-2.4, 1.7, -7.2]);
  }

  private buildSunGlow(): void {
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false, // 常に最奥として加算(星の上にうっすら太陽光)
    });
    this.planetMats.push(mat);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat);
    glow.position.copy(this.uSunDir).multiplyScalar(160);
    glow.lookAt(0, 0, 0); // カメラ(原点付近)へ正対させる
    glow.renderOrder = -1;
    this.sunGlow = glow;
    this.scene.add(glow);
  }

  // 近景ダスト。対称ラップの箱の中を極ゆっくり漂う微粒子(加算)。位置更新は毎フレーム
  // 全点ではなく DUST_CHUNK 点ずつローリング更新し、addUpdateRange で部分アップロード。
  private buildDust(): void {
    const pos = new Float32Array(DUST_COUNT * 3);
    const col = new Float32Array(DUST_COUNT * 3);
    const c = this.dustCenter;
    const h = this.dustHalf;
    const warm = new THREE.Color(0xffb890);
    const cold = new THREE.Color(0x9fd0e8);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      pos[i * 3] = c.x + (Math.random() * 2 - 1) * h.x;
      pos[i * 3 + 1] = c.y + (Math.random() * 2 - 1) * h.y;
      pos[i * 3 + 2] = c.z + (Math.random() * 2 - 1) * h.z;
      // ごく遅いドリフト(embersと同調して下方向へ僅かに流す)
      this.dustVel[i * 3] = (Math.random() * 2 - 1) * 0.05;
      this.dustVel[i * 3 + 1] = -0.03 - Math.random() * 0.04;
      this.dustVel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.04;
      const t = Math.random();
      const k = warm.clone().lerp(cold, t).multiplyScalar(0.28 + Math.random() * 0.22);
      col[i * 3] = k.r;
      col[i * 3 + 1] = k.g;
      col[i * 3 + 2] = k.b;
    }
    this.dustPos = pos;
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage); // 部分アップロードを許可
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.06,
      sizeAttenuation: true, // 近い粒ほど大きく=奥行きの手掛かり
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 3; // 近景として惑星の手前に淡く加算
    points.frustumCulled = false; // 箱がカメラを覆うため常時描画
    this.dustGeo = geo;
    this.dustPoints = points;
    this.scene.add(points);
  }

  private buildMeteor(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbfd8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    this.meteorGeo = geo;
    this.meteorMat = mat;
    this.meteor = line;
    this.meteorTimer = 4 + Math.random() * 6;
    this.scene.add(line);
  }

  // 星野/星雲の減光を curStarDim から一括反映(3つのopacity書込点を uniform 経由へ集約)。
  private applyDim(): void {
    this.starUniforms.uDim.value = 0.95 * this.curStarDim;
    // 星雲はバックドロップとして残しつつ、ページ減光に緩く追従(消えはしない)
    if (this.nebulaMat) this.nebulaMat.uniforms.uDim!.value = 0.62 + 0.38 * this.curStarDim;
  }

  // 冪等: 既に走行中なら何もしない
  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (this.finePointer) window.addEventListener('pointermove', this.onPointer);
    this.startLoop();
  }

  // 冪等: 二重停止しても安全
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.pauseLoop();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.canvas.hidden = true;
  }

  setReduceMotion(v: boolean): void {
    const was = this.reduceMotion;
    this.reduceMotion = v;
    // 省モーションを解除したら動きを再開。有効化時は frame() が1枚描いて自然停止する
    if (was && !v && this.running) this.startLoop();
  }

  // MFDページに応じて画角を切り替える。通常時は frame() が指数減衰で寄せ、
  // 省モーション時と初回は即着地して1枚だけ描き直す(誤った既定向きからのパンを避ける)。
  setFocus(page: string): void {
    const f = FOCUS[page] ?? DEFAULT_FOCUS;
    this.focusPos.set(f.pos[0], f.pos[1], f.pos[2]);
    this.focusLook.set(f.look[0], f.look[1], f.look[2]);
    this.targetStarDim = f.starDim;
    if (!this.focusInited || this.reduceMotion) {
      this.focusInited = true;
      this.curPos.copy(this.focusPos);
      this.curLook.copy(this.focusLook);
      this.curStarDim = this.targetStarDim;
      this.applyDim();
      this.camera.position.copy(this.curPos);
      this.camera.lookAt(this.curLook);
      // 省モーションでループ停止中(running かつ rafId==0)は1枚描き直す(resize同型)
      if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
    }
  }

  // モーダル(ブリーフィング等)表示時の被写界深度風のぼけ量。blur禁止のため、
  // renderer の pixelRatio を落として星野を柔らかく沈める(DOM側の減光はCSSが担う)。
  setModalDim(v: number): void {
    const nv = THREE.MathUtils.clamp(v, 0, 1);
    if (nv === this.modalDim) return;
    this.modalDim = nv;
    this.applyPixelRatio();
    if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
  }

  private basePixelRatio(): number {
    const full = Math.min(window.devicePixelRatio || 1, 1.5);
    // modalDim=1 で約0.6倍まで解像度を落とし、DoF風の柔らかさを作る
    return full * (1 - this.modalDim * 0.4);
  }

  private applyPixelRatio(): void {
    const pr = this.basePixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, Math.max(1, window.innerHeight), false);
    this.starUniforms.uPixelRatio.value = pr;
  }

  private startLoop(): void {
    if (this.rafId) return;
    const tick = (): void => {
      this.frame();
      // frame() 内の pauseLoop()(省モーションの自然停止)が rafId を 0 にしたら
      // 再スケジュールしない。通常時は発火済みハンドル(非0)が残るので継続する
      if (this.rafId !== 0) this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pauseLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private frame(): void {
    const now = performance.now();
    // 60fps基準の経過倍率。初回(lastT=0)は1、タブ復帰の大ジャンプは2に制限
    const dt60 = this.lastT === 0 ? 1 : Math.min(((now - this.lastT) / 1000) * 60, 2);
    this.lastT = now;

    // 省モーション時は見栄えの良い静止ポーズ(現在のフォーカス向き)を1枚だけ描く
    if (this.reduceMotion) {
      this.stars.rotation.y = this.spin;
      this.applyDim();
      this.camera.position.copy(this.curPos);
      this.camera.lookAt(this.curLook);
      this.renderer.render(this.scene, this.camera);
      this.pauseLoop();
      return;
    }
    this.spin += 0.0002 * dt60; // ごく緩い星野の旋回
    this.offX += (this.targetX - this.offX) * 0.04;
    this.offY += (this.targetY - this.offY) * 0.04;
    this.stars.rotation.y = this.spin;
    this.starUniforms.uTime.value = now * 0.001; // 星の瞬き

    // ページ連動フォーカスへ指数減衰で寄せる(cinematicカメラ)。星の減光も追従
    const foc = 1 - Math.pow(0.9, dt60);
    this.curPos.lerp(this.focusPos, foc);
    this.curLook.lerp(this.focusLook, foc);
    this.curStarDim += (this.targetStarDim - this.curStarDim) * foc;
    this.applyDim();

    // 地球の自転・雲の流れ・伴星の自転(すべてdt正規化)
    this.earthGroup.rotation.y += 0.0009 * dt60;
    if (this.cloudMesh) this.cloudMesh.rotation.y += 0.0012 * dt60;
    if (this.cloudMat) {
      const u = this.cloudMat.uniforms.uCloudOffset!;
      u.value = ((u.value as number) + 0.00012 * dt60) % 1.0;
    }
    // 星雲の極低速スクロール(漂う深宇宙ガス)
    if (this.nebulaMat) {
      const u = this.nebulaMat.uniforms.uOffset!;
      u.value = ((u.value as number) + 0.000006 * dt60) % 1.0;
    }
    for (const s of this.spinners) s.rotation.y += 0.00018 * dt60;

    this.updateDust(dt60);
    this.updateMeteor(dt60);

    // Lissajousの微小ドリフト+ポインタ視差でカメラに命を吹き込む。近景の月と
    // 遠景の巨星に視差差が出て立体感が跳ねる(注視点側に足すほど自然な首振り)
    const t = now * 0.001;
    const driftX = Math.sin(t * 0.13) * 0.06 + Math.sin(t * 0.29) * 0.02;
    const driftY = Math.cos(t * 0.11) * 0.045 + Math.cos(t * 0.23) * 0.02;
    this.camera.position.set(
      this.curPos.x + this.offX * 0.18 + driftX * 0.5,
      this.curPos.y - this.offY * 0.14 + driftY * 0.5,
      this.curPos.z,
    );
    this.lookScratch.copy(this.curLook);
    this.lookScratch.x += this.offX * 0.6 + driftX;
    this.lookScratch.y += -this.offY * 0.6 + driftY;
    this.camera.lookAt(this.lookScratch);
    this.renderer.render(this.scene, this.camera);
  }

  // 近景ダストを DUST_CHUNK 点ずつローリング更新(対称ラップ)。動かした範囲だけ
  // addUpdateRange で部分アップロードし、残りは前フレームのバッファを再利用する。
  private updateDust(dt60: number): void {
    if (!this.dustGeo) return;
    const dts = dt60 / 60;
    const pos = this.dustPos;
    const vel = this.dustVel;
    const c = this.dustCenter;
    const h = this.dustHalf;
    const start = this.dustCursor;
    const end = Math.min(start + DUST_CHUNK, DUST_COUNT);
    for (let i = start; i < end; i += 1) {
      const bx = i * 3;
      let x = pos[bx]! + vel[bx]! * dts;
      let y = pos[bx + 1]! + vel[bx + 1]! * dts;
      let z = pos[bx + 2]! + vel[bx + 2]! * dts;
      // 対称ラップ: 箱の外に出たら反対側へ回り込ませる
      if (x - c.x > h.x) x -= 2 * h.x;
      else if (x - c.x < -h.x) x += 2 * h.x;
      if (y - c.y > h.y) y -= 2 * h.y;
      else if (y - c.y < -h.y) y += 2 * h.y;
      if (z - c.z > h.z) z -= 2 * h.z;
      else if (z - c.z < -h.z) z += 2 * h.z;
      pos[bx] = x;
      pos[bx + 1] = y;
      pos[bx + 2] = z;
    }
    const attr = this.dustGeo.attributes.position as THREE.BufferAttribute;
    attr.clearUpdateRanges();
    attr.addUpdateRange(start * 3, (end - start) * 3);
    attr.needsUpdate = true;
    this.dustCursor = end >= DUST_COUNT ? 0 : end;
  }

  // 流星(アクセント)。待機中はタイマーを進めるだけ、発火中のみ2頂点を更新する。
  private updateMeteor(dt60: number): void {
    if (!this.meteor || !this.meteorGeo || !this.meteorMat) return;
    const dts = dt60 / 60;
    if (this.meteorLife > 0) {
      this.meteorLife -= dts;
      this.meteorHead.addScaledVector(this.meteorDir, 46 * dts);
      const tail = this.scratch.copy(this.meteorHead).addScaledVector(this.meteorDir, -6.5);
      const pa = this.meteorGeo.attributes.position as THREE.BufferAttribute;
      pa.setXYZ(0, this.meteorHead.x, this.meteorHead.y, this.meteorHead.z);
      pa.setXYZ(1, tail.x, tail.y, tail.z);
      pa.needsUpdate = true;
      const life01 = Math.max(0, this.meteorLife / this.meteorMax);
      const fadeIn = Math.min(1, (this.meteorMax - this.meteorLife) / (this.meteorMax * 0.15));
      const fadeOut = Math.min(1, life01 / 0.5);
      this.meteorMat.opacity = 0.85 * fadeIn * fadeOut;
      if (this.meteorLife <= 0) this.meteor.visible = false;
    } else {
      this.meteorTimer -= dts;
      if (this.meteorTimer <= 0) this.spawnMeteor();
    }
  }

  private spawnMeteor(): void {
    if (!this.meteor) return;
    this.meteorMax = 0.7 + Math.random() * 0.5;
    this.meteorLife = this.meteorMax;
    this.meteorTimer = 7 + Math.random() * 10;
    const ang = Math.PI * 0.16 + Math.random() * Math.PI * 0.2; // やや下向きの斜め
    this.meteorDir.set(-Math.cos(ang), -Math.sin(ang), 0).normalize();
    // 深宇宙(mid-field)に置き、星野を横切らせる
    this.meteorHead.set(-28 + Math.random() * 70, 20 + Math.random() * 12, -50 - Math.random() * 22);
    this.meteor.visible = true;
    if (this.meteorMat) this.meteorMat.opacity = 0;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.applyPixelRatio();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 省モーションでループ停止中(running かつ rafId==0)はリサイズ時に1枚描き直す
    if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    this.geometry.dispose();
    this.starMat.dispose();
    // 惑星のジオメトリ/マテリアルとベイク済みRenderTargetを解放
    for (const group of [this.earthGroup, this.planetGroup]) {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    for (const mat of this.planetMats) mat.dispose();
    this.earthMat?.dispose();
    this.cloudMat?.dispose();
    this.atmoMat?.dispose();
    if (this.sunGlow) {
      this.sunGlow.geometry.dispose();
      (this.sunGlow.material as THREE.Material).dispose();
    }
    // 星雲スカイドーム
    this.nebulaMesh?.geometry.dispose();
    this.nebulaMat?.dispose();
    // 近景ダスト(dustPoints が geometry/material の所有者)
    if (this.dustPoints) {
      this.dustPoints.geometry.dispose();
      (this.dustPoints.material as THREE.Material).dispose();
    }
    // 流星
    this.meteorGeo?.dispose();
    this.meteorMat?.dispose();
    // ベイク済みRT
    this.bakedAlbedo?.dispose();
    this.bakedNight?.dispose();
    this.bakedCloud?.dispose();
    this.bakedNebula?.dispose();
    this.renderer.dispose();
  }
}
