import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Mandala } from './mandala.js';
import { Starfield } from './starfield.js';
import { Beam } from './beam.js';
import { Charge } from './charge.js';

const DEG2RAD = Math.PI / 180;
// 法阵成型后蓄多久才发射
const CHARGE_TIME = 1.0;

/**
 * Three.js 舞台：一层符文法阵。
 * bloom = 0 握拳（淡金小圆环），bloom = 1 张开（完整法阵展开）。
 */
export class MandalaScene {
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
    this.handState = { bloom: 0, primary: { x: 0.5, y: 0.5 } };
    // 手出现的平滑权重：没手时整座法阵不显示，手伸进来才「召唤」出来
    this.presence = 0;
    // 召唤序列：成型 → 聚能 → 发射
    this.chargeT = 0;
    this.wasFiring = false;

    this.mandala = new Mandala();
    this.scene.add(this.mandala.group);

    this.starfield = new Starfield();
    this.scene.add(this.starfield.group);

    this.beam = new Beam();
    this.scene.add(this.beam.group);

    this.charge = new Charge();
    this.charge.group.rotation.x = -0.16; // 贴在法阵平面上
    this.scene.add(this.charge.group);

    this.#updateVisiblePlane();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  #buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 阈值卡在符文线条亮度附近：太低整块发雾，太高法阵不发光
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
    this.mandala.setBloom(state.bloom);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.starfield.setPixelRatio(this.renderer.getPixelRatio());
    this.charge.setPixelRatio(this.renderer.getPixelRatio());
    this.#updateVisiblePlane();
  }

  render() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const { bloom, primary, handCount = 0 } = this.handState;

    const wantPresence = handCount > 0 ? 1 : 0;
    this.presence += (wantPresence - this.presence) * Math.min(1, dt * 4.2);
    if (this.presence < 0.002) this.presence = 0;
    this.mandala.setPresence(this.presence);
    this.beam.setPresence(this.presence);

    // —— 召唤序列 ——
    // 法阵基本成型并且手还在，才开始聚能；聚满一发，光柱射出去
    const forming = bloom > 0.8 && this.presence > 0.5;
    if (forming) this.chargeT = Math.min(CHARGE_TIME, this.chargeT + dt);
    else this.chargeT = Math.max(0, this.chargeT - dt * 3);

    const charge = this.chargeT / CHARGE_TIME;
    const firing = this.chargeT >= CHARGE_TIME;
    if (firing && !this.wasFiring) this.charge.fire();
    this.wasFiring = firing;

    this.beam.setPower(firing ? 1 : 0);
    this.mandala.setSpinBoost(1 + 1.4 * charge);

    this.mandala.update(dt, t);
    this.beam.update(dt, t);
    this.starfield.update(dt, t);
    this.charge.update(dt, t, charge, this.presence);

    // 掌心带着法阵漂移，但幅度压小：法阵是悬在那儿的，不该乱跑
    const g = this.mandala.group;
    const tx = (primary.x - 0.5) * 2 * this.halfW * 0.22;
    const ty = (0.5 - primary.y) * 2 * this.halfH * 0.16;
    g.position.x += (tx - g.position.x) * 0.045;
    g.position.y += (ty + 0.12 - g.position.y) * 0.045;
    g.rotation.y = (primary.x - 0.5) * 0.16;
    g.rotation.z = (0.5 - primary.y) * 0.1 + Math.sin(t * 0.2) * 0.02;

    // 光柱只跟法阵的位置走，不吃法阵的旋转（它有自己的倾角）
    this.beam.group.position.x = g.position.x;
    this.beam.group.position.y = g.position.y;
    this.beam.group.position.z = g.position.z;
    // 柱体稍微倾一点，像是从法阵中心射出去，而不是贴在屏幕上的竖条
    this.beam.group.rotation.x = this.beam.tilt;
    this.beam.group.rotation.z = (0.5 - primary.y) * 0.05 + Math.sin(t * 0.2) * 0.01;

    this.charge.group.position.x = g.position.x;
    this.charge.group.position.y = g.position.y;
    this.charge.group.position.z = g.position.z;

    this.composer.render(dt);
  }
}
