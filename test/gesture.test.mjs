// 回归测试：node --test 之外的零依赖写法，直接 node test/gesture.test.mjs
import { GestureMapper, opennessOf } from '../src/gesture.js';

// 合成一只 21 点的手：open=1 全张，open=0 握拳
function synthHand(open) {
  const wrist = { x: 0.5, y: 0.72 };
  const midMcp = { x: 0.5, y: 0.54 };
  const palmScale = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y); // 0.18
  const tipDist = palmScale * (1.11 + open * 0.92); // ratio 1.11 → 2.03

  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[0] = { ...wrist };
  lm[9] = { ...midMcp };
  [4, 8, 12, 16, 20].forEach((idx, k) => {
    const ang = -Math.PI / 2 + (k - 2) * 0.26;
    lm[idx] = {
      x: wrist.x + Math.cos(ang) * tipDist,
      y: wrist.y + Math.sin(ang) * tipDist,
      z: 0,
    };
  });
  return lm;
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

// 1. 静态映射
const openVal = opennessOf(synthHand(1));
const fistVal = opennessOf(synthHand(0));
check('张开的 openness ≈ 1', openVal > 0.9, openVal.toFixed(3));
check('握拳的 openness ≈ 0', fistVal < 0.15, fistVal.toFixed(3));

// 2. 动态：滤波器下的 bloom 收敛 + 平滑度
const mapper = new GestureMapper();
mapper.setViewport(16 / 9, 4 / 3);

function feed(hand, frames, startT, tag) {
  let t = startT;
  let maxJump = 0;
  let prev = mapper.bloom;
  const trace = [];
  for (let i = 0; i < frames; i++) {
    const out = mapper.update(
      {
        landmarks: hand ? [hand] : [],
        handednesses: hand ? [[{ categoryName: 'Right', score: 0.99 }]] : [],
      },
      t,
    );
    maxJump = Math.max(maxJump, Math.abs(out.bloom - prev));
    prev = out.bloom;
    t += 16;
    if (i % 20 === 0 || i === frames - 1) trace.push(out.bloom.toFixed(3));
  }
  console.log(`  ${tag}: ${trace.join(' → ')}`);
  return { maxJump, end: prev, t, out: mapper.snapshot() };
}

console.log('\n-- 张开 90 帧 --');
const opened = feed(synthHand(1), 90, 0, 'bloom');
check('张开后 bloom > 0.9', opened.end > 0.9, opened.end.toFixed(3));
check('张开过程无跳变 (<0.25/帧)', opened.maxJump < 0.25, opened.maxJump.toFixed(3));

console.log('\n-- 握拳 90 帧 --');
const closed = feed(synthHand(0), 90, opened.t, 'bloom');
check('握拳后 bloom < 0.1', closed.end < 0.1, closed.end.toFixed(3));
check('握拳过程无跳变 (<0.25/帧)', closed.maxJump < 0.25, closed.maxJump.toFixed(3));

// 3. 中途半开
console.log('\n-- 半张 90 帧 --');
const half = feed(synthHand(0.5), 90, closed.t, 'bloom');
check('半张后 bloom 落在中段', half.end > 0.2 && half.end < 0.8, half.end.toFixed(3));

// 4. 手消失
console.log('\n-- 手离开 120 帧 --');
const gone = feed(null, 120, half.t, 'bloom');
check('手离开后 bloom 回落 < 0.15', gone.end < 0.15, gone.end.toFixed(3));
check('掉手后手数归零', gone.out.handCount === 0, String(gone.out.handCount));

// 5. 坐标映射：cover 裁剪 + 镜像
const m2 = new GestureMapper();
m2.setViewport(16 / 9, 4 / 3); // 视频更宽 → 左右各裁 12.5%
const centerHand = synthHand(1);
const out2 = m2.update({ landmarks: [centerHand] }, 0);
const palm = out2.hands[0].palm;
check('画面中心的手映射到屏幕中心 x≈0.5', Math.abs(palm.x - 0.5) < 0.02, palm.x.toFixed(3));
check('掌心 y 在合理范围 (0.3~0.8)', palm.y > 0.3 && palm.y < 0.8, palm.y.toFixed(3));

// 手在视频左侧 → 镜像后应在屏幕右侧
const leftHand = synthHand(1).map((p) => ({ ...p, x: p.x - 0.2 }));
const out3 = m2.update({ landmarks: [leftHand] }, 16);
check('视频左侧的手 → 屏幕右侧（镜像）', out3.hands[0].palm.x > 0.5, out3.hands[0].palm.x.toFixed(3));

// 6. 双手平均
const m3 = new GestureMapper();
const both = m3.update({ landmarks: [synthHand(1), synthHand(1)] }, 0);
check('双手计数正确', both.handCount === 2, String(both.handCount));
check('双手都张开 → bloom 趋近 1', both.rawBloom > 0.9, both.rawBloom.toFixed(3));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
