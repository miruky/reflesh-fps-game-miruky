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

// 地球マップを1回だけ焼くベイクシェーダ(uMode: 0=アルベド/陸マスク, 1=夜光, 2=雲)
const BAKE_FRAG =
  NOISE +
  EQUIRECT +
  /* glsl */ `
varying vec2 vUv; uniform int uMode;
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
  } else {
    float c=fbm(d*2.6+vec3(11.0),5);
    float band=0.5+0.5*sin(d.y*9.0);
    float dens=smoothstep(0.15,0.6,c*0.7+band*0.3);
    gl_FragColor=vec4(vec3(dens),1.0);
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
varying vec3 vNormalW; varying vec2 vUv;
void main(){
  vec3 N=normalize(vNormalW); float ndl=dot(N,normalize(uSunDir));
  float day=smoothstep(-0.06,0.12,ndl);
  vec4 alb=texture2D(uAlbedo,vUv); float city=texture2D(uNight,vUv).r;
  vec3 lit=alb.rgb*(0.10+0.90*day);
  vec3 night=vec3(1.0,0.82,0.45)*city*(1.0-day)*alb.a;
  float band=exp(-pow(ndl/0.10,2.0));
  vec3 scatter=mix(vec3(1.0,0.45,0.18),vec3(1.0,0.85,0.6),day);
  vec3 col=lit+night+scatter*band*0.5;
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


// ── ページ連動カメラのフォーカス表 ────────────────────────────────
// 各MFDページで宇宙背景の画角(カメラ位置/注視点)と星の減光を切り替え、
// メニューにシネマ的な奥行きを与える。DoFは blur禁止(#space-bgを毎フレーム
// 全面再合成させない決定済)のため pixelRatio を落とす side で表現する。
export type BgFocus = {
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
  starDim: number;
};

const DEFAULT_FOCUS: BgFocus = { pos: [0, 0, 0.3], look: [1.3, -0.8, -3.4], starDim: 1 };
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

// メニュー背景の宇宙(星野)。GameLoopとは独立した自前RAFで回す軽量レンダラ。
// アセットレス: 単一のPointsで約3000星を1ドローコール。start/stopは冪等で、
// 出撃時は確実に停止・非表示にしてプレイ中のRAF/GPUを圧迫しない。
export class SpaceBg {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stars: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
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
  // 全惑星で共有する太陽方向(昼夜境界・大気散乱・縞の陰影を一貫させる)
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
  // 地球マップは起動時に1回だけ等距円筒テクスチャへ焼く(毎フレームのfbm呼び出しを回避)
  private bakedAlbedo: THREE.WebGLRenderTarget | null = null;
  private bakedNight: THREE.WebGLRenderTarget | null = null;
  private bakedCloud: THREE.WebGLRenderTarget | null = null;
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

    const COUNT = 3000;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    // 純白を避け、わずかにシアン/アンバーへ振った星色(--ink/--signal/--ember-ink相当)
    const palette = [
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0x9fd6e8),
      new THREE.Color(0xbcdcff),
      new THREE.Color(0xffb9a8),
    ];
    for (let i = 0; i < COUNT; i += 1) {
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
      const b = 0.5 + Math.random() * 0.5;
      colors[i * 3] = c.r * b;
      colors[i * 3 + 1] = c.g * b;
      colors[i * 3 + 2] = c.b * b;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 1.7,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.stars = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.stars);

    // 太陽系。地球(本体+雲+大気の3殻)、伴星(環付き巨星/岩石/月)、太陽コロナ
    this.buildEarth();
    this.buildCompanions();
    this.buildSunGlow();
    this.scene.add(this.earthGroup, this.planetGroup);

    this.resize();
  }

  // 等距円筒の地球マップ(アルベド+陸マスク/夜光/雲)を起動時に1回だけGPUで焼く。
  // 以後はEARTH/CLOUDシェーダがテクスチャを参照するだけ(毎フレームのfbmゼロ)。
  private bakeEarthMaps(): void {
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: { uMode: { value: 0 } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quadScene.add(quad);
    const bake = (w: number, h: number, mode: number): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, // 経度方向にシームレス(雲スクロール用)
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
    this.renderer.setRenderTarget(null);
    quad.geometry.dispose();
    mat.dispose();
  }

  private buildEarth(): void {
    this.bakeEarthMaps();
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
    this.earthGroup.position.set(1.5, -0.95, -3.4);
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
      this.material.opacity = 0.95 * this.curStarDim;
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
    this.renderer.setPixelRatio(this.basePixelRatio());
    this.renderer.setSize(window.innerWidth, Math.max(1, window.innerHeight), false);
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
      this.material.opacity = 0.95 * this.curStarDim;
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

    // ページ連動フォーカスへ指数減衰で寄せる(cinematicカメラ)。星の減光も追従
    const foc = 1 - Math.pow(0.9, dt60);
    this.curPos.lerp(this.focusPos, foc);
    this.curLook.lerp(this.focusLook, foc);
    this.curStarDim += (this.targetStarDim - this.curStarDim) * foc;
    this.material.opacity = 0.95 * this.curStarDim;

    // 地球の自転・雲の流れ・伴星の自転(すべてdt正規化)
    this.earthGroup.rotation.y += 0.0009 * dt60;
    if (this.cloudMesh) this.cloudMesh.rotation.y += 0.0012 * dt60;
    if (this.cloudMat) {
      const u = this.cloudMat.uniforms.uCloudOffset!;
      u.value = ((u.value as number) + 0.00012 * dt60) % 1.0;
    }
    for (const s of this.spinners) s.rotation.y += 0.00018 * dt60;

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

  private resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this.basePixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 省モーションでループ停止中(running かつ rafId==0)はリサイズ時に1枚描き直す
    if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    this.geometry.dispose();
    this.material.dispose();
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
    this.bakedAlbedo?.dispose();
    this.bakedNight?.dispose();
    this.bakedCloud?.dispose();
    this.renderer.dispose();
  }
}
