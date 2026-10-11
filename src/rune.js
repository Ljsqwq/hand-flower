/**
 * 程序化生成法阵符文纹理（canvas 2D，不依赖 three，方便单独调试）。
 * 视频里那种精细符文靠粒子摆不出来，只能画成纹理再让粒子/辉光去点缀。
 */

const TAU = Math.PI * 2;
const GOLD = '#ffd489';
const GOLD_DIM = '#b98a3e';

/** 固定种子随机，保证每次刷新生成的符文一致 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strokeRing(ctx, c, r, w, color = GOLD, dash = null) {
  ctx.save();
  ctx.beginPath();
  if (dash) ctx.setLineDash(dash);
  ctx.arc(c, c, r, 0, TAU);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

function strokeLine(ctx, x0, y0, x1, y1, w, color = GOLD) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function fillDot(ctx, x, y, r, color = GOLD) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function polygonPath(ctx, c, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 最外圈：双粗环 + 环间密集刻线 */
function drawOuter(ctx, S) {
  const c = S / 2;
  const R = S * 0.465;
  strokeRing(ctx, c, R, S * 0.0055);
  strokeRing(ctx, c, R * 0.975, S * 0.0022);
  strokeRing(ctx, c, R * 0.915, S * 0.0038);
  strokeRing(ctx, c, R * 0.895, S * 0.0018, GOLD_DIM);

  const inner = R * 0.915;
  const outer = R * 0.975;
  const n = 288;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const long = i % 4 === 0;
    const r0 = inner + S * 0.004;
    const r1 = long ? outer - S * 0.004 : inner + (outer - inner) * 0.5;
    strokeLine(
      ctx,
      c + Math.cos(a) * r0,
      c + Math.sin(a) * r0,
      c + Math.cos(a) * r1,
      c + Math.sin(a) * r1,
      S * 0.0016,
    );
  }
}

/** 刻度环：细密短刻度 + 每 30° 的长刻度 */
function drawTicks(ctx, S) {
  const c = S / 2;
  const R = S * 0.4;
  strokeRing(ctx, c, R, S * 0.0028);
  strokeRing(ctx, c, R * 0.84, S * 0.0028);
  strokeRing(ctx, c, R * 0.82, S * 0.0032, GOLD, [S * 0.02, S * 0.014]);

  for (let deg = 0; deg < 360; deg += 3) {
    const a = (deg / 180) * Math.PI - Math.PI / 2;
    const major = deg % 30 === 0;
    const mid = deg % 15 === 0;
    const len = major ? S * 0.058 : mid ? S * 0.034 : S * 0.018;
    const w = major ? S * 0.0042 : S * 0.0022;
    strokeLine(
      ctx,
      c + Math.cos(a) * R,
      c + Math.sin(a) * R,
      c + Math.cos(a) * (R - len),
      c + Math.sin(a) * (R - len),
      w,
    );
  }
}

/** 符文环：一圈随机短线段组成的符号 */
function drawRunes(ctx, S, rng) {
  const c = S / 2;
  const R = S * 0.325;
  const COUNT = 36;
  const cell = S * 0.036;

  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * TAU - Math.PI / 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * R, c + Math.sin(a) * R);
    ctx.rotate(a + Math.PI / 2);

    const strokes = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < strokes; k++) {
      strokeLine(
        ctx,
        (rng() - 0.5) * cell,
        (rng() - 0.5) * cell,
        (rng() - 0.5) * cell,
        (rng() - 0.5) * cell,
        cell * 0.1,
      );
    }
    if (rng() > 0.65) {
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.09, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
  ctx.restore();

  strokeRing(ctx, c, R * 1.14, S * 0.0018, GOLD_DIM);
  strokeRing(ctx, c, R * 0.86, S * 0.0018, GOLD_DIM);
}

/** 几何层：七边形 + 七角星 + 顶点光点 */
function drawGeometry(ctx, S) {
  const c = S / 2;
  const R = S * 0.27;
  const rot = -Math.PI / 2;

  polygonPath(ctx, c, R, 7, rot);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = S * 0.003;
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = rot + (i / 7) * TAU;
    const b = rot + (((i * 3) % 7) / 7) * TAU;
    ctx.moveTo(c + Math.cos(a) * R * 0.96, c + Math.sin(a) * R * 0.96);
    ctx.lineTo(c + Math.cos(b) * R * 0.96, c + Math.sin(b) * R * 0.96);
  }
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = S * 0.002;
  ctx.stroke();

  for (let i = 0; i < 7; i++) {
    const a = rot + (i / 7) * TAU;
    fillDot(ctx, c + Math.cos(a) * R, c + Math.sin(a) * R, S * 0.011);
  }
  strokeRing(ctx, c, R * 0.52, S * 0.002, GOLD_DIM);
}

/** 中心：主环 + 内环 + 十字。握拳时露出来的就是这一圈 */
function drawCore(ctx, S) {
  const c = S / 2;
  strokeRing(ctx, c, S * 0.17, S * 0.0075);
  strokeRing(ctx, c, S * 0.155, S * 0.0022);
  strokeRing(ctx, c, S * 0.115, S * 0.004, GOLD_DIM);

  const arm = S * 0.075;
  const gap = S * 0.045;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    strokeLine(
      ctx,
      c + Math.cos(a) * gap,
      c + Math.sin(a) * gap,
      c + Math.cos(a) * (gap + arm),
      c + Math.sin(a) * (gap + arm),
      S * 0.0035,
    );
  }
  fillDot(ctx, c, c, S * 0.018);
  strokeRing(ctx, c, S * 0.032, S * 0.0025, GOLD, [S * 0.01, S * 0.008]);
}

const PAINTERS = {
  outer: (ctx, S) => drawOuter(ctx, S),
  ticks: (ctx, S) => drawTicks(ctx, S),
  runes: (ctx, S, rng) => drawRunes(ctx, S, rng),
  geometry: (ctx, S) => drawGeometry(ctx, S),
  core: (ctx, S) => drawCore(ctx, S),
};

export const RUNE_KINDS = Object.keys(PAINTERS);

/** 生成一张法阵纹理，返回 canvas */
export function makeRuneCanvas(kind, size = 1024, seed = 7) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 200, 110, 0.75)';
  ctx.shadowBlur = size * 0.006;

  const painter = PAINTERS[kind];
  if (!painter) throw new Error(`未知的法阵图层: ${kind}`);
  painter(ctx, size, mulberry32(seed));

  return canvas;
}
