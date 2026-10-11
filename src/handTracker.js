// 运行时和模型都 vendor 在项目里，断网也能跑
const VISION_BUNDLE = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../vendor/models/hand_landmarker.task', import.meta.url).href;

// 21 点骨架连接关系
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const FINGERTIPS = [4, 8, 12, 16, 20];

export class HandTracker {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video
   * @param {HTMLCanvasElement} opts.overlay
   * @param {(state: object) => void} opts.onResult 每帧识别结果回调
   * @param {(stage: string, detail?: string) => void} opts.onStatus 启动阶段回调
   */
  constructor({ video, overlay, onResult, onStatus = () => {} }) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.onResult = onResult;
    this.onStatus = onStatus;

    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.currentDeviceId = null;
    this.lastVideoTime = -1;
    this.frames = 0;
    this.fpsWindowStart = 0;
    this.fps = 0;
  }

  async start({ deviceId } = {}) {
    this.onStatus('camera');
    await this.#startCamera(deviceId);
    this.onStatus('model');
    await this.#startLandmarker();
    this.onStatus('ready');
    this.running = true;
    this.fpsWindowStart = performance.now();
    this.#loop();
  }

  stop() {
    this.running = false;
    this.#stopStream();
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  /** 枚举摄像头。未授权时 label 是空的，所以要在取流之后调用 */
  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d) => ({
        id: d.deviceId,
        label: d.label || `未命名摄像头 (${d.deviceId.slice(0, 6)})`,
      }));
  }

  /** 切换摄像头，不用重建识别器 */
  async switchCamera(deviceId) {
    await this.#startCamera(deviceId);
  }

  #stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async #startCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持摄像头，请用 localhost 或 https 打开');
    }
    this.#stopStream();

    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // 不写 facingMode：桌面端没有朝向，反而会让浏览器选到虚拟摄像头
        video: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
        audio: false,
      });
    } catch (err) {
      // 记住的设备拔掉了 / 换了机器，退回默认设备
      if (deviceId && err.name === 'OverconstrainedError') {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
      } else {
        throw err;
      }
    }

    this.video.srcObject = this.stream;
    await this.video.play();

    this.currentDeviceId = this.stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
    this.lastVideoTime = -1;

    const { videoWidth: w, videoHeight: h } = this.video;
    this.overlay.width = w;
    this.overlay.height = h;
  }

  async #startLandmarker() {
    const mod = await import(/* @vite-ignore */ VISION_BUNDLE);
    const fileset = await mod.FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await mod.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  }

  #loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.#loop);
    if (this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    const res = this.landmarker.detectForVideo(this.video, now);
    this.#draw(res?.landmarks ?? []);

    this.frames++;
    if (now - this.fpsWindowStart >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsWindowStart));
      this.frames = 0;
      this.fpsWindowStart = now;
    }

    this.onResult({
      landmarks: res?.landmarks ?? [],
      handedness: res?.handedness ?? [],
      handednesses: res?.handednesses ?? [],
      fps: this.fps,
      video: this.video,
    });
  };

  #draw(hands) {
    const { ctx } = this;
    const { width: W, height: H } = this.overlay;
    ctx.clearRect(0, 0, W, H);

    for (const hand of hands) {
      ctx.strokeStyle = 'rgba(90, 220, 160, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(hand[a].x * W, hand[a].y * H);
        ctx.lineTo(hand[b].x * W, hand[b].y * H);
      }
      ctx.stroke();

      for (let i = 0; i < hand.length; i++) {
        const tip = FINGERTIPS.includes(i);
        ctx.fillStyle = tip ? '#ffd76b' : '#5adca0';
        ctx.beginPath();
        ctx.arc(hand[i].x * W, hand[i].y * H, tip ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
