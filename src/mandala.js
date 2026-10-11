import * as THREE from 'three';
import { makeRuneCanvas } from './rune.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * 每层法阵的配置。
 * phase  —— 该层在 bloom 曲线上从哪个点开始展开（错峰，形成「一圈圈打开」的层次）
 * collapse —— 握拳时该层缩到多小；0 表示缩没了
 * collapseOpacity —— 握拳时该层的透明度，只有中心环留一点点
 */
const LAYER_CONFIG = [
  { kind: 'outer', size: 4.3, spin: 0.05, phase: 0.0, opacity: 0.8, collapse: 0.28 },
  { kind: 'ticks', size: 3.6, spin: -0.085, phase: 0.12, opacity: 0.86, collapse: 0.28 },
  { kind: 'runes', size: 2.95, spin: 0.13, phase: 0.26, opacity: 0.92, collapse: 0.24 },
  { kind: 'geometry', size: 2.2, spin: -0.2, phase: 0.4, opacity: 1.0, collapse: 0.2 },
  // 握拳时只剩这一圈：尺寸几乎不缩，压暗成淡金
  { kind: 'core', size: 1.9, spin: 0.28, phase: 0.52, opacity: 1.0, collapse: 0.85, collapseOpacity: 0.62 },
];

export class Mandala {
  constructor({ seed = 7, textureSize = 1024 } = {}) {
    this.group = new THREE.Group();
    this.group.rotation.x = -0.16; // 轻微透视，免得像一张贴纸
    this.layers = [];
    this.bloom = 0;
    this.presence = 0;
    this.spinBoost = 1;

    LAYER_CONFIG.forEach((cfg, index) => {
      const texture = new THREE.CanvasTexture(makeRuneCanvas(cfg.kind, textureSize, seed + index * 13));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        opacity: 0,
      });

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.position.z = -index * 0.015;
      mesh.scale.setScalar(0.001);
      mesh.rotation.z = index * 0.7;
      this.group.add(mesh);

      this.layers.push({ cfg, mesh, material, spinPhase: index * 0.7 });
    });

    this.group.scale.setScalar(0.001);
  }

  /** bloom: 0 = 握拳（淡金小圆环），1 = 张开（完整法阵） */
  setBloom(value) {
    this.bloom = clamp01(value);
  }

  /** presence: 手在画面里才把法阵显出来，手一离开整座阵淡掉 */
  setPresence(value) {
    this.presence = clamp01(value);
  }

  /** 聚能时把各层转速拔上去，像法阵在憋劲 */
  setSpinBoost(value) {
    this.spinBoost = Math.max(0.1, value);
  }

  update(dt, time) {
    const p = this.presence;
    this.group.visible = p > 0.01;
    if (!this.group.visible) return;

    const bloom = this.bloom;
    // 整体尺寸也跟着长，握拳时收成一个小环
    const groupScale = lerp(0.9, 1, smoothstep(clamp01(bloom * 1.25))) * (0.68 + 0.32 * p);
    this.group.scale.setScalar(groupScale);

    for (const { cfg, mesh, material, spinPhase } of this.layers) {
      const t = smoothstep(clamp01((bloom - cfg.phase) / 0.55));
      const scale = lerp(cfg.size * cfg.collapse, cfg.size, t);
      const opacity = lerp(cfg.collapseOpacity ?? 0, cfg.opacity, t);

      mesh.scale.set(scale, scale, 1);
      material.opacity = opacity * p;

      // 展开后转得更快；握拳时也有极慢的自转，不至于死板。
      // 用增量而不是 spinPhase + speed * time：转速是变的，
      // 乘时间会在转速变化的一瞬间把层跳一个角度。
      const speed = cfg.spin * (0.18 + 0.82 * t) * this.spinBoost;
      mesh.rotation.z += speed * dt;

      // 轻微呼吸
      const breathe = 1 + Math.sin(time * 0.9 + spinPhase * 2) * 0.012 * (0.3 + t);
      mesh.scale.multiplyScalar(breathe);
    }
  }

  dispose() {
    for (const { mesh, material } of this.layers) {
      mesh.geometry.dispose();
      material.map?.dispose();
      material.dispose();
    }
  }
}
