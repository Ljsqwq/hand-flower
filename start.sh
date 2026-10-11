#!/usr/bin/env bash
# 指间花开 · 一键启动
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if command -v node >/dev/null 2>&1; then
  exec node scripts/serve.mjs "$@"
fi

PORT="${PORT:-8768}"
echo "没找到 node，改用 python3 起服务（端口 $PORT）"
echo "浏览器打开：http://localhost:$PORT/"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
