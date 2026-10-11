// 零依赖静态服务器。用法：node scripts/serve.mjs [--port=8768] [--no-open]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const PORT = Number(argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? process.env.PORT ?? 8768);
const AUTO_OPEN = !argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = resolve(ROOT, `.${pathname}`);
  // 防目录穿越
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath).pipe(res);
});

const WSL = existsSync('/proc/version') && readFileSync('/proc/version', 'utf8').includes('microsoft');
const url = `http://localhost:${PORT}/`;

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  指间花开 · Hand Flower');
  console.log(`  根目录  ${ROOT}`);
  console.log(`  地址    ${url}`);
  console.log('');
  console.log('  摄像头需要安全上下文：必须用 localhost 或 https 打开，');
  console.log('  直接双击 index.html（file://）拿不到摄像头权限。');
  console.log('  Ctrl+C 停止。');
  console.log('');

  if (!AUTO_OPEN) return;
  try {
    if (WSL) spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log('  （自动打开浏览器失败，手动粘贴上面的地址）');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个：node scripts/serve.mjs --port=8899`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
