# ANMAST Gateway

一个自托管的 AI 网关，可部署在任意服务器/主机上，为局域网/远程电脑提供统一的 AI 模型接入入口。

## 功能

### 模型接入与对外协议

- **多供应商模型接入**：支持任意 OpenAI 兼容供应商（OpenAI、DeepSeek、Ollama、OpenRouter、通义、Kimi 等）以及 Anthropic 协议供应商；供应商可自定义 Base URL、API Key、额外请求头，并支持「测试连接」。
- **对外双协议**：同时提供 OpenAI 兼容（`/v1/chat/completions`）与 Anthropic 兼容（`/v1/messages`）端点，均支持流式；现有 SDK 可直接对接。
- **模型自动发现**：模型对话框选择供应商后，自动拉取该 API Key 下的可用模型，并尽力带出各模型的最大上下文窗口。
- **图片/多模态透传**：支持 OpenAI 的 `image_url` 与 Anthropic 的 `image` 块（含 http URL 与 base64），网关在两种协议间自动转换；最终能否「看懂」取决于上游模型是否支持视觉。

### 路由与计费

- **按工作复杂度自动无缝切换**：定义 low/medium/high 等复杂度层级，客户端可显式传 `complexity`，未传时网关用低成本「路由模型」自动分级；同层级内按优先级选择模型，调用失败自动切换下一个候选模型。
- **缓存定价**：模型价格区分四档——输入·未命中缓存 / 输入·命中缓存 / 输入·缓存写入 / 输出（每 1M tokens）；成本按命中与否分别计算。
- **价格单位**：默认 CNY，可切换 USD（含汇率），模型页、仪表盘、调用记录的价格/成本自动换算。
- **按密钥成本账单**：仪表盘按 API Key 汇总总/本月 token 与成本。

### Skill 与 MCP

- **MCP Server**：支持 `stdio`（本地进程）、`sse`、`streamable-http` 三种传输；网关连接后把工具注入请求，模型发起工具调用时由网关内执行并回填结果。
- **Skill**：可注入的指令/流程包，支持触发关键词、绑定 MCP 工具；支持浏览器上传或服务器本地路径批量导入（SKILL.md 的 YAML frontmatter）。
- **按密钥允许列表**：每个 API Key 可配置「Skill 允许列表」与「MCP 允许列表」；列表为空表示全部可用，非空则仅允许列表内的项。

### 记录与历史

- **全量调用记录**：记录每次请求的请求体/响应体、token 用量（含缓存明细）、成本、耗时、状态、来源 IP；日志页 Tokens 列显示总数，悬浮展开缓存明细。
- **对话历史**：按会话聚合完整对话历史；自动识别 Claude Code 的 `session_id` 把同一 agent 的多轮请求合并为一个会话，并按内容去重；默认「简洁视图」只显示对话内容（隐藏提示词/分析/工具），可切换「显示全部」。

### 其它

- **网页内 AI 配置助手**：右下角浮动按钮唤起，用于解答配置问题并**辅助安装 Skill/MCP**（按名称查内置目录，或按 URL 下载安装），带实时进度与计时提示；仅开放白名单安装工具，无其它写操作与任意命令执行能力。
- **供应商测试门禁**：添加/编辑供应商时需先在对话框内「测试连接」通过才能保存。
- **认证**：单管理员（Web 后台）+ 网关 API Key（远程客户端），密钥支持月度 token 额度与启停。
- **Web 管理界面**：React + Ant Design 中文后台，含仪表盘、供应商、模型、路由层级、Skill、MCP、密钥、调用记录、对话历史、设置等页面。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 数据库：SQLite（Node 内置 `node:sqlite`，零原生依赖）
- 前端：React 18 + Vite + Ant Design 5
- MCP：`@modelcontextprotocol/sdk`

## 环境要求

- **Node.js ≥ 23.4（推荐 24 LTS）**：依赖内置的 `node:sqlite` 模块。
- macOS / Linux / Windows（跨平台，Apple Silicon 与 x86 均支持）。
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

## 生产构建与部署

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

1. 登录 `http://<网关IP>:4000/`（默认 admin/admin123456，请尽快在「设置」改密）。
2. 「供应商」页添加 OpenAI/Anthropic 供应商（填 Base URL 与 API Key，先「测试连接」通过后再保存）。
3. 「模型」页添加模型：选择供应商后自动拉取可用模型，选中后自动带出上下文窗口；勾选适用的复杂度层级、设置价格（含缓存价格）与优先级；可把某个便宜模型标记为「路由模型」。
4. 「路由与层级」页开启自动判定并选择路由模型、设置默认层级与 MCP 注入模式。
5. （可选）「MCP 服务器」页添加 MCP Server；「Skill」页编写或导入 Skill。
6. 「API 密钥」页创建网关密钥，并按需配置其 Skill/MCP 允许列表。

### 2. 远程电脑调用（OpenAI 兼容）

```bash
curl http://<网关IP>:4000/v1/chat/completions \
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
client = OpenAI(base_url="http://<网关IP>:4000/v1", api_key="sk-anmast-xxx")
client.chat.completions.create(model="auto", messages=[{"role":"user","content":"你好"}])
```

### 3. Anthropic 兼容

```bash
curl http://<网关IP>:4000/v1/messages \
  -H "x-api-key: sk-anmast-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": [{"type":"text","text":"你好"}]}]
  }'
```

### 4. Claude Code 接入

Claude Code 可直接指向网关（Anthropic 协议）。网关会自动识别其 `session_id`，把同一会话的多轮请求合并为一条连续对话。

