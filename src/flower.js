import * as THREE from 'three';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const FLOWER_CONFIG = {
  petalCount: 7,
  petalParticles: 6500,
  coreParticles: 9000,
  pollenParticles: 5000,
  petalLength: 1.95,
  petalWidth: 0.68,
  budRadius: 0.5,
  maxTips: 10,
};

const PETAL_ROOT = new THREE.Color(0xfff3f8);
const PETAL_MID = new THREE.Color(0xff86bf);
const PETAL_TIP = new THREE.Color(0xa78bfa);
const CORE_DIM = new THREE.Color(0xffb347);
const CORE_HOT = new THREE.Color(0xfff2c4);
const POLLEN = new THREE.Color(0xffe6a8);

/**
 * 生成粒子花。
 * position 属性 = 绽放态坐标，aBud = 花苞态坐标，着色器里按 bloom 插值。
 */
export function createFlower(overrides = {}) {
  const cfg = { ...FLOWER_CONFIG, ...overrides };
  const petalTotal = cfg.petalCount * cfg.petalParticles;
  const total = petalTotal + cfg.coreParticles + cfg.pollenParticles;

  const positions = new Float32Array(total * 3); // 绽放态
  const buds = new Float32Array(total * 3); // 花苞态
  const colors = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const sizes = new Float32Array(total);

  let p = 0;
  const write = (bloomXyz, budXyz, color, size) => {
    positions.set(bloomXyz, p * 3);
    buds.set(budXyz, p * 3);
    colors.set([color.r, color.g, color.b], p * 3);
    seeds[p] = Math.random();
    sizes[p] = size;
    p++;
  };

  // ---------- 花瓣 ----------
  for (let petal = 0; petal < cfg.petalCount; petal++) {
    const angle = (petal / cfg.petalCount) * TAU + rand(-0.03, 0.03);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // 每片花瓣错开一点高度和卷曲，避免整齐划一
    const tilt = rand(-0.12, 0.12);

    for (let i = 0; i < cfg.petalParticles; i++) {
      // u 沿花瓣长度，按面积均匀采样
      const u = Math.sqrt(Math.random());
      // v 横向，靠近边缘的概率略高，让轮廓清晰
      const v = Math.sign(Math.random() - 0.5) * Math.pow(Math.random(), 0.85);

      // 尖端保留一点宽度，否则所有尖端粒子挤成一条线，叠加后死白
      const shape = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.92)), 0.7);
      const width = cfg.petalWidth * (0.16 + 0.84 * shape);
      const r = 0.1 + u * cfg.petalLength;
      const s = v * width;

      // 横向凹槽 + 尖端外翻，做出立体花瓣
      const cup = 0.34 * Math.pow(Math.abs(v), 2);
      const lift = 0.75 * Math.pow(u, 2.6);
      const z = cup - lift + tilt * u + rand(-0.05, 0.05);

      const x = r * ca - s * sa;
      const y = r * sa + s * ca;
      const bloomPos = [x, y, z];

      // 花苞态：花瓣真正卷起来包住花心，而不是沿射线收拢成球壳
      // 指数 <1 会让粒子全挤到顶部（u 本身分布偏大），用 >1 让高度近似均匀
      const heightT = Math.min(
        1,
        Math.max(0, (Math.pow(u, 1.8) + rand(-0.05, 0.05)) * 0.94),
      );
      // 每片花瓣在花苞态正好覆盖 1/7 圆周，留缝会露出棱锥状的缺口
      const phi = v * (Math.PI / cfg.petalCount) * 1.04;
      const waist = Math.max(
        0.14,
        Math.sin(Math.PI * Math.min(1, 0.1 + 0.9 * heightT)),
      );
      const tube = waist * cfg.budRadius * rand(0.3, 1.0);
      const swirl = angle + phi;
      const budPos = [
        Math.cos(swirl) * tube,
        heightT * cfg.budRadius * 1.85 - cfg.budRadius * 0.95 + 0.16,
        Math.sin(swirl) * tube * 0.8,
      ];

      const color = PETAL_ROOT.clone();
      if (u < 0.5) color.lerp(PETAL_MID, u / 0.5);
      else color.lerp(PETAL_TIP, (u - 0.5) / 0.5);
      color.offsetHSL(0, 0, rand(-0.05, 0.05));
      color.multiplyScalar(1 - 0.3 * Math.pow(u, 3)); // 尖端压暗，避免叠加后死白

      write(bloomPos, budPos, color, rand(2.6, 5.4) * (0.85 + 0.3 * u));
    }
  }

  // ---------- 花心 ----------
  for (let i = 0; i < cfg.coreParticles; i++) {
    // 绽放态：微微鼓起的蕊球
    const dir = randomUnit();
    const br = Math.pow(Math.random(), 0.6) * 0.44;
    const bloomPos = [dir[0] * br * 1.15, dir[1] * br + 0.06, dir[2] * br * 0.7];

    // 花苞态：收紧
    const bd = Math.cbrt(Math.random()) * 0.2;
    const budDir = randomUnit();
    const budPos = [budDir[0] * bd, budDir[1] * bd + 0.16, budDir[2] * bd];

    const color = CORE_DIM.clone().lerp(CORE_HOT, Math.pow(Math.random(), 1.6));
    write(bloomPos, budPos, color, rand(2.2, 5.0));
  }

  // ---------- 花粉（绽放时迸发） ----------
  for (let i = 0; i < cfg.pollenParticles; i++) {
    const dir = randomUnit(); // y 方向偏斜，整体往外上方飘
    const dist = rand(0.9, 2.7);
    const bloomPos = [
      dir[0] * dist * 1.25,
      dir[1] * dist + 0.35,
      dir[2] * dist * 0.8 - 0.2,
    ];

    const bd = Math.cbrt(Math.random()) * 0.17;
    const budPos = [rand(-bd, bd), rand(-bd, bd) + 0.16, rand(-bd, bd)];

    write(bloomPos, budPos, POLLEN.clone().offsetHSL(0, 0, rand(-0.08, 0.08)), rand(1.8, 3.6));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aBud', new THREE.BufferAttribute(buds, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uBloom: { value: 0 },
    uBurst: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(devicePixelRatio || 1, 2) },
    uTips: { value: Array.from({ length: cfg.maxTips }, () => new THREE.Vector3()) },
    uTipCount: { value: 0 },
    uTipRadius: { value: 0.62 },
    uTipPush: { value: 0.2 },
    uSwirl: { value: 0.3 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { MAX_TIPS: cfg.maxTips },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // 位置在着色器里算，包围球不准

  return { points, uniforms, config: cfg, count: total };
}

