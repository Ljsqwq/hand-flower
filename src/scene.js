import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createFlower } from './flower.js';

const DEG2RAD = Math.PI / 180;
const MAX_TIPS = 10;

/**
 * Three.js 舞台：一朵由 GLSL 粒子构成的花。
 * bloom = 0 是花苞，bloom = 1 完全绽放；指尖对附近的粒子产生斥力。
 */
export class FlowerScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    this.scene = new THREE.Scene();
    // 用 scene.background 而不是 setClearColor：背景会走同一套颜色管理，
    // 否则底色绕过转换，经 OutputPass 编码后整块发灰
    this.scene.background = new THREE.Color(0x03050a);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 6.2);
    this.camera.lookAt(0, 0, 0);

    this.#buildComposer();

    this.clock = new THREE.Clock();
    this.handState = { bloom: 0, hands: [], primary: { x: 0.5, y: 0.5 } };
    this.burst = 0;

    this.flower = createFlower();
    this.flower.points.position.y = -0.1;
    this.scene.add(this.flower.points);

    this.#updateVisiblePlane();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  #buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 阈值要卡在「单颗粒子亮度之上、叠加后的亮部之下」
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.2, 0.45);
    this.composer.addPass(this.bloomPass);

    // OutputPass 负责 tone mapping 与 sRGB 转换，着色器里保持线性输出
    this.composer.addPass(new OutputPass());
  }

  /** 相机在 z 轴上正视，算出 z=0 平面上的可见半宽/半高，用于屏幕坐标 → 世界坐标 */
  #updateVisiblePlane() {
    const halfH =
      Math.tan(((this.camera.fov * DEG2RAD) / 2)) * this.camera.position.z;
    this.halfH = halfH;
    this.halfW = halfH * this.camera.aspect;
  }

  setHandState(state) {
    if (!state) return;
    this.handState = state;

    const { uniforms } = this.flower;
    uniforms.uBloom.value = state.bloom;

    // 绽放速度够快时触发一次迸发，随后指数衰减
    const vel = state.bloomVelocity ?? 0;
    if (vel > 0.55) this.burst = Math.min(1, this.burst + (vel - 0.55) * 0.9);

    const tips = [];
    for (const hand of state.hands ?? []) {
      for (const tip of hand.tips) tips.push(tip);
    }
    const n = Math.min(tips.length, MAX_TIPS);
    uniforms.uTipCount.value = n;
    for (let i = 0; i < n; i++) {
      uniforms.uTips.value[i].set(
        (tips[i].x - 0.5) * 2 * this.halfW,
        (0.5 - tips[i].y) * 2 * this.halfH,
        0,
      );
    }
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.#updateVisiblePlane();
    this.flower.uniforms.uPixelRatio.value = Math.min(devicePixelRatio, 2);
  }

  render() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const { bloom, primary } = this.handState;
    const { points, uniforms } = this.flower;

    uniforms.uTime.value = t;
    this.burst *= Math.exp(-4.5 * dt);
    uniforms.uBurst.value = this.burst;

    // 掌心带动整体轻微漂移，指尖靠近时花朵微微朝那边倾
    const tx = (primary.x - 0.5) * 2 * this.halfW * 0.22;
    const ty = (0.5 - primary.y) * 2 * this.halfH * 0.22;
    points.position.x += (tx - points.position.x) * 0.045;
    points.position.y += (ty - 0.1 - points.position.y) * 0.045;
    points.rotation.z = Math.sin(t * 0.22) * 0.05 + (primary.x - 0.5) * 0.22;
    points.rotation.y = (0.5 - primary.y) * 0.3;

    this.composer.render(dt);
  }
}
