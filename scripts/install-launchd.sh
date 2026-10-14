#!/usr/bin/env bash
# ANMAST Gateway 部署到 macOS（launchd 开机自启）
# 用法：
#   ./scripts/install-launchd.sh          # 安装
#   ./scripts/install-launchd.sh uninstall # 卸载
set -euo pipefail

LABEL="com.anmast.gateway"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_SRC="$PROJECT_ROOT/deploy/com.anmast.gateway.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

# 默认配置（可用环境变量覆盖）
PORT="${PORT:-4000}"
DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/anmast/gateway}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123456}"
LOG_DIR="$HOME/Library/Logs/anmast"

if [[ "${1:-}" == "uninstall" ]]; then
  echo "卸载 $LABEL ..."
  launchctl bootout "gui/$(id -u)" "$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "已卸载。数据目录保留：$DATA_DIR"
  exit 0
fi

# 1. 查找 Node
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "错误：未找到 node。请先安装 Node.js（推荐 24 LTS）。" >&2
  exit 1
fi
NODE_BIN="$(readlink -f "$NODE_BIN")"
echo "使用 Node：$NODE_BIN ($("$NODE_BIN" --version))"

# 1.5 查找 pnpm（用于在线更新的构建）
PNPM_BIN="$(command -v pnpm || true)"
UPDATE_BUILD_CMD="pnpm build"
if [[ -n "$PNPM_BIN" ]]; then
  PNPM_BIN="$(readlink -f "$PNPM_BIN")"
  UPDATE_BUILD_CMD="$PNPM_BIN build"
  echo "使用 pnpm：$PNPM_BIN"
else
  echo "警告：未找到 pnpm，在线更新将使用默认 'pnpm build'（可能失败，建议安装 pnpm）" >&2
fi

# 2. 校验 node:sqlite 可用
if ! "$NODE_BIN" -e "require('node:sqlite')" 2>/dev/null; then
  echo "错误：当前 Node 版本不支持内置 node:sqlite。请升级到 Node.js 23.4+ 或 24 LTS。" >&2
  exit 1
fi

# 3. 构建（如未构建）
if [[ ! -f "$PROJECT_ROOT/server/dist/index.js" ]]; then
  echo "未找到编译产物，开始构建……"
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$PROJECT_ROOT" && pnpm install && pnpm build)
  else
    echo "错误：未找到 pnpm。请先安装 pnpm，或手动执行 pnpm install && pnpm build。" >&2
    exit 1
  fi
fi

# 4. 准备目录
mkdir -p "$DATA_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"

# 5. 生成 plist
sed \
  -e "s#__NODE_BIN__#$NODE_BIN#g" \
  -e "s#__DIST_INDEX__#$PROJECT_ROOT/server/dist/index.js#g" \
  -e "s#__PROJECT_ROOT__#$PROJECT_ROOT#g" \
  -e "s#__PORT__#$PORT#g" \
  -e "s#__DATA_DIR__#$DATA_DIR#g" \
  -e "s#__ADMIN_PASSWORD__#$ADMIN_PASSWORD#g" \
  -e "s#__UPDATE_BUILD_CMD__#$UPDATE_BUILD_CMD#g" \
  -e "s#__LOG_DIR__#$LOG_DIR#g" \
  "$PLIST_SRC" > "$PLIST_DST"

# 6. 加载
launchctl bootout "gui/$(id -u)" "$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo ""
echo "✅ 已安装并启动 $LABEL"
echo "   管理界面：http://127.0.0.1:$PORT/"
echo "   OpenAI 端点：http://127.0.0.1:$PORT/v1/chat/completions"
echo "   Anthropic 端点：http://127.0.0.1:$PORT/v1/messages"
echo "   数据目录：$DATA_DIR"
echo "   日志：$LOG_DIR/gateway.log"
echo ""
echo "   初始管理员：admin / $ADMIN_PASSWORD （首次启动后请到「设置」页修改）"
echo ""
echo "常用命令："
echo "  查看状态：launchctl print gui/$(id -u)/$LABEL | head"
echo "  查看日志：tail -f \"$LOG_DIR/gateway.log\""
echo "  停止服务：launchctl bootout gui/$(id -u)/$LABEL"
echo "  卸载：    ./scripts/install-launchd.sh uninstall"
