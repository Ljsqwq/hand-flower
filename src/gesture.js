/**
 * 手势映射层：21 个关键点 → 花开参数 + 屏幕坐标。
 * 纯逻辑，不碰 DOM，方便单独跑测试。
 *
 * 张开度算法：五根指尖到手腕的平均距离 ÷ 手掌尺度（手腕→中指根）。
 * 握拳时指尖收进掌心，比值掉到 1.05 附近；张开时接近 2.05。
 */

const FINGERTIPS = [4, 8, 12, 16, 20];
const OPEN_LO = 1.05;
const OPEN_HI = 2.05;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** One Euro 滤波器：低速时重平滑、高速时低延迟，比固定 EMA 跟手 */
export class OneEuroFilter {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
  }

  static #alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x, dt) {
    if (this.xPrev === null) {
      this.xPrev = x;
      return x;
    }
    const aD = OneEuroFilter.#alpha(this.dCutoff, dt);
    const dx = (x - this.xPrev) / dt;
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuroFilter.#alpha(cutoff, dt);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

export class GestureMapper {
  constructor() {
    this.bloom = 0;
    this.rawBloom = 0;
    this.hands = [];
    this.handCount = 0;
    this.primary = { x: 0.5, y: 0.5 };

    this.cover = { visW: 1, visH: 1 };
    this.lastNow = null;

    // 二阶弹簧代替一阶滤波：握拳收拢、张开会有一点回弹，像花瓣自己弹开
    this.springK = 180;
    this.springC = 17;
    this.springV = 0;
    this.bloomVelocity = 0;
    this.handFilters = [];
  }

  /**
   * 视频用 object-fit: cover 铺满窗口时会被裁掉一部分，
   * 这里算出真正可见的归一化区域，否则手的位置会整体偏移。
   */
  setViewport(videoAspect, viewAspect) {
    if (!videoAspect || !viewAspect || !Number.isFinite(videoAspect)) return;
    this.cover =
      videoAspect > viewAspect
        ? { visW: viewAspect / videoAspect, visH: 1 }
        : { visW: 1, visH: videoAspect / viewAspect };
  }

  reset() {
    this.springV = 0;
    this.bloomVelocity = 0;
    this.handFilters.forEach((f) => f.all.forEach((x) => x.reset()));
    this.handFilters = [];
  }

  /**
   * @param {{landmarks: Array, handednesses: Array}} input
   * @param {number} now 毫秒时间戳
   */
  update({ landmarks = [], handednesses = [], handedness = [] } = {}, now = 0) {
    const dt =
      this.lastNow === null
        ? 1 / 60
        : Math.min(0.1, Math.max(1 / 240, (now - this.lastNow) / 1000));
    this.lastNow = now;

    const hands = [];
    let sum = 0;

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm || lm.length < 21) continue;

      const f = this.#filtersFor(i);
      const palmRaw = this.#toScreen(midpoint(lm[0], lm[9]));
      const palm = {
        x: f.palmX.filter(palmRaw.x, dt),
        y: f.palmY.filter(palmRaw.y, dt),
      };
      const tips = FINGERTIPS.map((tipIndex, j) => {
        const raw = this.#toScreen(lm[tipIndex]);
        return {
          x: f.tips[j].x.filter(raw.x, dt),
          y: f.tips[j].y.filter(raw.y, dt),
        };
      });

      const openness = opennessOf(lm);
      sum += openness;

      const label = (handednesses[i] ?? handedness[i])?.[0]?.categoryName ?? '';
      hands.push({ handedness: label, palm, tips, openness, spread: palmSpread(lm) });
    }

    this.handCount = hands.length;
    this.hands = hands;
    if (hands.length > 0) this.primary = hands[0].palm;

    this.rawBloom = hands.length ? sum / hands.length : 0;
    const shaped = smoothstep(clamp01(this.rawBloom));

    // 半隐式欧拉的弹簧积分，允许一点点过冲（回弹）
    const step = Math.min(dt, 0.033);
    const prevBloom = this.bloom;
    this.springV += (shaped - this.bloom) * this.springK * step;
    this.springV *= Math.exp(-this.springC * step);
    this.bloom += this.springV * step;
    this.bloom = Math.max(-0.06, Math.min(1.06, this.bloom));
    this.bloomVelocity = (this.bloom - prevBloom) / step;

    // 手离开画面时把滤波器清掉，避免下次进场从旧位置猛拽过来
    for (let i = hands.length; i < this.handFilters.length; i++) {
      this.handFilters[i].all.forEach((x) => x.reset());
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      bloom: this.bloom,
      rawBloom: this.rawBloom,
      handCount: this.handCount,
      hands: this.hands,
      primary: this.primary,
      bloomVelocity: this.bloomVelocity,
    };
  }

  #filtersFor(index) {
    if (this.handFilters[index]) return this.handFilters[index];
    const coord = () => new OneEuroFilter({ minCutoff: 2.4, beta: 0.06 });
    const f = {
      palmX: coord(),
      palmY: coord(),
      tips: FINGERTIPS.map(() => ({ x: coord(), y: coord() })),
      all: [],
    };
    f.all = [f.palmX, f.palmY, ...f.tips.flatMap((t) => [t.x, t.y])];
    this.handFilters[index] = f;
    return f;
  }

  #toScreen(p) {
    const { visW, visH } = this.cover;
    const x = (p.x - (1 - visW) / 2) / visW;
    const y = (p.y - (1 - visH) / 2) / visH;
    return { x: 1 - x, y }; // 翻转成自拍视角
  }
}

/** 0 = 握拳，1 = 完全张开 */
export function opennessOf(lm) {
  const wrist = lm[0];
  const scale = dist2(wrist, lm[9]) || 1e-6;
  let sum = 0;
  for (const tip of FINGERTIPS) sum += dist2(wrist, lm[tip]);
  const ratio = sum / FINGERTIPS.length / scale;
  return clamp01((ratio - OPEN_LO) / (OPEN_HI - OPEN_LO));
}

/** 五指张开程度（拇指到小指的距离 ÷ 手掌尺度），后续做花瓣层次用 */
export function palmSpread(lm) {
  const scale = dist2(lm[0], lm[9]) || 1e-6;
  return clamp01(dist2(lm[4], lm[20]) / scale / 2.4);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
