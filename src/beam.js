import * as THREE from 'three';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 一道竖直光带：横截面中间最亮、向两侧渐隐，竖直方向有向上滚动的条纹。
 * 用平面而不是圆柱 —— 圆柱做出来是一圈空心管壁，会看见两条平行亮边，
 * 反而不像光柱。
 */
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uGrow;
uniform float uEdge;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // h: 0 = 柱底（法阵中心），1 = 柱顶
  float h = 1.0 - vUv.y;

  // 越往上越收窄，像从中心射出去的光束，而不是一根等宽的柱子
  float taper = mix(1.0, 0.84, h);
  float x = abs(vUv.x - 0.5) * 2.0 / taper;
  float core = pow(clamp(1.0 - x, 0.0, 1.0), uEdge);

  // 光源在法阵中心：中心最亮，往远端逐渐减弱，远端再淡出
  float fade = mix(1.0, 0.45, smoothstep(0.0, 0.9, h));
  fade *= 1.0 - smoothstep(0.82, 1.0, h);

  // 两层不同速度的流动条纹。
  // 相位取正号：uv.y 增大 = 靠近法阵中心，所以条纹是「从中心往远端跑」，
  // 也就是从法阵射出去的方向，不是被吸回来。
  float band = 0.82 + 0.18 * sin(vUv.y * 10.0 + uTime * 3.2);
  band *= 0.9 + 0.1 * sin(vUv.y * 3.4 + uTime * 1.2 + 2.1);

  // 生长动画：只显示到 uGrow 的高度，顶端快速淡出
  float head = 1.0 - smoothstep(uGrow - 0.06, uGrow, h);

  float a = core * fade * band * head * uIntensity;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * 三层平面叠出光柱：外层柔光、中层主体、内层亮芯。
 * 由外部的发射时序驱动：聚能完成才 setPower(1)，其余时间是 0。
 */
export class Beam {
  constructor({
    height = 11,
    color = '#ffd489',
    coreColor = '#fff2cf',
    direction = 'down',
  } = {}) {
    this.group = new THREE.Group();
    this.power = 0;
    this.presence = 0;
    this.grow = 0;
    this.layers = [];

    // 柱底压在法阵中心，往 direction 方向长；down 时把几何沿 y 翻过来，
    // uv 与顶点的对应关系不变，所以着色器里的生长逻辑不用动
    const dir = direction === 'down' ? -1 : 1;
    this.tilt = direction === 'down' ? 0.14 : -0.14;

    const specs = [
      { width: 3.2, edge: 1.2, intensity: 0.2, flow: 1.0, color, z: 0.02 },
      { width: 1.25, edge: 1.6, intensity: 0.42, flow: 1.3, color, z: 0.01 },
      { width: 0.5, edge: 2.4, intensity: 0.95, flow: 1.7, color: coreColor, z: 0 },
    ];

    for (const spec of specs) {
      const geometry = new THREE.PlaneGeometry(spec.width, height);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uGrow: { value: 0 },
          uEdge: { value: spec.edge },
          uColor: { value: new THREE.Color(spec.color).convertSRGBToLinear() },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = (dir * height) / 2;
      mesh.scale.set(1, dir, 1);
      mesh.position.z = spec.z;
      this.group.add(mesh);
      this.layers.push({ mesh, material, base: spec.intensity, flow: spec.flow });
    }

    this.group.visible = false;
  }

  setPower(value) {
    this.power = clamp01(value);
  }

  setPresence(value) {
    this.presence = clamp01(value);
  }

  update(dt, time) {
    // 发射时冲得快，收的时候慢一点
    const rate = this.power > this.grow ? 13 : 7;
    this.grow += (this.power - this.grow) * Math.min(1, dt * rate);

    const t = this.grow * this.presence;
    this.group.visible = t > 0.01;
    if (!this.group.visible) return;

    const pulse = 0.92 + 0.08 * Math.sin(time * 2.3);

    for (const { material, base, flow } of this.layers) {
      material.uniforms.uTime.value = time * flow;
      material.uniforms.uGrow.value = t;
      material.uniforms.uIntensity.value = t * pulse * base;
    }
  }

  dispose() {
    for (const { mesh, material } of this.layers) {
      mesh.geometry.dispose();
      material.dispose();
    }
  }
}
