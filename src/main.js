import { MandalaScene } from './scene.js';
import { HandTracker } from './handTracker.js';
import { GestureMapper } from './gesture.js';

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  video: $('cam'),
  overlay: $('overlay'),
  pip: $('pip'),
  boot: $('boot'),
  bootMsg: $('boot-msg'),
  bootBtn: $('boot-btn'),
  cam: $('s-cam'),
  hands: $('s-hands'),
  fps: $('s-fps'),
  camSelect: $('cam-select'),
  bloomVal: $('s-bloom'),
  bloomBar: $('bloom-bar'),
};

const scene = new MandalaScene(el.stage);
const mapper = new GestureMapper();
let hudStamp = 0;
const CAMERA_KEY = 'hand-flower:cameraId';

// 调试/演示用：?bloom=1 固定绽放度，不依赖摄像头
const forcedBloom = (() => {
  const raw = new URLSearchParams(location.search).get('bloom');
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
})();

// ?tips=x,y;x,y 用屏幕归一化坐标伪造指尖，方便在无摄像头时验证斥力
const forcedTips = (() => {
  const raw = new URLSearchParams(location.search).get('tips');
  if (!raw) return null;
  return raw
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => ({ x, y }));
})();

const STATUS_TEXT = {
  camera: '摄像头 请求中…',
  model: '手部模型 加载中…',
  ready: '摄像头 已就绪',
};

const tracker = new HandTracker({
  video: el.video,
  overlay: el.overlay,
  onStatus: (stage, detail) => {
    el.cam.textContent = STATUS_TEXT[stage] ?? stage;
    if (detail) el.cam.textContent += ` · ${detail}`;
  },
  onResult: (state) => {
    syncViewport();
    const mapped = mapper.update(state, performance.now());

    // HUD 每帧写 DOM 会拖慢渲染，节流到 ~12Hz
    const now = performance.now();
    if (now - hudStamp > 80) {
      hudStamp = now;
      el.hands.textContent = `手 ${mapped.handCount}`;
      el.fps.textContent = `FPS ${state.fps || '—'}`;
      el.bloomVal.textContent = mapped.bloom.toFixed(2);
      el.bloomBar.style.width = `${(mapped.bloom * 100).toFixed(0)}%`;
    }
    if (forcedBloom === null) scene.setHandState(mapped);
  },
});

window.__hf = { scene, tracker, mapper };

if (forcedBloom !== null || forcedTips !== null) {
  const bloom = forcedBloom ?? 1;
  const still = () => {
    scene.setHandState({
      bloom,
      hands: forcedTips ? [{ tips: forcedTips }] : [],
      // 调参模式没有手可识别，当作「有手」，否则法阵会被 presence 关掉
      handCount: 1,
      primary: { x: 0.5, y: 0.5 },
    });
    requestAnimationFrame(still);
  };
  still();
}

function syncViewport() {
  const { videoWidth: vw, videoHeight: vh } = el.video;
  if (!vw || !vh) return;
  mapper.setViewport(vw / vh, innerWidth / innerHeight);
}

function hideBoot() {
  el.boot.classList.add('fade');
  setTimeout(() => el.boot.setAttribute('hidden', ''), 400);
}

function fail(err) {
  el.boot.classList.remove('fade');
  el.boot.removeAttribute('hidden');
  el.bootMsg.textContent =
    err?.name === 'NotAllowedError'
      ? '摄像头权限被拒绝。检查地址栏左侧的权限图标，允许后点重试。'
      : `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
  el.bootBtn.hidden = false;
  el.cam.textContent = '摄像头 未启动';
}

async function boot() {
  el.bootBtn.hidden = true;
  el.bootMsg.textContent = '正在请求摄像头…';
  try {
    await tracker.start({ deviceId: localStorage.getItem(CAMERA_KEY) || undefined });
    hideBoot();
    await setupCameraPicker();
  } catch (err) {
    console.error(err);
    fail(err);
  }
}

async function setupCameraPicker() {
  let cams = [];
  try {
    cams = await tracker.listCameras();
  } catch {
    return;
  }
  if (!cams.length) return;

  el.camSelect.innerHTML = '';
  for (const cam of cams) {
    const opt = document.createElement('option');
    opt.value = cam.id;
    opt.textContent = cam.label;
    if (cam.id === tracker.currentDeviceId) opt.selected = true;
    el.camSelect.appendChild(opt);
  }

  // 第一次用（用户没选过）：优先内置摄像头，避开「连接手机」这类虚拟设备
  if (localStorage.getItem(CAMERA_KEY)) return;
  const builtin = cams.find((c) => /integrated|built-?in|内置|集成/i.test(c.label));
  if (builtin && builtin.id !== tracker.currentDeviceId) {
    try {
      await tracker.switchCamera(builtin.id);
      localStorage.setItem(CAMERA_KEY, builtin.id);
      el.camSelect.value = builtin.id;
    } catch (err) {
      console.warn('切到内置摄像头失败，保持当前设备', err);
    }
  }
}

el.camSelect.addEventListener('change', async () => {
  const id = el.camSelect.value;
  try {
    await tracker.switchCamera(id);
    localStorage.setItem(CAMERA_KEY, id);
  } catch (err) {
    console.error('切换摄像头失败', err);
  }
});

el.bootBtn.addEventListener('click', boot);

addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') el.pip.classList.toggle('big');
});

addEventListener('resize', syncViewport);

const renderLoop = () => {
  requestAnimationFrame(renderLoop);
  scene.render();
};
renderLoop();

if (forcedBloom === null) boot();
else hideBoot();