```json
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://<网关IP>:4000",
    "ANTHROPIC_AUTH_TOKEN": "sk-anmast-xxx",
    "ANTHROPIC_MODEL": "auto"
  }
}
```

> `ANTHROPIC_BASE_URL` 结尾**不要带 `/v1`**。工具调用需上游模型支持 function calling。

### 路由与扩展字段

| 字段 | 说明 |
| --- | --- |
| `model` | `auto`（或省略）走复杂度路由；填已配置的模型名则直连该模型 |
| `complexity` | 显式指定层级：`low` / `medium` / `high`（或自定义层级 id） |
| `conversation_id` / `session_id` | 指定会话 id，网关按它聚合对话历史；未传则自动生成/识别，响应头 `X-Conversation-Id` 返回 |
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

## 价格与成本

模型价格区分四档（每 1M tokens，默认 CNY，可在「设置」切换 CNY/USD 与汇率自动换算）：

- **输入 · 未命中缓存**（`input_price`）
- **输入 · 命中缓存**（`input_cache_read_price`）
- **输入 · 缓存写入**（`input_cache_write_price`，Anthropic 等支持）
- **输出**（`output_price`）

成本 = 未命中输入 × input_price + 命中缓存 × cache_read_price + 缓存写入 × cache_write_price + 输出 × output_price。

网关会从上游 usage 提取命中缓存（OpenAI 的 `prompt_tokens_details.cached_tokens`、Anthropic 的 `cache_read_input_tokens` / `cache_creation_input_tokens`）；仪表盘「Token 统计」区分显示未命中/命中/写入/输出，日志页 Tokens 列悬浮显示缓存明细。

## Skill 与 MCP

- **MCP Server**：支持 `stdio` / `sse` / `streamable-http` 三种传输。网关连接后把工具注入请求；模型发起工具调用时由网关内执行并回填结果（默认 `on_demand`，可在路由设置改为 `auto` 或 `off`）。
- **Skill**：由「名称 + 描述 + 指令 + 触发关键词 + 绑定工具」组成，激活时其指令注入系统提示，声明的 MCP 工具自动可用。激活方式：请求体 `skills` 数组显式指定、用户消息命中触发关键词、或该请求使用的 API Key 允许列表中包含它。
- **按 API Key 允许列表**：在「API 密钥」页可为每个密钥配置「Skill 允许列表」与「MCP 允许列表」。
  - 列表**为空**：不受限，全部 Skill/MCP 可用（Skill 走显式请求 + 关键词触发，MCP 走全局注入模式）。
  - 列表**非空**：仅允许列表内的项；列表内的已启用 Skill 会自动激活，MCP 只注入列表内 Server 的工具（覆盖全局模式）。
  - Skill 的「停用」是全局总开关，停用的 Skill 即使在允许列表中也不会生效。
- **Skill 本地导入**：在「Skill」页可「导入文件」（浏览器上传）或「导入路径」（服务器本地文件/目录，扫描 `.md`）。支持 SKILL.md 的 YAML frontmatter：`name` / `description` / `tools`，正文作为指令内容。
- **AI 配置助手辅助安装**：可直接对助手说「安装 filesystem」「安装这个 skill 的 GitHub 地址」等，助手会按名称查内置目录或按 URL 下载并安装；安装过程有实时进度与计时提示。

## 数据与存储

- 数据库：`<DATA_DIR>/gateway.db`（SQLite，WAL 模式），默认 `server/data/`，部署时由 launchd 指向 `~/Library/Application Support/anmast/gateway`。
- 记录内容：每次请求的请求体/响应体（完整 messages）、token 用量、成本、耗时、状态、来源 IP、会话归属；以及归一化后的逐条消息，用于对话历史浏览。
- 会话聚合：网关自动识别 Claude Code 等客户端的 `session_id`，把同一会话的多轮请求归入同一对话并按内容去重；历史数据如需回填合并，可运行：

```bash
node scripts/repair-conversations.mjs [dbPath]
```

## 项目结构

```
ANMAST/
├── server/                      # 后端（Fastify）
│   └── src/
│       ├── index.ts             # 入口
│       ├── api/                 # openai / anthropic / admin 路由
│       ├── gateway/             # 请求解析、编排、响应构造
│       ├── providers/           # OpenAI / Anthropic 适配器、模型发现
│       ├── routing/             # 复杂度路由与自动判定
│       ├── mcp/                 # MCP 客户端管理
│       ├── skills/              # Skill 管理、本地导入
│       ├── assistant/           # AI 配置助手（内置 Skill、安装工具、目录）
│       ├── auth/                # 管理员与 API Key
│       └── db/                  # SQLite 迁移与 repository
├── web/                         # 前端（React + AntD）
├── scripts/
│   ├── install-launchd.sh       # launchd 部署脚本
│   └── repair-conversations.mjs # 会话历史回填合并脚本
├── deploy/com.anmast.gateway.plist
└── .env.example
```

## 注意事项

- 首次启动请务必修改默认管理员密码，并妥善保管网关 API Key（完整密钥仅在创建时显示一次）。
- 供应商 API Key 明文存储在本机 SQLite 中，请确保数据目录权限（`chmod 700`）与所在机器安全。
- 多模态图片内容会透传给上游模型，网关只做协议转换、不做识别；复杂度判定仅基于文本。
- 重新构建前端后无需重启服务即可生效（静态资源为动态服务）；修改后端代码后需重启进程。
- 工具调用（function calling）需要上游模型本身支持，若 Claude Code 等客户端报「tool call could not be parsed」，多为模型工具调用能力或参数格式问题。
