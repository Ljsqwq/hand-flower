import * as THREE from 'three';

const TAU = Math.PI * 2;
const SHOCK_DUR = 0.85;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 固定种子随机，保证每次刷新聚能粒子一致 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARTICLE_VERT = /* glsl */ `
uniform float uPhase;
uniform float uRMin;
uniform float uSpan;
uniform float uPixelRatio;
uniform float uOpacity;
attribute float aAngle;
attribute float aRadius;
attribute float aSpeed;
attribute float aZ;
attribute float aSize;
varying float vAlpha;

void main() {
  // 半径一路缩小、到中心后从外圈重新进来，形成不断被吸进去的循环
  float r = uRMin + mod(aRadius - uRMin - uPhase * aSpeed, uSpan);
  vec3 p = vec3(cos(aAngle) * r, sin(aAngle) * r, aZ);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  float near = 1.0 - clamp((r - uRMin) / uSpan, 0.0, 1.0);
  vAlpha = uOpacity * (0.25 + 0.75 * near);

  gl_PointSize = aSize * uPixelRatio * (34.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  float d = clamp(length(gl_PointCoord - 0.5) * 2.0, 0.0, 1.0);
  float a = pow(1.0 - d, 1.8) * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 中心蓄力光斑：越聚越亮，脉动频率跟着变快，看着像在憋
const GLOW_FRAG = /* glsl */ `
uniform float uCharge;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float d = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
  float core = pow(1.0 - d, 2.4);
  float flicker = 0.82 + 0.18 * sin(uTime * (7.0 + 18.0 * uCharge));
  float a = core * uCharge * flicker;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SHOCK_FRAG = /* glsl */ `
uniform float uT;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float d = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
  float r = uT * 0.92;
  float band = smoothstep(0.18, 0.0, abs(d - r));
  float fade = (1.0 - uT) * (1.0 - uT);
  float a = band * fade * uOpacity;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * 聚能：法阵成型后，一圈粒子向中心汇聚、中心光斑越憋越亮。
 * 聚满时 fire() 放出一个向外扩散的冲击波。
 */
export class Charge {
  constructor({ count = 320, rMin = 0.18, rMax = 2.2, seed = 33, color = '#ffe6b8' } = {}) {
    this.group = new THREE.Group();
    this.phase = 0;
    this.shockT = Infinity;

    const rng = mulberry32(seed);
    const aAngle = new Float32Array(count);
    const aRadius = new Float32Array(count);
    const aSpeed = new Float32Array(count);
    const aZ = new Float32Array(count);
    const aSize = new Float32Array(count);
    const position = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      aRadius[i] = rMin + rng() * (rMax - rMin);
      aAngle[i] = rng() * TAU;
      aSpeed[i] = 0.5 + rng() * 1.0;
      aZ[i] = (rng() - 0.5) * 0.06;
      aSize[i] = 1.0 + rng() * 1.6;
    }

    const geometry = new THREE.BufferGeometry();
    // position 只是占位，真实坐标在顶点着色器里按角度/半径算
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    geometry.setAttribute('aZ', new THREE.BufferAttribute(aZ, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

    this.particleUniforms = {
      uPhase: { value: 0 },
      uRMin: { value: rMin },
      uSpan: { value: rMax - rMin },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
    };

    this.particles = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.particleUniforms,
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    this.glowUniforms = {
      uCharge: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#fff3d6').convertSRGBToLinear() },
    };
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.glowUniforms,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.glow.position.z = 0.05;
    this.group.add(this.glow);

    this.shockUniforms = {
      uT: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color('#ffe0a8').convertSRGBToLinear() },
    };
    this.shock = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.ShaderMaterial({
        uniforms: this.shockUniforms,
        vertexShader: GLOW_VERT,
        fragmentShader: SHOCK_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.shock.position.z = 0.04;
    this.shock.visible = false;
    this.group.add(this.shock);
  }

  setPixelRatio(ratio) {
    this.particleUniforms.uPixelRatio.value = Math.min(ratio || 1, 2);
  }

  /** 聚满、要发射了 */
  fire() {
    this.shockT = 0;
  }

  update(dt, time, charge, presence) {
    const c = clamp01(charge) * clamp01(presence);

    // 聚能越强，往中心吸得越快
    this.phase += dt * (0.55 + 1.85 * clamp01(charge));
    this.particleUniforms.uPhase.value = this.phase;
    this.particleUniforms.uOpacity.value = c * 0.85;

    const size = 0.7 + 1.45 * clamp01(charge);
    this.glow.scale.setScalar(size * (0.98 + 0.04 * Math.sin(time * 9)));
    this.glowUniforms.uCharge.value = c;
    this.glowUniforms.uTime.value = time;

    if (this.shockT < SHOCK_DUR) {
      this.shockT += dt;
      const u = clamp01(this.shockT / SHOCK_DUR);
      this.shock.visible = true;
      this.shockUniforms.uT.value = u;
      this.shockUniforms.uOpacity.value = (1 - u) * (1 - u) * 0.9 * clamp01(presence);
    } else if (this.shock.visible) {
      this.shock.visible = false;
    }
  }

  dispose() {
    for (const obj of [this.particles, this.glow, this.shock]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  }
}
