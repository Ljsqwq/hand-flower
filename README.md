# 超位魔法 · 法阵

对着摄像头伸出手，金色符文法阵在掌心浮现；手掌张开把法阵撑开，阵转起来聚能，蓄满之后光柱射出。握拳则只留中心一圈淡金圆环。

摄像头画面不出本机，识别全程在浏览器本地跑。

## 运行

需要：Chrome / Edge（其它现代浏览器也可以）、摄像头。

```bash
./start.sh              # WSL / Linux / macOS
npm start              # 等价写法
node scripts/serve.mjs --port=8899   # 换端口
```

脚本会起一个静态服务器并自动打开浏览器。服务端零依赖，不需要 `npm install`。

**必须通过 `http://localhost:端口` 或 `https://` 访问。** 直接双击 `index.html` 用 `file://` 打开，浏览器不会给摄像头权限。

依赖已经 vendor 进仓库（`vendor/`），**不需要联网，也不需要 `npm install`**，断网照样跑：

- `vendor/three/` — three.js 0.160 的 module 与用到的 addons（后处理、着色器）
- `vendor/mediapipe/` — tasks-vision 0.10.14 的运行时与 wasm
- `vendor/models/hand_landmarker.task` — 手部关键点模型

## 交互

| 动作 | 效果 |
| --- | --- |
| 手进入画面 | 法阵从 68% 尺寸淡入放大，星空下被「召唤」出来 |
| 手掌张开 | 五层符文由内向外错峰展开，转动加快 |
| 张开并保持约 1 秒 | 中心聚能：光斑越来越亮、粒子向中心汇聚、转速拔高 |
| 聚能满 | 光柱从法阵中心射出，同时向外扩散一圈冲击波 |
| 握拳 | 光柱与聚能熄灭，只剩中心淡金圆环 |
| 手离开画面 | 法阵收拢并淡出，画面只剩星空 |
| 手掌移动 | 整座法阵轻微跟随漂移 |
| 左上角下拉框 | 切换摄像头，选择会记住 |
| `H` 键 | 放大 / 还原摄像头预览窗 |

双手都能识别，展开度取双手平均。

## 实现要点

- **召唤序列**（`src/scene.js`）：法阵成型（展开度 > 0.8 且手在画面里）→ 聚能 1 秒 → 发射。中途握拳或手离开，聚能进度立刻回退，光柱收掉。蓄力时长是文件顶部的 `CHARGE_TIME`。
- **法阵本体**（`src/mandala.js` + `src/rune.js`）：符文纹理全部用 canvas 2D 程序化生成（外圈刻线、刻度环、36 个随机符文、七边形七角星、中心环），贴到五层平面上反向旋转、加色发光，按展开度错峰显现。纹理用固定种子随机，每次刷新长得一样。
- **聚能与发射**（`src/charge.js`）：320 个粒子在顶点着色器里按角度/半径循环向中心汇聚；中心光斑随蓄力变亮、脉动频率从 7Hz 提到 25Hz；发射时放出一圈扩散的冲击波。
- **光柱**（`src/beam.js`）：三层面向相机的渐变光带（柔光 / 主体 / 亮芯），中间最亮向两侧渐隐，越往远端越窄、越淡，条纹从法阵中心向远端跑。用平面而不是圆柱——圆柱是一圈空心管壁，正面看会出现两条平行亮边，不像光柱。
- **星空**（`src/starfield.js`）：2200 颗星，冷白 / 暖白 / 淡蓝混色，各自闪烁相位，按距离衰减大小。
- **手部识别**（`src/handTracker.js`）：MediaPipe Tasks Vision 的 HandLandmarker，VIDEO 模式，最多两只手。
- **手势映射**（`src/gesture.js`）：五指指尖到手腕的平均距离 ÷ 手掌尺度 → 张开度 0~1；坐标经 One Euro 滤波，展开度走二阶弹簧（握拳张开会有一点回弹）。视频按 `object-fit: cover` 铺满窗口，映射时做了裁剪补偿和镜像。
- **后处理**（`src/scene.js`）：`EffectComposer` + `UnrealBloomPass` + `OutputPass`，ACES tone mapping。

## 调参

不用摄像头也能看效果，URL 上带参数即可（演示、调参、录屏都用得上）：

- `?bloom=0` ~ `?bloom=1` — 固定展开度
- `?tips=0.4,0.58;0.6,0.58` — 伪造两个指尖（屏幕归一化坐标，`;` 分隔多个）
- 可组合：`?bloom=1&tips=0.45,0.5`

| 想调什么 | 改哪里 |
| --- | --- |
| 聚能时长 | `src/scene.js` 的 `CHARGE_TIME` |
| 光柱颜色 / 长度 / 倾角 | `src/beam.js` 的 `color`、`height`、`tilt` |
| 光柱粗细 | 同文件 `specs` 里三层平面的 `width` |
| 聚能粒子的数量 / 范围 | `src/charge.js` 的 `count`、`rMin`、`rMax` |
| 法阵层数、大小、转速 | `src/mandala.js` 的 `LAYER_CONFIG` |
| 法阵配色、各类环的尺寸 | `src/rune.js` 顶部的 `GOLD` / `GOLD_DIM` 与各 `draw*` 函数 |
| 星星数量与亮度 | `src/starfield.js` 的 `count`、`aBright` |
| 辉光强度 | `src/scene.js` 里 `UnrealBloomPass` 的四个参数：强度 / 半径 / 阈值 |
| 握拳张开的灵敏度 | `src/gesture.js` 的 `OPEN_LO` / `OPEN_HI` |
| 跟手延迟 | `src/gesture.js` 里 `coord()` 的 `minCutoff` / `beta` |
| 回弹手感 | `src/gesture.js` 的 `springK` / `springC` |

## 已知限制

- 强逆光、手离镜头太远、或手被遮挡时，关键点会跳，法阵会抖。
- vendor 目录约 28MB，克隆仓库会大一些。
- 集显上全屏后处理和大量粒子可能掉帧。真掉帧就先降 `src/starfield.js` 的 `count`，或把 bloom 换成半分辨率。

## 调试

页面里开了个全局句柄，控制台可直接摸：

```js
__hf.scene.mandala.layers[2].material.opacity = 0.5  // 单独调某一层
__hf.scene.beam.setPower(1)                          // 手动点亮光柱
__hf.scene.chargeT = 1                               // 直接跳到发射
__hf.scene.bloomPass.strength = 0.8                  // 实时改辉光
__hf.mapper                                          // 看手势映射状态
```

改完 `src/gesture.js` 的映射参数，跑一下回归测试：

```bash
npm test    # 或 node test/gesture.test.mjs
```

测试用合成关键点覆盖：握拳/张开/半张的收敛值、单帧最大跳变、掉手回落、cover 裁剪 + 镜像的坐标映射、双手计数。14 项全过才算没把映射层改坏。