/** 球面均匀随机方向 */
function randomUnit() {
  const y = Math.random() * 2 - 1;
  const theta = Math.random() * TAU;
  const s = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(theta) * s, y, Math.sin(theta) * s];
}

const VERTEX_SHADER = /* glsl */ `
uniform float uBloom;
uniform float uBurst;
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uTips[MAX_TIPS];
uniform int uTipCount;
uniform float uTipRadius;
uniform float uTipPush;
uniform float uSwirl;

attribute vec3 aBud;
attribute vec3 aColor;
attribute float aSeed;
attribute float aSize;

varying vec3 vColor;
varying float vLocal;
varying float vGlow;

void main() {
  float t = clamp(uBloom, 0.0, 1.0);

  // 每颗粒子错峰绽放：种子决定起始点，形成从花心向外扩散的层次
  float delay = aSeed * 0.30;
  float local = smoothstep(delay, delay + 0.62, t);

  vec3 pos = mix(aBud, position, local);

  // 绽放中途向外鼓一点，避免直线插值的机械感
  vec3 outward = normalize(position - aBud + vec3(0.0001));
  pos += outward * sin(local * 3.14159) * 0.24 * (0.35 + aSeed * 0.65);

  // 张开瞬间的迸发冲击
  pos += outward * uBurst * 0.42 * (0.25 + aSeed);

  // 常态呼吸
  float ph = uTime * 0.85 + aSeed * 6.2831;
  pos += vec3(sin(ph), cos(ph * 1.13), sin(ph * 0.77)) * 0.024 * (0.2 + local);

  // 指尖局部斥力
  vec3 push = vec3(0.0);
  for (int i = 0; i < MAX_TIPS; i++) {
    if (i >= uTipCount) break;
    vec3 d = pos - uTips[i];
    float dist = length(d) + 1e-4;
    float falloff = exp(-(dist * dist) / (uTipRadius * uTipRadius));
    push += (d / dist) * falloff;

    // 切向搅动，指尖划过去时粒子有被拨动的手感
    vec3 tangent = normalize(cross(d, vec3(0.0, 0.0, 1.0)) + vec3(1e-5));
    push += tangent * falloff * uSwirl;
  }
  // 多个指尖挨在一起时斥力会叠加，不设上限会把整片花瓣推飞
  float pushLen = length(push);
  if (pushLen > 1.7) push *= 1.7 / pushLen;
  float nearTip = length(push);
  pos += push * uTipPush * (0.4 + 0.6 * local);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPixelRatio * (6.5 / max(-mv.z, 0.1)) * (0.8 + 0.5 * local);

  // 绽放后整体提亮，被指尖推开的粒子额外发光
  vColor = aColor;
  vLocal = local;
  vGlow = min(nearTip, 1.6) + uBurst * 1.2;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vLocal;
varying float vGlow;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float soft = smoothstep(0.5, 0.06, d);
  float core = pow(1.0 - d * 2.0, 3.0);

  // 加色混合下几万颗粒子会叠加饱和：单颗亮度压很低，
  // 且花苞态（粒子挤在一起，重叠几十倍）要比绽放态暗得多
  float exposure = 0.1 * mix(0.34, 1.0, vLocal);
  vec3 col = vColor * (0.85 + 0.8 * core) + vec3(1.0) * core * 0.14 * vGlow;
  gl_FragColor = vec4(col * soft * exposure, soft);
}
`;
