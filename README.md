# ANMAST Gateway

一个自托管的 AI 网关，部署在 Mac Mini M4 上，为局域网/远程电脑提供统一的 AI 模型接入入口。

## 功能

- **多供应商模型接入**：支持任意 OpenAI 兼容供应商（OpenAI、DeepSeek、Ollama、OpenRouter、通义、Kimi 等）以及 Anthropic 协议供应商。
- **Web 管理界面**：React + Ant Design 中文后台，管理供应商、模型、路由、Skill、MCP、密钥、日志。
- **全量调用记录与对话历史**：记录每一次调用的请求/响应、token 用量、成本、耗时、错误；按会话聚合完整对话历史。
- **按工作复杂度自动无缝切换**：定义 low/medium/high 等复杂度层级，客户端可显式传 `complexity`，未传时网关用低成本「路由模型」自动分级；同层级内按优先级选择模型，调用失败自动切换下一个候选模型。
- **Skill 与 MCP 安装 + 个性化配置**：连接 MCP Server（stdio / SSE / Streamable HTTP），网关内真正执行工具调用并回填结果；Skill 作为可注入指令包，支持关键词触发与工具绑定。
- **认证**：单管理员（Web 后台）+ 网关 API Key（远程客户端），密钥支持月度 token 额度与启停。
- **对外协议**：同时提供 OpenAI 兼容与 Anthropic 兼容端点，现有 SDK 可直接对接。
- **网页内 AI 配置助手**：右下角浮动按钮唤起，仅用于协助网页内配置（内置一套配置 Skill，无工具、无其它 Skill、只读，不参与任何真实调用）。
- **按密钥成本账单**：仪表盘按 API Key 汇总总/本月 token 与成本。
- **按密钥绑定 Skill/MCP**：每个 API Key 可单独配置要自动激活的 Skill 与要注入的 MCP Server 工具。
- **供应商测试门禁**：添加/编辑供应商时需先在对话框内「测试连接」通过才能保存。
- **模型自动发现**：模型对话框选择供应商后自动拉取该 API Key 下的可用模型，并尽力带出各模型的最大上下文窗口。
- **Skill 本地文件导入**：支持浏览器上传 SKILL.md 文件，或指定服务器本地文件/目录路径批量导入。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 数据库：SQLite（Node 内置 `node:sqlite`，零原生依赖）
- 前端：React 18 + Vite + Ant Design 5
- MCP：`@modelcontextprotocol/sdk`

## 环境要求

- **Node.js ≥ 23.4（推荐 24 LTS）**：依赖内置的 `node:sqlite` 模块。
- macOS（Apple Silicon，部署目标 Mac Mini M4）。
- pnpm（用于安装与构建）。

## 快速开始（开发）

```bash
# 安装依赖
pnpm install

# 同时启动后端(4000)与前端(5173，代理到后端)
pnpm dev

# 或分别启动
pnpm dev:server
pnpm dev:web
```

首次启动会创建默认管理员：`admin / admin123456`（通过 `ADMIN_PASSWORD` 环境变量修改初始密码）。

## 生产构建与部署（Mac Mini M4）

```bash
pnpm install
pnpm build        # 编译后端到 server/dist，前端到 web/dist（后端会自动托管）
pnpm start        # 直接运行：node server/dist/index.js
```

### 开机自启（launchd）

```bash
# 可通过环境变量定制：PORT / DATA_DIR / ADMIN_PASSWORD
ADMIN_PASSWORD='你的初始密码' ./scripts/install-launchd.sh

# 卸载
./scripts/install-launchd.sh uninstall
```

安装后会注册为 `com.anmast.gateway` LaunchAgent，开机自启、崩溃自动拉起，日志写入 `~/Library/Logs/anmast/gateway.log`。

## 使用方式

### 1. 在管理界面配置

1. 登录 `http://<mac-mini-ip>:4000/`（默认 admin/admin123456，请尽快在「设置」改密）。
2. 「供应商」页添加 OpenAI/Anthropic 供应商（含 Base URL 与 API Key，可用「测试」拉取上游模型列表）。
3. 「模型」页添加模型，并为每个模型勾选其适用的复杂度层级、设置价格与优先级；把某个便宜模型标记为「路由模型」。
4. 「路由与层级」页开启自动判定并选择路由模型、设置默认层级与 MCP 注入模式。
5. （可选）「MCP 服务器」页添加 MCP Server；「Skill」页编写 Skill。
6. 「API 密钥」页创建网关密钥，供远程电脑使用。

### 2. 远程电脑调用（OpenAI 兼容）

```bash
curl http://<mac-mini-ip>:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-anmast-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "complexity": "medium",
    "conversation_id": "my-thread-1",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

直接使用任意 OpenAI SDK，把 `base_url` 指向网关、`api_key` 填网关密钥即可：

```python
from openai import OpenAI
client = OpenAI(base_url="http://<mac-mini-ip>:4000/v1", api_key="sk-anmast-xxx")
client.chat.completions.create(model="auto", messages=[{"role":"user","content":"你好"}])
```

### 3. Anthropic 兼容

```bash
curl http://<mac-mini-ip>:4000/v1/messages \
  -H "x-api-key: sk-anmast-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": [{"type":"text","text":"你好"}]}]
  }'
