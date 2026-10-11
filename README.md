# 指间花开 · Hand Flower

对着摄像头握拳，粒子收拢成花苞；手掌张开，花瓣展开、花心亮起、花粉迸发。手指划过时，附近的粒子会被拨开。

全程在浏览器本地跑，摄像头画面不出本机。

## 运行

需要：Chrome / Edge（其它现代浏览器也可以）、摄像头。

```bash
./start.sh              # WSL / Linux / macOS
npm start              # 等价写法
node scripts/serve.mjs --port=8899   # 换端口
```

脚本会起一个静态服务器并自动打开浏览器。服务端零依赖，不需要 `npm install`。

手动起服务也行，任何静态服务器都可以：

```bash
python3 -m http.server 8768
```

**必须通过 `http://localhost:端口` 或 `https://` 访问。** 直接双击 `index.html` 用 `file://` 打开，浏览器不会给摄像头权限。

## 交互

| 动作 | 效果 |
| --- | --- |
| 握拳 | 花苞（粒子卷拢成水滴形） |
| 手掌张开 | 绽放，花心亮起，花粉向外迸发 |
| 手指划过 | 附近粒子被推开并提亮，带一点切向搅动 |
| 手掌移动 | 整朵花轻微跟随漂移 |
| 左上角下拉框 | 切换摄像头，选择会记住 |
| `H` 键 | 放大 / 还原摄像头预览窗 |

双手都能识别，绽放度取双手平均。

**摄像头选错了？** Windows 的「连接手机」会把手机摄像头虚拟成一路普通摄像头，和内置摄像头并排出现。首次访问会自动优先选内置的（匹配 `Integrated Camera` / `内置` 这类名称），选错就手动在下拉框里切一次，之后会记住。

## 实现要点

- **粒子花**（`src/flower.js`）：59,500 颗粒子。`position` 存绽放态坐标，`aBud` 存花苞态坐标，顶点着色器按每个粒子的随机种子错峰插值，所以是从花心向外一层层开，而不是整体缩放。
- **手部识别**（`src/handTracker.js`）：MediaPipe Tasks Vision 的 HandLandmarker，VIDEO 模式，最多两只手。
- **手势映射**（`src/gesture.js`）：五指指尖到手腕的平均距离 ÷ 手掌尺度 → 张开度 0~1；坐标经 One Euro 滤波，绽放度走二阶弹簧（握拳张开会有一点回弹）。视频按 `object-fit: cover` 铺满窗口，映射时做了裁剪补偿和镜像。
- **视觉**（`src/scene.js`）：`EffectComposer` + `UnrealBloomPass` + `OutputPass`，ACES tone mapping。

## 调参

不用摄像头也能看效果，URL 上带参数即可（演示、调参、录屏都用得上）：

- `?bloom=0` ~ `?bloom=1` — 固定绽放度
- `?tips=0.4,0.58;0.6,0.58` — 伪造两个指尖（屏幕归一化坐标，`;` 分隔多个）
- 可组合：`?bloom=1&tips=0.45,0.5`

| 想调什么 | 改哪里 |
| --- | --- |
| 花瓣数量 / 长度 / 宽度 | `src/flower.js` 的 `FLOWER_CONFIG` |
| 各类粒子数量 | `FLOWER_CONFIG.petalParticles` / `coreParticles` / `pollenParticles` |
| 花瓣配色 | `src/flower.js` 顶部的 `PETAL_ROOT` / `PETAL_MID` / `PETAL_TIP` |
| 整体亮度、花苞亮度 | `src/flower.js` 片元着色器里的 `exposure`（`mix(0.34, 1.0, vLocal)`，前者是花苞态） |
| 指尖斥力范围 / 力度 | 同上文件的 `uTipRadius` / `uTipPush` / `uSwirl` |
| 辉光强度 | `src/scene.js` 里 `UnrealBloomPass` 的四个参数：强度 / 半径 / 阈值 |
| 握拳张开的灵敏度 | `src/gesture.js` 的 `OPEN_LO` / `OPEN_HI` |
| 跟手延迟 | `src/gesture.js` 里 `coord()` 的 `minCutoff` / `beta` |
| 回弹手感 | `src/gesture.js` 的 `springK` / `springC` |

## 已知限制

- 强逆光、手离镜头太远、或手被遮挡时，关键点会跳，花会抖。
- 集显上 59.5k 粒子 + 辉光可能掉帧。真掉帧就降 `petalParticles`，或把 bloom 换成半分辨率。
- 摄像头帧率和识别帧率绑在一起，识别跟不上时 bloom 的变化会有点顿。

## 调试

页面里开了个全局句柄，控制台可直接摸：

```js
__hf.scene.flower.uniforms.uTipPush.value = 0.5   // 实时改斥力
__hf.scene.bloomPass.strength = 0.8               // 实时改辉光
__hf.mapper                                       // 看手势映射状态
```

改完 `src/gesture.js` 的映射参数，跑一下回归测试：

```bash
npm test    # 或 node test/gesture.test.mjs
```

测试用合成关键点覆盖：握拳/张开/半张的收敛值、单帧最大跳变、掉手回落、cover 裁剪 + 镜像的坐标映射、双手计数。14 项全过才算没把映射层改坏。
