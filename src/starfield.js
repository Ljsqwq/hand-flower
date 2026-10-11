import * as THREE from 'three';

const TAU = Math.PI * 2;

/** 固定种子随机，保证每次刷新星空一致 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 冷白为主，掺一点暖白和淡蓝，避免整片星空死白
const PALETTE = [
  ['#ffffff', 0.34],
  ['#cfe0ff', 0.28],
  ['#ffe9c9', 0.22],
  ['#9ab8ff', 0.16],
];

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSize;
attribute float aPhase;
attribute float aTwinkle;
attribute float aBright;
attribute vec3 aColor;
varying vec3 vColor;
varying float vBright;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);

  // 闪烁：每颗星有自己的频率和相位，整体亮度不下沉
  float tw = 0.8 + 0.2 * sin(uTime * aTwinkle + aPhase);
  vBright = aBright * tw;
  vColor = aColor;

  // 距离衰减，远星更小，形成层次
  gl_PointSize = aSize * uPixelRatio * (42.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vBright;

void main() {
  float d = clamp(length(gl_PointCoord - 0.5) * 2.0, 0.0, 1.0);
  // 中心亮核 + 柔和外晕
  float core = pow(1.0 - d, 2.4);
  float halo = pow(1.0 - d, 0.9) * 0.28;
  float a = core + halo;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vColor * vBright, a * vBright);
}
`;

/**
 * 深空星场：一层 Points，加色混合。
 * 星星在相机前方的球壳里，整体极慢自转，只做背景氛围，不抢法阵。
 */
export class Starfield {
  constructor({ count = 2200, near = 12, far = 38, seed = 21 } = {}) {
    const rng = mulberry32(seed);
    const position = new Float32Array(count * 3);
    const aSize = new Float32Array(count);
    const aPhase = new Float32Array(count);
    const aTwinkle = new Float32Array(count);
    const aBright = new Float32Array(count);
    const aColor = new Float32Array(count * 3);

    const colors = PALETTE.map(([hex, weight]) => ({
      c: new THREE.Color(hex).convertSRGBToLinear(),
      weight,
    }));
    const totalWeight = colors.reduce((s, x) => s + x.weight, 0);

    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // 球面均匀采样，再把 z 压到相机前方（相机看 -z）
      const u = rng() * 2 - 1;
      const phi = rng() * TAU;
      const s = Math.sqrt(1 - u * u);
      const r = near + (far - near) * Math.cbrt(rng()); // 体积均匀，近处星不会过密
      position[i * 3] = Math.cos(phi) * s * r;
      position[i * 3 + 1] = u * r;
      position[i * 3 + 2] = -Math.abs(Math.sin(phi) * s * r) - 2;

      // 少量亮星：更大更亮，其余保持克制
      const bright = rng() > 0.96;
      aSize[i] = bright ? 3.4 + rng() * 2.0 : 1.0 + rng() * 1.6;
      aBright[i] = bright ? 1.0 + rng() * 0.45 : 0.42 + rng() * 0.5;
      aPhase[i] = rng() * TAU;
      aTwinkle[i] = 0.35 + rng() * 1.25;

      let pick = rng() * totalWeight;
      let chosen = colors[colors.length - 1].c;
      for (const entry of colors) {
        if (pick <= entry.weight) {
          chosen = entry.c;
          break;
        }
        pick -= entry.weight;
      }
      const jitter = 0.9 + rng() * 0.2; // 轻微色差，免得像贴图
      tmp.copy(chosen).multiplyScalar(jitter);
      aColor[i * 3] = tmp.r;
      aColor[i * 3 + 1] = tmp.g;
      aColor[i * 3 + 2] = tmp.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(aTwinkle, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));

    this.uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.points);
  }

  setPixelRatio(ratio) {
    this.uniforms.uPixelRatio.value = Math.min(ratio || 1, 2);
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    // 天穹缓慢转身，幅度压到几乎察觉不到，只是让背景不死板
    this.group.rotation.y = time * 0.006;
    this.group.rotation.x = Math.sin(time * 0.021) * 0.012;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