```

### 路由与扩展字段

| 字段 | 说明 |
| --- | --- |
| `model` | `auto`（或省略）走复杂度路由；填已配置的模型名则直连该模型 |
| `complexity` | 显式指定层级：`low` / `medium` / `high`（或自定义层级 id） |
| `conversation_id` / `session_id` | 指定会话 id，网关按它聚合对话历史；未传则自动生成并在响应头 `X-Conversation-Id` 返回 |
| `skills` | 字符串数组，显式激活的 Skill 名称/ID |
| `gateway_tools` | `true` 时向模型注入已启用 MCP 服务器的工具 |

流式请求（`stream: true`）同样支持；当请求启用了网关工具时，网关会在内部执行工具循环后按客户端协议返回结果。

## 复杂度路由逻辑

1. 请求显式带 `complexity` → 命中对应层级。
2. 未带且开启自动判定 → 调用「路由模型」判断任务复杂度。
3. 均未命中 → 使用默认层级。
4. 在目标层级内按 `priority` 升序选择启用模型。
5. 目标层级无可用模型 → 自动降级/提升到其它层级。
6. 调用失败（网络/限流/5xx）→ 自动切换到下一个候选模型（无缝切换）。

## 价格与成本（含缓存）

模型价格区分四档（每 1M tokens，默认 CNY，可在「设置」切换 CNY/USD 自动换算）：

- **输入 · 未命中缓存**（`input_price`）
- **输入 · 命中缓存**（`input_cache_read_price`）
- **输入 · 缓存写入**（`input_cache_write_price`，Anthropic 等支持）
- **输出**（`output_price`）

成本 = 未命中输入 × input_price + 命中缓存 × cache_read_price + 缓存写入 × cache_write_price + 输出 × output_price。网关会从上游 usage 中提取命中缓存（OpenAI 的 `prompt_tokens_details.cached_tokens`、Anthropic 的 `cache_read_input_tokens` / `cache_creation_input_tokens`），仪表盘的「Token 统计」区分显示未命中/命中/写入/输出。

## Skill 与 MCP

- **MCP Server** 支持三种传输：`stdio`（本地进程）、`sse`、`streamable-http`。网关连接后把工具注入请求；模型发起工具调用时由网关内执行并回填结果（默认 `on_demand`，可在路由设置改为 `auto` 或 `off`）。
- **Skill** 是「名称 + 描述 + 指令 + 触发关键词 + 绑定工具」。激活时其指令注入系统提示，声明的 MCP 工具自动可用。激活方式：请求体 `skills` 数组显式指定、用户消息命中触发关键词、或该请求使用的 API Key 绑定了该 Skill。
- **按 API Key 绑定**：在「API 密钥」页可为每个密钥单独勾选「绑定 Skill」（调用时自动激活其指令）与「绑定 MCP Server」（只注入这些 Server 的工具，覆盖全局 MCP 注入模式）。适合给不同的远程客户端（如 Claude Code）分配不同的能力。
- **Skill 本地导入**：在「Skill」页可「导入文件」（浏览器上传）或「导入路径」（服务器本地文件/目录，扫描 `.md`）。支持 SKILL.md 的 YAML frontmatter：`name` / `description` / `tools`（逗号分隔的工具名），正文作为指令内容。
- **网页 AI 配置助手**：右下角按钮唤起，用于解答配置问题；在「路由与层级」页可选择「网页 AI 助手模型」，未选时回退到路由模型或首个可用模型。助手仅使用内置配置 Skill + 当前配置快照（只读），不具备工具调用与写操作能力。

## 数据与存储

- 数据库：`<DATA_DIR>/gateway.db`（SQLite，WAL 模式），默认 `server/data/`，部署时由 launchd 指向 `~/Library/Application Support/anmast/gateway`。
- 记录内容：每次请求的请求体/响应体（完整 messages）、token 用量、成本、耗时、状态、来源 IP、会话归属；以及归一化后的逐条消息，用于对话历史浏览。

## 项目结构

```
ANMAST/
├── server/                 # 后端（Fastify）
│   └── src/
│       ├── index.ts        # 入口
│       ├── api/            # openai / anthropic / admin 路由
│       ├── gateway/        # 请求解析、编排、响应构造
│       ├── providers/      # OpenAI / Anthropic 适配器
│       ├── routing/        # 复杂度路由与自动判定
│       ├── mcp/            # MCP 客户端管理
│       ├── skills/         # Skill 管理
│       ├── auth/           # 管理员与 API Key
│       └── db/             # SQLite 迁移与 repository
├── web/                    # 前端（React + AntD）
├── scripts/install-launchd.sh
├── deploy/com.anmast.gateway.plist
└── .env.example
```

## 注意事项

- 首次启动请务必修改默认管理员密码，并妥善保管网关 API Key（完整密钥仅在创建时显示一次）。
- 供应商 API Key 明文存储在本机 SQLite 中，请确保数据目录权限（`chmod 700`）与所在机器安全。
- 多模态图片内容会透传给上游；文本复杂度判定仅基于文本。
